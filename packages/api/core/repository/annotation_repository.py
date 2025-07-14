"""Repository for managing annotations."""

from core.models import Annotation
from core.repository.base import BaseRepository
from sqlalchemy.ext.asyncio import AsyncSession


class AnnotationRepository(BaseRepository[Annotation]):
    """Repository for managing annotations."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, Annotation)

    async def get_by_user_id(self, user_id: int):
        """Get all annotations for a user."""
        return await self.get_by_field("user_id", user_id)

    async def get_by_file_id(self, file_id: str):
        """Get all annotations for a file."""
        return await self.get_by_field("file_id", file_id)
