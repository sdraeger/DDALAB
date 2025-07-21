"""
Server-side EDF file caching system for improved performance.

This module provides comprehensive caching for EDF files including:
- File metadata caching (headers, channel info, etc.)
- Chunk data caching with LRU eviction
- Persistent file handle management
- Background preloading of adjacent chunks
- Memory-efficient data structures
"""

import asyncio
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Dict, Optional, Tuple

import numpy as np
from loguru import logger
from pyedflib import EdfReader

from .edf_reader import EDFFile, EDFNavigator, apply_preprocessing, read_edf_chunk


class FileMetadataCache:
    """Cache for EDF file metadata to avoid repeated file header reads."""

    def __init__(self, max_size: int = 100, ttl_seconds: int = 3600):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, Dict] = OrderedDict()
        self._timestamps: Dict[str, float] = {}
        self._lock = threading.RLock()

    def get(self, file_path: str) -> Optional[Dict]:
        """Get cached metadata for a file."""
        with self._lock:
            if file_path not in self._cache:
                return None

            # Check TTL
            if time.time() - self._timestamps[file_path] > self.ttl_seconds:
                self._remove(file_path)
                return None

            # Move to end (LRU)
            self._cache.move_to_end(file_path)
            return self._cache[file_path]

    def put(self, file_path: str, metadata: Dict) -> None:
        """Cache metadata for a file."""
        with self._lock:
            if file_path in self._cache:
                self._cache.move_to_end(file_path)
            else:
                if len(self._cache) >= self.max_size:
                    # Remove oldest
                    oldest_key = next(iter(self._cache))
                    self._remove(oldest_key)

                self._cache[file_path] = metadata

            self._timestamps[file_path] = time.time()

    def _remove(self, file_path: str) -> None:
        """Remove an entry from cache."""
        self._cache.pop(file_path, None)
        self._timestamps.pop(file_path, None)

    def clear(self) -> None:
        """Clear all cached metadata."""
        with self._lock:
            self._cache.clear()
            self._timestamps.clear()

    def get_stats(self) -> Dict:
        """Get cache statistics."""
        with self._lock:
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "ttl_seconds": self.ttl_seconds,
            }


