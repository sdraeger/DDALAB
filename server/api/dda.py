"""DDA endpoints."""

from typing import Optional

from fastapi import APIRouter

from ..core.dda import get_dda_result, run_dda
from ..schemas.dda import DDARequest, DDAResponse, DDAResult
from ..schemas.preprocessing import PreprocessingOptionsInput

router = APIRouter()


@router.post("/", response_model=DDAResponse)
async def submit_dda_request(
    request: DDARequest,
    preprocessing_options: Optional[PreprocessingOptionsInput] = None,
) -> DDAResponse:
    """Submit a DDA task.

    Args:
        request: DDA request containing file path
        preprocessing_options: Options for preprocessing the data

    Returns:
        Task ID for tracking the DDA
    """
    task_id = await run_dda(
        request.file_path, request.channel_list, preprocessing_options
    )
    return DDAResponse(task_id=task_id)


@router.get("/{task_id}", response_model=Optional[DDAResult])
async def get_result(task_id: str) -> Optional[DDAResult]:
    """Get the result of a DDA task.

    Args:
        task_id: Task ID returned by submit_dda_request

    Returns:
        DDA results if available, None if still processing
    """
    result = await get_dda_result(task_id)
    return result


@router.get("/{task_id}/status")
async def get_status(task_id: str):
    """Get the status of a DDA task.

    Args:
        task_id: Task ID returned by submit_dda_request

    Returns:
        Dictionary containing task status information
    """
    result = await get_dda_result(task_id)
    return {"status": "completed" if result else "processing"}
