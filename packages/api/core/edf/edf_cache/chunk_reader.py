import asyncio
from pathlib import Path
from typing import Dict, Optional, Tuple

from core.edf.edf_file import EDFFile
from core.edf.utils import read_edf_chunk
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

        # Check cache first - use preprocessing options as part of cache key
        cached_chunk = self.chunk_cache.get(
            file_path, chunk_start, chunk_size, preprocessing_options
        )
        if cached_chunk:
            logger.debug(f"Chunk cache hit: {file_path}:{chunk_start}:{chunk_size}")
            edf_file, total_samples = cached_chunk
            # No need to apply preprocessing again since it's already cached with preprocessing
            if self.preload_enabled:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        self._async_schedule_preload(
                            file_path, chunk_start, chunk_size, preprocessing_options
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
            # Read chunk with preprocessing applied during initial read
            edf_file, total_samples = read_edf_chunk(
                file_path, chunk_start, chunk_size, preprocessing_options
            )

            # Cache the processed data with preprocessing options as part of the key
            self.chunk_cache.put(
                file_path,
                chunk_start,
                chunk_size,
                edf_file,
                total_samples,
                preprocessing_options,
            )

            if self.preload_enabled:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        self._async_schedule_preload(
                            file_path, chunk_start, chunk_size, preprocessing_options
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

        # Preload next chunk asynchronously
        next_chunk_start = chunk_start + chunk_size
        try:
            # Check if next chunk exists and isn't already cached
            if not self.chunk_cache.exists(
                file_path, next_chunk_start, chunk_size, preprocessing_options
            ):
                # Preload next chunk in background
                await asyncio.sleep(0.1)  # Small delay to avoid overwhelming the system
                try:
                    edf_file, total_samples = read_edf_chunk(
                        file_path, next_chunk_start, chunk_size, preprocessing_options
                    )
                    self.chunk_cache.put(
                        file_path,
                        next_chunk_start,
                        chunk_size,
                        edf_file,
                        total_samples,
                        preprocessing_options,
                    )
                    logger.debug(
                        f"Preloaded chunk: {file_path}:{next_chunk_start}:{chunk_size}"
                    )
                except Exception as e:
                    logger.debug(
                        f"Preload failed for {file_path}:{next_chunk_start}:{chunk_size} - {e}"
                    )
        except Exception as e:
            logger.debug(f"Preload scheduling failed: {e}")
