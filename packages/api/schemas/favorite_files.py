from core.files import validate_file_path
from pydantic import BaseModel, field_validator


class ToggleFavoriteRequest(BaseModel):
    file_path: str

    @field_validator("file_path")
    @classmethod
    async def validate_file_path(cls, value: str) -> str:
        file_valid = await validate_file_path(value)
        if not file_valid:
            raise ValueError("Invalid file path")
        return value


class ToggleFavoriteResponse(BaseModel):
    success: bool
    file_path: str
    message: str | None = None


class FavoriteFile(BaseModel):
    user_id: int
    file_path: str
