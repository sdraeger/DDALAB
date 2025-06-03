"""GraphQL query resolvers."""

import asyncio
import os
from pathlib import Path
from typing import Optional

import numpy as np
import strawberry
from loguru import logger
from sqlalchemy import select

from ..core.auth import get_current_user_from_request
from ..core.config import get_server_settings
from ..core.database import Annotation, FavoriteFile
from ..core.edf import get_edf_navigator, read_edf_chunk_cached
from ..core.files import list_directory, validate_file_path
from ..schemas.preprocessing import VisualizationPreprocessingOptionsInput
from .context import Context
from .types import (
    AnnotationType,
    EDFChunkInfo,
    EDFData,
    EDFNavigationInfo,
    FavoriteFileType,
    FileInfo,
)

settings = get_server_settings()


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
                # Use cached metadata through the cache manager
                try:
                    from api.core.edf.edf_cache import get_cache_manager

                    cache_manager = get_cache_manager()
                    cached_metadata = cache_manager.get_file_metadata(full_path)

                    # Create navigation info from cached metadata
                    navigator = get_edf_navigator(full_path)
                    nav_info = {
                        "totalSamples": cached_metadata["total_samples"],
                        "fileDurationSeconds": cached_metadata["file_duration_seconds"],
                        "numSignals": cached_metadata["num_signals"],
                        "signalLabels": cached_metadata["signal_labels"],
                        "samplingFrequencies": cached_metadata["sampling_frequencies"],
                    }

                except Exception as e:
                    logger.warning(
                        f"Failed to use cached metadata, falling back to navigator: {e}"
                    )
                    # Fallback to regular navigator
                    navigator = get_edf_navigator(full_path)
                    nav_info = navigator.get_navigation_info()

                # Convert chunk ranges
                chunk_ranges = navigator.get_chunk_ranges(chunkSize)
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

            # Read the data chunk using cached reading
            loop = asyncio.get_event_loop()
            edf_file, total_samples = await loop.run_in_executor(
                None,
                read_edf_chunk_cached,  # Use the cached version
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
    async def get_cache_stats(self) -> str:
        """Get EDF cache statistics for monitoring and debugging."""
        try:
            from api.core.edf.edf_cache import get_cache_manager

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
            from api.core.edf.edf_cache import clear_global_cache, get_cache_manager

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
            # Validate filename
            filename = filename.replace("\\", "/").lstrip("/")
            base_path = Path(settings.data_dir)
            file_path = base_path / filename

            # Check if file exists
            if not file_path.exists():
                logger.error(f"EDF file not found: {file_path}")
                raise ValueError(f"EDF file not found: {filename}")

            # Get cache manager and intelligent default channels
            from packages.api.core.edf.edf_cache import get_cache_manager

            cache_manager = get_cache_manager()

            default_channels = cache_manager.get_intelligent_default_channels(
                str(file_path), max_channels=maxChannels
            )

            logger.info(
                f"Selected {len(default_channels)} intelligent default channels: {default_channels}"
            )
            return default_channels

        except Exception as e:
            logger.error(f"Error getting intelligent default channels: {str(e)}")
            # Fallback: return empty list, let frontend handle
            return []
