"""GraphQL queries."""

import asyncio
import os
from typing import List, Optional

import strawberry
from core.auth import get_current_user_from_request
from core.config import get_server_settings
from core.edf import get_edf_navigator, read_edf_chunk_cached
from core.edf.edf_cache import clear_global_cache, get_cache_manager
from core.files import list_directory, validate_file_path
from core.models import FavoriteFile
from core.services import AnnotationService, FavoriteFilesService
from core.services.errors import ServiceError
from loguru import logger
from schemas.preprocessing import VisualizationPreprocessingOptionsInput
from sqlalchemy import select

from .context import Context
from .types import (
    AnnotationType,
    DDAArtifactData,
    EDFChunkInfo,
    EDFData,
    EDFNavigationInfo,
    FavoriteFileType,
    FileInfo,
    UserType,
)

settings = get_server_settings()


@strawberry.type
class Query:
    """GraphQL query type."""

    @strawberry.field
    async def me(self, info: strawberry.Info[Context, None]) -> Optional[UserType]:
        """Get current user."""
        try:
            request = info.context.request
            user = await get_current_user_from_request(request)
            if not user:
                return None
            return UserType(
                id=str(user.id),
                username=user.username,
                email=user.email,
                first_name=user.first_name,
                last_name=user.last_name,
                is_active=user.is_active,
                is_admin=user.is_superuser,
            )
        except Exception as e:
            logger.error(f"Error getting current user: {e}")
            return None

    @strawberry.field
    async def list_directory(
        self,
        path: str,
        info: strawberry.Info[Context, None],
    ) -> list[FileInfo]:
        request = info.context.request

        logger.info(f"Request: {request.headers}")

        current_user = await get_current_user_from_request(request)
        items = await list_directory(path)
        logger.info(f"Path: {path}")
        logger.info(f"info: {info}")
        logger.info(f"Items: {items}")

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
                    isDirectory=item["is_directory"],
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
            stmt = select(FavoriteFile).filter(FavoriteFile.user_id == current_user.id)
            favorites = (await db.execute(stmt)).scalars().all()
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
        chunkSize: Optional[int] = 51_200,  # Default to 10 seconds at 512 Hz
    ) -> EDFNavigationInfo:
        """Get navigation information for an EDF file.

        Args:
            filename: Path to the EDF file
            chunkSize: Size to use for chunk calculations

        Returns:
            EDFNavigationInfo object with navigation data
        """
        try:
            # Handle None value for optional parameter
            if chunkSize is None:
                chunkSize = 51_200

            # Construct full path first
            full_path = os.path.join(settings.data_dir, filename)

            # Validate the full path
            if not await validate_file_path(full_path):
                raise ValueError(f"Invalid file path: {filename}")
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
        chunkStart: Optional[int] = 0,
        chunkSize: Optional[
            int
        ] = 51_200,  # Default to 10 seconds at 512 Hz for higher resolution files
        preprocessingOptions: Optional[VisualizationPreprocessingOptionsInput] = None,
        includeNavigationInfo: bool = False,  # Whether to include navigation info
    ) -> EDFData:
        """Get EDF data for a specific chunk.

        Args:
            filename: Path to the EDF file
            chunkStart: Start position in samples
            chunkSize: Size of the chunk to read
            preprocessingOptions: Optional preprocessing options
            includeNavigationInfo: Whether to include navigation info

        Returns:
            EDFData object with signal data and metadata
        """
        try:
            # Handle None values for optional parameters
            if chunkStart is None:
                chunkStart = 0
            if chunkSize is None:
                chunkSize = 51_200

            # Construct full path first
            full_path = os.path.join(settings.data_dir, filename)

            # Validate the full path
            if not await validate_file_path(full_path):
                raise ValueError(f"Invalid file path: {filename}")

            # Get the EDF data
            loop = asyncio.get_event_loop()
            data, metadata = await loop.run_in_executor(
                None,
                read_edf_chunk_cached,
                full_path,
                chunkStart,
                chunkSize,
                preprocessingOptions,
            )

            # Optimize data conversion - only convert to list when needed for GraphQL
            # Use numpy arrays for internal processing, convert to list only for serialization
            signal_data = []
            for signal in data.signals:
                # Convert to list only for GraphQL serialization
                signal_data.append(signal.data.tolist())

            # Get navigation info if requested - use cached navigator when possible
            navigation_info = None
            chunk_info = None
            if includeNavigationInfo:
                # Use the navigator to get file metadata without loading the entire file
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
                    totalSamples=nav_info.get("totalSamples", 0),
                    fileDurationSeconds=nav_info.get("fileDurationSeconds", 0),
                    numSignals=nav_info.get("numSignals", 0),
                    signalLabels=nav_info.get("signalLabels", []),
                    samplingFrequencies=nav_info.get("samplingFrequencies", []),
                    chunks=chunks,
                )

            # Create EDFData object with optimized data structure
            return EDFData(
                data=signal_data,
                samplingFrequency=data.sampling_frequencies[0]
                if data.sampling_frequencies
                else 256,
                channelLabels=data.labels,
                totalSamples=metadata,
                chunkStart=chunkStart,
                chunkSize=chunkSize,
                navigationInfo=navigation_info,
                chunkInfo=chunk_info,
            )

        except Exception as e:
            logger.error(f"Error getting EDF data: {str(e)}")
            raise ValueError(f"Failed to get EDF data: {str(e)}")

    @strawberry.field
    async def get_cache_stats(self) -> str:
        """Get EDF cache statistics for monitoring and debugging."""
        try:
            cache_manager = get_cache_manager()
            stats = cache_manager.get_cache_stats()

            return (
                f"EDF Cache Statistics:\n"
                f"Metadata Cache: {stats['metadata_cache']['size']}/{stats['metadata_cache']['max_size']} files\n"
                f"Chunk Cache: {stats['chunk_cache']['chunks']}/{stats['chunk_cache']['max_chunks']} chunks "
                f"({stats['chunk_cache']['size_mb']:.1f}/{stats['chunk_cache']['max_size_mb']} MB)\n"
                f"File Handles: {stats['file_handles']['open_handles']}/{stats['file_handles']['max_handles']} open\n"
            )
        except Exception as e:
            logger.error(f"Error getting cache stats: {e}")
            return f"Error getting cache stats: {str(e)}"

    @strawberry.field
    async def clear_edf_cache(self, file_path: Optional[str] = None) -> str:
        """Clear EDF cache for a specific file or all files."""
        try:
            if file_path:
                # Clear cache for specific file
                full_path = os.path.join(settings.data_dir, file_path)
                cache_manager = get_cache_manager()
                cache_manager.clear_file_cache(full_path)
                return f"Cleared cache for file: {file_path}"
            else:
                # Clear all caches
                clear_global_cache()
                return "Cleared all EDF caches"

        except Exception as e:
            logger.error(f"Error clearing cache: {e}")
            return f"Error clearing cache: {str(e)}"

    @strawberry.field
    async def annotations(self, user_id: Optional[int] = None) -> List[AnnotationType]:
        """Get all annotations for a user."""
        try:
            service = AnnotationService()
            results = (
                await service.get_by_user_id(user_id)
                if user_id
                else await service.get_all()
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
                for annotation in results
            ]
        except ServiceError as e:
            logger.error(f"Failed to get annotations: {e}")
            return []

    @strawberry.field
    async def favorite_files(
        self, user_id: Optional[int] = None
    ) -> List[FavoriteFileType]:
        """Get all favorite files for a user."""
        try:
            service = FavoriteFilesService()
            results = (
                await service.get_by_user_id(user_id)
                if user_id
                else await service.get_all()
            )
            return [
                FavoriteFileType(
                    id=fav.id,
                    user_id=fav.user_id,
                    file_path=fav.file_path,
                    created_at=fav.created_at.isoformat(),
                )
                for fav in results
            ]
        except ServiceError as e:
            logger.error(f"Failed to get favorite files: {e}")
            return []

    @strawberry.field
    async def get_edf_default_channels(
        self,
        filename: str,
        maxChannels: int = 5,
    ) -> list[str]:
        """Get intelligent default channel selection for an EDF file.

        This automatically filters out event/annotation channels and selects
        channels that contain actual EEG data based on signal variance.

        Args:
            filename: Path to the EDF file
            maxChannels: Maximum number of channels to return

        Returns:
            List of channel names that likely contain EEG data
        """
        logger.info(f"Getting intelligent default channels for {filename}")

        try:
            # Construct full path first (similar to get_edf_data)
            full_path = os.path.join(settings.data_dir, filename)

            # Validate the full path
            if not await validate_file_path(full_path):
                raise ValueError(f"Invalid file path: {filename}")

            cache_manager = get_cache_manager()

            default_channels = cache_manager.get_intelligent_default_channels(
                full_path, max_channels=maxChannels
            )

            logger.info(
                f"Selected {len(default_channels)} intelligent default channels: {default_channels}"
            )
            return default_channels

        except Exception as e:
            logger.error(f"Error getting intelligent default channels: {str(e)}")
            # Fallback: return empty list, let frontend handle
            return []

    @strawberry.field
    async def get_dda_artifact_data(
        self,
        artifact_path: str,
        info: strawberry.Info[Context, None],
    ) -> DDAArtifactData:
        """Get DDA artifact data from the artifact file path.

        Args:
            artifact_path: Path to the DDA result JSON file (MinIO object key)

        Returns:
            DDAArtifactData containing the original file path and DDA results
        """
        logger.info(f"Getting DDA artifact data for: {artifact_path}")

        try:
            import json

            # Get MinIO client from the GraphQL context
            minio_client = info.context.minio_client
            settings = get_server_settings()

            # Clean the path by removing any bucket prefix and extra slashes
            clean_path = artifact_path.strip("/")  # Remove leading/trailing slashes
            bucket_name = settings.minio_bucket_name

            # Remove any instances of the bucket name from the path
            while f"{bucket_name}/" in clean_path:
                clean_path = clean_path.replace(f"{bucket_name}/", "")

            # Remove any double slashes
            while "//" in clean_path:
                clean_path = clean_path.replace("//", "/")

            logger.info(f"Fetching from MinIO bucket {bucket_name}, path: {clean_path}")

            # Read the JSON file from MinIO
            try:
                response = minio_client.get_object(bucket_name, clean_path)
                artifact_data = json.loads(response.read().decode("utf-8"))
            except Exception as e:
                logger.error(f"Failed to read artifact from MinIO: {str(e)}")
                raise ValueError(f"Failed to read artifact: {str(e)}")

            # Extract the data
            original_file_path = artifact_data.get("file_path", "")
            Q = artifact_data.get("Q", [])
            metadata = artifact_data.get("metadata")
            user_id = artifact_data.get("user_id", 0)
            created_at = artifact_data.get("created_at", "")

            # Convert metadata to string if it's a dict
            metadata_str = (
                json.dumps(metadata)
                if isinstance(metadata, dict)
                else str(metadata)
                if metadata
                else None
            )

            logger.info(
                f"Successfully loaded DDA artifact. Original file: {original_file_path}"
            )

            return DDAArtifactData(
                originalFilePath=original_file_path,
                Q=Q,
                metadata=metadata_str,
                userId=user_id,
                createdAt=created_at,
            )

        except Exception as e:
            logger.error(f"Error loading DDA artifact data: {str(e)}")
            raise ValueError(f"Failed to load DDA artifact data: {str(e)}")
