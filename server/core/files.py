"""Core file management functionality."""

import datetime
from pathlib import Path
from typing import List

from loguru import logger

from ..core.config import get_data_settings
from ..schemas.files import FileInfo

settings = get_data_settings()


async def validate_file_path(file_path: str) -> bool:
    """Check if a file exists in the data directory.

    Args:
        file_path: Path to the file relative to the data directory

    Returns:
        True if file exists, False otherwise
    """

    data_dir = Path(settings.data_dir)
    full_path = data_dir / file_path

    return full_path.exists() and full_path.is_file()


async def list_directory(path: str = "") -> List[FileInfo]:
    """List files and directories in a specific path.

    Args:
        path: Path relative to the data directory

    Returns:
        List of dictionaries containing file/directory information
    """

    data_dir = Path(settings.data_dir).resolve()  # Get absolute path
    target_dir = data_dir / path if path else data_dir

    logger.info(f"Data dir: {data_dir}")
    logger.info(f"Target dir: {target_dir}")

    try:
        # Verify target_dir is within data_dir
        target_dir = target_dir.resolve()
        logger.info(f"{(not str(target_dir).startswith(str(data_dir))) = }")
        logger.info(f"{(not (target_dir.exists() and target_dir.is_dir())) = }")

        if not str(target_dir).startswith(str(data_dir)):
            return []

        if not (target_dir.exists() and target_dir.is_dir()):
            return []

        items = []
        logger.info(f"{list(target_dir.iterdir()) = }")
        for item in target_dir.iterdir():
            rel_path = str(item.relative_to(data_dir))
            file_stat = item.stat()
            last_modified = datetime.datetime.fromtimestamp(
                file_stat.st_mtime
            ).isoformat()
            file_size = file_stat.st_size if item.is_file() else None

            item = FileInfo(
                name=item.name,
                path=rel_path,
                is_directory=item.is_dir(),
                size=file_size,
                is_favorite=False,
                last_modified=str(last_modified),
            )
            items.append(item)

        return sorted(items, key=lambda x: (not x.is_directory, x.name.lower()))
    except Exception as e:
        logger.error(f"Error listing directory: {e}")
        return []
