from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from time import perf_counter_ns

import numpy as np

from ..app.runtime.perf_logging import perf_logger
from ..domain.models import ChannelWaveform, WaveformEnvelopeLevel, WaveformWindow
from .plot_data_common import (
    WAVEFORM_LINE_COLOR,
    _clamp_view_window,
    _finite_or_zero,
    _is_full_view_window,
    _optional_float,
    _sample_window_bounds,
    _x_fraction,
)


@dataclass(frozen=True)
class WaveformViewRequest:
    target_width: int
    channel_start: int = 0
    channel_count: int | None = None
    start_fraction: float = 0.0
    span_fraction: float = 1.0


WaveformRenderKey = tuple[
    str | None,
    float | None,
    float | None,
    int,
    float,
    float,
    tuple[tuple[object, ...], ...],
]


@dataclass(frozen=True)
class WaveformTraceView:
    mode: str
    sample_count: int
    bucket_size: int
    x_fraction: np.ndarray
    values: np.ndarray
    min_values: np.ndarray
    max_values: np.ndarray


@dataclass(frozen=True)
class WaveformGeometryView:
    lines: tuple[np.ndarray, ...]
    colors: tuple[str, ...]
    draw_modes: tuple[str, ...]
    channel_labels: tuple[str, ...]
    channel_count: int
    sample_count: int
    channel_start: int = 0
    total_channel_count: int = 0


@dataclass(frozen=True)
class WaveformWindowPlotProvider:
    window: WaveformWindow | None

    def render_key(self, request: WaveformViewRequest) -> WaveformRenderKey:
        ensure_waveform_levels_for_request(
            self.window,
            target_width=request.target_width,
            channel_start=request.channel_start,
            channel_count=request.channel_count,
            start_fraction=request.start_fraction,
            span_fraction=request.span_fraction,
        )
        return waveform_render_key(
            self.window,
            target_width=request.target_width,
            channel_start=request.channel_start,
            channel_count=request.channel_count,
            start_fraction=request.start_fraction,
            span_fraction=request.span_fraction,
        )

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
    window: WaveformWindow | None,
    *,
    target_width: int | float,
    channel_start: int = 0,
    channel_count: int | None = None,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
) -> WaveformRenderKey:
    target = max(1, int(target_width))
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    channels = _select_channels(
        list(getattr(window, "channels", []) or []),
        channel_start=channel_start,
        channel_count=channel_count,
    )
    return (
        getattr(window, "dataset_file_path", None),
        _optional_float(getattr(window, "start_time_seconds", None)),
        _optional_float(getattr(window, "duration_seconds", None)),
        target,
        start_fraction,
        span_fraction,
        tuple(_channel_render_key(channel) for channel in channels),
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
    if not channels:
        return _empty_waveform_geometry_view(
            channel_start=start,
            total_channel_count=total_channels,
        )
    channel_count = len(channels)
    lines: list[np.ndarray] = []
    colors: list[str] = []
    draw_modes: list[str] = []
    labels: list[str] = []
    total_samples = 0
    for channel_index, channel in enumerate(channels):
        trace = build_waveform_trace_view(
            channel,
            target_width=target_width,
            start_fraction=start_fraction,
            span_fraction=span_fraction,
        )
        total_samples += trace.sample_count
        labels.append(channel.name)
        if trace.mode == "samples":
            line = _waveform_sample_line(channel, trace, channel_index, channel_count)
            draw_mode = "line_strip"
        elif trace.mode == "envelope":
            line = _waveform_envelope_lines(
                channel, trace, channel_index, channel_count
            )
            draw_mode = "lines"
        else:
            continue
        if len(line) > 0:
            lines.append(line)
            colors.append(WAVEFORM_LINE_COLOR)
            draw_modes.append(draw_mode)
    return WaveformGeometryView(
        lines=tuple(lines),
        colors=tuple(colors),
        draw_modes=tuple(draw_modes),
        channel_labels=tuple(labels),
        channel_count=channel_count,
        sample_count=total_samples,
        channel_start=start,
        total_channel_count=total_channels,
    )


def build_waveform_trace_view(
    channel: ChannelWaveform,
    *,
    target_width: int | float,
    dense_sample_factor: int = 8,
    target_segments_per_pixel: float = 2.0,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
) -> WaveformTraceView:
    original_sample_count = len(channel.samples)
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    sample_start, sample_end = _sample_window_bounds(
        original_sample_count,
        start_fraction=start_fraction,
        span_fraction=span_fraction,
    )
    samples = np.asarray(channel.samples[sample_start:sample_end], dtype=np.float32)
    sample_count = int(samples.size)
    if sample_count <= 0:
        return _empty_waveform_trace(sample_count)

    width = max(int(target_width), 1)
    if sample_count <= width * max(int(dense_sample_factor), 1):
        return WaveformTraceView(
            mode="samples",
            sample_count=sample_count,
            bucket_size=1,
            x_fraction=_x_fraction(len(samples)),
            values=samples,
            min_values=np.zeros(0, dtype=np.float32),
            max_values=np.zeros(0, dtype=np.float32),
        )

    if not _is_full_view_window(start_fraction, span_fraction):
        return _build_waveform_envelope_from_samples(
            samples,
            target_width=width,
            target_segments_per_pixel=target_segments_per_pixel,
        )

    level = _select_or_build_waveform_envelope_level(
        channel,
        sample_count=sample_count,
        target_width=width,
        target_segments_per_pixel=target_segments_per_pixel,
    )

    point_count = min(len(level.mins), len(level.maxs))
    min_values = np.asarray(level.mins[:point_count], dtype=np.float32)
    max_values = np.asarray(level.maxs[:point_count], dtype=np.float32)
    return WaveformTraceView(
        mode="envelope" if point_count else "empty",
        sample_count=sample_count,
        bucket_size=level.bucket_size,
        x_fraction=_x_fraction(point_count),
        values=np.zeros(0, dtype=np.float32),
        min_values=min_values,
        max_values=max_values,
    )


def ensure_waveform_levels_for_request(
    window: WaveformWindow | None,
    *,
    target_width: int | float,
    channel_start: int = 0,
    channel_count: int | None = None,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
    dense_sample_factor: int = 8,
    target_segments_per_pixel: float = 2.0,
) -> None:
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    if not _is_full_view_window(start_fraction, span_fraction):
        return
    width = max(int(target_width), 1)
    for channel in _select_channels(
        list(getattr(window, "channels", []) or []),
        channel_start=channel_start,
        channel_count=channel_count,
    ):
        sample_count = len(channel.samples)
        if sample_count > width * max(int(dense_sample_factor), 1):
            _select_or_build_waveform_envelope_level(
                channel,
                sample_count=sample_count,
                target_width=width,
                target_segments_per_pixel=target_segments_per_pixel,
            )


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
        lines=len(geometry.lines),
        vertices=sum(len(line) for line in geometry.lines),
        targetWidth=request.target_width,
        startFraction=request.start_fraction,
        spanFraction=request.span_fraction,
    )


