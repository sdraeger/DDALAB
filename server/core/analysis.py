"""DDA analysis functionality."""

from typing import Optional, Dict, Any
from celery.result import AsyncResult

from ..tasks.analysis import run_dda_analysis
from ..schemas.analysis import AnalysisResult


async def start_analysis(file_path: str, *args, **kwargs) -> str:
    """Start a DDA analysis task.

    Args:
        file_path: Path to the file to analyze

    Returns:
        Task ID for tracking the analysis
    """
    # Submit task to Celery
    task = run_dda_analysis.delay(file_path)
    return task.id


async def get_analysis_result(task_id: str) -> Optional[AnalysisResult]:
    """Get the result of a DDA analysis task.

    Args:
        task_id: Task ID returned by start_analysis

    Returns:
        Analysis results if available, None if still processing
    """
    # Get task result from Celery
    task_result = AsyncResult(task_id)

    if task_result.ready():
        if task_result.successful():
            result = task_result.get()
            return AnalysisResult(**result)
        else:
            # Task failed
            error = task_result.get(propagate=False)
            return AnalysisResult(data={"error": str(error)}, dda_output={})

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
        "task_id": task_id,
        "status": task_result.status,
        "info": task_result.info,
    }
