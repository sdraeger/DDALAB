from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel


class WidgetLayoutData(BaseModel):
    """Represents a single widget's layout data for persistence."""

    id: str
    title: str
    type: str
    position: Dict[str, Union[int, float]]  # {x: number, y: number}
    size: Dict[str, Union[int, float]]  # {width: number, height: number}
    minSize: Optional[Dict[str, Union[int, float]]] = None
    maxSize: Optional[Dict[str, Union[int, float]]] = None
    isPopOut: Optional[bool] = False
    isMinimized: Optional[bool] = False
    isMaximized: Optional[bool] = False
    data: Optional[Any] = None
    settings: Optional[Dict[str, Any]] = None


class SaveWidgetLayoutRequest(BaseModel):
    """Request to save widget layouts."""

    widgets: List[WidgetLayoutData]
    layout: Optional[List[Dict[str, Union[str, int, float]]]] = None


class WidgetLayoutResponse(BaseModel):
    """Response for widget layout operations."""

    status: str
    message: str
    widgets: Optional[List[WidgetLayoutData]] = None
    layout: Optional[List[Dict[str, Union[str, int, float]]]] = None


class GetWidgetLayoutResponse(BaseModel):
    """Response for getting widget layouts."""

    widgets: List[WidgetLayoutData]
