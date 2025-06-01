import json
from typing import List

from fastapi import APIRouter, Depends

from ..core.auth import get_current_user
from ..core.database import User
from ..schemas.plots import PlotResponse
from ..core.dependencies import get_minio_client, get_service
from ..core.services.artifact_service import ArtifactService
from minio import Minio

router = APIRouter()


@router.get("", response_model=List[PlotResponse])
async def list_plots(
    current_user: User = Depends(get_current_user),
    minio_client: Minio = Depends(get_minio_client),
    artifact_service: ArtifactService = Depends(get_service(ArtifactService)),
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
                "title": artifact.name,
                "data": {
                    "labels": data.get("labels", ["A", "B", "C"]),
                    "datasets": [
                        {
                            "label": artifact.name,
                            "data": data.get("values", [10, 20, 30]),
                        }
                    ],
                },
            }
            plots.append(plot)
        except Exception as e:
            print(f"Error processing artifact {artifact.id}: {str(e)}")
    return plots
