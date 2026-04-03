from __future__ import annotations

import math
from time import perf_counter_ns
from typing import Dict, List, Optional, Tuple

from PySide6.QtCore import QPoint, QPointF, QRectF, QSize, Qt, QTimer, Signal
from PySide6.QtGui import (
    QColor,
    QImage,
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
    WaveformAnnotation,
    WaveformOverview,
    WaveformWindow,
)


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
        self._path_cache: Dict[Tuple[str, int, int, int], QPainterPath] = {}
        self._segment_cache: Dict[
            Tuple[str, int, int, int, int], list[Tuple[QPointF, QPointF]]
        ] = {}
        self._channel_pixmap_cache: Dict[Tuple[str, int, int, int], QPixmap] = {}
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

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._resize_cache_timer.start(90)
        self.update()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        paint_started_ns = perf_counter_ns()
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, False)
        painter.fillRect(self.rect(), QColor("#131b23"))

        if not self.window or not self.window.channels:
            painter.setPen(QColor("#94a3b8"))
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
            painter.setPen(QPen(QColor("#253242"), 1))
            painter.drawLine(0, int(center_y), self.width(), int(center_y))
            self._draw_channel(
                painter, channel, QRectF(0, top + 8, self.width(), channel_height - 16)
            )
            self._draw_annotation_overlays(
                painter,
                channel.name,
                row_rect,
                index,
            )
            painter.setPen(QColor("#d9e4ee"))
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
        self, painter: QPainter, channel: ChannelWaveform, rect: QRectF
    ) -> None:
        if not channel.samples or not self.window:
            return
        pixmap = self._channel_pixmap(channel, rect.size().toSize())
        if pixmap.isNull():
            return
        loaded_start = self.window.start_time_seconds
        loaded_duration = max(self.window.duration_seconds, 1e-6)
        loaded_end = loaded_start + loaded_duration
        display_start = self.display_start_seconds
        display_duration = max(self.display_duration_seconds, 1e-6)
        display_end = display_start + display_duration
        overlap_start = max(loaded_start, display_start)
        overlap_end = min(loaded_end, display_end)
        if overlap_end <= overlap_start:
            return
        source_left_fraction = (overlap_start - loaded_start) / loaded_duration
        source_width_fraction = (overlap_end - overlap_start) / loaded_duration
        dest_left_fraction = (overlap_start - display_start) / display_duration
        dest_width_fraction = (overlap_end - overlap_start) / display_duration

        source_rect = QRectF(
            source_left_fraction * pixmap.width(),
            0.0,
            max(1.0, source_width_fraction * pixmap.width()),
            pixmap.height(),
        )
        target_rect = QRectF(
            rect.left() + dest_left_fraction * rect.width(),
            rect.top(),
            max(1.0, dest_width_fraction * rect.width()),
            rect.height(),
        )
        painter.drawPixmap(target_rect, pixmap, source_rect)

    def _channel_pixmap(self, channel: ChannelWaveform, size: QSize) -> QPixmap:
        width = max(size.width(), 1)
        height = max(size.height(), 1)
        sample_count = len(channel.samples)
        cache_key = (channel.name, sample_count, width, height)
        pixmap = self._channel_pixmap_cache.get(cache_key)
        if pixmap is not None:
            return pixmap
        if self._resize_cache_timer.isActive():
            fallback = self._find_cached_channel_pixmap(channel.name, sample_count)
            if fallback is not None:
                return fallback

        build_started_ns = perf_counter_ns()
        pixmap = QPixmap(width, height)
        pixmap.fill(Qt.transparent)
        channel_painter = QPainter(pixmap)
        channel_painter.setRenderHint(QPainter.Antialiasing, False)
        rect = QRectF(0, 0, width, height)
        self._draw_channel_geometry(channel_painter, channel, rect)
        channel_painter.end()
        self._channel_pixmap_cache[cache_key] = pixmap
        perf_logger().log_slow(
            f"waveform.channel_pixmap.{channel.name}",
            "waveform.channel_pixmap.build",
            (perf_counter_ns() - build_started_ns) / 1_000_000.0,
            threshold_ms=12.0,
            channel=channel.name,
            samples=sample_count,
            width=width,
            height=height,
        )
        return pixmap

    def _find_cached_channel_pixmap(
        self, channel_name: str, sample_count: int
    ) -> Optional[QPixmap]:
        for key, pixmap in self._channel_pixmap_cache.items():
            if (
                key[0] == channel_name
                and key[1] == sample_count
                and not pixmap.isNull()
            ):
                return pixmap
        return None

    def _draw_channel_geometry(
        self, painter: QPainter, channel: ChannelWaveform, rect: QRectF
    ) -> None:
        range_value = max(channel.max_value - channel.min_value, 1e-6)
        vertical_padding = max(2.0, min(6.0, rect.height() * 0.05))
        drawable_height = max(rect.height() - vertical_padding * 2.0, 1.0)

        def map_y(value: float) -> float:
            normalized = max(0.0, min(1.0, (value - channel.min_value) / range_value))
            return rect.top() + vertical_padding + (1.0 - normalized) * drawable_height

        painter.setPen(QPen(QColor("#8ab6ff"), 1.0))
        sample_count = len(channel.samples)
        if sample_count <= max(int(rect.width()), 1) * 8:
            cache_key = (
                channel.name,
                sample_count,
                int(rect.width()),
                int(rect.height()),
            )
            path = self._path_cache.get(cache_key)
            if path is None:
                path = QPainterPath()
                for index, value in enumerate(channel.samples):
                    x = rect.left() + (index / max(sample_count - 1, 1)) * rect.width()
                    y = map_y(float(value))
                    if index == 0:
                        path.moveTo(x, y)
                    else:
                        path.lineTo(x, y)
                self._path_cache[cache_key] = path
            painter.drawPath(path)
            return

        bucket_level = None
        target_segments = max(int(rect.width() * 2), 1)
        ideal_bucket = max(1, math.ceil(sample_count / target_segments))
        for level in channel.levels:
            if level.bucket_size <= ideal_bucket:
                bucket_level = level
        if bucket_level is None and channel.levels:
            bucket_level = channel.levels[0]

        if bucket_level is None:
            return
        cache_key = (
            channel.name,
            sample_count,
            bucket_level.bucket_size,
            int(rect.width()),
            int(rect.height()),
        )
        segments = self._segment_cache.get(cache_key)
        if segments is None:
            segments = []
            for bucket_index, (bucket_min, bucket_max) in enumerate(
                zip(bucket_level.mins, bucket_level.maxs)
            ):
                x = (
                    rect.left()
                    + (bucket_index / max(len(bucket_level.mins) - 1, 1)) * rect.width()
                )
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

    def _draw_annotation_overlays(
        self,
        painter: QPainter,
        channel_name: str,
        rect: QRectF,
        row_index: int,
    ) -> None:
        if not self.annotations or self.display_duration_seconds <= 0:
            return
        for annotation in self.annotations:
            if (
                annotation.channel_name is not None
                and annotation.channel_name != channel_name
            ):
                continue
            color = QColor("#f6c453") if annotation.channel_name else QColor("#72d0ff")
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
        painter.setPen(QPen(QColor("#0f1720"), 1.0))
        painter.setBrush(fill_color)
        painter.drawRoundedRect(flag_rect, 5.0, 5.0)
        painter.setPen(QColor("#081018"))
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

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._resize_cache_timer.start(90)
        self.update()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        paint_started_ns = perf_counter_ns()
        painter = QPainter(self)
        if not self.overview or not self.overview.channels:
            painter.fillRect(self.rect(), QColor("#121922"))
            painter.setPen(QColor("#94a3b8"))
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
            painter.fillRect(self.rect(), QColor("#121922"))

        if self.dataset_duration_seconds > 0:
            self._draw_annotation_overlays(painter)
            left = (
                self.viewport_start_seconds / self.dataset_duration_seconds
            ) * self.width()
            width = (
                self.viewport_duration_seconds / self.dataset_duration_seconds
            ) * self.width()
            painter.fillRect(
                QRectF(left, 0, width, self.height()), QColor(95, 157, 255, 38)
            )
            painter.setPen(QPen(QColor("#5f9dff"), 2))
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

        center_y = rect.top() + rect.height() / 2.0
        painter.setPen(QPen(QColor("#203040"), 1.0))
        painter.drawLine(
            QPointF(rect.left(), center_y), QPointF(rect.right(), center_y)
        )

        range_value = max(channel.max_value - channel.min_value, 1e-6)

        def map_y(value: float) -> float:
            normalized = max(0.0, min(1.0, (value - channel.min_value) / range_value))
            return rect.bottom() - normalized * max(rect.height() - 8.0, 1.0) - 4.0

        painter.setPen(QPen(QColor("#79c1b5"), 1.0))
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
            painter.setPen(QColor("#d9e4ee"))
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
        pixmap.fill(QColor("#121922"))
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
        if not self.annotations or self.dataset_duration_seconds <= 0:
            return
        for annotation in self.annotations:
            color = QColor("#f6c453") if annotation.channel_name else QColor("#72d0ff")
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
        painter.setPen(QPen(QColor("#0f1720"), 1.0))
        painter.setBrush(fill_color)
        painter.drawRoundedRect(flag_rect, 5.0, 5.0)
        painter.setPen(QColor("#081018"))
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


