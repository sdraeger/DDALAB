"""Repository for managing EDF configuration channels."""

from typing import List, Optional

from core.models import EdfConfigChannel
from core.repository.base import BaseRepository
from sqlalchemy.ext.asyncio import AsyncSession


class EdfConfigChannelRepository(BaseRepository[EdfConfigChannel]):
    """Repository for managing EDF configuration channels."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, EdfConfigChannel)

    async def get_by_config_id(self, config_id: int) -> List[EdfConfigChannel]:
        """Get all channels for a config."""
        return await self.get_by_field("config_id", config_id)

    async def get_by_channel_name(
        self, channel_name: str
    ) -> Optional[EdfConfigChannel]:
        """Get channel by name."""
        return await self.get_by_field("channel_name", channel_name)
