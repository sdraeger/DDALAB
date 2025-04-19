from typing import List

from pydantic import BaseModel


# Input model for creating/updating config
class EdfConfigCreate(BaseModel):
    channels: List[str]


class EdfConfigUpdate(BaseModel):
    channels: List[str] | None


# Response model for EdfConfigDB
class EdfConfigResponse(BaseModel):
    id: int
    file_hash: str
    user_id: int
    channels: List[str]

    class Config:
        from_attributes = True
