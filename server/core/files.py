"""Core file management functionality."""

import os
from pathlib import Path
from typing import List

from ..core.config import get_data_settings


async def get_available_files() -> List[str]:
    """Get list of available files in the data directory.

    Returns:
        List of file paths relative to the data directory
    """
    settings = get_data_settings()
    data_dir = Path(settings.data_dir)

    if not data_dir.exists():
        return []

    files = []
    for root, _, filenames in os.walk(data_dir):
        for filename in filenames:
            if filename.endswith(".edf"):  # Add other extensions as needed
                rel_path = os.path.relpath(os.path.join(root, filename), data_dir)
                files.append(rel_path)

    return sorted(files)


async def validate_file_path(file_path: str) -> bool:
    """Check if a file exists in the data directory.

    Args:
        file_path: Path to the file relative to the data directory

    Returns:
        True if file exists, False otherwise
    """
    settings = get_data_settings()
    data_dir = Path(settings.data_dir)
    full_path = data_dir / file_path

    return full_path.exists() and full_path.is_file()
