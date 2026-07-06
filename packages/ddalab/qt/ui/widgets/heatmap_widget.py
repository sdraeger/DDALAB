from __future__ import annotations

import math
from time import perf_counter_ns
from typing import List, Optional

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (
    QColor,
    QMouseEvent,
    QPainter,
    QPen,
    QPixmap,
)
from PySide6.QtWidgets import QWidget

from ...app.runtime.perf_logging import perf_logger
from ...domain.models import (
    DdaVariantResult,
    WaveformAnnotation,
)
from ..plot_data import (
    DdaVariantPlotProvider,
    HEATMAP_COLOR_SCHEME_OPTIONS,
    MatrixViewRequest,
    matrix_view_render_key,
)
from ..plot_layers import PlotLayerConfig
from ..qt_plot_renderer import heatmap_qimage
from ..style import current_theme_colors
from .plot_widget_helpers import (
    _clamp_view_window,
    _dda_plot_left_margin,
    _draw_plot_annotation_flag,
    _log_result_plot_paint,
    _normalize_cursor_fraction,
    _plot_cursor_fraction,
    _wheel_zoom_delta,
    _windowed_resample_indices,
    _zoom_view_window,
)


class HeatmapWidget(QWidget):
    view_window_changed = Signal(float, float)
    cursor_fraction_changed = Signal(float)
    annotation_context_requested = Signal(object, float, object, object)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(320)
        self.setMouseTracking(True)
        self.variant: Optional[DdaVariantResult] = None
        self.window_centers_seconds: List[float] = []
        self.annotations: List[WaveformAnnotation] = []
        self.color_scheme = "viridis"
        self._plot_layers = PlotLayerConfig()
        self._heatmap_pixmap: Optional[QPixmap] = None
        self._heatmap_pixmap_key: Optional[object] = None
        self._view_key: Optional[object] = None
        self._x_view_start = 0.0
        self._x_view_span = 1.0
        self._cursor_fraction = -1.0
        self._drag_origin: Optional[QPointF] = None
        self._drag_view_start = 0.0
        self.setToolTip("Scroll to zoom, drag to pan, double-click to reset.")

    def set_variant(
        self,
        variant: Optional[DdaVariantResult],
        window_centers_seconds: Optional[List[float]] = None,
        view_key: Optional[object] = None,
    ) -> None:
        normalized_window_centers = list(window_centers_seconds or [])
        normalized_key = view_key if variant is not None else None
        if normalized_key != self._view_key:
            self._invalidate_render_cache()
            self._reset_view()
        elif (
            variant is not self.variant
            or normalized_window_centers != self.window_centers_seconds
        ):
            self._invalidate_render_cache()
        self._view_key = normalized_key
        self.variant = variant
        self.window_centers_seconds = normalized_window_centers
        self.update()

    def set_annotations(self, annotations: List[WaveformAnnotation]) -> None:
        self.annotations = annotations
        self.update()

    def set_color_scheme(self, color_scheme: str) -> None:
        normalized = (
            color_scheme
            if any(color_scheme == option[0] for option in HEATMAP_COLOR_SCHEME_OPTIONS)
            else "viridis"
        )
        if normalized == self.color_scheme:
            return
        self.color_scheme = normalized
        self._invalidate_render_cache()
        self.update()

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        if layers == self._plot_layers:
            return False
        self._plot_layers = layers
        self.update()
        return True

    def plot_layers(self) -> PlotLayerConfig:
        return self._plot_layers

    def refresh_theme(self) -> None:
        self._invalidate_render_cache()
        self.update()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._invalidate_render_cache()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        paint_started_ns = perf_counter_ns()
        painter = QPainter(self)
        theme = current_theme_colors(self)
        painter.fillRect(self.rect(), QColor(theme.plot_surface))
        variant = self.variant
        if not variant or not variant.matrix or not variant.matrix[0]:
            painter.setPen(QColor(theme.plot_muted_text))
            painter.drawText(
                self.rect(), Qt.AlignCenter, "Run DDA to see a result heatmap"
            )
            _log_result_plot_paint(
                "heatmap",
                paint_started_ns,
                width=self.width(),
                height=self.height(),
                rows=0,
                source_columns=0,
            )
            return
        pixmap = self._ensure_heatmap_pixmap()
        if self._plot_layers.heatmap and pixmap is not None and not pixmap.isNull():
            painter.drawPixmap(self.rect(), pixmap)
        if self._plot_layers.annotations:
            self._draw_annotation_overlays(painter)
        self._draw_cursor_overlay(painter)
        _log_result_plot_paint(
            "heatmap",
            paint_started_ns,
            width=self.width(),
            height=self.height(),
            rows=len(variant.matrix),
            source_columns=variant.effective_column_count,
        )

    def wheelEvent(self, event) -> None:  # type: ignore[override]
        variant = self.variant
        if variant is None or variant.effective_column_count <= 1:
            return
        plot_rect = self._heatmap_plot_rect()
        if plot_rect.width() <= 0 or not plot_rect.contains(event.position()):
            return
        delta = _wheel_zoom_delta(event)
        if delta == 0:
            event.accept()
            return
        anchor_fraction = (event.position().x() - plot_rect.left()) / max(
            plot_rect.width(), 1.0
        )
        min_visible_columns = min(
            variant.effective_column_count,
            max(4, int(plot_rect.width() / 12.0)),
        )
        min_span = max(
            1.0 / max(variant.effective_column_count, 1),
            min_visible_columns / max(float(variant.effective_column_count), 1.0),
        )
        next_start, next_span = _zoom_view_window(
            self._x_view_start,
            self._x_view_span,
            anchor_fraction=anchor_fraction,
            zoom_in=delta > 0,
            min_span=min_span,
        )
        self._apply_view_window(next_start, next_span)
        event.accept()

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if event.button() == Qt.LeftButton:
            if self._reset_view(emit=True):
                self._invalidate_render_cache()
                self.update()
            event.accept()
            return
        super().mouseDoubleClickEvent(event)

    def mousePressEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if event.button() == Qt.LeftButton and self._heatmap_plot_rect().contains(
            event.position()
        ):
            self._drag_origin = event.position()
            self._drag_view_start = self._x_view_start
            self.setCursor(Qt.ClosedHandCursor)
            event.accept()
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if self._drag_origin is None:
            plot_rect = self._heatmap_plot_rect()
            if plot_rect.contains(event.position()):
                self.set_cursor_fraction(
                    _plot_cursor_fraction(plot_rect, event.position().x())
                )
                event.accept()
                return
            return super().mouseMoveEvent(event)
        plot_rect = self._heatmap_plot_rect()
        if plot_rect.width() <= 0:
            return
        delta_fraction = (event.position().x() - self._drag_origin.x()) / max(
            plot_rect.width(), 1.0
        )
        next_start, next_span = _clamp_view_window(
            self._drag_view_start - delta_fraction * self._x_view_span,
            self._x_view_span,
        )
        self._apply_view_window(next_start, next_span)
        event.accept()

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if event.button() == Qt.LeftButton and self._drag_origin is not None:
            self._drag_origin = None
            self.unsetCursor()
            event.accept()
            return
        super().mouseReleaseEvent(event)

    def leaveEvent(self, event) -> None:  # type: ignore[override]
        if self._drag_origin is None:
            self.unsetCursor()
        super().leaveEvent(event)

    def contextMenuEvent(self, event) -> None:  # type: ignore[override]
        variant = self.variant
        if variant is None or not variant.matrix or not variant.matrix[0]:
            return
        plot_rect = self._heatmap_plot_rect()
        if not plot_rect.contains(event.pos()):
            return
        seconds = self._seconds_at_x(event.pos().x())
        if seconds is None:
            return
        row_hint = self._row_label_at_y(event.pos().y())
        annotation = self._annotation_at(row_hint, seconds)
        self.annotation_context_requested.emit(
            self.mapToGlobal(event.pos()),
            seconds,
            row_hint,
            annotation,
        )
        event.accept()

    def _ensure_heatmap_pixmap(self) -> Optional[QPixmap]:
        variant = self.variant
        if (
            variant is None
            or not variant.matrix
            or not variant.matrix[0]
            or self.width() <= 0
            or self.height() <= 0
        ):
            return None
        rect = self._heatmap_plot_rect()
        cols = variant.effective_column_count
        target_cols = max(1, min(cols, int(rect.width())))
        matrix_view = DdaVariantPlotProvider(variant).matrix_view(
            MatrixViewRequest(
                target_columns=target_cols,
                start_fraction=self._x_view_start,
                span_fraction=self._x_view_span,
            )
        )
        rows = matrix_view.source_row_count
        cell_height = rect.height() / max(rows, 1)
        pixmap_key = (
            matrix_view_render_key(matrix_view, self.color_scheme),
            self.size().width(),
            self.size().height(),
        )
        if (
            self._heatmap_pixmap is not None
            and self._heatmap_pixmap_key == pixmap_key
            and self._heatmap_pixmap.size() == self.size()
        ):
            return self._heatmap_pixmap
        build_started_ns = perf_counter_ns()

        pixmap = QPixmap(self.size())
        theme = current_theme_colors(self)
        pixmap.fill(QColor(theme.plot_surface))
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing, False)

        image = heatmap_qimage(matrix_view, self.color_scheme)
        painter.drawImage(rect, image, QRectF(image.rect()))

        painter.setPen(QColor(theme.plot_text))
        label_width = max(int(rect.left() - 18.0), 20)
        for row_index, label in enumerate(matrix_view.row_labels):
            y = rect.top() + row_index * cell_height + cell_height * 0.65
            elided_label = painter.fontMetrics().elidedText(
                label,
                Qt.ElideRight,
                label_width,
            )
            painter.drawText(
                QRectF(6.0, y - 12.0, label_width, 20.0),
                Qt.AlignRight,
                elided_label,
            )
        if self._x_view_span < 0.999:
            painter.setPen(QColor(theme.plot_muted_text))
            visible_columns = max(1, matrix_view.visible_column_count)
            painter.drawText(
                QRectF(rect.left(), 2.0, rect.width(), 14.0),
                Qt.AlignRight | Qt.AlignVCenter,
                f"Showing {visible_columns} of {cols} columns",
            )
        painter.end()
        self._heatmap_pixmap = pixmap
        self._heatmap_pixmap_key = pixmap_key
        perf_logger().log_slow(
            "dda.heatmap_pixmap",
            "dda.heatmap_pixmap.build",
            (perf_counter_ns() - build_started_ns) / 1_000_000.0,
            threshold_ms=12.0,
            rows=rows,
            sourceCols=cols,
            targetCols=matrix_view.target_column_count,
            width=self.width(),
            height=self.height(),
        )
        return pixmap

    def _invalidate_render_cache(self) -> None:
        self._heatmap_pixmap = None
        self._heatmap_pixmap_key = None

    def set_view_window(self, start: float, span: float, *, emit: bool = True) -> bool:
        next_start, next_span = _clamp_view_window(start, span)
        if math.isclose(next_start, self._x_view_start) and math.isclose(
            next_span, self._x_view_span
        ):
            return False
        self._x_view_start = next_start
        self._x_view_span = next_span
        self._invalidate_render_cache()
        self.update()
        if emit:
            self.view_window_changed.emit(next_start, next_span)
        return True

    def view_window(self) -> tuple[float, float]:
        return self._x_view_start, self._x_view_span

    def set_cursor_fraction(
        self,
        fraction: float | None,
        *,
        emit: bool = True,
    ) -> bool:
        next_fraction = _normalize_cursor_fraction(fraction)
        if math.isclose(next_fraction, self._cursor_fraction):
            return False
        self._cursor_fraction = next_fraction
        self.update()
        if emit:
            self.cursor_fraction_changed.emit(next_fraction)
        return True

    def _apply_view_window(self, start: float, span: float) -> bool:
        return self.set_view_window(start, span)

    def _reset_view(self, *, emit: bool = False) -> bool:
        changed = not (
            math.isclose(self._x_view_start, 0.0)
            and math.isclose(self._x_view_span, 1.0)
        )
        self._x_view_start = 0.0
        self._x_view_span = 1.0
        self._drag_origin = None
        self._drag_view_start = 0.0
        if changed and emit:
            self.view_window_changed.emit(self._x_view_start, self._x_view_span)
        return changed

    def _heatmap_plot_rect(self) -> QRectF:
        left_gutter = _dda_plot_left_margin(self, self.variant)
        top_gutter = 12.0
        return QRectF(
            left_gutter,
            top_gutter,
            max(self.width() - left_gutter - 12.0, 20.0),
            max(self.height() - top_gutter - 12.0, 20.0),
        )

    def visible_time_range(self) -> Optional[tuple[float, float]]:
        variant = self.variant
        if variant is None or variant.effective_column_count <= 0:
            return None
        axis_values = self._axis_values(variant.effective_column_count)
        if not axis_values:
            return None
        sample_indices = _windowed_resample_indices(
            len(axis_values),
            2,
            start_fraction=self._x_view_start,
            span_fraction=self._x_view_span,
        )
        if not sample_indices:
            return None
        return (
            float(axis_values[sample_indices[0]]),
            float(axis_values[sample_indices[-1]]),
        )

    def _axis_values(self, column_count: int) -> List[float]:
        if column_count <= 0:
            return []
        if self.window_centers_seconds:
            return [
                float(
                    self.window_centers_seconds[
                        min(index, len(self.window_centers_seconds) - 1)
                    ]
                )
                for index in range(column_count)
            ]
        return [float(index) for index in range(column_count)]

    def _row_label_at_y(self, y: float) -> Optional[str]:
        variant = self.variant
        if variant is None or not variant.row_labels:
            return None
        rect = self._heatmap_plot_rect()
        if y < rect.top() or y > rect.bottom():
            return None
        row_height = rect.height() / max(len(variant.row_labels), 1)
        row_index = int((y - rect.top()) / max(row_height, 1.0))
        if row_index < 0 or row_index >= len(variant.row_labels):
            return None
        return variant.row_labels[row_index]

    def _seconds_at_x(self, x: float) -> Optional[float]:
        visible_range = self.visible_time_range()
        if visible_range is None:
            return None
        plot_rect = self._heatmap_plot_rect()
        if plot_rect.width() <= 0:
            return None
        fraction = max(
            0.0,
            min(1.0, (x - plot_rect.left()) / max(plot_rect.width(), 1.0)),
        )
        start_seconds, end_seconds = visible_range
        return start_seconds + fraction * (end_seconds - start_seconds)

    def _annotation_at(
        self,
        row_hint: Optional[str],
        seconds: float,
    ) -> Optional[WaveformAnnotation]:
        visible_range = self.visible_time_range()
        plot_rect = self._heatmap_plot_rect()
        if visible_range is None or not self.annotations or plot_rect.width() <= 0:
            return None
        threshold = max(
            (visible_range[1] - visible_range[0]) / max(plot_rect.width(), 1.0) * 8.0,
            0.05,
        )
        closest: Optional[WaveformAnnotation] = None
        best_distance = float("inf")
        for annotation in self.annotations:
            if row_hint is not None:
                if (
                    annotation.channel_name is not None
                    and annotation.channel_name != row_hint
                ):
                    continue
            elif annotation.channel_name is not None and self.variant is not None:
                if annotation.channel_name not in self.variant.row_labels:
                    continue
            if annotation.is_range and annotation.end_seconds is not None:
                if (
                    annotation.start_seconds - threshold
                    <= seconds
                    <= annotation.end_seconds + threshold
                ):
                    return annotation
                distance = min(
                    abs(seconds - annotation.start_seconds),
                    abs(seconds - annotation.end_seconds),
                )
            else:
                distance = abs(seconds - annotation.center_seconds)
            if distance <= threshold and distance < best_distance:
                closest = annotation
                best_distance = distance
        return closest

    def _draw_annotation_overlays(self, painter: QPainter) -> None:
        variant = self.variant
        visible_range = self.visible_time_range()
        if variant is None or visible_range is None or not self.annotations:
            return
        plot_rect = self._heatmap_plot_rect()
        rows = max(len(variant.row_labels), 1)
        row_height = plot_rect.height() / rows
        row_lookup = {label: index for index, label in enumerate(variant.row_labels)}
        start_seconds, end_seconds = visible_range
        theme = current_theme_colors(self)
        for annotation in self.annotations:
            target_rect = plot_rect
            if annotation.channel_name is not None:
                row_index = row_lookup.get(annotation.channel_name)
                if row_index is None:
                    continue
                target_rect = QRectF(
                    plot_rect.left(),
                    plot_rect.top() + row_index * row_height,
                    plot_rect.width(),
                    row_height,
                )
            color = QColor(
                theme.annotation_channel
                if annotation.channel_name
                else theme.annotation_global
            )
            if annotation.is_range and annotation.end_seconds is not None:
                if (
                    annotation.end_seconds < start_seconds
                    or annotation.start_seconds > end_seconds
                ):
                    continue
                left_fraction = (
                    max(annotation.start_seconds, start_seconds) - start_seconds
                ) / max(end_seconds - start_seconds, 1e-6)
                right_fraction = (
                    min(annotation.end_seconds, end_seconds) - start_seconds
                ) / max(end_seconds - start_seconds, 1e-6)
                overlay_rect = QRectF(
                    target_rect.left() + left_fraction * target_rect.width(),
                    target_rect.top(),
                    max(1.0, (right_fraction - left_fraction) * target_rect.width()),
                    target_rect.height(),
                )
                fill_color = QColor(color)
                fill_color.setAlpha(44)
                painter.fillRect(overlay_rect, fill_color)
                painter.setPen(QPen(color, 1.0))
                painter.drawRect(overlay_rect)
                _draw_plot_annotation_flag(
                    painter,
                    annotation.label,
                    overlay_rect.left(),
                    target_rect.top(),
                    color,
                    target_rect,
                )
            else:
                timestamp = annotation.center_seconds
                if timestamp < start_seconds or timestamp > end_seconds:
                    continue
                fraction = (timestamp - start_seconds) / max(
                    end_seconds - start_seconds, 1e-6
                )
                x = target_rect.left() + fraction * target_rect.width()
                painter.setPen(QPen(color, 1.5))
                painter.drawLine(
                    QPointF(x, target_rect.top()), QPointF(x, target_rect.bottom())
                )
                _draw_plot_annotation_flag(
                    painter,
                    annotation.label,
                    x,
                    target_rect.top(),
                    color,
                    target_rect,
                )

    def _draw_cursor_overlay(self, painter: QPainter) -> None:
        if not self._plot_layers.cursor or self._cursor_fraction < 0.0:
            return
        plot_rect = self._heatmap_plot_rect()
        x = plot_rect.left() + self._cursor_fraction * plot_rect.width()
        theme = current_theme_colors(self)
        painter.setPen(QPen(QColor(theme.viewport_border), 1.2))
        painter.drawLine(QPointF(x, plot_rect.top()), QPointF(x, plot_rect.bottom()))
