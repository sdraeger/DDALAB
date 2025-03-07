"""Analysis schemas."""

from typing import Dict, List, Optional

from pydantic import BaseModel


class AnalysisRequest(BaseModel):
    """Analysis request schema."""

    file_path: str


class AnalysisResponse(BaseModel):
    """Analysis response schema."""

    task_id: str


class AnalysisResult(BaseModel):
    """Analysis result schema."""

    file_path: str
    results: Dict[str, List[float]]
    metadata: Optional[Dict[str, str]] = None


class TaskStatus(BaseModel):
    """Task status schema."""

    status: str  # "pending", "processing", "completed", "failed"
    error: Optional[str] = None
