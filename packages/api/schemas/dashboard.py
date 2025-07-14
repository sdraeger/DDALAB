"""Dashboard schemas."""

from typing import Literal

from pydantic import BaseModel


class StatsResponse(BaseModel):
    """Dashboard statistics response."""

    totalArtifacts: int
    totalAnalyses: int
    activeUsers: int
    systemHealth: Literal["excellent", "good", "fair", "poor"]
