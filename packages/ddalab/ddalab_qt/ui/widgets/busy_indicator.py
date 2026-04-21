from __future__ import annotations

from PySide6.QtCore import QTimer, Qt
from PySide6.QtGui import QColor, QLinearGradient, QPainter, QPaintEvent, QPen
from PySide6.QtWidgets import QSizePolicy, QWidget

from ..style import current_theme_colors


class BusyIndicatorBar(QWidget):
    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        bar_height: int = 6,
        interval_ms: int = 48,
    ) -> None:
        super().__init__(parent)
        self._bar_height = max(3, bar_height)
        self._phase = 0.0
        self._running = False
        self._timer = QTimer(self)
        self._timer.setInterval(interval_ms)
        self._timer.timeout.connect(self._advance)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setMinimumWidth(72)
        self.setFixedHeight(self._bar_height + 4)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)

    def set_running(self, running: bool) -> None:
        self._running = running
        if running and self.isVisible():
            self._timer.start()
        else:
            self._timer.stop()
        self.update()

    def showEvent(self, event) -> None:  # type: ignore[override]
        super().showEvent(event)
        if self._running:
            self._timer.start()

    def hideEvent(self, event) -> None:  # type: ignore[override]
        self._timer.stop()
        super().hideEvent(event)

    def paintEvent(self, event: QPaintEvent) -> None:  # type: ignore[override]
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing, True)
        theme = current_theme_colors(self)

        rect = self.rect().adjusted(1, 1, -1, -1)
        if rect.width() <= 0 or rect.height() <= 0:
            return

        track_height = min(self._bar_height, rect.height())
        y = rect.y() + (rect.height() - track_height) / 2
        radius = track_height / 2
        track_rect = rect.adjusted(0, int(y - rect.y()), 0, -int(rect.bottom() - (y + track_height)))

        painter.setPen(QPen(QColor(*theme.busy_track_border), 1))
        painter.setBrush(QColor(*theme.busy_track_fill))
        painter.drawRoundedRect(track_rect, radius, radius)

        if not self._running:
            return

        span = min(max(track_rect.width() * 0.3, 24.0), 42.0)
        travel = max(track_rect.width() - span, 1.0)
        x = track_rect.x() + (self._phase * travel)
        glow_rect = track_rect.adjusted(int(x - track_rect.x()), 0, -int(track_rect.width() - (x - track_rect.x()) - span), 0)

        gradient = QLinearGradient(glow_rect.topLeft(), glow_rect.topRight())
        gradient.setColorAt(0.0, QColor(*theme.busy_glow_start))
        gradient.setColorAt(0.15, QColor(*theme.busy_glow_mid_start))
        gradient.setColorAt(0.5, QColor(*theme.busy_glow_mid))
        gradient.setColorAt(0.85, QColor(*theme.busy_glow_mid_end))
        gradient.setColorAt(1.0, QColor(*theme.busy_glow_end))
        painter.setPen(Qt.NoPen)
        painter.setBrush(gradient)
        painter.drawRoundedRect(glow_rect, radius, radius)

    def _advance(self) -> None:
        self._phase = (self._phase + 0.022) % 1.0
        self.update()
