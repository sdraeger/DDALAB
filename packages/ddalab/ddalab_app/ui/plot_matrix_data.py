from __future__ import annotations

import hashlib
from dataclasses import dataclass
from time import perf_counter_ns

import numpy as np

from ..app.runtime.perf_logging import perf_logger
from ..domain.models import DdaVariantResult
from .plot_data_common import (
    LINE_PLOT_COLORS,
    _clamp_view_window,
    _sample_window_bounds,
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
    diverging: bool = False  # color limits are symmetric around zero

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
    target_rows: int | None = None  # aggregate rows beyond this many pixels


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
            target_rows=request.target_rows,
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
    target_rows: int | None = None,
) -> MatrixView:
    matrix = _variant_array(variant)
    labels = list(variant.row_labels)
    total_rows = matrix.shape[0]
    start_row = max(0, min(total_rows, int(row_start)))
    requested_row_count = total_rows - start_row if row_count is None else int(row_count)
    visible_row_count = max(0, min(total_rows - start_row, requested_row_count))
    if max_rows is not None:
        visible_row_count = min(visible_row_count, max(0, int(max_rows)))
    column_count = max(0, int(variant.effective_column_count))
    low, high, diverging = color_limits(variant)
    source_column_start, source_column_end = _sample_window_bounds(
        column_count,
        start_fraction=start_fraction,
        span_fraction=span_fraction,
    )
    block = matrix[start_row : start_row + visible_row_count, source_column_start:source_column_end]
    selected_labels = labels[start_row : start_row + visible_row_count]
    if block.size == 0:
        return MatrixView(
            values=np.zeros((0, 0), dtype=np.float32),
            sample_indices=(),
            source_row_count=visible_row_count,
            source_column_count=column_count,
            source_column_start=0,
            source_column_end=0,
            display_min_value=low,
            display_max_value=high,
            value_range=max(high - low, 1e-6),
            row_labels=tuple(selected_labels),
            row_start=start_row,
            total_row_count=total_rows,
            diverging=diverging,
        )
    # one value per pixel: the largest magnitude in each bucket, so a single
    # window or row that stands out is never skipped
    starts = _bucket_starts(block.shape[1], target_columns)
    values = _extreme_reduce(block, starts, axis=1)
    if target_rows is not None and values.shape[0] > max(1, int(target_rows)):
        row_starts = _bucket_starts(values.shape[0], target_rows)
        values = _extreme_reduce(values, row_starts, axis=0)
        selected_labels = [selected_labels[index] for index in row_starts]
    return MatrixView(
        values=np.ascontiguousarray(values),
        sample_indices=tuple(int(source_column_start + start) for start in starts),
        source_row_count=values.shape[0],
        source_column_count=column_count,
        source_column_start=source_column_start,
        source_column_end=source_column_end,
        display_min_value=low,
        display_max_value=high,
        value_range=max(high - low, 1e-6),
        row_labels=tuple(selected_labels),
        row_start=start_row,
        total_row_count=total_rows,
        diverging=diverging,
    )


def variant_rows(
    variant: DdaVariantResult,
    rows: list[int],
    *,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
) -> np.ndarray:
    """Every window of the given rows inside the view's time window."""
    start, end = _sample_window_bounds(
        max(0, int(variant.effective_column_count)),
        start_fraction=start_fraction,
        span_fraction=span_fraction,
    )
    return _variant_array(variant)[rows, start:end]


def _bucket_starts(length: int, target: int) -> np.ndarray:
    target = max(1, min(length, int(target)))
    return (np.arange(target) * length) // target


def _extreme_reduce(values: np.ndarray, starts: np.ndarray, *, axis: int) -> np.ndarray:
    """Per bucket, the value with the largest magnitude (NaN if the bucket is empty)."""
    high = np.fmax.reduceat(values, starts, axis=axis)
    low = np.fmin.reduceat(values, starts, axis=axis)
    return np.where(np.abs(high) >= np.abs(low), high, low)


def _variant_array(variant: DdaVariantResult) -> np.ndarray:
    """The variant matrix as a NaN-padded float32 array, built once per matrix."""
    cached = getattr(variant, "_plot_array", None)
    if cached is not None and cached[0] is variant.matrix:
        return cached[1]
    rows = variant.matrix or []
    array = np.full((len(rows), max(map(len, rows), default=0)), np.nan, dtype=np.float32)
    for index, row in enumerate(rows):
        array[index, : len(row)] = row
    setattr(variant, "_plot_array", (variant.matrix, array))
    return array


def color_limits(variant: DdaVariantResult) -> tuple[float, float, bool]:
    """Color range: the 1st to 99th percentile, so one outlier can't wash out the
    map; symmetric around zero (diverging) when the values change sign."""
    values = _variant_array(variant)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return 0.0, 1.0, False
    low, high = (float(v) for v in np.percentile(finite, [1.0, 99.0]))
    if low < 0.0 < high:
        bound = max(-low, high)
        return -bound, bound, True
    if high - low < 1e-12:
        return low - 0.5, high + 0.5, False
    return low, high, False


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
        request.target_rows,
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
    return color_limits(variant)[:2]


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

