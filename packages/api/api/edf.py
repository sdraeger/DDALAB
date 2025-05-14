from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..core.auth import get_current_user
from ..core.config import get_server_settings
from ..core.edf.edf_reader import get_edf_navigator
from ..schemas.edf import EdfFileInfo
from ..schemas.user import User

router = APIRouter()

settings = get_server_settings()


@router.get("/info")
async def get_edf_info(
    file_path: str,
    _: User = Depends(get_current_user),
    chunk_size_seconds: float = 10,
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
