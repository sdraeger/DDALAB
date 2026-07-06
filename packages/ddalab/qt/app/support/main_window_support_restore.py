from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import uuid
from typing import List, Optional

from PySide6.QtCore import (
    QEvent,
    QSignalBlocker,
)
from PySide6.QtWidgets import (
    QFileDialog,
    QMessageBox,
)

from ...domain.file_types import open_file_dialog_filter
from ...domain.models import (
    DdaResult,
    DdaReproductionConfig,
    DdaVariantResult,
    IcaComponent,
    IcaResult,
    NetworkMotifData,
    WaveformAnnotation,
    WorkflowActionEntry,
)
from ..core.analysis_input import parse_time_bounds
from ..core.snapshot_payload import (
    first_missing_snapshot_source,
    missing_snapshot_source_name,
    relink_snapshot_payload,
)
from ..runtime.runtime_logging import add_log_file_hint


class MainWindowSupportRestoreMixin:
    def _workflow_payload(self) -> dict:
        return {
            "name": (
                f"{Path(self.state.active_file_path).name} action log"
                if self.state.active_file_path
                else "DDALAB action log"
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
        try:
            delays = self._parse_dda_delay_values()
        except ValueError:
            delays = self._safe_dda_delay_values()
        try:
            start_time_seconds, end_time_seconds = parse_time_bounds(
                self.dda_start_edit.text(),
                self.dda_end_edit.text(),
                label="DDA time range",
                default_start=0.0,
            )
        except ValueError:
            start_time_seconds, end_time_seconds = 0.0, None
        return {
            "expertMode": self.state.expert_mode,
            "variantIds": selected_variants,
            "windowLengthSamples": self.window_length_spin.value(),
            "windowStepSamples": self.window_step_spin.value(),
            "delays": delays,
            "modelTerms": self._current_dda_model_terms(),
            "modelDimension": self.dda_model_dimension_spin.value(),
            "polynomialOrder": self.dda_polynomial_order_spin.value(),
            "nrTau": self.dda_nr_tau_spin.value(),
            "startTimeSeconds": start_time_seconds,
            "endTimeSeconds": end_time_seconds,
            "variantChannelNames": self._current_dda_variant_channel_payload(),
            "variantChannelPairs": self._current_dda_variant_pair_payload(),
        }

    def _apply_dda_config_payload(self, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        if "expertMode" in payload:
            self._apply_expert_mode(payload.get("expertMode"), schedule_save=False)
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
        restored_nr_tau: Optional[int] = None
        try:
            if payload.get("modelDimension") is not None:
                self.dda_model_dimension_spin.setValue(int(payload["modelDimension"]))
            if payload.get("polynomialOrder") is not None:
                self.dda_polynomial_order_spin.setValue(int(payload["polynomialOrder"]))
            if payload.get("nrTau") is not None:
                restored_nr_tau = int(payload["nrTau"])
                self.dda_nr_tau_spin.setValue(restored_nr_tau)
        except (TypeError, ValueError):
            pass
        delays = payload.get("delays")
        if isinstance(delays, list):
            restored_delays: List[int] = []
            for value in delays:
                if value is None:
                    continue
                try:
                    parsed = int(value)
                except (TypeError, ValueError):
                    continue
                if parsed < 0:
                    continue
                restored_delays.append(parsed)
            required_delay_count = self._required_dda_delay_count(restored_nr_tau)
            if len(restored_delays) < required_delay_count:
                with QSignalBlocker(self.dda_nr_tau_spin):
                    self.dda_nr_tau_spin.setValue(self.DDA_DEFAULT_NR_TAU)
                with QSignalBlocker(self.delays_edit):
                    self.delays_edit.setText(
                        ",".join(str(delay) for delay in self.DDA_DEFAULT_DELAYS)
                    )
            else:
                with QSignalBlocker(self.delays_edit):
                    self.delays_edit.setText(
                        ",".join(str(delay) for delay in restored_delays)
                    )
        if isinstance(payload.get("modelTerms"), list):
            restored_terms: List[int] = []
            for value in payload["modelTerms"]:
                if value is None:
                    continue
                try:
                    restored_terms.append(int(value))
                except (TypeError, ValueError):
                    continue
            self._dda_model_terms = restored_terms
        start_seconds = payload.get("startTimeSeconds")
        if start_seconds is not None:
            self.dda_start_edit.setText(f"{float(start_seconds):.6g}")
        end_seconds = payload.get("endTimeSeconds")
        if end_seconds is not None:
            self.dda_end_edit.setText(f"{float(end_seconds):.6g}")
        elif "endTimeSeconds" in payload:
            self.dda_end_edit.clear()
        self._refresh_dda_model_term_list()
        self._refresh_dda_expert_mode_ui()
        self._apply_dda_variant_channel_payload(payload.get("variantChannelNames"))
        self._apply_dda_variant_pair_payload(payload.get("variantChannelPairs"))

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
                        column_count=int(
                            raw_variant.get("column_count")
                            or raw_variant.get("columnCount")
                            or 0
                        ),
                        row_mean_absolute=[
                            float(value)
                            for value in (
                                raw_variant.get("row_mean_absolute")
                                or raw_variant.get("rowMeanAbsolute")
                                or []
                            )
                        ],
                        row_peak_absolute=[
                            float(value)
                            for value in (
                                raw_variant.get("row_peak_absolute")
                                or raw_variant.get("rowPeakAbsolute")
                                or []
                            )
                        ],
                        network_motifs=(
                            NetworkMotifData.from_json(
                                raw_variant.get("network_motifs")
                                or raw_variant.get("networkMotifs")
                            )
                            if isinstance(
                                raw_variant.get("network_motifs")
                                or raw_variant.get("networkMotifs"),
                                dict,
                            )
                            else None
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
            reproduction=(
                DdaReproductionConfig.from_json(payload["reproduction"])
                if isinstance(payload.get("reproduction"), dict)
                else None
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

    def _apply_dda_result(
        self,
        result: Optional[DdaResult],
        *,
        persist: bool = True,
        render_variant_view: bool = True,
        refresh_auxiliary_views: bool = True,
    ) -> None:
        self.state.dda_result = result
        self.state.selected_results_history_id = (
            result.id if result is not None else None
        )
        self.variant_combo.blockSignals(True)
        self.variant_combo.clear()
        self.variant_combo.blockSignals(False)
        preferred_variant_id = self._active_variant_id
        self._active_variant_id = None
        if result is None:
            self.dda_diagnostics.setPlainText("")
            self.result_summary.setPlainText("")
            self.heatmap_widget.set_variant(None)
            self.dda_lineplot_widget.set_variant(None)
            self._refresh_results_page()
            if refresh_auxiliary_views:
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
            available_variant_ids = [variant.id for variant in result.variants]
            self._active_variant_id = (
                preferred_variant_id
                if preferred_variant_id in available_variant_ids
                else result.variants[0].id
            )
            active_index = self.variant_combo.findData(self._active_variant_id)
            self.variant_combo.setCurrentIndex(active_index if active_index >= 0 else 0)
            if (
                render_variant_view
                and self._current_primary_section() == "Run DDA"
                and self._current_secondary_section() == "DDA"
            ):
                self._update_variant_view()
            elif (
                self._current_primary_section() == "Run DDA"
                and self._current_secondary_section() == "DDA"
            ):
                self.heatmap_widget.set_variant(None)
                self.dda_lineplot_widget.set_variant(None)
        else:
            self.heatmap_widget.set_variant(None)
            self.dda_lineplot_widget.set_variant(None)
        self._refresh_results_page()
        if refresh_auxiliary_views:
            self._refresh_batch_results()
            self._refresh_connectivity_sources()
            self._refresh_compare_sources()
            current_primary = self._current_primary_section()
            current_secondary = self._current_secondary_section()
            if current_primary == "Run DDA" and current_secondary == "Connectivity":
                self._refresh_connectivity_view()
            if current_primary == "Run DDA" and current_secondary == "Compare":
                self._refresh_compare_view()

    def _current_primary_section(self) -> Optional[str]:
        if not hasattr(self, "primary_nav"):
            return None
        index = self.primary_nav.currentIndex()
        if index < 0 or index >= len(self.primary_sections):
            return None
        return self.primary_sections[index]

    def _current_secondary_section(self) -> Optional[str]:
        current_primary = self._current_primary_section()
        if current_primary is None or not hasattr(self, "secondary_nav"):
            return None
        tabs = self.secondary_sections.get(current_primary, [])
        index = self.secondary_nav.currentIndex()
        if index < 0 or index >= len(tabs):
            return None
        return tabs[index]

    def _apply_session_restore_to_dataset(self, payload: dict) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        selected_channels = payload.get("selectedChannelNames")
        if isinstance(selected_channels, list):
            dataset_channel_names = set(dataset.channel_names)
            restored_names = [
                str(name)
                for name in selected_channels
                if isinstance(name, str) and name in dataset_channel_names
            ]
            if restored_names:
                self.state.selected_channel_names = restored_names
                self._populate_channels()
        viewport = payload.get("viewport")
        if isinstance(viewport, dict):
            try:
                self.state.waveform_viewport_start_seconds = float(
                    viewport.get(
                        "startSeconds", self.state.waveform_viewport_start_seconds
                    )
                )
                self.state.waveform_viewport_duration_seconds = float(
                    viewport.get(
                        "durationSeconds", self.state.waveform_viewport_duration_seconds
                    )
                )
            except (TypeError, ValueError):
                pass
        selected_history_id = payload.get("selectedResultsHistoryId")
        if isinstance(selected_history_id, str) and selected_history_id:
            self.state.selected_results_history_id = selected_history_id
        active_variant_id = payload.get("activeVariantId")
        if isinstance(active_variant_id, str) and active_variant_id:
            self._active_variant_id = active_variant_id
        active_selector_variant_id = payload.get("activeDdaSelectorVariantId")
        if isinstance(active_selector_variant_id, str) and active_selector_variant_id:
            self._active_dda_selector_variant_id = active_selector_variant_id
        self._apply_dda_config_payload(payload.get("ddaConfig"))
        self._apply_compare_config_payload(payload.get("compareConfig"))

    def _apply_snapshot_restore_to_dataset(self, payload: dict) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        self._apply_session_restore_to_dataset(payload)
        if not self.state.selected_channel_names:
            self.state.selected_channel_names = dataset.channel_names[
                : min(8, len(dataset.channel_names))
            ]
            self._populate_channels()
        self._update_dataset_ui()
        self._load_waveform_data()
        self._schedule_overview_reload(force=True)
        self._apply_dda_result(self._restore_dda_result(payload.get("ddaResult")))
        self._apply_ica_result(self._restore_ica_result(payload.get("icaResult")))

    def _apply_snapshot_payload(self, payload: dict) -> None:
        self._apply_dda_config_payload(payload.get("ddaConfig"))
        self._apply_compare_config_payload(payload.get("compareConfig"))
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
        pinned_files = payload.get("pinnedFiles")
        if isinstance(open_files, list):
            normalized_files: List[str] = []
            seen: set[str] = set()
            for value in open_files:
                if not isinstance(value, str) or not value or value in seen:
                    continue
                if not Path(value).exists():
                    continue
                normalized_files.append(value)
                seen.add(value)
            if normalized_files:
                self.state.open_files = normalized_files
                normalized_pinned_files = (
                    pinned_files if isinstance(pinned_files, list) else []
                )
                self.state.pinned_file_paths = [
                    path
                    for path in normalized_pinned_files
                    if isinstance(path, str) and path in normalized_files
                ]
                self._rebuild_file_tabs(
                    current_path=target_file if isinstance(target_file, str) else None
                )
        if isinstance(target_file, str) and target_file:
            if Path(target_file).exists():
                self._pending_snapshot_restore = payload
                self._open_dataset(target_file)
                return
            relinked_path = self._prompt_snapshot_source_relink(payload)
            if relinked_path is not None:
                self._pending_snapshot_restore = relink_snapshot_payload(
                    payload,
                    old_path=target_file,
                    new_path=relinked_path,
                )
                self._open_dataset(relinked_path)
                return
            self._notify(
                "snapshot",
                "error",
                "Snapshot Source Missing",
                f"Could not reopen {target_file}. Restored exports and annotations only.",
            )
        self._refresh_results_page()

    def _prompt_snapshot_source_relink(self, payload: dict) -> Optional[str]:
        missing_path = first_missing_snapshot_source(payload) or ""
        dataset_name = missing_snapshot_source_name(payload, missing_path)
        missing_target = Path(missing_path) if missing_path else Path()
        start_dir = str(
            missing_target.parent
            if missing_path and missing_target.parent.exists()
            else Path.home()
        )
        if missing_path and missing_target.suffix.lower() in {".ds", ".mff"}:
            replacement_path = QFileDialog.getExistingDirectory(
                self,
                f"Locate {dataset_name}",
                start_dir,
            )
            return replacement_path or None
        replacement_path, _ = QFileDialog.getOpenFileName(
            self,
            f"Locate {dataset_name}",
            start_dir,
            open_file_dialog_filter(),
        )
        if not replacement_path:
            return None
        return replacement_path

    def _show_error(self, message: str) -> None:
        self._notify("system", "error", "Error", message, show_status=False)
        QMessageBox.critical(self, "DDALAB Qt", add_log_file_hint(message))

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
