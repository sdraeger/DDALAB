import asyncio
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Dict, Optional

from loguru import logger
from pyedflib import EdfReader


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
        if self._cleanup_task is None or self._cleanup_task.done():
            try:
                loop = asyncio.get_running_loop()
                self._cleanup_task = loop.create_task(self._async_cleanup_expired())
            except RuntimeError:
                logger.debug("No asyncio loop, using thread-based cleanup")
                cleanup_thread = threading.Thread(
                    target=self._thread_cleanup_expired, daemon=True
                )
                cleanup_thread.start()

    async def _async_cleanup_expired(self):
        while not self._shutdown:
            try:
                self._cleanup_expired_handles()
                await asyncio.sleep(30)
            except Exception as e:
                logger.error(f"Error in async file handle cleanup: {e}")
                await asyncio.sleep(60)

    def _thread_cleanup_expired(self):
        while not self._shutdown:
            try:
                self._cleanup_expired_handles()
                time.sleep(30)
            except Exception as e:
                logger.error(f"Error in thread file handle cleanup: {e}")
                time.sleep(60)

    def _cleanup_expired_handles(self):
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
        try:
            _ = reader.signals_in_file
            if reader.signals_in_file > 0:
                _ = reader.getNSamples()
                _ = reader.getSampleFrequency(0)
                _ = reader.readSignal(0, 0, 1)
            return True
        except Exception as e:
            logger.warning(f"File handle validation failed for {file_path}: {e}")
            return False

    def get_handle(self, file_path: str) -> Optional[EdfReader]:
        with self._lock:
            if file_path in self._handles:
                reader = self._handles[file_path]
                if self._validate_handle(reader, file_path):
                    self._handles.move_to_end(file_path)
                    self._timestamps[file_path] = time.time()
                    return reader
                else:
                    logger.warning(f"File handle corrupted, removing: {file_path}")
                    self._close_handle(file_path)
            try:
                if len(self._handles) >= self.max_handles:
                    oldest_file = next(iter(self._handles))
                    self._close_handle(oldest_file)
                    logger.debug(f"Closed oldest handle to make space: {oldest_file}")
                if not Path(file_path).exists():
                    logger.error(f"File does not exist: {file_path}")
                    return None
                logger.debug(f"Opening new file handle: {file_path}")
                reader = EdfReader(file_path)
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
                self._start_cleanup_task()
                return reader
            except Exception as e:
                logger.error(f"Failed to open file handle for {file_path}: {e}")
                return None

    def _close_handle(self, file_path: str):
        if file_path in self._handles:
            try:
                reader = self._handles[file_path]
                if hasattr(reader, "close"):
                    reader.close()
                logger.debug(f"Closed file handle: {file_path}")
            except Exception as e:
                logger.debug(f"Error closing file handle {file_path}: {e}")
            finally:
                self._handles.pop(file_path, None)
                self._timestamps.pop(file_path, None)

    def close_all(self):
        self._shutdown = True
        with self._lock:
            handle_count = len(self._handles)
            for file_path in list(self._handles.keys()):
                self._close_handle(file_path)
            logger.info(f"Closed {handle_count} file handles during shutdown")
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()

    def get_stats(self) -> Dict:
        with self._lock:
            return {
                "open_handles": len(self._handles),
                "max_handles": self.max_handles,
                "ttl_seconds": self.ttl_seconds,
            }
