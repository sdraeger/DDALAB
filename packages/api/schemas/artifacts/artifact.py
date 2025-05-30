from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class ArtifactData(BaseModel):
    file_path: str
    Q: list[list[float | None]]
    metadata: str | None
    user_id: int
    created_at: str
    artifact_id: str


class ArtifactResponse(BaseModel):
    artifact_id: str
    name: Optional[str] = None
    file_path: str
    created_at: datetime
    user_id: int
    shared_by_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class ArtifactRenameRequest(BaseModel):
    name: str


class ArtifactShareRequest(BaseModel):
    artifact_id: str
    share_with_user_ids: list[int]


class ArtifactCreate(BaseModel):
    name: str
    file_path: str
    user_id: int
