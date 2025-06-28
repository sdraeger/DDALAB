from typing import Dict, List, Optional, Union

from pydantic import BaseModel


class WidgetLayoutData(BaseModel):
    """Represents a single widget's layout data for persistence."""

    id: str
    title: str
    position: Dict[str, Union[int, float]]  # {x: number, y: number}
    size: Dict[str, Union[int, float]]  # {width: number, height: number}
    minSize: Optional[Dict[str, Union[int, float]]] = None
    maxSize: Optional[Dict[str, Union[int, float]]] = None
    isPopOut: Optional[bool] = False
    type: Optional[str] = None


class SaveWidgetLayoutRequest(BaseModel):
    """Request to save widget layouts."""

    widgets: List[WidgetLayoutData]


class WidgetLayoutResponse(BaseModel):
    """Response for widget layout operations."""

    status: str
    message: str
    widgets: Optional[List[WidgetLayoutData]] = None


class GetWidgetLayoutResponse(BaseModel):
    """Response for getting widget layouts."""

    widgets: List[WidgetLayoutData]
