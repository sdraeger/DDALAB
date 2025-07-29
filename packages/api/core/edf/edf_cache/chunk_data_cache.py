import threading
import time
from collections import OrderedDict
from typing import Dict, Optional

from core.edf import EDFFile


class ChunkDataCache:
    """Cache for EDF chunk data with memory management."""

    def __init__(self, max_size_mb: int = 50, max_chunks: int = 200):
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
        preproc_key = ""
        if preprocessing_options:
            preproc_key = str(sorted(preprocessing_options.items()))
        return f"{file_path}:{chunk_start}:{chunk_size}:{preproc_key}"

    def _estimate_size(self, data: Dict) -> int:
        if "edf_file" in data:
            edf_file = data["edf_file"]
            total_samples = sum(len(signal.data) for signal in edf_file.signals)
            return total_samples * 8 + 1024
        return 1024

    def _deep_copy_edf_file(self, edf_file: EDFFile) -> EDFFile:
        new_edf_file = EDFFile()
        new_edf_file.labels = edf_file.labels.copy() if edf_file.labels else []
        new_edf_file.start_datetime = edf_file.start_datetime
        new_edf_file.physical_maximum = edf_file.physical_maximum.copy()
        new_edf_file.physical_minimum = edf_file.physical_minimum.copy()
        new_edf_file.digital_maximum = edf_file.digital_maximum.copy()
        new_edf_file.digital_minimum = edf_file.digital_minimum.copy()
        new_edf_file.edf_type = edf_file.edf_type
        new_edf_file.sampling_frequencies = edf_file.sampling_frequencies.copy()
        new_edf_file.signals = []
        for signal in edf_file.signals:
            new_signal = EDFFile.Signal(
                data=signal.data.copy(),
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
    ) -> Optional[tuple[EDFFile, int]]:
        key = self._generate_key(
            file_path, chunk_start, chunk_size, preprocessing_options
        )
        with self._lock:
            if key not in self._cache:
                return None
            self._cache.move_to_end(key)
            data = self._cache[key]
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
            if key in self._cache:
                old_data = self._cache[key]
                self._current_size -= self._estimate_size(old_data)
                del self._cache[key]
            while (
                self._current_size + data_size > self.max_size_bytes
                or len(self._cache) >= self.max_chunks
            ) and self._cache:
                oldest_key = next(iter(self._cache))
                oldest_data = self._cache[oldest_key]
                self._current_size -= self._estimate_size(oldest_data)
                del self._cache[oldest_key]
            self._cache[key] = data
            self._current_size += data_size

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._current_size = 0

    def get_stats(self) -> Dict:
        with self._lock:
            return {
                "chunks": len(self._cache),
                "max_chunks": self.max_chunks,
                "size_mb": self._current_size / (1024 * 1024),
                "max_size_mb": self.max_size_mb,
            }
