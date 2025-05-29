"""Preprocessing schemas."""

import strawberry


@strawberry.input
class PreprocessingOptionsInput:
    """Preprocessing options input type."""

    resample: int | None = None
    lowpassFilter: int | None = None
    highpassFilter: int | None = None
    notchFilter: int | None = None
    detrend: bool = False
    removeOutliers: bool = False
    smoothing: bool = False
    smoothingWindow: int = 3
    normalization: str = "none"


@strawberry.input
class VisualizationPreprocessingOptionsInput:
    """Preprocessing options for visualization."""

    removeOutliers: bool = False
    smoothing: bool = False
    smoothingWindow: int = 3
    normalization: str = "none"
