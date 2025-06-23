import json
from typing import List

from core.auth import get_current_user
from core.database import User
from core.dependencies import get_artifact_service, get_minio_client
from core.services.artifact_service import ArtifactService
from fastapi import APIRouter, Depends
from minio import Minio
from schemas.plots import PlotResponse

router = APIRouter()


@router.get("", response_model=List[PlotResponse])
async def list_plots(
    current_user: User = Depends(get_current_user),
    minio_client: Minio = Depends(get_minio_client),
    artifact_service: ArtifactService = Depends(get_artifact_service()),
):
    """
    Get plots for artifacts owned or shared with the current user.
    """
    artifacts = await artifact_service.get_user_artifacts(current_user.id)
    plots = []
    for artifact in artifacts:
        try:
            # Fetch artifact data from MinIO (e.g., CSV or JSON)
            response = minio_client.get_object("artifacts", artifact.file_path)
            data = json.loads(response.read().decode("utf-8"))
            # Transform data into plot format (example for bar chart)
            plot = {
                "id": str(artifact.id),
                "artifactId": str(artifact.id),
                "title": artifact.name or f"Artifact {str(artifact.id)[:8]}",
                "artifactInfo": {
                    "artifact_id": str(artifact.id),
                    "name": artifact.name,
                    "file_path": artifact.file_path,
                    "created_at": artifact.created_at.isoformat(),
                    "user_id": artifact.user_id,
                    "shared_by_user_id": None,  # TODO: Add shared_by_user_id logic
                },
                "data": {
                    "labels": data.get("labels", ["A", "B", "C"]),
                    "datasets": [
                        {
                            "label": artifact.name
                            or f"Artifact {str(artifact.id)[:8]}",
                            "data": data.get("values", [10, 20, 30]),
                        }
                    ],
                },
            }
            plots.append(plot)
        except Exception as e:
            print(f"Error processing artifact {artifact.id}: {str(e)}")
    return plots
