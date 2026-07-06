from __future__ import annotations

import math
from typing import Dict, List

from PySide6.QtCore import QSignalBlocker, Qt
from PySide6.QtWidgets import (
    QListWidgetItem,
    QTableWidgetItem,
)

from ...domain.models import (
    DdaResult,
)
from ..core.analysis_input import parse_time_bounds

from .main_window_analysis_helpers import (
    _build_compare_view_payload,
    _default_compare_row_labels_from_stats,
    _format_compare_numeric,
    _ordered_shared_variant_ids,
)


class MainWindowAnalysisCompareMixin:
    def _current_compare_config_payload(self) -> Dict[str, object]:
        baseline_id = (
            self.compare_baseline_combo.currentData()
            if hasattr(self, "compare_baseline_combo")
            else self._compare_baseline_id
        )
        target_id = (
            self.compare_target_combo.currentData()
            if hasattr(self, "compare_target_combo")
            else self._compare_target_id
        )
        variant_id = (
            self.compare_variant_combo.currentData()
            if hasattr(self, "compare_variant_combo")
            else self._compare_variant_id
        )
        return {
            "baselineId": str(baseline_id) if isinstance(baseline_id, str) else None,
            "targetId": str(target_id) if isinstance(target_id, str) else None,
            "variantId": str(variant_id) if isinstance(variant_id, str) else None,
            "viewMode": self._compare_view_mode,
            "selectedRowLabels": self._selected_compare_row_labels(),
        }

    def _apply_compare_config_payload(self, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        baseline_id = payload.get("baselineId")
        target_id = payload.get("targetId")
        variant_id = payload.get("variantId")
        view_mode = payload.get("viewMode")
        selected_rows = payload.get("selectedRowLabels")
        self._compare_baseline_id = (
            baseline_id if isinstance(baseline_id, str) else None
        )
        self._compare_target_id = target_id if isinstance(target_id, str) else None
        self._compare_variant_id = variant_id if isinstance(variant_id, str) else None
        self._compare_view_mode = (
            view_mode
            if isinstance(view_mode, str) and view_mode in self.COMPARE_VIEW_MODE_ORDER
            else "summary"
        )
        self._compare_selected_row_labels = (
            [str(label) for label in selected_rows if isinstance(label, str)]
            if isinstance(selected_rows, list)
            else []
        )
        self._compare_row_context_key = None
        if hasattr(self, "compare_view_nav"):
            self._set_compare_view_mode(self._compare_view_mode, schedule_save=False)

    def _compare_view_mode_index(self, mode: str) -> int:
        try:
            return self.COMPARE_VIEW_MODE_ORDER.index(mode)
        except ValueError:
            return 0

    def _set_compare_view_mode(
        self,
        mode: str,
        *,
        schedule_save: bool = True,
    ) -> None:
        normalized = (
            mode
            if mode in self.COMPARE_VIEW_MODE_ORDER
            else self.COMPARE_VIEW_MODE_ORDER[0]
        )
        self._compare_view_mode = normalized
        if hasattr(self, "compare_view_nav"):
            index = self._compare_view_mode_index(normalized)
            with QSignalBlocker(self.compare_view_nav):
                self.compare_view_nav.setCurrentIndex(index)
            self.compare_view_stack.setCurrentIndex(index)
        if schedule_save:
            self._schedule_session_save()

    def _selected_compare_row_labels(self) -> List[str]:
        if not hasattr(self, "compare_row_list"):
            return list(self._compare_selected_row_labels)
        labels: List[str] = []
        for index in range(self.compare_row_list.count()):
            item = self.compare_row_list.item(index)
            if item.checkState() != Qt.Checked:
                continue
            label = item.data(Qt.UserRole)
            if isinstance(label, str):
                labels.append(label)
        self._compare_selected_row_labels = list(labels)
        return labels

    def _on_compare_source_changed(self) -> None:
        self._compare_baseline_id = (
            self.compare_baseline_combo.currentData()
            if isinstance(self.compare_baseline_combo.currentData(), str)
            else None
        )
        self._compare_target_id = (
            self.compare_target_combo.currentData()
            if isinstance(self.compare_target_combo.currentData(), str)
            else None
        )
        self._compare_selected_row_labels = []
        self._compare_row_context_key = None
        self._refresh_compare_view()
        self._schedule_session_save()

    def _on_compare_variant_changed(self) -> None:
        self._compare_variant_id = (
            self.compare_variant_combo.currentData()
            if isinstance(self.compare_variant_combo.currentData(), str)
            else None
        )
        self._compare_selected_row_labels = []
        self._compare_row_context_key = None
        self._refresh_compare_view()
        self._schedule_session_save()

    def _on_compare_view_mode_changed(self, index: int) -> None:
        if index < 0 or index >= len(self.COMPARE_VIEW_MODE_ORDER):
            return
        self._set_compare_view_mode(
            self.COMPARE_VIEW_MODE_ORDER[index], schedule_save=False
        )
        self._schedule_session_save()

    def _on_compare_row_selection_changed(self, _item) -> None:
        self._compare_selected_row_labels = self._selected_compare_row_labels()
        self._refresh_compare_row_summary_label()
        self._refresh_compare_view()
        self._schedule_session_save()

    def _swap_compare_sources(self) -> None:
        baseline_id = self.compare_baseline_combo.currentData()
        target_id = self.compare_target_combo.currentData()
        if not isinstance(baseline_id, str) or not isinstance(target_id, str):
            return
        baseline_index = self.compare_baseline_combo.findData(target_id)
        target_index = self.compare_target_combo.findData(baseline_id)
        if baseline_index < 0 or target_index < 0:
            return
        with (
            QSignalBlocker(self.compare_baseline_combo),
            QSignalBlocker(self.compare_target_combo),
        ):
            self.compare_baseline_combo.setCurrentIndex(baseline_index)
            self.compare_target_combo.setCurrentIndex(target_index)
        self._compare_baseline_id = target_id
        self._compare_target_id = baseline_id
        self._compare_selected_row_labels = []
        self._compare_row_context_key = None
        self._refresh_compare_view()
        self._schedule_session_save()

    def _set_compare_row_selection(
        self,
        row_labels: List[str],
        *,
        schedule_save: bool = True,
    ) -> None:
        self._compare_selected_row_labels = list(row_labels)
        if hasattr(self, "compare_row_list"):
            selected_lookup = set(row_labels)
            with QSignalBlocker(self.compare_row_list):
                for index in range(self.compare_row_list.count()):
                    item = self.compare_row_list.item(index)
                    label = item.data(Qt.UserRole)
                    item.setCheckState(
                        Qt.Checked
                        if isinstance(label, str) and label in selected_lookup
                        else Qt.Unchecked
                    )
        self._refresh_compare_row_summary_label()
        self._refresh_compare_view()
        if schedule_save:
            self._schedule_session_save()

    def _select_all_compare_rows(self) -> None:
        labels: List[str] = []
        for index in range(self.compare_row_list.count()):
            item = self.compare_row_list.item(index)
            label = item.data(Qt.UserRole)
            if isinstance(label, str):
                labels.append(label)
        self._set_compare_row_selection(labels)

    def _clear_compare_rows(self) -> None:
        self._set_compare_row_selection([])

    def _select_top_changed_compare_rows(self) -> None:
        row_stats = getattr(self, "_latest_compare_row_stats", [])
        top_labels = self._default_compare_row_labels(row_stats)
        self._set_compare_row_selection(top_labels)

    def _on_compare_variant_table_selection_changed(self) -> None:
        if not hasattr(self, "compare_table"):
            return
        selected_rows = self.compare_table.selectionModel().selectedRows()
        if not selected_rows:
            return
        item = self.compare_table.item(selected_rows[0].row(), 0)
        variant_id = item.data(Qt.UserRole) if item is not None else None
        if not isinstance(variant_id, str):
            return
        combo_index = self.compare_variant_combo.findData(variant_id)
        if (
            combo_index >= 0
            and combo_index != self.compare_variant_combo.currentIndex()
        ):
            self.compare_variant_combo.setCurrentIndex(combo_index)

    def _compare_candidates(self) -> list:
        return list(self.state.dda_history_summaries)

    def _ordered_compare_variant_ids(
        self,
        baseline: DdaResult,
        target: DdaResult,
    ) -> List[str]:
        return _ordered_shared_variant_ids(
            baseline,
            target,
            list(self.DDA_VARIANT_ORDER),
        )

    def _refresh_compare_sources(self) -> None:
        if not hasattr(self, "compare_baseline_combo"):
            return
        baseline_id = (
            self._compare_baseline_id or self.compare_baseline_combo.currentData()
        )
        target_id = self._compare_target_id or self.compare_target_combo.currentData()
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
                if baseline_index < 0:
                    baseline_index = 0
                self.compare_baseline_combo.setCurrentIndex(baseline_index)
                target_index = self.compare_target_combo.findData(target_id)
                if target_index < 0 or (
                    baseline_index == target_index and len(candidates) > 1
                ):
                    target_index = 1 if len(candidates) > 1 else 0
                self.compare_target_combo.setCurrentIndex(target_index)
        current_baseline = self.compare_baseline_combo.currentData()
        current_target = self.compare_target_combo.currentData()
        self._compare_baseline_id = (
            current_baseline if isinstance(current_baseline, str) else None
        )
        self._compare_target_id = (
            current_target if isinstance(current_target, str) else None
        )

    def _clear_compare_widgets(self, message: str) -> None:
        self.compare_summary.setPlainText(message)
        self.compare_shared_meta_label.setText(message)
        self.compare_table.setRowCount(0)
        self.compare_stats_table.setRowCount(0)
        self.compare_stats_summary.setPlainText(message)
        with QSignalBlocker(self.compare_variant_combo):
            self.compare_variant_combo.clear()
        with QSignalBlocker(self.compare_row_list):
            self.compare_row_list.clear()
        self.compare_row_summary_label.setText(
            "Choose the shared rows to use in heatmaps, lines, and statistics."
        )
        self.compare_baseline_heatmap.set_variant(None)
        self.compare_difference_heatmap.set_variant(None)
        self.compare_target_heatmap.set_variant(None)
        self.compare_overlay_lineplot.set_variant(None)
        self.compare_difference_lineplot.set_variant(None)
        self._latest_compare_row_stats = []

    def _refresh_compare_row_summary_label(self) -> None:
        if not hasattr(self, "compare_row_summary_label"):
            return
        total_rows = (
            self.compare_row_list.count() if hasattr(self, "compare_row_list") else 0
        )
        selected_rows = len(self._selected_compare_row_labels())
        if total_rows == 0:
            self.compare_row_summary_label.setText(
                "Choose the shared rows to use in heatmaps, lines, and statistics."
            )
            return
        if selected_rows == 0:
            self.compare_row_summary_label.setText(
                f"No rows selected. {total_rows} shared row{'s' if total_rows != 1 else ''} available."
            )
            return
        self.compare_row_summary_label.setText(
            f"{selected_rows} selected of {total_rows} shared row{'s' if total_rows != 1 else ''}."
        )

    def _default_compare_row_labels(self, row_stats: List[dict]) -> List[str]:
        return _default_compare_row_labels_from_stats(row_stats)

    def _populate_compare_row_selector(
        self,
        row_stats: List[dict],
        selected_labels: List[str],
    ) -> None:
        with QSignalBlocker(self.compare_row_list):
            self.compare_row_list.clear()
            selected_lookup = set(selected_labels)
            for metric in row_stats:
                item = QListWidgetItem(
                    f"{metric['row_label']} · mean |diff| {metric['mean_abs_diff']:.4f} · r {metric['correlation']:.3f}"
                    if math.isfinite(metric["correlation"])
                    else f"{metric['row_label']} · mean |diff| {metric['mean_abs_diff']:.4f}"
                )
                item.setData(Qt.UserRole, metric["row_label"])
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(
                    Qt.Checked
                    if metric["row_label"] in selected_lookup
                    else Qt.Unchecked
                )
                self.compare_row_list.addItem(item)
        self._refresh_compare_row_summary_label()

    def _set_compare_loading_state(self, message: str) -> None:
        self.compare_summary.setPlainText(message)
        self.compare_shared_meta_label.setText(message)
        self.compare_stats_summary.setPlainText(message)

    def _apply_compare_view_payload(self, payload: dict) -> None:
        comparisons = list(payload.get("comparisons") or [])
        selected_variant_id = (
            str(payload.get("selected_variant_id"))
            if isinstance(payload.get("selected_variant_id"), str)
            else None
        )
        self.compare_table.setRowCount(len(comparisons))
        with QSignalBlocker(self.compare_table):
            for row, metric in enumerate(comparisons):
                values = [
                    metric["variant_id"],
                    f"{metric['baseline_mean_abs']:.4f}",
                    f"{metric['target_mean_abs']:.4f}",
                    f"{metric['delta']:.4f}",
                    str(metric["shared_row_count"]),
                    metric["top_changed_row"] or "—",
                ]
                for column, value in enumerate(values):
                    item = QTableWidgetItem(value)
                    if column == 0:
                        item.setData(Qt.UserRole, metric["variant_id"])
                    self.compare_table.setItem(row, column, item)
            self.compare_table.clearSelection()
            for row, metric in enumerate(comparisons):
                if metric["variant_id"] == selected_variant_id:
                    self.compare_table.selectRow(row)
                    break

        shared_variant_ids = list(payload.get("shared_variant_ids") or [])
        variant_labels = dict(payload.get("variant_labels") or {})
        with QSignalBlocker(self.compare_variant_combo):
            self.compare_variant_combo.clear()
            for variant_id in shared_variant_ids:
                label = str(variant_labels.get(variant_id) or variant_id)
                self.compare_variant_combo.addItem(label, variant_id)
            if shared_variant_ids and selected_variant_id in shared_variant_ids:
                self.compare_variant_combo.setCurrentIndex(
                    self.compare_variant_combo.findData(selected_variant_id)
                )
        self._compare_variant_id = selected_variant_id

        row_stats = list(payload.get("row_stats") or [])
        selected_rows = list(payload.get("selected_rows") or [])
        self._latest_compare_row_stats = row_stats
        context_key = payload.get("context_key")
        self._compare_row_context_key = (
            tuple(context_key)
            if isinstance(context_key, tuple)
            else tuple(context_key)
            if isinstance(context_key, list)
            else None
        )
        self._compare_selected_row_labels = list(selected_rows)
        self._populate_compare_row_selector(row_stats, selected_rows)

        self.compare_shared_meta_label.setText(
            str(payload.get("shared_meta_text") or "")
        )
        self.compare_summary.setPlainText(str(payload.get("summary_text") or ""))

        scheme = self.heatmap_color_scheme_combo.currentData()
        if isinstance(scheme, str):
            self.compare_baseline_heatmap.set_color_scheme(scheme)
            self.compare_target_heatmap.set_color_scheme(scheme)
        self.compare_difference_heatmap.set_color_scheme("jet")
        self.compare_baseline_heatmap.set_variant(
            payload.get("baseline_display_variant"),
            list(payload.get("baseline_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                selected_variant_id,
                "compare-baseline",
                tuple(selected_rows),
            ),
        )
        self.compare_target_heatmap.set_variant(
            payload.get("target_display_variant"),
            list(payload.get("target_window_centers") or []),
            view_key=(
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-target",
                tuple(selected_rows),
            ),
        )
        self.compare_difference_heatmap.set_variant(
            payload.get("diff_display_variant"),
            list(payload.get("shared_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-diff",
                tuple(selected_rows),
            ),
        )
        self.compare_overlay_lineplot.set_variant(
            payload.get("overlay_display_variant"),
            list(payload.get("shared_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-overlay",
                tuple(selected_rows),
            ),
        )
        self.compare_difference_lineplot.set_variant(
            payload.get("diff_display_variant"),
            list(payload.get("shared_window_centers") or []),
            view_key=(
                payload.get("baseline_result_id"),
                payload.get("target_result_id"),
                selected_variant_id,
                "compare-diff-line",
                tuple(selected_rows),
            ),
        )

        visible_row_stats = list(payload.get("visible_row_stats") or [])
        self.compare_stats_table.setRowCount(len(visible_row_stats))
        for row, metric in enumerate(visible_row_stats):
            values = [
                metric["row_label"],
                _format_compare_numeric(metric["correlation"]),
                f"{metric['baseline_mean_abs']:.4f}",
                f"{metric['target_mean_abs']:.4f}",
                f"{metric['mean_abs_diff']:.4f}",
                f"{metric['max_abs_diff']:.4f}",
                f"{metric['rms_diff']:.4f}",
            ]
            for column, value in enumerate(values):
                self.compare_stats_table.setItem(row, column, QTableWidgetItem(value))
        self.compare_stats_summary.setPlainText(
            str(payload.get("stats_summary_text") or "")
        )

    def _refresh_compare_view(self) -> None:
        if not hasattr(self, "compare_table"):
            return
        self._compare_refresh_serial += 1
        refresh_serial = self._compare_refresh_serial
        candidates = self._compare_candidates()
        baseline_id = self.compare_baseline_combo.currentData()
        target_id = self.compare_target_combo.currentData()
        baseline_summary = next(
            (item for item in candidates if item.id == baseline_id), None
        )
        target_summary = next(
            (item for item in candidates if item.id == target_id), None
        )
        baseline = (
            self._cached_history_result(baseline_summary.id)
            if baseline_summary is not None
            else None
        )
        target = (
            self._cached_history_result(target_summary.id)
            if target_summary is not None
            else None
        )
        missing_ids = [
            summary.id
            for summary, result in (
                (baseline_summary, baseline),
                (target_summary, target),
            )
            if summary is not None and (result is None or result.id != summary.id)
        ]
        if missing_ids:
            self._clear_compare_widgets("Loading saved analyses for comparison…")
            for result_id in missing_ids:
                self._load_dda_result_from_history_async(
                    result_id,
                    lambda _result: self._refresh_compare_view(),
                )
            return
        if baseline is None or target is None or baseline.id == target.id:
            self._clear_compare_widgets(
                "Select two distinct analyses to compare their shared variants, rows, and trends."
            )
            return
        self._set_compare_loading_state("Computing comparison…")
        requested_variant_id = self._compare_variant_id
        requested_rows = list(self._compare_selected_row_labels)
        previous_context_key = self._compare_row_context_key
        variant_order = list(self.DDA_VARIANT_ORDER)

        def task() -> object:
            return _build_compare_view_payload(
                baseline,
                target,
                requested_variant_id,
                requested_rows,
                previous_context_key,
                variant_order,
            )

        def on_success(result: object) -> None:
            if refresh_serial != self._compare_refresh_serial:
                return
            payload = result if isinstance(result, dict) else {}
            if payload.get("status") != "ready":
                self._clear_compare_widgets(
                    str(
                        payload.get("message")
                        or "Select two distinct analyses to compare their shared variants, rows, and trends."
                    )
                )
                return
            self._apply_compare_view_payload(payload)

        def on_error(message: str) -> None:
            if refresh_serial != self._compare_refresh_serial:
                return
            self._clear_compare_widgets(f"Compare failed:\n{message}")

        self._run_task(task, on_success, on_error)

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
        try:
            start_seconds, end_seconds = parse_time_bounds(
                start_text,
                end_text,
                label="ICA time range",
                default_start=0.0,
            )
        except ValueError as exc:
            self._show_error(str(exc))
            return
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
