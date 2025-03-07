"""GraphQL schema definitions."""

from typing import List, Optional

import strawberry
from strawberry.fastapi import GraphQLRouter

from ..core.dda import get_dda_result, get_task_status, start_dda
from ..core.files import get_available_files, list_directory, validate_file_path
from .preprocessing import PreprocessingOptionsInput


@strawberry.type
class FileInfo:
    """File information type."""

    name: str
    path: str
    isDirectory: bool


@strawberry.type
class DDAResult:
    """DDA analysis result type."""

    taskId: str
    filePath: str
    peaks: Optional[List[float]] = None
    status: str


@strawberry.type
class DDAStatus:
    """DDA task status type."""

    taskId: str
    status: str
    info: Optional[str] = None


@strawberry.type
class Query:
    """Root query type."""

    @strawberry.field
    async def files(self) -> List[str]:
        """Get list of available files."""
        return await get_available_files()

    @strawberry.field
    async def file_exists(self, file_path: str) -> bool:
        """Check if a file exists."""
        return await validate_file_path(file_path)

    @strawberry.field
    async def list_directory(self, path: str = "") -> List[FileInfo]:
        """List files and directories in a path."""
        items = await list_directory(path)
        return [
            FileInfo(
                name=item["name"],
                path=item["path"],
                isDirectory=item["type"] == "directory",
            )
            for item in items
        ]

    @strawberry.field
    async def dda_result(self, task_id: str) -> Optional[DDAResult]:
        """Get DDA analysis result."""
        result = await get_dda_result(task_id)
        if result:
            return DDAResult(**result)
        return None

    @strawberry.field
    async def dda_status(self, task_id: str) -> DDAStatus:
        """Get DDA task status."""
        status = await get_task_status(task_id)
        return DDAStatus(**status)

    @strawberry.field
    async def download_file(self, file_path: str) -> str:
        """Get the download URL for a file.

        Args:
            file_path: Path to the file to download

        Returns:
            URL to download the file
        """
        if not await validate_file_path(file_path):
            raise ValueError("File not found")
        return f"/api/files/download/{file_path}"


@strawberry.type
class Mutation:
    """Root mutation type."""

    @strawberry.mutation
    async def submit_dda(
        self,
        file_path: str,
        preprocessing_options: Optional[PreprocessingOptionsInput] = None,
    ) -> DDAResult:
        """Submit a DDA analysis task."""
        task_id = await start_dda(file_path, preprocessing_options)
        return DDAResult(taskId=task_id, filePath=file_path, status="processing")


# Create GraphQL schema
schema = strawberry.Schema(query=Query, mutation=Mutation)

# Create FastAPI router
graphql_app = GraphQLRouter(schema)
