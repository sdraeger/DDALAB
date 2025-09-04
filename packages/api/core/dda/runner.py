from pathlib import Path

import dda_py
import matplotlib.pyplot as plt
import numpy as np
from core.dda.binary_validation import validate_dda_binary
from core.dda_ape_patch import patch_dda_py
from core.edf.edf_cache import get_cache_manager
from core.environment import get_config_service
from core.files import read_edf_header
from loguru import logger
from schemas.dda import DDAResponse

patch_dda_py()


def plot_matrix_rows(
    matrix,
    labels=None,
    title="Time Series Plot",
    xlabel="Time",
    ylabel="Value",
    figsize=(10, 6),
):
    """
    Plot a 2D matrix with line plots where columns are individual time series.

    Parameters:
    -----------
    matrix : array-like
        2D array/matrix where each column is a time series
    labels : list, optional
        List of labels for each time series (column)
    title : str, optional
        Title of the plot
    xlabel : str, optional
        Label for x-axis
    ylabel : str, optional
        Label for y-axis
    figsize : tuple, optional
        Figure size (width, height)

    Returns:
    --------
    fig, ax : matplotlib figure and axes objects
    """

    # Convert to numpy array for consistency
    matrix = np.array(matrix)

    # Check if matrix is 2D
    if matrix.ndim != 2:
        raise ValueError("Matrix must be 2-dimensional")

    # Get dimensions
    n_series, n_time_points = matrix.shape

    # Create figure and axis
    fig, ax = plt.subplots(figsize=figsize)

    # Generate x-axis values (time points)
    x = np.arange(n_time_points)

    # Plot each column as a separate line
    for i in range(n_series):
        if labels and i < len(labels):
            ax.plot(x, matrix[i, :], label=labels[i], linewidth=2)
        else:
            ax.plot(x, matrix[i, :], label=f"Series {i + 1}", linewidth=2)

    # Customize the plot
    ax.set_title(title, fontsize=14, fontweight="bold")
    ax.set_xlabel(xlabel, fontsize=12)
    ax.set_ylabel(ylabel, fontsize=12)
    ax.grid(True, alpha=0.3)

    # Add legend if there are multiple series or labels provided
    if n_series > 1 or (labels and len(labels) > 0):
        ax.legend()

    # Adjust layout to prevent label cutoff
    plt.tight_layout()

    return fig, ax


def validate_dda_command_args(effective_channel_list, bounds):
    # Channel list must not be empty and must be all strings of positive integers
    if not effective_channel_list or not all(
        str(ch).isdigit() and int(ch) >= 0 for ch in effective_channel_list
    ):
        return (
            False,
            "DDA command: Channel list (-CH_list) must contain at least one valid channel index (>=0).",
        )
    # Bounds must be a tuple of two non-negative integers, start < end
    if not (
        isinstance(bounds, tuple)
        and len(bounds) == 2
        and all(isinstance(b, int) and b >= 0 for b in bounds)
    ):
        return (
            False,
            "DDA command: Bounds (-StartEnd) must be a tuple of two non-negative integers.",
        )
    if bounds[0] >= bounds[1]:
        return False, "DDA command: Start bound must be less than end bound."
    return True, None


