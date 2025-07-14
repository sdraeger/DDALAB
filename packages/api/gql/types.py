"""GraphQL type definitions."""

from typing import List, Optional

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
    signalLabels: List[str] = strawberry.field(description="Labels of the signals")
    samplingFrequencies: List[float] = strawberry.field(
        description="Sampling frequencies for each signal"
    )
    chunks: List[EDFChunkInfo] = strawberry.field(
        description="Available chunk ranges based on the given chunk size"
    )


@strawberry.type
class EDFData:
    """EDF data type."""

    data: List[List[float]]
    samplingFrequency: float = strawberry.field(description="Sampling frequency in Hz")
    channelLabels: List[str]
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
    Q: List[List[Optional[float]]]
    metadata: Optional[str] = None
    error: Optional[str] = None
    error_message: Optional[str] = None


@strawberry.type
class DDAStatus:
    """DDA task status type."""

    taskId: str = strawberry.field(description="Task ID")
    status: str = strawberry.field(description="Task status")
    info: Optional[str] = strawberry.field(
        description="Additional information about the task"
    )


@strawberry.type
class DDAArtifactData:
    """DDA artifact data type."""

    originalFilePath: str = strawberry.field(
        description="Original EDF file path that was analyzed"
    )
    Q: List[List[Optional[float]]] = strawberry.field(
        description="DDA Q matrix results"
    )
    metadata: Optional[str] = strawberry.field(description="Additional metadata")
    userId: int = strawberry.field(description="User ID who created the artifact")
    createdAt: str = strawberry.field(description="Creation timestamp")


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


@strawberry.input
class AnnotationCreateInput:
    """Input type for creating annotations."""

    file_path: str
    start_time: int
    end_time: Optional[int] = None
    text: str


@strawberry.input
class AnnotationUpdateInput:
    """Input type for updating annotations."""

    file_path: Optional[str] = None
    start_time: Optional[int] = None
    end_time: Optional[int] = None
    text: Optional[str] = None


@strawberry.input
class PreprocessingOptionsInput:
    """Input for preprocessing options."""

    resample: Optional[int] = None
    lowpass_filter: Optional[int] = None
    highpass_filter: Optional[int] = None
    notch_filter: Optional[int] = None
    detrend: Optional[bool] = None
    remove_outliers: Optional[bool] = None
    smoothing: Optional[bool] = None
    smoothing_window: Optional[int] = None
    normalization: Optional[str] = None


@strawberry.type
class AuthResponse:
    """Authentication response type."""

    access_token: str
    token_type: str = "bearer"


@strawberry.type
class UserType:
    """User type for GraphQL."""

    id: str
    username: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False


@strawberry.input
class UserInput:
    """Input for creating/updating users."""

    username: str
    email: Optional[str] = None
    password: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False


@strawberry.input
class UserCreateInput:
    """Input type for creating users."""

    username: str
    password: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False
