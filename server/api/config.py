from fastapi import APIRouter

from ..core.config import get_server_settings

router = APIRouter()
settings = get_server_settings()


@router.get("")
async def get_config():
    return settings.model_dump(include={"institution_name"})