def _select_waveform_envelope_level(
    levels: list[WaveformEnvelopeLevel],
    *,
    sample_count: int,
    target_width: int,
    target_segments_per_pixel: float,
) -> WaveformEnvelopeLevel | None:
    if not levels:
        return None
    ideal_bucket = _waveform_envelope_bucket_size(
        sample_count,
        target_width=target_width,
        target_segments_per_pixel=target_segments_per_pixel,
    )
    selected = None
    for level in levels:
        if level.bucket_size <= ideal_bucket:
            selected = level
    return selected if selected is not None else levels[0]


def _select_or_build_waveform_envelope_level(
    channel: ChannelWaveform,
    *,
    sample_count: int,
    target_width: int,
    target_segments_per_pixel: float,
) -> WaveformEnvelopeLevel:
    ideal_bucket = _waveform_envelope_bucket_size(
        sample_count,
        target_width=target_width,
        target_segments_per_pixel=target_segments_per_pixel,
    )
    level = _select_waveform_envelope_level(
        channel.levels,
        sample_count=sample_count,
        target_width=target_width,
        target_segments_per_pixel=target_segments_per_pixel,
    )
    if level is not None:
        level_bucket = max(1, int(level.bucket_size))
        if level_bucket <= ideal_bucket and ideal_bucket / level_bucket <= 2.0:
            return level
    _ensure_waveform_envelope_pyramid(channel, max_bucket_size=ideal_bucket)
    level = _select_waveform_envelope_level(
        channel.levels,
        sample_count=sample_count,
        target_width=target_width,
        target_segments_per_pixel=target_segments_per_pixel,
    )
    if level is None:
        return _append_waveform_envelope_level(channel, ideal_bucket)
    return level


