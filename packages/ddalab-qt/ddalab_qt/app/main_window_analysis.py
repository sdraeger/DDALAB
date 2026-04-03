from __future__ import annotations

from pathlib import Path
import time
from typing import List, Optional

from PySide6.QtCore import QSignalBlocker, Qt
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QListWidgetItem,
    QMenu,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
)

from ..domain.models import DdaResult, DdaRunDetails, IcaResult
from .main_window_support import (
    _build_connectivity_metrics,
    _build_variant_comparisons,
    _human_bytes,
)


class MainWindowAnalysisMixin:
    def _set_dda_running_state(
        self,
        running: bool,
        *,
        dataset_name: Optional[str] = None,
        variant_ids: Optional[List[str]] = None,
        details: Optional[DdaRunDetails] = None,
    ) -> None:
        self.state.dda_run_in_progress = running
        self.state.dda_run_file_name = dataset_name if running else None
        self.state.dda_run_variant_ids = list(variant_ids or []) if running else []
        self.state.dda_run_details = details if running else None
        self._dda_run_animation_tick = 0
        self._dda_run_started_at = time.monotonic() if running else None
        if running:
            self.dda_activity_timer.start()
        else:
            self.dda_activity_timer.stop()
        self._refresh_dda_running_ui()

    def _refresh_dda_running_ui(self) -> None:
        if not hasattr(self, "dda_activity_frame"):
            return
        is_running = self.state.dda_run_in_progress
        self.run_button.setEnabled(not is_running)
        self.run_dda_from_page_button.setEnabled(not is_running)
        self.dda_activity_progress.set_running(is_running)
        self.dda_global_progress.set_running(is_running)
        self.dda_activity_frame.setVisible(is_running)
        self.dda_global_activity.setVisible(is_running)
        if not is_running:
            self.dda_activity_label.clear()
            self.dda_global_label.clear()
            return
        self._dda_run_animation_tick += 1
        dots = "." * ((self._dda_run_animation_tick % 3) + 1)
        elapsed_seconds = (
            int(time.monotonic() - self._dda_run_started_at)
            if self._dda_run_started_at is not None
            else 0
        )
        file_name = self.state.dda_run_file_name or "dataset"
        variants = ", ".join(self.state.dda_run_variant_ids) or "DDA"
        headline = f"Running DDA on {file_name} ({variants})"
        subline = f"Worker is active asynchronously. Elapsed: {elapsed_seconds}s{dots}"
        self.dda_activity_label.setText(f"{headline}\n{subline}")
        self.dda_global_label.setText(
            f"DDA running • {file_name} • {elapsed_seconds}s{dots}"
        )
        detail_hint = "Click for run details"
        self.dda_activity_label.setToolTip(detail_hint)
        self.dda_global_label.setToolTip(detail_hint)
        self.dda_diagnostics.setPlainText(f"{headline}\n{subline}")
        self.result_summary.setPlainText(
            f"Waiting for DDA results…\n\n{headline}\n{subline}"
        )

    def _show_dda_run_details_popover(self, anchor: QWidget) -> None:
        if not self.state.dda_run_in_progress or self.state.dda_run_details is None:
            return
        if self._dda_run_details_menu is not None:
            self._dda_run_details_menu.close()
        menu = QMenu(self)
        menu.setObjectName("dda-run-details-popover")
        container = QFrame(menu)
        layout = QVBoxLayout(container)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(8)

        title = QLabel("Active DDA Execution")
        title.setProperty("title", True)
        title.setStyleSheet("font-size: 15px;")
        layout.addWidget(title)

        details_label = QLabel(self._format_dda_run_details())
        details_label.setWordWrap(True)
        details_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        details_label.setMinimumWidth(360)
        details_label.setMaximumWidth(460)
        layout.addWidget(details_label)

        action = QWidgetAction(menu)
        action.setDefaultWidget(container)
        menu.addAction(action)
        self._dda_run_details_menu = menu
        menu.aboutToHide.connect(self._clear_dda_run_details_menu)
        menu.popup(anchor.mapToGlobal(anchor.rect().bottomLeft()))

    def _clear_dda_run_details_menu(self) -> None:
        self._dda_run_details_menu = None

    def _format_dda_run_details(self) -> str:
        details = self.state.dda_run_details
        if details is None:
            return "No DDA execution is currently running."
        elapsed_seconds = (
            int(time.monotonic() - self._dda_run_started_at)
            if self._dda_run_started_at is not None
            else 0
        )
        channel_names = ", ".join(details.channel_names) or "—"
        channel_indices = ", ".join(str(index) for index in details.channel_indices) or "—"
        delays = ", ".join(str(delay) for delay in details.delays) or "—"
        variants = ", ".join(details.variant_ids) or "—"
        sample_rate = f"{details.sample_rate_hz:.3f} Hz" if details.sample_rate_hz > 0 else "—"
        start_sample = max(int(round(details.start_time_seconds * details.sample_rate_hz)), 0)
        if details.end_time_seconds is None:
            end_sample = "end"
            bounds_seconds = f"{details.start_time_seconds:.2f}s → end"
        else:
            end_sample = str(max(int(round(details.end_time_seconds * details.sample_rate_hz)), start_sample))
            bounds_seconds = f"{details.start_time_seconds:.2f}s → {details.end_time_seconds:.2f}s"
        file_size_bytes = (
            self.state.selected_dataset.file_size_bytes
            if self.state.selected_dataset
            and self.state.selected_dataset.file_path == details.file_path
            else None
        )
        lines = [
            f"Dataset: {details.file_name}",
            f"Started: {details.started_at_iso}",
            f"Elapsed: {elapsed_seconds}s",
            f"Engine: {details.engine_label or self.backend.connection_label}",
            f"File path: {details.file_path}",
            f"File size: {_human_bytes(file_size_bytes)}",
            "",
            f"Variants: {variants}",
            f"Selected channels: {channel_indices}",
            f"Channel names: {channel_names}",
            f"Window: {details.window_length_samples}/{details.window_step_samples} samples",
            f"Delays: {delays}",
            f"Bounds: {bounds_seconds} ({start_sample} → {end_sample} samples)",
            f"Sample rate: {sample_rate}",
        ]
        return "\n".join(lines)

    def _run_dda(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._show_error("Open a dataset before running DDA.")
            return
        selected_channel_names = self._selected_channel_names()
        if not selected_channel_names:
            self._show_error("Select at least one channel before running DDA.")
            return
        variant_ids = [
            key
            for key, checkbox in self.variant_checkboxes.items()
            if checkbox.isChecked()
        ]
        if not variant_ids:
            self._show_error("Select at least one DDA variant.")
            return
        selected_indices = [
            dataset.channel_names.index(name)
            for name in selected_channel_names
            if name in dataset.channel_names
        ]
        window_length_samples = self.window_length_spin.value()
        window_step_samples = self.window_step_spin.value()
        delays = [
            int(token.strip())
            for token in self.delays_edit.text().split(",")
            if token.strip()
        ]
        start = float(self.dda_start_edit.text() or "0")
        end_text = self.dda_end_edit.text().strip()
        end = float(end_text) if end_text else None
        details = DdaRunDetails(
            file_name=dataset.file_name,
            file_path=dataset.file_path,
            started_at_iso=time.strftime("%Y-%m-%dT%H:%M:%S"),
            variant_ids=list(variant_ids),
            channel_names=list(selected_channel_names),
            channel_indices=list(selected_indices),
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=list(delays),
            start_time_seconds=start,
            end_time_seconds=end,
            sample_rate_hz=dataset.dominant_sample_rate_hz,
            engine_label=self.backend.connection_label,
        )
        self._set_dda_running_state(
            True,
            dataset_name=dataset.file_name,
            variant_ids=variant_ids,
            details=details,
        )

        def task() -> object:
            return self.backend.run_dda(
                dataset=dataset,
                selected_channel_indices=selected_indices,
                selected_variants=variant_ids,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
                start_time_seconds=start,
                end_time_seconds=end,
            )

        def on_success(result: object) -> None:
            self._set_dda_running_state(False)
            dda_result = result
            self._apply_dda_result(dda_result)
            self._record_workflow_action(
                "run-dda",
                f"Ran DDA on {dataset.file_name}",
                {
                    "variants": ", ".join(variant_ids),
                    "channels": ", ".join(selected_channel_names),
                },
                file_path=dataset.file_path,
            )
            self._notify(
                "analysis",
                "info",
                "DDA Completed",
                f"{dataset.file_name} • {', '.join(variant_ids)}",
            )

        def on_error(message: str) -> None:
            self._set_dda_running_state(False)
            self.dda_diagnostics.setPlainText(f"DDA failed:\n{message}")
            self.result_summary.setPlainText(f"DDA failed.\n\n{message}")
            self._notify("analysis", "error", "DDA Failed", message)

        self._run_task(
            task,
            on_success,
            on_error,
        )

    def _on_variant_changed(self, index: int) -> None:
        if index < 0:
            return
        self._active_variant_id = str(self.variant_combo.currentData())
        self._update_variant_view()

    def _on_heatmap_color_scheme_changed(self, index: int) -> None:
        if index < 0:
            return
        scheme = self.heatmap_color_scheme_combo.currentData()
        if isinstance(scheme, str):
            self.heatmap_widget.set_color_scheme(scheme)
            self._schedule_session_save()

    def _update_variant_view(self) -> None:
        result = self.state.dda_result
        if not result or not result.variants:
            self.heatmap_widget.set_variant(None)
            self.dda_lineplot_widget.set_variant(None)
            return
        variant = next(
            (item for item in result.variants if item.id == self._active_variant_id),
            result.variants[0],
        )
        self.heatmap_widget.set_variant(variant)
        self.dda_lineplot_widget.set_variant(variant, result.window_centers_seconds)
        self.result_summary.setPlainText(
            f"{variant.label}\n\n"
            f"{variant.summary}\n\n"
            f"Rows: {len(variant.row_labels)}\n"
            f"Columns: {max((len(row) for row in variant.matrix), default=0)}\n"
            f"Value range: {variant.min_value:.4f} → {variant.max_value:.4f}\n"
            f"Engine: {result.engine_label}\n"
            f"Created: {result.created_at_iso}"
        )

    def _update_ica_channel_summary(self) -> None:
        if not hasattr(self, "ica_channel_summary_label"):
            return
        dataset = self.state.selected_dataset
        if dataset is None:
            self.ica_channel_summary_label.setText("Open a dataset before running ICA.")
            return
        selected = self._selected_channel_names()
        channel_summary = (
            ", ".join(selected[:6]) if selected else "No channels selected"
        )
        if len(selected) > 6:
            channel_summary += f" +{len(selected) - 6} more"
        self.ica_channel_summary_label.setText(
            f"{dataset.file_name} • {len(selected)} selected channel(s) • {channel_summary}"
        )

    def _selected_ica_component(self):
        if not hasattr(self, "ica_components_table"):
            return None
        selected_rows = self.ica_components_table.selectionModel().selectedRows()
        if not selected_rows or self.state.ica_result is None:
            return None
        row = selected_rows[0].row()
        if row < 0 or row >= len(self.state.ica_result.components):
            return None
        return self.state.ica_result.components[row]

    def _update_ica_component_details(self) -> None:
        if not hasattr(self, "ica_component_details"):
            return
        component = self._selected_ica_component()
        if component is None:
            self.ica_component_details.setPlainText("")
            return
        power_preview = (
            ", ".join(f"{freq:.2f}Hz" for freq in component.power_frequencies[:8])
            or "—"
        )
        spatial_preview = (
            ", ".join(f"{value:.3f}" for value in component.spatial_map[:8]) or "—"
        )
        self.ica_component_details.setPlainText(
            f"Component {component.component_id}\n"
            f"Variance explained: {component.variance_explained:.4f}\n"
            f"Kurtosis: {component.kurtosis:.4f}\n"
            f"Non-gaussianity: {component.non_gaussianity:.4f}\n"
            f"Spatial map preview: {spatial_preview}\n"
            f"Power frequencies: {power_preview}"
        )

    def _apply_ica_result(self, result: Optional[IcaResult]) -> None:
        self.state.ica_result = result
        if not hasattr(self, "ica_components_table"):
            return
        if result is None:
            self.ica_diagnostics.setPlainText("")
            self.ica_result_summary.setPlainText("")
            self.ica_components_table.setRowCount(0)
            self.ica_component_details.setPlainText("")
            self._refresh_results_page()
            return
        self.state_db.save_ica_result(result)
        self.ica_result_summary.setPlainText(
            f"ICA Result {result.id}\n\n"
            f"Channels: {len(result.channel_names)}\n"
            f"Components: {len(result.components)}\n"
            f"Sample rate: {result.sample_rate_hz:.2f} Hz\n"
            f"Samples: {result.sample_count}\n"
            f"Created: {result.created_at_iso}"
        )
        self.ica_components_table.setRowCount(len(result.components))
        for row, component in enumerate(result.components):
            values = [
                str(component.component_id),
                f"{component.variance_explained:.4f}",
                f"{component.kurtosis:.4f}",
                f"{component.non_gaussianity:.4f}",
            ]
            for column, value in enumerate(values):
                self.ica_components_table.setItem(row, column, QTableWidgetItem(value))
        self.ica_components_table.resizeColumnsToContents()
        if result.components:
            self.ica_components_table.selectRow(0)
        else:
            self.ica_component_details.setPlainText("")
        self._refresh_results_page()

    def _batch_candidate_paths(self) -> List[str]:
        seen: set[str] = set()
        candidates: List[str] = []
        for path in self.state.open_files:
            if path and path not in seen:
                candidates.append(path)
                seen.add(path)
        for entry in self.directory_entries:
            if entry.path in seen:
                continue
            if entry.open_as_dataset or (entry.supported and not entry.is_directory):
                candidates.append(entry.path)
                seen.add(entry.path)
        return candidates

    def _refresh_batch_candidates(self) -> None:
        if not hasattr(self, "batch_file_list"):
            return
        selected_paths = set(self._selected_batch_paths())
        default_selected = set(self.state.open_files)
        candidates = self._batch_candidate_paths()
        self.batch_file_list.blockSignals(True)
        self.batch_file_list.clear()
        for path in candidates:
            item = QListWidgetItem(Path(path).name or path)
            item.setData(Qt.UserRole, path)
            item.setToolTip(path)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            should_select = path in selected_paths or (
                not selected_paths and path in default_selected
            )
            item.setCheckState(Qt.Checked if should_select else Qt.Unchecked)
            self.batch_file_list.addItem(item)
        self.batch_file_list.blockSignals(False)
        self.batch_run_button.setEnabled(bool(candidates))
        if not candidates:
            self.batch_status_label.setText(
                "Open files or browse a supported data directory to seed the batch queue."
            )

    def _selected_batch_paths(self) -> List[str]:
        if not hasattr(self, "batch_file_list"):
            return []
        selected: List[str] = []
        for index in range(self.batch_file_list.count()):
            item = self.batch_file_list.item(index)
            if item.checkState() == Qt.Checked:
                value = item.data(Qt.UserRole)
                if isinstance(value, str):
                    selected.append(value)
        return selected

    def _select_all_batch_files(self) -> None:
        for index in range(self.batch_file_list.count()):
            self.batch_file_list.item(index).setCheckState(Qt.Checked)

    def _select_open_batch_files(self) -> None:
        open_paths = set(self.state.open_files)
        for index in range(self.batch_file_list.count()):
            item = self.batch_file_list.item(index)
            item.setCheckState(
                Qt.Checked if item.data(Qt.UserRole) in open_paths else Qt.Unchecked
            )

    def _refresh_batch_results(self) -> None:
        if not hasattr(self, "batch_results_table"):
            return
        history = self.state.dda_history_summaries
        self.batch_results_table.setRowCount(len(history))
        for row, result in enumerate(history):
            values = [
                result.file_name,
                result.id[:8],
                ", ".join(result.variant_ids),
                result.created_at_iso,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                item.setData(Qt.UserRole, result.id)
                self.batch_results_table.setItem(row, column, item)
        if history:
            self.batch_status_label.setText(
                f"{len(history)} batch/result history entr{'y' if len(history) == 1 else 'ies'} available."
            )
            latest_summary = history[0]
            latest = self._load_dda_result_from_history(latest_summary.id)
            self.batch_details.setPlainText(
                f"Latest result: {latest_summary.file_name}\n"
                f"Engine: {(latest.engine_label if latest is not None else latest_summary.engine_label) or '—'}\n"
                f"Variants: {', '.join(latest_summary.variant_ids) or '—'}\n"
                f"Created: {latest_summary.created_at_iso}"
            )
        else:
            self.batch_details.setPlainText("")

    def _run_batch_analysis(self) -> None:
        candidate_paths = self._selected_batch_paths()
        if not candidate_paths:
            self._show_error("Select at least one file before starting batch analysis.")
            return
        selected_channel_names = self._selected_channel_names()
        variant_ids = [
            key
            for key, checkbox in self.variant_checkboxes.items()
            if checkbox.isChecked()
        ]
        if not variant_ids:
            self._show_error(
                "Select at least one DDA variant before starting batch analysis."
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
        self.batch_status_label.setText(
            f"Running batch analysis across {len(candidate_paths)} file(s)…"
        )
        self.batch_details.setPlainText("Submitting batch analysis…")

        def task() -> object:
            results: List[DdaResult] = []
            failures: List[str] = []
            for path in candidate_paths:
                try:
                    dataset = self.backend.load_dataset(path)
                    channel_names = (
                        selected_channel_names
                        or dataset.channel_names[: min(8, len(dataset.channel_names))]
                    )
                    selected_indices = [
                        dataset.channel_names.index(name)
                        for name in channel_names
                        if name in dataset.channel_names
                    ]
                    if not selected_indices:
                        raise RuntimeError("No analyzable channels")
                    results.append(
                        self.backend.run_dda(
                            dataset=dataset,
                            selected_channel_indices=selected_indices,
                            selected_variants=variant_ids,
                            window_length_samples=window_length_samples,
                            window_step_samples=window_step_samples,
                            delays=delays,
                            start_time_seconds=start,
                            end_time_seconds=end,
                        )
                    )
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"{Path(path).name}: {exc}")
            return {"results": results, "failures": failures}

        def on_success(result: object) -> None:
            payload = result if isinstance(result, dict) else {}
            results = payload.get("results") or []
            failures = payload.get("failures") or []
            if results:
                for batch_result in results:
                    if isinstance(batch_result, DdaResult):
                        self._remember_dda_result(batch_result)
                self._apply_dda_result(results[-1], persist=False)
            self.batch_status_label.setText(
                f"Batch finished: {len(results)}/{len(candidate_paths)} succeeded"
            )
            detail_lines = [f"Completed: {len(results)}", f"Failed: {len(failures)}"]
            if failures:
                detail_lines.extend(["", *failures[:10]])
            self.batch_details.setPlainText("\n".join(detail_lines))
            self._refresh_batch_results()
            self._record_workflow_action(
                "run-batch-dda",
                f"Ran batch DDA across {len(candidate_paths)} file(s)",
                {
                    "successes": str(len(results)),
                    "failures": str(len(failures)),
                },
            )
            self._notify(
                "analysis",
                "info" if results else "error",
                "Batch Finished",
                f"{len(results)} of {len(candidate_paths)} file(s) completed",
            )

        def on_error(message: str) -> None:
            self.batch_status_label.setText("Batch analysis failed")
            self.batch_details.setPlainText(message)
            self._notify("analysis", "error", "Batch Failed", message)

        self._run_task(task, on_success, on_error)

    def _connectivity_candidates(self) -> List[DdaResult]:
        return [
            summary
            for summary in self.state.dda_history_summaries
            if any(variant_id in {"CD", "CT", "SY"} for variant_id in summary.variant_ids)
        ]

    def _refresh_connectivity_sources(self) -> None:
        if not hasattr(self, "connectivity_result_combo"):
            return
        current_id = self.connectivity_result_combo.currentData()
        candidates = self._connectivity_candidates()
        with QSignalBlocker(self.connectivity_result_combo):
            self.connectivity_result_combo.clear()
            for result in candidates:
                self.connectivity_result_combo.addItem(
                    f"{result.file_name} • {result.created_at_iso}",
                    result.id,
                )
            if candidates:
                index = self.connectivity_result_combo.findData(current_id)
                self.connectivity_result_combo.setCurrentIndex(
                    index if index >= 0 else 0
                )

    def _refresh_connectivity_view(self) -> None:
        if not hasattr(self, "connectivity_table"):
            return
        result_id = self.connectivity_result_combo.currentData()
        candidates = self._connectivity_candidates()
        selected_summary = next(
            (item for item in candidates if item.id == result_id),
            candidates[0] if candidates else None,
        )
        selected = (
            self._load_dda_result_from_history(selected_summary.id)
            if selected_summary is not None
            else None
        )
        if selected is None:
            self.connectivity_summary.setPlainText(
                "Run DDA with CT, CD, or SY to inspect connectivity metrics."
            )
            self.connectivity_table.setRowCount(0)
            return
        variant = next((item for item in selected.variants if item.id == "CD"), None)
        if variant is None:
            variant = next(
                (item for item in selected.variants if item.id in {"CT", "SY"}), None
            )
        metrics = _build_connectivity_metrics(variant) if variant is not None else []
        self.connectivity_summary.setPlainText(
            f"File: {selected.file_name}\n"
            f"Variant: {variant.id if variant else '—'}\n"
            f"Rows: {len(variant.row_labels) if variant else 0}\n"
            f"Metrics: {len(metrics)}"
        )
        visible_metrics = metrics[:24]
        self.connectivity_table.setRowCount(len(visible_metrics))
        for row, metric in enumerate(visible_metrics):
            values = [
                metric["label"],
                f"{metric['mean_absolute']:.4f}",
                f"{metric['peak_absolute']:.4f}",
            ]
            for column, value in enumerate(values):
                self.connectivity_table.setItem(row, column, QTableWidgetItem(value))

    def _compare_candidates(self) -> list:
        return list(self.state.dda_history_summaries)

    def _refresh_compare_sources(self) -> None:
        if not hasattr(self, "compare_baseline_combo"):
            return
        baseline_id = self.compare_baseline_combo.currentData()
        target_id = self.compare_target_combo.currentData()
        candidates = self._compare_candidates()
        with (
            QSignalBlocker(self.compare_baseline_combo),
            QSignalBlocker(self.compare_target_combo),
        ):
            self.compare_baseline_combo.clear()
            self.compare_target_combo.clear()
            for result in candidates:
                label = f"{result.file_name} • {result.created_at_iso}"
                self.compare_baseline_combo.addItem(label, result.id)
                self.compare_target_combo.addItem(label, result.id)
            if candidates:
                baseline_index = self.compare_baseline_combo.findData(baseline_id)
                self.compare_baseline_combo.setCurrentIndex(
                    baseline_index if baseline_index >= 0 else 0
                )
                target_index = self.compare_target_combo.findData(target_id)
                if target_index < 0:
                    target_index = 1 if len(candidates) > 1 else 0
                self.compare_target_combo.setCurrentIndex(target_index)

    def _refresh_compare_view(self) -> None:
        if not hasattr(self, "compare_table"):
            return
        candidates = self._compare_candidates()
        baseline_id = self.compare_baseline_combo.currentData()
        target_id = self.compare_target_combo.currentData()
        baseline_summary = next(
            (item for item in candidates if item.id == baseline_id), None
        )
        target_summary = next((item for item in candidates if item.id == target_id), None)
        baseline = (
            self._load_dda_result_from_history(baseline_summary.id)
            if baseline_summary is not None
            else None
        )
        target = (
            self._load_dda_result_from_history(target_summary.id)
            if target_summary is not None
            else None
        )
        if baseline is None or target is None or baseline.id == target.id:
            self.compare_summary.setPlainText(
                "Select two distinct analyses to compare their variant-level changes."
            )
            self.compare_table.setRowCount(0)
            return
        comparisons = _build_variant_comparisons(baseline, target)
        self.compare_summary.setPlainText(
            f"Baseline: {baseline.file_name}\n"
            f"Target: {target.file_name}\n"
            f"Shared variants: {len(comparisons)}"
        )
        self.compare_table.setRowCount(len(comparisons))
        for row, metric in enumerate(comparisons):
            values = [
                metric["variant_id"],
                f"{metric['baseline_mean_abs']:.4f}",
                f"{metric['target_mean_abs']:.4f}",
                f"{metric['delta']:.4f}",
                metric["top_changed_row"] or "—",
            ]
            for column, value in enumerate(values):
                self.compare_table.setItem(row, column, QTableWidgetItem(value))

    def _run_ica(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._show_error("Open a dataset before running ICA.")
            return
        selected_channel_names = self._selected_channel_names()
        if len(selected_channel_names) < 2:
            self._show_error("Select at least two channels before running ICA.")
            return
        selected_indices = [
            dataset.channel_names.index(name)
            for name in selected_channel_names
            if name in dataset.channel_names
        ]
        start_text = self.ica_start_edit.text().strip()
        end_text = self.ica_end_edit.text().strip()
        start_seconds = float(start_text) if start_text else None
        end_seconds = float(end_text) if end_text else None
        n_components = self.ica_n_components_spin.value() or None
        max_iterations = self.ica_max_iterations_spin.value()
        tolerance = float(self.ica_tolerance_spin.value())
        centering = self.ica_centering_checkbox.isChecked()
        whitening = self.ica_whitening_checkbox.isChecked()
        self.ica_diagnostics.setPlainText("Submitting ICA analysis to backend…")

        def task() -> object:
            return self.backend.run_ica(
                dataset=dataset,
                selected_channel_indices=selected_indices,
                start_time_seconds=start_seconds,
                end_time_seconds=end_seconds,
                n_components=n_components,
                max_iterations=max_iterations,
                tolerance=tolerance,
                centering=centering,
                whitening=whitening,
            )

        def on_success(result: object) -> None:
            ica_result = result
            self.ica_diagnostics.setPlainText("ICA completed successfully.")
            self._apply_ica_result(ica_result)
            self._record_workflow_action(
                "run-ica",
                f"Ran ICA on {dataset.file_name}",
                {
                    "channels": ", ".join(selected_channel_names),
                    "components": str(n_components or "auto"),
                },
                file_path=dataset.file_path,
            )
            self._notify(
                "analysis",
                "info",
                "ICA Completed",
                f"{dataset.file_name} • {len(ica_result.components)} components",
            )

        def on_error(message: str) -> None:
            self.ica_diagnostics.setPlainText(f"ICA failed:\n{message}")
            self._notify("analysis", "error", "ICA Failed", message)

        self._run_task(task, on_success, on_error)
