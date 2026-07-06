from __future__ import annotations

import math
from time import perf_counter_ns
from typing import List, Optional

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import QColor, QPainter, QPen
from PySide6.QtWidgets import QWidget

from ...app.runtime.perf_logging import perf_logger
from ...domain.models import DdaVariantResult
from ..style import current_theme_colors

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
