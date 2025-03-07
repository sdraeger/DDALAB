"""File management endpoints."""

from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException

from ..core.files import get_available_files, validate_file_path
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
