from typing import List

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel

from ..core.auth import get_current_user
from ..core.database import User

router = APIRouter()


class Layout(BaseModel):
    i: str
    x: int
    y: int
    w: int
    h: int


class LayoutRequest(BaseModel):
    layouts: List[Layout]


@router.post("")
async def save_layout(
    request: LayoutRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Save user-specific plot layouts.
    """
    try:
        # Example: Save layouts to a user_layouts table
        # For simplicity, print to console (replace with DB logic)
        logger.info(f"Saving layouts for user {current_user.id}: {request.layouts}")
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save layout: {str(e)}")
