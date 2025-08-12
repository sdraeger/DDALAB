"""File utility functions."""

from pathlib import Path

from core.environment import get_config_service
from fastapi import HTTPException

storage_settings = get_config_service().get_storage_settings()


def is_path_allowed(requested_path: str | Path) -> Path:
    """Validate that the requested path is within an allowed directory.

    Contract:
    - requested_path must be a path relative to data_dir or a full path within one of the mounted allowed_dirs
    - Root ("" or "/") is forbidden to prevent leaking host paths
    - Returns a resolved absolute Path within the container
    """
    # Skip validation for MinIO paths
    if str(requested_path).startswith("dda_results/"):
        return Path(requested_path)

    # Disallow empty, root, or current-dir marker
    if str(requested_path).strip() in {"", "/", "."}:
        raise HTTPException(
            status_code=403, detail="Path not allowed: root is forbidden"
        )

    data_dir = Path(storage_settings.data_dir).resolve()

    # Always interpret requested_path relative to data_dir first
    rel = str(requested_path).strip()
    # Normalize leading './'
    if rel.startswith("./"):
        rel = rel[2:]
    # Normalize '.' alone
    if rel == ".":
        raise HTTPException(
            status_code=403, detail="Path not allowed: '.' is forbidden"
        )
    candidate = (data_dir / rel.lstrip("/ ")).resolve()

    # Validate candidate is under one of the allowed directories
    for allowed_dir in storage_settings.allowed_dirs:
        allowed_path = Path(allowed_dir).resolve()
        try:
            # If candidate is under allowed_path, accept
            candidate.relative_to(allowed_path)
            if not candidate.exists():
                raise HTTPException(
                    status_code=404,
                    detail=f"File not found at path: {candidate}",
                )
            return candidate
        except Exception:
            continue

    raise HTTPException(
        status_code=403,
        detail=f"Path not allowed: {requested_path}",
    )
