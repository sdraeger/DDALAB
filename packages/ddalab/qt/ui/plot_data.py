from __future__ import annotations


from . import plot_matrix_data as _matrix_data
from .plot_data_common import (
    HEATMAP_COLOR_SCHEME_OPTIONS,
    LINE_PLOT_COLORS,
    WAVEFORM_LINE_COLOR,
    windowed_resample_indices,
)
from .plot_heatmap_data import heatmap_rgba
from .plot_matrix_data import (
    DdaVariantPlotProvider,
    LineGeometryView,
    MatrixTileCache,
    MatrixTileKey,
    MatrixView,
    MatrixViewRenderKey,
    MatrixViewRequest,
    build_line_geometry_view,
    build_matrix_view,
    matrix_tile_key,
    matrix_view_render_key,
)
from .plot_waveform_data import (
    WaveformGeometryView,
    WaveformRenderKey,
    WaveformTraceView,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_waveform_geometry_view,
    build_waveform_trace_view,
    ensure_waveform_levels_for_request,
    waveform_render_key,
)

_variant_contains_nonfinite = _matrix_data._variant_contains_nonfinite


def variant_plot_bounds(variant) -> tuple[float, float]:
    original = _matrix_data._variant_contains_nonfinite
    _matrix_data._variant_contains_nonfinite = _variant_contains_nonfinite
    try:
        return _matrix_data.variant_plot_bounds(variant)
    finally:
        _matrix_data._variant_contains_nonfinite = original


__all__ = [
    "DdaVariantPlotProvider",
    "HEATMAP_COLOR_SCHEME_OPTIONS",
    "LINE_PLOT_COLORS",
    "LineGeometryView",
    "MatrixTileCache",
    "MatrixTileKey",
    "MatrixView",
    "MatrixViewRenderKey",
    "MatrixViewRequest",
    "WAVEFORM_LINE_COLOR",
    "WaveformGeometryView",
    "WaveformRenderKey",
    "WaveformTraceView",
    "WaveformViewRequest",
    "WaveformWindowPlotProvider",
    "build_line_geometry_view",
    "build_matrix_view",
    "build_waveform_geometry_view",
    "build_waveform_trace_view",
    "ensure_waveform_levels_for_request",
    "heatmap_rgba",
    "matrix_tile_key",
    "matrix_view_render_key",
    "variant_plot_bounds",
    "waveform_render_key",
    "windowed_resample_indices",
]
