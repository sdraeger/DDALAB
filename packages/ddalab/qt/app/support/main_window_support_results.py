from __future__ import annotations

from datetime import datetime, timezone
import uuid
from typing import Callable, Dict, Optional

from PySide6.QtCore import (
    QSignalBlocker,
    Qt,
    QTimer,
)
from PySide6.QtWidgets import (
    QTableWidgetItem,
)

from ...domain.models import (
    DdaResult,
    DdaResultSummary,
    IcaResult,
    NotificationEntry,
    WorkflowActionEntry,
)
from ...persistence.state_db import StateDatabase


class MainWindowSupportResultsMixin:
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
        status = "Logging" if self.state.workflow_recording_enabled else "Idle"
        action_count = len(self.state.workflow_actions)
        self.workflow_status_label.setText(
            f"{status} • {action_count} logged action{'s' if action_count != 1 else ''}"
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
            item for item in self.state.dda_history_summaries if item.id != summary.id
        ]
        self.state.dda_history_summaries.sort(
            key=lambda item: item.created_at_iso, reverse=True
        )
        self.state.dda_history_summaries = self.state.dda_history_summaries[:30]

    def _remember_dda_result(self, result: DdaResult, *, persist: bool = True) -> None:
        self._cache_dda_result(result)
        self._upsert_dda_history_summary(self._dda_result_to_summary(result))
        if persist:
            self._persist_dda_result_async(result)

    def _persist_dda_result_async(self, result: DdaResult) -> None:
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                temp_db.save_dda_result(result)
            finally:
                temp_db.close()
            return None

        self._run_task(
            task,
            lambda _result: None,
            lambda message: self.status_bar.showMessage(
                f"Could not persist DDA result: {message}",
                5000,
            ),
        )

    def _load_dda_result_from_history_async(
        self,
        result_id: Optional[str],
        on_success: Callable[[Optional[DdaResult]], None],
    ) -> None:
        if not result_id:
            on_success(None)
            return
        cached = self._cached_history_result(result_id)
        if cached is not None and cached.id == result_id:
            on_success(cached)
            return
        pending_callbacks = self._pending_dda_result_load_callbacks.get(result_id)
        if pending_callbacks is not None:
            pending_callbacks.append(on_success)
            return
        self._pending_dda_result_load_callbacks[result_id] = [on_success]
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                return temp_db.load_dda_result_by_id(result_id)
            finally:
                temp_db.close()

        def handle_success(result: object) -> None:
            callbacks = self._pending_dda_result_load_callbacks.pop(result_id, [])
            loaded = result if isinstance(result, DdaResult) else None
            if loaded is not None:
                self._cache_dda_result(loaded)
            for callback in callbacks:
                callback(loaded)

        def handle_error(message: str) -> None:
            callbacks = self._pending_dda_result_load_callbacks.pop(result_id, [])
            self.status_bar.showMessage(f"Saved DDA load failed: {message}", 5000)
            for callback in callbacks:
                callback(None)

        self._run_task(task, handle_success, handle_error)

    def _load_latest_ica_result_async(
        self,
        file_path: str,
        on_success: Callable[[Optional[IcaResult]], None],
    ) -> None:
        if self._pending_ica_result_load_file_path == file_path:
            return
        self._pending_ica_result_load_file_path = file_path
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                return temp_db.load_latest_ica_result(file_path)
            finally:
                temp_db.close()

        def handle_success(result: object) -> None:
            if self._pending_ica_result_load_file_path == file_path:
                self._pending_ica_result_load_file_path = None
            on_success(result if isinstance(result, IcaResult) else None)

        def handle_error(message: str) -> None:
            if self._pending_ica_result_load_file_path == file_path:
                self._pending_ica_result_load_file_path = None
            self.status_bar.showMessage(f"Saved ICA load failed: {message}", 5000)
            on_success(None)

        self._run_task(task, handle_success, handle_error)

    def _selected_history_summary(self) -> Optional[DdaResultSummary]:
        target_id = self.state.selected_results_history_id
        if target_id:
            for summary in self.state.dda_history_summaries:
                if summary.id == target_id:
                    return summary
        if self.state.dda_result is not None:
            return self._dda_result_to_summary(self.state.dda_result)
        if self.state.dda_history_summaries:
            return self.state.dda_history_summaries[0]
        return None

    def _cached_history_result(
        self, result_id: Optional[str] = None
    ) -> Optional[DdaResult]:
        target_id = result_id or self.state.selected_results_history_id
        if (
            target_id
            and self.state.dda_result is not None
            and self.state.dda_result.id == target_id
        ):
            return self.state.dda_result
        if target_id:
            for result in self.state.dda_history:
                if result.id == target_id:
                    return result
        if self.state.dda_result is not None:
            return self.state.dda_result
        if self.state.dda_history:
            return self.state.dda_history[0]
        return None

    def _schedule_deferred_startup_dda_render(
        self,
        expected_result_id: Optional[str],
        *,
        delay_ms: int = 280,
    ) -> None:
        restore_serial = self._startup_analysis_restore_serial

        def render_when_idle() -> None:
            if restore_serial != self._startup_analysis_restore_serial:
                return
            if self._current_primary_section() != "Run DDA":
                return
            if self._current_secondary_section() != "DDA":
                return
            result = self.state.dda_result
            if result is None:
                return
            if expected_result_id and result.id != expected_result_id:
                return
            self._update_variant_view()

        QTimer.singleShot(max(int(delay_ms), 0), render_when_idle)

    def _ensure_cached_dda_result_loaded(
        self,
        *,
        defer_view_render: bool = False,
        refresh_auxiliary_views: bool = True,
    ) -> None:
        if self.state.dda_result is not None:
            if (
                self._current_primary_section() == "Run DDA"
                and self._current_secondary_section() == "DDA"
            ):
                if defer_view_render:
                    self._schedule_deferred_startup_dda_render(self.state.dda_result.id)
                else:
                    self._update_variant_view()
            return
        target_id = self.state.selected_results_history_id
        if not target_id and self.state.dda_history_summaries:
            target_id = self.state.dda_history_summaries[0].id
        if not target_id:
            return
        cached = self._cached_history_result(target_id)
        if cached is not None and cached.id == target_id:
            self._apply_dda_result(
                cached,
                persist=False,
                render_variant_view=not defer_view_render,
                refresh_auxiliary_views=refresh_auxiliary_views,
            )
            if defer_view_render:
                self._schedule_deferred_startup_dda_render(cached.id)
            return
        if hasattr(self, "dda_diagnostics"):
            self.dda_diagnostics.setPlainText("Loading saved DDA result…")
        if hasattr(self, "result_summary"):
            self.result_summary.setPlainText("Loading saved DDA result…")

        def on_success(result: Optional[DdaResult]) -> None:
            if result is None:
                return
            if (
                self.state.selected_results_history_id
                and self.state.selected_results_history_id != result.id
            ):
                return
            if (
                self._current_primary_section() == "Run DDA"
                and self._current_secondary_section() == "DDA"
            ):
                self._apply_dda_result(
                    result,
                    persist=False,
                    render_variant_view=not defer_view_render,
                    refresh_auxiliary_views=refresh_auxiliary_views,
                )
                if defer_view_render:
                    self._schedule_deferred_startup_dda_render(result.id)

        self._load_dda_result_from_history_async(target_id, on_success)

    def _ensure_cached_ica_result_loaded(self) -> None:
        if self.state.ica_result is not None:
            return
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        if hasattr(self, "ica_diagnostics"):
            self.ica_diagnostics.setPlainText("Loading saved ICA result…")

        def on_success(result: Optional[IcaResult]) -> None:
            if result is None:
                return
            current_dataset = self.state.selected_dataset
            if (
                current_dataset is None
                or current_dataset.file_path != dataset.file_path
            ):
                return
            if (
                self._current_primary_section() == "Run DDA"
                and self._current_secondary_section() == "ICA"
            ):
                self._apply_ica_result(result, persist=False)

        self._load_latest_ica_result_async(dataset.file_path, on_success)

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
            cached = self._cached_history_result(target_id)
            if cached is not None and cached.id == target_id:
                return cached
            return None
        if self.state.dda_result is not None:
            return self.state.dda_result
        if self.state.dda_history:
            return self.state.dda_history[0]
        return None

    def _refresh_visible_analysis_subviews(self) -> None:
        current_primary = self._current_primary_section()
        current_secondary = self._current_secondary_section()
        if current_primary != "Run DDA":
            return
        if current_secondary == "Batch":
            self._refresh_batch_candidates()
            self._refresh_batch_results()
        elif current_secondary == "Connectivity":
            self._refresh_connectivity_sources()
            self._refresh_connectivity_view()
        elif current_secondary == "Compare":
            self._refresh_compare_sources()
            self._refresh_compare_view()

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
            if isinstance(self.state.selected_results_history_id, str):
                self._load_dda_result_from_history_async(
                    self.state.selected_results_history_id,
                    lambda _result: None,
                )
        self._refresh_results_details()

    def _view_selected_history_result(self, *_args) -> None:
        target_id = self.state.selected_results_history_id
        if not target_id and self.state.dda_history_summaries:
            target_id = self.state.dda_history_summaries[0].id
        if not target_id:
            return
        cached = self._cached_history_result(target_id)
        if cached is not None and cached.id == target_id:
            self.state.selected_results_history_id = cached.id
            self._apply_dda_result(cached, persist=False)
            if "Run DDA" in self.primary_sections:
                dda_index = self.primary_sections.index("Run DDA")
                self._switch_primary_section(dda_index)
            return
        self.status_bar.showMessage("Loading saved DDA result…", 3000)

        def on_success(result: Optional[DdaResult]) -> None:
            if result is None:
                self.status_bar.showMessage("Saved DDA result is unavailable.", 5000)
                return
            current_target_id = self.state.selected_results_history_id
            if current_target_id and current_target_id != result.id:
                return
            self.state.selected_results_history_id = result.id
            self._apply_dda_result(result, persist=False)
            if "Run DDA" in self.primary_sections:
                dda_index = self.primary_sections.index("Run DDA")
                self._switch_primary_section(dda_index)

        self._load_dda_result_from_history_async(target_id, on_success)

    def _refresh_results_details(self) -> None:
        dataset = self.state.selected_dataset
        result_summary = self._selected_history_summary()
        ica_result = self.state.ica_result
        annotation_count = (
            len(self._current_annotations()) if self.state.active_file_path else 0
        )
        if dataset is None and result_summary is None and ica_result is None:
            self.results_summary_label.setText(
                "Run DDA or import a DDALAB snapshot file."
            )
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
            if result_summary is not None:
                lines.extend(
                    [
                        f"Result ID: {result_summary.id}",
                        f"Engine: {result_summary.engine_label}",
                        f"Created: {result_summary.created_at_iso}",
                        f"Variants: {', '.join(result_summary.variant_ids)}",
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
                "Current file state, DDA output, and DDALAB snapshot exports."
            )
            self.results_details.setPlainText("\n".join(lines))
        has_result = result_summary is not None
        has_dataset = dataset is not None
        has_exportable_state = has_dataset or has_result or ica_result is not None
        for widget_name in (
            "view_history_result_button",
            "dda_view_history_result_button",
        ):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.setEnabled(has_result)
        for widget_name in ("snapshot_export_button", "dda_snapshot_export_button"):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.setEnabled(has_exportable_state)
        results_more_exports = getattr(self, "data_export_button", None)
        if results_more_exports is not None:
            results_more_exports.setEnabled(
                has_exportable_state or annotation_count > 0
            )
        dda_more_exports = getattr(self, "dda_data_export_button", None)
        if dda_more_exports is not None:
            dda_more_exports.setEnabled(has_exportable_state)
        import_buttons = [
            getattr(self, widget_name, None)
            for widget_name in ("import_snapshot_button", "dda_import_snapshot_button")
        ]
        for button in import_buttons:
            if button is not None:
                button.setEnabled(True)

        result_action_keys = (
            "result_json",
            "selected_csv",
            "all_csv",
            "python_script",
            "matlab_script",
            "julia_script",
            "rust_source",
            "heatmap_png",
            "heatmap_svg",
            "heatmap_pdf",
            "lineplot_png",
            "lineplot_svg",
            "lineplot_pdf",
        )

        def set_action_state(
            actions_attr: str, keys: tuple[str, ...], enabled: bool
        ) -> None:
            actions = getattr(self, actions_attr, None)
            if not isinstance(actions, dict):
                return
            for key in keys:
                action = actions.get(key)
                if action is not None:
                    action.setEnabled(enabled)

        set_action_state(
            "results_more_export_actions", ("recipe_ddalab",), has_exportable_state
        )
        set_action_state(
            "dda_more_export_actions", ("recipe_ddalab",), has_exportable_state
        )
        set_action_state("results_more_export_actions", result_action_keys, has_result)
        set_action_state("dda_more_export_actions", result_action_keys, has_result)
        set_action_state(
            "results_more_export_actions",
            ("annotations",),
            has_dataset and annotation_count > 0,
        )