async def run_dda(
    file_path: Path = None,
    channel_list: list[int] = None,
    preprocessing_options: dict = None,
) -> DDAResponse:
    dda_settings = get_config_service().get_dda_settings()
    storage_settings = get_config_service().get_storage_settings()

    is_valid, error_message = validate_dda_binary(dda_settings)

    if not is_valid:
        logger.warning(f"DDA binary validation failed: {error_message}")
        return DDAResponse(
            file_path=str(file_path) if file_path else "",
            Q=[],
            preprocessing_options=preprocessing_options,
            error="DDA_BINARY_INVALID",
            error_message=error_message,
        ).model_dump()

    file_path_str = str(Path(storage_settings.data_dir) / file_path)
    logger.info(f"Running DDA on file: {file_path_str}")
    logger.info(f"Original preprocessing options: {preprocessing_options}")

    try:
        header = read_edf_header(file_path_str)
        total_samples = int(header["n_samples"])
        n_channels = header.get("n_channels", 1)
        safety_margin = 256
        end_bound = int(max(0, total_samples - safety_margin))
        bounds = (0, end_bound)  # ensure both are Python int
        logger.info(
            f"Setting DDA bounds to: {bounds} for file with {total_samples} samples (includes safety margin)"
        )

        logger.debug("Calling dda_py.run_dda_async with parameters:")
        logger.debug(f"  input_file: {file_path_str}")
        logger.debug(f"  channel_list: {channel_list}")
        logger.debug(f"  bounds: {bounds}")

        effective_channel_list = channel_list if channel_list is not None else []

        if not effective_channel_list:
            try:
                cache_manager = get_cache_manager()
                default_channel_names = cache_manager.get_intelligent_default_channels(
                    file_path_str, max_channels=5
                )
                logger.info(
                    f"get_intelligent_default_channels returned: {default_channel_names}"
                )
                if default_channel_names:
                    effective_channel_list = [
                        str(i + 1) for i in range(len(default_channel_names))
                    ]
                    logger.info(
                        f"Using indices for default channels: {effective_channel_list}"
                    )
                else:
                    logger.warning(
                        "get_intelligent_default_channels returned empty, using fallback."
                    )
            except Exception as e:
                logger.error(f"Failed to get intelligent default channels: {e}")
                effective_channel_list = []

        # Fallback: if still empty, use all channels from header
        if not effective_channel_list and n_channels > 0:
            effective_channel_list = [str(i + 1) for i in range(min(n_channels, 5))]
            logger.info(
                f"Fallback: using channels 1..{min(n_channels, 5)}: {effective_channel_list}"
            )

        # FINAL CHECK: If still empty, error out
        if not effective_channel_list:
            logger.error(
                "No channels available for DDA command after all attempts. Aborting."
            )
            return DDAResponse(
                file_path=file_path_str,
                Q=[],
                preprocessing_options=preprocessing_options,
                error="DDA_COMMAND_NO_CHANNELS",
                error_message="No channels available for DDA command (-CH_list). Cannot run DDA binary.",
            ).model_dump()

        # Validate command arguments before running the binary
        valid_cmd, cmd_error = validate_dda_command_args(effective_channel_list, bounds)
        if not valid_cmd:
            logger.error(f"Malformed DDA command: {cmd_error}")
            return DDAResponse(
                file_path=file_path_str,
                Q=[],
                preprocessing_options=preprocessing_options,
                error="DDA_COMMAND_INVALID",
                error_message=cmd_error,
            ).model_dump()

        logger.info(
            f"DDA command: binary={dda_settings.dda_binary_path}, channels={effective_channel_list}, bounds={bounds}"
        )

        Q, metadata = await dda_py.run_dda_async(
            input_file=file_path_str,
            output_file=None,
            channel_list=effective_channel_list,
            bounds=bounds,
            cpu_time=False,
            raise_on_error=True,
        )

        logger.info(f"Raw Q matrix shape: {Q.shape}, dtype: {Q.dtype}")

        nan_count = np.isnan(Q).sum()
        inf_count = np.isinf(Q).sum()
        finite_count = np.isfinite(Q).sum()
        logger.info(
            f"Q matrix stats: NaN={nan_count}, Inf={inf_count}, Finite={finite_count}"
        )
        if nan_count > 0 or inf_count > 0:
            logger.warning("Q matrix contains non-finite values.")
            logger.debug(f"Raw Q sample: {Q[:2, :5]}")
        if nan_count > 0:
            logger.info(f"Replacing {nan_count} NaN values with 0.")
            np.nan_to_num(Q, copy=False, nan=0.0)

        Q = np.where(np.isnan(Q), None, Q).T.tolist()

        if isinstance(metadata, dict):
            result_metadata = metadata
        elif hasattr(metadata, "__dict__"):
            result_metadata = metadata.__dict__
        else:
            result_metadata = {"dda_output_file": str(metadata) if metadata else None}
        result = DDAResponse(
            file_path=file_path_str,
            Q=Q,
            preprocessing_options=preprocessing_options,
            metadata=result_metadata,
        ).model_dump()
        return result
    except Exception as e:
        logger.error(f"Error during DDA computation: {e}")
        logger.error(f"Exception type: {type(e)}")
        import traceback

        logger.error(f"Full traceback: {traceback.format_exc()}")
        return DDAResponse(
            file_path=file_path_str if "file_path_str" in locals() else str(file_path),
            Q=[],
            preprocessing_options=preprocessing_options,
            error="DDA_COMPUTATION_ERROR",
            error_message=f"DDA computation failed: {str(e)}",
        ).model_dump()
