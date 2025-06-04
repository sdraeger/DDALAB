"""Favorite files management endpoints."""

from core.auth import get_current_user
from core.dependencies import get_service
from core.files import validate_file_path
from core.services import FavoriteFilesService
from fastapi import APIRouter, Depends, HTTPException
from schemas.favorite_files import ToggleFavoriteResponse
from schemas.user import User

router = APIRouter()


@router.post("/toggle", response_model=ToggleFavoriteResponse)
async def toggle_favorite_file(
    file_path: str,
    user: User = Depends(get_current_user),
    favorite_files_service: FavoriteFilesService = Depends(
        get_service(FavoriteFilesService)
    ),
) -> ToggleFavoriteResponse:
    file_valid = await validate_file_path(file_path)

    if not file_valid:
        raise HTTPException(status_code=400, detail="Invalid file path")

    success = await favorite_files_service.toggle_favorite(user.id, file_path)

    return ToggleFavoriteResponse(success=success, file_path=file_path)
