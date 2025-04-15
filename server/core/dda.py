"""Core DDA functionality."""

from pathlib import Path
from typing import Optional

import dda_py
import numpy as np
from loguru import logger
from scipy import signal

from ..core.config import get_server_settings
from ..schemas.dda import DDAResult

settings = get_server_settings()

dda_py.init(settings.dda_binary_path)


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


async def run_dda(
    file_path: Path = None,
    channel_list: list[int] = None,
    preprocessing_options: dict[str, bool | int | float | str] = None,
) -> DDAResult:
    """Run DDA on a file.

    Args:
        file_path: Path to the file
        channel_list: List of channels to analyze
        preprocessing_options: Preprocessing options

    Returns:
        DDAResult object
    """

    file_path = str(Path(settings.data_dir) / file_path)
    logger.info(f"Running DDA on file: {file_path}")
    logger.info(f"Preprocessing options: {preprocessing_options}")

    try:
        Q, _ = await dda_py.run_dda_async(
            input_file=file_path,
            output_file=None,
            channel_list=channel_list,
            bounds=None,
            cpu_time=False,
            raise_on_error=False,
        )

        Q = np.where(np.isnan(Q), None, Q).tolist()

        result = DDAResult(
            file_path=file_path,
            Q=Q,
            preprocessing_options=preprocessing_options,
        ).model_dump()

        return result
    except Exception as e:
        error_msg = f"Error during DDA computation: {e}"
        logger.error(error_msg)
        raise
