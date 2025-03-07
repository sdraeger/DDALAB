"""DDA schemas."""

from typing import Dict, List, Optional

from pydantic import BaseModel


class DDARequest(BaseModel):
    """DDA request schema."""

    file_path: str


class DDAResponse(BaseModel):
    """DDA response schema."""

    task_id: str


class DDAResult(BaseModel):
    """DDA result schema."""

    file_path: str
    results: Dict[str, List[float]]
    metadata: Optional[Dict[str, str]] = None


class TaskStatus(BaseModel):
    """Task status schema."""

    status: str  # "pending", "processing", "completed", "failed"
    error: Optional[str] = None
