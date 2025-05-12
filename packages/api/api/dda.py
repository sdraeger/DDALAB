"""DDA endpoints."""

from fastapi import APIRouter

from ..core.dda import run_dda as run_dda_core
from ..schemas.dda import DDARequest, DDAResponse

router = APIRouter()


@router.post("", response_model=DDAResponse)
async def run_dda(request: DDARequest) -> DDAResponse:
    """Submit a DDA task.

    Args:
        request: DDA request containing file path
        preprocessing_options: Options for preprocessing the data

    Returns:
        Task ID for tracking the DDA
    """

    result = await run_dda_core(
        file_path=request.file_path,
        channel_list=request.channel_list,
        preprocessing_options=request.preprocessing_options,
        detrend_heatmap_axis=request.detrend_heatmap_axis,
    )
    return DDAResponse(
        file_path=request.file_path,
        Q=result["Q"],
        metadata=result.get("metadata"),
    )
