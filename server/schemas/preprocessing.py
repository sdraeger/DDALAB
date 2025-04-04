"""Preprocessing schemas."""

import strawberry


@strawberry.input
class PreprocessingOptionsInput:
    """Preprocessing options input type."""

    resample1000hz: bool = False
    resample500hz: bool = False
    lowpassFilter: bool = False
    highpassFilter: bool = False
    notchFilter: bool = False
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
