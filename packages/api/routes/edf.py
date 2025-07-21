"""EDF file management endpoints."""

from pathlib import Path

from core.auth import get_current_user
from core.config import get_server_settings
from core.edf.edf_reader import get_edf_navigator
from fastapi import APIRouter, Depends, HTTPException
from schemas.edf import EdfFileInfo
from schemas.user import User

router = APIRouter()

settings = get_server_settings()


@router.get("/info")
async def get_edf_info(
    file_path: str,
    chunk_size_seconds: float = 10,
    _: User = Depends(get_current_user),
) -> EdfFileInfo:
    """Get information about an EDF file."""

    path = Path(settings.data_dir) / file_path

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    navigator = get_edf_navigator(str(path))
    chunk_size = navigator.get_chunk_size(chunk_size_seconds)
    total_samples = navigator.total_samples

    return EdfFileInfo(
        file_path=file_path,
        num_chunks=total_samples // chunk_size,
        chunk_size=chunk_size,
        total_samples=total_samples,
        sampling_rate=navigator.sampling_frequencies[0],
        total_duration=navigator.file_duration_seconds,
    )


@router.get("/cache/stats")
async def get_cache_stats(_: User = Depends(get_current_user)):
    """Get EDF cache statistics."""
    try:
        from core.edf.edf_cache import get_cache_manager

        cache_manager = get_cache_manager()
        return cache_manager.get_cache_stats()
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error getting cache stats: {str(e)}"
        )


@router.get("/cache/check")
async def check_cached_plot(
    file_path: str,
    chunk_start: int = 0,
    chunk_size: int = 25600,
    preprocessing_options: str = None,
    _: User = Depends(get_current_user),
):
    """Check if a cached plot exists for the given parameters."""
    try:
        from core.edf.edf_cache import get_cache_manager

        cache_manager = get_cache_manager()

        # Convert preprocessing_options from JSON string if provided
        import json

        preprocess_opts = None
        if preprocessing_options:
            try:
                preprocess_opts = json.loads(preprocessing_options)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=400, detail="Invalid preprocessing_options JSON format"
                )

        # Check if the file exists first
        full_path = Path(settings.data_dir) / file_path
        if not full_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

        # Check if cached data exists
        cached_exists = cache_manager.check_cached_chunk(
            str(full_path), chunk_start, chunk_size, preprocess_opts
        )

        return {
            "exists": cached_exists,
            "file_path": file_path,
            "chunk_start": chunk_start,
            "chunk_size": chunk_size,
            "preprocessing_options": preprocess_opts,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error checking cached plot: {str(e)}"
        )


@router.post("/cache/clear")
async def clear_cache(file_path: str = None, _: User = Depends(get_current_user)):
    """Clear EDF cache for a specific file or all files."""
    try:
        from core.edf.edf_cache import clear_global_cache, get_cache_manager

        if file_path:
            # Clear cache for specific file
            full_path = Path(settings.data_dir) / file_path
            cache_manager = get_cache_manager()
            cache_manager.clear_file_cache(str(full_path))
            return {"message": f"Cleared cache for file: {file_path}"}
        else:
            # Clear all caches
            clear_global_cache()
            return {"message": "Cleared all EDF caches"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error clearing cache: {str(e)}")


@router.post("/cache/warmup")
async def warmup_cache(file_path: str, _: User = Depends(get_current_user)):
    """Warm up cache for a specific file by preloading metadata."""
    try:
        from core.edf.edf_cache import get_cache_manager

        full_path = Path(settings.data_dir) / file_path
        if not full_path.exists():
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

        cache_manager = get_cache_manager()
        metadata = cache_manager.get_file_metadata(str(full_path))

        return {
            "message": f"Cache warmed up for file: {file_path}",
            "metadata": {
                "total_samples": metadata["total_samples"],
                "num_signals": metadata["num_signals"],
                "file_duration_seconds": metadata["file_duration_seconds"],
            },
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error warming up cache: {str(e)}")
