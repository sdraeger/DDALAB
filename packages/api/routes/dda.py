"""DDA endpoints."""

import json
import uuid
from datetime import datetime, timezone
from io import BytesIO

from core.auth import get_current_user
from core.config import get_server_settings
from core.database import User
from core.dda import run_dda as run_dda_core
from core.dependencies import get_minio_client, get_service
from core.services import ArtifactService
from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from minio import Minio
from minio.error import S3Error
from schemas.artifacts import ArtifactCreate
from schemas.dda import DDARequest, DDAResponse

router = APIRouter()
settings = get_server_settings()


@router.post("", response_model=DDAResponse)
async def run_dda(
    request: DDARequest,
    user: User = Depends(get_current_user),
    minio_client: Minio = Depends(get_minio_client),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
) -> DDAResponse:
    """Submit a DDA task and save results as a private artifact in MinIO.

    Args:
        request: DDA request containing file path
        user: Current authenticated user

    Returns:
        DDAResponse including the artifact ID
    """
    result = await run_dda_core(
        file_path=request.file_path,
        channel_list=request.channel_list,
        preprocessing_options=request.preprocessing_options,
    )

    # Check if there was a validation error
    if result.get("error"):
        logger.warning(f"DDA validation error: {result.get('error_message')}")
        return DDAResponse(
            file_path=result["file_path"],
            Q=result["Q"],
            metadata=result.get("metadata"),
            preprocessing_options=result.get("preprocessing_options"),
            error=result.get("error"),
            error_message=result.get("error_message"),
        )

    # Generate unique artifact ID
    artifact_id = str(uuid.uuid4())
    object_name = f"dda_results/{user.id}/{artifact_id}/result.json"

    # Prepare result data with metadata
    result_data = {
        "file_path": result["file_path"],
        "Q": result["Q"],
        "metadata": result.get("metadata"),
        "user_id": user.id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        # Save result to MinIO as a private artifact
        json_data = json.dumps(result_data)
        minio_client.put_object(
            settings.minio_bucket_name,
            object_name,
            BytesIO(json_data.encode("utf-8")),
            length=len(json_data),
            content_type="application/json",
        )
        logger.info(f"Saved DDA result to MinIO: {object_name}")

        artifact = await artifact_service.create_artifact(
            ArtifactCreate(
                name=f"DDA result {artifact_id}",
                file_path=object_name,
                user_id=user.id,
            )
        )
        logger.info(f"Created artifact: {artifact.id}")
    except S3Error as e:
        logger.error(f"Failed to save DDA result to MinIO: {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save artifact: {str(e)}"
        )

    return DDAResponse(
        file_path=result["file_path"],
        Q=result["Q"],
        metadata=result.get("metadata"),
        artifact_id=artifact_id,
    )
