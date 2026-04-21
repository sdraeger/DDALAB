from __future__ import annotations

from dataclasses import dataclass
import sys
from typing import List, Optional

from PySide6.QtCore import QPointF, QRectF, QSize, Qt, Signal
from PySide6.QtGui import QColor, QFontMetrics, QPainter, QPen, QPolygonF
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QHeaderView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMenu,
    QPushButton,
    QStyledItemDelegate,
    QStyle,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ...domain.models import BrowserEntry
from ..style import ThemeColors, current_theme_colors


@dataclass(frozen=True)
class _EntryAppearance:
    accent: QColor
    name_color: QColor
    detail_color: QColor
    marker_shape: str
    emphasized: bool


class _FileBrowserItemDelegate(QStyledItemDelegate):
    def paint(self, painter: QPainter, option, index) -> None:  # type: ignore[override]
        entry = index.data(Qt.UserRole)
        if not isinstance(entry, BrowserEntry):
            entry = index.siblingAtColumn(0).data(Qt.UserRole)
        if not isinstance(entry, BrowserEntry):
            super().paint(painter, option, index)
            return

        colors = current_theme_colors(option.widget)
        appearance = _entry_appearance(entry, colors)
        selected = bool(option.state & QStyle.StateFlag.State_Selected)
        hovered = bool(option.state & QStyle.StateFlag.State_MouseOver)

        painter.save()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        self._paint_background(painter, option.rect, colors, selected, hovered)
        if index.column() == 0:
            self._paint_name_column(painter, option.rect, colors, appearance, entry, selected)
        elif index.column() == 1:
            self._paint_type_column(painter, option.rect, colors, appearance, entry, selected)
        else:
            self._paint_size_column(painter, option.rect, colors, entry, selected)
        painter.restore()

    def sizeHint(self, option, index) -> QSize:  # type: ignore[override]
        base = super().sizeHint(option, index)
        return QSize(base.width(), max(base.height(), 34))

    def _paint_background(
        self,
        painter: QPainter,
        rect,
        colors: ThemeColors,
        selected: bool,
        hovered: bool,
    ) -> None:
        cell_rect = QRectF(rect.adjusted(3, 2, -3, -2))
        if selected:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(colors.selection_bg))
            painter.drawRoundedRect(cell_rect, 9, 9)
            return
        if hovered:
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QColor(colors.panel_alt_bg))
            painter.drawRoundedRect(cell_rect, 9, 9)

    def _paint_name_column(
        self,
        painter: QPainter,
        rect,
        colors: ThemeColors,
        appearance: _EntryAppearance,
        entry: BrowserEntry,
        selected: bool,
    ) -> None:
        marker_rect = QRectF(rect.left() + 10, rect.center().y() - 5, 10, 10)
        self._paint_marker(painter, marker_rect, colors, appearance, selected)

        text_rect = QRectF(rect.left() + 28, rect.top(), rect.width() - 36, rect.height())
        font = painter.font()
        font.setWeight(font.Weight.Normal)
        painter.setFont(font)
        metrics = QFontMetrics(font)
        name = metrics.elidedText(entry.name, Qt.TextElideMode.ElideMiddle, int(text_rect.width()))
        painter.setPen(QColor(colors.selection_text) if selected else appearance.name_color)
        painter.drawText(text_rect, Qt.AlignmentFlag.AlignVCenter | Qt.AlignmentFlag.AlignLeft, name)

    def _paint_marker(
        self,
        painter: QPainter,
        rect: QRectF,
        colors: ThemeColors,
        appearance: _EntryAppearance,
        selected: bool,
    ) -> None:
        fill = QColor(colors.selection_text) if selected else QColor(appearance.accent)
        fill.setAlpha(235 if selected else 210)
        border = QColor(colors.selection_text) if selected else QColor(appearance.accent)
        border.setAlpha(255 if selected else 240)
        painter.setPen(QPen(border, 1.1))
        painter.setBrush(fill)
        if appearance.marker_shape == "circle":
            painter.drawEllipse(rect)
            return
        if appearance.marker_shape == "diamond":
            half = rect.width() / 2
            painter.drawPolygon(
                QPolygonF(
                    [
                        rect.center() + QPointF(0, -half),
                        rect.center() + QPointF(half, 0),
                        rect.center() + QPointF(0, half),
                        rect.center() + QPointF(-half, 0),
                    ]
                )
            )
            return
        painter.drawRoundedRect(rect, 3, 3)

    def _paint_type_column(
        self,
        painter: QPainter,
        rect,
        colors: ThemeColors,
        appearance: _EntryAppearance,
        entry: BrowserEntry,
        selected: bool,
    ) -> None:
        tokens = _type_badges(entry)
        badge_area = QRectF(rect.adjusted(2, 5, -6, -5))
        x = badge_area.left()
        available_width = badge_area.width()
        badge_height = 22.0
        font = painter.font()
        font.setBold(False)
        painter.setFont(font)
        metrics = QFontMetrics(font)

        for badge_index, token in enumerate(tokens):
            remaining = badge_area.right() - x
            if remaining < 48:
                break
            text = metrics.elidedText(token, Qt.TextElideMode.ElideRight, int(remaining - 20))
            width = min(metrics.horizontalAdvance(text) + 18, int(remaining))
            badge_rect = QRectF(x, badge_area.center().y() - (badge_height / 2), width, badge_height)
            primary = badge_index == 0
            self._paint_badge(
                painter,
                badge_rect,
                text,
                colors,
                appearance,
                selected,
                primary,
            )
            x += width + 6
            available_width -= width + 6
            if available_width <= 0:
                break

    def _paint_badge(
        self,
        painter: QPainter,
        rect: QRectF,
        text: str,
        colors: ThemeColors,
        appearance: _EntryAppearance,
        selected: bool,
        primary: bool,
    ) -> None:
        badge_fill = QColor(colors.selection_text) if selected else QColor(appearance.accent)
        badge_fill.setAlpha(44 if primary and not selected else 24 if not selected else 26)
        badge_border = QColor(colors.selection_text) if selected else QColor(appearance.accent)
        badge_border.setAlpha(120 if primary and not selected else 68 if not selected else 120)
        badge_text = QColor(colors.selection_text) if selected else QColor(appearance.accent)
        if not primary and not selected:
            badge_text = QColor(appearance.detail_color)
        painter.setPen(QPen(badge_border, 1.0))
        painter.setBrush(badge_fill)
        painter.drawRoundedRect(rect, 11, 11)
        painter.setPen(badge_text)
        painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, text)

    def _paint_size_column(
        self,
        painter: QPainter,
        rect,
        colors: ThemeColors,
        entry: BrowserEntry,
        selected: bool,
    ) -> None:
        text = _human_size(entry.size_bytes) if not entry.is_directory else ""
        painter.setPen(QColor(colors.selection_text) if selected else QColor(colors.text_muted))
        painter.drawText(
            QRectF(rect.adjusted(4, 0, -8, 0)),
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
            text,
        )


