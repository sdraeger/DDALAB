from __future__ import annotations

import io
from functools import lru_cache
from typing import Optional

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QLabel, QSizePolicy

from ..style import current_theme_colors

try:
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure
    from matplotlib.font_manager import FontProperties
except Exception:  # noqa: BLE001
    FigureCanvasAgg = None
    Figure = None
    FontProperties = None


@lru_cache(maxsize=256)
def _render_math_png(
    expression: str,
    color: str,
    font_size: float,
    font_family: str,
) -> bytes:
    if FigureCanvasAgg is None or Figure is None or FontProperties is None:
        raise RuntimeError("Matplotlib math renderer is unavailable.")
    font_props = FontProperties(
        family=[font_family] if font_family else None,
        size=font_size,
    )
    fig = Figure(figsize=(0.01, 0.01))
    FigureCanvasAgg(fig)
    fig.patch.set_alpha(0.0)
    fig.text(
        0.0,
        0.0,
        _mathtext_expression(expression),
        fontproperties=font_props,
        color=color,
    )
    buffer = io.BytesIO()
    fig.savefig(
        buffer,
        dpi=200,
        format="png",
        transparent=True,
        bbox_inches="tight",
        pad_inches=0.02,
    )
    return buffer.getvalue()


class MathLabel(QLabel):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._expression: Optional[str] = None
        self._fallback_text = ""
        self.setAlignment(
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter
        )
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self.setMinimumHeight(28)
        self.setTextFormat(Qt.TextFormat.PlainText)
        self.setWordWrap(False)

    def set_math_expression(
        self,
        expression: Optional[str],
        *,
        fallback_text: str = "",
    ) -> None:
        self._expression = expression.strip() if expression else None
        self._fallback_text = fallback_text
        self._rerender()

    def refresh_theme(self) -> None:
        self._rerender()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        self._rerender()
        super().resizeEvent(event)

    def _rerender(self) -> None:
        if not self._expression:
            self.setPixmap(QPixmap())
            self.setText(self._display_fallback_text())
            self.setToolTip(self._display_fallback_text())
            return

        colors = current_theme_colors(self)
        font = self.font()
        font_size = max(font.pointSizeF(), 11.0)
        try:
            png_bytes = _render_math_png(
                self._expression,
                colors.text,
                round(font_size, 2),
                font.family(),
            )
            pixmap = QPixmap()
            if not pixmap.loadFromData(png_bytes, "PNG"):
                raise RuntimeError("Invalid raster data produced for math expression.")
            if pixmap.width() <= 0 or pixmap.height() <= 0:
                raise RuntimeError("Math renderer returned an empty size.")
            available_width = max(self.contentsRect().width(), 1)
            display_pixmap = pixmap
            if pixmap.width() > available_width:
                display_pixmap = pixmap.scaled(
                    available_width,
                    max(1, round(pixmap.height() * (available_width / pixmap.width()))),
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            self.setPixmap(display_pixmap)
            self.setText("")
            self.setMinimumHeight(
                max(
                    16,
                    int(
                        round(
                            display_pixmap.height()
                            / max(display_pixmap.devicePixelRatioF(), 1.0)
                        )
                    )
                    + 4,
                )
            )
            self.setToolTip(self._display_fallback_text())
        except Exception:  # noqa: BLE001
            self.setPixmap(QPixmap())
            self.setText(self._display_fallback_text())
            self.setToolTip(self._display_fallback_text())

    def _display_fallback_text(self) -> str:
        if self._fallback_text:
            return self._fallback_text
        if not self._expression:
            return ""
        expression = self._expression
        replacements = {
            r"\dot{x}": "dx/dt",
            r"\left(": "(",
            r"\right)": ")",
            r"\,": " ",
            "{": "",
            "}": "",
            "\\": "",
        }
        for source, target in replacements.items():
            expression = expression.replace(source, target)
        return " ".join(expression.split())


def _mathtext_expression(expression: str) -> str:
    stripped = expression.strip()
    if stripped.startswith("$") and stripped.endswith("$"):
        return stripped
    return f"${stripped}$"
