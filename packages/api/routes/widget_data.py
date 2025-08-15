"""Routes for managing widget data storage."""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from loguru import logger

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services.widget_data_service import WidgetDataService

router = APIRouter()


@router.post("", response_model=Dict[str, Any])
async def store_widget_data(
    request: Dict[str, Any],
    current_user: User = Depends(get_current_user),
    data_service: WidgetDataService = Depends(get_service(WidgetDataService)),
):
    """
    Store widget data server-side for large datasets that exceed localStorage quotas.
    """
    try:
        data_key = request.get("key")
        widget_data = request.get("data")
        widget_id = request.get("widgetId")

        if not data_key or not widget_data or not widget_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing required fields: key, data, or widgetId",
            )

        # Store the data
        await data_service.store_widget_data(
            user_id=current_user.id,
            data_key=data_key,
            widget_data=widget_data,
            widget_id=widget_id,
            metadata=request.get("metadata", {}),
        )

        logger.info(
            f"Stored widget data for user {current_user.id}, widget {widget_id}"
        )

        return {
            "status": "success",
            "message": "Data stored successfully",
            "dataKey": data_key,
        }

    except ValueError as ve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(ve),
        )
    except Exception as e:
        logger.error(
            f"Failed to store widget data for user {current_user.id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to store widget data: {str(e)}",
        )


@router.get("/{data_key}", response_model=Dict[str, Any])
async def get_widget_data(
    data_key: str,
    current_user: User = Depends(get_current_user),
    data_service: WidgetDataService = Depends(get_service(WidgetDataService)),
):
    """
    Retrieve widget data by key.
    """
    try:
        widget_data = await data_service.get_widget_data(
            user_id=current_user.id,
            data_key=data_key,
        )

        if not widget_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Data not found",
            )

        logger.info(f"Retrieved widget data for user {current_user.id}, key {data_key}")

        return {
            "status": "success",
            "message": "Data retrieved successfully",
            "data": widget_data,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to retrieve widget data for user {current_user.id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve widget data: {str(e)}",
        )


@router.delete("/{data_key}", response_model=Dict[str, Any])
async def delete_widget_data(
    data_key: str,
    current_user: User = Depends(get_current_user),
    data_service: WidgetDataService = Depends(get_service(WidgetDataService)),
):
    """
    Delete widget data by key.
    """
    try:
        deleted = await data_service.delete_widget_data(
            user_id=current_user.id,
            data_key=data_key,
        )

        if not deleted:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Data not found",
            )

        logger.info(f"Deleted widget data for user {current_user.id}, key {data_key}")

        return {
            "status": "success",
            "message": "Data deleted successfully",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Failed to delete widget data for user {current_user.id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete widget data: {str(e)}",
        )
