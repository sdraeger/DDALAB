"""DDA processing functionality."""

import os
from pathlib import Path
from typing import Optional

import dda_py
import numpy as np
from core.config import get_server_settings
from core.dda_ape_patch import patch_dda_py
from core.files import read_edf_header
from loguru import logger
from schemas.dda import DDAResponse
from scipy import signal

settings = get_server_settings()

# Apply APE compatibility patch for dda_py
patch_dda_py()

# Global variable to track DDA binary status
_dda_binary_valid = None
_dda_binary_error = None


def validate_dda_binary() -> tuple[bool, Optional[str]]:
    """Validate that the DDA binary exists and is executable.

    Returns:
        Tuple of (is_valid, error_message)
    """
    global _dda_binary_valid, _dda_binary_error

    # Return cached result if already validated
    if _dda_binary_valid is not None:
        return _dda_binary_valid, _dda_binary_error

    try:
        binary_path = Path(settings.dda_binary_path)

        # Check if file exists
        if not binary_path.exists():
            _dda_binary_valid = False
            _dda_binary_error = (
                f"DDA binary not found at path: {settings.dda_binary_path}"
            )
            return _dda_binary_valid, _dda_binary_error

        # Check if file is executable
        if not os.access(binary_path, os.X_OK):
            _dda_binary_valid = False
            _dda_binary_error = (
                f"DDA binary is not executable: {settings.dda_binary_path}"
            )
            return _dda_binary_valid, _dda_binary_error

        # Try to initialize dda_py
        dda_py.init(settings.dda_binary_path)
        _dda_binary_valid = True
        _dda_binary_error = None
        logger.info(f"DDA binary validated successfully: {settings.dda_binary_path}")
        return _dda_binary_valid, _dda_binary_error

    except Exception as e:
        _dda_binary_valid = False
        _dda_binary_error = f"DDA binary initialization failed: {str(e)}"
        logger.error(f"DDA binary validation failed: {_dda_binary_error}")
        return _dda_binary_valid, _dda_binary_error


# Perform initial validation
_is_valid, _error = validate_dda_binary()
if not _is_valid:
    logger.warning(f"DDA binary validation failed during module import: {_error}")


def preprocess_data(
    data: np.ndarray, sampling_rate: float, options: Optional[dict[str, bool]] = None
) -> np.ndarray:
    """Preprocess the data according to the specified options.

    Args:
        data: Raw data array
        sampling_rate: Original sampling rate in Hz
        options: Dictionary of preprocessing options

    Returns:
        Preprocessed data array
    """
    if not options:
        return data

    processed_data = data.copy()

    # Resampling
    if new_sampling_rate := options.get("resample"):
        new_length = int(len(data) * new_sampling_rate / sampling_rate)
        processed_data = signal.resample(processed_data, new_length)
        sampling_rate = new_sampling_rate

    # Filtering
    nyquist = sampling_rate / 2
    if options.get("lowpassFilter"):
        b, a = signal.butter(4, 40 / nyquist, btype="low")
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("highpassFilter"):
        b, a = signal.butter(4, 0.5 / nyquist, btype="high")
        processed_data = signal.filtfilt(b, a, processed_data)

    if freq := options.get("notchFilter"):
        b, a = signal.iirnotch(freq, 30, sampling_rate)
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("detrend"):
        processed_data = signal.detrend(processed_data)

    return processed_data


