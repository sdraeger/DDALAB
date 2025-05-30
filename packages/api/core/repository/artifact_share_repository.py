from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import ArtifactShare
from .base_repository import BaseRepository


class ArtifactShareRepository(BaseRepository[ArtifactShare]):
    def __init__(self, db: AsyncSession):
        super().__init__(ArtifactShare, db)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[ArtifactShare]:
        stmt = (
            select(ArtifactShare)
            .filter(ArtifactShare.user_id == user_id)
            .offset(skip)
            .options(selectinload(ArtifactShare.artifact))
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        return result.scalars().all()
