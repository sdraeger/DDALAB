from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from time import perf_counter_ns

import numpy as np

from ..app.perf_logging import perf_logger
from ..domain.models import (
    ChannelWaveform,
    DdaVariantResult,
    WaveformEnvelopeLevel,
    WaveformWindow,
)

HEATMAP_COLOR_SCHEME_OPTIONS: tuple[tuple[str, str], ...] = (
    ("viridis", "Viridis"),
    ("plasma", "Plasma"),
    ("inferno", "Inferno"),
    ("jet", "Jet"),
    ("cool", "Cool"),
    ("hot", "Hot"),
)

LINE_PLOT_COLORS: tuple[str, ...] = (
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#06b6d4",
    "#f97316",
    "#84cc16",
)

WAVEFORM_LINE_COLOR = "#7dd3fc"

_VIRIDIS_STOPS = np.asarray(
    (
        (68, 1, 84),
        (72, 40, 120),
        (62, 73, 137),
        (49, 104, 142),
        (38, 130, 142),
        (31, 158, 137),
        (53, 183, 121),
        (109, 205, 89),
        (180, 222, 44),
        (253, 231, 37),
    ),
    dtype=np.float32,
)

_PLASMA_STOPS = np.asarray(
    (
        (13, 8, 135),
        (75, 3, 161),
        (125, 3, 168),
        (168, 34, 150),
        (203, 70, 121),
        (229, 107, 93),
        (248, 148, 65),
        (253, 195, 40),
        (239, 248, 33),
    ),
    dtype=np.float32,
)

_INFERNO_STOPS = np.asarray(
    (
        (0, 0, 4),
        (31, 12, 72),
        (85, 15, 109),
        (136, 34, 106),
        (186, 54, 85),
        (227, 89, 51),
        (249, 140, 10),
        (249, 201, 50),
        (252, 255, 164),
    ),
    dtype=np.float32,
)


@dataclass(frozen=True)
class MatrixView:
    values: np.ndarray
    sample_indices: tuple[int, ...]
    source_row_count: int
    source_column_count: int
    display_min_value: float
    display_max_value: float
    value_range: float
    row_labels: tuple[str, ...]
    row_start: int = 0
    total_row_count: int = 0

    @property
    def target_column_count(self) -> int:
        return int(self.values.shape[1]) if self.values.ndim == 2 else 0

    @property
    def visible_column_count(self) -> int:
        return len(set(self.sample_indices))


@dataclass(frozen=True)
class MatrixViewRequest:
    target_columns: int
    start_fraction: float = 0.0
    span_fraction: float = 1.0
    row_start: int = 0
    row_count: int | None = None
    max_rows: int | None = None


@dataclass(frozen=True)
class WaveformViewRequest:
    target_width: int
    channel_start: int = 0
    channel_count: int | None = None
    start_fraction: float = 0.0
    span_fraction: float = 1.0


@dataclass(frozen=True)
class DdaVariantPlotProvider:
    variant: DdaVariantResult

    def matrix_view(self, request: MatrixViewRequest) -> MatrixView:
        started_ns = perf_counter_ns()
        view = build_matrix_view(
            self.variant,
            target_columns=request.target_columns,
            start_fraction=request.start_fraction,
            span_fraction=request.span_fraction,
            row_start=request.row_start,
            row_count=request.row_count,
            max_rows=request.max_rows,
        )
        _log_slow_matrix_view_build(started_ns, view, request)
        return view


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


MatrixViewRenderKey = tuple[
    str,
    tuple[int, int],
    tuple[int, ...],
    float,
    float,
    str,
]

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
class LineGeometryView:
    lines: tuple[np.ndarray, ...]
    colors: tuple[str, ...]
    source_row_count: int
    source_column_count: int
    target_column_count: int


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


