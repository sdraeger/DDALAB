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
    detrend_heatmap_axis: Optional[int] = (
        None  # 0 for along rows (time), 1 for along columns (channels) of Q_transposed
    )


class DDAResponse(BaseModel):
    """DDA response schema."""

    file_path: str
    Q: list[list[float | None]]
    q_col_labels: Optional[list[str]] = None
    metadata: Optional[dict[str, str]] = None
    preprocessing_options: Optional[dict[str, bool | int | float | str]] = None
