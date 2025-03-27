"""GraphQL schema definitions."""

import asyncio
import os
from datetime import datetime, timezone
from typing import Optional

import numpy as np
import strawberry
from fastapi import Depends, Request
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from strawberry.fastapi import BaseContext, GraphQLRouter

from ..config import get_settings
from ..core.auth import get_current_user_from_request
from ..core.database import Annotation, FavoriteFile, get_db
from ..core.dda import get_dda_result, get_task_status, run_dda
from ..core.edf import get_edf_navigator, read_edf_chunk
from ..core.files import list_directory, validate_file_path
from .preprocessing import (
    PreprocessingOptionsInput,
    VisualizationPreprocessingOptionsInput,
)


class Context(BaseContext):
    def __init__(self, request: Request, session: AsyncSession):
        self.request = request
        self.session = session


async def get_context(request: Request, db_session: AsyncSession = Depends(get_db)):
    return Context(request=request, session=db_session)


@strawberry.type
class FileInfo:
    """File information type."""

    name: str
    path: str
    isDirectory: bool
    size: Optional[int] = None
    lastModified: Optional[str] = None
    isFavorite: Optional[bool] = False


@strawberry.type
class EDFChunkInfo:
    """EDF chunk information type."""

    start: int = strawberry.field(description="Start position in samples")
    end: int = strawberry.field(description="End position in samples")
    size: int = strawberry.field(description="Size of the chunk in samples")
    timeSeconds: float = strawberry.field(
        description="Duration of the chunk in seconds"
    )
    positionSeconds: float = strawberry.field(
        description="Position of the chunk in seconds from the start of the file"
    )


@strawberry.type
class EDFNavigationInfo:
    """EDF navigation information type."""

    totalSamples: int = strawberry.field(
        description="Total number of samples in the file"
    )
    fileDurationSeconds: float = strawberry.field(
        description="Total duration of the file in seconds"
    )
    numSignals: int = strawberry.field(description="Number of signals in the file")
    signalLabels: list[str] = strawberry.field(description="Labels of the signals")
    samplingFrequencies: list[float] = strawberry.field(
        description="Sampling frequencies for each signal"
    )
    chunks: list[EDFChunkInfo] = strawberry.field(
        description="Available chunk ranges based on the given chunk size"
    )


@strawberry.type
class EDFData:
    """EDF data type."""

    data: list[list[float]]
    samplingFrequency: float = strawberry.field(description="Sampling frequency in Hz")
    channelLabels: list[str]
    totalSamples: int
    chunkStart: int
    chunkSize: int
    navigationInfo: Optional[EDFNavigationInfo] = strawberry.field(
        description="Navigation information for the file"
    )
    chunkInfo: Optional[EDFChunkInfo] = strawberry.field(
        description="Information about the current chunk"
    )

    @strawberry.field
    def has_more(self) -> bool:
        """Check if there are more samples available after this chunk."""
        return bool(self.chunkStart + self.chunkSize < self.totalSamples)


@strawberry.type
class DDAResult:
    """DDA result type."""

    file_path: str
    Q: list[list[float]]
    metadata: Optional[str] = None


@strawberry.type
class DDAStatus:
    """DDA task status type."""

    taskId: str = strawberry.field(description="Task ID")
    status: str = strawberry.field(description="Task status")
    info: Optional[str] = strawberry.field(
        description="Additional information about the task"
    )


@strawberry.type
class AnnotationType:
    """Annotation type for GraphQL."""

    id: int
    user_id: int
    file_path: str
    start_time: int
    end_time: Optional[int] = None
    text: str
    created_at: str
    updated_at: str


@strawberry.type
class FavoriteFileType:
    """Favorite file type for GraphQL."""

    id: int
    user_id: int
    file_path: str
    created_at: str


@strawberry.input
class AnnotationInput:
    """Input for creating/updating annotations."""

    file_path: str
    start_time: int
    end_time: Optional[int] = None
    text: str


