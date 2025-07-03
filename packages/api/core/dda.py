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

        Q, _ = await dda_py.run_dda_async(
            input_file=file_path_str,
            output_file=None,
            channel_list=channel_list,
            bounds=bounds,
            cpu_time=False,
            raise_on_error=True,
        )

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

        result = DDAResponse(
            file_path=file_path_str,
            Q=Q,
            preprocessing_options=preprocessing_options,
        ).model_dump()

        return result
    except Exception as e:
        logger.error(f"Error during DDA computation: {e}")
        raise
