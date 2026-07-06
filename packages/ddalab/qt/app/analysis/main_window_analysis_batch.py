from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from time import perf_counter_ns
from typing import Dict, List, Optional

from PySide6.QtCore import QSignalBlocker, Qt
from PySide6.QtWidgets import (
    QFileDialog,
    QListWidgetItem,
    QTableWidgetItem,
)

from ...domain.file_types import open_file_dialog_filter
from ...domain.models import (
    DdaResult,
    NetworkMotifData,
)
from ..core.analysis_input import parse_time_bounds
from ..runtime.perf_logging import perf_logger

from .main_window_analysis_helpers import (
    _build_connectivity_view_payload,
)


class MainWindowAnalysisBatchMixin:
    def _batch_candidate_paths(self) -> List[str]:
        seen: set[str] = set()
        candidates: List[str] = []
        for path in self.state.open_files:
            if path and path not in seen:
                candidates.append(path)
                seen.add(path)
        for path in getattr(self, "_batch_extra_paths", []):
            if path and path not in seen and Path(path).exists():
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
                "Add files, open files, or browse a supported data directory to seed the batch queue."
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

    def _add_batch_files(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(
            self,
            "Add Files to Batch Queue",
            self.state.browser_path or str(self.repo_root),
            open_file_dialog_filter(),
        )
        if not paths:
            return
        seen = set(getattr(self, "_batch_extra_paths", []))
        for path in paths:
            if path and path not in seen:
                self._batch_extra_paths.append(path)
                seen.add(path)
        self._refresh_batch_candidates()
        self.batch_status_label.setText(
            f"Added {len(paths)} file{'s' if len(paths) != 1 else ''} to the batch queue."
        )

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
            self.batch_details.setPlainText(
                f"Latest result: {latest_summary.file_name}\n"
                f"Engine: {latest_summary.engine_label or '—'}\n"
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
        try:
            delays = (
                self._parse_dda_delay_values()
                if self.state.expert_mode
                else list(self.DDA_DEFAULT_DELAYS)
            )
            model_terms, model_dimension, polynomial_order, nr_tau = (
                self._current_dda_model_parameters()
            )
        except ValueError as exc:
            self._show_error(str(exc))
            return
        try:
            start, end = parse_time_bounds(
                self.dda_start_edit.text(),
                self.dda_end_edit.text(),
                label="Batch DDA time range",
                default_start=0.0,
            )
        except ValueError as exc:
            self._show_error(str(exc))
            return
        window_length_samples = self.window_length_spin.value()
        window_step_samples = self.window_step_spin.value()
        batch_workers = self._batch_worker_count(len(candidate_paths))
        self.batch_status_label.setText(
            f"Running batch analysis across {len(candidate_paths)} file(s) with {batch_workers} worker(s)…"
        )
        self.batch_details.setPlainText(
            f"Submitting batch analysis across {batch_workers} worker(s)…"
        )

        def task() -> object:
            batch_started_ns = perf_counter_ns()
            perf_logger().log(
                "dda.batch.start",
                files=len(candidate_paths),
                workers=batch_workers,
                variants=",".join(variant_ids),
                wl=window_length_samples,
                ws=window_step_samples,
                startSeconds=start,
                endSeconds=end,
            )
            results_by_index: Dict[int, DdaResult] = {}
            failures: List[str] = []

            def run_single(
                index: int, path: str
            ) -> tuple[int, Optional[DdaResult], Optional[str]]:
                file_started_ns = perf_counter_ns()
                backend_client = self._build_batch_backend()
                try:
                    dataset = backend_client.load_dataset(path)
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
                    result = backend_client.run_dda(
                        dataset=dataset,
                        selected_channel_indices=selected_indices,
                        selected_variants=variant_ids,
                        window_length_samples=window_length_samples,
                        window_step_samples=window_step_samples,
                        delays=delays,
                        start_time_seconds=start,
                        end_time_seconds=end,
                        model_terms=model_terms,
                        model_dimension=model_dimension,
                        polynomial_order=polynomial_order,
                        nr_tau=nr_tau,
                    )
                    perf_logger().log_duration(
                        "dda.batch.file.complete",
                        file_started_ns,
                        file=path,
                        workers=batch_workers,
                        variants=",".join(variant_ids),
                        channelCount=len(selected_indices),
                    )
                    return index, result, None
                except Exception as exc:  # noqa: BLE001
                    perf_logger().log_duration(
                        "dda.batch.file.error",
                        file_started_ns,
                        file=path,
                        workers=batch_workers,
                        error=str(exc),
                    )
                    return index, None, f"{Path(path).name}: {exc}"
                finally:
                    if backend_client is not self.backend:
                        try:
                            backend_client.close()
                        except Exception:
                            pass

            if batch_workers <= 1:
                for index, path in enumerate(candidate_paths):
                    result_index, result, failure = run_single(index, path)
                    if result is not None:
                        results_by_index[result_index] = result
                    if failure is not None:
                        failures.append(failure)
            else:
                with ThreadPoolExecutor(
                    max_workers=batch_workers,
                    thread_name_prefix="ddalab-batch",
                ) as executor:
                    futures = [
                        executor.submit(run_single, index, path)
                        for index, path in enumerate(candidate_paths)
                    ]
                    for future in as_completed(futures):
                        result_index, result, failure = future.result()
                        if result is not None:
                            results_by_index[result_index] = result
                        if failure is not None:
                            failures.append(failure)

            results = [results_by_index[index] for index in sorted(results_by_index)]
            perf_logger().log_duration(
                "dda.batch.complete",
                batch_started_ns,
                files=len(candidate_paths),
                workers=batch_workers,
                succeeded=len(results),
                failed=len(failures),
            )
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
            if any(
                variant_id in {"CD", "CT", "SY"} for variant_id in summary.variant_ids
            )
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
        self._connectivity_refresh_serial += 1
        refresh_serial = self._connectivity_refresh_serial
        result_id = self.connectivity_result_combo.currentData()
        candidates = self._connectivity_candidates()
        selected_summary = next(
            (item for item in candidates if item.id == result_id),
            candidates[0] if candidates else None,
        )
        selected = (
            self._cached_history_result(selected_summary.id)
            if selected_summary is not None
            else None
        )
        if selected_summary is not None and (
            selected is None or selected.id != selected_summary.id
        ):
            self.connectivity_summary.setPlainText("Loading connectivity views…")
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    "Loading network motif plots…"
                )
            if hasattr(self, "connectivity_motif_widget"):
                self.connectivity_motif_widget.set_motif_data(None)
            self.connectivity_table.setRowCount(0)
            self._load_dda_result_from_history_async(
                selected_summary.id,
                lambda _result: self._refresh_connectivity_view(),
            )
            return
        if selected is None:
            self.connectivity_summary.setPlainText(
                "Run DDA with CT, CD, or SY to inspect connectivity metrics."
            )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    "Run DDA with CD to inspect directed causality motifs."
                )
            if hasattr(self, "connectivity_motif_widget"):
                self.connectivity_motif_widget.set_motif_data(None)
            self.connectivity_table.setRowCount(0)
            return
        self.connectivity_summary.setPlainText("Computing connectivity views…")
        if hasattr(self, "connectivity_motif_summary_label"):
            self.connectivity_motif_summary_label.setText(
                "Building network motif plots from the CD result…"
            )
        if hasattr(self, "connectivity_motif_widget"):
            self.connectivity_motif_widget.set_motif_data(None)
        self.connectivity_table.setRowCount(0)

        def task() -> object:
            return _build_connectivity_view_payload(selected)

        def on_success(result: object) -> None:
            if refresh_serial != self._connectivity_refresh_serial:
                return
            payload = result if isinstance(result, dict) else {}
            metrics = list(payload.get("metrics") or [])
            self.connectivity_summary.setPlainText(
                str(
                    payload.get("summary_text")
                    or "Run DDA with CT, CD, or SY to inspect connectivity metrics."
                )
            )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    str(
                        payload.get("motif_summary")
                        or "Run DDA with CD to inspect directed causality motifs."
                    )
                )
            if hasattr(self, "connectivity_motif_widget"):
                motif_data = payload.get("motif_data")
                self.connectivity_motif_widget.set_motif_data(
                    motif_data if isinstance(motif_data, NetworkMotifData) else None
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
                    self.connectivity_table.setItem(
                        row, column, QTableWidgetItem(value)
                    )

        def on_error(message: str) -> None:
            if refresh_serial != self._connectivity_refresh_serial:
                return
            self.connectivity_summary.setPlainText(
                f"Connectivity metrics failed:\n{message}"
            )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    f"Connectivity motifs failed:\n{message}"
                )
            if hasattr(self, "connectivity_motif_widget"):
                self.connectivity_motif_widget.set_motif_data(None)
            self.connectivity_table.setRowCount(0)

        self._run_task(task, on_success, on_error)
