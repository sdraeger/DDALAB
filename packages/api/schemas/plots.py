from typing import Any, Dict, Optional

from pydantic import BaseModel


class ArtifactInfo(BaseModel):
    artifact_id: str
    name: Optional[str]
    file_path: str
    created_at: str
    user_id: int
    shared_by_user_id: Optional[int] = None


class PlotResponse(BaseModel):
    id: str
    artifactId: str
    title: str
    data: Dict[str, Any]
    artifactInfo: Optional[ArtifactInfo] = None
