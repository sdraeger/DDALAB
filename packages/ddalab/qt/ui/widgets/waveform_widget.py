from __future__ import annotations

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

from ...app.runtime.perf_logging import perf_logger
from ...domain.models import (
    ChannelWaveform,
    WaveformAnnotation,
    WaveformWindow,
)
from ..plot_data import (
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_waveform_trace_view,
)
from ..plot_layers import PlotLayerConfig
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
