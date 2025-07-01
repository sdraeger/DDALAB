"""Configuration endpoints."""

from pathlib import Path

from core.auth import get_current_user
from core.config import get_server_settings
from core.database import User as UserDB
from core.dependencies import get_service
from core.services import EdfConfigService
from core.utils.utils import calculate_str_hash
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from loguru import logger
from schemas.config import (
    EdfConfigCreate,
    EdfConfigCreateOrUpdateRequest,
    EdfConfigResponse,
)

router = APIRouter()
settings = get_server_settings()


@router.get("")
async def get_config():
    """
    Endpoint: Get global (public-facing) server configuration
    """

    include = {"institution_name", "allowed_dirs"}
    config_data = settings.model_dump(include=include)
    logger.info(f"[Config API] Returning config: {config_data}")

    # Create response with CORS headers
    response = JSONResponse(content=config_data)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"

    return response


@router.options("")
async def options_config():
    """
    Handle CORS preflight requests for config endpoint
    """
    response = Response()
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Access-Control-Max-Age"] = "86400"
    return response


@router.get("/edf", response_model=EdfConfigResponse)
async def get_config_for_user_for_file(
    file_path: str,
    user: UserDB = Depends(get_current_user),
    edf_config_service: EdfConfigService = Depends(get_service(EdfConfigService)),
) -> EdfConfigResponse:
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
        edf_config = await edf_config_service.create_config(new_config)

    channel_configs = await edf_config_service.get_channels(edf_config.id)

    num_chunks = 1
    total_samples = 1000
    sampling_rate = 256
    chunk_size = sampling_rate * 10
    total_duration = total_samples / sampling_rate

    return EdfConfigResponse(
        id=edf_config.id,
        file_hash=edf_config.file_hash,
        user_id=edf_config.user_id,
        created_at=edf_config.created_at,
        channels=[channel_config.channel for channel_config in channel_configs],
        num_chunks=num_chunks,
        total_samples=total_samples,
        sampling_rate=sampling_rate,
        chunk_size=chunk_size,
        total_duration=total_duration,
    )


@router.post("/edf", response_model=EdfConfigResponse)
async def create_or_update_config_for_user_file(
    request: EdfConfigCreateOrUpdateRequest,
    user: UserDB = Depends(get_current_user),
    edf_config_service: EdfConfigService = Depends(get_service(EdfConfigService)),
) -> EdfConfigResponse:
    """
    Endpoint: Create or update configuration for a specific user and file
    """
    logger.debug(
        f"Received file_path: {request.file_path}, channels: {request.channels}"
    )

    # Validate file_path
    if not request.file_path.strip():
        raise HTTPException(status_code=422, detail="file_path cannot be empty")

    full_path = Path(settings.data_dir) / request.file_path
    if not full_path.exists():
        raise HTTPException(status_code=422, detail="File does not exist")

    # Calculate file hash
    file_hash = calculate_str_hash(str(full_path))

    # Check if config exists
    edf_config = await edf_config_service.get_config(user.id, file_hash)

    if not edf_config:
        # Create new config
        new_config = EdfConfigCreate(user_id=user.id, file_hash=file_hash)
        edf_config = await edf_config_service.create_config(new_config)

    # Update or replace channels
    await edf_config_service.replace_channels(
        config_id=edf_config.id, user_id=user.id, channels=request.channels
    )

    return EdfConfigResponse(
        id=edf_config.id,
        file_hash=edf_config.file_hash,
        user_id=edf_config.user_id,
        created_at=edf_config.created_at,
        channels=request.channels,
    )
