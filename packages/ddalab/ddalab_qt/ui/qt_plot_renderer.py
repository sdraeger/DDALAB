from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Protocol

from PySide6.QtCore import QPointF
from PySide6.QtGui import QColor, QImage, QPainter, QPainterPath, QPen

from .plot_data import (
    LINE_PLOT_COLORS,
    LineGeometryView,
    MatrixView,
    WaveformGeometryView,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_line_geometry_view,
    heatmap_rgba,
)


@dataclass(frozen=True)
class MatrixRenderArtifacts:
    image: QImage
    line_geometry: LineGeometryView


class MatrixPlotRenderer(Protocol):
    name: str

    def render(
        self, view: MatrixView, *, color_scheme: str
    ) -> MatrixRenderArtifacts: ...


class QtCpuMatrixPlotRenderer:
    name = "Qt CPU matrix renderer"

    def render(self, view: MatrixView, *, color_scheme: str) -> MatrixRenderArtifacts:
        return MatrixRenderArtifacts(
            image=heatmap_qimage(view, color_scheme),
            line_geometry=build_line_geometry_view(view),
        )


@dataclass(frozen=True)
class WaveformRenderArtifacts:
    geometry: WaveformGeometryView


class WaveformPlotRenderer(Protocol):
    name: str

    def render(
        self,
        provider: WaveformWindowPlotProvider,
        request: WaveformViewRequest,
    ) -> WaveformRenderArtifacts: ...


class QtSceneGraphWaveformRenderer:
    name = "Qt Quick scene graph waveform renderer"

    def render(
        self,
        provider: WaveformWindowPlotProvider,
        request: WaveformViewRequest,
    ) -> WaveformRenderArtifacts:
        return WaveformRenderArtifacts(geometry=provider.geometry_view(request))


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
    view: MatrixView,
    *,
    width: int | None = None,
    height: int = 96,
    max_rows: int = 8,
) -> QImage:
    if view.values.size == 0:
        return QImage()
    image_width = max(1, int(width or view.target_column_count or 1))
    image_height = max(1, int(height))
    image = QImage(image_width, image_height, QImage.Format_RGBA8888)
    image.fill(0)

    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing, view.target_column_count <= 512)
    painter.setPen(QPen(QColor("#2f4050"), 1.0))
    painter.drawLine(
        QPointF(0.0, image_height - 1.0),
        QPointF(float(image_width), image_height - 1.0),
    )

    min_value, max_value = _padded_bounds(
        view.display_min_value, view.display_max_value
    )
    value_range = max(max_value - min_value, 1e-6)
    row_count = min(view.source_row_count, max(0, int(max_rows)))
    for row_index in range(row_count):
        values = view.values[row_index]
        if values.size == 0:
            continue
        path = QPainterPath()
        for column_index, value in enumerate(values):
            x = _map_column_to_x(column_index, values.size, image_width)
            y = _map_value_to_y(
                _finite_or_zero(float(value)), min_value, value_range, image_height
            )
            if column_index == 0:
                path.moveTo(x, y)
            else:
                path.lineTo(x, y)
        painter.setPen(
            QPen(QColor(LINE_PLOT_COLORS[row_index % len(LINE_PLOT_COLORS)]), 1.5)
        )
        painter.drawPath(path)
    painter.end()
    return image


def _padded_bounds(min_value: float, max_value: float) -> tuple[float, float]:
    min_value = _finite_or_zero(float(min_value))
    max_value = _finite_or_zero(float(max_value))
    if math.isclose(min_value, max_value, rel_tol=1e-9, abs_tol=1e-9):
        padding = max(abs(min_value) * 0.1, 1.0)
    else:
        padding = (max_value - min_value) * 0.08
    return min_value - padding, max_value + padding


def _map_column_to_x(index: int, count: int, width: int) -> float:
    if count <= 1:
        return 0.0
    return index / float(count - 1) * max(float(width - 1), 1.0)


def _map_value_to_y(
    value: float, min_value: float, value_range: float, height: int
) -> float:
    fraction = max(0.0, min(1.0, (value - min_value) / value_range))
    return (1.0 - fraction) * max(float(height - 1), 1.0)


def _finite_or_zero(value: float) -> float:
    return value if math.isfinite(value) else 0.0
