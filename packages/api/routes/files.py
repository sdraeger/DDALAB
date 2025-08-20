"""File management endpoints."""

import shutil
from pathlib import Path

from core.auth import get_current_user
from core.dependencies import get_service
from core.services import FavoriteFilesService, FileService
from core.utils import calculate_file_hash, is_path_allowed
from core.environment import get_config_service
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from loguru import logger
from schemas.files import FileListResponse, FileUploadResponse
from schemas.user import User
from typing import List

router = APIRouter()


@router.get("/roots")
async def get_allowed_roots():
    """Return the list of allowed root directories (relative to the data directory)."""
    storage_settings = get_config_service().get_storage_settings()
    data_dir = Path(storage_settings.data_dir).resolve()

    roots: list[dict] = []
    for raw_path in storage_settings.allowed_dirs:
        try:
            abs_path = Path(raw_path).resolve()
            
            # Calculate relative path, using empty string for data_dir itself
            if abs_path == data_dir:
                rel_path = ""
                name = "data"  # Use a friendly name for the root
            else:
                rel_path = str(abs_path.relative_to(data_dir))
                name = abs_path.name
                
            roots.append(
                {
                    "name": name,
                    "relative_path": rel_path,
                }
            )
        except Exception:
            # Skip paths not under data_dir
            continue

    roots = sorted(roots, key=lambda r: r["name"].lower())
    default_relative_path = roots[0]["relative_path"] if roots else ""
    return {"roots": roots, "default_relative_path": default_relative_path}


@router.get("/{file_path:path}/exists")
async def check_file_exists(
    file_path: str,
    file_service: FileService = Depends(get_service(FileService)),
) -> bool:
    """Check if a file exists.

    Args:
        file_path: Path to the file to check

    Returns:
        True if file exists, False otherwise
    """
    try:
        await file_service.validate_file_path(file_path)
        return True
    except Exception:
        return False


@router.get("/hash/{file_path:path}")
async def get_file_hash(
    file_path: str,
    file_service: FileService = Depends(get_service(FileService)),
):
    """Get the hash of a file without downloading it.

    Args:
        file_path: Path to the file relative to the data directory

    Returns:
        dict: Contains the file hash
    """
    try:
        full_path = await file_service.validate_file_path(file_path)
        file_hash = calculate_file_hash(Path(full_path))
        return {"hash": file_hash}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=FileListResponse)
async def list_directory(
    path: str = "",
    user: User = Depends(get_current_user),
    file_service: FileService = Depends(get_service(FileService)),
    favorite_files_service: FavoriteFilesService = Depends(
        get_service(FavoriteFilesService)
    ),
) -> FileListResponse:
    """List files in a directory.

    Args:
        path: Path to list
        user: Current user
        file_service: File service
        favorite_files_service: Favorite files service

    Returns:
        List of files and directories
    """
    try:
        # Let the file service and permission logic handle path validation
        # Empty string is now allowed and represents the data directory root
        items = await file_service.list_directory(path)
        favorite_files = []

        try:
            favorites = await favorite_files_service.get_favorites(user.id)
            favorite_files = [fav.file_path for fav in favorites]
        except Exception as e:
            logger.error(f"Error fetching favorite files: {e}")

        storage_settings = get_config_service().get_storage_settings()
        data_dir = Path(storage_settings.data_dir).resolve()

        file_info_list = []
        for item in items:
            # Convert absolute container path to relative path under data_dir
            try:
                relative_path = str(Path(item.path).resolve().relative_to(data_dir))
            except Exception:
                # If not under data_dir, skip (should not happen with proper mounts)
                continue
            is_favorite = item.path in favorite_files
            file_info = item
            file_info.path = relative_path
            file_info.is_favorite = is_favorite
            file_info_list.append(file_info)

        return FileListResponse(files=file_info_list)
    except Exception as e:
        logger.error(f"Error listing directory: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/search")
async def search_files(
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, description="Maximum number of results"),
    user: User = Depends(get_current_user),
    file_service: FileService = Depends(get_service(FileService)),
):
    """Search for files and directories.
    
    Args:
        q: Search query
        limit: Maximum number of results to return
        user: Current authenticated user
        file_service: File service
        
    Returns:
        List of matching files and directories
    """
    try:
        storage_settings = get_config_service().get_storage_settings()
        data_dir = Path(storage_settings.data_dir).resolve()
        
        results = []
        
        # Search in all allowed directories
        for allowed_dir in storage_settings.allowed_dirs:
            try:
                search_dir = Path(allowed_dir).resolve()
                if not search_dir.exists() or not search_dir.is_dir():
                    continue
                    
                # Recursively search for files matching the query
                for file_path in search_dir.rglob("*"):
                    if len(results) >= limit:
                        break
                        
                    # Skip if filename doesn't contain the search query
                    if q.lower() not in file_path.name.lower():
                        continue
                        
                    try:
                        # Convert to relative path
                        relative_path = str(file_path.relative_to(data_dir))
                        
                        results.append({
                            "name": file_path.name,
                            "path": relative_path,
                            "is_directory": file_path.is_dir()
                        })
                    except ValueError:
                        # Skip files not under data_dir
                        continue
                        
            except Exception as e:
                logger.warning(f"Error searching in directory {allowed_dir}: {e}")
                continue
                
        # Sort results by relevance (exact matches first, then partial matches)
        results.sort(key=lambda x: (
            not x["name"].lower().startswith(q.lower()),  # Exact prefix matches first
            x["name"].lower()
        ))
        
        return {"files": results[:limit]}
        
    except Exception as e:
        logger.error(f"Error searching files: {e}")
        raise HTTPException(status_code=500, detail=str(e))
