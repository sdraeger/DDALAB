"""Routes for managing notifications and system status."""

from typing import List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services.notification_service import NotificationService


router = APIRouter(tags=["notifications"])


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: str
    type: str
    category: str
    timestamp: str
    read: bool
    action_text: str = None
    action_url: str = None
    metadata: Dict[str, Any] = {}


class MarkAsReadRequest(BaseModel):
    notification_id: str


@router.get("", response_model=List[NotificationResponse])
async def get_notifications(
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Get all notifications for the current user."""
    try:
        notifications = await notification_service.get_notifications(current_user.id)
        return [NotificationResponse(**notification) for notification in notifications]
    except Exception as e:
        logger.error(f"Failed to get notifications: {e}")
        raise HTTPException(status_code=500, detail="Failed to get notifications")


@router.get("/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Get count of unread notifications."""
    try:
        count = await notification_service.get_unread_count()
        return {"count": count}
    except Exception as e:
        logger.error(f"Failed to get unread count: {e}")
        raise HTTPException(status_code=500, detail="Failed to get unread count")


@router.post("/mark-read")
async def mark_notification_as_read(
    request: MarkAsReadRequest,
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Mark a notification as read."""
    try:
        success = await notification_service.mark_as_read(request.notification_id)
        if not success:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to mark notification as read: {e}")
        raise HTTPException(status_code=500, detail="Failed to mark notification as read")


@router.post("/mark-all-read")
async def mark_all_notifications_as_read(
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Mark all notifications as read."""
    try:
        count = await notification_service.mark_all_as_read()
        return {"success": True, "marked_count": count}
    except Exception as e:
        logger.error(f"Failed to mark all notifications as read: {e}")
        raise HTTPException(status_code=500, detail="Failed to mark all notifications as read")


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Delete a notification."""
    try:
        success = await notification_service.delete_notification(notification_id)
        if not success:
            raise HTTPException(status_code=404, detail="Notification not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete notification: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete notification")


@router.post("/start-monitoring")
async def start_monitoring(
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Start notification monitoring."""
    try:
        await notification_service.start_monitoring()
        return {"success": True, "message": "Monitoring started"}
    except Exception as e:
        logger.error(f"Failed to start monitoring: {e}")
        raise HTTPException(status_code=500, detail="Failed to start monitoring")


@router.post("/stop-monitoring")
async def stop_monitoring(
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Stop notification monitoring."""
    try:
        await notification_service.stop_monitoring()
        return {"success": True, "message": "Monitoring stopped"}
    except Exception as e:
        logger.error(f"Failed to stop monitoring: {e}")
        raise HTTPException(status_code=500, detail="Failed to stop monitoring")


@router.get("/system-status")
async def get_system_status(
    current_user: User = Depends(get_current_user),
    notification_service: NotificationService = Depends(get_service(NotificationService)),
):
    """Get current system status for status bar."""
    try:
        status = await notification_service.get_system_status()
        return status
    except Exception as e:
        logger.error(f"Failed to get system status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get system status")