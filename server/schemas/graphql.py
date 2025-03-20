"""GraphQL schema definitions."""

import asyncio
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import numpy as np
import strawberry
from fastapi import BackgroundTasks, Request
from loguru import logger
from sqlalchemy.orm import Session
from strawberry.fastapi import GraphQLRouter

from ddalab.data.edf import read_edf_chunk

from ..config import get_settings
from ..core.auth import get_current_user_from_request
from ..core.database import Annotation, FavoriteFile, SessionLocal
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
    isFavorite: Optional[bool] = False


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
        """Check if there is more data available."""
        return bool(self.chunkStart + self.chunkSize < self.totalSamples)


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
        self, path: str = "", info: strawberry.Info = None
    ) -> List[FileInfo]:
        """List contents of a directory.

        Args:
            path: Directory path to list
            info: GraphQL request info containing context

        Returns:
            List of file information
        """
        # Get the current user from the request context
        request = info.context["request"]
        try:
            current_user = await get_current_user_from_request(request)
        except Exception:
            # If authentication fails or is disabled, proceed without a user
            current_user = None

        items = await list_directory(path)

        # Get favorite files for the current user
        favorite_files = []
        if current_user:
            db = SessionLocal()
            try:
                favorites = (
                    db.query(FavoriteFile)
                    .filter(FavoriteFile.user_id == current_user.id)
                    .all()
                )
                favorite_files = [fav.file_path for fav in favorites]
            finally:
                db.close()

        # Create file info with favorite status
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

        # Sort favorites to the top
        file_info_list.sort(
            key=lambda x: (not x.isFavorite, not x.isDirectory, x.name.lower())
        )

        return file_info_list

    @strawberry.field
    async def get_favorite_files(
        self, info: strawberry.Info = None
    ) -> List[FavoriteFileType]:
        """Get favorite files for the current user.

        Args:
            info: GraphQL request info containing context

        Returns:
            List of favorite files
        """
        # Get the current user from the request context
        request = info.context["request"]
        current_user = await get_current_user_from_request(request)

        # Get favorite files from the database
        db = SessionLocal()
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
        finally:
            db.close()

    @strawberry.field
    async def get_edf_data(
        self,
        filename: str,
        chunkStart: int = 0,
        chunkSize: int = 51_200,  # Default to 10 seconds at 512 Hz for higher resolution files
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

    @strawberry.field
    async def get_annotations(
        self, file_path: str, info: strawberry.Info = None
    ) -> List[AnnotationType]:
        """Get annotations for a file.

        Args:
            file_path: Path to the EDF file

        Returns:
            List of annotations for the file
        """
        # Get the current user from the request context
        request = info.context["request"]
        try:
            current_user = await get_current_user_from_request(request)
        except Exception:
            # If authentication fails or is disabled, proceed without a user
            current_user = None

        # Get annotations from the database using synchronous session
        db = SessionLocal()
        try:
            # Create query
            query = db.query(Annotation).filter(Annotation.file_path == file_path).all()

            # Convert database models to GraphQL types
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
                for annotation in query
            ]
        finally:
            db.close()


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

    @strawberry.mutation
    async def create_annotation(
        self, annotation_input: AnnotationInput, info: strawberry.Info = None
    ) -> AnnotationType:
        """Create a new annotation.

        Args:
            annotation_input: Annotation data

        Returns:
            Created annotation
        """
        # Get the current user from the request context
        request = info.context["request"]
        current_user = await get_current_user_from_request(request)

        if not current_user:
            raise ValueError("Authentication required")

        # Validate the file path
        if not await validate_file_path(annotation_input.file_path):
            raise ValueError(f"Invalid file path: {annotation_input.file_path}")

        # Create a new annotation
        now = datetime.utcnow()
        new_annotation = Annotation(
            user_id=current_user.id,
            file_path=annotation_input.file_path,
            start_time=annotation_input.start_time,
            end_time=annotation_input.end_time,
            text=annotation_input.text,
            created_at=now,
            updated_at=now,
        )

        # Save the annotation to the database
        db = SessionLocal()
        try:
            db.add(new_annotation)
            db.commit()
            db.refresh(new_annotation)

            # Convert the database model to a GraphQL type
            return AnnotationType(
                id=new_annotation.id,
                user_id=new_annotation.user_id,
                file_path=new_annotation.file_path,
                start_time=new_annotation.start_time,
                end_time=new_annotation.end_time,
                text=new_annotation.text,
                created_at=new_annotation.created_at.isoformat(),
                updated_at=new_annotation.updated_at.isoformat(),
            )
        finally:
            db.close()

    @strawberry.mutation
    async def update_annotation(
        self, id: int, annotation_input: AnnotationInput, info: strawberry.Info = None
    ) -> AnnotationType:
        """Update an existing annotation.

        Args:
            id: Annotation ID
            annotation_input: Updated annotation data

        Returns:
            Updated annotation
        """
        # Get the current user from the request context
        request = info.context["request"]
        current_user = await get_current_user_from_request(request)

        if not current_user:
            raise ValueError("Authentication required")

        # Get the annotation from the database
        db = SessionLocal()
        try:
            annotation = db.query(Annotation).filter(Annotation.id == id).first()

            if not annotation:
                raise ValueError(f"Annotation with ID {id} not found")

            # Check if the user is authorized to update this annotation
            if annotation.user_id != current_user.id and not current_user.is_admin:
                raise ValueError("Not authorized to update this annotation")

            # Update the annotation
            annotation.file_path = annotation_input.file_path
            annotation.start_time = annotation_input.start_time
            annotation.end_time = annotation_input.end_time
            annotation.text = annotation_input.text
            annotation.updated_at = datetime.utcnow()

            db.commit()
            db.refresh(annotation)

            # Convert the database model to a GraphQL type
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
        finally:
            db.close()

    @strawberry.mutation
    async def delete_annotation(self, id: int, info: strawberry.Info = None) -> bool:
        """Delete an annotation.

        Args:
            id: Annotation ID

        Returns:
            True if the annotation was deleted successfully
        """
        # Get the current user from the request context
        request = info.context["request"]
        current_user = await get_current_user_from_request(request)

        if not current_user:
            raise ValueError("Authentication required")

        # Get the annotation from the database
        db = SessionLocal()
        try:
            annotation = db.query(Annotation).filter(Annotation.id == id).first()

            if not annotation:
                raise ValueError(f"Annotation with ID {id} not found")

            # Check if the user is authorized to delete this annotation
            if annotation.user_id != current_user.id and not current_user.is_admin:
                raise ValueError("Not authorized to delete this annotation")

            # Delete the annotation
            db.delete(annotation)
            db.commit()

            return True
        finally:
            db.close()

    @strawberry.mutation
    async def toggle_favorite_file(
        self, file_path: str, info: strawberry.Info = None
    ) -> bool:
        """Toggle favorite status for a file.

        Args:
            file_path: Path to the file
            info: GraphQL request info containing context

        Returns:
            True if the file is now favorited, False if it was removed
        """
        # Get the current user from the request context
        request = info.context["request"]
        current_user = await get_current_user_from_request(request)

        # Check if the file exists
        if not await validate_file_path(file_path):
            raise ValueError(f"File not found: {file_path}")

        # Check if the file is already favorited
        db = SessionLocal()
        try:
            existing_favorite = (
                db.query(FavoriteFile)
                .filter(
                    FavoriteFile.user_id == current_user.id,
                    FavoriteFile.file_path == file_path,
                )
                .first()
            )

            if existing_favorite:
                # If it exists, remove it
                db.delete(existing_favorite)
                db.commit()
                return False
            else:
                # If it doesn't exist, add it
                new_favorite = FavoriteFile(
                    user_id=current_user.id, file_path=file_path
                )
                db.add(new_favorite)
                db.commit()
                return True
        finally:
            db.close()


async def get_context(request: Request, background_tasks: BackgroundTasks):
    """Get GraphQL context with request and background tasks."""
    return {
        "request": request,
        "background_tasks": background_tasks,
    }


schema = strawberry.Schema(query=Query, mutation=Mutation)
graphql_app = GraphQLRouter(schema, context_getter=get_context)