HEATMAP_COLOR_SCHEME_OPTIONS: tuple[tuple[str, str], ...] = (
    ("viridis", "Viridis"),
    ("plasma", "Plasma"),
    ("inferno", "Inferno"),
    ("jet", "Jet"),
    ("cool", "Cool"),
    ("hot", "Hot"),
)

_VIRIDIS_STOPS: tuple[tuple[int, int, int], ...] = (
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
)

_PLASMA_STOPS: tuple[tuple[int, int, int], ...] = (
    (13, 8, 135),
    (75, 3, 161),
    (125, 3, 168),
    (168, 34, 150),
    (203, 70, 121),
    (229, 107, 93),
    (248, 148, 65),
    (253, 195, 40),
    (239, 248, 33),
)

_INFERNO_STOPS: tuple[tuple[int, int, int], ...] = (
    (0, 0, 4),
    (31, 12, 72),
    (85, 15, 109),
    (136, 34, 106),
    (186, 54, 85),
    (227, 89, 51),
    (249, 140, 10),
    (249, 201, 50),
    (252, 255, 164),
)

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


class HeatmapWidget(QWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(320)
        self.variant: Optional[DdaVariantResult] = None
        self.color_scheme = "viridis"
        self._heatmap_pixmap: Optional[QPixmap] = None

    def set_variant(self, variant: Optional[DdaVariantResult]) -> None:
        if variant is not self.variant:
            self._invalidate_render_cache()
        self.variant = variant
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

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._invalidate_render_cache()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#141b23"))
        variant = self.variant
        if not variant or not variant.matrix or not variant.matrix[0]:
            painter.setPen(QColor("#94a3b8"))
            painter.drawText(
                self.rect(), Qt.AlignCenter, "Run DDA to see a result heatmap"
            )
            return
        pixmap = self._ensure_heatmap_pixmap()
        if pixmap is not None and not pixmap.isNull():
            painter.drawPixmap(self.rect(), pixmap)

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
        if (
            self._heatmap_pixmap is not None
            and self._heatmap_pixmap.size() == self.size()
        ):
            return self._heatmap_pixmap

        rows = len(variant.matrix)
        cols = max(len(row) for row in variant.matrix)
        left_gutter = 104
        top_gutter = 12
        rect = QRectF(
            left_gutter,
            top_gutter,
            max(self.width() - left_gutter - 12, 20),
            max(self.height() - top_gutter - 12, 20),
        )
        cell_height = rect.height() / max(rows, 1)
        value_range = max(variant.max_value - variant.min_value, 1e-6)

        pixmap = QPixmap(self.size())
        pixmap.fill(QColor("#141b23"))
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing, False)

        image = QImage(max(cols, 1), max(rows, 1), QImage.Format_RGB32)
        for row_index, row in enumerate(variant.matrix):
            for col_index in range(cols):
                value = row[col_index] if col_index < len(row) else variant.min_value
                image.setPixelColor(
                    col_index,
                    row_index,
                    _heat_color(
                        value,
                        variant.min_value,
                        value_range,
                        self.color_scheme,
                    ),
                )
        painter.drawImage(rect, image, QRectF(image.rect()))

        painter.setPen(QColor("#dbe4ed"))
        for row_index, label in enumerate(variant.row_labels):
            y = rect.top() + row_index * cell_height + cell_height * 0.65
            painter.drawText(
                QRectF(8, y - 12, left_gutter - 14, 20), Qt.AlignRight, label[:18]
            )
        painter.end()
        self._heatmap_pixmap = pixmap
        return pixmap

    def _invalidate_render_cache(self) -> None:
        self._heatmap_pixmap = None


