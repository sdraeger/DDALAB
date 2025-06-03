"""DDA schemas."""

from typing import Optional, Union

from humps import camelize
from pydantic import BaseModel


class SnakeToCamelModel(BaseModel):
    class Config:
        alias_generator = camelize
        validate_by_name = True


class DDARequest(BaseModel):
    """DDA request schema."""

    file_path: str
    channel_list: list[int]
    bounds: tuple[int, int] | None = None
    cpu_time: bool = False
    preprocessing_options: dict[str, Union[str, bool, int, float]] | None = (
        None  # TODO: Check that these are the only types that need to be supported
    )


class DDAResponse(BaseModel):
    """DDA response schema."""

    file_path: str
    Q: list[list[float | None]]
    metadata: Optional[dict[str, str]] = None
    preprocessing_options: Optional[dict[str, bool | int | float | str]] = None
    artifact_id: Optional[str] = None
    error: Optional[str] = None
    error_message: Optional[str] = None
