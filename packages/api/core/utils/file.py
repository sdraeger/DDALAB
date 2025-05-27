from pathlib import Path

from fastapi import HTTPException

from ..config import get_server_settings

settings = get_server_settings()


def is_path_allowed(requested_path: str | Path) -> Path:
    """Validate that the requested path is within an allowed directory."""
    absolute_path = Path(requested_path).resolve()  # Resolve symlinks, ../, etc.

    for allowed_dir in settings.allowed_dirs:
        if str(absolute_path).startswith(allowed_dir):
            if not absolute_path.exists():
                raise HTTPException(status_code=404, detail="File not found")
            return absolute_path

    raise HTTPException(status_code=403, detail="Access to this directory is forbidden")
