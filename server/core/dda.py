"""Core DDA functionality."""

from pathlib import Path
from typing import Any, Optional

import numpy as np
from celery.result import AsyncResult
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

    # Submit task directly to Celery
    try:
        logger.info("Submitting task to Celery...")
        result = run_dda_task(
            file_path=file_path,
            channel_list=channel_list,
            preprocessing_options=preprocessing_options,
        )
        # celery_task = run_dda_task.apply_async(
        #     args=[
        #         file_path,
        #         channel_list,
        #         strawberry.asdict(preprocessing_options),
        #     ],
        #     queue="dda",
        # )
        logger.info(f"Task submitted successfully with ID: {result.id}")
        return result
    except Exception as e:
        logger.error(f"Error submitting Celery task: {e}")
        raise


async def get_dda_result(task_id: str) -> Optional[dict[str, Any]]:
    """Get the result of a DDA task.

    Args:
        task_id: Task ID returned by run_dda

    Returns:
        DDA results if available, None if still processing
    """
    task_result = AsyncResult(task_id)
    logger.info(
        f"Task {task_id} status: {task_result.status}, info: {task_result.info}"
    )
    logger.info(f"Task backend: {task_result.backend}")
    logger.info(f"Task result: {task_result.result}")

    if task_result.status == "SUCCESS":
        try:
            result = task_result.get()
            logger.info(f"Got task result keys: {result.keys()}")
            return result
        except Exception as e:
            logger.error(f"Error getting task result: {e}")
            return None
    elif task_result.status == "FAILURE":
        logger.error(f"Task failed: {task_result.info}")
        return None
    else:
        logger.info(f"Task still processing: {task_result.status}")
        return None


# async def get_task_status(task_id: str) -> Dict[str, Any]:
#     """Get detailed status of a task.

#     Args:
#         task_id: Task ID to check

#     Returns:
#         Dictionary containing task status information
#     """
#     task_result = AsyncResult(task_id)

#     # Enhanced logging
#     logger.info(f"[Task Status] Task ID: {task_id}")
#     logger.info(f"[Task Status] Status: {task_result.status}")
#     logger.info(f"[Task Status] Backend: {task_result.backend}")

#     # Log result info if available
#     if task_result.info:
#         logger.info(f"[Task Status] Info: {task_result.info}")

#     # Check if result is ready and what it contains
#     if task_result.ready():
#         logger.info(
#             f"[Task Status] Task is ready, successful: {task_result.successful()}"
#         )
#         if task_result.successful():
#             try:
#                 # Try to peek at the result without consuming it
#                 result_peek = task_result.result
#                 logger.info(f"[Task Status] Result peek: {type(result_peek)}")
#             except Exception as e:
#                 logger.error(f"[Task Status] Error peeking at result: {e}")

#     return {
#         "taskId": task_id,
#         "status": task_result.status,
#         "info": str(task_result.info) if task_result.info else None,
#     }
