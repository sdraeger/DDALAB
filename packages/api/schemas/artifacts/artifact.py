from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, field_validator


class ArtifactData(BaseModel):
    file_path: str
    Q: list[list[float | None]]
    metadata: str | None
    user_id: int
    created_at: str
    artifact_id: str


class Artifact(BaseModel):
    """Base Artifact schema."""

    artifact_id: str
    name: Optional[str] = None
    file_path: str
    created_at: datetime
    user_id: int
    shared_by_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class ArtifactResponse(BaseModel):
    """Response schema for artifacts."""

    artifact_id: str
    name: str
    file_path: str
    created_at: datetime
    user_id: int
    shared_by_user_id: Optional[int] = None

    class Config:
        from_attributes = True


class ArtifactRenameRequest(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()


class ArtifactShareRequest(BaseModel):
    artifact_id: str
    share_with_user_ids: list[int]


class ArtifactCreateRequest(BaseModel):
    name: str
    file_path: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip()

    @field_validator("file_path")
    @classmethod
    def validate_file_path(cls, v):
        if not v or not v.strip():
            raise ValueError("File path cannot be empty")
        return v.strip()


class ArtifactCreate(BaseModel):
    name: str
    file_path: str
    user_id: int


class ArtifactUpdate(BaseModel):
    """Schema for updating an artifact."""

    name: Optional[str] = None
    file_path: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Name cannot be empty")
        return v.strip() if v else None

    @field_validator("file_path")
    @classmethod
    def validate_file_path(cls, v):
        if v is not None and not v.strip():
            raise ValueError("File path cannot be empty")
        return v.strip() if v else None


class ArtifactShareCreate(BaseModel):
    artifact_id: UUID
    user_id: int
    shared_with_user_id: int


class ArtifactShare(BaseModel):
    """Schema for artifact share records."""

    id: int
    artifact_id: UUID
    user_id: int
    shared_with_user_id: int
    created_at: datetime

    class Config:
        from_attributes = True
