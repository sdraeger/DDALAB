from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import Annotation
from .base_repository import BaseRepository


class AnnotationRepository(BaseRepository[Annotation]):
    def __init__(self, db: AsyncSession):
        super().__init__(Annotation, db)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[Annotation]:
        stmt = select(Annotation).filter(Annotation.user_id == user_id).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_by_file_path(
        self, file_path: str, skip: int = 0, limit: int | None = None
    ) -> List[Annotation]:
        stmt = select(Annotation).filter(Annotation.file_path == file_path).offset(skip)
        if limit is not None:
            stmt = stmt.limit(limit)
        return (await self.db.execute(stmt)).scalars().all()
