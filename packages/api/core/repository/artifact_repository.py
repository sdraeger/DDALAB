from typing import List

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import Artifact, ArtifactShare
from .base_repository import BaseRepository


class ArtifactRepository(BaseRepository[Artifact]):
    def __init__(self, db: AsyncSession):
        super().__init__(Artifact, db)

    async def get_by_user_id(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[Artifact]:
        stmt = (
            select(Artifact)
            .filter(Artifact.user_id == user_id)
            .offset(skip)
            .options(selectinload(Artifact.shares))
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def get_shared_with_user(
        self, user_id: int, skip: int = 0, limit: int | None = None
    ) -> List[Artifact]:
        stmt = (
            select(Artifact)
            .join(ArtifactShare, Artifact.id == ArtifactShare.artifact_id)
            .filter(ArtifactShare.shared_with_user_id == user_id)
            .offset(skip)
            .options(selectinload(Artifact.shares))
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        result = await self.db.execute(stmt)
        return result.scalars().all()