class ChunkDataCache:
    """Cache for EDF chunk data with memory management."""

    def __init__(self, max_size_mb: int = 50, max_chunks: int = 200):  # Reduced limits
        self.max_size_mb = max_size_mb
        self.max_size_bytes = max_size_mb * 1024 * 1024
        self.max_chunks = max_chunks
        self._cache: OrderedDict[str, Dict] = OrderedDict()
        self._lock = threading.RLock()
        self._current_size = 0

    def _generate_key(
        self,
        file_path: str,
        chunk_start: int,
        chunk_size: int,
        preprocessing_options: Optional[Dict] = None,
    ) -> str:
        """Generate cache key for chunk data."""
        preproc_key = ""
        if preprocessing_options:
            preproc_key = str(sorted(preprocessing_options.items()))
        return f"{file_path}:{chunk_start}:{chunk_size}:{preproc_key}"

    def _estimate_size(self, data: Dict) -> int:
        """Estimate memory size of cached data."""
        if "edf_file" in data:
            # Estimate size based on signal data
            edf_file = data["edf_file"]
            total_samples = sum(len(signal.data) for signal in edf_file.signals)
            # Assuming float64 (8 bytes per sample)
            return total_samples * 8 + 1024  # Add overhead
        return 1024  # Default overhead

    def _deep_copy_edf_file(self, edf_file: EDFFile) -> EDFFile:
        """Create a deep copy of an EDFFile to prevent cache corruption."""
        new_edf_file = EDFFile()
        new_edf_file.labels = edf_file.labels.copy() if edf_file.labels else []
        new_edf_file.chunk_info = (
            edf_file.chunk_info.copy() if edf_file.chunk_info else {}
        )

        # Deep copy all signals with new numpy arrays
        new_edf_file.signals = []
        for signal in edf_file.signals:
            new_signal = EDFFile.Signal(
                data=signal.data.copy(),  # Create new numpy array
                sampling_frequency=signal.sampling_frequency,
                label=signal.label,
            )
            new_edf_file.signals.append(new_signal)

        return new_edf_file

    def get(
        self,
        file_path: str,
        chunk_start: int,
        chunk_size: int,
        preprocessing_options: Optional[Dict] = None,
    ) -> Optional[Tuple[EDFFile, int]]:
        """Get cached chunk data with deep copy to prevent corruption."""
        key = self._generate_key(
            file_path, chunk_start, chunk_size, preprocessing_options
        )

        with self._lock:
            if key not in self._cache:
                return None

            # Move to end (LRU)
            self._cache.move_to_end(key)
            data = self._cache[key]

            logger.debug(f"Cache hit for chunk: {key}")

            # Return deep copy to prevent cache corruption
            cached_edf_file = data["edf_file"]
            copied_edf_file = self._deep_copy_edf_file(cached_edf_file)

            return copied_edf_file, data["total_samples"]

    def exists(
        self,
        file_path: str,
        chunk_start: int,
        chunk_size: int,
        preprocessing_options: Optional[Dict] = None,
    ) -> bool:
        """Check if cached chunk data exists without retrieving it."""
        key = self._generate_key(
            file_path, chunk_start, chunk_size, preprocessing_options
        )

        with self._lock:
            return key in self._cache

    def put(
        self,
        file_path: str,
        chunk_start: int,
        chunk_size: int,
        edf_file: EDFFile,
        total_samples: int,
        preprocessing_options: Optional[Dict] = None,
    ) -> None:
        """Cache chunk data."""
        key = self._generate_key(
            file_path, chunk_start, chunk_size, preprocessing_options
        )

        data = {
            "edf_file": edf_file,
            "total_samples": total_samples,
            "timestamp": time.time(),
        }

        data_size = self._estimate_size(data)

        with self._lock:
            # Remove existing entry if present
            if key in self._cache:
                old_data = self._cache[key]
                self._current_size -= self._estimate_size(old_data)
                del self._cache[key]

            # Ensure we have space
            while (
                self._current_size + data_size > self.max_size_bytes
                or len(self._cache) >= self.max_chunks
            ) and self._cache:
                # Remove oldest entry
                oldest_key = next(iter(self._cache))
                oldest_data = self._cache[oldest_key]
                self._current_size -= self._estimate_size(oldest_data)
                del self._cache[oldest_key]
                logger.debug(f"Evicted chunk from cache: {oldest_key}")

            # Add new entry
            self._cache[key] = data
            self._current_size += data_size

            logger.debug(f"Cached chunk: {key} (size: {data_size} bytes)")

    def clear(self) -> None:
        """Clear all cached chunks."""
        with self._lock:
            self._cache.clear()
            self._current_size = 0

    def get_stats(self) -> Dict:
        """Get cache statistics."""
        with self._lock:
            return {
                "chunks": len(self._cache),
                "max_chunks": self.max_chunks,
                "size_mb": self._current_size / (1024 * 1024),
                "max_size_mb": self.max_size_mb,
            }


