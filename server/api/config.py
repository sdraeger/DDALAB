from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from loguru import logger

from ..core.auth import get_current_user
from ..core.config import get_server_settings
from ..core.database import User as UserDB
from ..core.dependencies import get_service
from ..core.services import EdfConfigChannelService, EdfConfigService
from ..core.utils.utils import calculate_str_hash
from ..schemas.config import (
    EdfConfigChannelCreate,
    EdfConfigCreate,
    EdfConfigRequest,
    EdfConfigResponse,
)

router = APIRouter()
settings = get_server_settings()


@router.get("")
async def get_config():
    """
    Endpoint: Get global (public-facing) server configuration
    """
    return settings.model_dump(include={"institution_name"})


@router.get("/edf", response_model=EdfConfigResponse)
async def get_config_for_user_for_file(
    file_path: str,
    user: UserDB = Depends(get_current_user),
    edf_config_service: EdfConfigService = Depends(get_service(EdfConfigService)),
    edf_config_channel_service: EdfConfigChannelService = Depends(
        get_service(EdfConfigChannelService)
    ),
):
    """
    Endpoint: Get configuration for a specific user and file
    """
    # Calculate file hash
    full_path = Path(settings.data_dir) / file_path
    file_hash = calculate_str_hash(str(full_path))

    edf_config = await edf_config_service.get_config(user.id, file_hash)

    if not edf_config:
        new_config = EdfConfigCreate(
            user_id=user.id,
            file_hash=file_hash,
        )
        edf_config = await edf_config_service.create_config(user.id, new_config)

        default_channels = []
        for channel in default_channels:
            channel_config = EdfConfigChannelCreate(
                config_id=edf_config.id,
                channel=channel,
            )
            await edf_config_channel_service.create_config(user.id, channel_config)

    channel_configs = await edf_config_channel_service.get_by_config_id(edf_config.id)

    return EdfConfigResponse(
        id=edf_config.id,
        file_hash=edf_config.file_hash,
        user_id=edf_config.user_id,
        created_at=edf_config.created_at,
        channels=[channel_config.channel for channel_config in channel_configs],
    )


@router.post("/edf", response_model=EdfConfigResponse)
async def create_or_update_config_for_user_file(
    file_path: str,
    request: EdfConfigRequest = Body(default=None),
    user: UserDB = Depends(get_current_user),
    edf_config_service: EdfConfigService = Depends(get_service(EdfConfigService)),
    edf_config_channel_service: EdfConfigChannelService = Depends(
        get_service(EdfConfigChannelService)
    ),
):
    """
    Endpoint: Create or update configuration for a specific user and file
    """
    logger.debug(f"Received file_path: {file_path}, channels: {request.channels}")

    # Validate file_path
    if not file_path.strip():
        raise HTTPException(status_code=422, detail="file_path cannot be empty")

    full_path = Path(settings.data_dir) / file_path
    if not full_path.exists():
        raise HTTPException(status_code=422, detail="File does not exist")

    # Calculate file hash
    file_hash = calculate_str_hash(str(full_path))

    # Check if config exists
    edf_config = await edf_config_service.get_config(user.id, file_hash)

    if not edf_config:
        # Create new config
        new_config = EdfConfigCreate(user_id=user.id, file_hash=file_hash)
        edf_config = await edf_config_service.create_config(user.id, new_config)

    # Update or replace channels
    await edf_config_channel_service.replace_channels(
        config_id=edf_config.id, user_id=user.id, channels=request.channels
    )

    # Fetch updated channels
    channel_configs = await edf_config_channel_service.get_by_config_id(edf_config.id)

    return EdfConfigResponse(
        id=edf_config.id,
        file_hash=edf_config.file_hash,
        user_id=edf_config.user_id,
        created_at=edf_config.created_at,
        channels=[channel_config.channel for channel_config in channel_configs],
    )
