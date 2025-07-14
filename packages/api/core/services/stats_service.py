"""Service for managing statistics."""

from typing import Dict, List
from uuid import UUID

from core.repository.artifact_repository import ArtifactRepository
from core.service_registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class StatsService(BaseService):
    """Service for managing statistics."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.artifact_repo = ArtifactRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "StatsService":
        return cls(db)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            await self.artifact_repo.get_all()
            return True
        except Exception:
            return False

    async def get_artifact_stats(self, artifact_id: UUID) -> Dict:
        """Get statistics for an artifact."""
        artifact = await self.artifact_repo.get_by_id(artifact_id)
        if not artifact:
            raise NotFoundError("Artifact", artifact_id)

        # Calculate statistics
        stats = {
            "id": str(artifact.id),
            "name": artifact.name,
            "created_at": artifact.created_at,
            "updated_at": artifact.updated_at,
            "size": artifact.size,
            "type": artifact.type,
            "status": artifact.status,
        }

        return stats

    async def get_all_stats(self) -> List[Dict]:
        """Get statistics for all artifacts."""
        artifacts = await self.artifact_repo.get_all()
        return [await self.get_artifact_stats(artifact.id) for artifact in artifacts]
