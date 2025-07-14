"""Annotation schema models."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class AnnotationBase(BaseModel):
    """Base annotation schema."""

    file_path: str = Field(..., description="Path to the EDF file")
    start_time: int = Field(..., description="Start sample position")
    end_time: Optional[int] = Field(None, description="End sample position (optional)")
    text: str = Field(..., description="Annotation text")


class AnnotationCreate(AnnotationBase):
    """Schema for creating a new annotation."""

    user_id: int = Field(..., description="ID of the user creating the annotation")


class AnnotationUpdate(AnnotationBase):
    """Schema for updating an existing annotation."""

    file_path: Optional[str] = None
    start_time: Optional[int] = None
    text: Optional[str] = None


class AnnotationResponse(AnnotationBase):
    """Schema for annotation responses."""

    id: int = Field(..., description="Unique identifier for the annotation")
    user_id: int = Field(..., description="ID of the user who created the annotation")
    created_at: datetime = Field(..., description="When the annotation was created")
    updated_at: datetime = Field(
        ..., description="When the annotation was last updated"
    )

    class Config:
        """Pydantic configuration."""

        from_attributes = True