def _heat_color(
    value: float,
    min_value: float,
    value_range: float,
    color_scheme: str,
) -> QColor:
    normalized = max(0.0, min(1.0, (value - min_value) / value_range))
    if color_scheme == "viridis":
        return _interpolate_stops(normalized, _VIRIDIS_STOPS)
    if color_scheme == "plasma":
        return _interpolate_stops(normalized, _PLASMA_STOPS)
    if color_scheme == "inferno":
        return _interpolate_stops(normalized, _INFERNO_STOPS)
    if color_scheme == "jet":
        red = max(0.0, min(1.0, 1.5 - 4.0 * abs(normalized - 0.75)))
        green = max(0.0, min(1.0, 1.5 - 4.0 * abs(normalized - 0.5)))
        blue = max(0.0, min(1.0, 1.5 - 4.0 * abs(normalized - 0.25)))
        return QColor(
            int(round(red * 255.0)),
            int(round(green * 255.0)),
            int(round(blue * 255.0)),
        )
    if color_scheme == "cool":
        return QColor(
            int(round(normalized * 255.0)),
            int(round((1.0 - normalized) * 255.0)),
            255,
        )
    if color_scheme == "hot":
        if normalized < 0.4:
            red = normalized / 0.4
            green = 0.0
            blue = 0.0
        elif normalized < 0.8:
            red = 1.0
            green = (normalized - 0.4) / 0.4
            blue = 0.0
        else:
            red = 1.0
            green = 1.0
            blue = (normalized - 0.8) / 0.2
        return QColor(
            int(round(max(0.0, min(1.0, red)) * 255.0)),
            int(round(max(0.0, min(1.0, green)) * 255.0)),
            int(round(max(0.0, min(1.0, blue)) * 255.0)),
        )
    return _interpolate_stops(normalized, _VIRIDIS_STOPS)


