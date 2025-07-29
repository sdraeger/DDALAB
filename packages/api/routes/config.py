"""Routes for managing EDF configurations."""

from core.config import get_data_settings, get_server_settings
from fastapi import APIRouter

router = APIRouter()
settings = get_server_settings()
data_settings = get_data_settings()


@router.get("")
async def get_config():
    """Get server configuration."""
    return {
        "token_expiration_minutes": settings.token_expiration_minutes,
        "refresh_token_expire_days": settings.refresh_token_expire_days,
        "debug": settings.debug,
        "institution_name": settings.institution_name,
        "allowedDirs": data_settings.allowed_dirs,
    }
