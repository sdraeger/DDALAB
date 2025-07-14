from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class EdfConfigChannelBase(BaseModel):
    """Base schema for EDF config channel."""

    channel: str


class EdfConfigChannelCreate(EdfConfigChannelBase):
    """Schema for creating an EDF config channel."""

    pass


class EdfConfigChannel(EdfConfigChannelBase):
    """Schema for EDF config channel."""

    id: int
    config_id: int

    class Config:
        from_attributes = True


class EdfConfigBase(BaseModel):
    """Base schema for EDF config."""

    file_hash: str


class EdfConfigCreate(EdfConfigBase):
    """Schema for creating an EDF config."""

    user_id: int


class EdfConfigUpdate(BaseModel):
    """Schema for updating an EDF config."""

    file_hash: Optional[str] = None


class EdfConfig(EdfConfigBase):
    """Schema for EDF config."""

    id: int
    user_id: int
    created_at: datetime
    channels: List[EdfConfigChannel]

    class Config:
        from_attributes = True
