"""Routes for managing EDF configurations."""

from core.environment import get_config_service
from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def get_current_config():
    """Get the current API configuration.

    Returns:
        Current API configuration settings.
    """
    config_service = get_config_service()
    api_settings = config_service.get_api_settings()
    service_settings = config_service.get_service_settings()
    auth_settings = config_service.get_auth_settings()
    storage_settings = config_service.get_storage_settings()
    cache_settings = config_service.get_cache_settings()
    dda_settings = config_service.get_dda_settings()
    # observability_settings = config_service.get_observability_settings()

    return {
        "api_host": api_settings.api_host,
        "api_port": api_settings.api_port,
        "debug": service_settings.debug,
        "auth_mode": auth_settings.auth_mode,
        "allowed_dirs": storage_settings.allowed_dirs,
        "minio_host": storage_settings.minio_host,
        "minio_bucket_name": storage_settings.minio_bucket_name,
        "redis_host": cache_settings.redis_host,
        "redis_port": cache_settings.redis_port,
        "anonymize_edf": dda_settings.anonymize_edf,
    }
