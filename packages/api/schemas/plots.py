from typing import Any, Dict

from pydantic import BaseModel


class PlotResponse(BaseModel):
    id: str
    artifactId: str
    title: str
    data: Dict[str, Any]
