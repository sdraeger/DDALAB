"""Service for managing artifacts."""

from typing import List
from uuid import UUID

from core.models import Artifact, User
from core.repository.artifact_repository import ArtifactRepository
from core.repository.artifact_share_repository import ArtifactShareRepository
from core.service_registry import register_service
from core.services.base import BaseService
from core.services.errors import NotFoundError, ValidationError
from schemas.artifacts.artifact import ArtifactCreate, ArtifactUpdate
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class ArtifactService(BaseService[Artifact]):
    """Service for managing artifacts."""

    def __init__(self, db: AsyncSession):
        super().__init__(db)
        self.repo = ArtifactRepository(db)
        self.share_repo = ArtifactShareRepository(db)

    @classmethod
    def from_db(cls, db: AsyncSession) -> "ArtifactService":
        return cls(db)

    async def health_check(self) -> bool:
        """Check if the service is healthy."""
        try:
            await self.repo.get_all()
            return True
        except Exception:
            return False

    async def create_artifact(self, data: ArtifactCreate = None, **kwargs) -> Artifact:
        """Create a new artifact."""
        try:
            # Handle both data object and keyword arguments for backward compatibility
            if data is not None:
                artifact_data = data.model_dump()
            else:
                # Handle keyword arguments from route
                artifact_data = kwargs

            # Create the Artifact model object
            artifact = Artifact(**artifact_data)
            return await self.repo.create(artifact)
        except Exception as e:
            raise ValidationError(f"Failed to create artifact: {str(e)}")

    async def get_artifact(
        self, artifact_id: UUID | str, user_id: int = None
    ) -> Artifact:
        """Get an artifact by ID, optionally with user access control."""
        try:
            # Convert string to UUID if needed
            if isinstance(artifact_id, str):
                artifact_uuid = UUID(artifact_id)
            else:
                artifact_uuid = artifact_id

            artifact = await self.repo.get_by_id(artifact_uuid)
            if not artifact:
                raise NotFoundError("Artifact", artifact_id)

            # If user_id is provided, verify the user has access (owns or has shared access)
            if user_id is not None:
                if artifact.user_id != user_id:
                    # Check if artifact is shared with this user
                    shared_artifacts = await self.repo.get_shared_with_user(user_id)
                    if not any(
                        shared.id == artifact_uuid for shared in shared_artifacts
                    ):
                        raise NotFoundError("Artifact", artifact_id)

            return artifact
        except ValueError:
            raise ValidationError(f"Invalid artifact ID: {artifact_id}")

    async def update_artifact(
        self, artifact_id: UUID | str, data: ArtifactUpdate
    ) -> Artifact:
        """Update an artifact."""
        # Get the existing artifact first
        artifact = await self.get_artifact(artifact_id)

        try:
            # Update artifact attributes with the new data
            update_data = data.dict(exclude_unset=True)
            for key, value in update_data.items():
                if hasattr(artifact, key):
                    setattr(artifact, key, value)

            # Use the repository's update method which expects the model object
            return await self.repo.update(artifact)
        except Exception as e:
            raise ValidationError(f"Failed to update artifact: {str(e)}")

    async def delete_artifact(self, artifact_id: UUID | str) -> None:
        """Delete an artifact."""
        # Get the existing artifact first to verify it exists
        artifact = await self.get_artifact(artifact_id)

        try:
            # Use the repository's delete method which expects the model object
            await self.repo.delete(artifact)
        except Exception as e:
            raise ValidationError(f"Failed to delete artifact: {str(e)}")

    async def get_all_artifacts(self) -> List[Artifact]:
        """Get all artifacts."""
        return await self.repo.get_all()

    # Standard CRUD interface methods (matching AnnotationService pattern)
    async def create(self, data: ArtifactCreate) -> Artifact:
        """Create a new artifact."""
        return await self.create_artifact(data)

    async def get(self, artifact_id: UUID | str) -> Artifact:
        """Get an artifact by ID."""
        return await self.get_artifact(artifact_id)

    async def update(self, artifact_id: UUID | str, data: ArtifactUpdate) -> Artifact:
        """Update an artifact."""
        return await self.update_artifact(artifact_id, data)

    async def delete(self, artifact_id: UUID | str) -> None:
        """Delete an artifact."""
        await self.delete_artifact(artifact_id)

    # Missing methods that routes are calling
    async def list_artifacts(self, user: User) -> List[Artifact]:
        """List all artifacts owned by or shared with the user."""
        # Get artifacts owned by the user
        owned_artifacts = await self.repo.get_by_user_id(user.id)

        # Get artifacts shared with the user
        shared_artifacts = await self.repo.get_shared_with_user(user.id)

        # Combine and return unique artifacts
        all_artifacts = owned_artifacts + shared_artifacts

        # Remove duplicates based on artifact ID
        seen_ids = set()
        unique_artifacts = []
        for artifact in all_artifacts:
            if artifact.id not in seen_ids:
                unique_artifacts.append(artifact)
                seen_ids.add(artifact.id)

        return unique_artifacts

    async def get_artifact_by_path(self, file_path: str, user_id: int) -> Artifact:
        """Get an artifact by file path for a specific user."""
        artifacts = await self.repo.get_by_user_id(user_id)
        for artifact in artifacts:
            if artifact.file_path == file_path:
                return artifact
        return None

    async def get_shared_artifact(self, artifact_id: str, user_id: int) -> Artifact:
        """Get a shared artifact for a user."""
        try:
            artifact_uuid = UUID(artifact_id)
            shared_artifacts = await self.repo.get_shared_with_user(user_id)
            for artifact in shared_artifacts:
                if artifact.id == artifact_uuid:
                    return artifact
            return None
        except ValueError:
            return None

    async def share_artifact(
        self, artifact_id: str, user_id: int, shared_with_user_id: int
    ) -> None:
        """Share an artifact with another user."""
        try:
            artifact_uuid = UUID(artifact_id)
            # Verify the artifact exists and is owned by the user
            artifact = await self.repo.get_by_id(artifact_uuid)
            if not artifact or artifact.user_id != user_id:
                raise NotFoundError("Artifact", artifact_id)

            # Create share record
            from core.models import ArtifactShare

            share = ArtifactShare(
                artifact_id=artifact_uuid,
                shared_by_user_id=user_id,
                shared_with_user_id=shared_with_user_id,
            )
            await self.share_repo.create(share)
        except ValueError:
            raise ValidationError(f"Invalid artifact ID: {artifact_id}")

    async def rename_artifact(self, artifact_id: str, name: str) -> Artifact:
        """Rename an artifact."""
        try:
            artifact_uuid = UUID(artifact_id)
            artifact = await self.repo.get_by_id(artifact_uuid)
            if not artifact:
                raise NotFoundError("Artifact", artifact_id)

            # Update the name
            artifact.name = name
            return await self.repo.update(artifact)
        except ValueError:
            raise ValidationError(f"Invalid artifact ID: {artifact_id}")
