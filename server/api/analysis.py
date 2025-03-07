"""DDA analysis endpoints."""

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

from ..core.analysis import get_analysis_result, start_analysis
from ..schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    AnalysisResult,
    TaskStatus,
)

router = APIRouter()


@router.post("/", response_model=AnalysisResponse)
async def submit_analysis(
    request: AnalysisRequest, background_tasks: BackgroundTasks
) -> AnalysisResponse:
    """Submit a DDA analysis task.

    Args:
        request: Analysis request containing file path
        background_tasks: FastAPI background tasks handler

    Returns:
        Task ID for tracking the analysis
    """
    try:
        task_id = await start_analysis(request.file_path, background_tasks)
        return AnalysisResponse(task_id=task_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}", response_model=Optional[AnalysisResult])
async def get_result(task_id: str) -> Optional[AnalysisResult]:
    """Get the result of a DDA analysis task.

    Args:
        task_id: Task ID returned by submit_analysis

    Returns:
        Analysis results if available, None if still processing
    """
    try:
        result = await get_analysis_result(task_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{task_id}/status", response_model=TaskStatus)
async def get_task_status(task_id: str) -> TaskStatus:
    """Get the status of a DDA analysis task.

    Args:
        task_id: Task ID returned by submit_analysis

    Returns:
        Current task status
    """
    try:
        result = await get_analysis_result(task_id)
        if result is None:
            return TaskStatus(status="processing")
        return TaskStatus(status="completed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
