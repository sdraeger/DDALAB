from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Callable, List, Optional

from PySide6.QtCore import (
    QSignalBlocker,
    Qt,
    QTimer,
    QPoint,
)
from PySide6.QtGui import QColor
from PySide6.QtGui import QIcon, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QMenu,
)

from ...domain.file_types import classify_path, open_file_dialog_filter
from ...domain.models import (
    BrowserEntry,
)
from ...persistence.state_db import StateDatabase
from ...ui.style import current_theme_colors
from ..runtime.runtime_logging import runtime_logger

from .main_window_support_helpers import (
    WorkerSignals,
    _system_reveal_label,
)


class MainWindowSupportBrowserMixin:
    def _file_tab_index_for_path(self, path: str) -> int:
        for index in range(self.file_tabs.count()):
            if self.file_tabs.tabData(index) == path:
                return index
        return -1

    def _is_pinned_file(self, path: Optional[str]) -> bool:
        return bool(path) and path in self.state.pinned_file_paths

    def _normalize_pinned_file_paths(self) -> None:
        normalized: List[str] = []
        seen: set[str] = set()
        open_paths = {path for path in self.state.open_files if path}
        for path in self.state.pinned_file_paths:
            if (
                not isinstance(path, str)
                or not path
                or path in seen
                or path not in open_paths
            ):
                continue
            normalized.append(path)
            seen.add(path)
        self.state.pinned_file_paths = normalized

    def _ordered_open_files(self) -> List[str]:
        self._normalize_pinned_file_paths()
        pinned_set = set(self.state.pinned_file_paths)
        pinned = [path for path in self.state.open_files if path in pinned_set]
        unpinned = [path for path in self.state.open_files if path not in pinned_set]
        return pinned + unpinned

    def _rebuild_file_tabs(self, *, current_path: Optional[str] = None) -> None:
        ordered_paths = self._ordered_open_files()
        self.state.open_files = ordered_paths
        selected_path = (
            current_path
            if isinstance(current_path, str) and current_path in ordered_paths
            else self.state.active_file_path
            if isinstance(self.state.active_file_path, str)
            and self.state.active_file_path in ordered_paths
            else ordered_paths[0]
            if ordered_paths
            else None
        )
        with QSignalBlocker(self.file_tabs):
            while self.file_tabs.count() > 0:
                self.file_tabs.removeTab(0)
            for path in ordered_paths:
                self.file_tabs.addTab("")
                self.file_tabs.setTabData(self.file_tabs.count() - 1, path)
            if selected_path is not None:
                selected_index = ordered_paths.index(selected_path)
                self.file_tabs.setCurrentIndex(selected_index)
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()

    def _toggle_file_tab_pin(self, path: str) -> None:
        if not path:
            return
        if path in self.state.pinned_file_paths:
            self.state.pinned_file_paths = [
                value for value in self.state.pinned_file_paths if value != path
            ]
        else:
            self.state.pinned_file_paths.append(path)
        self._rebuild_file_tabs(current_path=path)
        self._schedule_session_save()

    def _close_tabs_to_side(self, anchor_index: int, *, direction: str) -> None:
        current_path = self.file_tabs.tabData(anchor_index)
        if not isinstance(current_path, str):
            return
        all_paths = [
            self.file_tabs.tabData(index)
            for index in range(self.file_tabs.count())
            if isinstance(self.file_tabs.tabData(index), str)
        ]
        if direction == "left":
            kept_paths = all_paths[anchor_index:]
        else:
            kept_paths = all_paths[: anchor_index + 1]
        self.state.open_files = kept_paths
        self.state.pinned_file_paths = [
            path for path in self.state.pinned_file_paths if path in kept_paths
        ]
        self._rebuild_file_tabs(current_path=current_path)
        self._schedule_session_save()

    def _tab_title_for_path(self, path: str) -> str:
        target = Path(path)
        basename = target.name or path
        duplicate_count = sum(
            1 for other in self.state.open_files if Path(other).name == basename
        )
        if duplicate_count <= 1:
            return basename
        parent = target.parent.name
        return f"{basename} · {parent}" if parent else basename

    def _refresh_file_tab_labels(self) -> None:
        colors = current_theme_colors(self.file_tabs)
        pinned_color = QColor(colors.accent_bg)
        default_color = QColor(colors.text)
        pinned_icon = self._pinned_tab_icon()
        for index in range(self.file_tabs.count()):
            path = self.file_tabs.tabData(index)
            if not isinstance(path, str):
                continue
            self.file_tabs.setTabText(index, self._tab_title_for_path(path))
            tooltip_lines = [path]
            if self._is_pinned_file(path):
                tooltip_lines.insert(0, "Pinned tab")
                self.file_tabs.setTabTextColor(index, pinned_color)
                self.file_tabs.setTabIcon(index, pinned_icon)
            else:
                self.file_tabs.setTabTextColor(index, default_color)
                self.file_tabs.setTabIcon(index, QIcon())
            self.file_tabs.setTabToolTip(index, "\n".join(tooltip_lines))

    def _pinned_tab_icon(self) -> QIcon:
        colors = current_theme_colors(self.file_tabs)
        icon_color = QColor(colors.accent_bg)
        pixmap = QPixmap(12, 12)
        pixmap.fill(Qt.transparent)
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing, True)
        pen = QPen(icon_color, 1.25)
        pen.setCapStyle(Qt.RoundCap)
        painter.setPen(pen)
        painter.setBrush(icon_color)
        painter.drawEllipse(3.0, 1.0, 5.0, 3.5)
        painter.drawRect(4.5, 4.0, 2.0, 1.8)
        painter.drawLine(5.5, 5.8, 5.5, 10.0)
        painter.drawLine(5.5, 10.0, 4.0, 11.0)
        painter.end()
        return QIcon(pixmap)

    def _sync_file_tab_bar(self) -> None:
        tab_count = self.file_tabs.count()
        has_tabs = tab_count > 0
        self.file_tabs_frame.setVisible(has_tabs)
        self.close_other_tabs_button.setVisible(tab_count > 1)
        if not has_tabs:
            self.file_tabs_summary_label.setText("No files")
            return
        current_path = (
            self.file_tabs.tabData(self.file_tabs.currentIndex())
            if self.file_tabs.currentIndex() >= 0
            else None
        )
        current_label = (
            self._tab_title_for_path(current_path)
            if isinstance(current_path, str)
            else "No selection"
        )
        suffix = "file" if tab_count == 1 else "files"
        pinned_count = len(self.state.pinned_file_paths)
        pinned_label = f" • {pinned_count} pinned" if pinned_count > 0 else ""
        self.file_tabs_summary_label.setText(
            f"{tab_count} {suffix} open{pinned_label} • {current_label}"
        )

    def _append_file_tab(self, path: str) -> None:
        if path in self.state.open_files:
            self._refresh_file_tab_labels()
            self._sync_file_tab_bar()
            return
        self.state.open_files.append(path)
        self._rebuild_file_tabs(current_path=path)

    def _rebuild_open_files_from_tabs(self) -> None:
        self.state.open_files = [
            self.file_tabs.tabData(index)
            for index in range(self.file_tabs.count())
            if isinstance(self.file_tabs.tabData(index), str)
        ]
        self.state.open_files = self._ordered_open_files()
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()

    def _on_file_tab_moved(self, from_index: int, to_index: int) -> None:
        _ = from_index, to_index
        current_path = self.file_tabs.tabData(self.file_tabs.currentIndex())
        self._rebuild_open_files_from_tabs()
        self._rebuild_file_tabs(
            current_path=current_path if isinstance(current_path, str) else None
        )
        self._schedule_session_save()

    def _close_other_tabs(self) -> None:
        current_index = self.file_tabs.currentIndex()
        if current_index < 0:
            return
        current_path = self.file_tabs.tabData(current_index)
        if not isinstance(current_path, str):
            return
        self._close_other_tabs_for_path(current_path)

    def _close_other_tabs_for_path(self, current_path: str) -> None:
        self.state.open_files = [current_path]
        self.state.pinned_file_paths = [
            path for path in self.state.pinned_file_paths if path == current_path
        ]
        self._rebuild_file_tabs(current_path=current_path)
        self._schedule_session_save()

    def _run_task(
        self,
        task: Callable[[], object],
        on_success: Callable[[object], None],
        on_error: Optional[Callable[[str], None]] = None,
    ) -> None:
        signals = WorkerSignals(self)
        signals.success.connect(on_success)
        signals.error.connect(on_error or self._show_error)

        def runner() -> None:
            try:
                result = task()
            except Exception as exc:  # noqa: BLE001
                task_name = getattr(
                    task,
                    "__qualname__",
                    getattr(task, "__name__", task.__class__.__name__),
                )
                runtime_logger("worker").exception(
                    "Background task failed task=%s",
                    task_name,
                )
                signals.error.emit(str(exc))
                return
            signals.success.emit(result)

        self._task_executor.submit(runner)

    def _run_task_with_progress(
        self,
        task: Callable[[Callable[[object], None]], object],
        on_success: Callable[[object], None],
        on_error: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[object], None]] = None,
    ) -> None:
        signals = WorkerSignals(self)
        signals.success.connect(on_success)
        signals.error.connect(on_error or self._show_error)
        if on_progress is not None:
            signals.progress.connect(on_progress)

        def runner() -> None:
            try:
                result = task(signals.progress.emit)
            except Exception as exc:  # noqa: BLE001
                task_name = getattr(
                    task,
                    "__qualname__",
                    getattr(task, "__name__", task.__class__.__name__),
                )
                runtime_logger("worker").exception(
                    "Background task with progress failed task=%s",
                    task_name,
                )
                signals.error.emit(str(exc))
                return
            signals.success.emit(result)

        self._task_executor.submit(runner)

    def _refresh_health(self) -> None:
        self.backend_status_label.setText("Checking backend…")

        def on_success(result: object) -> None:
            health = result
            self.backend_status_label.setText(
                f"{health.service}: {health.status} • DDA {'ready' if health.dda_available else 'offline'}"
            )
            self._notify(
                "system",
                "info",
                "Backend Ready",
                self.backend_status_label.text(),
                show_status=False,
            )

        def on_error(message: str) -> None:
            self.backend_status_label.setText("Backend offline")
            self._notify("system", "error", "Backend Offline", message)

        self._run_task(self.backend.health, on_success, on_error)

    def _bootstrap_browser(self) -> None:
        def on_success(result: object) -> None:
            root_path = str(result)
            browser_path = self._preferred_session_browser_path(root_path)
            self.state.browser_path = browser_path
            self._refresh_browser(browser_path)
            self._restore_session_state()

        def on_error(message: str) -> None:
            browser_path = self._preferred_session_browser_path(str(self.repo_root))
            self.state.browser_path = browser_path
            self.file_browser.set_path(browser_path)
            self.file_browser.set_entries([])
            self._notify("file", "error", "Root Lookup Failed", message)
            self._restore_session_state()

        self._run_task(self.backend.default_root, on_success, on_error)

    def _refresh_browser(self, path: Optional[str] = None) -> None:
        target_path = path or self.state.browser_path
        if not target_path:
            return
        self.status_bar.showMessage(f"Loading directory: {target_path}", 3000)

        def task() -> object:
            return self.backend.list_directory(target_path)

        def on_success(result: object) -> None:
            path_value, entries = result
            self.state.browser_path = path_value
            self.directory_entries = entries
            self.file_browser.set_path(path_value)
            self.file_browser.set_entries(entries)
            self.file_browser.apply_search_filter(self.state.browser_search)
            self._schedule_session_save()

        self._run_task(
            task,
            on_success,
            lambda message: self.status_bar.showMessage(
                f"Directory load failed: {message}", 5000
            ),
        )

    def _on_browser_search_changed(self, text: str) -> None:
        self.state.browser_search = text
        self.file_browser.apply_search_filter(text)
        self._schedule_session_save()

    def _open_parent_directory(self) -> None:
        if not self.state.browser_path:
            return
        current = Path(self.state.browser_path)
        self._refresh_browser(
            str(current.parent if current.parent != current else current)
        )

    def _open_entry(self, entry: object) -> None:
        browser_entry = entry
        if browser_entry.open_as_dataset:
            self._open_dataset(browser_entry.path)
        elif browser_entry.is_directory:
            self._refresh_browser(browser_entry.path)
        elif browser_entry.supported:
            self._open_dataset(browser_entry.path)

    def _handle_file_browser_context_action(self, action: str, entry: object) -> None:
        if not isinstance(entry, BrowserEntry):
            return
        if action == "open":
            self._open_entry(entry)
            return
        if action == "browse":
            target = entry.path if entry.is_directory else str(Path(entry.path).parent)
            self._refresh_browser(target)
            return
        if action == "browse_parent":
            self._refresh_browser(str(Path(entry.path).parent))
            return
        if action == "reveal":
            self._reveal_path_in_system(entry.path)
            return
        if action == "copy_path":
            self._copy_text_to_clipboard(entry.path, "Path copied")
            return
        if action == "copy_name":
            self._copy_text_to_clipboard(entry.name, "Name copied")

    def _copy_text_to_clipboard(self, text: str, status_message: str) -> None:
        clipboard = QApplication.clipboard()
        clipboard.setText(text)
        self.status_bar.showMessage(status_message, 2500)

    def _reveal_path_in_system(self, path: str) -> None:
        target = Path(path)
        if not target.exists():
            self._show_error(f"Path does not exist: {path}")
            return
        try:
            if sys.platform == "darwin":
                if target.is_file():
                    subprocess.Popen(["open", "-R", str(target)])
                else:
                    subprocess.Popen(["open", str(target)])
            elif sys.platform.startswith("win"):
                if target.is_file():
                    subprocess.Popen(["explorer", f"/select,{target}"])
                else:
                    subprocess.Popen(["explorer", str(target)])
            else:
                subprocess.Popen(
                    ["xdg-open", str(target if target.is_dir() else target.parent)]
                )
        except Exception as exc:  # noqa: BLE001
            self._show_error(f"Could not reveal path: {exc}")
            return
        self.status_bar.showMessage(f"Revealed: {target.name}", 3000)

    def _choose_local_file(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Open DDALAB Dataset",
            self.state.browser_path or str(self.repo_root),
            open_file_dialog_filter(),
        )
        if file_path:
            self._open_dataset(file_path)

    def _choose_local_folder(self) -> None:
        directory_path = QFileDialog.getExistingDirectory(
            self,
            "Open DDALAB Folder",
            self.state.browser_path or str(self.repo_root),
        )
        if not directory_path:
            return
        type_info = classify_path(directory_path, True)
        entry = BrowserEntry(
            name=Path(directory_path).name or directory_path,
            path=directory_path,
            is_directory=True,
            size_bytes=0,
            modified_at_epoch_ms=0,
            supported=type_info.openable,
            type_label=type_info.label,
            open_as_dataset=type_info.open_as_dataset,
        )
        self._open_entry(entry)

    def _open_dataset(self, path: str) -> None:
        self.status_bar.showMessage(f"Opening dataset: {path}", 4000)
        self._dataset_request_serial += 1
        request_serial = self._dataset_request_serial
        self._set_dataset_loading_state(path)

        def on_success(result: object) -> None:
            if request_serial != self._dataset_request_serial:
                return
            dataset = result
            self._stop_streaming()
            self.state.selected_dataset = dataset
            self.state.active_file_path = dataset.file_path
            self._append_file_tab(dataset.file_path)
            self._select_file_tab(dataset.file_path)
            session_payload = (
                self._pending_session_restore
                if isinstance(self._pending_session_restore, dict)
                and self._pending_session_restore.get("activeFilePath")
                == dataset.file_path
                else None
            )
            default_channels = self._preferred_channel_names(
                dataset,
                min(8, len(dataset.channel_names)),
            )
            self.state.selected_channel_names = default_channels
            self.state.waveform_viewport_start_seconds = 0.0
            self.state.waveform_viewport_duration_seconds = (
                self._recommended_viewport_duration(dataset)
            )
            self.state.annotations_by_file[dataset.file_path] = []
            self.state.dda_history = []
            self.state.dda_history_summaries = []
            self.state.dda_result = None
            self.state.ica_result = None
            self.state.selected_results_history_id = None
            self.state.waveform_window = None
            self.state.waveform_overview = None
            self._overview_signature = None
            self._clear_dataset_loading_state()
            self._update_dataset_ui()
            self._populate_channels()
            self._sync_default_dda_config()
            if session_payload is not None:
                self._apply_session_restore_to_dataset(session_payload)
                self._pending_session_restore = None
            if (
                self._pending_snapshot_restore is not None
                and self._pending_snapshot_restore.get("activeFilePath")
                == dataset.file_path
            ):
                snapshot_payload = self._pending_snapshot_restore
                self._pending_snapshot_restore = None
                QTimer.singleShot(
                    0,
                    lambda payload=snapshot_payload: self._apply_snapshot_restore_to_dataset(
                        payload
                    ),
                )
            else:
                self._load_waveform_data()
                self._schedule_overview_reload(force=True)
                self._set_saved_state_loading_state(dataset.file_name)
                self._load_saved_dataset_state_async(dataset.file_path, request_serial)
            self._refresh_results_page()
            self._record_workflow_action(
                "open-dataset",
                f"Opened {dataset.file_name}",
                {"path": dataset.file_path, "format": dataset.format_label},
                file_path=dataset.file_path,
            )
            self._notify("file", "info", "Dataset Opened", dataset.file_name)
            self._schedule_session_save()

        def on_error(message: str) -> None:
            if request_serial != self._dataset_request_serial:
                return
            if (
                isinstance(self._pending_session_restore, dict)
                and self._pending_session_restore.get("activeFilePath") == path
            ):
                self._pending_session_restore = None
            self._clear_dataset_loading_state()
            self._update_dataset_ui()
            runtime_logger("dataset").error(
                "Dataset open failed path=%s error=%s",
                path,
                message,
            )
            self._show_error(f"Dataset open failed: {message}")

        def load_dataset_task() -> object:
            return self.backend.load_dataset(path)

        self._run_task(load_dataset_task, on_success, on_error)

    def _set_saved_state_loading_state(self, file_name: str) -> None:
        if hasattr(self, "results_summary_label"):
            self.results_summary_label.setText(
                f"Loading saved analyses for {file_name}…"
            )
        if hasattr(self, "results_details"):
            self.results_details.setPlainText("")
        if hasattr(self, "results_history_status_label"):
            self.results_history_status_label.setText("Loading saved analyses…")
        if hasattr(self, "dda_history_status_label"):
            self.dda_history_status_label.setText("Loading saved analyses…")
        if hasattr(self, "batch_details"):
            self.batch_details.setPlainText("Loading saved batch/result history…")
        if hasattr(self, "batch_status_label"):
            self.batch_status_label.setText("Loading saved batch/result history…")

    def _set_startup_analysis_restore_loading_state(
        self,
        secondary_section: Optional[str],
    ) -> None:
        if secondary_section == "Batch":
            if hasattr(self, "batch_details"):
                self.batch_details.setPlainText(
                    "Restoring batch/result history after startup…"
                )
            if hasattr(self, "batch_status_label"):
                self.batch_status_label.setText(
                    "Restoring batch/result history after startup…"
                )
        elif secondary_section == "DDA":
            if hasattr(self, "dda_diagnostics"):
                self.dda_diagnostics.setPlainText(
                    "Restoring the last saved DDA result after startup…"
                )
            if hasattr(self, "result_summary"):
                self.result_summary.setPlainText(
                    "Restoring the last saved DDA result after startup…"
                )
        elif secondary_section == "ICA":
            if hasattr(self, "ica_diagnostics"):
                self.ica_diagnostics.setPlainText(
                    "Restoring the last saved ICA result after startup…"
                )
            if hasattr(self, "ica_result_summary"):
                self.ica_result_summary.setPlainText(
                    "Restoring the last saved ICA result after startup…"
                )
        elif secondary_section == "Connectivity":
            if hasattr(self, "connectivity_summary"):
                self.connectivity_summary.setPlainText(
                    "Restoring connectivity views after startup…"
                )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    "Restoring network motif plots after startup…"
                )
        elif secondary_section == "Compare":
            if hasattr(self, "compare_summary"):
                self.compare_summary.setPlainText(
                    "Restoring comparison views after startup…"
                )
            if hasattr(self, "compare_shared_meta_label"):
                self.compare_shared_meta_label.setText(
                    "Restoring comparison views after startup…"
                )
            if hasattr(self, "compare_stats_summary"):
                self.compare_stats_summary.setPlainText(
                    "Restoring comparison views after startup…"
                )

    def _schedule_startup_analysis_restore(
        self,
        file_path: str,
        request_serial: int,
        primary_section: Optional[str],
        secondary_section: Optional[str],
    ) -> None:
        if primary_section != "Run DDA":
            return
        if secondary_section not in {"Batch", "DDA", "ICA", "Connectivity", "Compare"}:
            return
        self._startup_analysis_restore_serial += 1
        restore_serial = self._startup_analysis_restore_serial
        self._set_startup_analysis_restore_loading_state(secondary_section)

        def restore_when_idle() -> None:
            if restore_serial != self._startup_analysis_restore_serial:
                return
            if request_serial != self._dataset_request_serial:
                return
            dataset = self.state.selected_dataset
            if dataset is None or dataset.file_path != file_path:
                return
            current_primary = self._current_primary_section()
            current_secondary = self._current_secondary_section()
            if current_primary != "Run DDA":
                return
            if current_secondary == "Batch":
                self._refresh_batch_candidates()
                self._refresh_batch_results()
            elif current_secondary == "DDA":
                self._ensure_cached_dda_result_loaded(
                    defer_view_render=True,
                    refresh_auxiliary_views=False,
                )
            elif current_secondary == "ICA":
                self._ensure_cached_ica_result_loaded()
            elif current_secondary == "Connectivity":
                self._refresh_connectivity_sources()
                self._refresh_connectivity_view()
            elif current_secondary == "Compare":
                self._refresh_compare_sources()
                self._refresh_compare_view()

        QTimer.singleShot(220, restore_when_idle)

    def _load_saved_dataset_state_async(
        self,
        file_path: str,
        request_serial: int,
    ) -> None:
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                annotations = temp_db.load_annotations_for_file(file_path)
                dda_history_summaries = temp_db.load_dda_history_summaries(file_path)
            finally:
                temp_db.close()
            return {
                "file_path": file_path,
                "annotations": annotations,
                "dda_history_summaries": dda_history_summaries,
            }

        def on_success(result: object) -> None:
            if request_serial != self._dataset_request_serial:
                return
            dataset = self.state.selected_dataset
            if dataset is None or dataset.file_path != file_path:
                return
            payload = result if isinstance(result, dict) else {}
            annotations = list(payload.get("annotations") or [])
            dda_history_summaries = list(payload.get("dda_history_summaries") or [])
            self.state.annotations_by_file[file_path] = annotations
            self.state.dda_history_summaries = dda_history_summaries
            self.state.dda_history = []
            self.state.dda_result = None
            self.state.ica_result = None
            selected_history_id = self.state.selected_results_history_id
            valid_history_ids = {item.id for item in dda_history_summaries}
            if not selected_history_id or selected_history_id not in valid_history_ids:
                self.state.selected_results_history_id = (
                    dda_history_summaries[0].id if dda_history_summaries else None
                )
            self._refresh_annotations_table()
            self._update_annotation_scope_label()
            self._apply_annotations_to_views()
            self._refresh_results_page()
            current_primary = self._current_primary_section()
            current_secondary = self._current_secondary_section()
            if current_primary == "Run DDA":
                if current_secondary == "Batch":
                    self._refresh_batch_candidates()
                    self._refresh_batch_results()
                elif current_secondary == "Connectivity":
                    self._refresh_connectivity_sources()
                elif current_secondary == "Compare":
                    self._refresh_compare_sources()
            self._schedule_startup_analysis_restore(
                file_path,
                request_serial,
                current_primary,
                current_secondary,
            )

        def on_error(message: str) -> None:
            if request_serial != self._dataset_request_serial:
                return
            self.status_bar.showMessage(
                f"Saved state load failed: {message}",
                5000,
            )
            self._refresh_results_page()
            self._refresh_visible_analysis_subviews()

        self._run_task(task, on_success, on_error)

    def _select_file_tab(self, path: str) -> None:
        for index in range(self.file_tabs.count()):
            if self.file_tabs.tabData(index) == path:
                self.file_tabs.setCurrentIndex(index)
                self._sync_file_tab_bar()
                break

    def _open_file_tab_context_menu(self, position: QPoint) -> None:
        index = self.file_tabs.tabAt(position)
        if index < 0:
            return
        path = self.file_tabs.tabData(index)
        if not isinstance(path, str):
            return
        is_pinned = self._is_pinned_file(path)
        menu = QMenu(self.file_tabs)
        pin_action = menu.addAction("Unpin Tab" if is_pinned else "Pin Tab")
        browse_action = menu.addAction("Open Containing Folder")
        reveal_action = menu.addAction(_system_reveal_label())
        copy_action = menu.addAction("Copy Path")
        menu.addSeparator()
        close_action = menu.addAction("Close")
        close_others_action = menu.addAction("Close Others")
        close_left_action = menu.addAction("Close Tabs to the Left")
        close_right_action = menu.addAction("Close Tabs to the Right")
        close_others_action.setEnabled(self.file_tabs.count() > 1)
        close_left_action.setEnabled(index > 0)
        close_right_action.setEnabled(index < self.file_tabs.count() - 1)
        chosen = menu.exec(self.file_tabs.mapToGlobal(position))
        if chosen is pin_action:
            self._toggle_file_tab_pin(path)
        elif chosen is browse_action:
            self._refresh_browser(str(Path(path).parent))
        elif chosen is reveal_action:
            self._reveal_path_in_system(path)
        elif chosen is copy_action:
            self._copy_text_to_clipboard(path, "Path copied")
        elif chosen is close_action:
            self._close_file_tab(index)
        elif chosen is close_others_action:
            self._close_other_tabs_for_path(path)
        elif chosen is close_left_action:
            self._close_tabs_to_side(index, direction="left")
        elif chosen is close_right_action:
            self._close_tabs_to_side(index, direction="right")

    def _on_tab_changed(self, index: int) -> None:
        if index < 0:
            return
        self._sync_file_tab_bar()
        path = self.file_tabs.tabData(index)
        if self._restoring_session:
            return
        if path and path != self.state.active_file_path:
            self._open_dataset(path)

    def _close_file_tab(self, index: int) -> None:
        path = self.file_tabs.tabData(index)
        with QSignalBlocker(self.file_tabs):
            self.file_tabs.removeTab(index)
        if path in self.state.open_files:
            self.state.open_files.remove(path)
        if path in self.state.pinned_file_paths:
            self.state.pinned_file_paths = [
                value for value in self.state.pinned_file_paths if value != path
            ]
        if self.file_tabs.count() == 0:
            self._stop_streaming()
            self.state.active_file_path = None
            self.state.selected_dataset = None
            self.state.pinned_file_paths = []
            self._update_dataset_ui()
            self._sync_file_tab_bar()
            self._schedule_session_save()
            return
        if path == self.state.active_file_path:
            next_path = self.file_tabs.tabData(
                max(0, min(index, self.file_tabs.count() - 1))
            )
            if next_path:
                self._open_dataset(next_path)
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()
        self._schedule_session_save()

    def _on_primary_nav_changed(self, index: int) -> None:
        section = self.primary_sections[index]
        self.primary_stack.setCurrentWidget(self.page_registry[section])
        self._rebuild_secondary_nav(section)
        if section == "Workspace":
            if self._current_secondary_section() == "OpenNeuro":
                self._load_openneuro()
        elif section == "Run DDA":
            current_tab = self._current_secondary_section()
            if current_tab == "DDA":
                self._ensure_cached_dda_result_loaded()
            elif current_tab == "ICA":
                self._ensure_cached_ica_result_loaded()
        elif section == "Results":
            self._refresh_results_page()
            self._refresh_workflow_table()
            self._refresh_notifications_table()
            self._update_workflow_ui()
        self._schedule_session_save()

    def _switch_primary_section(
        self, index: int, *, secondary_index: Optional[int] = 0
    ) -> None:
        if not hasattr(self, "primary_nav"):
            return
        if index < 0 or index >= len(self.primary_sections):
            return
        with QSignalBlocker(self.primary_nav):
            self.primary_nav.setCurrentIndex(index)
        self._on_primary_nav_changed(index)
        if secondary_index is not None:
            self._switch_secondary_section(secondary_index)

    def _rebuild_secondary_nav(self, section: str) -> None:
        with QSignalBlocker(self.secondary_nav):
            while self.secondary_nav.count() > 0:
                self.secondary_nav.removeTab(0)
            tabs = self.secondary_sections.get(section, [])
            if not tabs:
                self.secondary_nav.hide()
                return
            for label in tabs:
                self.secondary_nav.addTab(label)
            self.secondary_nav.setCurrentIndex(0)
            self.secondary_nav.show()

    def _switch_secondary_section(self, index: int) -> None:
        if not hasattr(self, "secondary_nav"):
            return
        if self.secondary_nav.count() <= 0:
            return
        if index < 0 or index >= self.secondary_nav.count():
            return
        with QSignalBlocker(self.secondary_nav):
            self.secondary_nav.setCurrentIndex(index)
        self._on_secondary_nav_changed(index)

    def _on_secondary_nav_changed(self, index: int) -> None:
        section = self.primary_sections[self.primary_nav.currentIndex()]
        tabs = self.secondary_sections.get(section, [])
        if not tabs:
            return
        tab = tabs[index]
        if section == "Run DDA":
            if hasattr(self, "analyze_stack"):
                self.analyze_stack.setCurrentIndex(
                    {
                        "DDA": 0,
                        "ICA": 1,
                        "Batch": 2,
                        "Connectivity": 3,
                        "Compare": 4,
                    }.get(tab, 0)
                )
            if tab == "DDA":
                self._ensure_cached_dda_result_loaded()
            elif tab == "ICA":
                self._ensure_cached_ica_result_loaded()
                self._update_ica_channel_summary()
            elif tab == "Batch":
                self._refresh_batch_candidates()
                self._refresh_batch_results()
            elif tab == "Connectivity":
                self._refresh_connectivity_sources()
                self._refresh_connectivity_view()
            elif tab == "Compare":
                self._refresh_compare_sources()
                self._refresh_compare_view()
        elif section == "Workspace":
            if hasattr(self, "visualize_stack"):
                self.visualize_stack.setCurrentIndex(
                    {"Inspect": 0, "Annotate": 1, "Replay": 2, "OpenNeuro": 3}.get(
                        tab,
                        0,
                    )
                )
            if tab == "OpenNeuro":
                self._load_openneuro()
            else:
                self._update_annotation_scope_label()
                self._update_streaming_ui()
        elif section == "Results":
            if hasattr(self, "collaborate_stack"):
                self.collaborate_stack.setCurrentIndex(
                    {"History": 0, "Action Log": 1, "Notifications": 2}.get(tab, 0)
                )
            self._refresh_results_page()
            self._refresh_workflow_table()
            self._refresh_notifications_table()
            self._update_workflow_ui()
        self._schedule_session_save()
