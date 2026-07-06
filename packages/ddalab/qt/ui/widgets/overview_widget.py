from __future__ import annotations

from time import perf_counter_ns
from typing import Dict, List, Optional, Tuple

from PySide6.QtCore import QPointF, QRectF, Qt, QTimer, Signal
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
    WaveformAnnotation,
    WaveformOverview,
)
from ..style import current_theme_colors


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
