from __future__ import annotations

from pathlib import Path
from typing import Optional

from PySide6.QtWidgets import (
    QApplication,
    QDialog,
    QFileDialog,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)


class TextExportDialog(QDialog):
    def __init__(
        self,
        *,
        parent: Optional[QWidget],
        title: str,
        heading: str,
        content: str,
        default_path: Path,
        file_filter: str,
    ) -> None:
        super().__init__(parent)
        self._content = content
        self._default_path = default_path
        self._file_filter = file_filter
        self.saved_path: Optional[Path] = None

        self.setWindowTitle(title)
        self.resize(860, 640)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(12)

        heading_label = QLabel(heading)
        heading_label.setProperty("title", True)
        layout.addWidget(heading_label)

        helper_label = QLabel(
            "Review the generated file below. Copy it directly or save it to disk."
        )
        helper_label.setProperty("muted", True)
        helper_label.setWordWrap(True)
        layout.addWidget(helper_label)

        self.editor = QPlainTextEdit()
        self.editor.setReadOnly(True)
        self.editor.setPlainText(content)
        layout.addWidget(self.editor, 1)

        self.status_label = QLabel("")
        self.status_label.setProperty("muted", True)
        layout.addWidget(self.status_label)

        actions = QHBoxLayout()
        actions.addStretch(1)

        copy_button = QPushButton("Copy to Clipboard")
        copy_button.setProperty("secondary", True)
        copy_button.clicked.connect(self._copy_to_clipboard)
        actions.addWidget(copy_button)

        save_button = QPushButton("Save As…")
        save_button.clicked.connect(self._save_to_disk)
        actions.addWidget(save_button)

        close_button = QPushButton("Close")
        close_button.setProperty("secondary", True)
        close_button.clicked.connect(self.reject)
        actions.addWidget(close_button)

        layout.addLayout(actions)

    def _copy_to_clipboard(self) -> None:
        clipboard = QApplication.clipboard()
        clipboard.setText(self._content)
        self.status_label.setText("Copied to clipboard.")

    def _save_to_disk(self) -> None:
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            self.windowTitle(),
            str(self._default_path),
            self._file_filter,
        )
        if not target_path:
            return
        path = Path(target_path)
        path.write_text(self._content, encoding="utf-8")
        self.saved_path = path
        self.accept()
