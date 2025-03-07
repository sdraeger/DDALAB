"""DDA endpoints."""

from typing import Optional

from fastapi import APIRouter, BackgroundTasks

from ..core.dda import get_dda_result, start_dda
from ..schemas.dda import DDARequest, DDAResponse, DDAResult
from ..schemas.preprocessing import PreprocessingOptionsInput

router = APIRouter()


@router.post("/", response_model=DDAResponse)
async def submit_dda(
    request: DDARequest,
    preprocessing_options: Optional[PreprocessingOptionsInput] = None,
    background_tasks: BackgroundTasks = None,
) -> DDAResponse:
    """Submit a DDA task.

    Args:
        request: DDA request containing file path
        preprocessing_options: Options for preprocessing the data
        background_tasks: FastAPI background tasks handler

    Returns:
        Task ID for tracking the DDA
    """
    task_id = await start_dda(
        request.file_path, preprocessing_options, background_tasks
    )
    return DDAResponse(task_id=task_id)


@router.get("/{task_id}", response_model=Optional[DDAResult])
async def get_result(task_id: str) -> Optional[DDAResult]:
    """Get the result of a DDA task.

    Args:
        task_id: Task ID returned by submit_dda

    Returns:
        DDA results if available, None if still processing
    """
    result = await get_dda_result(task_id)
    return result


@router.get("/{task_id}/status")
async def get_status(task_id: str):
    """Get the status of a DDA task.

    Args:
        task_id: Task ID returned by submit_dda

    Returns:
        Dictionary containing task status information
    """
    result = await get_dda_result(task_id)
    return {"status": "completed" if result else "processing"}
