"""File management endpoints."""

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from loguru import logger

from ..core.auth import get_current_user
from ..core.config import get_data_settings
from ..core.dependencies import get_service
from ..core.files import list_directory as list_directory_core
from ..core.files import validate_file_path
from ..core.services import FavoriteFilesService
from ..core.utils import calculate_file_hash, is_path_allowed
from ..schemas.files import FileListResponse, FileUploadResponse
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


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    target_path: str = Form(...),
    _: User = Depends(get_current_user),
) -> FileUploadResponse:
    """Upload a file to a specific directory.

    Args:
        file: The file to upload
        target_path: Absolute path to the target directory
        user: Current authenticated user

    Returns:
        dict: Success message and file path
    """
    try:
        logger.info(
            f"Upload request - target_path: {target_path}, filename: {file.filename}"
        )

        # Validate that the target directory is allowed and exists
        try:
            target_dir = is_path_allowed(target_path)
        except HTTPException as e:
            logger.error(
                f"Path validation failed - target_path: {target_path}, error: {e.detail}"
            )
            raise HTTPException(
                status_code=403,
                detail=f"Access to directory '{target_path}' is forbidden",
            )

        if not target_dir.is_dir():
            raise HTTPException(status_code=404, detail="Target directory not found")

        # Check file extension
        allowed_extensions = {".edf", ".ascii"}
        file_extension = Path(file.filename or "").suffix.lower()
        if file_extension not in allowed_extensions:
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Only {', '.join(allowed_extensions)} files are supported.",
            )

        # Ensure filename is safe
        if not file.filename:
            raise HTTPException(status_code=400, detail="Filename is required")

        # Create the target file path
        target_file_path = target_dir / file.filename

        # Check if file already exists
        if target_file_path.exists():
            raise HTTPException(
                status_code=409,
                detail=f"File '{file.filename}' already exists in the target directory",
            )

        # Save the uploaded file
        with open(target_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        logger.info(f"File uploaded successfully: {target_file_path}")

        return FileUploadResponse(
            success=True,
            message="File uploaded successfully",
            file_path=str(target_file_path),
        )

    except Exception as e:
        logger.error(f"Error uploading file: {e}")
        raise HTTPException(status_code=500, detail=str(e))
