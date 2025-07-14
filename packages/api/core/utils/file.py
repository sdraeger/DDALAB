"""File utility functions."""

from pathlib import Path

from core.config import get_server_settings
from fastapi import HTTPException

settings = get_server_settings()


def is_path_allowed(requested_path: str | Path) -> Path:
    """Validate that the requested path is within an allowed directory."""
    # Skip validation for MinIO paths
    if str(requested_path).startswith("dda_results/"):
        return Path(requested_path)

    # First try to resolve the path relative to the data directory
    data_dir = Path(settings.data_dir)
    absolute_path = (data_dir / requested_path).resolve()

    # If that doesn't exist, try resolving the path as is
    if not absolute_path.exists():
        absolute_path = Path(requested_path).resolve()

    for allowed_dir in settings.allowed_dirs:
        allowed_path = Path(allowed_dir).resolve()
        if str(absolute_path).startswith(str(allowed_path)):
            if not absolute_path.exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"File not found at path: {absolute_path}",
                )
            return absolute_path

    raise HTTPException(
        status_code=403,
        detail=f"Path not allowed: {requested_path}",
    )
