from __future__ import annotations

import math
from dataclasses import dataclass
from time import perf_counter_ns

import numpy as np

from ..app.runtime.perf_logging import perf_logger
from ..domain.models import ChannelWaveform, WaveformWindow
from .plot_data_common import (
    WAVEFORM_LINE_COLOR,
    _clamp_view_window,
    _finite_or_zero,
    _optional_float,
    _sample_window_bounds,
)


@dataclass(frozen=True)
class WaveformViewRequest:
    target_width: int
    channel_start: int = 0
    channel_count: int | None = None
    start_fraction: float = 0.0
    span_fraction: float = 1.0
    # device pixels; 0 lets the renderer pick a height from the channel count
    target_height: int = 0
    pen_width: int = 1


WaveformRenderKey = tuple[object, ...]


@dataclass(frozen=True)
class WaveformGeometryView:
    # per channel, a (target_width, 2) array of the [low, high] y (0 = top of the
    # plot, 1 = bottom) that a line through every sample covers in each pixel
    # column; NaN where the column has no data
    lines: tuple[np.ndarray, ...]
    colors: tuple[str, ...]
    draw_modes: tuple[str, ...]
    channel_labels: tuple[str, ...]
    channel_count: int
    sample_count: int
    channel_start: int = 0
    total_channel_count: int = 0
    # the value range each channel band spans, e.g. "-52.1 to 48 uV"
    channel_ranges: tuple[str, ...] = ()


@dataclass(frozen=True)
class WaveformWindowPlotProvider:
    window: WaveformWindow | None

    def render_key(self, request: WaveformViewRequest) -> WaveformRenderKey:
        return waveform_render_key(self.window, request)

    def geometry_view(self, request: WaveformViewRequest) -> WaveformGeometryView:
        started_ns = perf_counter_ns()
        geometry = build_waveform_geometry_view(
            self.window,
            target_width=request.target_width,
            channel_start=request.channel_start,
            channel_count=request.channel_count,
            start_fraction=request.start_fraction,
            span_fraction=request.span_fraction,
        )
        _log_slow_waveform_geometry_build(started_ns, geometry, request)
        return geometry


def waveform_render_key(
    window: WaveformWindow | None, request: WaveformViewRequest
) -> WaveformRenderKey:
    """What the image depends on; a reload of the same range gives the same key."""
    start_fraction, span_fraction = _clamp_view_window(
        request.start_fraction, request.span_fraction
    )
    channels = _select_channels(
        list(getattr(window, "channels", []) or []),
        channel_start=request.channel_start,
        channel_count=request.channel_count,
    )
    return (
        getattr(window, "dataset_file_path", None),
        _optional_float(getattr(window, "start_time_seconds", None)),
        _optional_float(getattr(window, "duration_seconds", None)),
        max(1, int(request.target_width)),
        int(request.target_height),
        int(request.pen_width),
        start_fraction,
        span_fraction,
        tuple(
            (channel.name, len(channel.samples), channel.min_value, channel.max_value)
            for channel in channels
        ),
    )


def build_waveform_geometry_view(
    window: WaveformWindow | None,
    *,
    target_width: int | float,
    channel_start: int = 0,
    channel_count: int | None = None,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
) -> WaveformGeometryView:
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    channels, start, total_channels = _select_channel_window(
        list(getattr(window, "channels", []) or []),
        channel_start=channel_start,
        channel_count=channel_count,
    )
    width = max(int(target_width), 1)
    spans: list[np.ndarray] = []
    ranges: list[str] = []
    total_samples = 0
    for row, channel in enumerate(channels):
        sample_start, sample_end = _sample_window_bounds(
            len(channel.samples),
            start_fraction=start_fraction,
            span_fraction=span_fraction,
        )
        values = np.asarray(channel.samples[sample_start:sample_end], dtype=np.float32)
        total_samples += int(values.size)
        low, high = _padded_channel_bounds(channel)
        ranges.append(f"{low:.3g} to {high:.3g} {channel.unit or ''}".rstrip())
        local_y = 1.0 - np.clip((values - low) / max(high - low, 1e-6), 0.0, 1.0)
        spans.append((row + column_spans(local_y, width)) / len(channels))
    return WaveformGeometryView(
        lines=tuple(spans),
        colors=(WAVEFORM_LINE_COLOR,) * len(spans),
        draw_modes=("columns",) * len(spans),
        channel_labels=tuple(channel.name for channel in channels),
        channel_count=len(channels),
        sample_count=total_samples,
        channel_start=start,
        total_channel_count=total_channels,
        channel_ranges=tuple(ranges),
    )


