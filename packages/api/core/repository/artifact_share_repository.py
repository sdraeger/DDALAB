"""Repository for managing artifact shares."""

from typing import List, Optional
from uuid import UUID

from core.models import ArtifactShare
from core.repository.base import BaseRepository
from sqlalchemy.ext.asyncio import AsyncSession


class ArtifactShareRepository(BaseRepository[ArtifactShare]):
    """Repository for managing artifact shares."""

    def __init__(self, db: AsyncSession):
        super().__init__(db, ArtifactShare)

    async def get_by_artifact_id(self, artifact_id: UUID) -> List[ArtifactShare]:
        """Get all shares for an artifact."""
        return await self.get_by_field("artifact_id", artifact_id)

    async def get_by_user_id(self, user_id: int) -> List[ArtifactShare]:
        """Get all shares for a user."""
        return await self.get_by_field("shared_with_user_id", user_id)

    async def get_by_artifact_and_user(
        self, artifact_id: UUID, user_id: int
    ) -> Optional[ArtifactShare]:
        """Get share by artifact and user."""
        return await self.get_by_fields(
            {"artifact_id": artifact_id, "shared_with_user_id": user_id}
        )
