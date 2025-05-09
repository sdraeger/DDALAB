from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...schemas.favorite_files import FavoriteFile
from ..database import FavoriteFile as FavoriteFileDB
from .base_repository import BaseRepository


class FavoriteFilesRepository(BaseRepository[FavoriteFileDB]):
    def __init__(self, db: AsyncSession):
        super().__init__(FavoriteFileDB, db)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[FavoriteFileDB]:
        stmt = (
            select(FavoriteFileDB)
            .filter(FavoriteFileDB.user_id == user_id)
            .offset(skip)
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_user_id_and_file_path(
        self, user_id: int, file_path: str
    ) -> FavoriteFileDB | None:
        stmt = select(FavoriteFileDB).filter(
            FavoriteFileDB.user_id == user_id, FavoriteFileDB.file_path == file_path
        )
        return (await self.db.execute(stmt)).scalars().first()

    async def toggle_favorite(self, user_id: int, file_path: str) -> bool:
        favorite = await self.get_by_user_id_and_file_path(user_id, file_path)

        if favorite:
            await self.delete(favorite.id)
            return False

        await self.create(FavoriteFile(user_id=user_id, file_path=file_path))
        return True
