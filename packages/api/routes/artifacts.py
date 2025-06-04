import uuid
from typing import List

from core.auth import get_current_user
from core.database import User
from core.dependencies import get_service
from core.services import ArtifactService
from fastapi import APIRouter, Depends, HTTPException, status
from schemas.artifacts import (
    ArtifactRenameRequest,
    ArtifactResponse,
    ArtifactShareRequest,
)

router = APIRouter()


@router.get("", response_model=List[ArtifactResponse])
async def list_artifacts(
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
    current_user: User = Depends(get_current_user),
):
    """
    List all artifacts owned by or shared with the current user.
    """
    artifacts = await artifact_service.list_artifacts(current_user)

    return artifacts


@router.delete("/{artifact_id}", status_code=status.HTTP_200_OK)
async def delete_artifact(
    artifact_id: str,
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
    current_user: User = Depends(get_current_user),
):
    """
    Delete an artifact from MinIO and the database.
    """
    try:
        artifact_uuid = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid artifact ID format",
        )

    await artifact_service.delete_artifact(artifact_uuid, current_user)

    return {"message": f"Artifact {artifact_uuid.hex} deleted successfully"}


@router.patch("/{artifact_id}/rename", response_model=ArtifactResponse)
async def rename_artifact(
    artifact_id: str,
    rename_request: ArtifactRenameRequest,
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
    current_user: User = Depends(get_current_user),
):
    """
    Rename an artifact in the database.
    """
    try:
        artifact_uuid = uuid.UUID(artifact_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid artifact ID format",
        )

    artifact = await artifact_service.get_artifact(artifact_uuid)

    if artifact.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to rename this artifact",
        )

    artifact.name = rename_request.name
    return await artifact_service.rename_artifact(
        artifact_uuid, rename_request, current_user
    )


@router.post("/share", status_code=status.HTTP_201_CREATED)
async def share_artifact(
    share_request: ArtifactShareRequest,
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
    current_user: User = Depends(get_current_user),
):
    """
    Share an artifact with other users.
    """
    try:
        artifact_uuid = uuid.UUID(share_request.artifact_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid artifact ID format",
        )

    artifact = await artifact_service.get_artifact(artifact_uuid)

    if artifact.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only share artifacts you own",
        )

    for user_id in share_request.share_with_user_ids:
        user = await artifact_service.get_user(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with ID {user_id} not found",
            )
        if user.id == current_user.id:
            continue

        existing_share = await artifact_service.get_artifact_share(
            artifact_uuid, user_id
        )
        if existing_share:
            continue

        await artifact_service.share_artifact(artifact_uuid, user_id, current_user.id)

    return {"message": f"Artifact {artifact_uuid.hex} shared successfully"}
