from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtGui import QColor, QFont, QFontDatabase, QPalette
from PySide6.QtWidgets import QApplication, QWidget

from ..runtime_paths import RuntimePaths


THEME_MODE_PROPERTY = "ddalab.themeMode"


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
    menu_selected_bg: str
    group_bg: str
    border: str
    border_strong: str
    text: str
    text_muted: str
    text_title: str
    accent_bg: str
    accent_hover_bg: str
    accent_pressed_bg: str
    accent_border: str
    accent_text: str
    secondary_bg: str
    secondary_hover_bg: str
    secondary_border: str
    secondary_text: str
    disabled_bg: str
    disabled_border: str
    disabled_text: str
    selection_bg: str
    selection_text: str
    checkbox_bg: str
    checkbox_border: str
    checkbox_checked_bg: str
    checkbox_checked_border: str
    progress_bg: str
    progress_chunk: str
    header_bg: str
    title_bar_bg: str
    file_tab_bg: str
    file_tab_strip_bg: str
    splitter_handle: str
    splitter_handle_hover: str
    scrollbar_handle: str
    plot_surface: str
    plot_surface_alt: str
    plot_canvas: str
    plot_text: str
    plot_muted_text: str
    plot_grid: str
    plot_grid_alt: str
    plot_border: str
    plot_baseline: str
    waveform_line: str
    overview_line: str
    viewport_fill: tuple[int, int, int, int]
    viewport_border: str
    annotation_channel: str
    annotation_global: str
    annotation_flag_border: str
    annotation_flag_text: str
    busy_track_border: tuple[int, int, int, int]
    busy_track_fill: tuple[int, int, int, int]
    busy_glow_start: tuple[int, int, int, int]
    busy_glow_mid_start: tuple[int, int, int, int]
    busy_glow_mid: tuple[int, int, int, int]
    busy_glow_mid_end: tuple[int, int, int, int]
    busy_glow_end: tuple[int, int, int, int]


_DARK_THEME = ThemeColors(
    mode="dark",
    window_bg="#11161d",
    surface_bg="#141b23",
    surface_alt_bg="#151c24",
    panel_bg="#131922",
    panel_alt_bg="#18202a",
    input_bg="#17202a",
    menu_bg="#17202a",
    menu_selected_bg="#243447",
    group_bg="#141b23",
    border="#2b3645",
    border_strong="#3d5670",
    text="#eef2f6",
    text_muted="#94a3b8",
    text_title="#f6fbff",
    accent_bg="#20374f",
    accent_hover_bg="#27405c",
    accent_pressed_bg="#1d3147",
    accent_border="#33506c",
    accent_text="#f4f7fb",
    secondary_bg="#18212b",
    secondary_hover_bg="#1d2a38",
    secondary_border="#2d3948",
    secondary_text="#d1d9e2",
    disabled_bg="#151d26",
    disabled_border="#242e3a",
    disabled_text="#6f8093",
    selection_bg="#355172",
    selection_text="#ffffff",
    checkbox_bg="#14202c",
    checkbox_border="#35506a",
    checkbox_checked_bg="#315379",
    checkbox_checked_border="#4d7aad",
    progress_bg="#16202b",
    progress_chunk="#4c85cf",
    header_bg="#18202a",
    title_bar_bg="#151c24",
    file_tab_bg="#161f29",
    file_tab_strip_bg="#131922",
    splitter_handle="#131923",
    splitter_handle_hover="#223246",
    scrollbar_handle="#2b3a4d",
    plot_surface="#141b23",
    plot_surface_alt="#121922",
    plot_canvas="#101720",
    plot_text="#dbe4ed",
    plot_muted_text="#94a3b8",
    plot_grid="#223041",
    plot_grid_alt="#253242",
    plot_border="#3b4b5f",
    plot_baseline="#203040",
    waveform_line="#8ab6ff",
    overview_line="#79c1b5",
    viewport_fill=(95, 157, 255, 38),
    viewport_border="#5f9dff",
    annotation_channel="#f6c453",
    annotation_global="#72d0ff",
    annotation_flag_border="#0f1720",
    annotation_flag_text="#081018",
    busy_track_border=(88, 107, 128, 55),
    busy_track_fill=(24, 33, 44, 185),
    busy_glow_start=(103, 149, 214, 28),
    busy_glow_mid_start=(103, 149, 214, 120),
    busy_glow_mid=(132, 180, 235, 225),
    busy_glow_mid_end=(103, 149, 214, 120),
    busy_glow_end=(103, 149, 214, 28),
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
    menu_selected_bg="#dce9f7",
    group_bg="#fbfdff",
    border="#c9d6e3",
    border_strong="#b6c6d8",
    text="#1f2b37",
    text_muted="#617386",
    text_title="#0f1a25",
    accent_bg="#2563eb",
    accent_hover_bg="#1d4ed8",
    accent_pressed_bg="#1e40af",
    accent_border="#1d4ed8",
    accent_text="#ffffff",
    secondary_bg="#f5f8fc",
    secondary_hover_bg="#eaf0f7",
    secondary_border="#cbd8e6",
    secondary_text="#1f2b37",
    disabled_bg="#f0f4f8",
    disabled_border="#d9e2ec",
    disabled_text="#94a3b8",
    selection_bg="#cfe2f8",
    selection_text="#102030",
    checkbox_bg="#ffffff",
    checkbox_border="#9db4cc",
    checkbox_checked_bg="#2563eb",
    checkbox_checked_border="#1d4ed8",
    progress_bg="#e7edf4",
    progress_chunk="#2563eb",
    header_bg="#eff4f9",
    title_bar_bg="#ffffff",
    file_tab_bg="#f7fafe",
    file_tab_strip_bg="#f2f6fb",
    splitter_handle="#dde5ef",
    splitter_handle_hover="#c8d6e6",
    scrollbar_handle="#b9c8d7",
    plot_surface="#ffffff",
    plot_surface_alt="#f7fafe",
    plot_canvas="#f3f7fb",
    plot_text="#13202c",
    plot_muted_text="#627387",
    plot_grid="#dbe5f0",
    plot_grid_alt="#ced9e5",
    plot_border="#b7c7d8",
    plot_baseline="#d3dce7",
    waveform_line="#2563eb",
    overview_line="#0f766e",
    viewport_fill=(37, 99, 235, 34),
    viewport_border="#2563eb",
    annotation_channel="#d97706",
    annotation_global="#0891b2",
    annotation_flag_border="#0f1720",
    annotation_flag_text="#081018",
    busy_track_border=(143, 160, 180, 72),
    busy_track_fill=(225, 232, 240, 220),
    busy_glow_start=(37, 99, 235, 20),
    busy_glow_mid_start=(37, 99, 235, 92),
    busy_glow_mid=(59, 130, 246, 185),
    busy_glow_mid_end=(37, 99, 235, 92),
    busy_glow_end=(37, 99, 235, 20),
)


