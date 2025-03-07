"""File management schemas."""

from typing import List

from pydantic import BaseModel


class FileList(BaseModel):
    """List of available files."""

    files: List[str]
