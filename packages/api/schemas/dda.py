"""DDA analysis schemas."""

from typing import Dict, List, Optional, Union

from pydantic import BaseModel


class PreprocessingOptions(BaseModel):
    """Options for preprocessing EEG data before DDA analysis."""

    filter_low: Optional[float] = None  # Lowpass filter cutoff frequency in Hz
    filter_high: Optional[float] = None  # Highpass filter cutoff frequency in Hz


class DDARequest(BaseModel):
    """Request schema for DDA analysis."""

    file_path: str  # Path to the EDF file to analyze
    preprocessing_options: Optional[PreprocessingOptions] = None


class DDAResponse(BaseModel):
    """Response schema for DDA analysis."""

    file_path: str  # Path to the analyzed file
    Q: List[float]  # DDA analysis results (Q values)
    metadata: Dict[
        str, Union[str, int, float, List[str]]
    ]  # Additional metadata about the analysis
    preprocessing_options: Optional[PreprocessingOptions] = (
        None  # Applied preprocessing options
    )

    class Config:
        """Pydantic model configuration."""

        arbitrary_types_allowed = True
