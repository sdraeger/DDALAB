from typing import Any, Dict, List

from pydantic import BaseModel


class PlotResponse(BaseModel):
    id: str
    artifactId: str
    title: str
    data: Dict[str, Any]


class Layout(BaseModel):
    i: str
    x: int
    y: int
    w: int
    h: int


class LayoutRequest(BaseModel):
    layouts: List[Layout]


class LayoutResponse(BaseModel):
    status: str
    message: str