def build_matrix_view(
    variant: DdaVariantResult,
    *,
    target_columns: int,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
    row_start: int = 0,
    row_count: int | None = None,
    max_rows: int | None = None,
) -> MatrixView:
    rows = list(variant.matrix)
    labels = list(variant.row_labels)
    start_row = max(0, min(len(rows), int(row_start)))
    requested_row_count = len(rows) - start_row if row_count is None else int(row_count)
    visible_row_count = max(0, min(len(rows) - start_row, requested_row_count))
    if max_rows is not None:
        visible_row_count = min(visible_row_count, max(0, int(max_rows)))
    selected_rows = rows[start_row : start_row + visible_row_count]
    selected_labels = labels[start_row : start_row + visible_row_count]
    column_count = max(0, int(variant.effective_column_count))
    display_min_value, display_max_value = variant_plot_bounds(variant)
    value_range = max(display_max_value - display_min_value, 1e-6)

    if visible_row_count <= 0 or column_count <= 0:
        return MatrixView(
            values=np.zeros((0, 0), dtype=np.float32),
            sample_indices=(),
            source_row_count=visible_row_count,
            source_column_count=column_count,
            display_min_value=display_min_value,
            display_max_value=display_max_value,
            value_range=value_range,
            row_labels=tuple(selected_labels),
            row_start=start_row,
            total_row_count=len(rows),
        )

    target_count = max(1, min(column_count, int(target_columns)))
    sample_indices = tuple(
        windowed_resample_indices(
            column_count,
            target_count,
            start_fraction=start_fraction,
            span_fraction=span_fraction,
        )
    )
    values = np.full(
        (visible_row_count, len(sample_indices)),
        np.nan,
        dtype=np.float32,
    )
    for row_index, row in enumerate(selected_rows):
        if not row:
            continue
        row_values = np.asarray(row, dtype=np.float32)
        valid_positions = [
            position
            for position, source_index in enumerate(sample_indices)
            if source_index < len(row_values)
        ]
        if valid_positions:
            values[row_index, valid_positions] = row_values[
                [sample_indices[position] for position in valid_positions]
            ]

    return MatrixView(
        values=np.ascontiguousarray(values),
        sample_indices=sample_indices,
        source_row_count=visible_row_count,
        source_column_count=column_count,
        display_min_value=display_min_value,
        display_max_value=display_max_value,
        value_range=value_range,
        row_labels=tuple(selected_labels),
        row_start=start_row,
        total_row_count=len(rows),
    )


def build_line_geometry_view(
    view: MatrixView,
    *,
    max_rows: int = 8,
) -> LineGeometryView:
    if view.values.size == 0:
        return _empty_line_geometry_view(view)
    row_count = min(view.source_row_count, max(0, int(max_rows)))
    line_count = min(row_count, view.values.shape[0])
    lines: list[np.ndarray] = []
    colors: list[str] = []
    for row_index in range(line_count):
        values = view.values[row_index]
        if values.size <= 0:
            continue
        x = _x_fraction(len(values))
        y = 1.0 - np.clip(
            (np.where(np.isfinite(values), values, 0.0) - view.display_min_value)
            / view.value_range,
            0.0,
            1.0,
        )
        lines.append(np.ascontiguousarray(np.column_stack((x, y)), dtype=np.float32))
        colors.append(LINE_PLOT_COLORS[row_index % len(LINE_PLOT_COLORS)])
    return LineGeometryView(
        lines=tuple(lines),
        colors=tuple(colors),
        source_row_count=view.source_row_count,
        source_column_count=view.source_column_count,
        target_column_count=view.target_column_count,
    )


