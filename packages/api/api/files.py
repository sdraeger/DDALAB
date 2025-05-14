"""File management endpoints."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from ..core.auth import get_current_user
from ..core.config import get_data_settings
from ..core.dependencies import get_service
from ..core.files import list_directory as list_directory_core
from ..core.files import validate_file_path
from ..core.services import FavoriteFilesService
from ..core.utils import calculate_file_hash, is_path_allowed
from ..schemas.files import FileListResponse
from ..schemas.user import User

router = APIRouter()
settings = get_data_settings()


@router.get("/{file_path:path}/exists")
async def check_file_exists(file_path: str) -> bool:
    """Check if a file exists.

    Args:
        file_path: Path to the file to check

    Returns:
        True if file exists, False otherwise
    """
    try:
        if not is_path_allowed(file_path):
            raise HTTPException(
                status_code=403, detail="Access to this directory is forbidden"
            )
        return await validate_file_path(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/hash/{file_path:path}")
async def get_file_hash(file_path: str):
    """Get the hash of a file without downloading it.

    Args:
        file_path: Path to the file relative to the data directory

    Returns:
        dict: Contains the file hash
    """
    try:
        if not is_path_allowed(file_path):
            raise HTTPException(
                status_code=403, detail="Access to this directory is forbidden"
            )

        full_path = Path(settings.data_dir) / file_path
        if not await validate_file_path(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        file_hash = calculate_file_hash(full_path)
        return {"hash": file_hash}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=FileListResponse)
async def list_directory(
    path: str = "/",
    user: User = Depends(get_current_user),
    favorite_files_service: FavoriteFilesService = Depends(
        get_service(FavoriteFilesService)
    ),
) -> FileListResponse:
    items = await list_directory_core(path)
    favorite_files = []

    try:
        favorites = await favorite_files_service.get_favorites(user.id)
        favorite_files = [fav.file_path for fav in favorites]
    except Exception as e:
        logger.error(f"Error fetching favorite files: {e}")

    file_info_list = []
    for item in items:
        is_favorite = item.path in favorite_files
        file_info = item
        file_info.is_favorite = is_favorite
        file_info_list.append(file_info)

    logger.debug(f"File info list: {file_info_list}")

    return FileListResponse(files=file_info_list)
