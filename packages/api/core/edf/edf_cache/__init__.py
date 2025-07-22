from .cache_manager import EDFCacheManager

_cache_manager = None


def get_cache_manager() -> EDFCacheManager:
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = EDFCacheManager()
    return _cache_manager


def clear_global_cache():
    global _cache_manager
    if _cache_manager:
        _cache_manager.clear_all_caches()
