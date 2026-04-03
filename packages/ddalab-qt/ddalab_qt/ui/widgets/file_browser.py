from __future__ import annotations

from typing import List, Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QHeaderView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from ...domain.models import BrowserEntry


class FileBrowserWidget(QWidget):
    refresh_requested = Signal()
    parent_requested = Signal()
    root_requested = Signal()
    open_file_requested = Signal()
    open_folder_requested = Signal()
    navigate_requested = Signal(str)
    entry_activated = Signal(object)
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
        tree.setRootIsDecorated(False)
        tree.setAlternatingRowColors(False)
        tree.setUniformRowHeights(True)
        tree.setAllColumnsShowFocus(True)
        tree.setColumnCount(3)
        tree.setHeaderLabels(["Name", "Type", "Size"])
        tree.header().setStretchLastSection(False)
        tree.header().setSectionResizeMode(0, QHeaderView.Stretch)
        tree.header().setSectionResizeMode(1, QHeaderView.Interactive)
        tree.header().setSectionResizeMode(2, QHeaderView.Interactive)
        tree.setColumnWidth(1, 164)
        tree.setColumnWidth(2, 96)
        tree.itemDoubleClicked.connect(self._on_item_double_clicked)
        tree.itemActivated.connect(self._on_item_double_clicked)
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
            if entry.type_label:
                type_label = entry.type_label
            elif entry.is_directory:
                type_label = "Folder"
            elif entry.supported:
                type_label = "Dataset"
            else:
                type_label = "File"
            item = QTreeWidgetItem(
                [
                    entry.name,
                    type_label,
                    _human_size(entry.size_bytes) if not entry.is_directory else "",
                ]
            )
            item.setData(0, Qt.UserRole, entry)
            item.setToolTip(1, type_label)
            if entry.is_directory and not entry.open_as_dataset:
                item.setForeground(0, Qt.white)
            elif entry.supported or entry.open_as_dataset:
                item.setForeground(0, Qt.cyan)
            self.tree.addTopLevelItem(item)

    def _on_item_double_clicked(self, item: QTreeWidgetItem) -> None:
        entry = item.data(0, Qt.UserRole)
        if entry is not None:
            self.entry_activated.emit(entry)


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
