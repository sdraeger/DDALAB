from __future__ import annotations

import math
from time import perf_counter_ns
from typing import List, Optional

from PySide6.QtCore import QPoint, QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (
    QColor,
    QMouseEvent,
    QPainter,
    QPainterPath,
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
    MatrixViewRequest,
    matrix_view_render_key,
    variant_plot_bounds,
)
from ..plot_layers import PlotLayerConfig
from ..style import current_theme_colors
from .plot_widget_helpers import (
    _LINE_PLOT_COLORS,
    _clamp_view_window,
    _dda_plot_left_margin,
    _draw_plot_annotation_flag,
    _log_result_plot_paint,
    _normalize_cursor_fraction,
    _plot_cursor_fraction,
    _plot_value,
    _wheel_zoom_delta,
    _zoom_view_window,
)


class DdaLinePlotWidget(QWidget):
    view_window_changed = Signal(float, float)
    cursor_fraction_changed = Signal(float)
    annotation_context_requested = Signal(object, float, object, object)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(240)
        self.setMouseTracking(True)
        self.variant: Optional[DdaVariantResult] = None
        self.window_centers_seconds: List[float] = []
        self.annotations: List[WaveformAnnotation] = []
        self._plot_layers = PlotLayerConfig()
        self._lineplot_pixmap: Optional[QPixmap] = None
        self._lineplot_pixmap_key: Optional[object] = None
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
                self.rect(),
                Qt.AlignCenter,
                "Run DDA to see the line plot",
            )
            _log_result_plot_paint(
                "lineplot",
                paint_started_ns,
                width=self.width(),
                height=self.height(),
                rows=0,
                source_columns=0,
            )
            return
        pixmap = self._ensure_lineplot_pixmap()
        if self._plot_layers.line and pixmap is not None and not pixmap.isNull():
            painter.drawPixmap(self.rect(), pixmap)
        if self._plot_layers.annotations:
            self._draw_annotation_overlays(painter)
        self._draw_cursor_overlay(painter)
        _log_result_plot_paint(
            "lineplot",
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
        plot_rect = self._line_plot_rect()
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
            max(8, int(plot_rect.width() / 10.0)),
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
        self.set_view_window(next_start, next_span)
        event.accept()

    def mouseDoubleClickEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if event.button() == Qt.LeftButton:
            if self._reset_view():
                self._invalidate_render_cache()
                self.update()
            event.accept()
            return
        super().mouseDoubleClickEvent(event)

    def mousePressEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if event.button() == Qt.LeftButton and self._line_plot_rect().contains(
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
            plot_rect = self._line_plot_rect()
            if plot_rect.contains(event.position()):
                self.set_cursor_fraction(
                    _plot_cursor_fraction(plot_rect, event.position().x())
                )
                event.accept()
                return
            return super().mouseMoveEvent(event)
        plot_rect = self._line_plot_rect()
        if plot_rect.width() <= 0:
            return
        delta_fraction = (event.position().x() - self._drag_origin.x()) / max(
            plot_rect.width(), 1.0
        )
        next_start, next_span = _clamp_view_window(
            self._drag_view_start - delta_fraction * self._x_view_span,
            self._x_view_span,
        )
        self.set_view_window(next_start, next_span)
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
        plot_state = self._line_plot_state()
        if plot_state is None:
            return
        plot_rect = plot_state["plot_rect"]
        if not plot_rect.contains(event.pos()):
            return
        seconds = self._seconds_at_x(event.pos().x())
        if seconds is None:
            return
        row_hint = self._nearest_row_label_at(event.pos())
        annotation = self._annotation_at(row_hint, seconds)
        self.annotation_context_requested.emit(
            self.mapToGlobal(event.pos()),
            seconds,
            row_hint,
            annotation,
        )
        event.accept()

    def _ensure_lineplot_pixmap(self) -> Optional[QPixmap]:
        plot_state = self._line_plot_state()
        if plot_state is None:
            return None
        pixmap_key = (
            plot_state["render_key"],
            self.size().width(),
            self.size().height(),
        )
        if (
            self._lineplot_pixmap is not None
            and self._lineplot_pixmap_key == pixmap_key
            and self._lineplot_pixmap.size() == self.size()
        ):
            return self._lineplot_pixmap

        matrix_view = plot_state["matrix_view"]
        row_count = plot_state["row_count"]
        column_count = plot_state["column_count"]
        min_value = plot_state["min_value"]
        max_value = plot_state["max_value"]
        plot_rect = plot_state["plot_rect"]
        left_margin = plot_rect.left()
        target_points = plot_state["target_points"]
        sample_indices = plot_state["sample_indices"]
        x_values = plot_state["x_values"]
        x_min = plot_state["x_min"]
        x_max = plot_state["x_max"]
        build_started_ns = perf_counter_ns()
        rendered_row_count = plot_state["rendered_row_count"]

        pixmap = QPixmap(self.size())
        theme = current_theme_colors(self)
        pixmap.fill(QColor(theme.plot_surface))
        painter = QPainter(pixmap)
        painter.setRenderHint(
            QPainter.Antialiasing,
            target_points <= 512 and row_count <= 8,
        )

        painter.fillRect(plot_rect, QColor(theme.plot_canvas))
        grid_pen = QPen(QColor(theme.plot_grid), 1.0)
        painter.setPen(grid_pen)
        for tick_index in range(5):
            y = plot_rect.top() + (tick_index / 4.0) * plot_rect.height()
            painter.drawLine(
                QPointF(plot_rect.left(), y),
                QPointF(plot_rect.right(), y),
            )
        for tick_index in range(6):
            x = plot_rect.left() + (tick_index / 5.0) * plot_rect.width()
            painter.drawLine(
                QPointF(x, plot_rect.top()),
                QPointF(x, plot_rect.bottom()),
            )

        painter.setPen(QPen(QColor(theme.plot_border), 1.2))
        painter.drawRect(plot_rect)

        def map_x(value: float) -> float:
            return (
                plot_rect.left()
                + ((value - x_min) / (x_max - x_min)) * plot_rect.width()
            )

        def map_y(value: float) -> float:
            return (
                plot_rect.bottom()
                - ((value - min_value) / (max_value - min_value)) * plot_rect.height()
            )

        for row_index, row in enumerate(matrix_view.values[:rendered_row_count]):
            if row.size <= 0:
                continue
            path = QPainterPath()
            for column_index, value in enumerate(row):
                x = map_x(x_values[min(column_index, len(x_values) - 1)])
                y = map_y(_plot_value(float(value)))
                if column_index == 0:
                    path.moveTo(x, y)
                else:
                    path.lineTo(x, y)
            pen = QPen(
                QColor(_LINE_PLOT_COLORS[row_index % len(_LINE_PLOT_COLORS)]), 1.6
            )
            painter.setPen(pen)
            painter.drawPath(path)

        painter.setPen(QColor(theme.plot_text))
        value_font = painter.font()
        value_font.setPointSize(max(8, value_font.pointSize() - 1))
        painter.setFont(value_font)
        for tick_index in range(5):
            fraction = tick_index / 4.0
            tick_value = max_value - fraction * (max_value - min_value)
            y = plot_rect.top() + fraction * plot_rect.height()
            painter.drawText(
                QRectF(6.0, y - 10.0, left_margin - 12.0, 20.0),
                Qt.AlignRight | Qt.AlignVCenter,
                f"{tick_value:.3f}",
            )
        for tick_index in range(6):
            fraction = tick_index / 5.0
            tick_value = x_min + fraction * (x_max - x_min)
            x = plot_rect.left() + fraction * plot_rect.width()
            painter.drawText(
                QRectF(x - 36.0, plot_rect.bottom() + 6.0, 72.0, 18.0),
                Qt.AlignHCenter | Qt.AlignTop,
                f"{tick_value:.1f}",
            )

        painter.setFont(value_font)
        painter.setPen(QColor(theme.plot_muted_text))
        painter.drawText(
            QRectF(left_margin, plot_rect.bottom() + 18.0, plot_rect.width(), 18.0),
            Qt.AlignCenter,
            "Window center (s)",
        )
        painter.save()
        painter.translate(14.0, plot_rect.center().y())
        painter.rotate(-90.0)
        painter.drawText(
            QRectF(-plot_rect.height() / 2.0, -10.0, plot_rect.height(), 20.0),
            Qt.AlignCenter,
            "DDA value",
        )
        painter.restore()

        legend_entries = min(row_count, 6)
        legend_x = plot_rect.right() - 190.0
        legend_y = plot_rect.top() + 8.0
        if self._x_view_span < 0.999:
            painter.drawText(
                QRectF(plot_rect.left(), 2.0, plot_rect.width(), 14.0),
                Qt.AlignRight | Qt.AlignVCenter,
                f"Showing {max(1, len(set(sample_indices)))} of {column_count} columns",
            )
        for row_index in range(legend_entries):
            label = (
                matrix_view.row_labels[row_index]
                if row_index < len(matrix_view.row_labels)
                else f"Row {row_index + 1}"
            )
            color = QColor(_LINE_PLOT_COLORS[row_index % len(_LINE_PLOT_COLORS)])
            painter.setPen(QPen(color, 2.4))
            y = legend_y + row_index * 18.0 + 8.0
            painter.drawLine(QPointF(legend_x, y), QPointF(legend_x + 16.0, y))
            painter.setPen(QColor(theme.plot_text))
            painter.drawText(
                QRectF(legend_x + 22.0, y - 8.0, 160.0, 16.0),
                Qt.AlignLeft | Qt.AlignVCenter,
                painter.fontMetrics().elidedText(label, Qt.ElideRight, 156),
            )
        if row_count > legend_entries:
            painter.setPen(QColor(theme.plot_muted_text))
            painter.drawText(
                QRectF(legend_x, legend_y + legend_entries * 18.0 + 2.0, 180.0, 16.0),
                Qt.AlignLeft | Qt.AlignVCenter,
                f"+{row_count - legend_entries} more",
            )

        painter.end()
        self._lineplot_pixmap = pixmap
        self._lineplot_pixmap_key = pixmap_key
        perf_logger().log_slow(
            "dda.lineplot_pixmap",
            "dda.lineplot_pixmap.build",
            (perf_counter_ns() - build_started_ns) / 1_000_000.0,
            threshold_ms=12.0,
            rows=row_count,
            sourceCols=column_count,
            targetPoints=target_points,
            width=self.width(),
            height=self.height(),
        )
        return pixmap

    def _x_values(self, sample_indices: List[int]) -> List[float]:
        if self.window_centers_seconds:
            return [
                float(
                    self.window_centers_seconds[
                        min(index, len(self.window_centers_seconds) - 1)
                    ]
                )
                for index in sample_indices
            ]
        return [float(index) for index in sample_indices]

    def _invalidate_render_cache(self) -> None:
        self._lineplot_pixmap = None
        self._lineplot_pixmap_key = None

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

    def _reset_view(self) -> bool:
        changed = not (
            math.isclose(self._x_view_start, 0.0)
            and math.isclose(self._x_view_span, 1.0)
        )
        self._x_view_start = 0.0
        self._x_view_span = 1.0
        self._drag_origin = None
        self._drag_view_start = 0.0
        return changed

    def _line_plot_rect(self) -> QRectF:
        left_margin = _dda_plot_left_margin(self, self.variant)
        top_margin = 18.0
        right_margin = 20.0
        bottom_margin = 38.0
        return QRectF(
            left_margin,
            top_margin,
            max(20.0, self.width() - left_margin - right_margin),
            max(20.0, self.height() - top_margin - bottom_margin),
        )

    def visible_time_range(self) -> Optional[tuple[float, float]]:
        plot_state = self._line_plot_state()
        if plot_state is None:
            return None
        return (float(plot_state["x_min"]), float(plot_state["x_max"]))

    def _seconds_at_x(self, x: float) -> Optional[float]:
        plot_state = self._line_plot_state()
        if plot_state is None:
            return None
        plot_rect = plot_state["plot_rect"]
        if plot_rect.width() <= 0:
            return None
        fraction = max(
            0.0,
            min(1.0, (x - plot_rect.left()) / max(plot_rect.width(), 1.0)),
        )
        x_min = float(plot_state["x_min"])
        x_max = float(plot_state["x_max"])
        return x_min + fraction * (x_max - x_min)

    def _annotation_at(
        self,
        row_hint: Optional[str],
        seconds: float,
    ) -> Optional[WaveformAnnotation]:
        plot_state = self._line_plot_state()
        if plot_state is None or not self.annotations:
            return None
        plot_rect = plot_state["plot_rect"]
        threshold = max(
            (float(plot_state["x_max"]) - float(plot_state["x_min"]))
            / max(plot_rect.width(), 1.0)
            * 8.0,
            0.05,
        )
        closest: Optional[WaveformAnnotation] = None
        best_distance = float("inf")
        row_labels = list(self.variant.row_labels if self.variant is not None else [])
        for annotation in self.annotations:
            if row_hint is not None:
                if (
                    annotation.channel_name is not None
                    and annotation.channel_name != row_hint
                ):
                    continue
            elif (
                annotation.channel_name is not None
                and annotation.channel_name not in row_labels
            ):
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
        plot_state = self._line_plot_state()
        if plot_state is None or not self.annotations:
            return
        plot_rect = plot_state["plot_rect"]
        x_min = float(plot_state["x_min"])
        x_max = float(plot_state["x_max"])
        row_labels = list(self.variant.row_labels if self.variant is not None else [])
        theme = current_theme_colors(self)
        for annotation in self.annotations:
            if (
                annotation.channel_name is not None
                and annotation.channel_name not in row_labels
            ):
                continue
            color = QColor(
                theme.annotation_channel
                if annotation.channel_name
                else theme.annotation_global
            )
            if annotation.is_range and annotation.end_seconds is not None:
                if annotation.end_seconds < x_min or annotation.start_seconds > x_max:
                    continue
                left_fraction = (max(annotation.start_seconds, x_min) - x_min) / max(
                    x_max - x_min, 1e-6
                )
                right_fraction = (min(annotation.end_seconds, x_max) - x_min) / max(
                    x_max - x_min, 1e-6
                )
                overlay_rect = QRectF(
                    plot_rect.left() + left_fraction * plot_rect.width(),
                    plot_rect.top(),
                    max(1.0, (right_fraction - left_fraction) * plot_rect.width()),
                    plot_rect.height(),
                )
                fill_color = QColor(color)
                fill_color.setAlpha(34)
                painter.fillRect(overlay_rect, fill_color)
                painter.setPen(QPen(color, 1.0))
                painter.drawRect(overlay_rect)
                _draw_plot_annotation_flag(
                    painter,
                    annotation.label,
                    overlay_rect.left(),
                    plot_rect.top(),
                    color,
                    plot_rect,
                )
            else:
                timestamp = annotation.center_seconds
                if timestamp < x_min or timestamp > x_max:
                    continue
                fraction = (timestamp - x_min) / max(x_max - x_min, 1e-6)
                x = plot_rect.left() + fraction * plot_rect.width()
                painter.setPen(QPen(color, 1.5))
                painter.drawLine(
                    QPointF(x, plot_rect.top()), QPointF(x, plot_rect.bottom())
                )
                _draw_plot_annotation_flag(
                    painter,
                    annotation.label,
                    x,
                    plot_rect.top(),
                    color,
                    plot_rect,
                )

    def _draw_cursor_overlay(self, painter: QPainter) -> None:
        if not self._plot_layers.cursor or self._cursor_fraction < 0.0:
            return
        plot_rect = self._line_plot_rect()
        x = plot_rect.left() + self._cursor_fraction * plot_rect.width()
        theme = current_theme_colors(self)
        painter.setPen(QPen(QColor(theme.viewport_border), 1.2))
        painter.drawLine(QPointF(x, plot_rect.top()), QPointF(x, plot_rect.bottom()))

    def _nearest_row_label_at(self, point: QPoint) -> Optional[str]:
        plot_state = self._line_plot_state()
        variant = self.variant
        if plot_state is None or variant is None or not variant.row_labels:
            return None
        plot_rect = plot_state["plot_rect"]
        if not plot_rect.contains(point):
            return None
        matrix_view = plot_state["matrix_view"]
        x_values = plot_state["x_values"]
        rendered_row_count = plot_state["rendered_row_count"]
        if not x_values:
            return None
        position_index = int(
            round(
                max(
                    0.0,
                    min(
                        1.0,
                        (point.x() - plot_rect.left()) / max(plot_rect.width(), 1.0),
                    ),
                )
                * max(len(x_values) - 1, 0)
            )
        )
        min_value = plot_state["min_value"]
        max_value = plot_state["max_value"]

        def map_y(value: float) -> float:
            return (
                plot_rect.bottom()
                - ((value - min_value) / (max_value - min_value)) * plot_rect.height()
            )

        best_distance = float("inf")
        best_label: Optional[str] = None
        for row_index, row in enumerate(matrix_view.values[:rendered_row_count]):
            if row.size <= 0:
                continue
            source_index = min(position_index, len(row) - 1)
            y = map_y(_plot_value(float(row[source_index])))
            distance = abs(point.y() - y)
            if distance < best_distance:
                best_distance = distance
                best_label = (
                    variant.row_labels[row_index]
                    if row_index < len(variant.row_labels)
                    else None
                )
        return best_label if best_distance <= 18.0 else None

    def _line_plot_state(self) -> Optional[dict[str, object]]:
        variant = self.variant
        if (
            variant is None
            or not variant.matrix
            or not variant.matrix[0]
            or self.width() <= 0
            or self.height() <= 0
        ):
            return None
        column_count = variant.effective_column_count
        min_value, max_value = variant_plot_bounds(variant)
        if math.isclose(min_value, max_value, rel_tol=1e-9, abs_tol=1e-9):
            padding = max(abs(min_value) * 0.1, 1.0)
            min_value -= padding
            max_value += padding
        else:
            span = max_value - min_value
            padding = span * 0.08
            min_value -= padding
            max_value += padding
        plot_rect = self._line_plot_rect()
        target_points = max(
            2,
            min(column_count, max(128, int(plot_rect.width() / 2.0))),
        )
        matrix_view = DdaVariantPlotProvider(variant).matrix_view(
            MatrixViewRequest(
                target_columns=target_points,
                start_fraction=self._x_view_start,
                span_fraction=self._x_view_span,
                max_rows=8,
            )
        )
        sample_indices = list(matrix_view.sample_indices)
        x_values = self._x_values(sample_indices)
        if not x_values:
            return None
        x_min = x_values[0]
        x_max = x_values[-1]
        if math.isclose(x_min, x_max, rel_tol=1e-9, abs_tol=1e-9):
            x_max = x_min + 1.0
        return {
            "variant": variant,
            "row_count": matrix_view.source_row_count,
            "column_count": column_count,
            "min_value": min_value,
            "max_value": max_value,
            "plot_rect": plot_rect,
            "target_points": target_points,
            "sample_indices": sample_indices,
            "x_values": x_values,
            "x_min": x_min,
            "x_max": x_max,
            "matrix_view": matrix_view,
            "render_key": matrix_view_render_key(matrix_view, "lineplot"),
            "rendered_row_count": min(matrix_view.source_row_count, 8),
        }
