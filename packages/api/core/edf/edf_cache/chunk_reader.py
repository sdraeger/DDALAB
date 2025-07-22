import asyncio
from pathlib import Path
from typing import Dict, Optional, Tuple

from core.edf.edf_reader import EDFFile, apply_preprocessing, read_edf_chunk
from loguru import logger


class ChunkReader:
    def __init__(self, chunk_cache, file_handle_manager, preload_enabled=True):
        self.chunk_cache = chunk_cache
        self.file_handle_manager = file_handle_manager
        self.preload_enabled = preload_enabled

    def read_chunk_optimized(
        self,
        file_path: str,
        chunk_start: int = 0,
        chunk_size: int = 25_600,
        preprocessing_options: Optional[Dict] = None,
    ) -> Tuple[EDFFile, int]:
        if chunk_start < 0:
            chunk_start = 0
        if chunk_size <= 0:
            chunk_size = 25_600
        cached_chunk = self.chunk_cache.get(file_path, chunk_start, chunk_size, None)
        if cached_chunk:
            logger.debug(f"Chunk cache hit: {file_path}:{chunk_start}:{chunk_size}")
            edf_file, total_samples = cached_chunk
            if preprocessing_options:
                for signal in edf_file.signals:
                    try:
                        signal.data = apply_preprocessing(
                            signal.data, preprocessing_options
                        )
                    except Exception as preproc_error:
                        logger.warning(
                            f"Preprocessing failed for signal {signal.label}: {preproc_error}"
                        )
            if self.preload_enabled:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        self._async_schedule_preload(
                            file_path, chunk_start, chunk_size, None
                        )
                    )
                except RuntimeError:
                    pass
            return edf_file, total_samples
        logger.debug(f"Reading chunk: {file_path}:{chunk_start}:{chunk_size}")
        if not Path(file_path).exists():
            logger.error(f"File not found during chunk read: {file_path}")
            raise FileNotFoundError(f"EDF file not found: {file_path}")
        logger.debug(f"Using fallback reading for reliable data access: {file_path}")
        try:
            edf_file, total_samples = read_edf_chunk(
                file_path, chunk_start, chunk_size, None
            )
            self.chunk_cache.put(
                file_path, chunk_start, chunk_size, edf_file, total_samples, None
            )
            if preprocessing_options:
                for signal in edf_file.signals:
                    try:
                        signal.data = apply_preprocessing(
                            signal.data, preprocessing_options
                        )
                    except Exception as preproc_error:
                        logger.warning(
                            f"Preprocessing failed for signal {signal.label}: {preproc_error}"
                        )
            if self.preload_enabled:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        self._async_schedule_preload(
                            file_path, chunk_start, chunk_size, None
                        )
                    )
                except RuntimeError:
                    pass
            return edf_file, total_samples
        except Exception as e:
            logger.error(f"Fallback chunk reading failed for {file_path}: {e}")
            raise

    async def _async_schedule_preload(
        self,
        file_path: str,
        chunk_start: int,
        chunk_size: int,
        preprocessing_options: Optional[Dict] = None,
    ):
        if not self.preload_enabled:
            return
        try:
            metadata = self.file_handle_manager.get_file_metadata(file_path)
            total_samples = metadata["total_samples"]
            next_chunk_start = chunk_start + chunk_size
            if next_chunk_start < total_samples:
                if not self.chunk_cache.get(
                    file_path, next_chunk_start, chunk_size, None
                ):
                    await asyncio.to_thread(
                        self.read_chunk_optimized,
                        file_path,
                        next_chunk_start,
                        chunk_size,
                        None,
                    )
            prev_chunk_start = max(0, chunk_start - chunk_size)
            if prev_chunk_start != chunk_start:
                if not self.chunk_cache.get(
                    file_path, prev_chunk_start, chunk_size, None
                ):
                    await asyncio.to_thread(
                        self.read_chunk_optimized,
                        file_path,
                        prev_chunk_start,
                        chunk_size,
                        None,
                    )
        except Exception as e:
            logger.debug(f"Preload failed: {e}")
