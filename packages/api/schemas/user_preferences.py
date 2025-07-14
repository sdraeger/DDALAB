from typing import Literal, Optional

from pydantic import BaseModel, Field


class UserPreferencesBase(BaseModel):
    """Base user preferences schema with validation."""

    theme: Optional[Literal["light", "dark", "system"]] = Field(
        default="system", description="UI theme preference"
    )
    eeg_zoom_factor: Optional[float] = Field(
        default=0.05,
        ge=0.01,
        le=0.2,
        description="Zoom factor for EEG chart (between 0.01 and 0.2)",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "theme": "system",
                "eeg_zoom_factor": 0.05,
            }
        }


class UserPreferences(UserPreferencesBase):
    """User preferences schema for responses."""

    pass


class UserPreferencesCreate(UserPreferencesBase):
    """User preferences schema for creation."""

    pass


class UserPreferencesUpdate(UserPreferencesBase):
    """User preferences schema for updates."""

    pass
