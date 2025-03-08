"""Core DDA functionality."""

from typing import Any, Dict, Optional

from celery.result import AsyncResult
from fastapi import BackgroundTasks

from ..schemas.dda import DDAResult
from ..schemas.preprocessing import PreprocessingOptionsInput
from ..tasks.dda import run_dda


async def start_dda(
    file_path: str,
    preprocessing_options: Optional[PreprocessingOptionsInput] = None,
    background_tasks: BackgroundTasks = None,
) -> str:
    """Start a DDA task.

    Args:
        file_path: Path to the file to analyze
        preprocessing_options: Options for preprocessing the data
        background_tasks: Not used, kept for backward compatibility

    Returns:
        Task ID for tracking the DDA
    """
    print(f"Starting DDA task for file: {file_path}")

    # Convert preprocessing options to dictionary if present
    preprocessing_dict = None
    if preprocessing_options:
        preprocessing_dict = {
            "resample1000hz": preprocessing_options.resample1000hz,
            "resample500hz": preprocessing_options.resample500hz,
            "lowpassFilter": preprocessing_options.lowpassFilter,
            "highpassFilter": preprocessing_options.highpassFilter,
            "notchFilter": preprocessing_options.notchFilter,
            "detrend": preprocessing_options.detrend,
        }
        print(f"Using preprocessing options: {preprocessing_dict}")

    # Submit task directly to Celery
    try:
        print("Submitting task to Celery...")
        celery_task = run_dda.apply_async(
            args=[file_path, preprocessing_dict],
            queue="dda",  # Explicitly specify the queue
        )
        print(f"Task submitted successfully with ID: {celery_task.id} to queue: dda")
        return celery_task.id
    except Exception as e:
        print(f"Error submitting Celery task: {e}")
        raise


async def get_dda_result(task_id: str) -> Optional[DDAResult]:
    """Get the result of a DDA task.

    Args:
        task_id: Task ID returned by start_dda

    Returns:
        DDA results if available, None if still processing
    """
    task_result = AsyncResult(task_id)
    print(f"Task {task_id} status: {task_result.status}, info: {task_result.info}")
    print(f"Task backend: {task_result.backend}")
    print(f"Task result: {task_result.result}")

    if task_result.status == "SUCCESS":
        try:
            result = task_result.get()
            print(f"Got task result: {result}")
            return {
                "taskId": task_id,
                "filePath": result["file_path"],
                "peaks": result["results"][
                    "data"
                ],  # Use the data array for visualization
                "status": "completed",
            }
        except Exception as e:
            print(f"Error getting task result: {e}")
            return None
    elif task_result.status == "FAILURE":
        print(f"Task failed: {task_result.info}")
        return None
    else:
        print(f"Task still processing: {task_result.status}")
        return None


async def get_task_status(task_id: str) -> Dict[str, Any]:
    """Get detailed status of a task.

    Args:
        task_id: Task ID to check

    Returns:
        Dictionary containing task status information
    """
    task_result = AsyncResult(task_id)
    return {
        "taskId": task_id,
        "status": task_result.status,
        "info": str(task_result.info) if task_result.info else None,
    }
