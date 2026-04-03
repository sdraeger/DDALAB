from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from typing import List, Optional
import uuid

from PySide6.QtCore import QMarginsF, Qt
from PySide6.QtGui import QPageLayout, QPageSize, QPainter, QPdfWriter
from PySide6.QtSvg import QSvgGenerator
from PySide6.QtWidgets import QFileDialog, QTableWidget, QTableWidgetItem

from ..backend.api import LocalBackendClient, RemoteBackendClient
from ..domain.models import (
    DdaResult,
    NsgJobSnapshot,
    OpenNeuroDataset,
    PluginExecutionResult,
    PluginInstalledEntry,
    PluginRegistryEntry,
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
from ..ui.widgets.text_export_dialog import TextExportDialog
from .main_window_support import _human_bytes


class MainWindowIntegrationsMixin:
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
                "Local desktop bridge active.\n"
                "This is the default and recommended mode for running DDALAB on your own device."
            )
            self.use_local_bridge_button.setEnabled(False)

    def _backend_supports_local_features(self) -> bool:
        return not self._server_url

    def _selected_installed_plugin(self) -> Optional[PluginInstalledEntry]:
        if not hasattr(self, "installed_plugins_table"):
            return None
        selected_rows = self.installed_plugins_table.selectionModel().selectedRows()
        if not selected_rows:
            return None
        item = self.installed_plugins_table.item(selected_rows[0].row(), 0)
        plugin_id = item.data(Qt.UserRole) if item is not None else None
        return next(
            (
                entry
                for entry in self.state.installed_plugins
                if entry.plugin_id == plugin_id
            ),
            None,
        )

    def _selected_registry_plugin(self) -> Optional[PluginRegistryEntry]:
        if not hasattr(self, "plugin_registry_table"):
            return None
        selected_rows = self.plugin_registry_table.selectionModel().selectedRows()
        if not selected_rows:
            return None
        item = self.plugin_registry_table.item(selected_rows[0].row(), 0)
        plugin_id = item.data(Qt.UserRole) if item is not None else None
        return next(
            (
                entry
                for entry in self.state.plugin_registry
                if entry.plugin_id == plugin_id
            ),
            None,
        )

    def _refresh_plugins(self) -> None:
        if not hasattr(self, "plugins_status_label"):
            return
        if not self._backend_supports_local_features():
            self.state.installed_plugins = []
            self.state.plugin_registry = []
            self.plugins_status_label.setText(
                "Plugin management is available when using the local desktop bridge."
            )
            self.installed_plugins_table.setRowCount(0)
            self.plugin_registry_table.setRowCount(0)
            self._update_plugin_panels()
            return
        self.plugins_status_label.setText("Refreshing installed plugins and registry…")

        def task() -> object:
            return {
                "installed": self.backend.list_installed_plugins(),
                "registry": self.backend.fetch_plugin_registry(),
            }

        def on_success(result: object) -> None:
            payload = result if isinstance(result, dict) else {}
            self.state.installed_plugins = list(payload.get("installed") or [])
            self.state.plugin_registry = list(payload.get("registry") or [])
            self._refresh_plugin_tables()
            self._update_plugin_panels()
            self.plugins_status_label.setText(
                f"{len(self.state.installed_plugins)} installed • "
                f"{len(self.state.plugin_registry)} available in registry"
            )

        def on_error(message: str) -> None:
            self.plugins_status_label.setText("Plugin refresh failed")
            self.plugin_details.setPlainText(message)
            self._notify("plugin", "error", "Plugin Refresh Failed", message)

        self._run_task(task, on_success, on_error)

    def _refresh_plugin_tables(self) -> None:
        if not hasattr(self, "installed_plugins_table"):
            return
        current_installed = self._selected_installed_plugin()
        current_registry = self._selected_registry_plugin()

        self.installed_plugins_table.setRowCount(len(self.state.installed_plugins))
        for row, plugin in enumerate(self.state.installed_plugins):
            values = [
                plugin.name,
                plugin.version,
                plugin.category,
                "Enabled" if plugin.enabled else "Disabled",
                plugin.source,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                if column == 0:
                    item.setData(Qt.UserRole, plugin.plugin_id)
                    item.setToolTip(
                        plugin.source_url or plugin.description or plugin.plugin_id
                    )
                self.installed_plugins_table.setItem(row, column, item)
        self.installed_plugins_table.resizeColumnsToContents()

        self.plugin_registry_table.setRowCount(len(self.state.plugin_registry))
        for row, plugin in enumerate(self.state.plugin_registry):
            values = [
                plugin.name,
                plugin.version,
                plugin.category,
                plugin.author,
                plugin.published_at,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                if column == 0:
                    item.setData(Qt.UserRole, plugin.plugin_id)
                    item.setToolTip(plugin.description or plugin.artifact_url)
                self.plugin_registry_table.setItem(row, column, item)
        self.plugin_registry_table.resizeColumnsToContents()

        self._restore_table_selection(
            self.installed_plugins_table,
            current_installed.plugin_id if current_installed else None,
        )
        self._restore_table_selection(
            self.plugin_registry_table,
            current_registry.plugin_id if current_registry else None,
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

    def _update_plugin_panels(self) -> None:
        if not hasattr(self, "plugin_details"):
            return
        installed = self._selected_installed_plugin()
        registry = self._selected_registry_plugin()
        selected = installed or registry
        if selected is None:
            self.plugin_details.setPlainText(
                "Select an installed or registry plugin to inspect its details."
            )
        elif isinstance(selected, PluginInstalledEntry):
            details = [
                f"Name: {selected.name}",
                f"ID: {selected.plugin_id}",
                f"Version: {selected.version}",
                f"Category: {selected.category}",
                f"Author: {selected.author or '—'}",
                f"Status: {'Enabled' if selected.enabled else 'Disabled'}",
                f"Source: {selected.source}",
                f"Installed: {selected.installed_at}",
                f"Permissions: {', '.join(selected.permissions) if selected.permissions else 'None'}",
                "",
                selected.description or "No description provided.",
            ]
            if selected.source_url:
                details.extend(["", f"Source URL: {selected.source_url}"])
            self.plugin_details.setPlainText("\n".join(details))
        else:
            details = [
                f"Name: {selected.name}",
                f"ID: {selected.plugin_id}",
                f"Version: {selected.version}",
                f"Category: {selected.category}",
                f"Author: {selected.author}",
                f"Published: {selected.published_at}",
                f"Permissions: {', '.join(selected.permissions) if selected.permissions else 'None'}",
                "",
                selected.description or "No description provided.",
                "",
                f"Artifact: {selected.artifact_url}",
            ]
            self.plugin_details.setPlainText("\n".join(details))

        output = self.state.current_plugin_output
        if output is None:
            self.plugin_output.setPlainText("")
        else:
            output_lines = [f"Plugin: {output.plugin_id}", ""]
            if output.output_json:
                try:
                    pretty_json = json.dumps(json.loads(output.output_json), indent=2)
                except ValueError:
                    pretty_json = output.output_json
                output_lines.extend(["Output:", pretty_json])
            if output.logs:
                output_lines.extend(["", "Logs:", *output.logs])
            self.plugin_output.setPlainText("\n".join(output_lines))

        installed_ids = {entry.plugin_id for entry in self.state.installed_plugins}
        local_enabled = self._backend_supports_local_features()
        self.refresh_plugins_button.setEnabled(local_enabled)
        self.install_plugin_button.setEnabled(
            local_enabled
            and registry is not None
            and registry.plugin_id not in installed_ids
        )
        self.uninstall_plugin_button.setEnabled(local_enabled and installed is not None)
        self.toggle_plugin_button.setEnabled(local_enabled and installed is not None)
        self.toggle_plugin_button.setText(
            "Disable" if installed and installed.enabled else "Enable"
        )
        self.run_plugin_button.setEnabled(
            local_enabled
            and installed is not None
            and installed.enabled
            and self.state.selected_dataset is not None
        )

    def _install_selected_plugin(self) -> None:
        plugin = self._selected_registry_plugin()
        if plugin is None:
            self._show_error("Select a registry plugin to install.")
            return

        def on_success(result: object) -> None:
            _ = result
            self._refresh_plugins()
            self._record_workflow_action(
                "plugin-install",
                f"Installed plugin {plugin.name}",
                {"pluginId": plugin.plugin_id, "version": plugin.version},
            )
            self._notify("plugin", "info", "Plugin Installed", plugin.name)

        self._run_task(
            lambda: self.backend.install_plugin(plugin.plugin_id), on_success
        )

    def _uninstall_selected_plugin(self) -> None:
        plugin = self._selected_installed_plugin()
        if plugin is None:
            self._show_error("Select an installed plugin to uninstall.")
            return

        def on_success(result: object) -> None:
            _ = result
            self.state.current_plugin_output = None
            self._refresh_plugins()
            self._record_workflow_action(
                "plugin-uninstall",
                f"Uninstalled plugin {plugin.name}",
                {"pluginId": plugin.plugin_id},
            )
            self._notify("plugin", "info", "Plugin Removed", plugin.name)

        self._run_task(
            lambda: self.backend.uninstall_plugin(plugin.plugin_id), on_success
        )

    def _toggle_selected_plugin(self) -> None:
        plugin = self._selected_installed_plugin()
        if plugin is None:
            self._show_error("Select an installed plugin first.")
            return
        next_state = not plugin.enabled

        def on_success(result: object) -> None:
            enabled = bool(result)
            for entry in self.state.installed_plugins:
                if entry.plugin_id == plugin.plugin_id:
                    entry.enabled = enabled
            self._refresh_plugin_tables()
            self._update_plugin_panels()
            self._record_workflow_action(
                "plugin-toggle",
                f"{'Enabled' if enabled else 'Disabled'} plugin {plugin.name}",
                {"pluginId": plugin.plugin_id, "enabled": str(enabled).lower()},
            )
            self._notify(
                "plugin",
                "info",
                "Plugin Updated",
                f"{plugin.name} {'enabled' if enabled else 'disabled'}",
            )

        self._run_task(
            lambda: self.backend.set_plugin_enabled(plugin.plugin_id, next_state),
            on_success,
        )

    def _run_selected_plugin(self) -> None:
        plugin = self._selected_installed_plugin()
        dataset = self.state.selected_dataset
        if plugin is None:
            self._show_error("Select an installed plugin to run.")
            return
        if dataset is None:
            self._show_error("Open a dataset before running a plugin.")
            return
        selected_indices = self._selected_channel_indices(dataset)
        self.plugin_output.setPlainText("Running plugin…")

        def on_success(result: object) -> None:
            execution = result if isinstance(result, PluginExecutionResult) else result
            self.state.current_plugin_output = execution
            self._update_plugin_panels()
            self._record_workflow_action(
                "plugin-run",
                f"Ran plugin {plugin.name}",
                {
                    "pluginId": plugin.plugin_id,
                    "channels": ",".join(str(value) for value in selected_indices),
                },
                file_path=dataset.file_path,
            )
            self._notify("plugin", "info", "Plugin Finished", plugin.name)

        self._run_task(
            lambda: self.backend.run_plugin(
                plugin.plugin_id,
                dataset,
                selected_indices,
            ),
            on_success,
        )

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
        if not self._backend_supports_local_features():
            self.state.nsg_credentials = None
            self.state.nsg_jobs = []
            self.nsg_status_label.setText(
                "NSG integration is available when using the local desktop bridge."
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
        if selected_job is None:
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
        local_enabled = self._backend_supports_local_features()
        creds_summary = (
            f"{creds.username} • "
            f"{'password saved' if creds.has_password else 'no password'} • "
            f"{'app key saved' if creds.has_app_key else 'no app key'}"
            if creds
            else "No saved NSG credentials"
        )
        self.nsg_status_label.setText(
            f"{creds_summary} • {len(self.state.nsg_jobs)} job{'s' if len(self.state.nsg_jobs) != 1 else ''}"
        )
        self.nsg_save_credentials_button.setEnabled(local_enabled)
        self.nsg_delete_credentials_button.setEnabled(
            local_enabled and creds is not None
        )
        self.nsg_test_connection_button.setEnabled(local_enabled and creds is not None)
        self.nsg_create_job_button.setEnabled(
            local_enabled
            and creds is not None
            and self.state.selected_dataset is not None
        )
        self.nsg_refresh_jobs_button.setEnabled(local_enabled)
        self.nsg_submit_job_button.setEnabled(
            local_enabled and selected_job is not None
        )
        self.nsg_refresh_job_button.setEnabled(
            local_enabled and selected_job is not None
        )
        self.nsg_cancel_job_button.setEnabled(
            local_enabled and selected_job is not None
        )
        self.nsg_download_results_button.setEnabled(
            local_enabled and selected_job is not None
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

    def _load_openneuro(self) -> None:
        self.status_bar.showMessage("Loading OpenNeuro datasets…", 3000)

        def on_success(result: object) -> None:
            datasets, end_cursor, has_more = result
            self.openneuro_datasets = datasets
            self._openneuro_end_cursor = end_cursor
            self._openneuro_has_more = has_more
            self._populate_openneuro_table(datasets)

        self._run_task(
            lambda: self.openneuro.list_datasets(limit=50),
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
            return
        dataset_id = selected[0].data(Qt.UserRole)
        dataset = next(
            (item for item in self.openneuro_datasets if item.dataset_id == dataset_id),
            None,
        )
        if not dataset:
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

    def _export_target_result(self) -> Optional[DdaResult]:
        selected_result = self._selected_history_result()
        return selected_result or self.state.dda_result

    def _export_target_variant_id(self, result: DdaResult) -> Optional[str]:
        if self.state.dda_result is not None and self.state.dda_result.id == result.id:
            return self._active_variant_id
        variant = find_variant(result)
        return variant.id if variant is not None else None

    def _export_result_json(self) -> None:
        result = self._export_target_result()
        if result is None:
            self._show_error("Run DDA before exporting a result.")
            return
        default_name = f"{default_result_base_name(result)}-result.json"
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export DDA Result",
            str(Path.home() / default_name),
            "JSON Files (*.json)",
        )
        if not target_path:
            return
        Path(target_path).write_text(export_result_json(result), encoding="utf-8")
        self._record_workflow_action(
            "export-result-json",
            f"Exported DDA result to {Path(target_path).name}",
            {"path": target_path},
            file_path=result.file_path,
        )
        self._notify("export", "info", "Result Exported", Path(target_path).name)

    def _export_result_csv(self) -> None:
        result = self._export_target_result()
        if result is None or not result.variants:
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
        Path(target_path).write_text(
            export_variant_csv(result, variant.id),
            encoding="utf-8",
        )
        self._record_workflow_action(
            "export-result-csv",
            f"Exported {variant.id} CSV to {Path(target_path).name}",
            {"path": target_path, "variant": variant.id},
            file_path=result.file_path,
        )
        self._notify("export", "info", "CSV Exported", Path(target_path).name)

    def _export_all_result_csv(self) -> None:
        result = self._export_target_result()
        if result is None or not result.variants:
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
        Path(target_path).write_text(
            export_all_variants_csv(result),
            encoding="utf-8",
        )
        self._record_workflow_action(
            "export-all-results-csv",
            f"Exported all variants to {Path(target_path).name}",
            {"path": target_path},
            file_path=result.file_path,
        )
        self._notify(
            "export",
            "info",
            "All Variants Exported",
            Path(target_path).name,
        )

    def _export_result_script(self, format_name: str) -> None:
        result = self._export_target_result()
        if result is None or not result.variants:
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
        content = generator(result, variant_id)
        preview_dialog = TextExportDialog(
            parent=self,
            title=f"Preview {dialog_title}",
            heading=dialog_title,
            content=content,
            default_path=Path.home()
            / f"{default_result_base_name(result)}-{suffix}.{extension}",
            file_filter=f"{dialog_title} (*.{extension})",
        )
        preview_dialog.exec()
        if preview_dialog.saved_path is None:
            return
        self._record_workflow_action(
            "export-result-script",
            "Exported "
            f"{format_name} reproduction script to {preview_dialog.saved_path.name}",
            {"path": str(preview_dialog.saved_path), "format": format_name},
            file_path=result.file_path,
        )
        self._notify(
            "export",
            "info",
            "Script Exported",
            preview_dialog.saved_path.name,
        )

    def _export_result_plot(self, plot_type: str, format_name: str) -> None:
        result = self._export_target_result()
        if result is None:
            self._show_error("Run DDA before exporting a plot.")
            return
        widget = (
            self.heatmap_widget if plot_type == "heatmap" else self.dda_lineplot_widget
        )
        if widget is None:
            self._show_error("The selected plot is not available.")
            return
        if self.state.dda_result is None or self.state.dda_result.id != result.id:
            self._apply_dda_result(result)
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
            "annotations": [asdict(annotation) for annotation in annotations],
        }
        Path(target_path).write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )
        self._record_workflow_action(
            "export-annotations",
            f"Exported annotations to {Path(target_path).name}",
            {"path": target_path},
            file_path=self.state.active_file_path,
        )
        self._notify("export", "info", "Annotations Exported", Path(target_path).name)

    def _export_snapshot(self, mode: str = "full") -> None:
        target_file = (
            Path(self.state.active_file_path).stem
            if self.state.active_file_path
            else "ddalab-session"
        )
        default_name = (
            f"{target_file}-snapshot.ddalab"
            if mode == "full"
            else f"{target_file}-recipe.ddalab"
        )
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Session Snapshot",
            str(Path.home() / default_name),
            "DDALAB Snapshot (*.ddalab);;JSON Files (*.json)",
        )
        if not target_path:
            return
        result = self._export_target_result()
        payload = self._snapshot_payload_for_mode(mode, result)
        Path(target_path).write_text(
            json.dumps(payload, indent=2),
            encoding="utf-8",
        )
        self._record_workflow_action(
            "export-snapshot",
            f"Exported snapshot to {Path(target_path).name}",
            {"path": target_path, "mode": mode},
            file_path=self.state.active_file_path,
        )
        self._notify("export", "info", "Snapshot Exported", Path(target_path).name)

    def _import_snapshot(self) -> None:
        source_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import Snapshot",
            str(Path.home()),
            "DDALAB Snapshot (*.ddalab *.json)",
        )
        if not source_path:
            return
        try:
            payload = json.loads(Path(source_path).read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError) as exc:
            self._show_error(f"Failed to read snapshot: {exc}")
            return
        if not isinstance(payload, dict):
            self._show_error("Snapshot format is invalid.")
            return
        self._apply_snapshot_payload(payload)
        self._record_workflow_action(
            "import-snapshot",
            f"Imported snapshot {Path(source_path).name}",
            {"path": source_path},
            file_path=self.state.active_file_path,
        )
        self._notify("import", "info", "Snapshot Imported", Path(source_path).name)
        self._schedule_session_save()

    def _start_workflow_recording(self) -> None:
        self.state.workflow_recording_enabled = True
        self._update_workflow_ui()
        self._notify("workflow", "info", "Workflow Recording", "Recording started")

    def _stop_workflow_recording(self) -> None:
        self.state.workflow_recording_enabled = False
        if self.state.workflow_actions:
            self.state.saved_workflow_sessions.insert(
                0,
                WorkflowSessionEntry(
                    id=uuid.uuid4().hex,
                    name=(
                        f"{Path(self.state.active_file_path).name} workflow"
                        if self.state.active_file_path
                        else "DDALAB workflow"
                    ),
                    created_at_iso=self._now_iso(),
                    actions=list(self.state.workflow_actions),
                ),
            )
            self.state.saved_workflow_sessions = self.state.saved_workflow_sessions[:20]
            self.state_db.replace_workflow_sessions(self.state.saved_workflow_sessions)
        self._update_workflow_ui()
        self._notify("workflow", "info", "Workflow Recording", "Recording stopped")

    def _clear_workflow_actions(self) -> None:
        self.state.workflow_actions.clear()
        self.state_db.replace_workflow_actions(self.state.workflow_actions)
        self._refresh_workflow_table()
        self._update_workflow_ui()
        self._notify("workflow", "info", "Workflow Cleared", "Removed recorded actions")

    def _export_workflow(self) -> None:
        if not self.state.workflow_actions:
            self._show_error("Record at least one action before exporting a workflow.")
            return
        default_name = (
            f"{Path(self.state.active_file_path).stem}-workflow.json"
            if self.state.active_file_path
            else "ddalab-workflow.json"
        )
        target_path, _ = QFileDialog.getSaveFileName(
            self,
            "Export Workflow",
            str(Path.home() / default_name),
            "JSON Files (*.json)",
        )
        if not target_path:
            return
        Path(target_path).write_text(
            json.dumps(self._workflow_payload(), indent=2),
            encoding="utf-8",
        )
        self._notify("export", "info", "Workflow Exported", Path(target_path).name)

    def _import_workflow(self) -> None:
        source_path, _ = QFileDialog.getOpenFileName(
            self,
            "Import Workflow",
            str(Path.home()),
            "JSON Files (*.json)",
        )
        if not source_path:
            return
        try:
            payload = json.loads(Path(source_path).read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError) as exc:
            self._show_error(f"Failed to read workflow: {exc}")
            return
        if not isinstance(payload, dict):
            self._show_error("Workflow format is invalid.")
            return
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
        self._notify("import", "info", "Workflow Imported", Path(source_path).name)

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
        Path(target_path).write_text(
            json.dumps([asdict(entry) for entry in self.state.notifications], indent=2),
            encoding="utf-8",
        )
        self._notify("export", "info", "Notifications Exported", Path(target_path).name)

    def _clear_notifications(self) -> None:
        self.state.notifications.clear()
        self.state_db.replace_notifications(self.state.notifications)
        self._refresh_notifications_table()
        self.status_bar.showMessage("Notifications cleared", 3000)

    def _reconnect_backend(self) -> None:
        server_url = self.server_url_edit.text().strip()
        if not server_url:
            self._show_error(
                "Enter a remote backend URL or switch to the local bridge."
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
        self._refresh_plugins()
        self._refresh_nsg_state()

    def _use_local_backend(self) -> None:
        self.backend.close()
        self.backend = LocalBackendClient(self.runtime_paths)
        self._server_url = ""
        self.server_url_edit.clear()
        self._notify("system", "info", "Backend Changed", "Using local desktop bridge")
        self._record_workflow_action(
            "backend-switch",
            "Switched to local desktop bridge",
            {"mode": "local"},
        )
        self._update_backend_mode_ui()
        self._refresh_health()
        self._bootstrap_browser()
        self._refresh_plugins()
        self._refresh_nsg_state()
