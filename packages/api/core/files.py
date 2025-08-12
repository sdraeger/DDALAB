"""Core file management functionality."""

import datetime
from pathlib import Path
from typing import List

import pyedflib
from core.utils import is_path_allowed
from fastapi import HTTPException
from loguru import logger
from schemas.files import FileInfo


async def validate_file_path(file_path: str | Path) -> str:
    """Validate that the file path is within the allowed directories.

    Args:
        file_path: Absolute path to the file or directory

    Returns:
        Validated file path

    Raises:
        HTTPException: If the path is not found or not allowed
    """
    try:
        resolved_path = is_path_allowed(file_path)
        if not resolved_path.exists():
            raise HTTPException(status_code=404, detail=f"Path not found: {file_path}")

        return str(resolved_path)
    except Exception as e:
        logger.error(f"Error validating path '{file_path}': {e}")
        raise HTTPException(
            status_code=500, detail=f"Could not validate path: {file_path}"
        ) from e


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


def read_edf_header(file_path: str) -> dict:
    """Reads the main header information from an EDF or BDF file.

    Args:
        file_path: The path to the EDF or BDF file.

    Returns:
        A dictionary containing key header information.

    Raises:
        HTTPException: If the file cannot be read or is not a valid EDF/BDF file.
    """
    try:
        with pyedflib.EdfReader(file_path) as f:
            # Most essential header info. n_samples is a list, but for most EDF/BDF
            # files, the number of samples is the same for all signals.
            header = {
                "n_channels": f.signals_in_file,
                "n_samples": f.getNSamples()[0],
                "duration": f.file_duration,
                "start_datetime": f.getStartdatetime(),
                "sample_frequency": f.getSampleFrequency(0),
            }
            return header
    except Exception as e:
        logger.error(f"Failed to read EDF header for '{file_path}': {e}")
        raise HTTPException(
            status_code=500, detail=f"Could not read header for file: {file_path}"
        ) from e
