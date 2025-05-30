from typing import List

from pydantic import BaseModel


class ShareArtifactRequest(BaseModel):
    artifact_id: str
    share_with_user_ids: List[int]


class SharedArtifactResponse(BaseModel):
    artifact_id: str
    shared_with_user_id: int
    shared_at: str
