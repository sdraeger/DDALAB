"""DDA schemas."""

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel


class PreprocessingOptions(BaseModel):
    """Options for preprocessing EEG data before DDA."""

    filter_low: Optional[float] = None  # Lowpass filter cutoff frequency in Hz
    filter_high: Optional[float] = None  # Highpass filter cutoff frequency in Hz
    notch_filter: Optional[float] = None  # Notch filter frequency in Hz
    detrend: Optional[bool] = None  # Enable detrending
    resample: Optional[float] = None  # New sampling rate in Hz
    remove_outliers: Optional[bool] = None  # Enable outlier removal
    smoothing: Optional[bool] = None  # Enable smoothing
    smoothing_window: Optional[int] = None  # Smoothing window size
    normalization: Optional[str] = None  # Normalization method


class DDAAlgorithmSelection(BaseModel):
    """DDA algorithm variant selection."""
    enabled_variants: List[str] = ["single_timeseries"]  # List of enabled variant IDs


class DDARequest(BaseModel):
    """Request schema for DDA."""

    file_path: str  # Path to the EDF file to analyze
    preprocessing_options: Optional[PreprocessingOptions] = None
    channel_list: Optional[List[int]] = None  # 1-based channel indices to analyze
    algorithm_selection: Optional[DDAAlgorithmSelection] = None  # Algorithm variant selection


class DDAResponse(BaseModel):
    """Response schema for DDA."""

    file_path: str  # Path to the analyzed file
    Q: List[List[float]] = []  # DDA results (Q matrix)
    metadata: Optional[Dict[str, Any]] = None  # Additional metadata about the analysis
    preprocessing_options: Optional[Union[PreprocessingOptions, Dict[str, Any]]] = (
        None  # Applied preprocessing options
    )
    algorithm_selection: Optional[DDAAlgorithmSelection] = None  # Applied algorithm selection
    error: Optional[str] = None  # Error code if analysis failed
    error_message: Optional[str] = None  # Error message if analysis failed

    class Config:
        """Pydantic model configuration."""

        arbitrary_types_allowed = True
