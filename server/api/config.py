from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.auth import get_current_user
from ..core.config import get_server_settings
from ..core.database import EdfConfig, get_db
from ..core.database import User as UserDB
from ..core.utils.utils import calculate_str_hash

router = APIRouter()
settings = get_server_settings()


@router.get("")
async def get_config():
    return settings.model_dump(include={"institution_name"})


@router.get("/edf")
async def get_config_for_user_file(
    file_path: str,
    user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    full_path = Path(settings.data_dir) / file_path
    file_hash = calculate_str_hash(str(full_path))
    result = await db.execute(
        select(EdfConfig).where(
            EdfConfig.user_id == user.id,
            EdfConfig.file_hash == file_hash,
        )
    )
    return result.scalar_one_or_none()


@router.post("/edf")
async def update_config_for_user_file(
    file_path: str,
    config: dict,
    user: UserDB = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    full_path = Path(settings.data_dir) / file_path
    file_hash = calculate_str_hash(str(full_path))
    result = await db.execute(
        select(EdfConfig).where(
            EdfConfig.user_id == user.id,
            EdfConfig.file_hash == file_hash,
        )
    )
    edf_config = result.scalar_one_or_none()

    if edf_config:
        edf_config.config = config
    else:
        edf_config = EdfConfig(
            user_id=user.id,
            file_hash=file_hash,
            config=config,
        )
        db.add(edf_config)

    db.commit()
    return edf_config
