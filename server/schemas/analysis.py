"""Analysis-related data models."""

from typing import Any, Dict, Optional

from pydantic import BaseModel


class AnalysisRequest(BaseModel):
    """Request to perform DDA analysis."""

    file_path: str


class AnalysisResponse(BaseModel):
    """Response containing task ID."""

    task_id: str


class AnalysisResult(BaseModel):
    """DDA analysis results."""

    data: Dict[str, Any]
    dda_output: Dict[str, Any]


class TaskStatus(BaseModel):
    """Status of an analysis task."""

    status: str  # "processing" or "completed"
