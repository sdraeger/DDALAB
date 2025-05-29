"""Core file management functionality."""

import datetime
from typing import List

from loguru import logger

from ..core.config import get_data_settings
from ..core.utils import is_path_allowed
from ..schemas.files import FileInfo

settings = get_data_settings()


async def validate_file_path(file_path: str) -> bool:
    """Check if a file exists in an allowed directory.

    Args:
        file_path: Absolute path to the file

    Returns:
        True if file exists, False otherwise
    """
    try:
        file_path_obj = is_path_allowed(file_path)
        return file_path_obj.exists() and file_path_obj.is_file()
    except Exception:
        return False


async def list_directory(path: str = "") -> List[FileInfo]:
    """List files and directories in a specific path.

    Args:
        path: Absolute path to the directory to list

    Returns:
        List of dictionaries containing file/directory information
    """
    logger.info(f"[Files] list_directory called with path: '{path}'")

    try:
        # Validate that the requested path is allowed
        target_dir = is_path_allowed(path)

        if not target_dir.is_dir():
            logger.warning(f"Requested path is not a directory: {path}")
            return []

        logger.info(f"Listing directory: {target_dir}")

        items = []
        for item in target_dir.iterdir():
            file_stat = item.stat()
            last_modified = datetime.datetime.fromtimestamp(
                file_stat.st_mtime
            ).isoformat()
            file_size = file_stat.st_size if item.is_file() else None

            file_info = FileInfo(
                name=item.name,
                path=str(item),
                is_directory=item.is_dir(),
                size=file_size,
                is_favorite=False,
                last_modified=str(last_modified),
            )
            items.append(file_info)

        return sorted(items, key=lambda x: (not x.is_directory, x.name.lower()))
    except Exception as e:
        logger.error(f"Error listing directory '{path}': {e}")
        return []
