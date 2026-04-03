from __future__ import annotations

from dataclasses import asdict
import json
from datetime import datetime, timezone
from pathlib import Path
import uuid
from typing import Callable, Dict, List, Optional

from PySide6.QtCore import (
    QByteArray,
    QEvent,
    QSignalBlocker,
    Qt,
    QTimer,
    Signal,
    QObject,
)
from PySide6.QtWidgets import (
    QFileDialog,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QStyle,
    QStyleOptionViewItem,
    QTableWidgetItem,
    QWidget,
)

from ..domain.file_types import classify_path, open_file_dialog_filter
from ..domain.models import (
    BrowserEntry,
    DdaResult,
    DdaResultSummary,
    DdaVariantResult,
    IcaComponent,
    IcaResult,
    NotificationEntry,
    WaveformAnnotation,
    WorkflowActionEntry,
)


class WorkerSignals(QObject):
    success = Signal(object)
    error = Signal(str)


class ToggleListWidget(QListWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._pressed_item: Optional[QListWidgetItem] = None
        self._pressed_on_indicator = False

    def mousePressEvent(self, event) -> None:  # type: ignore[override]
        item = self.itemAt(event.position().toPoint())
        self._pressed_item = item
        self._pressed_on_indicator = (
            self._is_on_check_indicator(item, event.position().toPoint())
            if item
            else False
        )
        super().mousePressEvent(event)

    def mouseReleaseEvent(self, event) -> None:  # type: ignore[override]
        item = self.itemAt(event.position().toPoint())
        should_toggle = (
            event.button() == Qt.LeftButton
            and item is not None
            and item is self._pressed_item
            and not self._pressed_on_indicator
            and bool(item.flags() & Qt.ItemIsUserCheckable)
        )
        super().mouseReleaseEvent(event)
        if should_toggle:
            item.setCheckState(
                Qt.Unchecked if item.checkState() == Qt.Checked else Qt.Checked
            )
        self._pressed_item = None
        self._pressed_on_indicator = False

    def _is_on_check_indicator(self, item: Optional[QListWidgetItem], point) -> bool:
        if item is None:
            return False
        option = QStyleOptionViewItem()
        option.initFrom(self)
        option.rect = self.visualItemRect(item)
        option.features |= QStyleOptionViewItem.HasCheckIndicator
        option.checkState = item.checkState()
        indicator_rect = self.style().subElementRect(
            QStyle.SE_ItemViewItemCheckIndicator, option, self
        )
        return indicator_rect.contains(point)


class MainWindowSupportMixin:
    def _session_state_path(self) -> Path:
        return Path.home() / ".ddalab-qt" / "session.json"

    def _schedule_session_save(self) -> None:
        if self._restoring_session:
            return
        self.session_save_timer.start(180)

    def _save_session_state(self) -> None:
        payload = {
            "openFiles": [path for path in self.state.open_files if path],
            "activeFilePath": self.state.active_file_path,
            "windowGeometry": bytes(self.saveGeometry().toBase64()).decode("ascii"),
            "windowMaximized": self.isMaximized(),
            "ddaColorScheme": self.heatmap_color_scheme_combo.currentData(),
        }
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        if payload_json == self._last_saved_session_payload_json:
            return
        self.state_db.save_session_payload(payload)
        self._last_saved_session_payload_json = payload_json

    def _load_session_state(self) -> dict:
        payload = self.state_db.load_session_payload()
        return payload if isinstance(payload, dict) else {}

    def _restore_session_state(self) -> None:
        if self._session_restored:
            return
        self._session_restored = True
        payload = self._cached_session_payload
        self._cached_session_payload = None
        open_files = payload.get("openFiles") or []
        if not isinstance(open_files, list):
            open_files = []
        active_file = payload.get("activeFilePath")
        seen: set[str] = set()
        restored_paths: List[str] = []
        for raw_path in open_files:
            if not isinstance(raw_path, str) or not raw_path or raw_path in seen:
                continue
            if not self._server_url and not Path(raw_path).exists():
                continue
            seen.add(raw_path)
            restored_paths.append(raw_path)
        if not restored_paths:
            self._sync_file_tab_bar()
            return
        self._restoring_session = True
        try:
            self.state.open_files = list(restored_paths)
            with QSignalBlocker(self.file_tabs):
                while self.file_tabs.count() > 0:
                    self.file_tabs.removeTab(0)
                for path in self.state.open_files:
                    self.file_tabs.addTab("")
                    self.file_tabs.setTabData(self.file_tabs.count() - 1, path)
            self._refresh_file_tab_labels()
            self._sync_file_tab_bar()
        finally:
            self._restoring_session = False

        target_path = (
            active_file
            if isinstance(active_file, str) and active_file in restored_paths
            else restored_paths[0]
        )
        target_index = self._file_tab_index_for_path(target_path)
        if target_index >= 0:
            with QSignalBlocker(self.file_tabs):
                self.file_tabs.setCurrentIndex(target_index)
            self._sync_file_tab_bar()
        self._schedule_session_save()
        QTimer.singleShot(0, lambda path=target_path: self._open_dataset(path))

    def _apply_window_session_state(self, payload: dict) -> None:
        geometry = payload.get("windowGeometry")
        if isinstance(geometry, str) and geometry:
            try:
                self.restoreGeometry(QByteArray.fromBase64(geometry.encode("ascii")))
            except Exception:
                pass
        if payload.get("windowMaximized"):
            self.setWindowState(self.windowState() | Qt.WindowMaximized)
        color_scheme = payload.get("ddaColorScheme")
        if isinstance(color_scheme, str):
            index = self.heatmap_color_scheme_combo.findData(color_scheme)
            if index >= 0:
                with QSignalBlocker(self.heatmap_color_scheme_combo):
                    self.heatmap_color_scheme_combo.setCurrentIndex(index)
                self.heatmap_widget.set_color_scheme(color_scheme)

    def _file_tab_index_for_path(self, path: str) -> int:
        for index in range(self.file_tabs.count()):
            if self.file_tabs.tabData(index) == path:
                return index
        return -1

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
        for index in range(self.file_tabs.count()):
            path = self.file_tabs.tabData(index)
            if not isinstance(path, str):
                continue
            self.file_tabs.setTabText(index, self._tab_title_for_path(path))
            self.file_tabs.setTabToolTip(index, path)

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
        self.file_tabs_summary_label.setText(
            f"{tab_count} {suffix} open • {current_label}"
        )

    def _append_file_tab(self, path: str) -> None:
        if path in self.state.open_files:
            self._refresh_file_tab_labels()
            self._sync_file_tab_bar()
            return
        self.state.open_files.append(path)
        self.file_tabs.addTab("")
        self.file_tabs.setTabData(self.file_tabs.count() - 1, path)
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()

    def _rebuild_open_files_from_tabs(self) -> None:
        self.state.open_files = [
            self.file_tabs.tabData(index)
            for index in range(self.file_tabs.count())
            if isinstance(self.file_tabs.tabData(index), str)
        ]
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()

    def _on_file_tab_moved(self, from_index: int, to_index: int) -> None:
        _ = from_index, to_index
        self._rebuild_open_files_from_tabs()
        self._schedule_session_save()

    def _close_other_tabs(self) -> None:
        current_index = self.file_tabs.currentIndex()
        if current_index < 0:
            return
        current_path = self.file_tabs.tabData(current_index)
        if not isinstance(current_path, str):
            return
        with QSignalBlocker(self.file_tabs):
            while self.file_tabs.count() > 0:
                self.file_tabs.removeTab(0)
            self.file_tabs.addTab("")
            self.file_tabs.setTabData(0, current_path)
            self.file_tabs.setCurrentIndex(0)
        self.state.open_files = [current_path]
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()
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
            self.state.browser_path = root_path
            self._refresh_browser(root_path)
            self._restore_session_state()

        def on_error(message: str) -> None:
            self.state.browser_path = str(self.repo_root)
            self.file_browser.set_path(str(self.repo_root))
            self.file_browser.set_entries([])
            self._notify("file", "error", "Root Lookup Failed", message)

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

        self._run_task(
            task,
            on_success,
            lambda message: self.status_bar.showMessage(
                f"Directory load failed: {message}", 5000
            ),
        )

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

        def on_success(result: object) -> None:
            dataset = result
            self._stop_streaming()
            self.state.selected_dataset = dataset
            self.state.active_file_path = dataset.file_path
            self._append_file_tab(dataset.file_path)
            self._select_file_tab(dataset.file_path)
            default_channels = dataset.channel_names[
                : min(8, len(dataset.channel_names))
            ]
            self.state.selected_channel_names = default_channels
            self.state.waveform_viewport_start_seconds = 0.0
            self.state.waveform_viewport_duration_seconds = (
                self._recommended_viewport_duration(dataset)
            )
            self.state.annotations_by_file[dataset.file_path] = (
                self.state_db.load_annotations_for_file(dataset.file_path)
            )
            persisted_dda_history = self.state_db.load_dda_history_summaries(
                dataset.file_path
            )
            persisted_dda_result = (
                self.state_db.load_dda_result_by_id(persisted_dda_history[0].id)
                if persisted_dda_history
                else None
            )
            persisted_ica_result = self.state_db.load_latest_ica_result(
                dataset.file_path
            )
            self.state.dda_history = [persisted_dda_result] if persisted_dda_result else []
            self.state.dda_history_summaries = persisted_dda_history
            self.state.dda_result = persisted_dda_result
            self.state.ica_result = persisted_ica_result
            self.state.waveform_window = None
            self.state.waveform_overview = None
            self._overview_signature = None
            self._update_dataset_ui()
            self._populate_channels()
            self._sync_default_dda_config()
            if (
                self._pending_snapshot_restore is not None
                and self._pending_snapshot_restore.get("activeFilePath")
                == dataset.file_path
            ):
                snapshot_payload = self._pending_snapshot_restore
                self._pending_snapshot_restore = None
                self._apply_snapshot_restore_to_dataset(snapshot_payload)
            else:
                self._apply_dda_result(persisted_dda_result, persist=False)
                self._apply_ica_result(persisted_ica_result)
                self._load_waveform_data()
                self._schedule_overview_reload(force=True)
            self._refresh_results_page()
            self._record_workflow_action(
                "open-dataset",
                f"Opened {dataset.file_name}",
                {"path": dataset.file_path, "format": dataset.format_label},
                file_path=dataset.file_path,
            )
            self._notify("file", "info", "Dataset Opened", dataset.file_name)
            self._schedule_session_save()

        self._run_task(
            lambda: self.backend.load_dataset(path),
            on_success,
            lambda message: self._notify(
                "file", "error", "Dataset Open Failed", message
            ),
        )

    def _select_file_tab(self, path: str) -> None:
        for index in range(self.file_tabs.count()):
            if self.file_tabs.tabData(index) == path:
                self.file_tabs.setCurrentIndex(index)
                self._sync_file_tab_bar()
                break

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
        if self.file_tabs.count() == 0:
            self._stop_streaming()
            self.state.active_file_path = None
            self.state.selected_dataset = None
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
        if section == "Data":
            self._load_openneuro()
        elif section == "Plugins":
            self._refresh_plugins()
        elif section == "Collaborate":
            self._refresh_results_page()
            self._refresh_workflow_table()
            self._update_workflow_ui()
        elif section == "Notifications":
            self._refresh_notifications_table()

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

    def _on_secondary_nav_changed(self, index: int) -> None:
        section = self.primary_sections[self.primary_nav.currentIndex()]
        tabs = self.secondary_sections.get(section, [])
        if not tabs:
            return
        tab = tabs[index]
        if section == "DDA":
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
            if tab == "ICA":
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
        elif section == "Visualize":
            if hasattr(self, "visualize_stack"):
                self.visualize_stack.setCurrentIndex(
                    {"Time Series": 0, "Annotations": 1, "Streaming": 2}.get(tab, 0)
                )
            self._update_annotation_scope_label()
            self._update_streaming_ui()
        elif section == "Data":
            if hasattr(self, "data_stack"):
                self.data_stack.setCurrentIndex(
                    {"OpenNeuro": 0, "NSG Jobs": 1}.get(tab, 0)
                )
            if tab == "OpenNeuro":
                self._load_openneuro()
            elif tab == "NSG Jobs":
                self._refresh_nsg_state()
        elif section == "Collaborate":
            if hasattr(self, "collaborate_stack"):
                self.collaborate_stack.setCurrentIndex(
                    {"Results": 0, "Workflow": 1}.get(tab, 0)
                )
            self._refresh_results_page()
            self._refresh_workflow_table()
            self._update_workflow_ui()
        elif section == "Learn":
            if hasattr(self, "learn_stack"):
                self.learn_stack.setCurrentIndex(
                    {"Tutorials": 0, "Files": 1, "Reference": 2}.get(tab, 0)
                )

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _notify(
        self,
        category: str,
        level: str,
        title: str,
        message: str,
        *,
        show_status: bool = True,
    ) -> None:
        entry = NotificationEntry(
            id=uuid.uuid4().hex,
            category=category,
            level=level,
            title=title,
            message=message,
            created_at_iso=self._now_iso(),
        )
        self.state.notifications.insert(0, entry)
        self.state.notifications = self.state.notifications[:250]
        self.state_db.replace_notifications(self.state.notifications)
        self._refresh_notifications_table()
        if show_status:
            self.status_bar.showMessage(f"{title}: {message}", 4000)

    def _record_workflow_action(
        self,
        action_type: str,
        description: str,
        payload: Optional[Dict[str, str]] = None,
        file_path: Optional[str] = None,
    ) -> None:
        if not self.state.workflow_recording_enabled:
            return
        self.state.workflow_actions.append(
            WorkflowActionEntry(
                id=uuid.uuid4().hex,
                action_type=action_type,
                description=description,
                created_at_iso=self._now_iso(),
                file_path=file_path or self.state.active_file_path,
                payload=payload or {},
            )
        )
        self.state_db.replace_workflow_actions(self.state.workflow_actions)
        self._refresh_workflow_table()
        self._update_workflow_ui()

    def _refresh_notifications_table(self) -> None:
        if not hasattr(self, "notifications_table"):
            return
        entries = self.state.notifications
        self.notifications_table.setRowCount(len(entries))
        for row, entry in enumerate(entries):
            values = [
                entry.created_at_iso.replace("T", " ").replace("+00:00", "Z"),
                entry.category,
                entry.level.upper(),
                entry.title,
                entry.message,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                self.notifications_table.setItem(row, column, item)
        self.notifications_table.resizeColumnsToContents()

    def _refresh_workflow_table(self) -> None:
        if not hasattr(self, "workflow_table"):
            return
        actions = self.state.workflow_actions
        self.workflow_table.setRowCount(len(actions))
        for row, action in enumerate(actions):
            values = [
                action.created_at_iso.replace("T", " ").replace("+00:00", "Z"),
                action.action_type,
                action.description,
                action.file_path or "—",
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                self.workflow_table.setItem(row, column, item)
        self.workflow_table.resizeColumnsToContents()

    def _update_workflow_ui(self) -> None:
        if not hasattr(self, "workflow_status_label"):
            return
        status = "Recording" if self.state.workflow_recording_enabled else "Idle"
        action_count = len(self.state.workflow_actions)
        self.workflow_status_label.setText(
            f"{status} • {action_count} recorded action{'s' if action_count != 1 else ''}"
        )
        self.start_workflow_button.setEnabled(not self.state.workflow_recording_enabled)
        self.stop_workflow_button.setEnabled(self.state.workflow_recording_enabled)
        self.clear_workflow_button.setEnabled(bool(self.state.workflow_actions))
        self.export_workflow_button.setEnabled(bool(self.state.workflow_actions))

    def _refresh_results_page(self) -> None:
        if not hasattr(self, "results_details"):
            return
        self._refresh_results_history_table()
        self._refresh_results_details()

    def _dda_result_to_summary(self, result: DdaResult) -> DdaResultSummary:
        return DdaResultSummary(
            id=result.id,
            file_path=result.file_path,
            file_name=result.file_name,
            created_at_iso=result.created_at_iso,
            engine_label=result.engine_label,
            variant_ids=[variant.id for variant in result.variants],
            is_fallback=result.is_fallback,
        )

    def _cache_dda_result(self, result: DdaResult) -> None:
        self.state.dda_history = [result] + [
            item for item in self.state.dda_history if item.id != result.id
        ]
        self.state.dda_history.sort(key=lambda item: item.created_at_iso, reverse=True)
        self.state.dda_history = self.state.dda_history[:10]

    def _upsert_dda_history_summary(self, summary: DdaResultSummary) -> None:
        self.state.dda_history_summaries = [summary] + [
            item
            for item in self.state.dda_history_summaries
            if item.id != summary.id
        ]
        self.state.dda_history_summaries.sort(
            key=lambda item: item.created_at_iso, reverse=True
        )
        self.state.dda_history_summaries = self.state.dda_history_summaries[:30]

    def _remember_dda_result(self, result: DdaResult, *, persist: bool = True) -> None:
        self._cache_dda_result(result)
        self._upsert_dda_history_summary(self._dda_result_to_summary(result))
        if persist:
            self.state_db.save_dda_result(result)

    def _load_dda_result_from_history(self, result_id: Optional[str]) -> Optional[DdaResult]:
        if not result_id:
            return None
        if self.state.dda_result is not None and self.state.dda_result.id == result_id:
            return self.state.dda_result
        for result in self.state.dda_history:
            if result.id == result_id:
                return result
        result = self.state_db.load_dda_result_by_id(result_id)
        if result is not None:
            self._cache_dda_result(result)
        return result

    def _refresh_results_history_table(self) -> None:
        tables = [
            table
            for table_name in ("results_history_table", "dda_history_table")
            if (table := getattr(self, table_name, None)) is not None
        ]
        if not tables:
            return
        history = list(self.state.dda_history_summaries)
        if not history:
            self.state.selected_results_history_id = None
        selected_id = self.state.selected_results_history_id
        if selected_id is None and self.state.dda_result is not None:
            selected_id = self.state.dda_result.id
        if selected_id is None and history:
            selected_id = history[0].id
            self.state.selected_results_history_id = selected_id

        for table in tables:
            with QSignalBlocker(table):
                table.setRowCount(len(history))
                selected_row = -1
                for row, result in enumerate(history):
                    values = [
                        result.created_at_iso.replace("T", " "),
                        ", ".join(result.variant_ids) or "—",
                        result.engine_label or "—",
                        result.id,
                    ]
                    for column, value in enumerate(values):
                        item = QTableWidgetItem(value)
                        if column == 0:
                            item.setData(Qt.UserRole, result.id)
                            item.setToolTip(
                                f"{result.file_name}\n{result.created_at_iso}\n{result.engine_label}"
                            )
                        table.setItem(row, column, item)
                    if result.id == selected_id:
                        selected_row = row
                if selected_row >= 0:
                    table.selectRow(selected_row)
                else:
                    table.clearSelection()

        status_text = (
            f"{len(history)} saved analysis result{'s' if len(history) != 1 else ''} "
            f"for {history[0].file_name}"
            if history
            else "No saved analyses for this file yet."
        )
        if hasattr(self, "results_history_status_label"):
            self.results_history_status_label.setText(status_text)
        if hasattr(self, "dda_history_status_label"):
            self.dda_history_status_label.setText(status_text)

    def _selected_history_result(self) -> Optional[DdaResult]:
        target_id = self.state.selected_results_history_id
        if target_id:
            loaded = self._load_dda_result_from_history(target_id)
            if loaded is not None:
                return loaded
        if self.state.dda_result is not None:
            return self.state.dda_result
        if self.state.dda_history_summaries:
            return self._load_dda_result_from_history(self.state.dda_history_summaries[0].id)
        return None

    def _on_results_history_selection_changed(self) -> None:
        source_table = self.sender()
        if source_table is None or not hasattr(source_table, "selectionModel"):
            return
        selected_rows = source_table.selectionModel().selectedRows()
        if selected_rows:
            item = source_table.item(selected_rows[0].row(), 0)
            result_id = item.data(Qt.UserRole) if item is not None else None
            self.state.selected_results_history_id = (
                str(result_id) if result_id else None
            )
            for table_name in ("results_history_table", "dda_history_table"):
                table = getattr(self, table_name, None)
                if table is None or table is source_table:
                    continue
                with QSignalBlocker(table):
                    if selected_rows[0].row() < table.rowCount():
                        table.selectRow(selected_rows[0].row())
        self._refresh_results_details()

    def _view_selected_history_result(self, *_args) -> None:
        result = self._selected_history_result()
        if result is None:
            return
        self.state.selected_results_history_id = result.id
        self._apply_dda_result(result)
        if "DDA" in self.primary_sections:
            dda_index = self.primary_sections.index("DDA")
            with QSignalBlocker(self.primary_nav):
                self.primary_nav.setCurrentIndex(dda_index)
            self._switch_primary_section(dda_index)

    def _refresh_results_details(self) -> None:
        dataset = self.state.selected_dataset
        result = self._selected_history_result()
        ica_result = self.state.ica_result
        annotation_count = (
            len(self._current_annotations()) if self.state.active_file_path else 0
        )
        if dataset is None and result is None and ica_result is None:
            self.results_summary_label.setText("Run DDA to capture a result snapshot.")
            self.results_details.setPlainText("")
        else:
            lines = []
            if dataset is not None:
                lines.extend(
                    [
                        f"Dataset: {dataset.file_name}",
                        f"Format: {dataset.format_label}",
                        f"Channels: {len(dataset.channels)}",
                        f"Duration: {dataset.duration_seconds:.3f}s",
                        f"Annotations: {annotation_count}",
                    ]
                )
            if result is not None:
                lines.extend(
                    [
                        f"Result ID: {result.id}",
                        f"Engine: {result.engine_label}",
                        f"Created: {result.created_at_iso}",
                        f"Variants: {', '.join(variant.id for variant in result.variants)}",
                    ]
                )
            if ica_result is not None:
                lines.extend(
                    [
                        f"ICA Result ID: {ica_result.id}",
                        f"ICA Channels: {len(ica_result.channel_names)}",
                        f"ICA Components: {len(ica_result.components)}",
                        f"ICA Created: {ica_result.created_at_iso}",
                    ]
                )
            self.results_summary_label.setText(
                "Current file state, DDA output, and portable exports."
            )
            self.results_details.setPlainText("\n".join(lines))
        has_result = result is not None
        has_dataset = dataset is not None
        has_exportable_state = has_dataset or has_result or ica_result is not None
        for widget_name in (
            "view_history_result_button",
            "data_export_button",
            "reproduce_export_button",
            "plot_export_button",
            "dda_view_history_result_button",
            "dda_data_export_button",
            "dda_reproduce_export_button",
            "dda_plot_export_button",
        ):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.setEnabled(has_result)
        for widget_name in ("snapshot_export_button", "dda_snapshot_export_button"):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.setEnabled(has_exportable_state)
        import_buttons = [
            getattr(self, widget_name, None)
            for widget_name in ("import_snapshot_button", "dda_import_snapshot_button")
        ]
        for button in import_buttons:
            if button is not None:
                button.setEnabled(True)
        self.export_annotations_button.setEnabled(has_dataset and annotation_count > 0)

    def _workflow_payload(self) -> dict:
        return {
            "name": (
                f"{Path(self.state.active_file_path).name} workflow"
                if self.state.active_file_path
                else "DDALAB workflow"
            ),
            "createdAtIso": self._now_iso(),
            "actions": [asdict(action) for action in self.state.workflow_actions],
        }

    def _current_dda_config_payload(self) -> dict:
        selected_variants = [
            key
            for key, checkbox in self.variant_checkboxes.items()
            if checkbox.isChecked()
        ]
        end_text = self.dda_end_edit.text().strip()
        return {
            "variantIds": selected_variants,
            "windowLengthSamples": self.window_length_spin.value(),
            "windowStepSamples": self.window_step_spin.value(),
            "delays": [
                int(token.strip())
                for token in self.delays_edit.text().split(",")
                if token.strip()
            ],
            "startTimeSeconds": float(self.dda_start_edit.text() or "0"),
            "endTimeSeconds": float(end_text) if end_text else None,
        }

    def _apply_dda_config_payload(self, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        raw_variant_ids = payload.get("variantIds")
        if isinstance(raw_variant_ids, list):
            selected_variants = {
                str(value) for value in raw_variant_ids if value is not None
            }
            for key, checkbox in self.variant_checkboxes.items():
                checkbox.setChecked(key in selected_variants)
        try:
            if payload.get("windowLengthSamples") is not None:
                self.window_length_spin.setValue(int(payload["windowLengthSamples"]))
            if payload.get("windowStepSamples") is not None:
                self.window_step_spin.setValue(int(payload["windowStepSamples"]))
        except (TypeError, ValueError):
            pass
        delays = payload.get("delays")
        if isinstance(delays, list):
            delay_tokens = [str(int(value)) for value in delays if value is not None]
            if delay_tokens:
                self.delays_edit.setText(",".join(delay_tokens))
        start_seconds = payload.get("startTimeSeconds")
        if start_seconds is not None:
            self.dda_start_edit.setText(f"{float(start_seconds):.6g}")
        end_seconds = payload.get("endTimeSeconds")
        if end_seconds is not None:
            self.dda_end_edit.setText(f"{float(end_seconds):.6g}")
        elif "endTimeSeconds" in payload:
            self.dda_end_edit.clear()

    def _snapshot_payload(self) -> dict:
        return self._snapshot_payload_for_mode("full", self.state.dda_result)

    def _snapshot_payload_for_mode(
        self,
        mode: str,
        result: Optional[DdaResult],
    ) -> dict:
        payload = {
            "createdAtIso": self._now_iso(),
            "snapshotMode": mode,
            "openFiles": list(self.state.open_files),
            "activeFilePath": self.state.active_file_path,
            "selectedChannelNames": list(self.state.selected_channel_names),
            "viewport": {
                "startSeconds": self.state.waveform_viewport_start_seconds,
                "durationSeconds": self.state.waveform_viewport_duration_seconds,
            },
            "ddaConfig": self._current_dda_config_payload(),
            "workflow": self._workflow_payload(),
        }
        if mode == "recipe_only":
            payload["annotationsByFile"] = {}
            payload["ddaResult"] = None
            payload["icaResult"] = None
            return payload
        payload["annotationsByFile"] = {
            path: [asdict(annotation) for annotation in annotations]
            for path, annotations in self.state.annotations_by_file.items()
        }
        payload["ddaResult"] = asdict(result) if result else None
        payload["icaResult"] = (
            asdict(self.state.ica_result) if self.state.ica_result else None
        )
        return payload

    def _restore_annotations_from_payload(
        self, payload: object
    ) -> dict[str, List[WaveformAnnotation]]:
        if not isinstance(payload, dict):
            return {}
        restored: dict[str, List[WaveformAnnotation]] = {}
        for raw_path, raw_annotations in payload.items():
            if not isinstance(raw_path, str) or not isinstance(raw_annotations, list):
                continue
            annotations: List[WaveformAnnotation] = []
            for raw_annotation in raw_annotations:
                if not isinstance(raw_annotation, dict):
                    continue
                try:
                    annotations.append(
                        WaveformAnnotation(
                            id=str(raw_annotation.get("id") or uuid.uuid4().hex),
                            label=str(raw_annotation.get("label") or "Annotation"),
                            notes=str(raw_annotation.get("notes") or ""),
                            channel_name=(
                                str(
                                    raw_annotation.get("channel_name")
                                    or raw_annotation.get("channelName")
                                )
                                if (
                                    raw_annotation.get("channel_name") is not None
                                    or raw_annotation.get("channelName") is not None
                                )
                                else None
                            ),
                            start_seconds=float(
                                raw_annotation.get("start_seconds")
                                or raw_annotation.get("startSeconds")
                                or 0.0
                            ),
                            end_seconds=(
                                float(
                                    raw_annotation.get("end_seconds")
                                    or raw_annotation.get("endSeconds")
                                )
                                if (
                                    raw_annotation.get("end_seconds") is not None
                                    or raw_annotation.get("endSeconds") is not None
                                )
                                else None
                            ),
                        )
                    )
                except (TypeError, ValueError):
                    continue
            restored[raw_path] = annotations
        return restored

    def _restore_workflow_actions(self, payload: object) -> List[WorkflowActionEntry]:
        if not isinstance(payload, list):
            return []
        restored: List[WorkflowActionEntry] = []
        for raw_action in payload:
            if not isinstance(raw_action, dict):
                continue
            payload_value = raw_action.get("payload")
            restored.append(
                WorkflowActionEntry(
                    id=str(raw_action.get("id") or uuid.uuid4().hex),
                    action_type=str(
                        raw_action.get("action_type")
                        or raw_action.get("actionType")
                        or "action"
                    ),
                    description=str(raw_action.get("description") or ""),
                    created_at_iso=str(
                        raw_action.get("created_at_iso")
                        or raw_action.get("createdAtIso")
                        or self._now_iso()
                    ),
                    file_path=(
                        str(raw_action.get("file_path") or raw_action.get("filePath"))
                        if (
                            raw_action.get("file_path") is not None
                            or raw_action.get("filePath") is not None
                        )
                        else None
                    ),
                    payload=payload_value if isinstance(payload_value, dict) else {},
                )
            )
        return restored

    def _restore_dda_result(self, payload: object) -> Optional[DdaResult]:
        if not isinstance(payload, dict):
            return None
        raw_variants = payload.get("variants")
        variants: List[DdaVariantResult] = []
        if isinstance(raw_variants, list):
            for raw_variant in raw_variants:
                if not isinstance(raw_variant, dict):
                    continue
                raw_matrix = raw_variant.get("matrix")
                matrix = (
                    [
                        [float(value) for value in row]
                        for row in raw_matrix
                        if isinstance(row, list)
                    ]
                    if isinstance(raw_matrix, list)
                    else []
                )
                variants.append(
                    DdaVariantResult(
                        id=str(raw_variant.get("id") or "variant"),
                        label=str(raw_variant.get("label") or ""),
                        row_labels=[
                            str(value)
                            for value in (
                                raw_variant.get("row_labels")
                                or raw_variant.get("rowLabels")
                                or []
                            )
                            if value is not None
                        ],
                        matrix=matrix,
                        summary=str(raw_variant.get("summary") or ""),
                        min_value=float(
                            raw_variant.get("min_value")
                            or raw_variant.get("minValue")
                            or 0.0
                        ),
                        max_value=float(
                            raw_variant.get("max_value")
                            or raw_variant.get("maxValue")
                            or 0.0
                        ),
                    )
                )
        return DdaResult(
            id=str(payload.get("id") or uuid.uuid4().hex),
            file_path=str(payload.get("file_path") or payload.get("filePath") or ""),
            file_name=str(payload.get("file_name") or payload.get("fileName") or ""),
            created_at_iso=str(
                payload.get("created_at_iso")
                or payload.get("createdAtIso")
                or self._now_iso()
            ),
            engine_label=str(
                payload.get("engine_label") or payload.get("engineLabel") or ""
            ),
            diagnostics=[
                str(value)
                for value in payload.get("diagnostics", [])
                if value is not None
            ],
            window_centers_seconds=[
                float(value)
                for value in (
                    payload.get("window_centers_seconds")
                    or payload.get("windowCentersSeconds")
                    or []
                )
                if value is not None
            ],
            variants=variants,
            is_fallback=bool(
                payload.get("is_fallback", payload.get("isFallback", False))
            ),
        )

    def _restore_ica_result(self, payload: object) -> Optional[IcaResult]:
        if not isinstance(payload, dict):
            return None
        return IcaResult(
            id=str(payload.get("id") or uuid.uuid4().hex),
            file_path=str(payload.get("file_path") or payload.get("filePath") or ""),
            file_name=str(payload.get("file_name") or payload.get("fileName") or ""),
            created_at_iso=str(
                payload.get("created_at_iso")
                or payload.get("createdAtIso")
                or self._now_iso()
            ),
            channel_names=[
                str(value)
                for value in (
                    payload.get("channel_names") or payload.get("channelNames") or []
                )
                if value is not None
            ],
            sample_rate_hz=float(
                payload.get("sample_rate_hz") or payload.get("sampleRateHz") or 0.0
            ),
            sample_count=int(
                payload.get("sample_count") or payload.get("sampleCount") or 0
            ),
            components=[
                IcaComponent(
                    component_id=int(
                        item.get("component_id") or item.get("componentId") or 0
                    ),
                    spatial_map=[
                        float(value)
                        for value in (
                            item.get("spatial_map") or item.get("spatialMap") or []
                        )
                    ],
                    time_series_preview=[
                        float(value)
                        for value in (
                            item.get("time_series_preview")
                            or item.get("timeSeriesPreview")
                            or []
                        )
                    ],
                    kurtosis=float(item.get("kurtosis") or 0.0),
                    non_gaussianity=float(
                        item.get("non_gaussianity") or item.get("nonGaussianity") or 0.0
                    ),
                    variance_explained=float(
                        item.get("variance_explained")
                        or item.get("varianceExplained")
                        or 0.0
                    ),
                    power_frequencies=[
                        float(value)
                        for value in (
                            item.get("power_frequencies")
                            or item.get("powerFrequencies")
                            or []
                        )
                    ],
                    power_values=[
                        float(value)
                        for value in (
                            item.get("power_values") or item.get("powerValues") or []
                        )
                    ],
                )
                for item in (payload.get("components") or [])
                if isinstance(item, dict)
            ],
        )

    def _apply_dda_result(self, result: Optional[DdaResult], *, persist: bool = True) -> None:
        self.state.dda_result = result
        self.state.selected_results_history_id = result.id if result is not None else None
        self.variant_combo.blockSignals(True)
        self.variant_combo.clear()
        self.variant_combo.blockSignals(False)
        self._active_variant_id = None
        if result is None:
            self.dda_diagnostics.setPlainText("")
            self.result_summary.setPlainText("")
            self.heatmap_widget.set_variant(None)
            self.dda_lineplot_widget.set_variant(None)
            self._refresh_results_page()
            self._refresh_batch_results()
            self._refresh_connectivity_sources()
            self._refresh_connectivity_view()
            self._refresh_compare_sources()
            self._refresh_compare_view()
            return
        self._remember_dda_result(result, persist=persist)
        self.dda_diagnostics.setPlainText(
            "\n".join(result.diagnostics or ["Analysis completed without diagnostics."])
        )
        self.variant_combo.blockSignals(True)
        for variant in result.variants:
            self.variant_combo.addItem(f"{variant.id} · {variant.label}", variant.id)
        self.variant_combo.blockSignals(False)
        if result.variants:
            self._active_variant_id = result.variants[0].id
            self.variant_combo.setCurrentIndex(0)
            self._update_variant_view()
        else:
            self.heatmap_widget.set_variant(None)
        self._refresh_results_page()
        self._refresh_batch_results()
        self._refresh_connectivity_sources()
        self._refresh_connectivity_view()
        self._refresh_compare_sources()
        self._refresh_compare_view()

    def _apply_snapshot_restore_to_dataset(self, payload: dict) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        selected_channels = payload.get("selectedChannelNames")
        if isinstance(selected_channels, list):
            dataset_channel_names = set(dataset.channel_names)
            self.state.selected_channel_names = [
                str(name)
                for name in selected_channels
                if isinstance(name, str) and name in dataset_channel_names
            ] or dataset.channel_names[: min(8, len(dataset.channel_names))]
            self._populate_channels()
        viewport = payload.get("viewport")
        if isinstance(viewport, dict):
            try:
                start_seconds = float(
                    viewport.get(
                        "startSeconds", self.state.waveform_viewport_start_seconds
                    )
                )
                duration_seconds = float(
                    viewport.get(
                        "durationSeconds", self.state.waveform_viewport_duration_seconds
                    )
                )
                self.state.waveform_viewport_start_seconds = start_seconds
                self.state.waveform_viewport_duration_seconds = duration_seconds
            except (TypeError, ValueError):
                pass
        self._apply_dda_config_payload(payload.get("ddaConfig"))
        self._update_dataset_ui()
        self._load_waveform_data()
        self._schedule_overview_reload(force=True)
        self._apply_dda_result(self._restore_dda_result(payload.get("ddaResult")))
        self._apply_ica_result(self._restore_ica_result(payload.get("icaResult")))

    def _apply_snapshot_payload(self, payload: dict) -> None:
        self._apply_dda_config_payload(payload.get("ddaConfig"))
        self.state.annotations_by_file = self._restore_annotations_from_payload(
            payload.get("annotationsByFile")
        )
        for file_path, file_annotations in self.state.annotations_by_file.items():
            self.state_db.replace_annotations_for_file(file_path, file_annotations)
        workflow_payload = payload.get("workflow")
        if isinstance(workflow_payload, dict):
            self.state.workflow_actions = self._restore_workflow_actions(
                workflow_payload.get("actions")
            )
            self.state_db.replace_workflow_actions(self.state.workflow_actions)
        dda_result = self._restore_dda_result(payload.get("ddaResult"))
        self._apply_dda_result(dda_result)
        ica_result = self._restore_ica_result(payload.get("icaResult"))
        if ica_result is not None:
            self.state_db.save_ica_result(ica_result)
        self._apply_ica_result(ica_result)
        self._refresh_annotations_table()
        self._update_annotation_scope_label()
        self._apply_annotations_to_views()
        self._refresh_workflow_table()
        self._update_workflow_ui()
        self._schedule_session_save()
        target_file = payload.get("activeFilePath")
        open_files = payload.get("openFiles")
        if isinstance(open_files, list):
            normalized_files: List[str] = []
            seen: set[str] = set()
            for value in open_files:
                if not isinstance(value, str) or not value or value in seen:
                    continue
                if not self._server_url and not Path(value).exists():
                    continue
                normalized_files.append(value)
                seen.add(value)
            if normalized_files:
                self.state.open_files = normalized_files
                with QSignalBlocker(self.file_tabs):
                    while self.file_tabs.count() > 0:
                        self.file_tabs.removeTab(0)
                    for path in normalized_files:
                        self.file_tabs.addTab("")
                        self.file_tabs.setTabData(self.file_tabs.count() - 1, path)
                self._refresh_file_tab_labels()
                self._sync_file_tab_bar()
        if isinstance(target_file, str) and target_file:
            if self._server_url or Path(target_file).exists():
                self._pending_snapshot_restore = payload
                self._open_dataset(target_file)
                return
            self._notify(
                "snapshot",
                "error",
                "Snapshot Source Missing",
                f"Could not reopen {target_file}. Restored exports and annotations only.",
            )
        self._refresh_results_page()

    def _show_error(self, message: str) -> None:
        self._notify("system", "error", "Error", message, show_status=False)
        QMessageBox.critical(self, "DDALAB Qt", message)

    def closeEvent(self, event) -> None:  # type: ignore[override]
        self._stop_streaming()
        self._save_session_state()
        self._task_executor.shutdown(wait=False, cancel_futures=True)
        self.openneuro.close()
        self.backend.close()
        self.state_db.close()
        super().closeEvent(event)

    def moveEvent(self, event) -> None:  # type: ignore[override]
        super().moveEvent(event)
        if hasattr(self, "session_save_timer") and self.isVisible():
            self._schedule_session_save()

    def resizeEvent(self, event) -> None:  # type: ignore[override]
        super().resizeEvent(event)
        if hasattr(self, "session_save_timer") and self.isVisible():
            self._schedule_session_save()

    def changeEvent(self, event) -> None:  # type: ignore[override]
        super().changeEvent(event)
        if (
            hasattr(self, "session_save_timer")
            and event.type() == QEvent.WindowStateChange
            and self.isVisible()
        ):
            self._schedule_session_save()


def _human_bytes(size_bytes: Optional[int]) -> str:
    if not size_bytes:
        return "—"
    value = float(size_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024.0
    return f"{size_bytes} B"


def _mean_absolute(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(abs(float(value)) for value in values) / len(values)


def _build_connectivity_metrics(variant: DdaVariantResult) -> List[dict]:
    metrics: List[dict] = []
    for index, label in enumerate(variant.row_labels):
        row = variant.matrix[index] if index < len(variant.matrix) else []
        if not row:
            continue
        metrics.append(
            {
                "label": label,
                "mean_absolute": _mean_absolute(row),
                "peak_absolute": max(abs(float(value)) for value in row),
            }
        )
    return sorted(metrics, key=lambda item: item["mean_absolute"], reverse=True)


def _row_mean_abs_map(variant: DdaVariantResult) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for index, label in enumerate(variant.row_labels):
        row = variant.matrix[index] if index < len(variant.matrix) else []
        values[label] = _mean_absolute(row)
    return values


def _build_variant_comparisons(baseline: DdaResult, target: DdaResult) -> List[dict]:
    baseline_by_id = {variant.id: variant for variant in baseline.variants}
    target_by_id = {variant.id: variant for variant in target.variants}
    comparisons: List[dict] = []
    for variant_id in sorted(set(baseline_by_id) & set(target_by_id)):
        baseline_variant = baseline_by_id[variant_id]
        target_variant = target_by_id[variant_id]
        baseline_rows = _row_mean_abs_map(baseline_variant)
        target_rows = _row_mean_abs_map(target_variant)
        shared_rows = set(baseline_rows) & set(target_rows)
        top_changed_row = None
        if shared_rows:
            top_changed_row = max(
                shared_rows,
                key=lambda label: abs(target_rows[label] - baseline_rows[label]),
            )
        baseline_mean = _mean_absolute(
            [value for row in baseline_variant.matrix for value in row]
        )
        target_mean = _mean_absolute(
            [value for row in target_variant.matrix for value in row]
        )
        comparisons.append(
            {
                "variant_id": variant_id,
                "baseline_mean_abs": baseline_mean,
                "target_mean_abs": target_mean,
                "delta": target_mean - baseline_mean,
                "top_changed_row": top_changed_row,
            }
        )
    return comparisons
