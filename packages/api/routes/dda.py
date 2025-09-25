"""Routes for DDA."""

from typing import List, Optional

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import DDAService
from core.services.dda_variant_service import DDAVariant
from core.services.errors import ServiceError
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from schemas.dda import DDARequest, DDAResponse

router = APIRouter()


@router.post("", response_model=DDAResponse)
async def analyze_dda(
    request: DDARequest,
    _: User = Depends(get_current_user),
    dda_service: DDAService = Depends(get_service(DDAService)),
) -> DDAResponse:
    """Perform DDA on the given file."""
    try:
        logger.info(f"[DDA] Processing request for file: {request.file_path}")
        response = await dda_service.analyze(request)
        logger.info(f"[DDA] DDA completed for file: {request.file_path}")
        return response
    except ServiceError as e:
        logger.error(f"[DDA] Service error: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"[DDA] Unexpected error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform DDA: {str(e)}",
        )


@router.get("/variants", response_model=List[DDAVariant])
async def get_dda_variants(
    _: User = Depends(get_current_user),
    dda_service: DDAService = Depends(get_service(DDAService)),
) -> List[DDAVariant]:
    """Get available DDA algorithm variants."""
    try:
        logger.info("[DDA] Getting available algorithm variants")
        variants = await dda_service.get_available_variants()
        logger.info(f"[DDA] Found {len(variants)} algorithm variants")
        return variants
    except ServiceError as e:
        logger.error(f"[DDA] Service error getting variants: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"[DDA] Unexpected error getting variants: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get DDA variants: {str(e)}",
        )


@router.get("/history", response_model=List[dict])
async def get_dda_history(
    file_path: Optional[str] = None,
    limit: Optional[int] = 50,
    current_user: User = Depends(get_current_user),
    dda_service: DDAService = Depends(get_service(DDAService)),
) -> List[dict]:
    """Get DDA analysis history for the current user."""
    try:
        logger.info(f"[DDA] Getting history for user {current_user.id}, file_path: {file_path}")
        
        history = await dda_service.get_analysis_history(
            user_id=current_user.id,
            file_path=file_path,
            limit=limit
        )
        
        logger.info(f"[DDA] Found {len(history)} history entries")
        logger.info(f"[DDA] History data preview: {[h.get('id', 'no-id') for h in history[:3]]}")
        return history
    except ServiceError as e:
        logger.error(f"[DDA] Service error getting history: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"[DDA] Unexpected error getting history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get DDA history: {str(e)}",
        )


@router.get("/history/{result_id}", response_model=dict)
async def get_dda_analysis_by_id(
    result_id: str,
    current_user: User = Depends(get_current_user),
    dda_service: DDAService = Depends(get_service(DDAService)),
) -> dict:
    """Get a specific DDA analysis result by its ID."""
    try:
        logger.info(f"[DDA] Getting analysis {result_id} for user {current_user.id}")
        
        # Get the analysis by ID
        analysis = await dda_service.get_analysis_by_id(
            user_id=current_user.id,
            result_id=result_id
        )
        
        if analysis is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"DDA analysis with ID {result_id} not found"
            )
        
        logger.info(f"[DDA] Successfully retrieved analysis {result_id}")
        return {"analysis": analysis}
        
    except HTTPException:
        raise
    except ServiceError as e:
        logger.error(f"[DDA] Service error getting analysis by ID: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"[DDA] Unexpected error getting analysis by ID: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get DDA analysis: {str(e)}",
        )


@router.post("/history/save", response_model=dict)
async def save_dda_history(
    history_entry: dict,
    current_user: User = Depends(get_current_user),
    dda_service: DDAService = Depends(get_service(DDAService)),
) -> dict:
    """Save a DDA analysis result to history."""
    try:
        logger.info(f"[DDA] Saving history entry for user {current_user.id}")
        logger.info(f"[DDA] History entry data: {list(history_entry.keys()) if isinstance(history_entry, dict) else type(history_entry)}")
        
        # Save the history entry
        saved_entry = await dda_service.save_analysis_history(
            user_id=current_user.id,
            history_entry=history_entry
        )
        
        logger.info(f"[DDA] Successfully saved history entry with ID: {saved_entry.get('id')}")
        return {
            "status": "success",
            "message": "DDA history saved successfully",
            "id": saved_entry.get("id")
        }
    except ServiceError as e:
        logger.error(f"[DDA] Service error saving history: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        logger.error(f"[DDA] Unexpected error saving history: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save DDA history: {str(e)}",
        )
