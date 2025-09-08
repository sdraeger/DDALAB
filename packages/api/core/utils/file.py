"""File utility functions."""

import os
from pathlib import Path

from core.environment import get_config_service
from fastapi import HTTPException

storage_settings = get_config_service().get_storage_settings()


def is_path_allowed(requested_path: str | Path) -> Path:
    """Validate that the requested path is within an allowed directory.

    Contract:
    - requested_path can be empty string (represents data_dir root) or a relative path under data_dir
    - Absolute root paths like "/" are forbidden to prevent leaking host paths
    - Returns a resolved absolute Path within the container
    """
    # Skip validation for MinIO paths
    if str(requested_path).startswith("dda_results/"):
        return Path(requested_path)

    data_dir = Path(storage_settings.data_dir).resolve()
    requested_str = str(requested_path).strip()
    
    # Disallow absolute root paths that could leak host filesystem
    if requested_str == "/":
        raise HTTPException(
            status_code=403, detail="Path not allowed: absolute root is forbidden"
        )
    
    # Check if the requested path is an absolute path that matches an allowed directory
    if requested_str and os.path.isabs(requested_str):
        requested_abs = Path(requested_str).resolve()
        for allowed_dir in storage_settings.allowed_dirs:
            allowed_path = Path(allowed_dir).resolve()
            try:
                # Check if requested path is under or equal to allowed path
                if requested_abs == allowed_path or requested_abs.relative_to(allowed_path):
                    if not requested_abs.exists():
                        raise HTTPException(
                            status_code=404,
                            detail=f"Path not found: {requested_path}",
                        )
                    return requested_abs
            except ValueError:
                # Not under this allowed directory, continue
                pass
        # If absolute path doesn't match any allowed directory, reject it
        raise HTTPException(
            status_code=403,
            detail=f"Path not allowed: {requested_path}",
        )

    # Handle empty string and "." as requests for the data_dir root
    if requested_str in {"", "."}:
        # Check if data_dir itself is in allowed_dirs (common case)
        for allowed_dir in storage_settings.allowed_dirs:
            allowed_path = Path(allowed_dir).resolve()
            if allowed_path == data_dir:
                if not data_dir.exists():
                    raise HTTPException(
                        status_code=404,
                        detail=f"Data directory not found: {data_dir}",
                    )
                return data_dir
        
        # If data_dir is not directly allowed, forbid root access
        raise HTTPException(
            status_code=403, 
            detail="Root directory access not allowed. Use a specific subdirectory."
        )

    # Normalize the path - remove leading './' and extra slashes
    rel = requested_str
    if rel.startswith("./"):
        rel = rel[2:]
    
    # Build candidate path relative to data_dir
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
                    detail=f"Path not found: {requested_path}",
                )
            return candidate
        except ValueError:
            # Not under this allowed directory, try next
            continue

    raise HTTPException(
        status_code=403,
        detail=f"Path not allowed: {requested_path}",
    )
