from __future__ import annotations

from PySide6.QtGui import QFont, QFontDatabase
from PySide6.QtWidgets import QApplication

from ..runtime_paths import RuntimePaths


def apply_theme(app: QApplication, runtime_paths: RuntimePaths) -> None:
    font_family = _load_fonts(runtime_paths)
    checkbox_icon = runtime_paths.package_asset("checkbox-check.svg").as_posix()
    app.setStyleSheet(
        f"""
        QWidget {{
            background: #11161d;
            color: #eef2f6;
            font-family: "{font_family}";
            font-size: 13px;
        }}
        QMainWindow, QFrame, QSplitter, QListWidget, QTreeWidget, QTableWidget, QStackedWidget {{
            background: #11161d;
        }}
        QFrame#file-tab-strip {{
            background: #131922;
            border-top: 1px solid #1e2834;
            border-bottom: 1px solid #1e2834;
        }}
        QMenuBar, QToolBar, QStatusBar {{
            background: #151c24;
            border: none;
        }}
        QMenu {{
            background: #17202a;
            border: 1px solid #2b3645;
            border-radius: 12px;
            padding: 6px;
        }}
        QMenu::item {{
            padding: 8px 10px;
            border-radius: 8px;
        }}
        QMenu::item:selected {{
            background: #243447;
        }}
        QStatusBar {{
            color: #94a3b8;
            border-top: 1px solid #263140;
        }}
        QTabBar::tab {{
            background: #18202a;
            color: #8fa0b3;
            border: 1px solid #273344;
            padding: 8px 14px;
            margin-right: 6px;
            border-radius: 10px;
        }}
        QTabBar::tab:selected {{
            background: #223246;
            color: #f8fbff;
            border-color: #3d5670;
        }}
        QTabBar#workspace-file-tabs::tab {{
            background: #161f29;
            border-color: #2b3949;
            min-width: 110px;
            max-width: 260px;
            padding: 9px 14px;
        }}
        QTabBar#workspace-file-tabs::tab:selected {{
            background: #243447;
            border-color: #4f6f92;
        }}
        QTabBar#workspace-file-tabs::close-button {{
            subcontrol-position: right;
            margin-left: 8px;
        }}
        QLineEdit, QTextEdit, QPlainTextEdit, QSpinBox, QDoubleSpinBox, QListWidget, QTreeWidget, QTableWidget, QComboBox {{
            background: #17202a;
            border: 1px solid #2b3645;
            border-radius: 10px;
            padding: 8px 10px;
            selection-background-color: #355172;
        }}
        QLineEdit, QComboBox, QSpinBox, QDoubleSpinBox, QPushButton, QToolButton {{
            min-height: 18px;
        }}
        QListWidget::item, QTreeWidget::item, QTableWidget::item {{
            padding: 10px 8px;
            border-radius: 8px;
        }}
        QListWidget::item:hover, QTreeWidget::item:hover, QTableWidget::item:hover {{
            background: #1d2a38;
        }}
        QListWidget::item:selected, QTreeWidget::item:selected, QTableWidget::item:selected {{
            background: #24364b;
            color: #ffffff;
        }}
        QPushButton, QToolButton {{
            background: #20374f;
            border: 1px solid #33506c;
            border-radius: 10px;
            padding: 8px 14px;
            color: #f4f7fb;
            font-weight: 600;
        }}
        QPushButton:hover, QToolButton:hover {{
            background: #27405c;
        }}
        QPushButton:pressed, QToolButton:pressed {{
            background: #1d3147;
        }}
        QPushButton:disabled, QToolButton:disabled {{
            background: #151d26;
            border-color: #242e3a;
            color: #6f8093;
        }}
        QPushButton[secondary="true"], QToolButton[secondary="true"] {{
            background: #18212b;
            border-color: #2d3948;
            color: #d1d9e2;
        }}
        QPushButton[secondary="true"]:hover, QToolButton[secondary="true"]:hover {{
            background: #1d2a38;
        }}
        QToolButton::menu-indicator {{
            subcontrol-position: right center;
            width: 12px;
        }}
        QLabel[muted="true"] {{
            color: #93a1b1;
        }}
        QLabel[title="true"] {{
            font-size: 18px;
            font-weight: 700;
            color: #f6fbff;
        }}
        QCheckBox {{
            spacing: 8px;
        }}
        QCheckBox::indicator {{
            width: 16px;
            height: 16px;
            border-radius: 4px;
            border: 1px solid #35506a;
            background: #14202c;
        }}
        QCheckBox::indicator:checked {{
            background: #315379;
            border-color: #4d7aad;
            image: url("{checkbox_icon}");
        }}
        QGroupBox {{
            border: 1px solid #283547;
            border-radius: 14px;
            margin-top: 12px;
            padding-top: 16px;
            background: #141b23;
            font-weight: 600;
        }}
        QGroupBox::title {{
            subcontrol-origin: margin;
            left: 12px;
            padding: 0 6px;
            color: #9fb1c4;
        }}
        QProgressBar {{
            background: #16202b;
            border: 1px solid #2b3645;
            border-radius: 8px;
            min-height: 10px;
        }}
        QProgressBar::chunk {{
            background: #4c85cf;
            border-radius: 7px;
        }}
        QHeaderView::section {{
            background: #18202a;
            color: #9fb1c4;
            border: none;
            border-bottom: 1px solid #2d3948;
            padding: 8px;
            font-weight: 600;
        }}
        QTableCornerButton::section {{
            background: #18202a;
            border: none;
            border-bottom: 1px solid #2d3948;
        }}
        QComboBox::drop-down {{
            border: none;
            width: 24px;
        }}
        QComboBox QAbstractItemView {{
            background: #17202a;
            border: 1px solid #2b3645;
            selection-background-color: #24364b;
            padding: 4px;
        }}
        QSplitter::handle {{
            background: #131923;
        }}
        QSplitter::handle:hover {{
            background: #223246;
        }}
        QScrollBar:vertical {{
            background: transparent;
            width: 12px;
            margin: 2px;
        }}
        QScrollBar::handle:vertical {{
            background: #2b3a4d;
            border-radius: 6px;
            min-height: 32px;
        }}
        QScrollBar:horizontal {{
            background: transparent;
            height: 12px;
            margin: 2px;
        }}
        QScrollBar::handle:horizontal {{
            background: #2b3a4d;
            border-radius: 6px;
            min-width: 32px;
        }}
        """
    )
    app.setFont(QFont(font_family, 10))


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
