"""Routes for managing artifacts."""

from typing import List

from core.auth import get_current_user
from core.dependencies import get_service
from core.models import User
from core.services import ArtifactService
from fastapi import APIRouter, Depends, HTTPException, status
from schemas.artifacts.artifact import (
    Artifact,
    ArtifactCreateRequest,
    ArtifactShare,
    ArtifactUpdate,
)

router = APIRouter()


@router.post("", response_model=Artifact, status_code=status.HTTP_201_CREATED)
async def create_artifact(
    request: ArtifactCreateRequest,
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    print("[DEBUG] Entered create_artifact route handler")
    """
    Create a new artifact.
    """
    try:
        print(f"[DEBUG] Incoming artifact create request: {request}")
        print(f"[DEBUG] Using user_id: {current_user.id}")
        artifact = await artifact_service.create_artifact(
            name=request.name,
            file_path=request.file_path,
            user_id=current_user.id,
        )
        print(f"[DEBUG] Created artifact: {artifact}")
        # Convert to response model
        return Artifact(
            artifact_id=str(artifact.id),
            name=artifact.name,
            file_path=artifact.file_path,
            created_at=artifact.created_at,
            user_id=artifact.user_id,
        )
    except Exception as e:
        print(f"[ERROR] Exception in create_artifact: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=List[Artifact])
async def get_artifacts(
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    """
    List all artifacts owned by or shared with the current user.
    """
    try:
        return await artifact_service.list_artifacts(current_user)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/by_path", response_model=Artifact)
async def get_artifact_by_path(
    file_path: str,
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    """
    Get a specific artifact by file path.
    """
    try:
        artifact = await artifact_service.get_artifact_by_path(
            file_path=file_path,
            user_id=current_user.id,
        )

        if not artifact:
            raise HTTPException(
                status_code=404,
                detail=f"No artifact found for file path: {file_path}",
            )

        # Convert to response model
        return Artifact(
            artifact_id=str(artifact.id),
            name=artifact.name,
            file_path=artifact.file_path,
            created_at=artifact.created_at,
            user_id=artifact.user_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{artifact_id}", response_model=Artifact)
async def get_artifact(
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    """
    Get a specific artifact by ID.
    """
    try:
        # First check if the user has access to this artifact
        artifact = await artifact_service.get_artifact(
            artifact_id=artifact_id,
            user_id=current_user.id,
        )

        if not artifact:
            # Check if it's shared with the user
            shared_artifact = await artifact_service.get_shared_artifact(
                artifact_id=artifact_id,
                user_id=current_user.id,
            )

            if not shared_artifact:
                raise HTTPException(
                    status_code=404,
                    detail=f"Artifact not found: {artifact_id}",
                )

            # Convert to response model with shared_by info
            return Artifact(
                artifact_id=str(shared_artifact.id),
                name=shared_artifact.name,
                file_path=shared_artifact.file_path,
                created_at=shared_artifact.created_at,
                user_id=shared_artifact.user_id,
                shared_by_user_id=shared_artifact.shared_by_user_id,
            )

        # Convert to response model
        return Artifact(
            artifact_id=str(artifact.id),
            name=artifact.name,
            file_path=artifact.file_path,
            created_at=artifact.created_at,
            user_id=artifact.user_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{artifact_id}", response_model=Artifact)
async def share_artifact(
    artifact_id: str,
    request: ArtifactShare,
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    """
    Share an artifact with other users.
    """
    try:
        # First check if the user owns this artifact
        artifact = await artifact_service.get_artifact(
            artifact_id=artifact_id,
            user_id=current_user.id,
        )

        if not artifact:
            raise HTTPException(
                status_code=404,
                detail=f"Artifact not found: {artifact_id}",
            )

        # Share with each user
        for user_id in request.share_with_user_ids:
            try:
                await artifact_service.share_artifact(
                    artifact_id=artifact_id,
                    user_id=current_user.id,
                    shared_with_user_id=user_id,
                )
            except Exception as e:
                # Log the error but continue with other users
                print(f"Error sharing with user {user_id}: {str(e)}")

        # Return the updated artifact
        return await artifact_service.get_artifact(
            artifact_id=artifact_id,
            user_id=current_user.id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{artifact_id}/rename", response_model=Artifact)
async def rename_artifact(
    artifact_id: str,
    request: ArtifactUpdate,
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    """
    Rename an artifact in the database.
    """
    try:
        # First check if the user owns this artifact
        artifact = await artifact_service.get_artifact(
            artifact_id=artifact_id,
            user_id=current_user.id,
        )

        if not artifact:
            raise HTTPException(
                status_code=404,
                detail=f"Artifact not found: {artifact_id}",
            )

        # Update the name
        return await artifact_service.rename_artifact(
            artifact_id=artifact_id,
            name=request.name,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{artifact_id}", status_code=status.HTTP_200_OK)
async def delete_artifact(
    artifact_id: str,
    current_user: User = Depends(get_current_user),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
):
    """
    Delete an artifact by ID if the user owns it or has permission.
    """
    try:
        artifact = await artifact_service.get_artifact(
            artifact_id=artifact_id,
            user_id=current_user.id,
        )
        if not artifact:
            raise HTTPException(
                status_code=404,
                detail=f"Artifact not found: {artifact_id}",
            )
        await artifact_service.delete_artifact(artifact_id)
        return {"status": "success", "message": f"Artifact {artifact_id} deleted"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
