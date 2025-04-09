"""GraphQL type definitions."""

from typing import Optional

import strawberry


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
    Q: list[list[float | None]]
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