class FileHandleManager:
    """Thread-safe file handle manager with better error recovery."""

    def __init__(self, max_handles: int = 5, ttl_seconds: int = 180):
        self.max_handles = max_handles
        self.ttl_seconds = ttl_seconds
        self._handles: OrderedDict[str, EdfReader] = OrderedDict()
        self._timestamps: Dict[str, float] = {}
        self._lock = threading.RLock()
        self._cleanup_task = None
        self._shutdown = False

    def _start_cleanup_task(self):
        """Start asyncio cleanup task if not already running."""
        if self._cleanup_task is None or self._cleanup_task.done():
            try:
                loop = asyncio.get_running_loop()
                self._cleanup_task = loop.create_task(self._async_cleanup_expired())
            except RuntimeError:
                # No running loop, fall back to thread-based cleanup
                logger.debug("No asyncio loop, using thread-based cleanup")
                cleanup_thread = threading.Thread(
                    target=self._thread_cleanup_expired, daemon=True
                )
                cleanup_thread.start()

    async def _async_cleanup_expired(self):
        """Asyncio-based cleanup task."""
        while not self._shutdown:
            try:
                self._cleanup_expired_handles()
                await asyncio.sleep(30)  # Check every 30 seconds
            except Exception as e:
                logger.error(f"Error in async file handle cleanup: {e}")
                await asyncio.sleep(60)

    def _thread_cleanup_expired(self):
        """Thread-based cleanup fallback."""
        while not self._shutdown:
            try:
                self._cleanup_expired_handles()
                time.sleep(30)  # Check every 30 seconds
            except Exception as e:
                logger.error(f"Error in thread file handle cleanup: {e}")
                time.sleep(60)

    def _cleanup_expired_handles(self):
        """Clean up expired file handles."""
        current_time = time.time()
        expired_files = []

        with self._lock:
            for file_path, timestamp in self._timestamps.items():
                if current_time - timestamp > self.ttl_seconds:
                    expired_files.append(file_path)

            for file_path in expired_files:
                self._close_handle(file_path)
                logger.debug(f"Closed expired file handle: {file_path}")

    def _validate_handle(self, reader: EdfReader, file_path: str) -> bool:
        """Validate that a file handle is still working."""
        try:
            # Test multiple methods to ensure handle is valid
            _ = reader.signals_in_file  # Basic property access
            if reader.signals_in_file > 0:
                _ = reader.getNSamples()  # Array access
                _ = reader.getSampleFrequency(0)  # Parameter access
                # Try a small read to verify the handle works
                _ = reader.readSignal(0, 0, 1)
            return True
        except Exception as e:
            logger.warning(f"File handle validation failed for {file_path}: {e}")
            return False

    def get_handle(self, file_path: str) -> Optional[EdfReader]:
        """Get a file handle, opening if necessary with better error handling."""
        with self._lock:
            if file_path in self._handles:
                # Test if handle is still valid
                reader = self._handles[file_path]
                if self._validate_handle(reader, file_path):
                    # Move to end (LRU) and update timestamp
                    self._handles.move_to_end(file_path)
                    self._timestamps[file_path] = time.time()
                    return reader
                else:
                    logger.warning(f"File handle corrupted, removing: {file_path}")
                    self._close_handle(file_path)

            # Open new handle
            try:
                if len(self._handles) >= self.max_handles:
                    # Close oldest handle
                    oldest_file = next(iter(self._handles))
                    self._close_handle(oldest_file)
                    logger.debug(f"Closed oldest handle to make space: {oldest_file}")

                # Validate file exists and is readable
                if not Path(file_path).exists():
                    logger.error(f"File does not exist: {file_path}")
                    return None

                logger.debug(f"Opening new file handle: {file_path}")
                reader = EdfReader(file_path)

                # Validate the newly opened handle
                if not self._validate_handle(reader, file_path):
                    logger.error(f"Newly opened handle failed validation: {file_path}")
                    try:
                        reader.close()
                    except Exception:
                        pass
                    return None

                self._handles[file_path] = reader
                self._timestamps[file_path] = time.time()

                logger.debug(f"Successfully opened file handle: {file_path}")

                # Start cleanup task if not running
                self._start_cleanup_task()

                return reader

            except Exception as e:
                logger.error(f"Failed to open file handle for {file_path}: {e}")
                return None

    def _close_handle(self, file_path: str):
        """Close a file handle safely."""
        if file_path in self._handles:
            try:
                reader = self._handles[file_path]
                if hasattr(reader, "close"):
                    reader.close()
                logger.debug(f"Closed file handle: {file_path}")
            except Exception as e:
                logger.debug(f"Error closing file handle {file_path}: {e}")
            finally:
                # Always remove from tracking
                self._handles.pop(file_path, None)
                self._timestamps.pop(file_path, None)

    def close_all(self):
        """Close all file handles."""
        self._shutdown = True
        with self._lock:
            handle_count = len(self._handles)
            for file_path in list(self._handles.keys()):
                self._close_handle(file_path)
            logger.info(f"Closed {handle_count} file handles during shutdown")

        # Cancel cleanup task
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()

    def get_stats(self) -> Dict:
        """Get handle manager statistics."""
        with self._lock:
            return {
                "open_handles": len(self._handles),
                "max_handles": self.max_handles,
                "ttl_seconds": self.ttl_seconds,
            }