def _build_waveform_envelope_from_samples(
    samples: np.ndarray,
    *,
    target_width: int,
    target_segments_per_pixel: float,
) -> WaveformTraceView:
    sample_count = int(samples.size)
    if sample_count <= 0:
        return _empty_waveform_trace(sample_count)
    target_segments = max(int(max(int(target_width), 1) * target_segments_per_pixel), 1)
    bucket_size = max(1, math.ceil(sample_count / target_segments))
    bucket_starts = np.arange(0, sample_count, bucket_size)
    min_values = np.minimum.reduceat(samples, bucket_starts)
    max_values = np.maximum.reduceat(samples, bucket_starts)
    point_count = min(len(min_values), len(max_values))
    return WaveformTraceView(
        mode="envelope" if point_count else "empty",
        sample_count=sample_count,
        bucket_size=bucket_size,
        x_fraction=_x_fraction(point_count),
        values=np.zeros(0, dtype=np.float32),
        min_values=np.asarray(min_values[:point_count], dtype=np.float32),
        max_values=np.asarray(max_values[:point_count], dtype=np.float32),
    )


def _waveform_envelope_bucket_size(
    sample_count: int,
    *,
    target_width: int | float,
    target_segments_per_pixel: float,
) -> int:
    target_segments = max(int(max(int(target_width), 1) * target_segments_per_pixel), 1)
    return max(1, math.ceil(max(0, int(sample_count)) / target_segments))


def _ensure_waveform_envelope_pyramid(
    channel: ChannelWaveform,
    *,
    max_bucket_size: int,
) -> None:
    existing = {int(level.bucket_size) for level in channel.levels}
    for bucket_size in _waveform_pyramid_bucket_sizes(max_bucket_size):
        if bucket_size not in existing:
            _append_waveform_envelope_level(channel, bucket_size)
            existing.add(bucket_size)
    channel.levels.sort(key=lambda item: int(item.bucket_size))


