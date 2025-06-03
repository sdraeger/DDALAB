from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from ..core.auth import get_current_user
from ..core.database import User
from ..core.dependencies import get_service
from ..core.services import LayoutService
from ..schemas.layout import Layout, LayoutRequest, LayoutResponse

router = APIRouter()


@router.post("", response_model=LayoutResponse)
async def save_layout(
    request: LayoutRequest,
    current_user: User = Depends(get_current_user),
    layout_service: LayoutService = Depends(get_service(LayoutService)),
):
    """
    Save user-specific plot layouts in the user_layouts table.
    """
    try:
        # Convert Pydantic models to dictionaries for the service layer
        layout_dicts = [layout.model_dump() for layout in request.layouts]
        await layout_service.save_user_layouts(current_user.id, layout_dicts)
        logger.info(f"Saved layout for user {current_user.id}")
        return {"status": "success", "message": "Layout saved successfully"}

    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        logger.error(f"Failed to save layout for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save layout: {str(e)}",
        )


@router.get("", response_model=List[Layout])
async def get_layout(
    current_user: User = Depends(get_current_user),
    layout_service: LayoutService = Depends(get_service(LayoutService)),
):
    """
    Retrieve user-specific plot layouts.
    """
    try:
        layout_dicts = await layout_service.get_user_layouts(current_user.id)
        # Convert dictionaries back to Pydantic models for the response
        layouts = [Layout(**layout_dict) for layout_dict in layout_dicts]
        logger.info(f"Retrieved layout for user {current_user.id}")
        return layouts

    except Exception as e:
        logger.error(f"Failed to retrieve layout for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve layout: {str(e)}",
        )


@router.delete("", response_model=LayoutResponse)
async def delete_layout(
    current_user: User = Depends(get_current_user),
    layout_service: LayoutService = Depends(get_service(LayoutService)),
):
    """
    Delete user-specific plot layouts.
    """
    try:
        deleted_layout = await layout_service.delete_user_layouts(current_user.id)
        if deleted_layout:
            logger.info(f"Deleted layout for user {current_user.id}")
            return {"status": "success", "message": "Layout deleted successfully"}
        else:
            return {"status": "success", "message": "No layout found to delete"}

    except Exception as e:
        logger.error(f"Failed to delete layout for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete layout: {str(e)}",
        )
