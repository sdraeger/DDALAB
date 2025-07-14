"""Routes for DDA analysis."""

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import DDAService
from core.services.errors import ServiceError
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from schemas.dda import DDARequest, DDAResponse

router = APIRouter()


@router.post("", response_model=DDAResponse)
async def analyze_dda(
    request: DDARequest,
    current_user: User = Depends(get_current_user),
    dda_service: DDAService = Depends(get_service(DDAService)),
) -> DDAResponse:
    """Perform DDA analysis on the given file."""
    try:
        logger.info(f"[DDA] Processing request for file: {request.file_path}")
        response = await dda_service.analyze(request)
        logger.info(f"[DDA] Analysis completed for file: {request.file_path}")
        return response
    except ServiceError as e:
        logger.error(f"[DDA] Service error: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"[DDA] Unexpected error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform DDA analysis: {str(e)}",
        )
