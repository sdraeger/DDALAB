"""Repository for managing favorite files."""

from typing import List

from core.models import FavoriteFile
from core.repository.base import BaseRepository
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class FavoriteFilesRepository(BaseRepository[FavoriteFile]):
    """Repository for managing favorite files."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, FavoriteFile)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[FavoriteFile]:
        """Get all favorite files for a user."""
        stmt = select(FavoriteFile).filter(FavoriteFile.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def get_by_file_id(self, file_id: str):
        """Get all favorite files for a file."""
        return await self.get_by_field("file_id", file_id)

    async def get_by_user_and_file_path(
        self, user_id: int, file_path: str
    ) -> FavoriteFile | None:
        """Get favorite file by user ID and file path."""
        stmt = select(FavoriteFile).filter(
            FavoriteFile.user_id == user_id, FavoriteFile.file_path == file_path
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def toggle_favorite(self, user_id: int, file_path: str) -> FavoriteFile:
        """Toggle favorite status for a file."""
        favorite = await self.get_by_user_and_file_path(user_id, file_path)

        if favorite:
            await self.db.delete(favorite)
            await self.db.flush()
            return favorite

        favorite = FavoriteFile(user_id=user_id, file_path=file_path)
        self.db.add(favorite)
        await self.db.flush()
        await self.db.refresh(favorite)
        return favorite
