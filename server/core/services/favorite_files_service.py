from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from ..database import FavoriteFile
from ..dependencies import register_service
from ..repository import FavoriteFilesRepository


@register_service
class FavoriteFilesService:
    def __init__(self, db: AsyncSession):
        self.favorite_files_repo = FavoriteFilesRepository(db)
        self.db = db

    @classmethod
    def create(cls, db: AsyncSession) -> "FavoriteFilesService":
        return cls(db)

    async def get_favorites(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[FavoriteFile]:
        return await self.favorite_files_repo.get_by_user_id(user_id, skip, limit)

    async def toggle_favorite(self, user_id: int, file_path: str) -> FavoriteFile:
        return await self.favorite_files_repo.toggle_favorite(user_id, file_path)

    async def get_by_user_and_file_path(
        self, user_id: int, file_path: str
    ) -> FavoriteFile:
        return await self.favorite_files_repo.get_by_user_and_file_path(
            user_id, file_path
        )
