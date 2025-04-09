"""DDA endpoints."""

from typing import Optional

from fastapi import APIRouter

from ..core.dda import run_dda
from ..schemas.dda import DDARequest, DDAResponse, DDAResult
from ..schemas.preprocessing import PreprocessingOptionsInput

router = APIRouter()


@router.post("/", response_model=DDAResponse)
def submit_dda_request(
    request: DDARequest,
    preprocessing_options: Optional[PreprocessingOptionsInput] = None,
) -> DDAResult:
    """Submit a DDA task.

    Args:
        request: DDA request containing file path
        preprocessing_options: Options for preprocessing the data

    Returns:
        Task ID for tracking the DDA
    """
    task_id = run_dda(request.file_path, request.channel_list, preprocessing_options)
    return DDAResponse(task_id=task_id)
