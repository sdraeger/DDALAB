from datetime import datetime
from typing import List

from pydantic import BaseModel


class EdfConfigCreateOrUpdateRequest(BaseModel):
    """Request for creating/updating configuration for a specific user and file."""

    file_path: str
    channels: List[str]


class EdfConfigGetRequest(BaseModel):
    """Request for getting configuration for a specific user and file."""

    file_path: str


# Response model for EdfConfigDB
class EdfConfigResponse(BaseModel):
    id: int
    file_hash: str
    user_id: int
    created_at: datetime
    channels: List[str]
    num_chunks: int | None = None
    total_samples: int | None = None
    sampling_rate: int | None = None
    chunk_size: int | None = None
    total_duration: float | None = None

    class Config:
        from_attributes = True


# Input model for creating/updating config
class EdfConfigCreate(BaseModel):
    user_id: int
    file_hash: str


class EdfConfigUpdate(BaseModel):
    channels: List[str] | None


class EdfConfigChannelCreate(BaseModel):
    config_id: int
    channel: str


class EdfConfigChannelUpdate(BaseModel):
    channel: str | None
