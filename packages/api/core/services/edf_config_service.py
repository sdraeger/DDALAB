from typing import List, Optional

from loguru import logger
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import EdfConfig, EdfConfigChannel
from ...schemas.config import EdfConfigChannelCreate, EdfConfigCreate, EdfConfigUpdate
from ..dependencies import register_service
from ..repository import EdfConfigChannelRepository, EdfConfigRepository


@register_service
class EdfConfigService:
    def __init__(self, db: AsyncSession):
        self.config_repo = EdfConfigRepository(db)
        self.channel_repo = EdfConfigChannelRepository(db)
        self.db = db

    @classmethod
    def create(cls, db: AsyncSession) -> "EdfConfigService":
        return cls(db)

    async def create_config(
        self, config: EdfConfigCreate, channels: List[str] = None
    ) -> EdfConfig:
        """
        Create a new EDF config with optional channels in a single transaction.
        """
        try:
            # Create config
            edf_config = await self.config_repo.create(config)

            # Create channels if provided
            if channels:
                for channel in channels:
                    if not channel.strip():
                        raise ValueError("Channel names cannot be empty")
                    channel_config = EdfConfigChannelCreate(
                        config_id=edf_config.id,
                        channel=channel,
                    )
                    await self.channel_repo.create(channel_config)

            return edf_config
        except IntegrityError as e:
            raise ValueError(f"Failed to create config: {str(e)}")

    async def get_config(
        self, user_id: int | None = None, file_hash: str | None = None
    ) -> Optional[EdfConfig]:
        if user_id is None and file_hash is None:
            raise ValueError("No valid identifier provided")
        if user_id is None:
            config = await self.config_repo.get_by_file_hash(file_hash)
        elif file_hash is None:
            config = await self.config_repo.get_by_user_id(user_id)
        else:
            config = await self.config_repo.get_by_user_id_and_file_hash(
                user_id, file_hash
            )
        return config

    async def get_config_with_channels(
        self, user_id: int | None = None, file_hash: str | None = None
    ) -> Optional[dict]:
        config = await self.get_config(user_id, file_hash)
        if config:
            channels = await self.channel_repo.get_by_config_id(config.id)
            return {
                "config": config,
                "channels": [channel.channel for channel in channels],
            }
        return None

    async def get_channels(
        self, config_id: int, skip: int = 0, limit: int | None = None
    ) -> List[EdfConfigChannel]:
        """
        Get channels for a specific config_id.
        """
        return await self.channel_repo.get_by_config_id(config_id, skip, limit)

    async def update_config(
        self,
        config_update: EdfConfigUpdate,
        user_id: int | None = None,
        file_hash: str | None = None,
        channels: List[str] = None,
    ) -> Optional[EdfConfig]:
        """
        Update an EDF config and optionally replace its channels.
        """
        edf_config = await self.get_config(user_id, file_hash)
        if not edf_config:
            return None

        # Update config metadata
        updated_config = await self.config_repo.update(edf_config, config_update)

        # Replace channels if provided
        if channels is not None:
            await self.replace_channels(updated_config.id, user_id, channels)

        return updated_config

    async def replace_channels(
        self, config_id: int, user_id: int, channels: List[str]
    ) -> None:
        """
        Replace all channels for a given config_id.
        """
        # Delete existing channels
        await self.channel_repo.delete_by_config_id(config_id)

        # Insert new channels
        for channel in channels:
            if not channel.strip():
                raise ValueError("Channel names cannot be empty")
            channel_config = EdfConfigChannelCreate(
                config_id=config_id,
                channel=channel,
            )
            await self.channel_repo.create(channel_config)
            logger.debug(f"inserted channel: {channel}, config_id: {config_id}")
