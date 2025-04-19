from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from ..core.auth import get_current_user
from ..core.config import get_server_settings
from ..core.database import User as UserDB
from ..core.dependencies import get_service
from ..core.services import EdfConfigService
from ..core.utils.utils import calculate_str_hash
from ..schemas.config import EdfConfigCreate, EdfConfigResponse

router = APIRouter()
settings = get_server_settings()


@router.get("")
async def get_config():
    return settings.model_dump(include={"institution_name"})


@router.get("/edf", response_model=EdfConfigResponse)
async def get_config_for_user_file(
    file_path: str,
    user: UserDB = Depends(get_current_user),
    edf_config_service: EdfConfigService = Depends(get_service(EdfConfigService)),
):
    full_path = Path(settings.data_dir) / file_path
    file_hash = calculate_str_hash(str(full_path))

    edf_config = await edf_config_service.get_config(user.id, file_hash)

    if not edf_config:
        raise HTTPException(status_code=404, detail="Config not found")

    return EdfConfigResponse(
        id=edf_config.id,
        file_hash=edf_config.file_hash,
        user_id=edf_config.user_id,
        created_at=edf_config.created_at,
        channels=[channel.channel for channel in edf_config.channels],
    )


@router.post("/edf", response_model=EdfConfigResponse)
async def update_config_for_user_file(
    file_path: str,
    config: EdfConfigCreate,
    user: UserDB = Depends(get_current_user),
    edf_config_service: EdfConfigService = Depends(get_service(EdfConfigService)),
):
    full_path = Path(settings.data_dir) / file_path
    file_hash = calculate_str_hash(str(full_path))

    return_config = await edf_config_service.update_config(user.id, file_hash, config)

    if not return_config:
        raise HTTPException(status_code=404, detail="Config not found")

    return EdfConfigResponse(
        id=return_config.id,
        file_hash=return_config.file_hash,
        user_id=return_config.user_id,
        created_at=return_config.created_at,
        channels=[channel.channel for channel in return_config.channels],
    )
