"""Routes for managing widget layouts."""

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import WidgetLayoutService
from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger
from schemas.widget_layout import (
    SaveWidgetLayoutRequest as WidgetLayoutCreate,
)
from schemas.widget_layout import (
    WidgetLayoutData,
)
from schemas.widget_layout import (
    WidgetLayoutResponse as WidgetLayout,
)

router = APIRouter()


@router.post("", response_model=WidgetLayout)
async def save_widget_layout(
    request: WidgetLayoutCreate,
    current_user: User = Depends(get_current_user),
    layout_service: WidgetLayoutService = Depends(get_service(WidgetLayoutService)),
):
    """
    Save user-specific widget layouts in the user_layouts table.
    """
    try:
        # Convert widget layout data to dictionaries for the service layer
        widget_dicts = [widget.model_dump() for widget in request.widgets]
        # Pass both widgets and layout to the service
        await layout_service.save_user_layouts(
            current_user.id, widget_dicts, request.layout or []
        )
        logger.info(
            f"Saved widget layout for user {current_user.id} with {len(widget_dicts)} widgets"
        )
        return WidgetLayout(
            status="success",
            message="Widget layout saved successfully",
            widgets=request.widgets,
            layout=request.layout,
        )

    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        logger.error(
            f"Failed to save widget layout for user {current_user.id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save widget layout: {str(e)}",
        )


@router.get("", response_model=WidgetLayout)
async def get_widget_layout(
    current_user: User = Depends(get_current_user),
    layout_service: WidgetLayoutService = Depends(get_service(WidgetLayoutService)),
):
    """
    Retrieve user-specific widget layouts.
    """
    try:
        data = await layout_service.get_user_layouts(current_user.id)
        # Ensure types are correct even if legacy data exists
        raw_widgets = data.get("widgets", [])
        raw_layout = data.get("layout", [])
        if not isinstance(raw_widgets, list):
            raw_widgets = []
        if not isinstance(raw_layout, list):
            raw_layout = []
        widgets = [WidgetLayoutData(**widget_dict) for widget_dict in raw_widgets]
        layout = raw_layout
        logger.info(
            f"Retrieved widget layout for user {current_user.id} with {len(widgets)} widgets"
        )
        return WidgetLayout(
            status="success",
            message="Widget layout retrieved successfully",
            widgets=widgets,
            layout=layout,
        )

    except Exception as e:
        logger.error(
            f"Failed to retrieve widget layout for user {current_user.id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve widget layout: {str(e)}",
        )


@router.delete("", response_model=WidgetLayout)
async def delete_widget_layout(
    current_user: User = Depends(get_current_user),
    layout_service: WidgetLayoutService = Depends(get_service(WidgetLayoutService)),
):
    """
    Delete user-specific widget layouts.
    """
    try:
        deleted_layout = await layout_service.delete_user_layouts(current_user.id)
        if deleted_layout:
            logger.info(f"Deleted widget layout for user {current_user.id}")
            return WidgetLayout(
                status="success",
                message="Widget layout deleted successfully",
                widgets=[],
            )
        else:
            return WidgetLayout(
                status="success", message="No widget layout found to delete", widgets=[]
            )

    except Exception as e:
        logger.error(
            f"Failed to delete widget layout for user {current_user.id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete widget layout: {str(e)}",
        )
