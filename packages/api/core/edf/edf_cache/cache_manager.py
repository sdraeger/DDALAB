from typing import Dict, Optional

from .channel_selector import ChannelSelector
from .chunk_data_cache import ChunkDataCache
from .chunk_reader import ChunkReader
from .file_handle_manager import FileHandleManager
from .file_metadata_cache import FileMetadataCache


class EDFCacheManager:
    def __init__(
        self,
        metadata_cache_size: int = 100,
        chunk_cache_size_mb: int = 50,
        max_file_handles: int = 5,
    ):
        self.metadata_cache = FileMetadataCache(max_size=metadata_cache_size)
        self.chunk_cache = ChunkDataCache(max_size_mb=chunk_cache_size_mb)
        self.file_handles = FileHandleManager(max_handles=max_file_handles)
        self.chunk_reader = ChunkReader(self.chunk_cache, self.file_handles)
        self.channel_selector = ChannelSelector(self, self.chunk_reader)

    def get_file_metadata(self, file_path: str) -> Dict:
        return self.metadata_cache.get(file_path)

    def put_file_metadata(self, file_path: str, metadata: Dict) -> None:
        self.metadata_cache.put(file_path, metadata)

    def read_chunk_optimized(
        self,
        file_path: str,
        chunk_start: int = 0,
        chunk_size: int = 25600,
        preprocessing_options: Optional[Dict] = None,
    ):
        return self.chunk_reader.read_chunk_optimized(
            file_path, chunk_start, chunk_size, preprocessing_options
        )

    def get_intelligent_default_channels(
        self,
        file_path: str,
        max_channels: int = 5,
        chunk_start: int = 10000,
        test_chunk_size: int = 1000,
    ):
        return self.channel_selector.get_intelligent_default_channels(
            file_path, max_channels, chunk_start, test_chunk_size
        )

    def clear_file_cache(self, file_path: str):
        self.metadata_cache._remove(file_path)
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
        self.file_handles._close_handle(file_path)

    def get_cache_stats(self) -> Dict:
        return {
            "metadata_cache": self.metadata_cache.get_stats(),
            "chunk_cache": self.chunk_cache.get_stats(),
            "file_handles": self.file_handles.get_stats(),
        }

    def check_cached_chunk(
        self,
        file_path: str,
        chunk_start: int = 0,
        chunk_size: int = 25600,
        preprocessing_options: Optional[Dict] = None,
    ) -> bool:
        return self.chunk_cache.exists(
            file_path, chunk_start, chunk_size, preprocessing_options
        )

    def clear_all_caches(self):
        self.metadata_cache.clear()
        self.chunk_cache.clear()
        self.file_handles.close_all()