def column_spans(y: np.ndarray, width: int) -> np.ndarray:
    """[low, high] of y per pixel column covered by a line through every sample.

    Sample i sits at x = i * width / n, the same time mapping as the axis ticks.
    With at least one sample per column this is the column's min and max plus the
    join from the previous column's last sample (the M4 values), so the raster
    matches drawing every sample. With fewer samples the line is interpolated at
    the column edges. Columns without a finite sample stay NaN: a gap.
    """
    n = int(y.size)
    spans = np.full((width, 2), np.nan, dtype=np.float32)
    if n == 0:
        return spans
    if n >= width:
        edges = (np.arange(width + 1) * n) // width
        joins = np.r_[np.nan, y[edges[1:-1] - 1]]
        spans[:, 0] = np.fmin(np.fmin.reduceat(y, edges[:-1]), joins)
        spans[:, 1] = np.fmax(np.fmax.reduceat(y, edges[:-1]), joins)
        return spans
    x = np.arange(n) * (width / n)
    at_edges = np.interp(np.arange(width + 1), x, y, left=np.nan, right=np.nan)
    spans[:, 0] = np.fmin(at_edges[:-1], at_edges[1:])
    spans[:, 1] = np.fmax(at_edges[:-1], at_edges[1:])
    columns = np.minimum(x.astype(np.int64), width - 1)
    np.fmin.at(spans[:, 0], columns, y)
    np.fmax.at(spans[:, 1], columns, y)
    return spans


def _log_slow_waveform_geometry_build(
    start_ns: int,
    geometry: WaveformGeometryView,
    request: WaveformViewRequest,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        "plot.provider.waveform_geometry",
        "plot.provider.waveform_geometry.build",
        duration_ms,
        threshold_ms=12.0,
        channels=geometry.channel_count,
        channelStart=geometry.channel_start,
        totalChannels=geometry.total_channel_count,
        samples=geometry.sample_count,
        targetWidth=request.target_width,
        startFraction=request.start_fraction,
        spanFraction=request.span_fraction,
    )


def _select_channels(
    channels: list[ChannelWaveform],
    *,
    channel_start: int,
    channel_count: int | None,
) -> list[ChannelWaveform]:
    selected, _, _ = _select_channel_window(
        channels,
        channel_start=channel_start,
        channel_count=channel_count,
    )
    return selected


def _select_channel_window(
    channels: list[ChannelWaveform],
    *,
    channel_start: int,
    channel_count: int | None,
) -> tuple[list[ChannelWaveform], int, int]:
    start = max(0, min(len(channels), int(channel_start)))
    requested_count = (
        len(channels) - start if channel_count is None else int(channel_count)
    )
    count = max(0, min(len(channels) - start, requested_count))
    return channels[start : start + count], start, len(channels)


def _padded_channel_bounds(channel: ChannelWaveform) -> tuple[float, float]:
    min_value = _finite_or_zero(float(channel.min_value))
    max_value = _finite_or_zero(float(channel.max_value))
    if math.isclose(min_value, max_value, rel_tol=1e-9, abs_tol=1e-9):
        padding = max(abs(min_value) * 0.1, 1.0)
        return min_value - padding, max_value + padding
    return min_value, max_value