class FileBrowserWidget(QWidget):
    refresh_requested = Signal()
    parent_requested = Signal()
    root_requested = Signal()
    open_file_requested = Signal()
    open_folder_requested = Signal()
    navigate_requested = Signal(str)
    entry_activated = Signal(object)
    context_action_requested = Signal(str, object)
    search_changed = Signal(str)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._entries: List[BrowserEntry] = []
        self._current_path = ""

        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(12, 12, 12, 12)
        root_layout.setSpacing(10)

        title = QLabel("Library")
        title.setProperty("title", True)
        root_layout.addWidget(title)

        self.path_label = QLabel("")
        self.path_label.setProperty("muted", True)
        self.path_label.setWordWrap(True)
        root_layout.addWidget(self.path_label)

        search = QLineEdit()
        search.setPlaceholderText("Search this directory")
        search.textChanged.connect(self.search_changed.emit)
        root_layout.addWidget(search)
        self.search_edit = search

        actions = QHBoxLayout()
        actions.setSpacing(8)
        for label, signal in (
            ("Refresh", self.refresh_requested),
            ("Up", self.parent_requested),
            ("Root", self.root_requested),
            ("Open Folder", self.open_folder_requested),
            ("Open File", self.open_file_requested),
        ):
            button = QPushButton(label)
            if label != "Open File":
                button.setProperty("secondary", True)
            button.clicked.connect(signal.emit)
            actions.addWidget(button)
        root_layout.addLayout(actions)

        tree = QTreeWidget()
        tree.setObjectName("library-browser")
        tree.setRootIsDecorated(False)
        tree.setAlternatingRowColors(False)
        tree.setUniformRowHeights(True)
        tree.setAllColumnsShowFocus(True)
        tree.setMouseTracking(True)
        tree.setIndentation(0)
        tree.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        tree.setColumnCount(3)
        tree.setHeaderLabels(["Name", "Type", "Size"])
        tree.header().setStretchLastSection(False)
        tree.header().setSectionResizeMode(0, QHeaderView.Stretch)
        tree.header().setSectionResizeMode(1, QHeaderView.Interactive)
        tree.header().setSectionResizeMode(2, QHeaderView.Interactive)
        tree.setColumnWidth(1, 208)
        tree.setColumnWidth(2, 96)
        tree.setItemDelegate(_FileBrowserItemDelegate(tree))
        tree.setContextMenuPolicy(Qt.CustomContextMenu)
        tree.itemDoubleClicked.connect(self._on_item_double_clicked)
        tree.itemActivated.connect(self._on_item_double_clicked)
        tree.customContextMenuRequested.connect(self._show_context_menu)
        root_layout.addWidget(tree, 1)
        self.tree = tree

    def set_path(self, path: str) -> None:
        self._current_path = path
        self.path_label.setText(path)

    def set_entries(self, entries: List[BrowserEntry]) -> None:
        self._entries = entries
        self._rebuild_tree()

    def apply_search_filter(self, text: str) -> None:
        needle = text.strip().lower()
        for index in range(self.tree.topLevelItemCount()):
            item = self.tree.topLevelItem(index)
            entry: BrowserEntry = item.data(0, Qt.UserRole)
            hidden = bool(needle) and needle not in entry.name.lower()
            item.setHidden(hidden)

    def _rebuild_tree(self) -> None:
        self.tree.clear()
        entries = sorted(
            self._entries,
            key=lambda entry: (not entry.is_directory, entry.name.lower()),
        )
        for entry in entries:
            type_label = _entry_type_label(entry)
            item = QTreeWidgetItem(
                [
                    entry.name,
                    type_label,
                    _human_size(entry.size_bytes) if not entry.is_directory else "",
                ]
            )
            item.setData(0, Qt.UserRole, entry)
            tooltip = _entry_tooltip(entry, type_label)
            item.setToolTip(0, tooltip)
            item.setToolTip(1, tooltip)
            item.setToolTip(2, tooltip)
            self.tree.addTopLevelItem(item)

    def _on_item_double_clicked(self, item: QTreeWidgetItem) -> None:
        entry = item.data(0, Qt.UserRole)
        if entry is not None:
            self.entry_activated.emit(entry)

    def _show_context_menu(self, position) -> None:
        item = self.tree.itemAt(position)
        if item is None:
            return
        entry = item.data(0, Qt.UserRole)
        if not isinstance(entry, BrowserEntry):
            return

        menu = QMenu(self)
        open_label = _context_open_label(entry)
        browse_label = _context_browse_label(entry)
        reveal_label = _system_reveal_label()

        if open_label:
            menu.addAction(
                open_label,
                lambda checked=False, target=entry: self.context_action_requested.emit(
                    "open", target
                ),
            )
        if browse_label:
            menu.addAction(
                browse_label,
                lambda checked=False, target=entry: self.context_action_requested.emit(
                    "browse", target
                ),
            )
        if not entry.is_directory:
            menu.addAction(
                "Browse Containing Folder",
                lambda checked=False, target=entry: self.context_action_requested.emit(
                    "browse_parent", target
                ),
            )
        if menu.actions():
            menu.addSeparator()
        menu.addAction(
            reveal_label,
            lambda checked=False, target=entry: self.context_action_requested.emit(
                "reveal", target
            ),
        )
        menu.addAction(
            "Copy Path",
            lambda checked=False, target=entry: self.context_action_requested.emit(
                "copy_path", target
            ),
        )
        menu.addAction(
            "Copy Name",
            lambda checked=False, target=entry: self.context_action_requested.emit(
                "copy_name", target
            ),
        )
        copy_full_label = menu.addAction("Copy Full Item Details")
        chosen = menu.exec(self.tree.viewport().mapToGlobal(position))
        if chosen is copy_full_label:
            QApplication.clipboard().setText(_entry_tooltip(entry, _entry_type_label(entry)))


