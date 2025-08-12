"""EDF file management endpoints."""

import json
from pathlib import Path

from core.auth import get_current_user
from core.environment import get_config_service
from core.edf.edf_cache import clear_global_cache, get_cache_manager
from core.edf.edf_navigator import get_edf_navigator
from fastapi import APIRouter, Depends, HTTPException
from schemas.edf import EdfFileInfo, Segment
from schemas.user import User

router = APIRouter()

storage_settings = get_config_service().get_storage_settings()


@router.get("/info")
async def get_edf_info(
    file_path: str,
    chunk_size_seconds: float = 10,
    _: User = Depends(get_current_user),
) -> EdfFileInfo:
    """Get information about an EDF file."""

    path = Path(storage_settings.data_dir) / file_path

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
        channels=navigator.signal_labels,
    )


@router.post("/segment")
async def get_segment(
    file_path: str,
    segment: Segment,
    _: User = Depends(get_current_user),
):
    """Get a segment of an EDF file."""

    path = Path(storage_settings.data_dir) / file_path

    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    navigator = get_edf_navigator(str(path))
    edf_file = navigator.segment(segment)
    new_path = str(path).replace(".edf", "_segment.edf")
    navigator.write_file(edf_file, new_path)

    return new_path


@router.get("/cache/stats")
async def get_cache_stats(_: User = Depends(get_current_user)):
    """Get EDF cache statistics."""

    try:
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
        cache_manager = get_cache_manager()

        # Convert preprocessing_options from JSON string if provided
        preprocess_opts = None
        if preprocessing_options:
            try:
                preprocess_opts = json.loads(preprocessing_options)
            except json.JSONDecodeError:
                raise HTTPException(
                    status_code=400, detail="Invalid preprocessing_options JSON format"
                )

        # Check if the file exists first
        full_path = Path(storage_settings.data_dir) / file_path
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
        if file_path:
            # Clear cache for specific file
            full_path = Path(storage_settings.data_dir) / file_path
            cache_manager = get_cache_manager()
            cache_manager.clear_file_cache(str(full_path))
            return {"message": f"Cleared cache for file: {file_path}"}
        else:
            # Clear all caches
            clear_global_cache()
            return {"message": "Cleared all EDF caches"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error clearing cache: {str(e)}")


@router.get("/data")
async def get_edf_data(
    file_path: str,
    chunk_start: int = 0,
    chunk_size: int = 5120,
    channels: str | None = None,
    preprocessing_options: str = None,
    _: User = Depends(get_current_user),
):
    """Get EDF data chunk."""
    from loguru import logger

    try:
        # request received (debug logs trimmed)

        # Handle both absolute and relative paths
        if Path(file_path).is_absolute():
            full_path = Path(file_path)
        else:
            full_path = Path(storage_settings.data_dir) / file_path

        # resolved path

        if not full_path.exists():
            logger.error(f"File not found: {full_path}")
            raise HTTPException(status_code=404, detail=f"File not found: {file_path}")

        # Convert preprocessing_options from JSON string if provided
        preprocess_opts = None
        if preprocessing_options:
            try:
                preprocess_opts = json.loads(preprocessing_options)
            except json.JSONDecodeError as e:
                logger.error(f"Invalid preprocessing options JSON: {e}")
                raise HTTPException(
                    status_code=400, detail="Invalid preprocessing_options JSON format"
                )

        # get cache manager
        # Get data from cache manager
        try:
            cache_manager = get_cache_manager()
            # cache manager ok
        except Exception as e:
            logger.error(f"Error getting cache manager: {e}")
            raise

        # read chunk
        try:
            result = cache_manager.read_chunk_optimized(
                str(full_path), chunk_start, chunk_size, preprocess_opts
            )
            # read ok

            if isinstance(result, tuple) and len(result) == 2:
                edf_file, total_samples = result
                # meta ok
            else:
                logger.error(f"Unexpected result format from cache manager: {result}")
                raise ValueError(f"Unexpected result format: {type(result)}")

        except Exception as e:
            logger.error(f"Error reading chunk: {e}")
            raise

        # Transform EDFFile to JSON format expected by frontend
        data = []
        channel_labels = []
        requested_channels = None
        if channels:
            try:
                requested_channels = set(
                    [c.strip() for c in channels.split(",") if c.strip()]
                )
            except Exception:
                requested_channels = None

        # processing edf

        if edf_file and hasattr(edf_file, "signals") and edf_file.signals:
            # signals count ok
            # Determine labels, used for filtering
            available_labels = []
            if hasattr(edf_file, "labels") and edf_file.labels:
                available_labels = list(edf_file.labels)
            elif hasattr(edf_file, "signal_labels") and edf_file.signal_labels:
                available_labels = list(edf_file.signal_labels)

            # Build label -> index map
            label_to_index = {lbl: idx for idx, lbl in enumerate(available_labels)}

            # Extract signal data in requested order when filtering
            if requested_channels:
                ordered_labels = [
                    lbl for lbl in available_labels if lbl in requested_channels
                ]
                for lbl in ordered_labels:
                    i = label_to_index.get(lbl)
                    if i is None:
                        continue
                    try:
                        signal = edf_file.signals[i]
                        if hasattr(signal, "data") and signal.data is not None:
                            signal_data = (
                                signal.data.tolist()
                                if hasattr(signal.data, "tolist")
                                else list(signal.data)
                            )
                            data.append(signal_data)
                            # per-signal size ok
                        else:
                            pass
                    except Exception as e:
                        logger.error(f"Error processing signal '{lbl}' (idx {i}): {e}")
                        raise
                channel_labels = ordered_labels
            else:
                for i, signal in enumerate(edf_file.signals):
                    try:
                        if hasattr(signal, "data") and signal.data is not None:
                            signal_data = (
                                signal.data.tolist()
                                if hasattr(signal.data, "tolist")
                                else list(signal.data)
                            )
                            data.append(signal_data)
                            # size ok
                        else:
                            pass
                    except Exception as e:
                        logger.error(f"Error processing signal {i}: {e}")
                        raise
                channel_labels = available_labels

            # Debug: log first/last values of first returned channel to verify chunking
            # debug verify removed
        else:
            logger.warning("EDF file has no signals or is None")

        # Get sampling frequency
        sampling_frequency = 256  # default
        if (
            edf_file
            and hasattr(edf_file, "sampling_frequencies")
            and edf_file.sampling_frequencies
        ):
            sampling_frequency = edf_file.sampling_frequencies[0]
            logger.info(f"Using sampling frequency: {sampling_frequency}")
        else:
            logger.warning(f"Using default sampling frequency: {sampling_frequency}")

        # Convert numpy types to Python native types for JSON serialization
        def convert_numpy_types(obj):
            """Convert numpy types to Python native types."""
            import numpy as np

            if isinstance(obj, np.integer):
                return int(obj)
            elif isinstance(obj, np.floating):
                return float(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            return obj

        response_data = {
            "data": data,
            "channel_labels": channel_labels,
            "sampling_frequency": convert_numpy_types(sampling_frequency),
            "chunk_size": convert_numpy_types(chunk_size),
            "chunk_start": convert_numpy_types(chunk_start),
            "total_samples": convert_numpy_types(total_samples),
        }

        # returning response
        return response_data

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_edf_data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error reading EDF data: {str(e)}")


@router.post("/cache/warmup")
async def warmup_cache(file_path: str, _: User = Depends(get_current_user)):
    """Warm up cache for a specific file by preloading metadata."""

    try:
        full_path = Path(storage_settings.data_dir) / file_path
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
