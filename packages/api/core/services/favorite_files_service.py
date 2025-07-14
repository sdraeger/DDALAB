from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import FavoriteFile
from ..repository import FavoriteFilesRepository
from ..service_registry import register_service
from .base import BaseService


@register_service
class FavoriteFilesService(BaseService):
    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.favorite_files_repo = FavoriteFilesRepository(db)
        self.db = db

    @classmethod
    def from_db(cls, db: AsyncSession) -> "FavoriteFilesService":
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

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            # Try to execute a simple query to check database connectivity
            await self.db.execute("SELECT 1")
            return True
        except Exception:
            return False