class EDFCacheManager:
    """Comprehensive EDF file cache manager."""

    def __init__(
        self,
        metadata_cache_size: int = 100,
        chunk_cache_size_mb: int = 50,
        max_file_handles: int = 5,
    ):
        self.metadata_cache = FileMetadataCache(max_size=metadata_cache_size)
        self.chunk_cache = ChunkDataCache(max_size_mb=chunk_cache_size_mb)
        self.file_handles = FileHandleManager(max_handles=max_file_handles)

        # Background preloading - RE-ENABLED
        self.preload_enabled = True

        logger.info("EDF Cache Manager initialized with improved error handling")

    def get_file_metadata(self, file_path: str) -> Dict:
        """Get file metadata, using cache when possible."""
        # Check cache first
        cached_metadata = self.metadata_cache.get(file_path)
        if cached_metadata:
            logger.debug(f"Metadata cache hit: {file_path}")
            return cached_metadata

        # Load metadata
        logger.debug(f"Loading metadata for: {file_path}")
        try:
            # Validate file exists first
            if not Path(file_path).exists():
                raise FileNotFoundError(f"EDF file not found: {file_path}")

            # Temporarily close any existing handle to avoid conflicts
            existing_handle = file_path in self.file_handles._handles
            if existing_handle:
                logger.debug(
                    f"Temporarily closing file handle for metadata loading: {file_path}"
                )
                self.file_handles._close_handle(file_path)

            try:
                navigator = EDFNavigator(file_path)
                metadata = {
                    "total_samples": navigator.total_samples,
                    "num_signals": navigator.num_signals,
                    "signal_labels": navigator.signal_labels,
                    "sampling_frequencies": navigator.sampling_frequencies,
                    "file_duration_seconds": navigator.file_duration_seconds,
                }

                # Cache the metadata
                self.metadata_cache.put(file_path, metadata)
                return metadata

            except Exception as nav_error:
                logger.error(f"Navigator failed for {file_path}: {nav_error}")
                raise

        except Exception as e:
            logger.error(f"Failed to load metadata for {file_path}: {e}")
            raise

    def read_chunk_optimized(
        self,
        file_path: str,
        chunk_start: int = 0,
        chunk_size: int = 25_600,
        preprocessing_options: Optional[Dict] = None,
    ) -> Tuple[EDFFile, int]:
        """Read a chunk with caching and optimization."""

        # Validate inputs
        if chunk_start < 0:
            chunk_start = 0
        if chunk_size <= 0:
            chunk_size = 25_600

        # Check chunk cache first (look for raw data without preprocessing)
        cached_chunk = self.chunk_cache.get(
            file_path,
            chunk_start,
            chunk_size,
            None,  # Always cache raw data
        )
        if cached_chunk:
            logger.debug(f"Chunk cache hit: {file_path}:{chunk_start}:{chunk_size}")

            edf_file, total_samples = cached_chunk

            # Apply preprocessing to the copied data if requested
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

            # Trigger background preloading of adjacent chunks (asyncio-safe)
            if self.preload_enabled:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        self._async_schedule_preload(
                            file_path,
                            chunk_start,
                            chunk_size,
                            None,  # Preload raw data
                        )
                    )
                except RuntimeError:
                    # No running loop, skip preloading
                    pass

            return edf_file, total_samples

        # Read chunk with fallback to non-cached reading
        logger.debug(f"Reading chunk: {file_path}:{chunk_start}:{chunk_size}")

        # Validate file exists
        if not Path(file_path).exists():
            logger.error(f"File not found during chunk read: {file_path}")
            raise FileNotFoundError(f"EDF file not found: {file_path}")

        # TEMPORARILY DISABLE persistent file handles - use fallback reading
        # This avoids the "file already opened" and "read -1" issues
        logger.debug(f"Using fallback reading for reliable data access: {file_path}")

        try:
            # Read using the original non-cached method (but without preprocessing)
            edf_file, total_samples = read_edf_chunk(
                file_path,
                chunk_start,
                chunk_size,
                None,  # No preprocessing yet
            )

            # Cache the RAW result
            self.chunk_cache.put(
                file_path,
                chunk_start,
                chunk_size,
                edf_file,  # This contains raw data
                total_samples,
                None,  # Always cache as raw data (no preprocessing)
            )

            # Now apply preprocessing to the data we're returning (not the cached data)
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

            # Schedule background preloading
            if self.preload_enabled:
                try:
                    loop = asyncio.get_running_loop()
                    loop.create_task(
                        self._async_schedule_preload(
                            file_path,
                            chunk_start,
                            chunk_size,
                            None,  # Preload raw data
                        )
                    )
                except RuntimeError:
                    # No running loop, skip preloading
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
        """Asyncio-based background preloading of adjacent chunks."""
        if not self.preload_enabled:
            return

        try:
            metadata = self.get_file_metadata(file_path)
            total_samples = metadata["total_samples"]

            # Preload next chunk (always preload raw data)
            next_chunk_start = chunk_start + chunk_size
            if next_chunk_start < total_samples:
                if not self.chunk_cache.get(
                    file_path,
                    next_chunk_start,
                    chunk_size,
                    None,  # Raw data
                ):
                    logger.debug(
                        f"Preloading next chunk: {file_path}:{next_chunk_start}"
                    )
                    # Run in thread pool to avoid blocking
                    await asyncio.to_thread(
                        self.read_chunk_optimized,
                        file_path,
                        next_chunk_start,
                        chunk_size,
                        None,  # Preload raw data
                    )

            # Preload previous chunk (always preload raw data)
            prev_chunk_start = max(0, chunk_start - chunk_size)
            if prev_chunk_start != chunk_start:
                if not self.chunk_cache.get(
                    file_path,
                    prev_chunk_start,
                    chunk_size,
                    None,  # Raw data
                ):
                    logger.debug(
                        f"Preloading previous chunk: {file_path}:{prev_chunk_start}"
                    )
                    # Run in thread pool to avoid blocking
                    await asyncio.to_thread(
                        self.read_chunk_optimized,
                        file_path,
                        prev_chunk_start,
                        chunk_size,
                        None,  # Preload raw data
                    )

        except Exception as e:
            logger.debug(f"Preload failed: {e}")

    def clear_file_cache(self, file_path: str):
        """Clear all cached data for a specific file."""
        # Clear metadata
        self.metadata_cache._remove(file_path)

        # Clear chunks (need to iterate and remove matching entries)
        with self.chunk_cache._lock:
            keys_to_remove = [
                key
                for key in self.chunk_cache._cache.keys()
                if key.startswith(f"{file_path}:")
            ]
            for key in keys_to_remove:
                data = self.chunk_cache._cache[key]
                self.chunk_cache._current_size -= self.chunk_cache._estimate_size(data)
                del self.chunk_cache._cache[key]

        # Close file handle
        self.file_handles._close_handle(file_path)

        logger.info(f"Cleared all cache data for: {file_path}")

    def get_cache_stats(self) -> Dict:
        """Get comprehensive cache statistics."""
        return {
            "metadata_cache": self.metadata_cache.get_stats(),
            "chunk_cache": self.chunk_cache.get_stats(),
            "file_handles": self.file_handles.get_stats(),
        }

    def check_cached_chunk(
        self,
        file_path: str,
        chunk_start: int = 0,
        chunk_size: int = 25_600,
        preprocessing_options: Optional[Dict] = None,
    ) -> bool:
        """Check if a cached chunk exists for the given parameters."""
        return self.chunk_cache.exists(
            file_path, chunk_start, chunk_size, preprocessing_options
        )

    def clear_all_caches(self):
        """Clear all caches."""
        self.metadata_cache.clear()
        self.chunk_cache.clear()
        self.file_handles.close_all()
        logger.info("All caches cleared")

    def get_intelligent_default_channels(
        self,
        file_path: str,
        max_channels: int = 5,
        chunk_start: int = 10000,
        test_chunk_size: int = 1000,
    ) -> list[str]:
        """Get intelligent default channel selection by analyzing signal variance.

        This function:
        1. Filters out obvious event/annotation channels by name
        2. Tests signal variance to identify channels with actual EEG data
        3. Validates channels for DDA binary compatibility
        4. Returns a reasonable selection of active EEG channels

        Args:
            file_path: Path to EDF file
            max_channels: Maximum number of channels to select
            chunk_start: Sample position to test for variance (default avoids file start)
            test_chunk_size: Size of test chunk to analyze

        Returns:
            List of channel names that likely contain EEG data
        """
        try:
            # Get file metadata to get all channel labels
            metadata = self.get_file_metadata(file_path)
            all_channels = metadata.get("signal_labels", [])

            if not all_channels:
                return []

            logger.info(f"EDF file has {len(all_channels)} total channels")

            # Filter out obvious event/annotation channels by name patterns
            event_patterns = [
                "event",
                "annotation",
                "trigger",
                "marker",
                "status",
                "evt",
            ]
            # Also filter out non-EEG channels by name patterns
            non_eeg_patterns = [
                "ecg",
                "ekg",
                "emg",
                "eog",
                "pulse",
                "sat",
                "o2",
                "spo2",
                "resp",
                "hr",
                "temp",
            ]

            eeg_candidates = []
            filtered_out = []

            for channel in all_channels:
                channel_lower = channel.lower()
                is_event_channel = any(
                    pattern in channel_lower for pattern in event_patterns
                )
                is_non_eeg = any(
                    pattern in channel_lower for pattern in non_eeg_patterns
                )

                if not is_event_channel and not is_non_eeg:
                    eeg_candidates.append(channel)
                else:
                    filtered_out.append(channel)

            logger.info(
                f"Filtered out {len(filtered_out)} non-EEG channels: {filtered_out[:10]}..."
            )
            logger.info(f"EEG candidates: {len(eeg_candidates)} channels")

            # Additional validation: Check for problematic EDF files by examining metadata
            # Some EDF files have inverted physical min/max values that can cause DDA binary issues
            try:
                from pyedflib import EdfReader

                with EdfReader(file_path) as reader:
                    # Check for inverted physical ranges (a sign of problematic files)
                    problem_channels = []
                    good_channels = []

                    for i, channel_name in enumerate(all_channels):
                        if channel_name in eeg_candidates:
                            try:
                                phys_min = reader.getPhysicalMinimum(i)
                                phys_max = reader.getPhysicalMaximum(i)

                                # Check for inverted ranges or unusual values
                                if (
                                    phys_min > phys_max
                                    or abs(phys_min) > 10000
                                    or abs(phys_max) > 10000
                                ):
                                    problem_channels.append(channel_name)
                                else:
                                    good_channels.append(channel_name)
                            except Exception as e:
                                logger.warning(
                                    f"Could not validate channel {channel_name}: {e}"
                                )
                                problem_channels.append(channel_name)

                    logger.info(
                        f"Channels with problematic ranges: {len(problem_channels)}"
                    )
                    logger.info(f"Channels with good ranges: {len(good_channels)}")

                    # If we have good channels, prefer those
                    if good_channels:
                        eeg_candidates = good_channels
                        logger.info(
                            f"Using {len(good_channels)} channels with valid physical ranges"
                        )
                    else:
                        # If all channels have problems, we'll try the top EEG candidates anyway
                        # but with a smaller selection to reduce the chance of DDA binary issues
                        max_channels = min(max_channels, 3)
                        logger.warning(
                            f"All channels have problematic ranges, limiting to {max_channels} channels"
                        )

            except Exception as validation_error:
                logger.warning(
                    f"Could not perform detailed channel validation: {validation_error}"
                )

            # If we have enough EEG candidates, use them
            if len(eeg_candidates) >= max_channels:
                selected = eeg_candidates[:max_channels]
                logger.info(
                    f"Selected {len(selected)} EEG channels by name filtering: {selected}"
                )
                return selected

            # If not enough candidates from name filtering, test signal variance
            logger.info("Testing signal variance for better channel selection...")

            # Read a test chunk to analyze variance
            try:
                edf_file, _ = self.read_chunk_optimized(
                    file_path, chunk_start=chunk_start, chunk_size=test_chunk_size
                )

                # Calculate variance for each channel
                channel_variances = []
                for i, signal in enumerate(edf_file.signals):
                    if i < len(all_channels):
                        try:
                            # Check if signal data is valid
                            if signal.data is not None and len(signal.data) > 0:
                                # Convert to numpy array for reliable variance calculation
                                data = np.array(signal.data)
                                # Remove any NaN or infinite values
                                clean_data = data[np.isfinite(data)]
                                if len(clean_data) > 0:
                                    variance = np.var(clean_data)
                                    # Check if variance is reasonable (not too large, not zero)
                                    if 0.001 < variance < 1e6:
                                        channel_variances.append(
                                            (all_channels[i], variance)
                                        )
                                    else:
                                        logger.debug(
                                            f"Channel {all_channels[i]} has unreasonable variance: {variance}"
                                        )
                                else:
                                    logger.debug(
                                        f"Channel {all_channels[i]} has no finite data"
                                    )
                            else:
                                logger.debug(f"Channel {all_channels[i]} has no data")
                        except Exception as var_error:
                            logger.debug(
                                f"Error calculating variance for channel {all_channels[i]}: {var_error}"
                            )

                # Sort by variance (highest first) and filter out zero-variance channels
                if channel_variances:
                    channel_variances.sort(key=lambda x: x[1], reverse=True)

                    # Select top channels with highest variance
                    selected_channels = [
                        channel for channel, _ in channel_variances[:max_channels]
                    ]

                    logger.info(
                        f"Selected {len(selected_channels)} channels with highest variance: {selected_channels}"
                    )
                    return selected_channels
                else:
                    logger.warning("No channels found with valid variance data")

            except Exception as variance_error:
                logger.warning(
                    f"Variance analysis failed: {variance_error}, using name-based selection"
                )

            # Final fallback: use the best EEG candidates we have
            if eeg_candidates:
                selected = eeg_candidates[:max_channels]
                logger.info(f"Fallback: using top EEG candidates: {selected}")
                return selected

            # Last resort: skip first channel (often Event) and take next few
            if len(all_channels) > 1:
                selected = all_channels[1 : max_channels + 1]  # Skip channel 0
                logger.info(f"Last resort: using channels 1-{max_channels}: {selected}")
                return selected

            # Very last resort: use first channels
            selected = all_channels[:max_channels]
            logger.info(
                f"Very last resort: using first {max_channels} channels: {selected}"
            )
            return selected

        except Exception as e:
            logger.error(f"Failed to get intelligent default channels: {e}")
            # Final fallback: skip first channel (often Event) and take next few
            try:
                metadata = self.get_file_metadata(file_path)
                all_channels = metadata.get("signal_labels", [])
                if len(all_channels) > 1:
                    return all_channels[1 : max_channels + 1]  # Skip channel 0
                return all_channels[:max_channels]
            except Exception as fallback_error:
                logger.error(
                    f"Failed fallback to get intelligent default channels: {fallback_error}"
                )
                return []


# Global cache manager instance
_cache_manager: Optional[EDFCacheManager] = None


def get_cache_manager() -> EDFCacheManager:
    """Get the global cache manager instance."""
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = EDFCacheManager()
    return _cache_manager


def clear_global_cache():
    """Clear the global cache."""
    global _cache_manager
    if _cache_manager:
        _cache_manager.clear_all_caches()
