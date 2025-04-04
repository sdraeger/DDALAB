"""DDA schemas."""

from typing import Optional, Union

from humps import camelize
from pydantic import BaseModel


class SnakeToCamelModel(BaseModel):
    class Config:
        alias_generator = camelize
        allow_population_by_field_name = True


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

    task_id: str


class DDAResult(BaseModel):
    """DDA result schema."""

    file_path: str
    Q: list[list[float | None]]
    metadata: Optional[str] = None


class TaskStatus(BaseModel):
    """Task status schema."""

    status: str  # "pending", "processing", "completed", "failed"
    error: Optional[str] = None