@strawberry.type
class Query:
    """GraphQL query type."""

    @strawberry.field
    async def list_directory(
        self,
        path: str,
        info: strawberry.Info[Context, None],
    ) -> list[FileInfo]:
        request = info.context.request
        current_user = await get_current_user_from_request(
            request, info.context.session
        )
        items = await list_directory(path)

        favorite_files = []
        if current_user:
            try:
                favorites = await info.context.session.execute(
                    select(FavoriteFile).where(FavoriteFile.user_id == current_user.id)
                )
                favorite_files = [fav.file_path for fav in favorites.scalars().all()]
            except Exception as e:
                logger.error(f"Error fetching favorite files: {e}")
                favorite_files = []

        file_info_list = []
        for item in items:
            is_favorite = item["path"] in favorite_files
            file_info_list.append(
                FileInfo(
                    name=item["name"],
                    path=item["path"],
                    isDirectory=item["type"] == "directory",
                    size=item.get("size"),
                    lastModified=item.get("last_modified"),
                    isFavorite=is_favorite,
                )
            )

        file_info_list.sort(
            key=lambda x: (not x.isFavorite, not x.isDirectory, x.name.lower())
        )
        return file_info_list

    @strawberry.field
    async def get_favorite_files(
        self, info: strawberry.Info = None
    ) -> list[FavoriteFileType]:
        """Get favorite files for the current user.

        Args:
            info: GraphQL request info containing context

        Returns:
            List of favorite files
        """
        # Get the current user from the request context
        request = info.context.request
        current_user = await get_current_user_from_request(
            request, info.context.session
        )

        # Get favorite files from the database
        db = info.context.session
        try:
            favorites = (
                db.query(FavoriteFile)
                .filter(FavoriteFile.user_id == current_user.id)
                .all()
            )

            return [
                FavoriteFileType(
                    id=fav.id,
                    user_id=fav.user_id,
                    file_path=fav.file_path,
                    created_at=fav.created_at.isoformat(),
                )
                for fav in favorites
            ]
        except Exception as e:
            logger.error(f"Error fetching favorite files: {e}")
            return []

    @strawberry.field
    async def get_edf_navigation(
        self,
        filename: str,
        chunkSize: int = 51_200,  # Default to 10 seconds at 512 Hz
    ) -> EDFNavigationInfo:
        """Get navigation information for an EDF file.

        Args:
            filename: Path to the EDF file
            chunkSize: Size to use for chunk calculations

        Returns:
            EDFNavigationInfo object with navigation data
        """
        try:
            # Validate file path
            if not await validate_file_path(filename):
                raise ValueError(f"Invalid file path: {filename}")

            settings = get_settings()
            full_path = os.path.join(settings.data_dir, filename)
            logger.info(f"Getting EDF navigation info: {full_path}")

            # Use the navigator to get file metadata without loading the entire file
            loop = asyncio.get_event_loop()
            navigator = await loop.run_in_executor(
                None,
                get_edf_navigator,
                full_path,
            )

            # Get navigation info and chunk ranges
            nav_info = navigator.get_navigation_info()
            chunk_ranges = navigator.get_chunk_ranges(chunkSize)

            # Convert snake_case to camelCase if needed
            if "total_samples" in nav_info:
                nav_info = {
                    "totalSamples": nav_info.get("total_samples", 0),
                    "fileDurationSeconds": nav_info.get("file_duration_seconds", 0),
                    "numSignals": nav_info.get("num_signals", 0),
                    "signalLabels": nav_info.get("signal_labels", []),
                    "samplingFrequencies": nav_info.get("sampling_frequencies", []),
                }

            # Convert snake_case to camelCase in chunks if needed
            converted_chunks = []
            for chunk in chunk_ranges:
                if "time_seconds" in chunk:
                    converted_chunks.append(
                        {
                            "start": chunk["start"],
                            "end": chunk["end"],
                            "size": chunk["size"],
                            "timeSeconds": chunk.get("time_seconds", 0),
                            "positionSeconds": chunk.get("position_seconds", 0),
                        }
                    )
                else:
                    converted_chunks.append(chunk)

            # Convert to schema types
            chunks = [
                EDFChunkInfo(
                    start=chunk["start"],
                    end=chunk["end"],
                    size=chunk["size"],
                    timeSeconds=chunk.get("timeSeconds", chunk.get("time_seconds", 0)),
                    positionSeconds=chunk.get(
                        "positionSeconds", chunk.get("position_seconds", 0)
                    ),
                )
                for chunk in converted_chunks
            ]

            return EDFNavigationInfo(
                totalSamples=nav_info.get(
                    "totalSamples", nav_info.get("total_samples", 0)
                ),
                fileDurationSeconds=nav_info.get(
                    "fileDurationSeconds", nav_info.get("file_duration_seconds", 0)
                ),
                numSignals=nav_info.get("numSignals", nav_info.get("num_signals", 0)),
                signalLabels=nav_info.get(
                    "signalLabels", nav_info.get("signal_labels", [])
                ),
                samplingFrequencies=nav_info.get(
                    "samplingFrequencies", nav_info.get("sampling_frequencies", [])
                ),
                chunks=chunks,
            )

        except Exception as e:
            logger.error(f"Error getting EDF navigation info: {str(e)}")
            raise ValueError(f"Failed to get EDF navigation info: {str(e)}")

    @strawberry.field
    async def get_edf_data(
        self,
        filename: str,
        chunkStart: int = 0,
        chunkSize: int = 51_200,  # Default to 10 seconds at 512 Hz for higher resolution files
        preprocessingOptions: Optional[VisualizationPreprocessingOptionsInput] = None,
        includeNavigationInfo: bool = False,  # Whether to include navigation info
    ) -> EDFData:
        """Get raw EDF data for a file.

        Args:
            filename: Path to the EDF file
            chunkStart: Start index for data chunk
            chunkSize: Size of data chunk to return (in samples)
            preprocessingOptions: Optional preprocessing options for visualization
            includeNavigationInfo: Whether to include navigation info in the response

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

            # Create a navigator instance to get additional information
            navigation_info = None
            chunk_info = None
            if includeNavigationInfo:
                loop = asyncio.get_event_loop()
                navigator = await loop.run_in_executor(
                    None,
                    get_edf_navigator,
                    full_path,
                )
                nav_info = navigator.get_navigation_info()
                chunk_ranges = navigator.get_chunk_ranges(chunkSize)

                # Convert snake_case to camelCase if needed
                if "total_samples" in nav_info:
                    nav_info = {
                        "totalSamples": nav_info.get("total_samples", 0),
                        "fileDurationSeconds": nav_info.get("file_duration_seconds", 0),
                        "numSignals": nav_info.get("num_signals", 0),
                        "signalLabels": nav_info.get("signal_labels", []),
                        "samplingFrequencies": nav_info.get("sampling_frequencies", []),
                    }

                # Convert snake_case to camelCase in chunks if needed
                converted_chunks = []
                for chunk in chunk_ranges:
                    if "time_seconds" in chunk:
                        converted_chunks.append(
                            {
                                "start": chunk["start"],
                                "end": chunk["end"],
                                "size": chunk["size"],
                                "timeSeconds": chunk.get("time_seconds", 0),
                                "positionSeconds": chunk.get("position_seconds", 0),
                            }
                        )
                    else:
                        converted_chunks.append(chunk)

                # Get current chunk info
                for chunk in converted_chunks:
                    if chunk["start"] <= chunkStart < chunk["end"]:
                        chunk_info = EDFChunkInfo(
                            start=chunk["start"],
                            end=chunk["end"],
                            size=chunk["size"],
                            timeSeconds=chunk.get(
                                "timeSeconds", chunk.get("time_seconds", 0)
                            ),
                            positionSeconds=chunk.get(
                                "positionSeconds", chunk.get("position_seconds", 0)
                            ),
                        )
                        break

                # Create navigation info object
                chunks = [
                    EDFChunkInfo(
                        start=chunk["start"],
                        end=chunk["end"],
                        size=chunk["size"],
                        timeSeconds=chunk.get(
                            "timeSeconds", chunk.get("time_seconds", 0)
                        ),
                        positionSeconds=chunk.get(
                            "positionSeconds", chunk.get("position_seconds", 0)
                        ),
                    )
                    for chunk in converted_chunks
                ]

                navigation_info = EDFNavigationInfo(
                    totalSamples=nav_info.get(
                        "totalSamples", nav_info.get("total_samples", 0)
                    ),
                    fileDurationSeconds=nav_info.get(
                        "fileDurationSeconds", nav_info.get("file_duration_seconds", 0)
                    ),
                    numSignals=nav_info.get(
                        "numSignals", nav_info.get("num_signals", 0)
                    ),
                    signalLabels=nav_info.get(
                        "signalLabels", nav_info.get("signal_labels", [])
                    ),
                    samplingFrequencies=nav_info.get(
                        "samplingFrequencies", nav_info.get("sampling_frequencies", [])
                    ),
                    chunks=chunks,
                )

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

            # If we didn't get chunk info from the navigator but have chunk data in the file
            if chunk_info is None and edf_file.chunk_info is not None:
                chunk_info = EDFChunkInfo(
                    start=edf_file.chunk_info["start"],
                    end=edf_file.chunk_info["end"],
                    size=edf_file.chunk_info["size"],
                    timeSeconds=edf_file.chunk_info["time_seconds"],
                    positionSeconds=edf_file.chunk_info["position_seconds"],
                )

            logger.info("Creating EDFData object...")
            edf_data = EDFData(
                data=data,
                samplingFrequency=float(edf_file.signals[0].sampling_frequency),
                channelLabels=edf_file.labels,
                totalSamples=total_samples,
                chunkStart=chunkStart,
                chunkSize=actual_chunk_size,
                navigationInfo=navigation_info,
                chunkInfo=chunk_info,
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

    @strawberry.field
    async def get_annotations(
        self, file_path: str, info: strawberry.Info[Context, None]
    ) -> list[AnnotationType]:
        """Get annotations for a file.

        Args:
            file_path: Path to the EDF file

        Returns:
            List of annotations for the file
        """
        # Get annotations from the database using async session
        annotations = await info.context.session.execute(
            select(Annotation).where(Annotation.file_path == file_path)
        )
        return [
            AnnotationType(
                id=annotation.id,
                user_id=annotation.user_id,
                file_path=annotation.file_path,
                start_time=annotation.start_time,
                end_time=annotation.end_time,
                text=annotation.text,
                created_at=annotation.created_at.isoformat(),
                updated_at=annotation.updated_at.isoformat(),
            )
            for annotation in annotations.scalars().all()
        ]


@strawberry.type
class Mutation:
    """GraphQL mutation type."""

    @strawberry.mutation
    async def run_dda(
        self,
        file_path: str,
        preprocessing_options: Optional[PreprocessingOptionsInput] = None,
    ) -> DDAStatus:
        """Run DDA.

        Args:
            file_path: Path to the EDF file
            preprocessing_options: Optional preprocessing options

        Returns:
            DDA status
        """
        task_id = await run_dda(
            file_path=file_path,
            preprocessing_options=preprocessing_options,
        )
        return DDAStatus(taskId=task_id, status="pending")

    @strawberry.mutation
    async def create_annotation(
        self, annotation_input: AnnotationInput, info: strawberry.Info[Context, None]
    ) -> AnnotationType:
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )

        await validate_file_path(annotation_input.file_path)

        annotation = Annotation(
            user_id=current_user.id,
            file_path=annotation_input.file_path,
            start_time=annotation_input.start_time,
            end_time=annotation_input.end_time,
            text=annotation_input.text,
        )

        info.context.session.add(annotation)

        await info.context.session.commit()
        await info.context.session.refresh(annotation)

        return AnnotationType(
            id=annotation.id,
            user_id=annotation.user_id,
            file_path=annotation.file_path,
            start_time=annotation.start_time,
            end_time=annotation.end_time,
            text=annotation.text,
            created_at=annotation.created_at.isoformat(),
            updated_at=annotation.updated_at.isoformat(),
        )

    @strawberry.mutation
    async def update_annotation(
        self,
        id: int,
        annotation_input: AnnotationInput,
        info: strawberry.Info[Context, None],
    ) -> AnnotationType:
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )
        annotation = await info.context.session.scalar(
            select(Annotation).where(Annotation.id == id)
        )

        if not annotation:
            raise ValueError(f"Annotation with ID {id} not found")

        if annotation.user_id != current_user.id and not current_user.is_admin:
            raise ValueError("Not authorized to update this annotation")

        annotation.file_path = annotation_input.file_path
        annotation.start_time = annotation_input.start_time
        annotation.end_time = annotation_input.end_time
        annotation.text = annotation_input.text
        annotation.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)

        await info.context.session.commit()
        await info.context.session.refresh(annotation)

        return AnnotationType(
            id=annotation.id,
            user_id=annotation.user_id,
            file_path=annotation.file_path,
            start_time=annotation.start_time,
            end_time=annotation.end_time,
            text=annotation.text,
            created_at=annotation.created_at.isoformat(),
            updated_at=annotation.updated_at.isoformat(),
        )

    @strawberry.mutation
    async def delete_annotation(
        self, id: int, info: strawberry.Info[Context, None]
    ) -> bool:
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )
        annotation = await info.context.session.scalar(
            select(Annotation).where(Annotation.id == id)
        )

        if not annotation:
            raise ValueError(f"Annotation with ID {id} not found")

        if annotation.user_id != current_user.id and not current_user.is_admin:
            raise ValueError("Not authorized to delete this annotation")

        await info.context.session.delete(annotation)
        await info.context.session.commit()

        return True

    @strawberry.mutation
    async def toggle_favorite_file(
        file_path: str, info: strawberry.Info[Context, None]
    ) -> bool:
        current_user = await get_current_user_from_request(
            info.context.request, info.context.session
        )
        try:
            favorite = await info.context.session.scalar(
                select(FavoriteFile).where(
                    FavoriteFile.user_id == current_user.id,
                    FavoriteFile.file_path == file_path,
                )
            )
            if favorite:
                await info.context.session.delete(favorite)
            else:
                new_favorite = FavoriteFile(
                    user_id=current_user.id,
                    file_path=file_path,
                    created_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
                info.context.session.add(new_favorite)
            await info.context.session.commit()
            return True
        except Exception as e:
            await info.context.session.rollback()
            logger.error(f"Error toggling favorite file: {e}")
            raise


# Create GraphQL app with context
schema = strawberry.Schema(query=Query, mutation=Mutation)
graphql_app = GraphQLRouter(
    schema,
    context_getter=get_context,
)
