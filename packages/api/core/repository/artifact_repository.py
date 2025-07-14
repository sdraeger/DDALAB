"""Repository for managing artifacts."""

from typing import List, Optional
from uuid import UUID

from core.models import Artifact, ArtifactShare
from core.repository.base import BaseRepository
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


class ArtifactRepository(BaseRepository[Artifact]):
    """Repository for managing artifacts."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, Artifact)

    async def get_by_user_id(self, user_id: int) -> List[Artifact]:
        """Get all artifacts for a user."""
        return await self.get_by_field("user_id", user_id)

    async def get_by_id(self, artifact_id: UUID) -> Optional[Artifact]:
        """Get an artifact by ID."""
        result = await self.db.execute(
            select(self.model).filter(self.model.id == artifact_id)
        )
        return result.scalar_one_or_none()

    async def get_shared_with_user(self, user_id: int) -> List[Artifact]:
        """Get all artifacts shared with a user."""
        # Query ArtifactShare records for this user and join with Artifact
        result = await self.db.execute(
            select(Artifact)
            .join(ArtifactShare, Artifact.id == ArtifactShare.artifact_id)
            .filter(ArtifactShare.shared_with_user_id == user_id)
        )
        return result.scalars().all()