def _interpolate_stops(
    t: float,
    stops: tuple[tuple[int, int, int], ...],
) -> QColor:
    if len(stops) == 1:
        red, green, blue = stops[0]
        return QColor(red, green, blue)
    position = max(0.0, min(1.0, t)) * (len(stops) - 1)
    index = min(int(position), len(stops) - 1)
    fraction = position - index
    start = stops[index]
    end = stops[min(index + 1, len(stops) - 1)]
    red = round(start[0] + fraction * (end[0] - start[0]))
    green = round(start[1] + fraction * (end[1] - start[1]))
    blue = round(start[2] + fraction * (end[2] - start[2]))
    return QColor(red, green, blue)


class DdaLinePlotWidget(QWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(240)
        self.variant: Optional[DdaVariantResult] = None
        self.window_centers_seconds: List[float] = []
        self._lineplot_pixmap: Optional[QPixmap] = None

    def set_variant(
        self,
        variant: Optional[DdaVariantResult],
        window_centers_seconds: Optional[List[float]] = None,
    ) -> None:
        if (
            variant is not self.variant
            or window_centers_seconds != self.window_centers_seconds
        ):
            self._invalidate_render_cache()
        self.variant = variant
        self.window_centers_seconds = list(window_centers_seconds or [])
        self.update()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._invalidate_render_cache()
        super().resizeEvent(event)

    def paintEvent(self, event) -> None:  # type: ignore[override]
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor("#141b23"))
        variant = self.variant
        if not variant or not variant.matrix or not variant.matrix[0]:
            painter.setPen(QColor("#94a3b8"))
            painter.drawText(
                self.rect(),
                Qt.AlignCenter,
                "Run DDA to see the line plot",
            )
            return
        pixmap = self._ensure_lineplot_pixmap()
        if pixmap is not None and not pixmap.isNull():
            painter.drawPixmap(self.rect(), pixmap)

    def _ensure_lineplot_pixmap(self) -> Optional[QPixmap]:
        variant = self.variant
        if (
            variant is None
            or not variant.matrix
            or not variant.matrix[0]
            or self.width() <= 0
            or self.height() <= 0
        ):
            return None
        if (
            self._lineplot_pixmap is not None
            and self._lineplot_pixmap.size() == self.size()
        ):
            return self._lineplot_pixmap

        row_count = len(variant.matrix)
        column_count = max(len(row) for row in variant.matrix)
        x_values = self._x_values(column_count)
        all_values = [value for row in variant.matrix for value in row]
        min_value = min(all_values) if all_values else 0.0
        max_value = max(all_values) if all_values else 1.0
        if math.isclose(min_value, max_value, rel_tol=1e-9, abs_tol=1e-9):
            padding = max(abs(min_value) * 0.1, 1.0)
            min_value -= padding
            max_value += padding
        else:
            span = max_value - min_value
            padding = span * 0.08
            min_value -= padding
            max_value += padding
        x_min = x_values[0]
        x_max = x_values[-1]
        if math.isclose(x_min, x_max, rel_tol=1e-9, abs_tol=1e-9):
            x_max = x_min + 1.0

        pixmap = QPixmap(self.size())
        pixmap.fill(QColor("#141b23"))
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing, True)

        left_margin = 56.0
        top_margin = 18.0
        right_margin = 20.0
        bottom_margin = 38.0
        plot_rect = QRectF(
            left_margin,
            top_margin,
            max(20.0, self.width() - left_margin - right_margin),
            max(20.0, self.height() - top_margin - bottom_margin),
        )

        painter.fillRect(plot_rect, QColor("#101720"))
        grid_pen = QPen(QColor("#223041"), 1.0)
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

        painter.setPen(QPen(QColor("#3b4b5f"), 1.2))
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

        for row_index, row in enumerate(variant.matrix):
            if not row:
                continue
            path = QPainterPath()
            for column_index, value in enumerate(row):
                x = map_x(x_values[min(column_index, len(x_values) - 1)])
                y = map_y(value)
                if column_index == 0:
                    path.moveTo(x, y)
                else:
                    path.lineTo(x, y)
            pen = QPen(
                QColor(_LINE_PLOT_COLORS[row_index % len(_LINE_PLOT_COLORS)]), 1.6
            )
            painter.setPen(pen)
            painter.drawPath(path)

        painter.setPen(QColor("#dbe4ed"))
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

        title_font = painter.font()
        title_font.setBold(True)
        painter.setFont(title_font)
        painter.drawText(
            QRectF(left_margin, 0.0, plot_rect.width(), 18.0),
            Qt.AlignLeft | Qt.AlignVCenter,
            "DDA Line Plot",
        )
        painter.setFont(value_font)
        painter.setPen(QColor("#94a3b8"))
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
        for row_index in range(legend_entries):
            label = (
                variant.row_labels[row_index]
                if row_index < len(variant.row_labels)
                else f"Row {row_index + 1}"
            )
            color = QColor(_LINE_PLOT_COLORS[row_index % len(_LINE_PLOT_COLORS)])
            painter.setPen(QPen(color, 2.4))
            y = legend_y + row_index * 18.0 + 8.0
            painter.drawLine(QPointF(legend_x, y), QPointF(legend_x + 16.0, y))
            painter.setPen(QColor("#cdd8e3"))
            painter.drawText(
                QRectF(legend_x + 22.0, y - 8.0, 160.0, 16.0),
                Qt.AlignLeft | Qt.AlignVCenter,
                painter.fontMetrics().elidedText(label, Qt.ElideRight, 156),
            )
        if row_count > legend_entries:
            painter.setPen(QColor("#7f8ea3"))
            painter.drawText(
                QRectF(legend_x, legend_y + legend_entries * 18.0 + 2.0, 180.0, 16.0),
                Qt.AlignLeft | Qt.AlignVCenter,
                f"+{row_count - legend_entries} more",
            )

        painter.end()
        self._lineplot_pixmap = pixmap
        return pixmap

    def _x_values(self, column_count: int) -> List[float]:
        if len(self.window_centers_seconds) >= column_count and column_count > 0:
            return self.window_centers_seconds[:column_count]
        return [float(index) for index in range(max(column_count, 1))]

    def _invalidate_render_cache(self) -> None:
        self._lineplot_pixmap = None
