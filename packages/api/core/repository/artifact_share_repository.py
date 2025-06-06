from typing import List, Optional
from uuid import UUID

from core.database import ArtifactShare
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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

    async def get_by_artifact_and_user(
        self, artifact_id: UUID, user_id: int
    ) -> Optional[ArtifactShare]:
        """Get an artifact share by artifact_id and user_id (shared_with_user_id)."""
        stmt = select(ArtifactShare).filter(
            ArtifactShare.artifact_id == artifact_id,
            ArtifactShare.shared_with_user_id == user_id,
        )
        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def create(
        self, artifact_id: UUID, sharing_user_id: int, shared_with_user_id: int
    ) -> ArtifactShare:
        """Create a new artifact share."""
        from schemas.artifacts import ArtifactShareCreate

        share_data = ArtifactShareCreate(
            artifact_id=artifact_id,
            user_id=sharing_user_id,
            shared_with_user_id=shared_with_user_id,
        )
        return await super().create(share_data)

    async def delete_by_artifact_id(self, artifact_id: UUID) -> bool:
        """Delete all shares for an artifact."""
        stmt = select(ArtifactShare).filter(ArtifactShare.artifact_id == artifact_id)
        result = await self.db.execute(stmt)
        shares = result.scalars().all()

        for share in shares:
            await self.db.delete(share)

        await self.db.commit()
        return len(shares) > 0