def _human_size(size_bytes: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(max(size_bytes, 0))
    for unit in units:
        if value < 1024.0 or unit == units[-1]:
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024.0
    return f"{size_bytes} B"


def _entry_type_label(entry: BrowserEntry) -> str:
    if entry.type_label:
        return entry.type_label
    if entry.is_directory:
        return "Folder"
    if entry.supported:
        return "Dataset"
    return "File"


def _entry_tooltip(entry: BrowserEntry, type_label: str) -> str:
    lines = [entry.path, f"Type: {type_label}"]
    if type_label == "BIDS Dataset":
        lines.append("Open datasets from the subject, session, or modality folders inside this root.")
    elif "BrainVision Companion" in type_label:
        lines.append("Opening this file resolves through its matching BrainVision .vhdr header.")
    elif entry.open_as_dataset:
        lines.append("Open this folder as a dataset.")
    elif entry.supported:
        lines.append("Openable in DDALAB.")
    return "\n".join(lines)


def _type_badges(entry: BrowserEntry) -> List[str]:
    label = _entry_type_label(entry)
    if " · " in label:
        left, right = label.split(" · ", 1)
        return [left, right]
    if label.startswith("BIDS ") and label.endswith(" Folder"):
        return [label[:-7], "Folder"]
    if label.startswith("BIDS "):
        parts = label.split(" ", 1)
        if len(parts) == 2:
            return [parts[0], parts[1]]
    return [label]


def _entry_appearance(entry: BrowserEntry, colors: ThemeColors) -> _EntryAppearance:
    label = _entry_type_label(entry)
    if label == "BIDS Dataset":
        return _EntryAppearance(
            accent=_mode_color(colors, "#46d4c2", "#0f766e"),
            name_color=QColor(colors.text_title),
            detail_color=_mode_color(colors, "#7ae6d7", "#0f766e"),
            marker_shape="rounded",
            emphasized=True,
        )
    if label in {"BIDS Subject", "BIDS Session"}:
        return _EntryAppearance(
            accent=_mode_color(colors, "#84b8ff", "#2563eb"),
            name_color=QColor(colors.text),
            detail_color=_mode_color(colors, "#84b8ff", "#2563eb"),
            marker_shape="rounded",
            emphasized=True,
        )
    if label.startswith("BIDS ") and label.endswith(" Folder"):
        return _EntryAppearance(
            accent=_mode_color(colors, "#f3c76d", "#b45309"),
            name_color=QColor(colors.text),
            detail_color=_mode_color(colors, "#f3c76d", "#b45309"),
            marker_shape="rounded",
            emphasized=True,
        )
    if "BrainVision Companion" in label:
        return _EntryAppearance(
            accent=_mode_color(colors, "#f4a261", "#c26c1a"),
            name_color=QColor(colors.text),
            detail_color=_mode_color(colors, "#f4a261", "#c26c1a"),
            marker_shape="diamond",
            emphasized=True,
        )
    if label.startswith("BIDS "):
        return _EntryAppearance(
            accent=_mode_color(colors, "#53c4d6", "#0f766e"),
            name_color=QColor(colors.text_title),
            detail_color=_mode_color(colors, "#53c4d6", "#0f766e"),
            marker_shape="circle",
            emphasized=True,
        )
    if entry.open_as_dataset:
        return _EntryAppearance(
            accent=QColor(colors.accent_bg),
            name_color=QColor(colors.text_title),
            detail_color=QColor(colors.accent_bg),
            marker_shape="rounded",
            emphasized=True,
        )
    if entry.is_directory:
        return _EntryAppearance(
            accent=QColor(colors.border_strong),
            name_color=QColor(colors.text),
            detail_color=QColor(colors.text_muted),
            marker_shape="rounded",
            emphasized=False,
        )
    if entry.supported:
        return _EntryAppearance(
            accent=QColor(colors.accent_bg),
            name_color=QColor(colors.text_title),
            detail_color=QColor(colors.accent_bg),
            marker_shape="circle",
            emphasized=True,
        )
    return _EntryAppearance(
        accent=QColor(colors.text_muted),
        name_color=QColor(colors.text),
        detail_color=QColor(colors.text_muted),
        marker_shape="circle",
        emphasized=False,
    )


def _mode_color(colors: ThemeColors, dark_hex: str, light_hex: str) -> QColor:
    return QColor(light_hex if colors.mode == "light" else dark_hex)


def _context_open_label(entry: BrowserEntry) -> Optional[str]:
    if entry.open_as_dataset:
        return "Open Dataset"
    if entry.supported:
        return "Open in DDALAB"
    return None


def _context_browse_label(entry: BrowserEntry) -> Optional[str]:
    if not entry.is_directory:
        return None
    if entry.open_as_dataset:
        return "Browse Folder"
    return "Open Folder"


def _system_reveal_label() -> str:
    if sys.platform == "darwin":
        return "Reveal in Finder"
    if sys.platform.startswith("win"):
        return "Show in Explorer"
    return "Show in Folder"
