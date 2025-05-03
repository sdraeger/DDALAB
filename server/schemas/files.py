"""File management schemas."""

from typing import List

from pydantic import BaseModel


class FileInfo(BaseModel):
    """Information about a file."""

    name: str
    path: str
    is_directory: bool
    size: int | None
    is_favorite: bool
    last_modified: str


class FileListRequest(BaseModel):
    """Request for a list of files."""

    path: str


class FileListResponse(BaseModel):
    """Response for a list of files."""

    files: List[FileInfo]
