import threading
import time
from collections import OrderedDict
from typing import Dict, Optional


class FileMetadataCache:
    """Cache for EDF file metadata to avoid repeated file header reads."""

    def __init__(self, max_size: int = 100, ttl_seconds: int = 3600):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, Dict] = OrderedDict()
        self._timestamps: Dict[str, float] = {}
        self._lock = threading.RLock()

    def get(self, file_path: str) -> Optional[Dict]:
        with self._lock:
            if file_path not in self._cache:
                return None
            if time.time() - self._timestamps[file_path] > self.ttl_seconds:
                self._remove(file_path)
                return None
            self._cache.move_to_end(file_path)
            return self._cache[file_path]

    def put(self, file_path: str, metadata: Dict) -> None:
        with self._lock:
            if file_path in self._cache:
                self._cache.move_to_end(file_path)
            else:
                if len(self._cache) >= self.max_size:
                    oldest_key = next(iter(self._cache))
                    self._remove(oldest_key)
                self._cache[file_path] = metadata
            self._timestamps[file_path] = time.time()

    def _remove(self, file_path: str) -> None:
        self._cache.pop(file_path, None)
        self._timestamps.pop(file_path, None)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._timestamps.clear()

    def get_stats(self) -> Dict:
        with self._lock:
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "ttl_seconds": self.ttl_seconds,
            }
