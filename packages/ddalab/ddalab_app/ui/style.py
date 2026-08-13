from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from matplotlib import font_manager
from PySide6.QtGui import QColor, QFont, QFontDatabase, QGuiApplication, QPalette

from ..runtime_paths import RuntimePaths

THEME_MODE_PROPERTY = "ddalab.themeMode"
_LOGGER = logging.getLogger("ddalab.ui")


@dataclass(frozen=True)
class ThemeColors:
    mode: str
    window_bg: str
    surface_bg: str
    surface_alt_bg: str
    panel_bg: str
    panel_alt_bg: str
    input_bg: str
    menu_bg: str
    border: str
    border_strong: str
    text: str
    text_muted: str
    text_title: str
    accent_bg: str
    accent_hover_bg: str
    accent_pressed_bg: str
    accent_text: str
    disabled_bg: str
    disabled_border: str
    disabled_text: str
    selection_bg: str
    selection_text: str
    plot_surface: str
    plot_surface_alt: str
    plot_canvas: str
    plot_text: str
    plot_muted_text: str
    plot_border: str
    annotation_channel: str
    annotation_global: str


_DARK_THEME = ThemeColors(
    mode="dark",
    window_bg="#11161d",
    surface_bg="#141b23",
    surface_alt_bg="#151c24",
    panel_bg="#131922",
    panel_alt_bg="#18202a",
    input_bg="#17202a",
    menu_bg="#17202a",
    border="#2b3645",
    border_strong="#3d5670",
    text="#eef2f6",
    text_muted="#94a3b8",
    text_title="#f6fbff",
    accent_bg="#20374f",
    accent_hover_bg="#27405c",
    accent_pressed_bg="#1d3147",
    accent_text="#f4f7fb",
    disabled_bg="#151d26",
    disabled_border="#242e3a",
    disabled_text="#6f8093",
    selection_bg="#355172",
    selection_text="#ffffff",
    plot_surface="#141b23",
    plot_surface_alt="#121922",
    plot_canvas="#101720",
    plot_text="#dbe4ed",
    plot_muted_text="#94a3b8",
    plot_border="#3b4b5f",
    annotation_channel="#f6c453",
    annotation_global="#72d0ff",
)

_LIGHT_THEME = ThemeColors(
    mode="light",
    window_bg="#f4f7fb",
    surface_bg="#ffffff",
    surface_alt_bg="#f8fbff",
    panel_bg="#f2f6fb",
    panel_alt_bg="#eef3f8",
    input_bg="#ffffff",
    menu_bg="#ffffff",
    border="#c9d6e3",
    border_strong="#b6c6d8",
    text="#1f2b37",
    text_muted="#617386",
    text_title="#0f1a25",
    accent_bg="#2563eb",
    accent_hover_bg="#1d4ed8",
    accent_pressed_bg="#1e40af",
    accent_text="#ffffff",
    disabled_bg="#f0f4f8",
    disabled_border="#d9e2ec",
    disabled_text="#94a3b8",
    selection_bg="#cfe2f8",
    selection_text="#102030",
    plot_surface="#ffffff",
    plot_surface_alt="#f7fafe",
    plot_canvas="#f3f7fb",
    plot_text="#13202c",
    plot_muted_text="#627387",
    plot_border="#b7c7d8",
    annotation_channel="#d97706",
    annotation_global="#0891b2",
)


def normalize_theme_mode(value: object) -> str:
    return "light" if str(value).strip().lower() == "light" else "dark"


def theme_colors(mode: object = "dark") -> ThemeColors:
    return _LIGHT_THEME if normalize_theme_mode(mode) == "light" else _DARK_THEME


def current_theme_mode(_source: object | None = None) -> str:
    app = QGuiApplication.instance()
    if app is None:
        return "dark"
    return normalize_theme_mode(app.property(THEME_MODE_PROPERTY))


def current_theme_colors(_source: object | None = None) -> ThemeColors:
    return theme_colors(current_theme_mode())


def apply_theme(
    app: QGuiApplication,
    runtime_paths: RuntimePaths,
    mode: object = "dark",
) -> str:
    normalized = normalize_theme_mode(mode)
    app.setProperty(THEME_MODE_PROPERTY, normalized)
    app.setPalette(_build_palette(theme_colors(normalized)))
    app.setFont(QFont(_load_fonts(runtime_paths), 10))
    return normalized


def _build_palette(colors: ThemeColors) -> QPalette:
    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor(colors.window_bg))
    palette.setColor(QPalette.ColorRole.WindowText, QColor(colors.text))
    palette.setColor(QPalette.ColorRole.Base, QColor(colors.input_bg))
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor(colors.surface_alt_bg))
    palette.setColor(QPalette.ColorRole.ToolTipBase, QColor(colors.menu_bg))
    palette.setColor(QPalette.ColorRole.ToolTipText, QColor(colors.text))
    palette.setColor(QPalette.ColorRole.Text, QColor(colors.text))
    palette.setColor(QPalette.ColorRole.Button, QColor(colors.surface_bg))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor(colors.text))
    palette.setColor(QPalette.ColorRole.BrightText, QColor(colors.accent_text))
    palette.setColor(QPalette.ColorRole.Highlight, QColor(colors.selection_bg))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor(colors.selection_text))
    palette.setColor(QPalette.ColorRole.PlaceholderText, QColor(colors.text_muted))
    disabled = QPalette.ColorGroup.Disabled
    palette.setColor(
        disabled, QPalette.ColorRole.WindowText, QColor(colors.disabled_text)
    )
    palette.setColor(disabled, QPalette.ColorRole.Text, QColor(colors.disabled_text))
    palette.setColor(
        disabled, QPalette.ColorRole.ButtonText, QColor(colors.disabled_text)
    )
    palette.setColor(disabled, QPalette.ColorRole.Base, QColor(colors.disabled_bg))
    palette.setColor(disabled, QPalette.ColorRole.Button, QColor(colors.disabled_bg))
    return palette


def _load_fonts(runtime_paths: RuntimePaths) -> str:
    loaded_families: list[str] = []
    for font_dir in runtime_paths.font_search_dirs():
        for font_name in (
            "ibm_plex_sans_regular.ttf",
            "ibm_plex_sans_medium.ttf",
            "ibm_plex_sans_semibold.ttf",
        ):
            font_path = font_dir / font_name
            if not font_path.exists():
                continue
            if _looks_like_html(font_path):
                _LOGGER.warning("Skipping invalid bundled font asset: %s", font_path)
                continue
            font_id = QFontDatabase.addApplicationFont(str(font_path))
            if font_id >= 0:
                font_manager.fontManager.addfont(str(font_path))
                loaded_families.extend(QFontDatabase.applicationFontFamilies(font_id))
        if loaded_families:
            break
    return loaded_families[0] if loaded_families else "Helvetica Neue"


def _looks_like_html(font_path: Path) -> bool:
    try:
        with font_path.open("rb") as handle:
            prefix = handle.read(256).lstrip()
    except OSError:
        return False
    return prefix.startswith((b"<!DOCTYPE html", b"<html"))
