"""File management functionality."""

import os
from pathlib import Path
from typing import List

import aiofiles
import aiofiles.os

from ..config import get_settings


async def get_available_files() -> List[str]:
    """Get list of available EDF files.

    Returns:
        List of file paths relative to the data directory
    """
    settings = get_settings()
    data_dir = Path(settings.data_dir)

    files = []
    async for entry in aiofiles.os.scandir(data_dir):
        if entry.name.endswith(".edf"):
            rel_path = Path(entry.path).relative_to(data_dir)
            files.append(str(rel_path))

    return sorted(files)


async def validate_file_path(file_path: str) -> bool:
    """Check if a file exists and is accessible.

    Args:
        file_path: Path to the file to check

    Returns:
        True if file exists and is accessible
    """
    settings = get_settings()
    full_path = Path(settings.data_dir) / file_path

    try:
        return await aiofiles.os.path.exists(full_path)
    except Exception:
        return False