def _waveform_pyramid_bucket_sizes(max_bucket_size: int) -> tuple[int, ...]:
    max_bucket = max(1, int(max_bucket_size))
    if max_bucket <= 4:
        return (max_bucket,)
    sizes: list[int] = []
    bucket_size = _largest_power_of_two(max_bucket // 4)
    bucket_size = max(4, bucket_size)
    while bucket_size < max_bucket:
        sizes.append(bucket_size)
        bucket_size *= 2
    sizes.append(max_bucket)
    return tuple(sizes)


def _largest_power_of_two(value: int) -> int:
    value = max(1, int(value))
    return 1 << (value.bit_length() - 1)


def _append_waveform_envelope_level(
    channel: ChannelWaveform,
    bucket_size: int,
) -> WaveformEnvelopeLevel:
    bucket_size = max(1, int(bucket_size))
    samples = np.asarray(channel.samples, dtype=np.float32)
    sample_count = int(samples.size)
    if sample_count <= 0:
        level = WaveformEnvelopeLevel(bucket_size=bucket_size, mins=[], maxs=[])
        channel.levels.append(level)
        channel.levels.sort(key=lambda item: int(item.bucket_size))
        return level
    bucket_starts = np.arange(0, sample_count, bucket_size)
    min_values = np.minimum.reduceat(samples, bucket_starts)
    max_values = np.maximum.reduceat(samples, bucket_starts)
    level = WaveformEnvelopeLevel(
        bucket_size=bucket_size,
        mins=[float(value) for value in min_values],
        maxs=[float(value) for value in max_values],
    )
    channel.levels.append(level)
    channel.levels.sort(key=lambda item: int(item.bucket_size))
    return level


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


def _empty_waveform_trace(sample_count: int) -> WaveformTraceView:
    empty = np.zeros(0, dtype=np.float32)
    return WaveformTraceView(
        mode="empty",
        sample_count=max(0, int(sample_count)),
        bucket_size=0,
        x_fraction=empty,
        values=empty,
        min_values=empty,
        max_values=empty,
    )


def _empty_waveform_geometry_view(
    *,
    channel_start: int = 0,
    total_channel_count: int = 0,
) -> WaveformGeometryView:
    return WaveformGeometryView(
        lines=(),
        colors=(),
        draw_modes=(),
        channel_labels=(),
        channel_count=0,
        sample_count=0,
        channel_start=channel_start,
        total_channel_count=total_channel_count,
    )


def _waveform_sample_line(
    channel: ChannelWaveform,
    trace: WaveformTraceView,
    channel_index: int,
    channel_count: int,
) -> np.ndarray:
    y = _waveform_y(channel, trace.values, channel_index, channel_count)
    return np.ascontiguousarray(
        np.column_stack((trace.x_fraction, y)), dtype=np.float32
    )


def _waveform_envelope_lines(
    channel: ChannelWaveform,
    trace: WaveformTraceView,
    channel_index: int,
    channel_count: int,
) -> np.ndarray:
    if len(trace.x_fraction) <= 0:
        return np.zeros((0, 2), dtype=np.float32)
    min_y = _waveform_y(channel, trace.min_values, channel_index, channel_count)
    max_y = _waveform_y(channel, trace.max_values, channel_index, channel_count)
    points = np.empty((len(trace.x_fraction) * 2, 2), dtype=np.float32)
    points[0::2, 0] = trace.x_fraction
    points[0::2, 1] = min_y
    points[1::2, 0] = trace.x_fraction
    points[1::2, 1] = max_y
    return np.ascontiguousarray(points)


def _waveform_y(
    channel: ChannelWaveform,
    values: np.ndarray,
    channel_index: int,
    channel_count: int,
) -> np.ndarray:
    min_value, max_value = _padded_channel_bounds(channel)
    value_range = max(max_value - min_value, 1e-6)
    local_y = 1.0 - np.clip(
        (np.where(np.isfinite(values), values, 0.0) - min_value) / value_range,
        0.0,
        1.0,
    )
    row_height = 1.0 / max(channel_count, 1)
    return (channel_index * row_height + local_y * row_height).astype(np.float32)


def _padded_channel_bounds(channel: ChannelWaveform) -> tuple[float, float]:
    min_value = _finite_or_zero(float(channel.min_value))
    max_value = _finite_or_zero(float(channel.max_value))
    if math.isclose(min_value, max_value, rel_tol=1e-9, abs_tol=1e-9):
        padding = max(abs(min_value) * 0.1, 1.0)
        return min_value - padding, max_value + padding
    return min_value, max_value


def _channel_render_key(channel: ChannelWaveform) -> tuple[object, ...]:
    cache_key = _channel_render_cache_key(channel)
    cached_key = getattr(channel, "_render_key_cache_key", None)
    cached_value = getattr(channel, "_render_key_cache", None)
    if cached_key == cache_key and cached_value is not None:
        return cached_value
    samples = np.asarray(channel.samples, dtype=np.float32)
    sample_digest = hashlib.blake2b(
        np.ascontiguousarray(samples).view(np.uint8),
        digest_size=16,
    ).hexdigest()
    level_keys = []
    for level in channel.levels:
        mins = np.asarray(level.mins, dtype=np.float32)
        maxs = np.asarray(level.maxs, dtype=np.float32)
        level_keys.append(
            (
                int(level.bucket_size),
                len(level.mins),
                len(level.maxs),
                hashlib.blake2b(
                    np.ascontiguousarray(mins).view(np.uint8),
                    digest_size=16,
                ).hexdigest(),
                hashlib.blake2b(
                    np.ascontiguousarray(maxs).view(np.uint8),
                    digest_size=16,
                ).hexdigest(),
            )
        )
    value = (
        channel.name,
        float(channel.sample_rate_hz),
        len(channel.samples),
        float(channel.min_value),
        float(channel.max_value),
        sample_digest,
        tuple(level_keys),
    )
    setattr(channel, "_render_key_cache_key", cache_key)
    setattr(channel, "_render_key_cache", value)
    return value


def _channel_render_cache_key(channel: ChannelWaveform) -> tuple[object, ...]:
    return (
        id(channel.samples),
        len(channel.samples),
        channel.name,
        float(channel.sample_rate_hz),
        float(channel.min_value),
        float(channel.max_value),
        tuple(
            (
                int(level.bucket_size),
                id(level.mins),
                id(level.maxs),
                len(level.mins),
                len(level.maxs),
            )
            for level in channel.levels
        ),
    )
