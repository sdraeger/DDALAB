"""Core DDA functionality."""

from pathlib import Path
from typing import Optional

import numpy as np
from loguru import logger
from scipy import signal

from ..core.config import get_server_settings
from ..schemas.preprocessing import PreprocessingOptionsInput
from ..tasks.dda import run_dda as run_dda_task

settings = get_server_settings()


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
    if options.get("resample1000hz") and sampling_rate != 1000:
        new_length = int(len(data) * 1000 / sampling_rate)
        processed_data = signal.resample(processed_data, new_length)
    elif options.get("resample500hz") and sampling_rate != 500:
        new_length = int(len(data) * 500 / sampling_rate)
        processed_data = signal.resample(processed_data, new_length)

    # Filtering
    nyquist = sampling_rate / 2
    if options.get("lowpassFilter"):
        b, a = signal.butter(4, 40 / nyquist, btype="low")
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("highpassFilter"):
        b, a = signal.butter(4, 0.5 / nyquist, btype="high")
        processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("notchFilter"):
        for freq in [50, 60]:  # Both 50Hz and 60Hz
            b, a = signal.iirnotch(freq, 30, sampling_rate)
            processed_data = signal.filtfilt(b, a, processed_data)

    if options.get("detrend"):
        processed_data = signal.detrend(processed_data)

    return processed_data


def run_dda(
    file_path: str,
    channel_list: list[int],
    preprocessing_options: Optional[PreprocessingOptionsInput] = None,
) -> str:
    """Run a DDA task.

    Args:
        file_path: Path to the file to analyze
        preprocessing_options: Options for preprocessing the data

    Returns:
        Task ID for tracking the task
    """

    file_path = str(Path(settings.data_dir) / file_path)
    logger.info(f"Starting DDA task for file: {file_path}")

    try:
        logger.info("Running DDA task...")
        result = run_dda_task(
            file_path=file_path,
            channel_list=channel_list,
            preprocessing_options=preprocessing_options,
        )
        logger.info("DDA task completed successfully")
        return result
    except Exception as e:
        logger.error(f"Error running DDA task: {e}")
        raise