def normalize_theme_mode(value: object) -> str:
    return "light" if str(value).strip().lower() == "light" else "dark"


def theme_colors(mode: object = "dark") -> ThemeColors:
    normalized = normalize_theme_mode(mode)
    return _LIGHT_THEME if normalized == "light" else _DARK_THEME


def current_theme_mode(widget: QWidget | None = None) -> str:
    del widget
    app = QApplication.instance()
    if app is None:
        return "dark"
    return normalize_theme_mode(app.property(THEME_MODE_PROPERTY))


def current_theme_colors(widget: QWidget | None = None) -> ThemeColors:
    return theme_colors(current_theme_mode(widget))


def apply_theme(
    app: QApplication,
    runtime_paths: RuntimePaths,
    mode: object = "dark",
) -> str:
    normalized = normalize_theme_mode(mode)
    colors = theme_colors(normalized)
    font_family = _load_fonts(runtime_paths)
    checkbox_icon = runtime_paths.package_asset("checkbox-check.svg").as_posix()
    app.setProperty(THEME_MODE_PROPERTY, normalized)
    app.setPalette(_build_palette(colors))
    app.setStyleSheet(_build_stylesheet(colors, font_family, checkbox_icon))
    app.setFont(QFont(font_family, 10))
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
    palette.setColor(
        QPalette.ColorRole.HighlightedText, QColor(colors.selection_text)
    )
    palette.setColor(
        QPalette.ColorRole.PlaceholderText, QColor(colors.text_muted)
    )
    disabled = QPalette.ColorGroup.Disabled
    palette.setColor(disabled, QPalette.ColorRole.WindowText, QColor(colors.disabled_text))
    palette.setColor(disabled, QPalette.ColorRole.Text, QColor(colors.disabled_text))
    palette.setColor(disabled, QPalette.ColorRole.ButtonText, QColor(colors.disabled_text))
    palette.setColor(disabled, QPalette.ColorRole.Base, QColor(colors.disabled_bg))
    palette.setColor(disabled, QPalette.ColorRole.Button, QColor(colors.disabled_bg))
    return palette


