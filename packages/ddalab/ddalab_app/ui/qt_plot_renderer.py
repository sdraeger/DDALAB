from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Protocol

import numpy as np

from PySide6.QtGui import QColor, QImage

from .plot_data import (
    LINE_PLOT_COLORS,
    MatrixView,
    WaveformGeometryView,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    heatmap_rgba,
)
from .plot_data_common import _finite_or_zero
from .plot_waveform_data import column_spans


@dataclass(frozen=True)
class MatrixRenderArtifacts:
    image: QImage
    line_image: QImage


class MatrixPlotRenderer(Protocol):
    name: str

    def render(
        self,
        view: MatrixView,
        *,
        color_scheme: str,
        line_size: tuple[int, int] = (0, 0),
        lines: np.ndarray | None = None,
    ) -> MatrixRenderArtifacts: ...


class QtCpuMatrixPlotRenderer:
    name = "Qt CPU matrix renderer"

    def render(
        self,
        view: MatrixView,
        *,
        color_scheme: str,
        line_size: tuple[int, int] = (0, 0),
        lines: np.ndarray | None = None,
    ) -> MatrixRenderArtifacts:
        width, height = line_size
        return MatrixRenderArtifacts(
            image=heatmap_qimage(view, color_scheme),
            line_image=lineplot_qimage(
                view.values[:8] if lines is None else lines,
                view.display_min_value,
                view.display_max_value,
                width=width or max(view.target_column_count, 512),
                height=height or 160,
            ),
        )


@dataclass(frozen=True)
class WaveformRenderArtifacts:
    image: QImage
    geometry: WaveformGeometryView


class WaveformPlotRenderer(Protocol):
    name: str

    def render(
        self,
        provider: WaveformWindowPlotProvider,
        request: WaveformViewRequest,
    ) -> WaveformRenderArtifacts: ...


class QtSceneGraphWaveformRenderer:
    name = "Qt Quick texture waveform renderer"

    def render(
        self,
        provider: WaveformWindowPlotProvider,
        request: WaveformViewRequest,
    ) -> WaveformRenderArtifacts:
        geometry = provider.geometry_view(request)
        return WaveformRenderArtifacts(
            image=waveform_qimage(
                geometry,
                width=request.target_width,
                height=request.target_height or max(160, geometry.channel_count * 72),
                pen_width=request.pen_width,
            ),
            geometry=geometry,
        )


def heatmap_qimage(view: MatrixView, color_scheme: str) -> QImage:
    image_data = heatmap_rgba(view, color_scheme)
    if image_data.size == 0:
        return QImage()
    return QImage(
        image_data.data,
        view.target_column_count,
        view.source_row_count,
        image_data.strides[0],
        QImage.Format_RGBA8888,
    ).copy()


def lineplot_qimage(
    rows: np.ndarray,
    min_value: float,
    max_value: float,
    *,
    width: int,
    height: int = 96,
) -> QImage:
    """One line per row, through every value (column spans, as for waveforms)."""
    if rows.size == 0:
        return QImage()
    width = max(1, int(width))
    low, high = _padded_bounds(min_value, max_value)
    return _spans_qimage(
        (
            (
                column_spans(1.0 - np.clip((row - low) / max(high - low, 1e-6), 0.0, 1.0), width),
                LINE_PLOT_COLORS[index % len(LINE_PLOT_COLORS)],
            )
            for index, row in enumerate(rows)
        ),
        width=width,
        height=height,
    )


def waveform_qimage(
    geometry: WaveformGeometryView,
    *,
    width: int,
    height: int,
    pen_width: int = 1,
) -> QImage:
    return _spans_qimage(
        zip(geometry.lines, geometry.colors),
        width=width,
        height=height,
        pen_width=pen_width,
    )


def _spans_qimage(
    traces: Iterable[tuple[np.ndarray, str]],
    *,
    width: int,
    height: int,
    pen_width: int = 1,
) -> QImage:
    """Rasterize per-column [low, high] spans (0 = top, 1 = bottom), one color each.

    One pixel of pen covers exactly the pixels a line through every sample touches.
    """
    width, height = max(1, int(width)), max(1, int(height))
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rows = np.arange(height, dtype=np.float32)[:, None]
    for spans, color in traces:
        low = np.rint(spans[:width, 0] * (height - 1))
        high = np.rint(spans[:width, 1] * (height - 1))
        if not np.isfinite(low).any():
            continue
        top, bottom = int(np.nanmin(low)), int(np.nanmax(high)) + 1
        # NaN compares False, so columns without data stay empty
        mask = (rows[top:bottom] >= low) & (rows[top:bottom] <= high)
        for shift in range(1, max(1, int(pen_width))):
            mask[:, shift:] |= mask[:, :-shift]
        rgba[top:bottom][mask] = QColor(color).getRgb()
    return QImage(
        rgba.data, width, height, rgba.strides[0], QImage.Format_RGBA8888
    ).copy()


def _padded_bounds(min_value: float, max_value: float) -> tuple[float, float]:
    min_value = _finite_or_zero(float(min_value))
    max_value = _finite_or_zero(float(max_value))
    if math.isclose(min_value, max_value, rel_tol=1e-9, abs_tol=1e-9):
        padding = max(abs(min_value) * 0.1, 1.0)
    else:
        padding = (max_value - min_value) * 0.08
    return min_value - padding, max_value + padding
