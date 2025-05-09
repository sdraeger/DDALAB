from typing import Any, Dict, Optional

from pydantic import BaseModel


class SnapshotData(BaseModel):
    name: str
    data: Dict[str, Any]  # Store mapping of blob descriptors to data
    description: Optional[str] = None  # Description of the snapshot
    metadata: Optional[Dict[str, Any]] = None  # Additional metadata
