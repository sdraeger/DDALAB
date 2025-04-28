from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import EdfConfigChannel
from ...schemas.config import EdfConfigChannelCreate, EdfConfigChannelUpdate
from ..dependencies import register_service
from ..repository import EdfConfigChannelRepository


@register_service
class EdfConfigChannelService:
    def __init__(self, db: AsyncSession):
        self.repo = EdfConfigChannelRepository(db)

    @classmethod
    def create(cls, db: AsyncSession) -> "EdfConfigChannelService":
        return cls(db)

    async def create_config(
        self, user_id: int, edf_config: EdfConfigChannelCreate
    ) -> EdfConfigChannel:
        return await self.repo.create(user_id, edf_config)

    async def get_config(
        self, user_id: int | None = None, file_hash: str | None = None
    ) -> EdfConfigChannel | None:
        if user_id is None and file_hash is None:
            raise ValueError("No valid identifier provided")
        if user_id is None:
            return await self.repo.get_by_file_hash(file_hash)
        elif file_hash is None:
            return await self.repo.get_by_user_id(user_id)
        return await self.repo.get_by_user_id_and_file_hash(user_id, file_hash)

    async def get_by_config_id(
        self, config_id: int, skip: int = 0, limit: int | None = None
    ) -> List[EdfConfigChannel]:
        return await self.repo.get_by_config_id(config_id, skip, limit)

    async def update_config(
        self,
        config: EdfConfigChannelUpdate,
        user_id: int | None = None,
        file_hash: str | None = None,
    ) -> EdfConfigChannel | None:
        edf_config = await self.get_config(user_id, file_hash)
        if not edf_config:
            return None
        return await self.repo.update(edf_config, config)

    async def replace_channels(
        self, config_id: int, user_id: int, channels: List[str]
    ) -> None:
        # Delete existing channels for the config
        await self.repo.delete_by_config_id(config_id)

        # Insert new channels
        for channel in channels:
            if not channel.strip():
                raise ValueError("Channel names cannot be empty")
            channel_config = EdfConfigChannelCreate(
                config_id=config_id,
                channel=channel,
            )
            await self.repo.create(user_id, channel_config)
