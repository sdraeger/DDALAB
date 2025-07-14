"""Repository for managing EDF configurations."""

from typing import Optional

from core.models import EdfConfig
from core.repository.base import BaseRepository
from sqlalchemy.ext.asyncio import AsyncSession


class EdfConfigRepository(BaseRepository[EdfConfig]):
    """Repository for managing EDF configurations."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, EdfConfig)

    async def get_by_user_id(self, user_id: int) -> Optional[EdfConfig]:
        """Get config by user ID."""
        return await self.get_by_field("user_id", user_id)

    async def get_by_file_hash(self, file_hash: str) -> Optional[EdfConfig]:
        """Get config by file hash."""
        return await self.get_by_field("file_hash", file_hash)

    async def get_by_user_id_and_file_hash(
        self, user_id: int, file_hash: str
    ) -> Optional[EdfConfig]:
        """Get config by user ID and file hash."""
        return await self.get_by_fields({"user_id": user_id, "file_hash": file_hash})
