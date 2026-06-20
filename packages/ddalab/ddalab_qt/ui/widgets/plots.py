from __future__ import annotations

import math
from time import perf_counter_ns
from typing import Dict, Hashable, List, Optional, Tuple

from PySide6.QtCore import QPoint, QPointF, QRectF, QSize, Qt, QTimer, Signal
from PySide6.QtGui import (
    QColor,
    QMouseEvent,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
)
from PySide6.QtWidgets import QWidget

from ...app.perf_logging import perf_logger
from ...domain.models import (
    ChannelWaveform,
    DdaVariantResult,
    NetworkMotifData,
    WaveformAnnotation,
    WaveformOverview,
    WaveformWindow,
)
from ..plot_data import (
    DdaVariantPlotProvider,
    HEATMAP_COLOR_SCHEME_OPTIONS,
    MatrixViewRequest,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_waveform_trace_view,
    matrix_view_render_key,
    variant_plot_bounds,
)
from ..plot_layers import PlotLayerConfig
from ..qt_plot_renderer import heatmap_qimage
from ..style import current_theme_colors


class WaveformWidget(QWidget):
    viewport_changed = Signal(float, float)
    annotation_context_requested = Signal(object, float, object, object)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(360)
        self.window: Optional[WaveformWindow] = None
        self.viewport_start_seconds = 0.0
        self.viewport_duration_seconds = 10.0
        self.display_start_seconds = 0.0
        self.display_duration_seconds = 10.0
        self.dataset_duration_seconds = 0.0
        self._drag_origin: Optional[QPoint] = None
        self._drag_start_seconds = 0.0
        self.annotations: List[WaveformAnnotation] = []
        self._path_cache: Dict[Tuple[Hashable, int, int], QPainterPath] = {}
        self._segment_cache: Dict[
            Tuple[Hashable, int, int], list[Tuple[QPointF, QPointF]]
        ] = {}
        self._channel_pixmap_cache: Dict[Tuple[Hashable, int, int], QPixmap] = {}
        self._plot_layers = PlotLayerConfig()
        self._resize_cache_timer = QTimer(self)
        self._resize_cache_timer.setSingleShot(True)
        self._resize_cache_timer.timeout.connect(self._finalize_resize)

    def set_waveform(
        self,
        window: Optional[WaveformWindow],
        viewport_start_seconds: float,
        viewport_duration_seconds: float,
        dataset_duration_seconds: float,
    ) -> None:
        self.window = window
        self.viewport_start_seconds = viewport_start_seconds
        self.viewport_duration_seconds = viewport_duration_seconds
        self.display_start_seconds = viewport_start_seconds
        self.display_duration_seconds = viewport_duration_seconds
        self.dataset_duration_seconds = dataset_duration_seconds
        self._invalidate_render_cache()
        self.update()

    def set_display_viewport(
        self,
        viewport_start_seconds: float,
        viewport_duration_seconds: float,
        dataset_duration_seconds: float,
    ) -> None:
        self.viewport_start_seconds = viewport_start_seconds
        self.viewport_duration_seconds = viewport_duration_seconds
        self.display_start_seconds = viewport_start_seconds
        self.display_duration_seconds = viewport_duration_seconds
        self.dataset_duration_seconds = dataset_duration_seconds
        self.update()

    def set_annotations(self, annotations: List[WaveformAnnotation]) -> None:
        self.annotations = annotations
        self.update()

    def refresh_theme(self) -> None:
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

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._resize_cache_timer.start(90)
        self.update()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        paint_started_ns = perf_counter_ns()
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, False)
        theme = current_theme_colors(self)
        painter.fillRect(self.rect(), QColor(theme.plot_surface))

        if not self.window or not self.window.channels:
            painter.setPen(QColor(theme.plot_muted_text))
            painter.drawText(self.rect(), Qt.AlignCenter, "No waveform window loaded")
            perf_logger().log_slow(
                "waveform.paint.empty",
                "waveform.paint",
                (perf_counter_ns() - paint_started_ns) / 1_000_000.0,
                threshold_ms=18.0,
                width=self.width(),
                height=self.height(),
                channels=0,
            )
            return

        channels = self.window.channels
        channel_height = self.height() / max(len(channels), 1)
        for index, channel in enumerate(channels):
            top = index * channel_height
            row_rect = QRectF(0, top, self.width(), channel_height)
            center_y = top + channel_height / 2.0
            painter.setPen(QPen(QColor(theme.plot_grid_alt), 1))
            painter.drawLine(0, int(center_y), self.width(), int(center_y))
            if self._plot_layers.waveform:
                self._draw_channel(
                    painter,
                    channel,
                    QRectF(0, top + 8, self.width(), channel_height - 16),
                    index,
                )
            if self._plot_layers.annotations:
                self._draw_annotation_overlays(
                    painter,
                    channel.name,
                    row_rect,
                    index,
                )
            painter.setPen(QColor(theme.plot_text))
            painter.drawText(10, int(top + 18), channel.name)
        perf_logger().log_slow(
            "waveform.paint",
            "waveform.paint",
            (perf_counter_ns() - paint_started_ns) / 1_000_000.0,
            threshold_ms=18.0,
            width=self.width(),
            height=self.height(),
            channels=len(channels),
        )

    def wheelEvent(self, event) -> None:  # type: ignore[override]
        if not self.window:
            return
        factor = 1.15 if event.angleDelta().y() > 0 else 0.85
        next_duration = max(
            0.5,
            min(
                self.dataset_duration_seconds or self.viewport_duration_seconds,
                self.viewport_duration_seconds * factor,
            ),
        )
        center = self.viewport_start_seconds + self.viewport_duration_seconds / 2.0
        max_start = max(
            0.0, (self.dataset_duration_seconds or next_duration) - next_duration
        )
        next_start = max(0.0, min(max_start, center - next_duration / 2.0))
        self.viewport_changed.emit(next_start, next_duration)

    def mousePressEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if event.button() == Qt.LeftButton:
            self._drag_origin = event.position().toPoint()
            self._drag_start_seconds = self.viewport_start_seconds

    def mouseMoveEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if self._drag_origin is None or not self.window:
            return
        delta_x = event.position().x() - self._drag_origin.x()
        seconds_per_pixel = self.viewport_duration_seconds / max(
            float(self.width()), 1.0
        )
        next_start = self._drag_start_seconds - delta_x * seconds_per_pixel
        max_start = max(
            0.0,
            (self.dataset_duration_seconds or self.viewport_duration_seconds)
            - self.viewport_duration_seconds,
        )
        self.viewport_changed.emit(
            max(0.0, min(max_start, next_start)), self.viewport_duration_seconds
        )

    def mouseReleaseEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        self._drag_origin = None

    def contextMenuEvent(self, event) -> None:  # type: ignore[override]
        if not self.window or not self.window.channels:
            return
        point = event.pos()
        channel_name = self._channel_name_at_point(point)
        seconds = self._seconds_at_x(point.x())
        annotation = self._annotation_at(channel_name, seconds)
        self.annotation_context_requested.emit(
            self.mapToGlobal(point),
            seconds,
            channel_name,
            annotation,
        )
        event.accept()

    def _draw_channel(
        self,
        painter: QPainter,
        channel: ChannelWaveform,
        rect: QRectF,
        channel_index: int,
    ) -> None:
        if not channel.samples or not self.window:
            return
        (
            _source_start_fraction,
            source_width_fraction,
            dest_left_fraction,
            dest_width_fraction,
        ) = self._visible_waveform_fractions()
        if source_width_fraction <= 0.0 or dest_width_fraction <= 0.0:
            return
        pixmap = self._channel_pixmap(
            channel,
            rect.size().toSize(),
            channel_index=channel_index,
        )
        if pixmap.isNull():
            return
        source_rect = QRectF(0.0, 0.0, pixmap.width(), pixmap.height())
        target_rect = QRectF(
            rect.left() + dest_left_fraction * rect.width(),
            rect.top(),
            max(1.0, dest_width_fraction * rect.width()),
            rect.height(),
        )
        painter.drawPixmap(target_rect, pixmap, source_rect)

    def _channel_pixmap(
        self,
        channel: ChannelWaveform,
        size: QSize,
        *,
        channel_index: int,
    ) -> QPixmap:
        width = max(size.width(), 1)
        height = max(size.height(), 1)
        sample_count = len(channel.samples)
        render_key = self._channel_render_key(channel_index, width)
        cache_key = (render_key, width, height)
        pixmap = self._channel_pixmap_cache.get(cache_key)
        if pixmap is not None:
            return pixmap
        if self._resize_cache_timer.isActive():
            fallback = self._find_cached_channel_pixmap(render_key)
            if fallback is not None:
                return fallback

        build_started_ns = perf_counter_ns()
        pixmap = QPixmap(width, height)
        pixmap.fill(Qt.transparent)
        channel_painter = QPainter(pixmap)
        channel_painter.setRenderHint(QPainter.Antialiasing, False)
        rect = QRectF(0, 0, width, height)
        self._draw_channel_geometry(channel_painter, channel, rect, render_key)
        channel_painter.end()
        self._channel_pixmap_cache[cache_key] = pixmap
        perf_logger().log_slow(
            f"waveform.channel_pixmap.{channel.name}",
            "waveform.channel_pixmap.build",
            (perf_counter_ns() - build_started_ns) / 1_000_000.0,
            threshold_ms=12.0,
            channel=channel.name,
            samples=sample_count,
            renderKey=str(render_key[:4]),
            width=width,
            height=height,
        )
        return pixmap

    def _channel_render_key(self, channel_index: int, target_width: int) -> Hashable:
        if self.window is None:
            return (None, int(channel_index), int(target_width))
        start_fraction, span_fraction, _, _ = self._visible_waveform_fractions()
        return WaveformWindowPlotProvider(self.window).render_key(
            WaveformViewRequest(
                target_width=max(1, int(target_width)),
                channel_start=max(0, int(channel_index)),
                channel_count=1,
                start_fraction=start_fraction,
                span_fraction=span_fraction,
            )
        )

    def _find_cached_channel_pixmap(self, render_key: Hashable) -> Optional[QPixmap]:
        for key, pixmap in self._channel_pixmap_cache.items():
            if key[0] == render_key and not pixmap.isNull():
                return pixmap
        return None

    def _draw_channel_geometry(
        self,
        painter: QPainter,
        channel: ChannelWaveform,
        rect: QRectF,
        render_key: Hashable,
    ) -> None:
        theme = current_theme_colors(self)
        range_value = max(channel.max_value - channel.min_value, 1e-6)
        vertical_padding = max(2.0, min(6.0, rect.height() * 0.05))
        drawable_height = max(rect.height() - vertical_padding * 2.0, 1.0)

        def map_y(value: float) -> float:
            normalized = max(0.0, min(1.0, (value - channel.min_value) / range_value))
            return rect.top() + vertical_padding + (1.0 - normalized) * drawable_height

        painter.setPen(QPen(QColor(theme.waveform_line), 1.0))
        start_fraction, span_fraction, _, _ = self._visible_waveform_fractions()
        trace_view = build_waveform_trace_view(
            channel,
            target_width=rect.width(),
            start_fraction=start_fraction,
            span_fraction=span_fraction,
        )
        if trace_view.mode == "samples":
            cache_key = (
                render_key,
                int(rect.width()),
                int(rect.height()),
            )
            path = self._path_cache.get(cache_key)
            if path is None:
                path = QPainterPath()
                for index, value in enumerate(trace_view.values):
                    x = rect.left() + float(trace_view.x_fraction[index]) * rect.width()
                    y = map_y(float(value))
                    if index == 0:
                        path.moveTo(x, y)
                    else:
                        path.lineTo(x, y)
                self._path_cache[cache_key] = path
            painter.drawPath(path)
            return

        if trace_view.mode != "envelope":
            return
        cache_key = (
            render_key,
            int(rect.width()),
            int(rect.height()),
        )
        segments = self._segment_cache.get(cache_key)
        if segments is None:
            segments = []
            for x_fraction, bucket_min, bucket_max in zip(
                trace_view.x_fraction,
                trace_view.min_values,
                trace_view.max_values,
            ):
                x = rect.left() + float(x_fraction) * rect.width()
                segments.append(
                    (
                        QPointF(x, map_y(float(bucket_max))),
                        QPointF(x, map_y(float(bucket_min))),
                    )
                )
            self._segment_cache[cache_key] = segments
        for top_point, bottom_point in segments:
            painter.drawLine(top_point, bottom_point)

    def _finalize_resize(self) -> None:
        self._invalidate_render_cache()
        self.update()

    def _invalidate_render_cache(self) -> None:
        self._path_cache.clear()
        self._segment_cache.clear()
        self._channel_pixmap_cache.clear()

    def _visible_waveform_fractions(self) -> tuple[float, float, float, float]:
        if self.window is None:
            return 0.0, 1.0, 0.0, 1.0
        loaded_duration = max(float(self.window.duration_seconds), 0.0)
        display_duration = max(float(self.display_duration_seconds), 0.0)
        if loaded_duration <= 0.0 or display_duration <= 0.0:
            return 0.0, 0.0, 0.0, 0.0
        loaded_start = float(self.window.start_time_seconds)
        loaded_end = loaded_start + loaded_duration
        display_start = float(self.display_start_seconds)
        display_end = display_start + display_duration
        overlap_start = max(loaded_start, display_start)
        overlap_end = min(loaded_end, display_end)
        if overlap_end <= overlap_start:
            return 0.0, 0.0, 0.0, 0.0
        overlap_duration = overlap_end - overlap_start
        return (
            self._fraction_start(overlap_start - loaded_start, loaded_duration),
            self._fraction_span(overlap_duration, loaded_duration),
            self._fraction_start(overlap_start - display_start, display_duration),
            self._fraction_span(overlap_duration, display_duration),
        )

    @staticmethod
    def _fraction_start(offset: float, duration: float) -> float:
        if duration <= 0.0:
            return 0.0
        return max(0.0, min(1.0, offset / duration))

    @staticmethod
    def _fraction_span(span: float, duration: float) -> float:
        if duration <= 0.0:
            return 0.0
        return max(0.0, min(1.0, span / duration))

    def _draw_annotation_overlays(
        self,
        painter: QPainter,
        channel_name: str,
        rect: QRectF,
        row_index: int,
    ) -> None:
        theme = current_theme_colors(self)
        if not self.annotations or self.display_duration_seconds <= 0:
            return
        for annotation in self.annotations:
            if (
                annotation.channel_name is not None
                and annotation.channel_name != channel_name
            ):
                continue
            color = QColor(
                theme.annotation_channel
                if annotation.channel_name
                else theme.annotation_global
            )
            if annotation.is_range and annotation.end_seconds is not None:
                start = annotation.start_seconds
                end = annotation.end_seconds
                if (
                    end < self.display_start_seconds
                    or start
                    > self.display_start_seconds + self.display_duration_seconds
                ):
                    continue
                left_fraction = (
                    max(start, self.display_start_seconds) - self.display_start_seconds
                ) / self.display_duration_seconds
                right_fraction = (
                    min(end, self.display_start_seconds + self.display_duration_seconds)
                    - self.display_start_seconds
                ) / self.display_duration_seconds
                overlay_rect = QRectF(
                    rect.left() + left_fraction * rect.width(),
                    rect.top(),
                    max(1.0, (right_fraction - left_fraction) * rect.width()),
                    rect.height(),
                )
                fill_color = QColor(color)
                fill_color.setAlpha(46)
                painter.fillRect(overlay_rect, fill_color)
                painter.setPen(QPen(color, 1.0))
                painter.drawRect(overlay_rect)
                if self._should_draw_annotation_label(annotation, row_index):
                    self._draw_annotation_flag(
                        painter,
                        annotation.label,
                        overlay_rect.left(),
                        rect.top(),
                        color,
                        rect,
                    )
            else:
                timestamp = annotation.center_seconds
                if (
                    timestamp < self.display_start_seconds
                    or timestamp
                    > self.display_start_seconds + self.display_duration_seconds
                ):
                    continue
                fraction = (
                    timestamp - self.display_start_seconds
                ) / self.display_duration_seconds
                x = rect.left() + fraction * rect.width()
                painter.setPen(QPen(color, 1.5))
                painter.drawLine(QPointF(x, rect.top()), QPointF(x, rect.bottom()))
                if self._should_draw_annotation_label(annotation, row_index):
                    self._draw_annotation_flag(
                        painter,
                        annotation.label,
                        x,
                        rect.top(),
                        color,
                        rect,
                    )

    def _should_draw_annotation_label(
        self, annotation: WaveformAnnotation, row_index: int
    ) -> bool:
        return annotation.channel_name is not None or row_index == 0

    def _draw_annotation_flag(
        self,
        painter: QPainter,
        label: str,
        anchor_x: float,
        top: float,
        color: QColor,
        bounds: QRectF,
    ) -> None:
        if not label:
            return
        painter.save()
        painter.setRenderHint(QPainter.Antialiasing, True)
        metrics = painter.fontMetrics()
        text = metrics.elidedText(label, Qt.ElideRight, 160)
        text_width = metrics.horizontalAdvance(text)
        flag_width = text_width + 14
        flag_height = metrics.height() + 6
        left = anchor_x + 6.0
        if left + flag_width > bounds.right() - 4.0:
            left = anchor_x - flag_width - 6.0
        left = max(bounds.left() + 4.0, min(left, bounds.right() - flag_width - 4.0))
        flag_rect = QRectF(left, top + 4.0, flag_width, flag_height)

        stem_color = QColor(color)
        stem_color.setAlpha(220)
        painter.setPen(QPen(stem_color, 1.2))
        painter.drawLine(
            QPointF(anchor_x, top),
            QPointF(anchor_x, flag_rect.bottom()),
        )

        fill_color = QColor(color)
        fill_color.setAlpha(235)
        theme = current_theme_colors(self)
        painter.setPen(QPen(QColor(theme.annotation_flag_border), 1.0))
        painter.setBrush(fill_color)
        painter.drawRoundedRect(flag_rect, 5.0, 5.0)
        painter.setPen(QColor(theme.annotation_flag_text))
        painter.drawText(
            flag_rect.adjusted(7.0, 2.0, -7.0, -2.0),
            Qt.AlignLeft | Qt.AlignVCenter,
            text,
        )
        painter.restore()

    def _channel_name_at_point(self, point: QPoint) -> Optional[str]:
        if not self.window or not self.window.channels:
            return None
        channel_height = self.height() / max(len(self.window.channels), 1)
        index = int(point.y() / max(channel_height, 1.0))
        if index < 0 or index >= len(self.window.channels):
            return None
        return self.window.channels[index].name

    def _seconds_at_x(self, x: float) -> float:
        if self.display_duration_seconds <= 0:
            return self.display_start_seconds
        fraction = max(0.0, min(1.0, x / max(float(self.width()), 1.0)))
        return self.display_start_seconds + fraction * self.display_duration_seconds

    def _annotation_at(
        self,
        channel_name: Optional[str],
        seconds: float,
    ) -> Optional[WaveformAnnotation]:
        if not self.annotations or self.display_duration_seconds <= 0:
            return None
        seconds_per_pixel = self.display_duration_seconds / max(
            float(self.width()), 1.0
        )
        threshold = max(seconds_per_pixel * 8.0, 0.05)
        closest: Optional[WaveformAnnotation] = None
        best_distance = float("inf")
        for annotation in self.annotations:
            if (
                annotation.channel_name is not None
                and annotation.channel_name != channel_name
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


class OverviewWidget(QWidget):
    viewport_jump_requested = Signal(float)
    annotation_context_requested = Signal(object, float, object)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(120)
        self.overview: Optional[WaveformOverview] = None
        self.viewport_start_seconds = 0.0
        self.viewport_duration_seconds = 10.0
        self.dataset_duration_seconds = 0.0
        self.annotations: List[WaveformAnnotation] = []
        self._path_cache: Dict[
            Tuple[str, int, int, int], list[Tuple[QPointF, QPointF]]
        ] = {}
        self._overview_pixmap: Optional[QPixmap] = None
        self._resize_cache_timer = QTimer(self)
        self._resize_cache_timer.setSingleShot(True)
        self._resize_cache_timer.timeout.connect(self._finalize_resize)

    def set_overview(
        self,
        overview: Optional[WaveformOverview],
        viewport_start_seconds: float,
        viewport_duration_seconds: float,
        dataset_duration_seconds: float,
    ) -> None:
        if overview is not self.overview:
            self._invalidate_render_cache()
        self.overview = overview
        self.viewport_start_seconds = viewport_start_seconds
        self.viewport_duration_seconds = viewport_duration_seconds
        self.dataset_duration_seconds = dataset_duration_seconds
        self.update()

    def set_annotations(self, annotations: List[WaveformAnnotation]) -> None:
        self.annotations = annotations
        self.update()

    def refresh_theme(self) -> None:
        self._invalidate_render_cache()
        self.update()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._resize_cache_timer.start(90)
        self.update()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        paint_started_ns = perf_counter_ns()
        painter = QPainter(self)
        theme = current_theme_colors(self)
        if not self.overview or not self.overview.channels:
            painter.fillRect(self.rect(), QColor(theme.plot_surface_alt))
            painter.setPen(QColor(theme.plot_muted_text))
            painter.drawText(self.rect(), Qt.AlignCenter, "Overview unavailable")
            perf_logger().log_slow(
                "overview.paint.empty",
                "overview.paint",
                (perf_counter_ns() - paint_started_ns) / 1_000_000.0,
                threshold_ms=14.0,
                width=self.width(),
                height=self.height(),
                channels=0,
            )
            return
        pixmap = self._ensure_overview_pixmap()
        if pixmap is not None and not pixmap.isNull():
            painter.drawPixmap(self.rect(), pixmap)
        else:
            painter.fillRect(self.rect(), QColor(theme.plot_surface_alt))

        if self.dataset_duration_seconds > 0:
            self._draw_annotation_overlays(painter)
            left = (
                self.viewport_start_seconds / self.dataset_duration_seconds
            ) * self.width()
            width = (
                self.viewport_duration_seconds / self.dataset_duration_seconds
            ) * self.width()
            painter.fillRect(
                QRectF(left, 0, width, self.height()), QColor(*theme.viewport_fill)
            )
            painter.setPen(QPen(QColor(theme.viewport_border), 2))
            painter.drawRect(QRectF(left, 1, width, self.height() - 2))
        perf_logger().log_slow(
            "overview.paint",
            "overview.paint",
            (perf_counter_ns() - paint_started_ns) / 1_000_000.0,
            threshold_ms=14.0,
            width=self.width(),
            height=self.height(),
            channels=len(self.overview.channels),
        )

    def _draw_overview_channel(self, painter: QPainter, channel, rect: QRectF) -> None:
        if not channel.mins or not channel.maxs:
            return
        theme = current_theme_colors(self)

        center_y = rect.top() + rect.height() / 2.0
        painter.setPen(QPen(QColor(theme.plot_baseline), 1.0))
        painter.drawLine(
            QPointF(rect.left(), center_y), QPointF(rect.right(), center_y)
        )

        range_value = max(channel.max_value - channel.min_value, 1e-6)

        def map_y(value: float) -> float:
            normalized = max(0.0, min(1.0, (value - channel.min_value) / range_value))
            return rect.bottom() - normalized * max(rect.height() - 8.0, 1.0) - 4.0

        painter.setPen(QPen(QColor(theme.overview_line), 1.0))
        cache_key = (
            channel.name,
            len(channel.mins),
            int(rect.width()),
            int(rect.height()),
        )
        segments = self._path_cache.get(cache_key)
        if segments is None:
            segments = []
            for bucket_index, (bucket_min, bucket_max) in enumerate(
                zip(channel.mins, channel.maxs)
            ):
                x = (
                    rect.left()
                    + (bucket_index / max(len(channel.mins) - 1, 1)) * rect.width()
                )
                segments.append(
                    (QPointF(x, map_y(bucket_max)), QPointF(x, map_y(bucket_min)))
                )
            self._path_cache[cache_key] = segments
        for top_point, bottom_point in segments:
            painter.drawLine(top_point, bottom_point)

        if rect.height() >= 22:
            painter.setPen(QColor(theme.plot_text))
            painter.drawText(
                QRectF(rect.left() + 8, rect.top() + 2, 120, 18),
                Qt.AlignLeft,
                channel.name[:18],
            )

    def _ensure_overview_pixmap(self) -> Optional[QPixmap]:
        if self.overview is None or self.width() <= 0 or self.height() <= 0:
            return None
        if (
            self._overview_pixmap is not None
            and self._overview_pixmap.size() == self.size()
        ):
            return self._overview_pixmap
        if (
            self._resize_cache_timer.isActive()
            and self._overview_pixmap is not None
            and not self._overview_pixmap.isNull()
        ):
            return self._overview_pixmap

        build_started_ns = perf_counter_ns()
        pixmap = QPixmap(self.size())
        theme = current_theme_colors(self)
        pixmap.fill(QColor(theme.plot_surface_alt))
        painter = QPainter(pixmap)
        content_rect = QRectF(0, 8, self.width(), self.height() - 16)
        channels = self.overview.channels
        channel_height = content_rect.height() / max(len(channels), 1)
        for index, channel in enumerate(channels):
            channel_rect = QRectF(
                content_rect.left(),
                content_rect.top() + index * channel_height,
                content_rect.width(),
                channel_height,
            )
            self._draw_overview_channel(painter, channel, channel_rect)
        painter.end()
        self._overview_pixmap = pixmap
        perf_logger().log_slow(
            "overview.pixmap.build",
            "overview.pixmap.build",
            (perf_counter_ns() - build_started_ns) / 1_000_000.0,
            threshold_ms=12.0,
            width=self.width(),
            height=self.height(),
            channels=len(channels),
        )
        return pixmap

    def _finalize_resize(self) -> None:
        self._invalidate_render_cache()
        self.update()

    def _invalidate_render_cache(self) -> None:
        self._path_cache.clear()
        self._overview_pixmap = None

    def _draw_annotation_overlays(self, painter: QPainter) -> None:
        theme = current_theme_colors(self)
        if not self.annotations or self.dataset_duration_seconds <= 0:
            return
        for annotation in self.annotations:
            color = QColor(
                theme.annotation_channel
                if annotation.channel_name
                else theme.annotation_global
            )
            if annotation.is_range and annotation.end_seconds is not None:
                left = (
                    max(annotation.start_seconds, 0.0) / self.dataset_duration_seconds
                ) * self.width()
                right = (
                    min(annotation.end_seconds, self.dataset_duration_seconds)
                    / self.dataset_duration_seconds
                ) * self.width()
                fill_color = QColor(color)
                fill_color.setAlpha(34)
                painter.fillRect(
                    QRectF(left, 0, max(1.0, right - left), self.height()), fill_color
                )
                painter.setPen(QPen(color, 1.0))
                painter.drawLine(QPointF(left, 0), QPointF(left, self.height()))
                self._draw_annotation_flag(painter, annotation.label, left, color)
            else:
                x = (
                    annotation.center_seconds / self.dataset_duration_seconds
                ) * self.width()
                painter.setPen(QPen(color, 1.5))
                painter.drawLine(QPointF(x, 0), QPointF(x, self.height()))
                self._draw_annotation_flag(painter, annotation.label, x, color)

    def _draw_annotation_flag(
        self,
        painter: QPainter,
        label: str,
        anchor_x: float,
        color: QColor,
    ) -> None:
        if not label:
            return
        painter.save()
        painter.setRenderHint(QPainter.Antialiasing, True)
        metrics = painter.fontMetrics()
        text = metrics.elidedText(label, Qt.ElideRight, 180)
        text_width = metrics.horizontalAdvance(text)
        flag_width = text_width + 14
        flag_height = metrics.height() + 6
        left = anchor_x + 6.0
        if left + flag_width > self.width() - 4.0:
            left = anchor_x - flag_width - 6.0
        left = max(4.0, min(left, self.width() - flag_width - 4.0))
        flag_rect = QRectF(left, 4.0, flag_width, flag_height)

        stem_color = QColor(color)
        stem_color.setAlpha(220)
        painter.setPen(QPen(stem_color, 1.2))
        painter.drawLine(
            QPointF(anchor_x, 0.0),
            QPointF(anchor_x, flag_rect.bottom()),
        )

        fill_color = QColor(color)
        fill_color.setAlpha(235)
        theme = current_theme_colors(self)
        painter.setPen(QPen(QColor(theme.annotation_flag_border), 1.0))
        painter.setBrush(fill_color)
        painter.drawRoundedRect(flag_rect, 5.0, 5.0)
        painter.setPen(QColor(theme.annotation_flag_text))
        painter.drawText(
            flag_rect.adjusted(7.0, 2.0, -7.0, -2.0),
            Qt.AlignLeft | Qt.AlignVCenter,
            text,
        )
        painter.restore()

    def mousePressEvent(self, event: QMouseEvent) -> None:  # type: ignore[override]
        if self.dataset_duration_seconds <= 0:
            return
        fraction = max(
            0.0, min(1.0, event.position().x() / max(float(self.width()), 1.0))
        )
        target_center = self.dataset_duration_seconds * fraction
        next_start = max(
            0.0,
            min(
                self.dataset_duration_seconds - self.viewport_duration_seconds,
                target_center - self.viewport_duration_seconds / 2.0,
            ),
        )
        self.viewport_jump_requested.emit(next_start)

    def contextMenuEvent(self, event) -> None:  # type: ignore[override]
        if self.dataset_duration_seconds <= 0:
            return
        seconds = self._seconds_at_x(event.pos().x())
        annotation = self._annotation_at(seconds)
        self.annotation_context_requested.emit(
            self.mapToGlobal(event.pos()),
            seconds,
            annotation,
        )
        event.accept()

    def _seconds_at_x(self, x: float) -> float:
        fraction = max(0.0, min(1.0, x / max(float(self.width()), 1.0)))
        return self.dataset_duration_seconds * fraction

    def _annotation_at(self, seconds: float) -> Optional[WaveformAnnotation]:
        if not self.annotations or self.dataset_duration_seconds <= 0:
            return None
        threshold = max(
            self.dataset_duration_seconds / max(float(self.width()), 1.0) * 8.0,
            0.05,
        )
        closest: Optional[WaveformAnnotation] = None
        best_distance = float("inf")
        for annotation in self.annotations:
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


_LINE_PLOT_COLORS: tuple[str, ...] = (
    "#3b82f6",
    "#ef4444",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#06b6d4",
    "#f97316",
    "#84cc16",
    "#ec4899",
    "#6366f1",
)


def _plot_value(value: float) -> float:
    numeric = float(value)
    return numeric if math.isfinite(numeric) else 0.0


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


def _dda_plot_left_margin(
    widget: QWidget,
    variant: Optional[DdaVariantResult],
) -> float:
    base_margin = 56.0
    if variant is None or not variant.row_labels:
        return base_margin
    metrics = widget.fontMetrics()
    widest_label = max(metrics.horizontalAdvance(label) for label in variant.row_labels)
    return max(base_margin, min(float(widest_label + 28), 188.0))


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


class NetworkMotifWidget(QWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._motif_data: Optional[NetworkMotifData] = None
        self._card_width = 308
        self._card_height = 320
        self.setMinimumHeight(self._card_height)

    def set_motif_data(self, motif_data: Optional[NetworkMotifData]) -> None:
        self._motif_data = motif_data
        hint = self.sizeHint()
        self.setMinimumSize(hint)
        self.resize(hint)
        self.updateGeometry()
        self.update()

    def refresh_theme(self) -> None:
        self.update()

    def sizeHint(self) -> QSize:  # type: ignore[override]
        motif_count = (
            len(self._motif_data.adjacency_matrices)
            if self._motif_data is not None
            else 0
        )
        if motif_count <= 0:
            return QSize(720, self._card_height)
        spacing = 16
        width = 16 + motif_count * self._card_width + max(0, motif_count - 1) * spacing
        return QSize(width, self._card_height)

    def minimumSizeHint(self) -> QSize:  # type: ignore[override]
        return self.sizeHint()

    def paintEvent(self, event) -> None:  # type: ignore[override]
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        theme = current_theme_colors(self)
        painter.fillRect(self.rect(), QColor(theme.plot_surface))

        motif_data = self._motif_data
        if motif_data is None or not motif_data.adjacency_matrices:
            painter.setPen(QColor(theme.plot_muted_text))
            painter.drawText(
                self.rect(),
                Qt.AlignCenter,
                "CD motif plots will appear here when directed connectivity is available.",
            )
            return

        margin = 8.0
        spacing = 16.0
        for index, adjacency in enumerate(motif_data.adjacency_matrices):
            left = margin + index * (self._card_width + spacing)
            card_rect = QRectF(
                left,
                margin,
                self._card_width,
                max(220.0, self.height() - margin * 2.0),
            )
            self._draw_motif_card(
                painter,
                card_rect,
                motif_data,
                adjacency_index=index,
            )

    def _draw_motif_card(
        self,
        painter: QPainter,
        card_rect: QRectF,
        motif_data: NetworkMotifData,
        *,
        adjacency_index: int,
    ) -> None:
        theme = current_theme_colors(self)
        adjacency = motif_data.adjacency_matrices[adjacency_index]
        card_fill = QColor(theme.plot_surface_alt)
        card_border = QColor(theme.plot_border)
        painter.save()
        painter.setPen(QPen(card_border, 1.2))
        painter.setBrush(card_fill)
        painter.drawRoundedRect(card_rect, 14.0, 14.0)

        header_rect = QRectF(
            card_rect.left() + 14.0,
            card_rect.top() + 10.0,
            card_rect.width() - 28.0,
            22.0,
        )
        painter.setPen(QColor(theme.plot_text))
        title_font = painter.font()
        title_font.setPointSize(max(9, title_font.pointSize()))
        painter.setFont(title_font)
        painter.drawText(
            header_rect,
            Qt.AlignLeft | Qt.AlignVCenter,
            f"Causality motif {adjacency_index + 1}",
        )

        meta_font = painter.font()
        meta_font.setPointSize(max(8, meta_font.pointSize() - 1))
        painter.setFont(meta_font)
        painter.setPen(QColor(theme.plot_muted_text))
        painter.drawText(
            QRectF(
                card_rect.left() + 14.0,
                card_rect.top() + 32.0,
                card_rect.width() - 28.0,
                16.0,
            ),
            Qt.AlignLeft | Qt.AlignVCenter,
            f"tau = {adjacency.delay:.2f}    {len(adjacency.edges)} directed edges",
        )

        graph_rect = QRectF(
            card_rect.left() + 18.0,
            card_rect.top() + 56.0,
            card_rect.width() - 36.0,
            card_rect.height() - 108.0,
        )
        self._draw_motif_graph(
            painter,
            graph_rect,
            motif_data,
            adjacency_index=adjacency_index,
        )

        edge_count = len(adjacency.edges)
        average_weight = (
            sum(edge.weight for edge in adjacency.edges) / edge_count
            if edge_count
            else 0.0
        )
        max_weight = max((edge.weight for edge in adjacency.edges), default=0.0)
        painter.setPen(QColor(theme.plot_muted_text))
        painter.drawText(
            QRectF(
                card_rect.left() + 14.0,
                card_rect.bottom() - 34.0,
                card_rect.width() - 28.0,
                18.0,
            ),
            Qt.AlignLeft | Qt.AlignVCenter,
            (f"Avg weight {average_weight:.3f}    Peak {max_weight:.3f}"),
        )
        painter.restore()

    def _draw_motif_graph(
        self,
        painter: QPainter,
        graph_rect: QRectF,
        motif_data: NetworkMotifData,
        *,
        adjacency_index: int,
    ) -> None:
        theme = current_theme_colors(self)
        adjacency = motif_data.adjacency_matrices[adjacency_index]
        node_count = max(motif_data.num_nodes, 1)
        radius = max(24.0, min(graph_rect.width(), graph_rect.height()) * 0.32)
        node_radius = 12.0 if node_count > 10 else 14.0
        center = graph_rect.center()
        positions: List[QPointF] = []
        for node_index in range(node_count):
            angle = (-math.pi / 2.0) + (2.0 * math.pi * node_index / node_count)
            positions.append(
                QPointF(
                    center.x() + radius * math.cos(angle),
                    center.y() + radius * math.sin(angle),
                )
            )

        bidirectional_pairs = {
            tuple(sorted((edge.from_node, edge.to_node)))
            for edge in adjacency.edges
            if edge.from_node != edge.to_node
            and any(
                candidate.from_node == edge.to_node
                and candidate.to_node == edge.from_node
                for candidate in adjacency.edges
            )
        }

        painter.save()
        painter.setPen(QPen(QColor(theme.plot_grid), 1.0))
        painter.setBrush(Qt.NoBrush)
        painter.drawEllipse(center, radius + 18.0, radius + 18.0)

        for edge in adjacency.edges:
            if not (
                0 <= edge.from_node < len(positions)
                and 0 <= edge.to_node < len(positions)
            ):
                continue
            start = positions[edge.from_node]
            end = positions[edge.to_node]
            pair_key = tuple(sorted((edge.from_node, edge.to_node)))
            curve_offset = (
                26.0
                if pair_key in bidirectional_pairs and edge.from_node < edge.to_node
                else (-26.0 if pair_key in bidirectional_pairs else 10.0)
            )
            self._draw_directed_edge(
                painter,
                start,
                end,
                node_radius=node_radius,
                weight=float(edge.weight),
                curve_offset=curve_offset,
                self_loop=edge.from_node == edge.to_node,
            )

        node_fill = QColor("#60a5fa" if theme.mode == "dark" else "#2563eb")
        node_border = QColor("#dbeafe" if theme.mode == "dark" else "#eff6ff")
        label_fill = QColor(theme.plot_surface)
        label_fill.setAlpha(236)
        label_border = QColor(theme.plot_border)

        for node_index, center_point in enumerate(positions):
            painter.setPen(QPen(node_border, 1.4))
            painter.setBrush(node_fill)
            painter.drawEllipse(center_point, node_radius, node_radius)

            label_text = (
                motif_data.node_labels[node_index]
                if node_index < len(motif_data.node_labels)
                else f"Ch{node_index + 1}"
            )
            angle = (-math.pi / 2.0) + (2.0 * math.pi * node_index / node_count)
            label_anchor = QPointF(
                center_point.x() + math.cos(angle) * 26.0,
                center_point.y() + math.sin(angle) * 26.0,
            )
            label_width = min(
                96.0,
                max(54.0, painter.fontMetrics().horizontalAdvance(label_text) + 16.0),
            )
            label_rect = QRectF(
                label_anchor.x() - label_width / 2.0,
                label_anchor.y() - 10.0,
                label_width,
                20.0,
            )
            label_rect.moveLeft(
                max(
                    graph_rect.left(),
                    min(label_rect.left(), graph_rect.right() - label_rect.width()),
                )
            )
            label_rect.moveTop(
                max(
                    graph_rect.top(),
                    min(label_rect.top(), graph_rect.bottom() - label_rect.height()),
                )
            )
            painter.setPen(QPen(label_border, 1.0))
            painter.setBrush(label_fill)
            painter.drawRoundedRect(label_rect, 8.0, 8.0)
            painter.setPen(QColor(theme.plot_text))
            painter.drawText(
                label_rect.adjusted(6.0, 0.0, -6.0, 0.0),
                Qt.AlignCenter,
                painter.fontMetrics().elidedText(
                    label_text, Qt.ElideRight, int(label_rect.width() - 10.0)
                ),
            )
        painter.restore()

    def _draw_directed_edge(
        self,
        painter: QPainter,
        start: QPointF,
        end: QPointF,
        *,
        node_radius: float,
        weight: float,
        curve_offset: float,
        self_loop: bool,
    ) -> None:
        color = self._edge_color(weight)
        pen = QPen(color, 1.2 + weight * 2.8)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        painter.setPen(pen)
        painter.setBrush(Qt.NoBrush)

        if self_loop:
            loop_rect = QRectF(
                start.x() - node_radius * 0.2,
                start.y() - node_radius * 2.4,
                node_radius * 1.8,
                node_radius * 1.8,
            )
            path = QPainterPath()
            path.arcMoveTo(loop_rect, 210.0)
            path.arcTo(loop_rect, 210.0, 280.0)
            painter.drawPath(path)
            end_point = path.pointAtPercent(0.96)
            tangent = QPointF(0.8, -0.2)
            self._draw_arrowhead(painter, end_point, tangent, color)
            return

        delta_x = end.x() - start.x()
        delta_y = end.y() - start.y()
        length = math.hypot(delta_x, delta_y)
        if length <= 1e-6:
            return
        unit_x = delta_x / length
        unit_y = delta_y / length
        start_point = QPointF(
            start.x() + unit_x * (node_radius + 1.5),
            start.y() + unit_y * (node_radius + 1.5),
        )
        end_point = QPointF(
            end.x() - unit_x * (node_radius + 7.5),
            end.y() - unit_y * (node_radius + 7.5),
        )
        midpoint = QPointF(
            (start_point.x() + end_point.x()) / 2.0,
            (start_point.y() + end_point.y()) / 2.0,
        )
        normal = QPointF(-unit_y, unit_x)
        control = QPointF(
            midpoint.x() + normal.x() * curve_offset,
            midpoint.y() + normal.y() * curve_offset,
        )
        path = QPainterPath(start_point)
        path.quadTo(control, end_point)
        painter.drawPath(path)
        tangent = QPointF(
            end_point.x() - control.x(),
            end_point.y() - control.y(),
        )
        self._draw_arrowhead(painter, end_point, tangent, color)

    def _draw_arrowhead(
        self,
        painter: QPainter,
        tip: QPointF,
        tangent: QPointF,
        color: QColor,
    ) -> None:
        length = math.hypot(tangent.x(), tangent.y())
        if length <= 1e-6:
            return
        unit_x = tangent.x() / length
        unit_y = tangent.y() / length
        left = QPointF(
            tip.x() - unit_x * 10.0 + (-unit_y) * 4.5,
            tip.y() - unit_y * 10.0 + unit_x * 4.5,
        )
        right = QPointF(
            tip.x() - unit_x * 10.0 - (-unit_y) * 4.5,
            tip.y() - unit_y * 10.0 - unit_x * 4.5,
        )
        arrow_path = QPainterPath(tip)
        arrow_path.lineTo(left)
        arrow_path.lineTo(right)
        arrow_path.closeSubpath()
        painter.save()
        painter.setPen(Qt.NoPen)
        painter.setBrush(color)
        painter.drawPath(arrow_path)
        painter.restore()

    def _edge_color(self, weight: float) -> QColor:
        normalized = max(0.0, min(1.0, float(weight)))
        if normalized >= 0.75:
            color = QColor("#f59e0b")
        elif normalized >= 0.5:
            color = QColor("#10b981")
        elif normalized >= 0.25:
            color = QColor("#3b82f6")
        else:
            color = QColor("#64748b")
        color.setAlpha(112 + int(normalized * 120.0))
        return color


def _draw_plot_annotation_flag(
    painter: QPainter,
    label: str,
    anchor_x: float,
    top: float,
    color: QColor,
    bounds: QRectF,
) -> None:
    if not label:
        return
    painter.save()
    painter.setRenderHint(QPainter.Antialiasing, True)
    metrics = painter.fontMetrics()
    text = metrics.elidedText(label, Qt.ElideRight, 160)
    text_width = metrics.horizontalAdvance(text)
    flag_width = text_width + 14
    flag_height = metrics.height() + 6
    left = anchor_x + 6.0
    if left + flag_width > bounds.right() - 4.0:
        left = anchor_x - flag_width - 6.0
    left = max(bounds.left() + 4.0, min(left, bounds.right() - flag_width - 4.0))
    flag_rect = QRectF(left, top + 4.0, flag_width, flag_height)

    stem_color = QColor(color)
    stem_color.setAlpha(220)
    painter.setPen(QPen(stem_color, 1.2))
    painter.drawLine(
        QPointF(anchor_x, top),
        QPointF(anchor_x, flag_rect.bottom()),
    )

    fill_color = QColor(color)
    fill_color.setAlpha(235)
    theme = current_theme_colors()
    painter.setPen(QPen(QColor(theme.annotation_flag_border), 1.0))
    painter.setBrush(fill_color)
    painter.drawRoundedRect(flag_rect, 5.0, 5.0)
    painter.setPen(QColor(theme.annotation_flag_text))
    painter.drawText(
        flag_rect.adjusted(7.0, 2.0, -7.0, -2.0),
        Qt.AlignLeft | Qt.AlignVCenter,
        text,
    )
    painter.restore()


def _log_result_plot_paint(
    surface: str,
    start_ns: int,
    *,
    width: int,
    height: int,
    rows: int,
    source_columns: int,
) -> None:
    duration_ms = max(0.0, (perf_counter_ns() - start_ns) / 1_000_000.0)
    perf_logger().log_slow(
        f"dda.{surface}.paint",
        f"dda.{surface}.paint",
        duration_ms,
        threshold_ms=12.0,
        width=width,
        height=height,
        rows=rows,
        sourceCols=source_columns,
    )


def _clamp_unit_interval(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _normalize_cursor_fraction(fraction: float | None) -> float:
    if fraction is None:
        return -1.0
    try:
        numeric = float(fraction)
    except (TypeError, ValueError):
        return -1.0
    if not math.isfinite(numeric) or numeric < 0.0:
        return -1.0
    return _clamp_unit_interval(numeric)


def _plot_cursor_fraction(plot_rect: QRectF, x: float) -> float:
    return _clamp_unit_interval(
        (float(x) - plot_rect.left()) / max(plot_rect.width(), 1.0)
    )


def _clamp_view_window(start: float, span: float) -> tuple[float, float]:
    clamped_span = max(0.0, min(1.0, float(span)))
    if clamped_span >= 1.0:
        return 0.0, 1.0
    clamped_start = max(0.0, min(1.0 - clamped_span, float(start)))
    return clamped_start, clamped_span


def _zoom_view_window(
    start: float,
    span: float,
    *,
    anchor_fraction: float,
    zoom_in: bool,
    min_span: float,
) -> tuple[float, float]:
    factor = 0.82 if zoom_in else (1.0 / 0.82)
    next_span = max(float(min_span), min(1.0, float(span) * factor))
    anchor = float(start) + float(span) * _clamp_unit_interval(anchor_fraction)
    next_start = anchor - next_span * _clamp_unit_interval(anchor_fraction)
    return _clamp_view_window(next_start, next_span)


def _wheel_zoom_delta(event) -> int:
    angle_delta = event.angleDelta()
    if angle_delta.y():
        return int(angle_delta.y())
    if angle_delta.x():
        return int(angle_delta.x())
    pixel_delta = event.pixelDelta()
    if pixel_delta.y():
        return int(pixel_delta.y())
    if pixel_delta.x():
        return int(pixel_delta.x())
    return 0


def _windowed_resample_indices(
    source_length: int,
    target_length: int,
    *,
    start_fraction: float,
    span_fraction: float,
) -> List[int]:
    if source_length <= 0 or target_length <= 0:
        return []
    if source_length == 1:
        return [0] * target_length
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    last_index = float(source_length - 1)
    window_start = start_fraction * last_index
    window_end = window_start + span_fraction * last_index
    if target_length == 1:
        return [
            min(
                source_length - 1, max(0, int(round((window_start + window_end) / 2.0)))
            )
        ]
    indices: List[int] = []
    for position in range(target_length):
        fraction = position / max(target_length - 1, 1)
        source_position = window_start + fraction * (window_end - window_start)
        indices.append(min(source_length - 1, max(0, int(round(source_position)))))
    return indices
