"""File management endpoints."""

from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..core.config import get_data_settings
from ..core.files import get_available_files, list_directory, validate_file_path
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
        return await list_directory(path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{file_path:path}")
async def download_file(file_path: str):
    """Download a file from the server.

    Args:
        file_path: Path to the file to download

    Returns:
        FileResponse containing the file data
    """
    try:
        if not await validate_file_path(file_path):
            raise HTTPException(status_code=404, detail="File not found")

        settings = get_data_settings()
        data_dir = Path(settings.data_dir)
        full_path = data_dir / file_path

        return FileResponse(
            path=full_path,
            filename=full_path.name,
            media_type="application/octet-stream",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
