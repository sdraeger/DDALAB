from typing import Literal, Optional

from pydantic import BaseModel, Field


class UserPreferences(BaseModel):
    """User preferences schema with validation."""

    theme: Optional[Literal["light", "dark", "system"]] = Field(
        default="system", description="UI theme preference"
    )
    session_expiration: Optional[int] = Field(
        default=1800,  # 30 minutes in seconds
        ge=300,  # minimum 5 minutes
        le=86400,  # maximum 24 hours
        description="Session expiration time in seconds",
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
                "session_expiration": 1800,
                "eeg_zoom_factor": 0.05,
            }
        }
