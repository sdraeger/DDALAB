"""File management endpoints."""

from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..core.config import get_data_settings
from ..core.files import get_available_files, list_directory, validate_file_path
from ..core.utils.file import is_path_allowed
from ..core.utils.utils import calculate_file_hash
from ..schemas.files import FileList

router = APIRouter()


@router.get("/", response_model=FileList)
async def list_files() -> FileList:
    """List all available EDF files.

    Returns:
        List of available file paths
    """
    try:
        files = await get_available_files()
        return FileList(files=files)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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


@router.get("/list/{path:path}")
async def list_directory_endpoint(path: str = "") -> List[Dict[str, str]]:
    """List files and directories in a specific path.

    Args:
        path: Path relative to the data directory

    Returns:
        List of dictionaries containing file/directory information
    """
    try:
        if not is_path_allowed(path):
            raise HTTPException(
                status_code=403, detail="Access to this directory is forbidden"
            )
        return await list_directory(path)
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

        settings = get_data_settings()
        full_path = Path(settings.data_dir) / file_path
        if not await validate_file_path(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        file_hash = calculate_file_hash(full_path)
        return {"hash": file_hash}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{file_path:path}")
async def download_file(file_path: str, client_hash: Optional[str] = None):
    """Download a file with optional hash verification.

    Args:
        file_path: Path to the file relative to the data directory
        client_hash: Optional hash from client's cached version

    Returns:
        FileResponse or JSONResponse: File download or hash match response
    """
    try:
        if not is_path_allowed(file_path):
            raise HTTPException(
                status_code=403, detail="Access to this directory is forbidden"
            )

        settings = get_data_settings()
        if not await validate_file_path(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        full_path = Path(settings.data_dir) / file_path

        # Calculate file hash
        file_hash = calculate_file_hash(full_path)

        # If client provided a hash and it matches, return 304 Not Modified
        if client_hash and client_hash == file_hash:
            return JSONResponse(
                content={"message": "File unchanged", "hash": file_hash},
                status_code=304,
            )

        # Return file with hash in headers
        return FileResponse(
            path=full_path, headers={"X-File-Hash": file_hash}, filename=full_path.name
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
