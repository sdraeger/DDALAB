from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from time import perf_counter_ns

import numpy as np

from ..app.runtime.perf_logging import perf_logger
from ..domain.models import DdaVariantResult
from .plot_data_common import (
    LINE_PLOT_COLORS,
    _clamp_view_window,
    _finite_or_zero,
    _sample_window_bounds,
    _x_fraction,
    windowed_resample_indices,
)
from .render_cache import LruRenderCache


@dataclass(frozen=True)
class MatrixView:
    values: np.ndarray
    sample_indices: tuple[int, ...]
    source_row_count: int
    source_column_count: int
    source_column_start: int
    source_column_end: int
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


MatrixTileKey = tuple[
    str,
    int,
    float,
    float,
    int,
    int | None,
    int | None,
]


class MatrixTileCache:
    def __init__(self, capacity: int = 16) -> None:
        self._cache: LruRenderCache[MatrixTileKey, MatrixView] = LruRenderCache(
            capacity
        )

    @property
    def size(self) -> int:
        return self._cache.size

    def get(self, key: MatrixTileKey) -> MatrixView | None:
        return self._cache.get(key)

    def put(self, key: MatrixTileKey, view: MatrixView) -> None:
        self._cache.put(key, view)

    def clear(self) -> None:
        self._cache.clear()


MatrixViewRenderKey = tuple[
    str,
    tuple[int, int],
    tuple[int, ...],
    float,
    float,
    str,
]


@dataclass(frozen=True)
class LineGeometryView:
    lines: tuple[np.ndarray, ...]
    colors: tuple[str, ...]
    source_row_count: int
    source_column_count: int
    target_column_count: int


@dataclass(frozen=True)
class DdaVariantPlotProvider:
    variant: DdaVariantResult
    tile_cache: MatrixTileCache | None = None

    def matrix_view(self, request: MatrixViewRequest) -> MatrixView:
        tile_key = matrix_tile_key(self.variant, request)
        if self.tile_cache is not None:
            cached = self.tile_cache.get(tile_key)
            if cached is not None:
                return cached
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
        if self.tile_cache is not None:
            self.tile_cache.put(tile_key, view)
        _log_slow_matrix_view_build(started_ns, view, request)
        return view


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
            source_column_start=0,
            source_column_end=0,
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
        valid_positions: list[int] = []
        valid_values: list[float] = []
        row_length = len(row)
        for position, source_index in enumerate(sample_indices):
            if source_index < row_length:
                valid_positions.append(position)
                valid_values.append(float(row[source_index]))
        if valid_positions:
            values[row_index, valid_positions] = valid_values
    source_column_start, source_column_end = _sample_window_bounds(
        column_count,
        start_fraction=start_fraction,
        span_fraction=span_fraction,
    )

    return MatrixView(
        values=np.ascontiguousarray(values),
        sample_indices=sample_indices,
        source_row_count=visible_row_count,
        source_column_count=column_count,
        source_column_start=source_column_start,
        source_column_end=source_column_end,
        display_min_value=display_min_value,
        display_max_value=display_max_value,
        value_range=value_range,
        row_labels=tuple(selected_labels),
        row_start=start_row,
        total_row_count=len(rows),
    )


def matrix_tile_key(
    variant: DdaVariantResult,
    request: MatrixViewRequest,
) -> MatrixTileKey:
    return (
        _variant_matrix_identity(variant),
        max(1, int(request.target_columns)),
        *_clamp_view_window(request.start_fraction, request.span_fraction),
        max(0, int(request.row_start)),
        None if request.row_count is None else max(0, int(request.row_count)),
        None if request.max_rows is None else max(0, int(request.max_rows)),
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


def _variant_matrix_identity(variant: DdaVariantResult) -> str:
    return "|".join(
        (
            str(getattr(variant, "id", "")),
            str(getattr(variant, "label", "")),
            str(id(getattr(variant, "matrix", None))),
            str(int(getattr(variant, "effective_column_count", 0))),
            str(len(getattr(variant, "matrix", []) or [])),
        )
    )


def variant_plot_bounds(variant: DdaVariantResult) -> tuple[float, float]:
    min_value = _finite_or_zero(float(variant.min_value))
    max_value = _finite_or_zero(float(variant.max_value))
    if min_value <= 0.0 <= max_value:
        return min_value, max_value
    cache_key = _variant_bounds_cache_key(variant, min_value, max_value)
    cached_key = getattr(variant, "_plot_bounds_cache_key", None)
    cached_bounds = getattr(variant, "_plot_bounds_cache", None)
    if cached_key == cache_key and cached_bounds is not None:
        return cached_bounds
    if _variant_contains_nonfinite(variant):
        min_value = min(min_value, 0.0)
        max_value = max(max_value, 0.0)
    bounds = (min_value, max_value)
    setattr(variant, "_plot_bounds_cache_key", cache_key)
    setattr(variant, "_plot_bounds_cache", bounds)
    return bounds


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
        sourceColStart=view.source_column_start,
        sourceColEnd=view.source_column_end,
        targetCols=view.target_column_count,
        startFraction=request.start_fraction,
        spanFraction=request.span_fraction,
    )


def _variant_contains_nonfinite(variant: DdaVariantResult) -> bool:
    return any(
        not math.isfinite(float(value)) for row in variant.matrix for value in row
    )


def _empty_line_geometry_view(view: MatrixView) -> LineGeometryView:
    return LineGeometryView(
        lines=(),
        colors=(),
        source_row_count=view.source_row_count,
        source_column_count=view.source_column_count,
        target_column_count=view.target_column_count,
    )


def _variant_bounds_cache_key(
    variant: DdaVariantResult,
    min_value: float,
    max_value: float,
) -> tuple[object, ...]:
    return (
        id(variant.matrix),
        len(variant.matrix),
        tuple((id(row), len(row)) for row in variant.matrix),
        min_value,
        max_value,
    )