def _build_stylesheet(
    colors: ThemeColors,
    font_family: str,
    checkbox_icon: str,
) -> str:
    return f"""
        QWidget {{
            background: {colors.window_bg};
            color: {colors.text};
            font-family: "{font_family}";
            font-size: 13px;
        }}
        QMainWindow, QFrame, QSplitter, QListWidget, QTreeWidget, QTableWidget, QStackedWidget {{
            background: {colors.window_bg};
        }}
        QScrollArea {{
            border: none;
            background: transparent;
        }}
        QScrollArea > QWidget > QWidget {{
            background: transparent;
        }}
        QFrame#title-bar {{
            background: {colors.title_bar_bg};
            border-bottom: 1px solid {colors.border};
        }}
        QFrame#file-tab-strip {{
            background: {colors.file_tab_strip_bg};
            border-top: 1px solid {colors.border};
            border-bottom: 1px solid {colors.border};
        }}
        QMenuBar, QToolBar, QStatusBar {{
            background: {colors.surface_alt_bg};
            border: none;
        }}
        QMenu {{
            background: {colors.menu_bg};
            border: 1px solid {colors.border};
            border-radius: 12px;
            padding: 6px;
        }}
        QMenu::item {{
            padding: 8px 10px;
            border-radius: 8px;
        }}
        QMenu::item:selected {{
            background: {colors.menu_selected_bg};
        }}
        QStatusBar {{
            color: {colors.text_muted};
            border-top: 1px solid {colors.border};
        }}
        QTabBar::tab {{
            background: {colors.panel_alt_bg};
            color: {colors.text_muted};
            border: 1px solid {colors.border};
            padding: 8px 14px;
            margin-right: 6px;
            border-radius: 10px;
        }}
        QTabBar::tab:selected {{
            background: {colors.surface_bg};
            color: {colors.text};
            border-color: {colors.border_strong};
        }}
        QTabBar#workspace-file-tabs::tab {{
            background: {colors.file_tab_bg};
            border-color: {colors.border};
            min-width: 110px;
            max-width: 260px;
            padding: 9px 14px;
        }}
        QTabBar#workspace-file-tabs::tab:selected {{
            background: {colors.surface_bg};
            border-color: {colors.border_strong};
        }}
        QTabBar#workspace-file-tabs::close-button {{
            subcontrol-position: right;
            margin-left: 8px;
        }}
        QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QListWidget, QTreeWidget, QTableWidget, QComboBox {{
            background: {colors.input_bg};
            border: 1px solid {colors.border};
            border-radius: 10px;
            padding: 8px 10px;
            selection-background-color: {colors.selection_bg};
            selection-color: {colors.selection_text};
        }}
        QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox, QPushButton, QToolButton {{
            min-height: 18px;
        }}
        QListWidget::item, QTreeWidget::item, QTableWidget::item {{
            padding: 10px 8px;
            border-radius: 8px;
        }}
        QListWidget::item:hover, QTreeWidget::item:hover, QTableWidget::item:hover {{
            background: {colors.panel_alt_bg};
        }}
        QListWidget::item:selected, QTreeWidget::item:selected, QTableWidget::item:selected {{
            background: {colors.selection_bg};
            color: {colors.selection_text};
        }}
        QPushButton, QToolButton {{
            background: {colors.accent_bg};
            border: 1px solid {colors.accent_border};
            border-radius: 10px;
            padding: 8px 14px;
            color: {colors.accent_text};
            font-weight: 600;
        }}
        QPushButton:hover, QToolButton:hover {{
            background: {colors.accent_hover_bg};
        }}
        QPushButton:pressed, QToolButton:pressed {{
            background: {colors.accent_pressed_bg};
        }}
        QPushButton:disabled, QToolButton:disabled {{
            background: {colors.disabled_bg};
            border-color: {colors.disabled_border};
            color: {colors.disabled_text};
        }}
        QPushButton[secondary="true"], QToolButton[secondary="true"] {{
            background: {colors.secondary_bg};
            border-color: {colors.secondary_border};
            color: {colors.secondary_text};
        }}
        QPushButton[secondary="true"]:hover, QToolButton[secondary="true"]:hover {{
            background: {colors.secondary_hover_bg};
        }}
        QToolButton::menu-indicator {{
            subcontrol-position: right center;
            width: 12px;
        }}
        QLabel[muted="true"] {{
            color: {colors.text_muted};
        }}
        QLabel[title="true"] {{
            font-size: 18px;
            font-weight: 700;
            color: {colors.text_title};
        }}
        QLabel[settingsEyebrow="true"] {{
            color: {colors.text_muted};
            font-size: 11px;
            font-weight: 700;
        }}
        QLabel[settingsSectionTitle="true"] {{
            color: {colors.text_title};
            font-size: 17px;
            font-weight: 700;
        }}
        QLabel[settingsValue="true"] {{
            color: {colors.text_title};
            font-size: 22px;
            font-weight: 700;
        }}
        QLabel[settingsCaption="true"] {{
            color: {colors.text_muted};
            font-size: 12px;
        }}
        QLabel[settingsFieldLabel="true"] {{
            color: {colors.text_muted};
            font-size: 12px;
            font-weight: 700;
        }}
        QLabel[settingsListItem="true"] {{
            color: {colors.text};
            font-size: 13px;
            padding: 2px 0;
        }}
        QCheckBox {{
            spacing: 8px;
        }}
        QCheckBox::indicator {{
            width: 16px;
            height: 16px;
            border-radius: 4px;
            border: 1px solid {colors.checkbox_border};
            background: {colors.checkbox_bg};
        }}
        QCheckBox::indicator:checked {{
            background: {colors.checkbox_checked_bg};
            border-color: {colors.checkbox_checked_border};
            image: url("{checkbox_icon}");
        }}
        QGroupBox {{
            border: 1px solid {colors.border};
            border-radius: 14px;
            margin-top: 12px;
            padding-top: 16px;
            background: {colors.group_bg};
            font-weight: 600;
        }}
        QGroupBox::title {{
            subcontrol-origin: margin;
            left: 12px;
            padding: 0 6px;
            color: {colors.text_muted};
        }}
        QFrame[settingsHero="true"] {{
            background: {colors.panel_alt_bg};
            border: 1px solid {colors.border_strong};
            border-radius: 18px;
        }}
        QFrame[settingsCard="true"] {{
            background: {colors.group_bg};
            border: 1px solid {colors.border};
            border-radius: 18px;
        }}
        QFrame[settingsStat="true"] {{
            background: {colors.surface_bg};
            border: 1px solid {colors.border};
            border-radius: 14px;
        }}
        QFrame[settingsSubcard="true"] {{
            background: {colors.panel_bg};
            border: 1px solid {colors.border};
            border-radius: 14px;
        }}
        QProgressBar {{
            background: {colors.progress_bg};
            border: 1px solid {colors.border};
            border-radius: 8px;
            min-height: 10px;
        }}
        QProgressBar::chunk {{
            background: {colors.progress_chunk};
            border-radius: 7px;
        }}
        QHeaderView::section {{
            background: {colors.header_bg};
            color: {colors.text_muted};
            border: none;
            border-bottom: 1px solid {colors.border};
            padding: 8px;
            font-weight: 600;
        }}
        QTableCornerButton::section {{
            background: {colors.header_bg};
            border: none;
            border-bottom: 1px solid {colors.border};
        }}
        QComboBox::drop-down {{
            border: none;
            width: 24px;
        }}
        QComboBox QAbstractItemView {{
            background: {colors.menu_bg};
            border: 1px solid {colors.border};
            selection-background-color: {colors.selection_bg};
            selection-color: {colors.selection_text};
            padding: 4px;
        }}
        QSplitter::handle {{
            background: {colors.splitter_handle};
        }}
        QSplitter::handle:hover {{
            background: {colors.splitter_handle_hover};
        }}
        QScrollBar:vertical {{
            background: transparent;
            width: 12px;
            margin: 2px;
        }}
        QScrollBar::handle:vertical {{
            background: {colors.scrollbar_handle};
            border-radius: 6px;
            min-height: 32px;
        }}
        QScrollBar:horizontal {{
            background: transparent;
            height: 12px;
            margin: 2px;
        }}
        QScrollBar::handle:horizontal {{
            background: {colors.scrollbar_handle};
            border-radius: 6px;
            min-width: 32px;
        }}
    """


def _load_fonts(runtime_paths: RuntimePaths) -> str:
    loaded_families: list[str] = []
    for font_dir in runtime_paths.font_search_dirs():
        for font_name in (
            "ibm_plex_sans_regular.ttf",
            "ibm_plex_sans_medium.ttf",
            "ibm_plex_sans_semibold.ttf",
        ):
            font_path = font_dir / font_name
            if font_path.exists():
                font_id = QFontDatabase.addApplicationFont(str(font_path))
                if font_id >= 0:
                    loaded_families.extend(
                        QFontDatabase.applicationFontFamilies(font_id)
                    )
        if loaded_families:
            break
    return loaded_families[0] if loaded_families else "Helvetica Neue"