def matrix_view_render_key(view: MatrixView, color_scheme: str) -> MatrixViewRenderKey:
    values = np.ascontiguousarray(view.values)
    digest = hashlib.blake2b(values.view(np.uint8), digest_size=16).hexdigest()
    return (
        color_scheme,
        tuple(int(size) for size in values.shape),
        view.sample_indices,
        float(view.display_min_value),
        float(view.display_max_value),
        digest,
    )


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

    level = _select_waveform_envelope_level(
        channel.levels,
        sample_count=sample_count,
        target_width=width,
        target_segments_per_pixel=target_segments_per_pixel,
    )
    if level is None:
        level = _ensure_waveform_envelope_level(
            channel,
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


def heatmap_rgba(view: MatrixView, color_scheme: str) -> np.ndarray:
    if view.values.size == 0:
        return np.zeros((0, 0, 4), dtype=np.uint8)
    values = np.where(np.isfinite(view.values), view.values, 0.0)
    normalized = np.clip(
        (values - view.display_min_value) / view.value_range,
        0.0,
        1.0,
    )
    rgb = _heatmap_rgb(normalized, color_scheme)
    alpha = np.full((*normalized.shape, 1), 255, dtype=np.uint8)
    return np.ascontiguousarray(np.concatenate((rgb, alpha), axis=2))


def variant_plot_bounds(variant: DdaVariantResult) -> tuple[float, float]:
    min_value = _finite_or_zero(float(variant.min_value))
    max_value = _finite_or_zero(float(variant.max_value))
    if _variant_contains_nonfinite(variant):
        min_value = min(min_value, 0.0)
        max_value = max(max_value, 0.0)
    return min_value, max_value


def windowed_resample_indices(
    source_length: int,
    target_length: int,
    *,
    start_fraction: float,
    span_fraction: float,
) -> list[int]:
    if source_length <= 0 or target_length <= 0:
        return []
    if source_length == 1:
        return [0] * target_length
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    last_index = float(source_length - 1)
    window_start = start_fraction * last_index
    window_end = window_start + span_fraction * last_index
    if target_length == 1:
        midpoint = int(round((window_start + window_end) / 2.0))
        return [min(source_length - 1, max(0, midpoint))]
    return [
        min(
            source_length - 1,
            max(
                0,
                int(
                    round(
                        window_start
                        + position / (target_length - 1) * (window_end - window_start)
                    )
                ),
            ),
        )
        for position in range(target_length)
    ]


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
            _ensure_waveform_envelope_level(
                channel,
                target_width=width,
                target_segments_per_pixel=target_segments_per_pixel,
            )


def _log_slow_matrix_view_build(
    start_ns: int,
    view: MatrixView,
    request: MatrixViewRequest,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        "plot.provider.matrix_view",
        "plot.provider.matrix_view.build",
        duration_ms,
        threshold_ms=12.0,
        rows=view.source_row_count,
        rowStart=view.row_start,
        totalRows=view.total_row_count,
        sourceCols=view.source_column_count,
        targetCols=view.target_column_count,
        startFraction=request.start_fraction,
        spanFraction=request.span_fraction,
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


def _heatmap_rgb(normalized: np.ndarray, color_scheme: str) -> np.ndarray:
    if color_scheme == "plasma":
        return _interpolate_stops(normalized, _PLASMA_STOPS)
    if color_scheme == "inferno":
        return _interpolate_stops(normalized, _INFERNO_STOPS)
    if color_scheme == "jet":
        red = np.clip(1.5 - 4.0 * np.abs(normalized - 0.75), 0.0, 1.0)
        green = np.clip(1.5 - 4.0 * np.abs(normalized - 0.5), 0.0, 1.0)
        blue = np.clip(1.5 - 4.0 * np.abs(normalized - 0.25), 0.0, 1.0)
        return _stack_rgb(red, green, blue)
    if color_scheme == "cool":
        return _stack_rgb(normalized, 1.0 - normalized, np.ones_like(normalized))
    if color_scheme == "hot":
        red = np.where(normalized < 0.4, normalized / 0.4, 1.0)
        green = np.where(
            normalized < 0.4,
            0.0,
            np.where(normalized < 0.8, (normalized - 0.4) / 0.4, 1.0),
        )
        blue = np.where(normalized < 0.8, 0.0, (normalized - 0.8) / 0.2)
        return _stack_rgb(
            np.clip(red, 0.0, 1.0),
            np.clip(green, 0.0, 1.0),
            np.clip(blue, 0.0, 1.0),
        )
    return _interpolate_stops(normalized, _VIRIDIS_STOPS)


def _interpolate_stops(normalized: np.ndarray, stops: np.ndarray) -> np.ndarray:
    if len(stops) == 1:
        return np.broadcast_to(
            stops[0].round().astype(np.uint8),
            (*normalized.shape, 3),
        ).copy()
    position = normalized * float(len(stops) - 1)
    lower = np.minimum(position.astype(np.int64), len(stops) - 1)
    upper = np.minimum(lower + 1, len(stops) - 1)
    fraction = (position - lower)[..., np.newaxis]
    rgb = stops[lower] + fraction * (stops[upper] - stops[lower])
    return np.rint(rgb).astype(np.uint8)


def _stack_rgb(
    red: np.ndarray | float,
    green: np.ndarray | float,
    blue: np.ndarray | float,
) -> np.ndarray:
    channels = np.stack(np.broadcast_arrays(red, green, blue), axis=2)
    return np.rint(channels * 255.0).astype(np.uint8)


def _variant_contains_nonfinite(variant: DdaVariantResult) -> bool:
    return any(
        not math.isfinite(float(value)) for row in variant.matrix for value in row
    )


def _finite_or_zero(value: float) -> float:
    return value if math.isfinite(value) else 0.0


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _select_waveform_envelope_level(
    levels: list[WaveformEnvelopeLevel],
    *,
    sample_count: int,
    target_width: int,
    target_segments_per_pixel: float,
) -> WaveformEnvelopeLevel | None:
    if not levels:
        return None
    target_segments = max(int(target_width * target_segments_per_pixel), 1)
    ideal_bucket = max(1, math.ceil(sample_count / target_segments))
    selected = None
    for level in levels:
        if level.bucket_size <= ideal_bucket:
            selected = level
    return selected if selected is not None else levels[0]


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


def _ensure_waveform_envelope_level(
    channel: ChannelWaveform,
    *,
    target_width: int | float,
    target_segments_per_pixel: float,
) -> WaveformEnvelopeLevel:
    sample_count = len(channel.samples)
    target_segments = max(int(max(int(target_width), 1) * target_segments_per_pixel), 1)
    bucket_size = max(1, math.ceil(sample_count / target_segments))
    for level in channel.levels:
        if int(level.bucket_size) == bucket_size:
            return level
    samples = np.asarray(channel.samples, dtype=np.float32)
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


def _empty_line_geometry_view(view: MatrixView) -> LineGeometryView:
    return LineGeometryView(
        lines=(),
        colors=(),
        source_row_count=view.source_row_count,
        source_column_count=view.source_column_count,
        target_column_count=view.target_column_count,
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
    return (
        channel.name,
        float(channel.sample_rate_hz),
        len(channel.samples),
        float(channel.min_value),
        float(channel.max_value),
        sample_digest,
        tuple(level_keys),
    )


def _x_fraction(length: int) -> np.ndarray:
    if length <= 0:
        return np.zeros(0, dtype=np.float32)
    if length == 1:
        return np.zeros(1, dtype=np.float32)
    return np.linspace(0.0, 1.0, length, dtype=np.float32)


def _clamp_view_window(start: float, span: float) -> tuple[float, float]:
    clamped_span = max(0.0, min(1.0, float(span)))
    if clamped_span >= 1.0:
        return 0.0, 1.0
    clamped_start = max(0.0, min(1.0 - clamped_span, float(start)))
    return clamped_start, clamped_span


def _sample_window_bounds(
    sample_count: int,
    *,
    start_fraction: float,
    span_fraction: float,
) -> tuple[int, int]:
    if sample_count <= 0:
        return 0, 0
    if sample_count == 1:
        return 0, 1
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    if _is_full_view_window(start_fraction, span_fraction):
        return 0, sample_count
    last_index = sample_count - 1
    start_index = int(math.floor(start_fraction * last_index))
    end_index = int(math.ceil((start_fraction + span_fraction) * last_index))
    start_index = max(0, min(last_index, start_index))
    end_index = max(start_index, min(last_index, end_index))
    return start_index, end_index + 1


def _is_full_view_window(start_fraction: float, span_fraction: float) -> bool:
    return start_fraction <= 0.0 and span_fraction >= 1.0
