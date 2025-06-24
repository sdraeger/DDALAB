"""Artifact service for handling file artifact operations."""

import uuid
from typing import List

from core.config import get_server_settings
from core.database import Artifact as ArtifactDB
from core.database import User
from core.dependencies import register_service
from core.repository.artifact_repository import ArtifactRepository
from core.repository.artifact_share_repository import ArtifactShareRepository
from core.repository.user_repository import UserRepository
from fastapi import HTTPException, status
from loguru import logger
from minio import Minio
from schemas.artifacts import (
    ArtifactCreate,
    ArtifactRenameRequest,
    ArtifactResponse,
)
from sqlalchemy.ext.asyncio import AsyncSession


@register_service
class ArtifactService:
    def __init__(self, db: AsyncSession, minio_client: Minio = None):
        self.artifact_repository = ArtifactRepository(db)
        self.artifact_share_repository = ArtifactShareRepository(db)
        self.user_repository = UserRepository(db)
        self.minio_client = minio_client

    async def create_artifact(self, artifact: ArtifactCreate) -> ArtifactDB:
        """
        Create a new artifact.
        """
        return await self.artifact_repository.create(artifact)

    async def list_artifacts(
        self, current_user: User, skip: int = 0, limit: int | None = None
    ) -> List[ArtifactResponse]:
        """
        List all artifacts owned by or shared with the current user.
        """
        # Get owned artifacts
        owned_artifacts = await self.artifact_repository.get_by_user_id(
            user_id=current_user.id, skip=skip, limit=limit
        )

        logger.debug(f"Owned artifacts: {owned_artifacts}")

        # Get shared artifacts
        shared_artifacts = await self.artifact_share_repository.get_by_user_id(
            user_id=current_user.id, skip=skip, limit=limit
        )

        logger.debug(f"Shared artifacts: {shared_artifacts}")

        # Combine and convert to response model
        artifacts = owned_artifacts + shared_artifacts
        response = []
        for artifact in artifacts:
            shared_by_user_id = None
            if artifact.user_id != current_user.id:
                share = await self.artifact_share_repository.get_by_artifact_and_user(
                    artifact.id, current_user.id
                )
                shared_by_user_id = share.user_id if share else None
            response.append(
                ArtifactResponse(
                    artifact_id=str(artifact.id),
                    name=artifact.name or str(artifact.id),
                    file_path=artifact.file_path,
                    created_at=artifact.created_at,
                    user_id=artifact.user_id,
                    shared_by_user_id=shared_by_user_id,
                )
            )

        return response

    async def get_artifact(self, artifact_id: uuid.UUID) -> ArtifactDB:
        """
        Get an artifact by its ID.
        """
        return await self.artifact_repository.get_by_id(artifact_id)

    async def delete_artifact(self, artifact_id: uuid.UUID, current_user: User) -> None:
        """
        Delete an artifact from MinIO and the database.
        """
        artifact = await self.artifact_repository.get_by_id(artifact_id)
        if not artifact:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found"
            )

        # Check permissions
        is_owner = artifact.user_id == current_user.id
        is_shared = (
            await self.artifact_share_repository.get_by_artifact_and_user(
                artifact_id, current_user.id
            )
            is not None
        )

        if not (is_owner or is_shared):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to delete this artifact",
            )

        # Delete from MinIO
        try:
            settings = get_server_settings()
            self.minio_client.remove_object(
                settings.minio_bucket_name, artifact.file_path
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete artifact from storage: {str(e)}",
            )

        # Delete shares and artifact
        await self.artifact_share_repository.delete_by_artifact_id(artifact_id)
        await self.artifact_repository.delete(artifact_id)

    async def rename_artifact(
        self,
        artifact_id: uuid.UUID,
        rename_request: ArtifactRenameRequest,
        current_user: User,
    ) -> ArtifactResponse:
        """
        Rename an artifact in the database.
        """
        artifact = await self.artifact_repository.get_by_id(artifact_id)
        if not artifact:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found"
            )

        if artifact.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to rename this artifact",
            )
        # Update the artifact name directly
        artifact.name = rename_request.name
        await self.artifact_repository.db.commit()
        await self.artifact_repository.db.refresh(artifact)
        updated_artifact = artifact

        return ArtifactResponse(
            artifact_id=str(updated_artifact.id),
            name=updated_artifact.name,
            file_path=updated_artifact.file_path,
            created_at=updated_artifact.created_at,
            user_id=updated_artifact.user_id,
            shared_by_user_id=None,
        )

    async def get_user(self, user_id: int) -> User:
        """
        Get a user by their ID.
        """
        return await self.user_repository.get_by_id(user_id)

    async def get_artifact_share(self, artifact_id: uuid.UUID, user_id: int):
        """
        Get an artifact share record.
        """
        return await self.artifact_share_repository.get_by_artifact_and_user(
            artifact_id, user_id
        )

    async def share_artifact(
        self, artifact_id: uuid.UUID, shared_with_user_id: int, sharing_user_id: int
    ) -> None:
        """
        Share an artifact with a user.
        """
        await self.artifact_share_repository.create(
            artifact_id, sharing_user_id, shared_with_user_id
        )
