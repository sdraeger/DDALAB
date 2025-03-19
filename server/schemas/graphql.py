"""GraphQL schema definitions."""

import asyncio
import os
from typing import List, Optional

import numpy as np
import strawberry
from fastapi import BackgroundTasks, Request
from loguru import logger
from strawberry.fastapi import GraphQLRouter

from ddalab.data.edf import read_edf_chunk

from ..config import get_settings
from ..core.dda import get_dda_result, get_task_status, start_dda
from ..core.files import list_directory, validate_file_path
from .preprocessing import (
    PreprocessingOptionsInput,
    VisualizationPreprocessingOptionsInput,
)


@strawberry.type
class FileInfo:
    """File information type."""

    name: str
    path: str
    isDirectory: bool
    size: Optional[int] = None
    lastModified: Optional[str] = None


@strawberry.type
class EDFData:
    """EDF data type."""

    data: List[List[float]]
    samplingFrequency: float = strawberry.field(description="Sampling frequency in Hz")
    channelLabels: List[str]
    totalSamples: int
    chunkStart: int
    chunkSize: int

    @strawberry.field
    def has_more(self) -> bool:
        """Check if there are more chunks available."""
        return bool(
            self.chunkStart + self.chunkSize < self.totalSamples
        )  # Explicit bool conversion


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

    taskId: str = strawberry.field(description="Task ID")
    status: str = strawberry.field(description="Task status")
    info: Optional[str] = strawberry.field(
        default=None, description="Additional status information"
    )


@strawberry.type
class Query:
    """GraphQL query type."""

    @strawberry.field
    async def list_directory(self, path: str = "") -> List[FileInfo]:
        """List contents of a directory.

        Args:
            path: Directory path to list

        Returns:
            List of file information
        """
        items = await list_directory(path)
        return [
            FileInfo(
                name=item["name"],
                path=item["path"],
                isDirectory=item["type"] == "directory",
                size=item.get("size"),
                lastModified=item.get("last_modified"),
            )
            for item in items
        ]

    @strawberry.field
    async def get_edf_data(
        self,
        filename: str,
        chunkStart: int = 0,
        chunkSize: int = 25_600,  # Default to 10 seconds at 256 Hz
        preprocessingOptions: Optional[VisualizationPreprocessingOptionsInput] = None,
    ) -> EDFData:
        """Get raw EDF data for a file.

        Args:
            filename: Path to the EDF file
            chunkStart: Start index for data chunk
            chunkSize: Size of data chunk to return (in samples)
            preprocessingOptions: Optional preprocessing options for visualization

        Returns:
            EDFData containing the raw data and metadata
        """
        try:
            # Validate file path
            if not await validate_file_path(filename):
                raise ValueError(f"Invalid file path: {filename}")

            settings = get_settings()
            full_path = os.path.join(settings.data_dir, filename)
            logger.info(f"Reading EDF file chunk: {full_path}")

            # Convert preprocessing options to dict if present
            preprocessing_dict = None
            if preprocessingOptions:
                preprocessing_dict = {
                    "removeOutliers": preprocessingOptions.removeOutliers,
                    "smoothing": preprocessingOptions.smoothing,
                    "smoothingWindow": preprocessingOptions.smoothingWindow,
                    "normalization": preprocessingOptions.normalization,
                }

            # Read the data chunk
            loop = asyncio.get_event_loop()
            edf_file, total_samples = await loop.run_in_executor(
                None,
                read_edf_chunk,
                full_path,
                chunkStart,
                chunkSize,
                preprocessing_dict,
            )

            actual_chunk_size = len(edf_file.signals[0].data)
            samples_per_second = int(edf_file.signals[0].sampling_frequency)
            logger.info(
                f"EDF file chunk read successfully. "
                f"Number of signals: {len(edf_file.signals)}, "
                f"Chunk size: {actual_chunk_size} samples "
                f"({actual_chunk_size / samples_per_second:.2f} seconds at {samples_per_second} Hz)"
            )

            # Convert data to list format for JSON serialization
            # Use numpy's optimized operations to reduce precision and convert to list
            logger.info("Converting data to JSON format...")
            data = []
            for signal in edf_file.signals:
                # Round to 3 decimal places to reduce data size while maintaining sufficient precision
                # Convert to float16 to reduce memory usage during conversion
                reduced_data = np.round(signal.data, decimals=3).astype(np.float16)
                data.append(reduced_data.tolist())
            logger.info("Data conversion complete")

            logger.info("Creating EDFData object...")
            edf_data = EDFData(
                data=data,
                samplingFrequency=float(edf_file.signals[0].sampling_frequency),
                channelLabels=edf_file.labels,
                totalSamples=total_samples,
                chunkStart=chunkStart,
                chunkSize=actual_chunk_size,
            )
            logger.info("EDFData object created successfully")

            # Clear memory
            del data
            del edf_file

            logger.info("Returning EDFData...")
            return edf_data

        except Exception as e:
            logger.error(f"Error processing EDF file: {str(e)}")
            raise ValueError(f"Failed to process EDF file: {str(e)}")

    @strawberry.field
    async def get_dda_result(self, task_id: str) -> Optional[DDAResult]:
        """Get DDA analysis result.

        Args:
            task_id: Task ID

        Returns:
            DDA analysis result or None if not ready
        """
        result = await get_dda_result(task_id)
        if result is None:
            return None
        return DDAResult(**result)

    @strawberry.field
    async def get_task_status(self, task_id: str) -> DDAStatus:
        """Get task status.

        Args:
            task_id: Task ID

        Returns:
            Task status
        """
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
    """GraphQL mutation type."""

    @strawberry.mutation
    async def start_dda(
        self,
        file_path: str,
        preprocessing_options: Optional[PreprocessingOptionsInput] = None,
        info: strawberry.Info = None,
    ) -> DDAResult:
        """Start DDA analysis.

        Args:
            file_path: Path to the EDF file
            preprocessing_options: Optional preprocessing options
            info: GraphQL request info containing context

        Returns:
            DDA analysis result
        """
        background_tasks = info.context["background_tasks"]
        task_id = await start_dda(
            file_path=file_path,
            preprocessing_options=preprocessing_options,
            background_tasks=background_tasks,
        )
        return DDAResult(taskId=task_id, filePath=file_path, status="pending")


async def get_context(request: Request, background_tasks: BackgroundTasks):
    """Get GraphQL context with request and background tasks."""
    return {
        "request": request,
        "background_tasks": background_tasks,
    }


schema = strawberry.Schema(query=Query, mutation=Mutation)
graphql_app = GraphQLRouter(schema, context_getter=get_context)
