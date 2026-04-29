from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from typing import Callable, List, Optional
import uuid
import webbrowser

from PySide6.QtCore import QMarginsF, Qt
from PySide6.QtGui import QPageLayout, QPageSize, QPainter, QPdfWriter
from PySide6.QtSvg import QSvgGenerator
from PySide6.QtWidgets import QFileDialog, QTableWidget, QTableWidgetItem

from ..backend.api import LocalBackendClient, RemoteBackendClient
from ..domain.models import (
    DdaResult,
    NsgJobSnapshot,
    OpenNeuroDataset,
    WorkflowSessionEntry,
)
from .dda_export_utils import (
    default_result_base_name,
    export_all_variants_csv,
    export_result_json,
    export_variant_csv,
    find_variant,
    generate_julia_script,
    generate_matlab_script,
    generate_python_script,
    generate_rust_source,
)
from .main_window_support import _human_bytes
from ..ui.widgets.text_export_dialog import TextExportDialog


class MainWindowIntegrationsMixin:
    def _with_export_target_result(
        self,
        on_ready: Callable[[DdaResult], None],
        *,
        unavailable_message: str,
    ) -> None:
        cached = self._selected_history_result()
        if cached is not None:
            on_ready(cached)
            return
        target_id = self.state.selected_results_history_id
        if not target_id and self.state.dda_history_summaries:
            target_id = self.state.dda_history_summaries[0].id
        if not target_id:
            self._show_error(unavailable_message)
            return
        self.status_bar.showMessage("Loading saved DDA result…", 3000)

        def handle_loaded(result: Optional[DdaResult]) -> None:
            if result is None:
                self._show_error(unavailable_message)
                return
            current_target_id = self.state.selected_results_history_id
            if current_target_id and current_target_id != result.id:
                return
            on_ready(result)

        self._load_dda_result_from_history_async(target_id, handle_loaded)

    def _preview_text_export(
        self,
        *,
        title: str,
        heading: str,
        content: str,
        default_path: Path,
        file_filter: str,
        success_title: str,
        workflow_action_type: Optional[str] = None,
        workflow_description: Optional[str] = None,
        workflow_payload: Optional[dict] = None,
        file_path: Optional[str] = None,
    ) -> None:
        dialog = TextExportDialog(
            parent=self,
            title=title,
            heading=heading,
            content=content,
            default_path=default_path,
            file_filter=file_filter,
        )
        dialog.exec()
        saved_path = dialog.saved_path
        if saved_path is None:
            return
        if workflow_action_type and workflow_description:
            payload = dict(workflow_payload or {})
            payload["path"] = str(saved_path)
            self._record_workflow_action(
                workflow_action_type,
                workflow_description,
                payload,
                file_path=file_path,
            )
        self._notify("export", "info", success_title, saved_path.name)
        self.status_bar.showMessage(f"{success_title}: {saved_path.name}", 4000)

    def _run_background_file_export(
        self,
        *,
        target_path: str,
        task: Callable[[Path], None],
        pending_message: str,
        success_title: str,
        failure_title: str,
        workflow_action_type: Optional[str] = None,
        workflow_description: Optional[str] = None,
        workflow_payload: Optional[dict] = None,
        file_path: Optional[str] = None,
    ) -> None:
        target = Path(target_path)
        self.status_bar.showMessage(pending_message, 3000)

        def runner() -> object:
            task(target)
            return target

        def on_success(result: object) -> None:
            path = result if isinstance(result, Path) else target
            if workflow_action_type and workflow_description:
                self._record_workflow_action(
                    workflow_action_type,
                    workflow_description,
                    workflow_payload or {"path": str(path)},
                    file_path=file_path,
                )
            self._notify("export", "info", success_title, path.name)
            self.status_bar.showMessage(f"{success_title}: {path.name}", 4000)

        def on_error(message: str) -> None:
            self._notify("export", "error", failure_title, message)
            self.status_bar.showMessage(f"{failure_title}: {message}", 5000)

        self._run_task(runner, on_success, on_error)

    def _load_json_payload_async(
        self,
        *,
        source_path: str,
        pending_message: str,
        success_title: str,
        failure_title: str,
        invalid_message: str,
        on_payload: Callable[[dict], None],
    ) -> None:
        source = Path(source_path)
        self.status_bar.showMessage(pending_message, 3000)

        def runner() -> object:
            try:
                payload = json.loads(source.read_text(encoding="utf-8"))
            except (OSError, ValueError, TypeError) as exc:
                raise RuntimeError(str(exc)) from exc
            if not isinstance(payload, dict):
                raise RuntimeError(invalid_message)
            return payload

        def on_success(result: object) -> None:
            payload = result if isinstance(result, dict) else {}
            on_payload(payload)
            self.status_bar.showMessage(f"{success_title}: {source.name}", 4000)

        def on_error(message: str) -> None:
            self._notify("import", "error", failure_title, message)
            self.status_bar.showMessage(f"{failure_title}: {message}", 5000)

        self._run_task(runner, on_success, on_error)

    def _update_backend_mode_ui(self) -> None:
        if not hasattr(self, "backend_mode_label"):
            return
        if self._server_url:
            self.backend_mode_label.setText(
                f"Remote backend connected: {self._server_url}\n"
                "Remote mode is optional and intended for shared or institutional deployments."
            )
            self.use_local_bridge_button.setEnabled(True)
        else:
            self.backend_mode_label.setText(
                "Local Python backend active.\n"
                "This is the default and recommended mode for running DDALAB on your own device."
            )
            self.use_local_bridge_button.setEnabled(False)
        self._refresh_settings_overview()

    def _backend_supports_nsg(self) -> bool:
        return bool(getattr(self.backend, "supports_nsg", lambda: False)())

    def _backend_supports_nsg_submission(self) -> bool:
        return bool(
            getattr(self.backend, "supports_nsg_submission", lambda: False)()
        )

    def _restore_table_selection(
        self,
        table: QTableWidget,
        target_id: Optional[str],
    ) -> None:
        if not target_id:
            return
        for row in range(table.rowCount()):
            item = table.item(row, 0)
            if item is not None and item.data(Qt.UserRole) == target_id:
                table.selectRow(row)
                break

    def _selected_nsg_job(self) -> Optional[NsgJobSnapshot]:
        if not hasattr(self, "nsg_jobs_table"):
            return None
        selected_rows = self.nsg_jobs_table.selectionModel().selectedRows()
        if not selected_rows:
            return None
        item = self.nsg_jobs_table.item(selected_rows[0].row(), 0)
        job_id = item.data(Qt.UserRole) if item is not None else None
        return next(
            (entry for entry in self.state.nsg_jobs if entry.job_id == job_id), None
        )

    def _refresh_nsg_state(self) -> None:
        if not hasattr(self, "nsg_status_label"):
            return
        if not self._backend_supports_nsg():
            self.state.nsg_credentials = None
            self.state.nsg_jobs = []
            self.nsg_status_label.setText(
                "NSG integration is not yet available in the Python-only desktop build."
            )
            self.nsg_jobs_table.setRowCount(0)
            self.nsg_job_details.setPlainText("")
            self._update_nsg_panels()
            return
        self.nsg_status_label.setText("Refreshing NSG credentials and jobs…")

        def task() -> object:
            return {
                "credentials": self.backend.get_nsg_credentials_status(),
                "jobs": self.backend.list_nsg_jobs(),
            }

        def on_success(result: object) -> None:
            payload = result if isinstance(result, dict) else {}
            self.state.nsg_credentials = payload.get("credentials")
            self.state.nsg_jobs = list(payload.get("jobs") or [])
            self._refresh_nsg_jobs_table()
            self._update_nsg_panels()

        def on_error(message: str) -> None:
            self.nsg_status_label.setText("NSG refresh failed")
            self.nsg_job_details.setPlainText(message)
            self._notify("nsg", "error", "NSG Refresh Failed", message)

        self._run_task(task, on_success, on_error)

    def _refresh_nsg_jobs_table(self) -> None:
        if not hasattr(self, "nsg_jobs_table"):
            return
        selected_job = self._selected_nsg_job()
        self.nsg_jobs_table.setRowCount(len(self.state.nsg_jobs))
        for row, job in enumerate(self.state.nsg_jobs):
            values = [
                job.job_id[:8],
                job.nsg_job_id or "—",
                job.status,
                job.tool,
                f"{job.progress}%" if job.progress is not None else "—",
                job.created_at,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                if column == 0:
                    item.setData(Qt.UserRole, job.job_id)
                    item.setToolTip(job.input_file_path)
                self.nsg_jobs_table.setItem(row, column, item)
        self.nsg_jobs_table.resizeColumnsToContents()
        self._restore_table_selection(
            self.nsg_jobs_table,
            selected_job.job_id if selected_job else None,
        )

    def _update_nsg_panels(self) -> None:
        if not hasattr(self, "nsg_status_label"):
            return
        creds = self.state.nsg_credentials
        if creds is not None:
            self.nsg_username_edit.setText(creds.username)
            self.nsg_password_edit.clear()
            self.nsg_app_key_edit.clear()
        elif hasattr(self, "nsg_username_edit"):
            self.nsg_username_edit.clear()
            self.nsg_password_edit.clear()
            self.nsg_app_key_edit.clear()
        selected_job = self._selected_nsg_job()
        if selected_job is None and creds is None:
            self.nsg_job_details.setPlainText(
                "Save your NSG username, password, and app key in Settings, then refresh to load jobs from your NSG account."
            )
        elif selected_job is None:
            self.nsg_job_details.setPlainText(
                "Select an NSG job to inspect its details."
            )
        else:
            lines = [
                f"Job ID: {selected_job.job_id}",
                f"NSG ID: {selected_job.nsg_job_id or '—'}",
                f"Status: {selected_job.status}",
                f"Tool: {selected_job.tool}",
                f"Created: {selected_job.created_at}",
                f"Submitted: {selected_job.submitted_at or '—'}",
                f"Completed: {selected_job.completed_at or '—'}",
                f"Input: {selected_job.input_file_path}",
                f"Progress: {selected_job.progress if selected_job.progress is not None else '—'}",
            ]
            if selected_job.output_files:
                lines.extend(["", "Outputs:", *selected_job.output_files])
            if selected_job.error_message:
                lines.extend(["", f"Error: {selected_job.error_message}"])
            self.nsg_job_details.setPlainText("\n".join(lines))
        nsg_enabled = self._backend_supports_nsg()
        submission_enabled = self._backend_supports_nsg_submission()
        has_credentials = creds is not None
        selected_status = (
            str(selected_job.status).strip().lower() if selected_job is not None else ""
        )
        selected_is_external = (
            bool(selected_job.job_id.startswith("external_"))
            if selected_job is not None
            else False
        )
        creds_summary = (
            f"{creds.username} • "
            f"{'password saved' if creds.has_password else 'no password'} • "
            f"{'app key saved' if creds.has_app_key else 'no app key'}"
            if creds
            else "Authenticate with your NSG credentials in Settings to load jobs"
        )
        self.nsg_status_label.setText(
            f"{creds_summary} • {len(self.state.nsg_jobs)} job{'s' if len(self.state.nsg_jobs) != 1 else ''}"
        )
        self.nsg_save_credentials_button.setEnabled(nsg_enabled)
        self.nsg_delete_credentials_button.setEnabled(
            nsg_enabled and creds is not None
        )
        self.nsg_test_connection_button.setEnabled(nsg_enabled and has_credentials)
        self.nsg_create_job_button.setEnabled(
            nsg_enabled
            and has_credentials
            and submission_enabled
            and self.state.selected_dataset is not None
        )
        self.nsg_refresh_jobs_button.setEnabled(nsg_enabled and has_credentials)
        self.nsg_submit_job_button.setEnabled(
            nsg_enabled
            and has_credentials
            and submission_enabled
            and selected_job is not None
            and not selected_is_external
            and selected_status == "pending"
        )
        self.nsg_refresh_job_button.setEnabled(
            nsg_enabled and has_credentials and selected_job is not None
        )
        self.nsg_cancel_job_button.setEnabled(
            nsg_enabled
            and has_credentials
            and selected_job is not None
            and selected_status in {"submitted", "queue", "inputstaging", "running"}
        )
        self.nsg_download_results_button.setEnabled(
            nsg_enabled
            and has_credentials
            and selected_job is not None
            and selected_status == "completed"
        )

    def _save_nsg_credentials(self) -> None:
        username = self.nsg_username_edit.text().strip()
        password = self.nsg_password_edit.text()
        app_key = self.nsg_app_key_edit.text()
        if not username or not password or not app_key:
            self._show_error("Username, password, and app key are all required.")
            return

        def on_success(result: object) -> None:
            _ = result
            self._refresh_nsg_state()
            self._record_workflow_action(
                "nsg-save-credentials",
                f"Updated NSG credentials for {username}",
                {"username": username},
            )
            self._notify("nsg", "info", "NSG Credentials Saved", username)

        self._run_task(
            lambda: self.backend.save_nsg_credentials(username, password, app_key),
            on_success,
        )

    def _delete_nsg_credentials(self) -> None:
        def on_success(result: object) -> None:
            _ = result
            self.state.nsg_credentials = None
            self.nsg_username_edit.clear()
            self.nsg_password_edit.clear()
            self.nsg_app_key_edit.clear()
            self._refresh_nsg_state()
            self._record_workflow_action(
                "nsg-delete-credentials",
                "Deleted NSG credentials",
            )
            self._notify(
                "nsg", "info", "NSG Credentials Deleted", "Saved credentials removed"
            )

        self._run_task(self.backend.delete_nsg_credentials, on_success)

    def _test_nsg_connection(self) -> None:
        def on_success(result: object) -> None:
            connected = bool(result)
            self._notify(
                "nsg",
                "info" if connected else "warning",
                "NSG Connection",
                "Connection succeeded" if connected else "Connection failed",
            )

        self._run_task(self.backend.test_nsg_connection, on_success)

    def _create_nsg_job(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            self._show_error("Open a dataset before creating an NSG job.")
            return
        selected_indices = self._selected_channel_indices(dataset)
        if not selected_indices:
            self._show_error("Select at least one channel before creating an NSG job.")
            return
        variant_ids = [
            key
            for key, checkbox in self.variant_checkboxes.items()
            if checkbox.isChecked()
        ]
        if not variant_ids:
            self._show_error(
                "Select at least one DDA variant before creating an NSG job."
            )
            return
        delays = [
            int(token.strip())
            for token in self.delays_edit.text().split(",")
            if token.strip()
        ]
        start = float(self.dda_start_edit.text() or "0")
        end_text = self.dda_end_edit.text().strip()
        end = float(end_text) if end_text else None
        window_length_samples = self.window_length_spin.value()
        window_step_samples = self.window_step_spin.value()
        runtime_hours = float(self.nsg_runtime_hours_spin.value())
        cores = int(self.nsg_cores_spin.value())
        nodes = int(self.nsg_nodes_spin.value())

        def on_success(result: object) -> None:
            job = result
            self.state.nsg_jobs = [job] + [
                existing
                for existing in self.state.nsg_jobs
                if existing.job_id != job.job_id
            ]
            self._refresh_nsg_jobs_table()
            self._update_nsg_panels()
            self._record_workflow_action(
                "nsg-create-job",
                f"Created NSG job for {dataset.file_name}",
                {"jobId": job.job_id, "variants": ",".join(variant_ids)},
                file_path=dataset.file_path,
            )
            self._notify("nsg", "info", "NSG Job Created", job.job_id[:8])

        self._run_task(
            lambda: self.backend.create_nsg_job(
                dataset=dataset,
                selected_channel_indices=selected_indices,
                selected_variants=variant_ids,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
                start_time_seconds=start,
                end_time_seconds=end,
                runtime_hours=runtime_hours,
                cores=cores,
                nodes=nodes,
            ),
            on_success,
        )

    def _submit_selected_nsg_job(self) -> None:
        job = self._selected_nsg_job()
        if job is None:
            self._show_error("Select an NSG job to submit.")
            return

        def on_success(result: object) -> None:
            updated_job = result
            self.state.nsg_jobs = [
                updated_job if entry.job_id == updated_job.job_id else entry
                for entry in self.state.nsg_jobs
            ]
            self._refresh_nsg_jobs_table()
            self._update_nsg_panels()
            self._record_workflow_action(
                "nsg-submit-job",
                f"Submitted NSG job {job.job_id[:8]}",
                {"jobId": job.job_id},
            )
            self._notify("nsg", "info", "NSG Job Submitted", job.job_id[:8])

        self._run_task(lambda: self.backend.submit_nsg_job(job.job_id), on_success)

    def _refresh_selected_nsg_job(self) -> None:
        job = self._selected_nsg_job()
        if job is None:
            self._show_error("Select an NSG job to refresh.")
            return

        def on_success(result: object) -> None:
            refreshed_job = result
            self.state.nsg_jobs = [
                refreshed_job if entry.job_id == refreshed_job.job_id else entry
                for entry in self.state.nsg_jobs
            ]
            self._refresh_nsg_jobs_table()
            self._update_nsg_panels()
            self._notify("nsg", "info", "NSG Job Refreshed", job.job_id[:8])

        self._run_task(lambda: self.backend.refresh_nsg_job(job.job_id), on_success)

    def _cancel_selected_nsg_job(self) -> None:
        job = self._selected_nsg_job()
        if job is None:
            self._show_error("Select an NSG job to cancel.")
            return

        def on_success(result: object) -> None:
            _ = result
            self._refresh_nsg_state()
            self._record_workflow_action(
                "nsg-cancel-job",
                f"Cancelled NSG job {job.job_id[:8]}",
                {"jobId": job.job_id},
            )
            self._notify("nsg", "warning", "NSG Job Cancelled", job.job_id[:8])

        self._run_task(lambda: self.backend.cancel_nsg_job(job.job_id), on_success)

    def _download_selected_nsg_results(self) -> None:
        job = self._selected_nsg_job()
        if job is None:
            self._show_error("Select an NSG job first.")
            return

        def on_success(result: object) -> None:
            paths = list(result) if isinstance(result, list) else []
            self.nsg_job_details.setPlainText(
                "\n".join(
                    [
                        f"Downloaded {len(paths)} result file(s)",
                        "",
                        *paths,
                    ]
                )
            )
            self._record_workflow_action(
                "nsg-download-results",
                f"Downloaded results for NSG job {job.job_id[:8]}",
                {"jobId": job.job_id, "count": str(len(paths))},
            )
            self._notify(
                "nsg",
                "info",
                "NSG Results Downloaded",
                f"{len(paths)} file(s) downloaded",
            )

        self._run_task(
            lambda: self.backend.download_nsg_results(job.job_id), on_success
        )

    def _load_openneuro(self, append: bool = False) -> None:
        if append and not self._openneuro_has_more:
            self.status_bar.showMessage("No more OpenNeuro datasets to load.", 3000)
            return
        self.status_bar.showMessage(
            "Loading more OpenNeuro datasets…" if append else "Loading OpenNeuro datasets…",
            3000,
        )

        def on_success(result: object) -> None:
            datasets, end_cursor, has_more = result
            if append:
                merged = list(self.openneuro_datasets)
                seen = {item.dataset_id for item in merged}
                for dataset in datasets:
                    if dataset.dataset_id not in seen:
                        merged.append(dataset)
                        seen.add(dataset.dataset_id)
                self.openneuro_datasets = merged
            else:
                self.openneuro_datasets = datasets
            self._openneuro_end_cursor = end_cursor
            self._openneuro_has_more = has_more
            self._populate_openneuro_table(self.openneuro_datasets)

        self._run_task(
            lambda: self.openneuro.list_datasets(
                limit=50,
                after=self._openneuro_end_cursor if append else None,
            ),
            on_success,
            lambda message: self.status_bar.showMessage(
                f"OpenNeuro load failed: {message}", 5000
            ),
        )

    def _populate_openneuro_table(self, datasets: List[OpenNeuroDataset]) -> None:
        self.openneuro_table.setRowCount(len(datasets))
        for row, dataset in enumerate(datasets):
            values = [
                dataset.dataset_id,
                str(dataset.subjects or "—"),
                ", ".join(dataset.modalities[:3]) or "—",
                _human_bytes(dataset.size_bytes),
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                item.setData(Qt.UserRole, dataset.dataset_id)
                self.openneuro_table.setItem(row, column, item)
        self.openneuro_table.resizeColumnsToContents()
        self._filter_openneuro_table(self.openneuro_search.text())
        self._update_openneuro_actions()

    def _filter_openneuro_table(self, text: str) -> None:
        needle = text.strip().lower()
        for row, dataset in enumerate(self.openneuro_datasets):
            haystack = " ".join(
                [
                    dataset.dataset_id,
                    dataset.name,
                    " ".join(dataset.modalities),
                    " ".join(dataset.tasks),
                ]
            ).lower()
            self.openneuro_table.setRowHidden(
                row, bool(needle) and needle not in haystack
            )

    def _update_openneuro_details(self) -> None:
        selected = self.openneuro_table.selectedItems()
        if not selected:
            self.openneuro_details.setPlainText("")
            self._update_openneuro_actions()
            return
        dataset_id = selected[0].data(Qt.UserRole)
        dataset = next(
            (item for item in self.openneuro_datasets if item.dataset_id == dataset_id),
            None,
        )
        if not dataset:
            self._update_openneuro_actions()
            return
        self.openneuro_details.setPlainText(
            f"{dataset.dataset_id}\n"
            f"Name: {dataset.name}\n"
            f"Snapshot: {dataset.snapshot_tag or '—'}\n"
            f"Created: {dataset.created_at_iso or '—'}\n"
            f"Subjects: {dataset.subjects or '—'}\n"
            f"Modalities: {', '.join(dataset.modalities) or '—'}\n"
            f"Tasks: {', '.join(dataset.tasks) or '—'}\n"
            f"Files: {dataset.total_files or '—'}\n"
            f"Size: {_human_bytes(dataset.size_bytes)}"
        )
        self._update_openneuro_actions()

    def _update_openneuro_actions(self) -> None:
        selected_dataset = self._selected_openneuro_dataset()
        self.openneuro_load_more_button.setEnabled(self._openneuro_has_more)
        self.openneuro_open_button.setEnabled(selected_dataset is not None)
        self.openneuro_copy_id_button.setEnabled(selected_dataset is not None)

    def _selected_openneuro_dataset(self) -> Optional[OpenNeuroDataset]:
        selected = self.openneuro_table.selectedItems()
        if not selected:
            return None
        dataset_id = selected[0].data(Qt.UserRole)
        return next(
            (item for item in self.openneuro_datasets if item.dataset_id == dataset_id),
            None,
        )

    def _load_more_openneuro(self) -> None:
        self._load_openneuro(append=True)

    def _open_selected_openneuro_dataset_page(self) -> None:
        dataset = self._selected_openneuro_dataset()
        if dataset is None:
            self._show_error("Select an OpenNeuro dataset first.")
            return
        webbrowser.open(f"https://openneuro.org/datasets/{dataset.dataset_id}")
        self.status_bar.showMessage(
            f"Opened OpenNeuro page for {dataset.dataset_id}",
            3000,
        )

    def _copy_selected_openneuro_dataset_id(self) -> None:
        dataset = self._selected_openneuro_dataset()
        if dataset is None:
            self._show_error("Select an OpenNeuro dataset first.")
            return
        self._copy_text_to_clipboard(
            dataset.dataset_id,
            f"Copied {dataset.dataset_id}",
        )

    def _export_target_result(self) -> Optional[DdaResult]:
        selected_result = self._selected_history_result()
        if selected_result is not None:
            return selected_result
        if self.state.selected_results_history_id:
            return None
        return self.state.dda_result

    def _export_target_variant_id(self, result: DdaResult) -> Optional[str]:
        if self.state.dda_result is not None and self.state.dda_result.id == result.id:
            return self._active_variant_id
        variant = find_variant(result)
        return variant.id if variant is not None else None

    def _export_result_json(self) -> None:
        def continue_export(result: DdaResult) -> None:
            default_name = f"{default_result_base_name(result)}-result.json"
            target_path, _ = QFileDialog.getSaveFileName(
                self,
                "Export DDA Result",
                str(Path.home() / default_name),
                "JSON Files (*.json)",
            )
            if not target_path:
                return
            self._run_background_file_export(
                target_path=target_path,
                task=lambda target: target.write_text(
                    export_result_json(result),
                    encoding="utf-8",
                ),
                pending_message="Exporting DDA result…",
                success_title="Result Exported",
                failure_title="Result Export Failed",
                workflow_action_type="export-result-json",
                workflow_description=f"Exported DDA result to {Path(target_path).name}",
                workflow_payload={"path": target_path},
                file_path=result.file_path,
            )

        self._with_export_target_result(
            continue_export,
            unavailable_message="Run DDA before exporting a result.",
        )

    def _export_result_csv(self) -> None:
        def continue_export(result: DdaResult) -> None:
            if not result.variants:
                self._show_error("Run DDA before exporting result CSV.")
                return
            variant_id = self._export_target_variant_id(result)
            variant = find_variant(result, variant_id)
            if variant is None:
                self._show_error("No DDA variant is available to export.")
                return
            default_name = (
                f"{default_result_base_name(result)}-{variant.id.lower()}.csv"
            )
            target_path, _ = QFileDialog.getSaveFileName(
                self,
                "Export DDA Variant CSV",
                str(Path.home() / default_name),
                "CSV Files (*.csv)",
            )
            if not target_path:
                return
            self._run_background_file_export(
                target_path=target_path,
                task=lambda target: target.write_text(
                    export_variant_csv(result, variant.id),
                    encoding="utf-8",
                ),
                pending_message=f"Exporting {variant.id} CSV…",
                success_title="CSV Exported",
                failure_title="CSV Export Failed",
                workflow_action_type="export-result-csv",
                workflow_description=f"Exported {variant.id} CSV to {Path(target_path).name}",
                workflow_payload={"path": target_path, "variant": variant.id},
                file_path=result.file_path,
            )

        self._with_export_target_result(
            continue_export,
            unavailable_message="Run DDA before exporting result CSV.",
        )

    def _export_all_result_csv(self) -> None:
        def continue_export(result: DdaResult) -> None:
            if not result.variants:
                self._show_error("Run DDA before exporting all variants.")
                return
            target_path, _ = QFileDialog.getSaveFileName(
                self,
                "Export All DDA Variants",
                str(Path.home() / f"{default_result_base_name(result)}-all-variants.csv"),
                "CSV Files (*.csv)",
            )
            if not target_path:
                return
            self._run_background_file_export(
                target_path=target_path,
                task=lambda target: target.write_text(
                    export_all_variants_csv(result),
                    encoding="utf-8",
                ),
                pending_message="Exporting all DDA variants…",
                success_title="All Variants Exported",
                failure_title="All Variants Export Failed",
                workflow_action_type="export-all-results-csv",
                workflow_description=f"Exported all variants to {Path(target_path).name}",
                workflow_payload={"path": target_path},
                file_path=result.file_path,
            )

        self._with_export_target_result(
            continue_export,
            unavailable_message="Run DDA before exporting all variants.",
        )

    def _export_result_script(self, format_name: str) -> None:
        def continue_export(result: DdaResult) -> None:
            if not result.variants:
                self._show_error("Run DDA before exporting a reproduction script.")
                return
            variant_id = self._export_target_variant_id(result)
            generators = {
                "python": (generate_python_script, "Python Script", "py"),
                "matlab": (generate_matlab_script, "MATLAB Script", "m"),
                "julia": (generate_julia_script, "Julia Script", "jl"),
                "rust": (generate_rust_source, "Rust Source", "rs"),
            }
            generator_info = generators.get(format_name)
            if generator_info is None:
                self._show_error(f"Unsupported script format: {format_name}")
                return
            generator, dialog_title, extension = generator_info
            variant = find_variant(result, variant_id)
            suffix = variant.id.lower() if variant is not None else "dda"
            default_path = Path.home() / f"{default_result_base_name(result)}-{suffix}.{extension}"
            self.status_bar.showMessage(f"Preparing {dialog_title}…", 3000)

            def on_success(generated_text: object) -> None:
                content = str(generated_text)
                self._preview_text_export(
                    title=f"Export {dialog_title}",
                    heading=f"{dialog_title} Preview",
                    content=content,
                    default_path=default_path,
                    file_filter=f"{dialog_title} (*.{extension})",
                    success_title="Script Exported",
                    workflow_action_type="export-result-script",
                    workflow_description=f"Exported {format_name} reproduction script",
                    workflow_payload={
                        "format": format_name,
                    },
                    file_path=result.file_path,
                )

            def on_error(message: str) -> None:
                self._notify("export", "error", "Script Export Failed", message)
                self.status_bar.showMessage(f"Script Export Failed: {message}", 5000)

            self._run_task(
                lambda: generator(result, variant_id),
                on_success,
                on_error,
            )

        self._with_export_target_result(
            continue_export,
            unavailable_message="Run DDA before exporting a reproduction script.",
        )

    def _export_result_plot(self, plot_type: str, format_name: str) -> None:
        def continue_export(result: DdaResult) -> None:
            widget = (
                self.heatmap_widget if plot_type == "heatmap" else self.dda_lineplot_widget
            )
            if widget is None:
                self._show_error("The selected plot is not available.")
                return
            if self.state.dda_result is None or self.state.dda_result.id != result.id:
                self._apply_dda_result(
                    result,
                    persist=False,
                    refresh_auxiliary_views=False,
                )
            variant_id = self._export_target_variant_id(result) or "dda"
            target = self._save_plot_widget(
                widget,
                title=f"Export {plot_type.title()} Plot",
                default_name=(
                    f"{default_result_base_name(result)}-{variant_id.lower()}-{plot_type}"
                ),
                format_name=format_name,
            )
            if target is None:
                return
            self._record_workflow_action(
                "export-result-plot",
                f"Exported {plot_type} plot to {target.name}",
                {"path": str(target), "plotType": plot_type, "format": format_name},
                file_path=result.file_path,
            )
            self._notify("export", "info", "Plot Exported", target.name)

        self._with_export_target_result(
            continue_export,
            unavailable_message="Run DDA before exporting a plot.",
        )

    def _save_plot_widget(
        self,
        widget,
        *,
        title: str,
        default_name: str,
        format_name: str,
    ) -> Optional[Path]:
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            title,
            str(Path.home() / f"{default_name}.{format_name}"),
            f"{format_name.upper()} Files (*.{format_name})",
        )
        if not target_path:
            return None
        target = Path(target_path)
        if format_name == "png":
            widget.grab().save(str(target), "PNG")
            return target
        if format_name == "svg":
            generator = QSvgGenerator()
            generator.setFileName(str(target))
            generator.setSize(widget.size())
            generator.setViewBox(widget.rect())
            painter = QPainter(generator)
            widget.render(painter)
            painter.end()
            return target
        if format_name == "pdf":
            writer = QPdfWriter(str(target))
            writer.setPageMargins(QMarginsF(24, 24, 24, 24))
            writer.setPageOrientation(
                QPageLayout.Orientation.Landscape
                if widget.width() >= widget.height()
                else QPageLayout.Orientation.Portrait
            )
            writer.setPageSize(QPageSize(QPageSize.PageSizeId.A4))
            painter = QPainter(writer)
            page_rect = writer.pageLayout().paintRectPixels(writer.resolution())
            pixmap = widget.grab()
            scaled = pixmap.scaled(
                page_rect.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            x = page_rect.x() + max((page_rect.width() - scaled.width()) // 2, 0)
            y = page_rect.y() + max((page_rect.height() - scaled.height()) // 2, 0)
            painter.drawPixmap(x, y, scaled)
            painter.end()
            return target
        self._show_error(f"Unsupported plot export format: {format_name}")
        return None

    def _export_annotations(self) -> None:
        annotations = self._current_annotations()
        if not annotations:
            self._show_error("There are no annotations to export for the active file.")
            return
        base_name = (
            Path(self.state.active_file_path).stem
            if self.state.active_file_path
            else "annotations"
        )
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Annotations",
            str(Path.home() / f"{base_name}-annotations.json"),
            "JSON Files (*.json)",
        )
        if not target_path:
            return
        payload = {
            "activeFilePath": self.state.active_file_path,
            "exportedAtIso": self._now_iso(),
            "annotations": list(annotations),
        }
        self._run_background_file_export(
            target_path=target_path,
            task=lambda target: target.write_text(
                json.dumps(
                    {
                        **payload,
                        "annotations": [
                            asdict(annotation) for annotation in payload["annotations"]
                        ],
                    },
                    indent=2,
                ),
                encoding="utf-8",
            ),
            pending_message="Exporting annotations…",
            success_title="Annotations Exported",
            failure_title="Annotations Export Failed",
            workflow_action_type="export-annotations",
            workflow_description=f"Exported annotations to {Path(target_path).name}",
            workflow_payload={"path": target_path},
            file_path=self.state.active_file_path,
        )

    def _prepare_annotations_import_payload(self, payload: dict) -> dict:
        active_file_path = (
            self.state.active_file_path
            if isinstance(self.state.active_file_path, str)
            and self.state.active_file_path
            else None
        )
        source_file_path = payload.get("activeFilePath")
        restored: dict[str, list] = {}
        annotations_payload = payload.get("annotations")
        annotations_by_file_payload = payload.get("annotationsByFile")
        if isinstance(annotations_payload, list):
            target_file_path = active_file_path
            if target_file_path is None and isinstance(source_file_path, str):
                target_file_path = source_file_path
            if not target_file_path:
                raise RuntimeError(
                    "Open a dataset before importing annotations, or import a JSON file that includes its source file path."
                )
            restored = self._restore_annotations_from_payload(
                {target_file_path: annotations_payload}
            )
        elif isinstance(annotations_by_file_payload, dict):
            restored = self._restore_annotations_from_payload(annotations_by_file_payload)
        else:
            raise RuntimeError("Annotations file format is invalid.")
        if not restored:
            raise RuntimeError("No annotations were found in the selected JSON file.")
        preferred_file_path: Optional[str] = None
        if active_file_path and active_file_path in restored:
            preferred_file_path = active_file_path
        elif isinstance(source_file_path, str) and source_file_path in restored:
            preferred_file_path = source_file_path
        else:
            preferred_file_path = next(iter(restored.keys()))
        return {
            "annotationsByFile": restored,
            "preferredFilePath": preferred_file_path,
        }

    def _import_annotations(self) -> None:
        source_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import Annotations",
            str(Path.home()),
            "JSON Files (*.json)",
        )
        if not source_path:
            return
        source = Path(source_path)
        self.status_bar.showMessage("Importing annotations…", 3000)

        def runner() -> object:
            try:
                payload = json.loads(source.read_text(encoding="utf-8"))
            except (OSError, ValueError, TypeError) as exc:
                raise RuntimeError(str(exc)) from exc
            if not isinstance(payload, dict):
                raise RuntimeError("Annotations file format is invalid.")
            return self._prepare_annotations_import_payload(payload)

        def on_success(result: object) -> None:
            import_payload = result if isinstance(result, dict) else {}
            restored = import_payload.get("annotationsByFile") or {}
            if not isinstance(restored, dict) or not restored:
                self._notify(
                    "import",
                    "error",
                    "Annotations Import Failed",
                    "No annotations were found in the selected JSON file.",
                )
                return
            for file_path, annotations in restored.items():
                if not isinstance(file_path, str) or not isinstance(annotations, list):
                    continue
                self.state.annotations_by_file[file_path] = list(annotations)
                self.state_db.replace_annotations_for_file(file_path, annotations)
            active_file_path = (
                self.state.active_file_path
                if isinstance(self.state.active_file_path, str)
                and self.state.active_file_path
                else None
            )
            if active_file_path and active_file_path in restored:
                self._refresh_annotations_table()
                self._update_annotation_scope_label()
                self._apply_annotations_to_views()
                self._refresh_results_page()
            elif active_file_path is None:
                preferred_file_path = import_payload.get("preferredFilePath")
                if (
                    isinstance(preferred_file_path, str)
                    and preferred_file_path
                    and (self._server_url or Path(preferred_file_path).exists())
                ):
                    self._open_dataset(preferred_file_path)
            annotation_count = sum(
                len(annotations)
                for annotations in restored.values()
                if isinstance(annotations, list)
            )
            file_count = len(restored)
            self._record_workflow_action(
                "import-annotations",
                f"Imported annotations from {source.name}",
                {
                    "path": source_path,
                    "annotationCount": str(annotation_count),
                    "fileCount": str(file_count),
                },
                file_path=active_file_path,
            )
            self._notify(
                "import",
                "info",
                "Annotations Imported",
                f"{annotation_count} annotation{'s' if annotation_count != 1 else ''} across {file_count} file{'s' if file_count != 1 else ''}",
            )
            self.status_bar.showMessage(f"Annotations Imported: {source.name}", 4000)
            self._schedule_session_save()

        def on_error(message: str) -> None:
            self._notify("import", "error", "Annotations Import Failed", message)
            self.status_bar.showMessage(
                f"Annotations Import Failed: {message}",
                5000,
            )

        self._run_task(runner, on_success, on_error)

    def _export_snapshot(self, mode: str = "full") -> None:
        target_file = (
            Path(self.state.active_file_path).stem
            if self.state.active_file_path
            else "ddalab-session"
        )
        default_name = (
            f"{target_file}.ddalab"
            if mode == "full"
            else f"{target_file}-recipe.ddalab"
        )
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export DDALAB Snapshot",
            str(Path.home() / default_name),
            "DDALAB Files (*.ddalab);;JSON Files (*.json)",
        )
        if not target_path:
            return

        snapshot_state = {
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
        annotations_by_file = {
            path: list(annotations)
            for path, annotations in self.state.annotations_by_file.items()
        }
        ica_result = self.state.ica_result

        def export_snapshot_with_result(result: Optional[DdaResult]) -> None:
            self._run_background_file_export(
                target_path=target_path,
                task=lambda target: target.write_text(
                    json.dumps(
                        {
                            **snapshot_state,
                            **(
                                {
                                    "annotationsByFile": {
                                        path: [asdict(annotation) for annotation in annotations]
                                        for path, annotations in annotations_by_file.items()
                                    },
                                    "ddaResult": asdict(result.materialize()) if result else None,
                                    "icaResult": asdict(ica_result) if ica_result else None,
                                }
                                if mode != "recipe_only"
                                else {
                                    "annotationsByFile": {},
                                    "ddaResult": None,
                                    "icaResult": None,
                                }
                            ),
                        },
                        indent=2,
                    ),
                    encoding="utf-8",
                ),
                pending_message="Exporting DDALAB snapshot…",
                success_title="DDALAB Snapshot Exported",
                failure_title="DDALAB Snapshot Export Failed",
                workflow_action_type="export-snapshot",
                workflow_description=f"Exported DDALAB snapshot to {Path(target_path).name}",
                workflow_payload={"path": target_path, "mode": mode},
                file_path=self.state.active_file_path,
            )

        if mode == "recipe_only":
            export_snapshot_with_result(None)
            return

        result = self._export_target_result()
        if result is not None or not self.state.selected_results_history_id:
            export_snapshot_with_result(result)
            return

        self.status_bar.showMessage("Loading saved DDA result…", 3000)

        def on_loaded(loaded: Optional[DdaResult]) -> None:
            if loaded is None:
                self._show_error("Saved DDA result is unavailable for export.")
                return
            current_target_id = self.state.selected_results_history_id
            if current_target_id and current_target_id != loaded.id:
                return
            export_snapshot_with_result(loaded)

        self._load_dda_result_from_history_async(
            self.state.selected_results_history_id,
            on_loaded,
        )

    def _import_snapshot(self) -> None:
        source_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import DDALAB Snapshot",
            str(Path.home()),
            "DDALAB Files (*.ddalab *.json)",
        )
        if not source_path:
            return
        def on_payload(payload: dict) -> None:
            self._apply_snapshot_payload(payload)
            self._record_workflow_action(
                "import-snapshot",
                f"Imported DDALAB snapshot {Path(source_path).name}",
                {"path": source_path},
                file_path=self.state.active_file_path,
            )
            self._notify(
                "import",
                "info",
                "DDALAB Snapshot Imported",
                Path(source_path).name,
            )
            self._schedule_session_save()

        self._load_json_payload_async(
            source_path=source_path,
            pending_message="Importing DDALAB snapshot…",
            success_title="DDALAB Snapshot Imported",
            failure_title="DDALAB Snapshot Import Failed",
            invalid_message="DDALAB snapshot format is invalid.",
            on_payload=on_payload,
        )

    def _start_workflow_recording(self) -> None:
        self.state.workflow_recording_enabled = True
        self._update_workflow_ui()
        self._notify("workflow", "info", "Action Log", "Logging started")

    def _stop_workflow_recording(self) -> None:
        self.state.workflow_recording_enabled = False
        if self.state.workflow_actions:
            self.state.saved_workflow_sessions.insert(
                0,
                WorkflowSessionEntry(
                    id=uuid.uuid4().hex,
                    name=(
                        f"{Path(self.state.active_file_path).name} action log"
                        if self.state.active_file_path
                        else "DDALAB action log"
                    ),
                    created_at_iso=self._now_iso(),
                    actions=list(self.state.workflow_actions),
                ),
            )
            self.state.saved_workflow_sessions = self.state.saved_workflow_sessions[:20]
            self.state_db.replace_workflow_sessions(self.state.saved_workflow_sessions)
        self._update_workflow_ui()
        self._notify("workflow", "info", "Action Log", "Logging stopped")

    def _clear_workflow_actions(self) -> None:
        self.state.workflow_actions.clear()
        self.state_db.replace_workflow_actions(self.state.workflow_actions)
        self._refresh_workflow_table()
        self._update_workflow_ui()
        self._notify("workflow", "info", "Action Log Cleared", "Removed logged actions")

    def _export_workflow(self) -> None:
        if not self.state.workflow_actions:
            self._show_error("Log at least one action before exporting the action log.")
            return
        default_name = (
            f"{Path(self.state.active_file_path).stem}-workflow-log.json"
            if self.state.active_file_path
            else "ddalab-workflow-log.json"
        )
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Action Log",
            str(Path.home() / default_name),
            "JSON Files (*.json)",
        )
        if not target_path:
            return
        workflow_payload = self._workflow_payload()
        self._run_background_file_export(
            target_path=target_path,
            task=lambda target: target.write_text(
                json.dumps(workflow_payload, indent=2),
                encoding="utf-8",
            ),
            pending_message="Exporting action log…",
            success_title="Action Log Exported",
            failure_title="Action Log Export Failed",
        )

    def _import_workflow(self) -> None:
        source_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import Action Log",
            str(Path.home()),
            "JSON Files (*.json)",
        )
        if not source_path:
            return
        def on_payload(payload: dict) -> None:
            self.state.workflow_actions = self._restore_workflow_actions(
                payload.get("actions")
            )
            self.state.saved_workflow_sessions.insert(
                0,
                WorkflowSessionEntry(
                    id=uuid.uuid4().hex,
                    name=str(payload.get("name") or Path(source_path).stem),
                    created_at_iso=str(payload.get("createdAtIso") or self._now_iso()),
                    actions=list(self.state.workflow_actions),
                ),
            )
            self.state.saved_workflow_sessions = self.state.saved_workflow_sessions[:20]
            self.state_db.replace_workflow_actions(self.state.workflow_actions)
            self.state_db.replace_workflow_sessions(self.state.saved_workflow_sessions)
            self._refresh_workflow_table()
            self._update_workflow_ui()
            self._notify("import", "info", "Action Log Imported", Path(source_path).name)

        self._load_json_payload_async(
            source_path=source_path,
            pending_message="Importing action log…",
            success_title="Action Log Imported",
            failure_title="Action Log Import Failed",
            invalid_message="Action log format is invalid.",
            on_payload=on_payload,
        )

    def _export_notifications(self) -> None:
        if not self.state.notifications:
            self._show_error("There are no notifications to export.")
            return
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Notifications",
            str(Path.home() / "ddalab-notifications.json"),
            "JSON Files (*.json)",
        )
        if not target_path:
            return
        notifications = list(self.state.notifications)
        self._run_background_file_export(
            target_path=target_path,
            task=lambda target: target.write_text(
                json.dumps([asdict(entry) for entry in notifications], indent=2),
                encoding="utf-8",
            ),
            pending_message="Exporting notifications…",
            success_title="Notifications Exported",
            failure_title="Notifications Export Failed",
        )

    def _clear_notifications(self) -> None:
        self.state.notifications.clear()
        self.state_db.replace_notifications(self.state.notifications)
        self._refresh_notifications_table()
        self.status_bar.showMessage("Notifications cleared", 3000)

    def _reconnect_backend(self) -> None:
        server_url = self.server_url_edit.text().strip()
        if not server_url:
            self._show_error(
                "Enter a remote backend URL or switch to the local Python backend."
            )
            return
        self.backend.close()
        self.backend = RemoteBackendClient(server_url)
        self._server_url = server_url
        self._notify(
            "system", "info", "Backend Changed", f"Using remote backend {server_url}"
        )
        self._record_workflow_action(
            "backend-switch",
            f"Switched to remote backend {server_url}",
            {"mode": "remote", "url": server_url},
        )
        self._update_backend_mode_ui()
        self._refresh_health()
        self._bootstrap_browser()
        self._refresh_nsg_state()

    def _use_local_backend(self) -> None:
        self.backend.close()
        self.backend = LocalBackendClient(self.runtime_paths)
        self._server_url = ""
        self.server_url_edit.clear()
        self._notify("system", "info", "Backend Changed", "Using local Python backend")
        self._record_workflow_action(
            "backend-switch",
            "Switched to local Python backend",
            {"mode": "local"},
        )
        self._update_backend_mode_ui()
        self._refresh_health()
        self._bootstrap_browser()
        self._refresh_nsg_state()
