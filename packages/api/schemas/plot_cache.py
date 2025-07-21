"""Schemas for plot caching API."""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PlotParams(BaseModel):
    """Plot parameters for caching."""

    chunk_start: int = Field(..., description="Start position of the chunk")
    chunk_size: int = Field(..., description="Size of the chunk")
    preprocessing_options: Optional[Dict[str, Any]] = Field(
        None, description="Preprocessing options"
    )
    selected_channels: Optional[List[str]] = Field(
        None, description="Selected channels"
    )
    time_window: Optional[List[float]] = Field(
        None, description="Time window [start, end]"
    )
    zoom_level: Optional[float] = Field(None, description="Zoom level")


class CachePlotRequest(BaseModel):
    """Request model for caching a plot."""

    file_path: str = Field(..., description="Path to the EDF file")
    plot_params: PlotParams = Field(..., description="Plot parameters")
    plot_data: Dict[str, Any] = Field(..., description="Plot data to cache")
    ttl: Optional[int] = Field(None, description="Time to live in seconds")


class CachePlotResponse(BaseModel):
    """Response model for caching a plot."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    cache_key: Optional[str] = Field(None, description="Generated cache key")


class GetCachedPlotRequest(BaseModel):
    """Request model for retrieving a cached plot."""

    file_path: str = Field(..., description="Path to the EDF file")
    plot_params: PlotParams = Field(..., description="Plot parameters")


class GetCachedPlotResponse(BaseModel):
    """Response model for retrieving a cached plot."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    plot_data: Optional[Dict[str, Any]] = Field(None, description="Cached plot data")
    cached_at: Optional[str] = Field(None, description="When the plot was cached")


class CachedPlotMetadata(BaseModel):
    """Metadata for a cached plot."""

    cache_key: str = Field(..., description="Cache key")
    file_path: str = Field(..., description="Path to the EDF file")
    plot_params: PlotParams = Field(..., description="Plot parameters")
    cached_at: str = Field(..., description="When the plot was cached")
    ttl: int = Field(..., description="Time to live in seconds")


class UserCachedPlotsResponse(BaseModel):
    """Response model for getting user's cached plots."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    plots: List[CachedPlotMetadata] = Field(
        ..., description="List of cached plot metadata"
    )
    total_count: int = Field(..., description="Total number of cached plots")


class DeleteCachedPlotRequest(BaseModel):
    """Request model for deleting a cached plot."""

    file_path: str = Field(..., description="Path to the EDF file")
    plot_params: PlotParams = Field(..., description="Plot parameters")


class DeleteCachedPlotResponse(BaseModel):
    """Response model for deleting a cached plot."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    deleted: bool = Field(..., description="Whether the plot was deleted")


class DeleteFilePlotsRequest(BaseModel):
    """Request model for deleting all cached plots for a file."""

    file_path: str = Field(..., description="Path to the EDF file")


class DeleteFilePlotsResponse(BaseModel):
    """Response model for deleting all cached plots for a file."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    deleted_count: int = Field(..., description="Number of plots deleted")


class DeleteUserPlotsResponse(BaseModel):
    """Response model for deleting all user's cached plots."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    deleted_count: int = Field(..., description="Number of plots deleted")


class CleanupResponse(BaseModel):
    """Response model for cleanup operation."""

    success: bool = Field(..., description="Whether the operation was successful")
    message: str = Field(..., description="Response message")
    cleaned_count: int = Field(..., description="Number of expired plots cleaned up")
