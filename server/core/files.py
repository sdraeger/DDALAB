"""Core file management functionality."""

import os
from pathlib import Path
from typing import Dict, List

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


async def list_directory(path: str = "") -> List[Dict[str, str]]:
    """List files and directories in a specific path.

    Args:
        path: Path relative to the data directory

    Returns:
        List of dictionaries containing file/directory information
    """
    settings = get_data_settings()
    data_dir = Path(settings.data_dir).resolve()  # Get absolute path

    target_dir = data_dir / path if path else data_dir

    try:
        # Verify target_dir is within data_dir
        target_dir = target_dir.resolve()
        if not str(target_dir).startswith(str(data_dir)):
            return []

        if not target_dir.exists() or not target_dir.is_dir():
            return []

        items = []
        for item in target_dir.iterdir():
            if item.is_file() and item.suffix == ".edf":
                # Get relative path from data directory
                rel_path = str(item.relative_to(data_dir))
                items.append({"name": item.name, "path": rel_path, "type": "file"})
            elif item.is_dir():
                # Get relative path from data directory
                rel_path = str(item.relative_to(data_dir))
                items.append({"name": item.name, "path": rel_path, "type": "directory"})

        return sorted(items, key=lambda x: (x["type"] == "file", x["name"]))
    except Exception:
        return []