async def run_dda(
    file_path: Path = None,
    channel_list: list[int] = None,
    preprocessing_options: dict[str, bool | int | float | str] = None,
    max_heatmap_points: int = 100000,  # Limit to 100k points for performance
) -> DDAResponse:
    """Run DDA on a file.

    Args:
        file_path: Path to the file
        channel_list: List of channels to analyze
        preprocessing_options: Preprocessing options
        max_heatmap_points: Maximum number of points for the heatmap

    Returns:
        DDAResult object
    """
    # Check DDA binary validity first
    is_valid, error_message = validate_dda_binary()
    if not is_valid:
        logger.warning(f"DDA binary validation failed: {error_message}")
        return DDAResponse(
            file_path=str(file_path) if file_path else "",
            Q=[],
            preprocessing_options=preprocessing_options,
            error="DDA_BINARY_INVALID",
            error_message=error_message,
        ).model_dump()

    file_path_str = str(Path(settings.data_dir) / file_path)
    logger.info(f"Running DDA on file: {file_path_str}")
    logger.info(f"Original preprocessing options: {preprocessing_options}")

    try:
        # Get the total number of samples to prevent out-of-bounds errors
        header = read_edf_header(file_path_str)
        total_samples = header["n_samples"]
        # The DDA binary has a known bug that causes a crash if it reads to the
        # very end of the file. A safety margin is used to prevent this.
        safety_margin = 256
        end_bound = max(0, total_samples - safety_margin)
        bounds = (0, end_bound)
        logger.info(
            f"Setting DDA bounds to: {bounds} for file with {total_samples} samples (includes safety margin)"
        )

        logger.debug("Calling dda_py.run_dda_async with parameters:")
        logger.debug(f"  input_file: {file_path_str}")
        logger.debug(f"  channel_list: {channel_list}")
        logger.debug(f"  bounds: {bounds}")

        # Smart channel selection: use provided channels or select appropriate defaults
        effective_channel_list = channel_list if channel_list is not None else []

        # If no channels specified, automatically select appropriate channels to prevent DDA binary crash
        if not effective_channel_list:
            try:
                from core.edf.edf_cache import get_cache_manager

                cache_manager = get_cache_manager()

                # Get intelligent default channels (this returns channel names)
                default_channel_names = cache_manager.get_intelligent_default_channels(
                    file_path_str, max_channels=5
                )

                if default_channel_names:
                    # Convert channel names to indices (DDA binary expects indices)
                    # Get all channel labels to find indices
                    navigator = cache_manager.get_file_metadata(file_path_str)
                    all_channel_labels = navigator.get("signal_labels", [])

                    # Map channel names to indices
                    channel_indices = []
                    for channel_name in default_channel_names:
                        try:
                            index = all_channel_labels.index(channel_name)
                            channel_indices.append(
                                str(index)
                            )  # DDA binary expects string indices
                        except ValueError:
                            logger.warning(f"Channel {channel_name} not found in file")

                    effective_channel_list = channel_indices
                    logger.info(
                        f"Auto-selected channels: {default_channel_names} (indices: {effective_channel_list})"
                    )
                else:
                    # Fallback: select first few channels (skip channel 0 which is often Events)
                    total_channels = header.get("n_channels", 1)
                    if total_channels > 1:
                        # Select channels 1-3 (indices 1, 2, 3) to avoid potential event channels
                        effective_channel_list = [
                            str(i) for i in range(1, min(4, total_channels))
                        ]
                        logger.info(
                            f"Fallback: selected channels 1-3 (indices: {effective_channel_list})"
                        )
                    else:
                        # Single channel file, use channel 0
                        effective_channel_list = ["0"]
                        logger.info("Single channel file: using channel 0")

            except Exception as channel_error:
                logger.warning(f"Failed to auto-select channels: {channel_error}")
                # Final fallback: use first channel
                effective_channel_list = ["0"]
                logger.info("Using fallback channel selection: channel 0")

        logger.debug(f"  effective_channel_list: {effective_channel_list}")

        # Try DDA computation with multiple fallback strategies if needed
        dda_attempts = [
            ("primary", effective_channel_list),
        ]

        # Add fallback attempts if the primary selection seems risky
        if len(effective_channel_list) > 3:
            # Try with fewer channels if we selected many
            dda_attempts.append(("fewer_channels", effective_channel_list[:3]))

        # Add conservative fallbacks
        total_channels = header.get("n_channels", 1)
        if total_channels > 10:
            # For files with many channels, try very conservative selections
            dda_attempts.extend(
                [
                    (
                        "conservative_middle",
                        [str(i) for i in range(10, min(13, total_channels))],
                    ),
                    (
                        "conservative_high",
                        [str(i) for i in range(20, min(23, total_channels))],
                    ),
                    ("single_channel", ["10"]),  # Try a single middle channel
                ]
            )
        else:
            # For smaller files, try single channel fallbacks
            if total_channels > 1:
                dda_attempts.append(("single_channel", ["1"]))

        last_error = None
        for attempt_name, attempt_channels in dda_attempts:
            try:
                logger.info(
                    f"DDA attempt '{attempt_name}' with channels: {attempt_channels}"
                )

                Q, metadata = await dda_py.run_dda_async(
                    input_file=file_path_str,
                    output_file=None,
                    channel_list=attempt_channels,
                    bounds=bounds,
                    cpu_time=False,
                    raise_on_error=True,
                )

                logger.info(f"DDA attempt '{attempt_name}' succeeded!")
                effective_channel_list = attempt_channels  # Update for response logging
                break  # Success, exit the retry loop

            except Exception as attempt_error:
                error_msg = str(attempt_error)
                logger.warning(f"DDA attempt '{attempt_name}' failed: {error_msg}")
                last_error = attempt_error

                # Check if this is a sampling rate error that might be resolved with different channels
                if (
                    "verschiedene SRs" in error_msg
                    or "SIGILL" in error_msg
                    or "SIGSEGV" in error_msg
                ):
                    logger.info(
                        "Detected channel-related error, trying next fallback..."
                    )
                    continue  # Try the next fallback
                else:
                    # For other types of errors, don't retry
                    logger.error(
                        f"Non-channel related error, stopping retries: {error_msg}"
                    )
                    raise attempt_error
        else:
            # All attempts failed
            if last_error:
                logger.error(f"All DDA attempts failed, last error: {last_error}")
                raise last_error
            else:
                raise Exception("All DDA attempts failed with unknown errors")

        logger.debug(
            f"DDA computation returned: Q={type(Q)}, metadata={type(metadata)}"
        )

        # Check if Q is None or invalid
        if Q is None:
            logger.error("DDA computation returned None for Q matrix")
            return DDAResponse(
                file_path=file_path_str,
                Q=[],
                preprocessing_options=preprocessing_options,
                error="DDA_COMPUTATION_FAILED",
                error_message="DDA computation returned no data (Q matrix is None)",
            ).model_dump()

        # Ensure Q is a numpy array
        if not isinstance(Q, np.ndarray):
            logger.error(f"DDA computation returned unexpected type for Q: {type(Q)}")
            return DDAResponse(
                file_path=file_path_str,
                Q=[],
                preprocessing_options=preprocessing_options,
                error="DDA_COMPUTATION_FAILED",
                error_message=f"DDA computation returned unexpected data type: {type(Q)}",
            ).model_dump()

        # Check if Q has valid shape
        if Q.size == 0:
            logger.error("DDA computation returned empty Q matrix")
            return DDAResponse(
                file_path=file_path_str,
                Q=[],
                preprocessing_options=preprocessing_options,
                error="DDA_COMPUTATION_FAILED",
                error_message="DDA computation returned empty Q matrix",
            ).model_dump()

        Q = Q.T

        # In-depth debugging of the raw Q matrix
        logger.info(f"Raw Q matrix shape: {Q.shape}, dtype: {Q.dtype}")
        nan_count = np.isnan(Q).sum()
        inf_count = np.isinf(Q).sum()
        finite_count = np.isfinite(Q).sum()
        logger.info(
            f"Q matrix stats: NaN={nan_count}, Inf={inf_count}, Finite={finite_count}"
        )
        if nan_count > 0 or inf_count > 0:
            logger.warning("Q matrix contains non-finite values.")
            # Log a small sample of the raw data to see what it looks like
            logger.debug(f"Raw Q sample: {Q[:2, :5]}")

        # Replace NaNs with 0 before resampling to avoid poisoning the calculation
        if nan_count > 0:
            logger.info(f"Replacing {nan_count} NaN values with 0.")
            np.nan_to_num(Q, copy=False, nan=0.0)

        Q = np.where(np.isnan(Q), None, Q).tolist()

        # Ensure metadata is a dictionary
        if isinstance(metadata, dict):
            result_metadata = metadata
        elif hasattr(metadata, "__dict__"):
            result_metadata = metadata.__dict__
        else:
            # If metadata is a file path or other object, create a basic dictionary
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

        # Return error response instead of re-raising
        return DDAResponse(
            file_path=file_path_str if "file_path_str" in locals() else str(file_path),
            Q=[],
            preprocessing_options=preprocessing_options,
            error="DDA_COMPUTATION_ERROR",
            error_message=f"DDA computation failed: {str(e)}",
        ).model_dump()
