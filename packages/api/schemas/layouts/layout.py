"""Layout schemas."""

from typing import List

from pydantic import BaseModel


class LayoutBase(BaseModel):
    """Base layout schema."""

    i: str  # Unique identifier for the layout item
    x: int  # X position
    y: int  # Y position
    w: int  # Width
    h: int  # Height


class Layout(BaseModel):
    """Response schema for layout operations."""

    status: str
    message: str


class LayoutCreate(BaseModel):
    """Schema for creating layouts."""

    layouts: List[LayoutBase]


class LayoutUpdate(BaseModel):
    """Schema for updating layouts."""

    layouts: List[LayoutBase]
