from __future__ import annotations

from pathlib import Path
from time import perf_counter_ns
from typing import List, Optional
import uuid

from PySide6.QtCore import QPoint, Qt, QSignalBlocker, QTimer
from PySide6.QtWidgets import (
    QComboBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidgetItem,
    QMenu,
    QPushButton,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
)

from ..domain.models import LoadedDataset, WaveformAnnotation
from .perf_logging import perf_logger


class MainWindowVisualizeMixin:
    _COMPANION_CHANNEL_KEYWORDS = (
        "event",
        "stim",
        "trigger",
        "trig",
        "marker",
        "status",
        "annotation",
    )

    def _is_companion_channel_name(self, name: str) -> bool:
        normalized = str(name).strip().lower()
        return any(
            keyword in normalized for keyword in self._COMPANION_CHANNEL_KEYWORDS
        )

    def _preferred_channel_names(
        self,
        dataset: LoadedDataset,
        count: int,
    ) -> List[str]:
        target_count = max(int(count), 0)
        if target_count <= 0:
            return []
        signal_names = [
            channel.name
            for channel in dataset.channels
            if not self._is_companion_channel_name(channel.name)
        ]
        if len(signal_names) >= target_count:
            return signal_names[:target_count]
        fallback_names = [
            channel.name
            for channel in dataset.channels
            if channel.name not in signal_names
        ]
        return [*signal_names, *fallback_names][:target_count]

    def _set_dataset_loading_state(
        self,
        path: Optional[str],
        *,
        detail: Optional[str] = None,
    ) -> None:
        self._dataset_loading_path = path or None
        self._apply_dataset_loading_visuals(
            bool(path),
            path=path,
            detail=detail,
        )

    def _clear_dataset_loading_state(self) -> None:
        self._dataset_loading_path = None
        self._apply_dataset_loading_visuals(False)

    def _apply_dataset_loading_visuals(
        self,
        loading: bool,
        *,
        path: Optional[str] = None,
        detail: Optional[str] = None,
    ) -> None:
        loading_path = path or getattr(self, "_dataset_loading_path", None)
        file_name = (
            Path(loading_path).name or str(loading_path)
            if loading_path
            else "dataset"
        )
        loading_message = detail or (
            f"Loading {file_name} and restoring saved state…"
            if loading_path
            else "Loading dataset metadata…"
        )
        if hasattr(self, "overview_loading_hint"):
            self.overview_loading_hint.setText(loading_message)
            self.overview_loading_hint.setVisible(loading)
        if hasattr(self, "overview_loading_bar"):
            self.overview_loading_bar.setVisible(loading)
            self.overview_loading_bar.set_running(loading)
        for key, value_label in getattr(self, "overview_cards", {}).items():
            if loading:
                value_label.setText("Loading…")
            supporting = getattr(self, "overview_card_supporting", {}).get(key)
            if supporting is not None:
                supporting.setText("Hydrating…" if loading else "")
            loader = getattr(self, "overview_card_loaders", {}).get(key)
            if loader is not None:
                loader.setVisible(loading)
                loader.set_running(loading)
        if not loading:
            return
        if hasattr(self, "dataset_label"):
            self.dataset_label.setText(file_name)
        if hasattr(self, "file_status_label") and loading_path:
            self.file_status_label.setText(str(loading_path))
        if hasattr(self, "overview_summary"):
            self.overview_summary.setText(loading_message)
        if hasattr(self, "dataset_notes"):
            self.dataset_notes.setPlainText(
                "Loading dataset metadata, notes, and saved analyses…"
            )
        if hasattr(self, "result_summary"):
            self.result_summary.setPlainText(
                "Loading DDA history, summaries, and visualizations…"
            )
        if hasattr(self, "ica_result_summary"):
            self.ica_result_summary.setPlainText(
                "Loading ICA summaries and diagnostics…"
            )
        if hasattr(self, "connectivity_summary"):
            self.connectivity_summary.setPlainText(
                "Loading connectivity views…"
            )
        if hasattr(self, "compare_summary"):
            self.compare_summary.setPlainText("Loading comparison views…")
        if hasattr(self, "ica_channel_summary_label"):
            self.ica_channel_summary_label.setText(
                "Loading dataset channels for ICA…"
            )
        if hasattr(self, "dda_variant_selector_status"):
            self.dda_variant_selector_status.setText(
                "Loading dataset channels and pair selectors…"
            )
        for summary in getattr(self, "dda_variant_channel_summaries", {}).values():
            summary.setText("Loading dataset channels…")
        if hasattr(self, "results_summary_label"):
            self.results_summary_label.setText(
                "Loading saved analyses for this file…"
            )

    def _update_dataset_ui(self) -> None:
        dataset = self.state.selected_dataset
        loading_path = getattr(self, "_dataset_loading_path", None)
        if loading_path and (dataset is None or dataset.file_path != loading_path):
            self._apply_dataset_loading_visuals(
                True,
                path=loading_path,
            )
            return
        self._apply_dataset_loading_visuals(False)
        if not dataset:
            self.dataset_label.setText("No dataset open")
            self.file_status_label.setText("No file selected")
            self.overview_summary.setText(
                "Connect to the backend and open a dataset to begin."
            )
            self.dataset_notes.setPlainText("")
            self.waveform_widget.set_waveform(None, 0.0, 10.0, 0.0)
            self.overview_widget.set_overview(None, 0.0, 10.0, 0.0)
            self.waveform_widget.set_annotations([])
            self.overview_widget.set_annotations([])
            self.heatmap_widget.set_annotations([])
            self.dda_lineplot_widget.set_annotations([])
            self._overview_signature = None
            self._populate_annotation_channels()
            self._refresh_annotations_table()
            self._update_annotation_scope_label()
            self._update_streaming_ui()
            self._update_ica_channel_summary()
            self._apply_ica_result(None)
            self._refresh_results_page()
            self._refresh_visible_analysis_subviews()
            self._update_plugin_panels()
            self._update_nsg_panels()
            self._update_workflow_ui()
            self._populate_dda_variant_channel_lists()
            return

        self.dataset_label.setText(dataset.file_name)
        self.file_status_label.setText(dataset.file_path)
        self.overview_summary.setText(
            f"{dataset.file_name} is loaded and ready for waveform inspection and DDA. "
            f"{len(dataset.channels)} channels across {dataset.duration_seconds:.2f}s."
        )
        self.overview_cards["format"].setText(dataset.format_label)
        self.overview_cards["duration"].setText(f"{dataset.duration_seconds:.2f}s")
        self.overview_cards["channels"].setText(str(len(dataset.channels)))
        self.overview_cards["samples"].setText(str(dataset.total_sample_count))
        self.dataset_notes.setPlainText("\n".join(dataset.notes))
        self.viewport_label.setText(
            f"{self.state.waveform_viewport_start_seconds:.2f}s → "
            f"{self.state.waveform_viewport_start_seconds + self.state.waveform_viewport_duration_seconds:.2f}s"
        )
        self._populate_annotation_channels()
        self._refresh_annotations_table()
        self._update_annotation_scope_label()
        self._apply_annotations_to_views()
        self._update_streaming_ui()
        self._update_ica_channel_summary()
        self._refresh_results_page()
        self._refresh_visible_analysis_subviews()
        self._update_plugin_panels()
        self._update_nsg_panels()
        self._update_workflow_ui()

    def _populate_channels(self) -> None:
        self.channel_list.blockSignals(True)
        self.channel_list.clear()
        dataset = self.state.selected_dataset
        if not dataset:
            self.channel_list.blockSignals(False)
            self._populate_annotation_channels()
            return
        selected = set(self.state.selected_channel_names)
        for channel in dataset.channels:
            item = QListWidgetItem(f"{channel.name} · {channel.sample_rate_hz:.1f} Hz")
            item.setData(Qt.UserRole, channel.name)
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Checked if channel.name in selected else Qt.Unchecked)
            self.channel_list.addItem(item)
        self.channel_list.blockSignals(False)
        self._populate_annotation_channels()

    def _selected_channel_names(self) -> List[str]:
        names: List[str] = []
        for index in range(self.channel_list.count()):
            item = self.channel_list.item(index)
            if item.checkState() == Qt.Checked:
                names.append(str(item.data(Qt.UserRole)))
        return names

    def _selected_channel_indices(
        self, dataset: Optional[LoadedDataset] = None
    ) -> List[int]:
        target = dataset or self.state.selected_dataset
        if target is None:
            return []
        return [
            target.channel_names.index(name)
            for name in self._selected_channel_names()
            if name in target.channel_names
        ]

    def _select_all_channels(self) -> None:
        for index in range(self.channel_list.count()):
            self.channel_list.item(index).setCheckState(Qt.Checked)
        self._schedule_waveform_reload()

    def _select_top_channels(self, count: int) -> None:
        dataset = self.state.selected_dataset
        preferred = set(
            self._preferred_channel_names(dataset, count) if dataset is not None else []
        )
        for index in range(self.channel_list.count()):
            item = self.channel_list.item(index)
            channel_name = str(item.data(Qt.UserRole))
            self.channel_list.item(index).setCheckState(
                Qt.Checked if channel_name in preferred else Qt.Unchecked
            )
        self._schedule_waveform_reload()

    def _schedule_waveform_reload(self) -> None:
        self.state.selected_channel_names = self._selected_channel_names()
        self.waveform_reload_timer.start(120)
        self._schedule_overview_reload()
        self._populate_annotation_channels()
        self._apply_annotations_to_views()
        self._update_ica_channel_summary()
        self._schedule_session_save()

    def _schedule_overview_reload(self, force: bool = False) -> None:
        dataset = self.state.selected_dataset
        channels = self.state.selected_channel_names
        if not dataset or not channels:
            return
        signature = (dataset.file_path, tuple(channels))
        if (
            not force
            and signature == self._overview_signature
            and self.state.waveform_overview is not None
        ):
            return
        self.overview_reload_timer.start(260)

    def _load_waveform_data(self) -> None:
        dataset = self.state.selected_dataset
        channels = self.state.selected_channel_names
        if not dataset or not channels:
            return
        if self._waveform_request_in_flight:
            self._waveform_reload_pending = True
            return
        request_serial = self._waveform_request_serial = (
            self._waveform_request_serial + 1
        )
        self._waveform_request_in_flight = True
        self._waveform_reload_pending = False
        path = dataset.file_path
        start_seconds = self.state.waveform_viewport_start_seconds
        duration_seconds = self.state.waveform_viewport_duration_seconds
        request_started_ns = perf_counter_ns()
        self.viewport_label.setText(
            f"{start_seconds:.2f}s → {start_seconds + duration_seconds:.2f}s"
        )

        def task() -> object:
            return self.backend.load_waveform_window(
                path, start_seconds, duration_seconds, channels
            )

        def on_success(result: object) -> None:
            self._waveform_request_in_flight = False
            perf_logger().log_duration(
                "waveform.window.fetch",
                request_started_ns,
                file=path,
                channels=len(channels),
                startSeconds=f"{start_seconds:.3f}",
                durationSeconds=f"{duration_seconds:.3f}",
            )
            if request_serial != self._waveform_request_serial:
                if self._waveform_reload_pending:
                    self._waveform_reload_pending = False
                    self._load_waveform_data()
                return
            window = result
            self.state.waveform_window = window
            self.waveform_widget.set_waveform(
                window,
                self.state.waveform_viewport_start_seconds,
                self.state.waveform_viewport_duration_seconds,
                dataset.duration_seconds,
            )
            current_overview = self.state.waveform_overview
            self.overview_widget.set_overview(
                current_overview,
                self.state.waveform_viewport_start_seconds,
                self.state.waveform_viewport_duration_seconds,
                dataset.duration_seconds,
            )
            if self._waveform_reload_pending:
                self._waveform_reload_pending = False
                self._load_waveform_data()

        self._run_task(
            task,
            on_success,
            lambda message: self._on_waveform_load_error(message),
        )

    def _load_waveform_overview(self) -> None:
        dataset = self.state.selected_dataset
        channels = self.state.selected_channel_names
        if not dataset or not channels:
            return
        if self._overview_request_in_flight:
            self._overview_reload_pending = True
            return
        request_serial = self._overview_request_serial = (
            self._overview_request_serial + 1
        )
        self._overview_request_in_flight = True
        self._overview_reload_pending = False
        path = dataset.file_path
        channel_signature = tuple(channels)
        request_started_ns = perf_counter_ns()

        def task() -> object:
            return self.backend.load_waveform_overview(path, channels, 1600)

        def on_success(result: object) -> None:
            self._overview_request_in_flight = False
            perf_logger().log_duration(
                "waveform.overview.fetch",
                request_started_ns,
                file=path,
                channels=len(channels),
            )
            if request_serial != self._overview_request_serial:
                if self._overview_reload_pending:
                    self._overview_reload_pending = False
                    self._load_waveform_overview()
                return
            overview = result
            self.state.waveform_overview = overview
            self._overview_signature = (path, channel_signature)
            self.overview_widget.set_overview(
                overview,
                self.state.waveform_viewport_start_seconds,
                self.state.waveform_viewport_duration_seconds,
                dataset.duration_seconds,
            )
            if self._overview_reload_pending:
                self._overview_reload_pending = False
                self._load_waveform_overview()

        self._run_task(
            task,
            on_success,
            lambda message: self._on_overview_load_error(message),
        )

    def _set_viewport(self, start_seconds: float, duration_seconds: float) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            return
        previous_start = self.state.waveform_viewport_start_seconds
        previous_duration = self.state.waveform_viewport_duration_seconds
        next_duration = max(
            0.5, min(dataset.duration_seconds or duration_seconds, duration_seconds)
        )
        max_start = max(0.0, dataset.duration_seconds - next_duration)
        if (
            abs(previous_start - max(0.0, min(max_start, start_seconds))) < 1e-6
            and abs(previous_duration - next_duration) < 1e-6
        ):
            return
        self.state.waveform_viewport_start_seconds = max(
            0.0, min(max_start, start_seconds)
        )
        self.state.waveform_viewport_duration_seconds = next_duration
        self.viewport_label.setText(
            f"{self.state.waveform_viewport_start_seconds:.2f}s → "
            f"{self.state.waveform_viewport_start_seconds + self.state.waveform_viewport_duration_seconds:.2f}s"
        )
        self.waveform_widget.set_display_viewport(
            self.state.waveform_viewport_start_seconds,
            self.state.waveform_viewport_duration_seconds,
            dataset.duration_seconds,
        )
        self.overview_widget.set_overview(
            self.state.waveform_overview,
            self.state.waveform_viewport_start_seconds,
            self.state.waveform_viewport_duration_seconds,
            dataset.duration_seconds,
        )
        self._update_annotation_scope_label()
        self._update_streaming_ui()
        self.viewport_reload_timer.start(140)
        self._schedule_session_save()

    def _jump_viewport(self, start_seconds: float) -> None:
        self._set_viewport(start_seconds, self.state.waveform_viewport_duration_seconds)

    def _shift_viewport(self, direction: float) -> None:
        delta = self.state.waveform_viewport_duration_seconds * direction
        self._set_viewport(
            self.state.waveform_viewport_start_seconds + delta,
            self.state.waveform_viewport_duration_seconds,
        )

    def _zoom_viewport(self, factor: float) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            return
        next_duration = max(
            0.5,
            min(
                dataset.duration_seconds,
                self.state.waveform_viewport_duration_seconds * factor,
            ),
        )
        center = (
            self.state.waveform_viewport_start_seconds
            + self.state.waveform_viewport_duration_seconds / 2.0
        )
        next_start = center - next_duration / 2.0
        self._set_viewport(next_start, next_duration)

    def _reset_viewport(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            return
        default_duration = self._recommended_viewport_duration(dataset)
        self._set_viewport(0.0, default_duration)

    def _recommended_viewport_duration(self, dataset: LoadedDataset) -> float:
        sample_rate = max(dataset.dominant_sample_rate_hz, 1.0)
        target_duration = 16_384.0 / sample_rate
        return min(dataset.duration_seconds, max(8.0, min(20.0, target_duration)))

    def _on_waveform_load_error(self, message: str) -> None:
        self._waveform_request_in_flight = False
        perf_logger().log("waveform.window.error", message=message)
        self.status_bar.showMessage(f"Waveform load failed: {message}", 5000)
        if self._waveform_reload_pending:
            self._waveform_reload_pending = False
            self._load_waveform_data()

    def _on_overview_load_error(self, message: str) -> None:
        self._overview_request_in_flight = False
        perf_logger().log("waveform.overview.error", message=message)
        self.status_bar.showMessage(f"Overview load failed: {message}", 5000)
        if self._overview_reload_pending:
            self._overview_reload_pending = False
            self._load_waveform_overview()

    def _current_annotations(self) -> List[WaveformAnnotation]:
        active_path = self.state.active_file_path
        if not active_path:
            return []
        return self.state.annotations_by_file.setdefault(active_path, [])

    def _persist_active_annotations(self) -> None:
        active_path = self.state.active_file_path
        if not active_path:
            return
        self.state_db.replace_annotations_for_file(
            active_path, self._current_annotations()
        )

    def _apply_annotations_to_views(self) -> None:
        annotations = self._current_annotations()
        self.waveform_widget.set_annotations(annotations)
        self.overview_widget.set_annotations(annotations)
        if hasattr(self, "heatmap_widget"):
            self.heatmap_widget.set_annotations(annotations)
        if hasattr(self, "dda_lineplot_widget"):
            self.dda_lineplot_widget.set_annotations(annotations)

    def _populate_annotation_channels(self) -> None:
        dataset = self.state.selected_dataset
        current_value = (
            self.annotation_channel_combo.currentData()
            if hasattr(self, "annotation_channel_combo")
            else None
        )
        if not hasattr(self, "annotation_channel_combo"):
            return
        with QSignalBlocker(self.annotation_channel_combo):
            self.annotation_channel_combo.clear()
            self.annotation_channel_combo.addItem("Global", None)
            if dataset:
                visible = set(self.state.selected_channel_names)
                for channel_name in dataset.channel_names:
                    label = (
                        channel_name
                        if channel_name in visible
                        else f"{channel_name} (hidden)"
                    )
                    self.annotation_channel_combo.addItem(label, channel_name)
            index = self.annotation_channel_combo.findData(current_value)
            self.annotation_channel_combo.setCurrentIndex(index if index >= 0 else 0)

    def _refresh_annotations_table(self) -> None:
        if not hasattr(self, "annotations_table"):
            return
        annotations = self._current_annotations()
        self.annotations_table.setRowCount(len(annotations))
        for row, annotation in enumerate(annotations):
            scope = annotation.channel_name or "Global"
            end_text = (
                f"{annotation.end_seconds:.2f}s"
                if annotation.end_seconds is not None
                else "—"
            )
            values = [
                annotation.label,
                scope,
                f"{annotation.start_seconds:.2f}s",
                end_text,
                annotation.notes,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                item.setData(Qt.UserRole, annotation.id)
                self.annotations_table.setItem(row, column, item)
        self._update_annotation_actions()

    def _update_annotation_scope_label(self) -> None:
        if not hasattr(self, "annotation_scope_label"):
            return
        dataset = self.state.selected_dataset
        if not dataset:
            self.annotation_scope_label.setText(
                "Open a dataset to start annotating the current view."
            )
            return
        annotations = self._current_annotations()
        self.annotation_scope_label.setText(
            f"{dataset.file_name} • current view {self.state.waveform_viewport_start_seconds:.2f}s → "
            f"{self.state.waveform_viewport_start_seconds + self.state.waveform_viewport_duration_seconds:.2f}s • "
            f"{len(annotations)} annotations"
        )

    def _selected_annotation(self) -> Optional[WaveformAnnotation]:
        if not hasattr(self, "annotations_table"):
            return None
        selected_rows = self.annotations_table.selectionModel().selectedRows()
        if not selected_rows:
            return None
        item = self.annotations_table.item(selected_rows[0].row(), 0)
        if item is None:
            return None
        annotation_id = item.data(Qt.UserRole)
        for annotation in self._current_annotations():
            if annotation.id == annotation_id:
                return annotation
        return None

    def _update_annotation_actions(self) -> None:
        selected = self._selected_annotation()
        has_dataset = self.state.selected_dataset is not None
        has_annotations = bool(self.state.active_file_path and self._current_annotations())
        if hasattr(self, "capture_annotation_button"):
            self.capture_annotation_button.setEnabled(has_dataset)
            self.jump_annotation_button.setEnabled(selected is not None)
            self.delete_annotation_button.setEnabled(selected is not None)
        if hasattr(self, "import_annotations_button"):
            self.import_annotations_button.setEnabled(True)
        if hasattr(self, "export_annotations_button"):
            self.export_annotations_button.setEnabled(has_annotations)

    def _annotation_refresh_after_change(self) -> None:
        self.annotation_label_edit.clear()
        self.annotation_notes_edit.clear()
        self._persist_active_annotations()
        self._refresh_annotations_table()
        self._update_annotation_scope_label()
        self._apply_annotations_to_views()
        self._refresh_results_page()
        self._schedule_session_save()

    def _annotation_bounds_for_mode(
        self,
        mode: str,
        point_seconds: Optional[float] = None,
        view_range_seconds: Optional[tuple[float, float]] = None,
    ) -> tuple[float, Optional[float]]:
        dataset = self.state.selected_dataset
        if dataset is None:
            return 0.0, None
        if mode == "point":
            target = (
                point_seconds
                if point_seconds is not None
                else self.state.waveform_viewport_start_seconds
                + self.state.waveform_viewport_duration_seconds / 2.0
            )
            clamped = max(0.0, min(dataset.duration_seconds, target))
            return clamped, None
        if view_range_seconds is not None:
            start_seconds = max(0.0, min(dataset.duration_seconds, view_range_seconds[0]))
            end_seconds = max(
                start_seconds,
                min(dataset.duration_seconds, view_range_seconds[1]),
            )
            return start_seconds, end_seconds
        start_seconds = max(0.0, self.state.waveform_viewport_start_seconds)
        end_seconds = min(
            dataset.duration_seconds,
            self.state.waveform_viewport_start_seconds
            + self.state.waveform_viewport_duration_seconds,
        )
        return start_seconds, end_seconds

    def _create_annotation(
        self,
        label: str,
        notes: str,
        channel_name: Optional[str],
        start_seconds: float,
        end_seconds: Optional[float] = None,
    ) -> WaveformAnnotation:
        annotation = WaveformAnnotation(
            id=str(uuid.uuid4()),
            label=label or f"Annotation {len(self._current_annotations()) + 1}",
            notes=notes,
            channel_name=channel_name,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
        )
        self._current_annotations().append(annotation)
        self._annotation_refresh_after_change()
        dataset = self.state.selected_dataset
        self._record_workflow_action(
            "annotation-add",
            f"Added annotation {annotation.label}",
            {
                "label": annotation.label,
                "scope": annotation.channel_name or "Global",
            },
            file_path=dataset.file_path if dataset else self.state.active_file_path,
        )
        self._notify("annotation", "info", "Annotation Added", annotation.label)
        return annotation

    def _update_annotation(
        self,
        annotation: WaveformAnnotation,
        *,
        label: str,
        notes: str,
        channel_name: Optional[str],
    ) -> None:
        annotation.label = label or annotation.label
        annotation.notes = notes
        annotation.channel_name = channel_name
        self._annotation_refresh_after_change()
        self._record_workflow_action(
            "annotation-update",
            f"Updated annotation {annotation.label}",
            {
                "label": annotation.label,
                "scope": annotation.channel_name or "Global",
            },
            file_path=self.state.active_file_path,
        )
        self._notify("annotation", "info", "Annotation Updated", annotation.label)

    def _delete_annotation(self, annotation: WaveformAnnotation) -> None:
        annotations = self._current_annotations()
        self.state.annotations_by_file[self.state.active_file_path or ""] = [
            item for item in annotations if item.id != annotation.id
        ]
        self._annotation_refresh_after_change()
        self._record_workflow_action(
            "annotation-delete",
            f"Removed annotation {annotation.label}",
            {
                "label": annotation.label,
                "scope": annotation.channel_name or "Global",
            },
            file_path=self.state.active_file_path,
        )
        self._notify("annotation", "info", "Annotation Removed", annotation.label)

    def _capture_annotation(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._show_error("Open a dataset before creating annotations.")
            return
        mode = str(self.annotation_mode_combo.currentData())
        label = self.annotation_label_edit.text().strip()
        notes = self.annotation_notes_edit.text().strip()
        channel_name = self.annotation_channel_combo.currentData()
        start_seconds, end_seconds = self._annotation_bounds_for_mode(mode)
        self._create_annotation(
            label=label,
            notes=notes,
            channel_name=channel_name,
            start_seconds=start_seconds,
            end_seconds=end_seconds,
        )

    def _jump_to_selected_annotation(self) -> None:
        annotation = self._selected_annotation()
        dataset = self.state.selected_dataset
        if annotation is None or dataset is None:
            return
        if annotation.is_range and annotation.end_seconds is not None:
            duration = max(0.5, annotation.end_seconds - annotation.start_seconds)
            self._set_viewport(annotation.start_seconds, duration)
        else:
            start = (
                annotation.center_seconds
                - self.state.waveform_viewport_duration_seconds / 2.0
            )
            self._set_viewport(start, self.state.waveform_viewport_duration_seconds)

    def _delete_selected_annotation(self) -> None:
        annotation = self._selected_annotation()
        if annotation is None:
            return
        self._delete_annotation(annotation)

    def _open_waveform_annotation_context_menu(
        self,
        global_pos: object,
        plot_seconds: float,
        channel_hint: object,
        existing_annotation: object,
    ) -> None:
        self._open_plot_annotation_context_menu(
            global_pos=global_pos,
            plot_seconds=plot_seconds,
            channel_hint=channel_hint if isinstance(channel_hint, str) else None,
            existing_annotation=(
                existing_annotation
                if isinstance(existing_annotation, WaveformAnnotation)
                else None
            ),
        )

    def _open_overview_annotation_context_menu(
        self,
        global_pos: object,
        plot_seconds: float,
        existing_annotation: object,
    ) -> None:
        self._open_plot_annotation_context_menu(
            global_pos=global_pos,
            plot_seconds=plot_seconds,
            channel_hint=None,
            existing_annotation=(
                existing_annotation
                if isinstance(existing_annotation, WaveformAnnotation)
                else None
            ),
        )

    def _open_dda_heatmap_annotation_context_menu(
        self,
        global_pos: object,
        plot_seconds: float,
        channel_hint: object,
        existing_annotation: object,
    ) -> None:
        self._open_plot_annotation_context_menu(
            global_pos=global_pos,
            plot_seconds=plot_seconds,
            channel_hint=channel_hint if isinstance(channel_hint, str) else None,
            existing_annotation=(
                existing_annotation
                if isinstance(existing_annotation, WaveformAnnotation)
                else None
            ),
            view_range_seconds=self.heatmap_widget.visible_time_range(),
        )

    def _open_dda_lineplot_annotation_context_menu(
        self,
        global_pos: object,
        plot_seconds: float,
        channel_hint: object,
        existing_annotation: object,
    ) -> None:
        self._open_plot_annotation_context_menu(
            global_pos=global_pos,
            plot_seconds=plot_seconds,
            channel_hint=channel_hint if isinstance(channel_hint, str) else None,
            existing_annotation=(
                existing_annotation
                if isinstance(existing_annotation, WaveformAnnotation)
                else None
            ),
            view_range_seconds=self.dda_lineplot_widget.visible_time_range(),
        )

    def _open_plot_annotation_context_menu(
        self,
        *,
        global_pos: object,
        plot_seconds: float,
        channel_hint: Optional[str],
        existing_annotation: Optional[WaveformAnnotation],
        view_range_seconds: Optional[tuple[float, float]] = None,
    ) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        if hasattr(self, "_annotation_context_menu") and self._annotation_context_menu:
            self._annotation_context_menu.close()
        menu = QMenu(self)
        container = QWidget(menu)
        layout = QVBoxLayout(container)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        header = QLabel("Edit Annotation" if existing_annotation else "Add Annotation")
        header.setProperty("title", True)
        layout.addWidget(header)

        position_label = QLabel(
            (
                f"Range {existing_annotation.start_seconds:.2f}s → {existing_annotation.end_seconds:.2f}s"
                if existing_annotation
                and existing_annotation.is_range
                and existing_annotation.end_seconds is not None
                else f"Position {plot_seconds:.2f}s"
            )
        )
        position_label.setProperty("muted", True)
        layout.addWidget(position_label)

        form = QFormLayout()
        label_edit = QLineEdit(existing_annotation.label if existing_annotation else "")
        if not existing_annotation:
            label_edit.setPlaceholderText(f"Annotation @ {plot_seconds:.2f}s")
        notes_edit = QLineEdit(existing_annotation.notes if existing_annotation else "")
        notes_edit.setPlaceholderText("Optional note")
        scope_combo = QComboBox()
        scope_combo.addItem("Global", None)
        visible = set(self.state.selected_channel_names)
        for channel_name in dataset.channel_names:
            label = (
                channel_name if channel_name in visible else f"{channel_name} (hidden)"
            )
            scope_combo.addItem(label, channel_name)
        default_scope = (
            existing_annotation.channel_name if existing_annotation else channel_hint
        )
        scope_index = scope_combo.findData(default_scope)
        scope_combo.setCurrentIndex(scope_index if scope_index >= 0 else 0)
        form.addRow("Label", label_edit)
        form.addRow("Note", notes_edit)
        form.addRow("Scope", scope_combo)

        mode_combo: Optional[QComboBox] = None
        if existing_annotation is None:
            mode_combo = QComboBox()
            mode_combo.addItem("Point at cursor", "point")
            mode_combo.addItem(
                "Range from visible plot" if view_range_seconds is not None else "Range from current viewport",
                "range",
            )
            form.addRow("Capture", mode_combo)
        layout.addLayout(form)

        button_row = QHBoxLayout()
        save_button = QPushButton("Save" if existing_annotation else "Add Annotation")
        save_button.setProperty("secondary", True)
        button_row.addWidget(save_button)
        if existing_annotation is not None:
            delete_button = QPushButton("Delete")
            delete_button.setProperty("secondary", True)
            button_row.addWidget(delete_button)
            delete_button.clicked.connect(
                lambda: (
                    self._delete_annotation(existing_annotation),
                    menu.close(),
                )
            )
        button_row.addStretch(1)
        layout.addLayout(button_row)

        def handle_save() -> None:
            label = label_edit.text().strip()
            notes = notes_edit.text().strip()
            channel_name = scope_combo.currentData()
            if existing_annotation is not None:
                self._update_annotation(
                    existing_annotation,
                    label=label,
                    notes=notes,
                    channel_name=channel_name,
                )
            else:
                mode = (
                    str(mode_combo.currentData()) if mode_combo is not None else "point"
                )
                start_seconds, end_seconds = self._annotation_bounds_for_mode(
                    mode,
                    point_seconds=plot_seconds,
                    view_range_seconds=view_range_seconds,
                )
                self._create_annotation(
                    label=label,
                    notes=notes,
                    channel_name=channel_name,
                    start_seconds=start_seconds,
                    end_seconds=end_seconds,
                )
            menu.close()

        save_button.clicked.connect(handle_save)

        action = QWidgetAction(menu)
        action.setDefaultWidget(container)
        menu.addAction(action)
        menu.aboutToHide.connect(
            lambda: setattr(self, "_annotation_context_menu", None)
        )
        menu.aboutToHide.connect(menu.deleteLater)
        self._annotation_context_menu = menu
        popup_point = global_pos if isinstance(global_pos, QPoint) else QPoint()
        menu.popup(popup_point)
        QTimer.singleShot(0, label_edit.setFocus)

    def _stream_stride_seconds(self) -> float:
        return max(0.05, float(self.streaming_stride_spin.value()))

    def _stream_speed_multiplier(self) -> float:
        return float(self.streaming_speed_combo.currentData() or 1.0)

    def _update_streaming_ui(self) -> None:
        if not hasattr(self, "streaming_status_label"):
            return
        dataset = self.state.selected_dataset
        if not dataset:
            self.streaming_status_label.setText("Open a dataset to control replay.")
        else:
            state_label = "Running" if self._stream_running else "Paused"
            self.streaming_status_label.setText(
                f"{dataset.file_name} • {state_label} • viewport "
                f"{self.state.waveform_viewport_start_seconds:.2f}s → "
                f"{self.state.waveform_viewport_start_seconds + self.state.waveform_viewport_duration_seconds:.2f}s • "
                f"stride {self._stream_stride_seconds():.2f}s @ {self._stream_speed_multiplier():.1f}×"
            )
        self.streaming_start_button.setEnabled(
            dataset is not None and not self._stream_running
        )
        self.streaming_pause_button.setEnabled(
            dataset is not None and self._stream_running
        )
        self.streaming_stop_button.setEnabled(
            dataset is not None
            and (
                self._stream_running or self.state.waveform_viewport_start_seconds > 0.0
            )
        )
        self.streaming_back_button.setEnabled(dataset is not None)
        self.streaming_forward_button.setEnabled(dataset is not None)

    def _start_streaming(self) -> None:
        if self.state.selected_dataset is None:
            self._show_error("Open a dataset before starting replay.")
            return
        self._stream_running = True
        self.streaming_timer.start()
        self._update_streaming_ui()

    def _pause_streaming(self) -> None:
        self._stream_running = False
        self.streaming_timer.stop()
        self._update_streaming_ui()

    def _stop_streaming(self) -> None:
        self._stream_running = False
        if hasattr(self, "streaming_timer"):
            self.streaming_timer.stop()
        self._update_streaming_ui()

    def _step_streaming(self, direction: float) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        delta = (
            self._stream_stride_seconds() * self._stream_speed_multiplier() * direction
        )
        self._set_viewport(
            self.state.waveform_viewport_start_seconds + delta,
            self.state.waveform_viewport_duration_seconds,
        )

    def _advance_streaming(self) -> None:
        dataset = self.state.selected_dataset
        if not self._stream_running or dataset is None:
            return
        next_start = (
            self.state.waveform_viewport_start_seconds
            + self._stream_stride_seconds() * self._stream_speed_multiplier()
        )
        max_start = max(
            0.0,
            dataset.duration_seconds - self.state.waveform_viewport_duration_seconds,
        )
        if next_start > max_start:
            if self.streaming_loop_checkbox.isChecked():
                next_start = 0.0
            else:
                self._pause_streaming()
                return
        self._set_viewport(next_start, self.state.waveform_viewport_duration_seconds)

    def _sync_default_dda_config(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._populate_dda_variant_channel_lists()
            return
        suggested_window = max(int(round(dataset.dominant_sample_rate_hz * 0.25)), 1)
        self.window_length_spin.setValue(min(suggested_window, 65536))
        self.window_step_spin.setValue(10)
        self.dda_start_edit.setText("0")
        self.dda_end_edit.setText(f"{dataset.duration_seconds:.3f}")
        self._reset_dda_variant_channel_selections(dataset)
        self.streaming_stride_spin.setValue(
            max(0.25, min(2.0, self.state.waveform_viewport_duration_seconds / 4.0))
        )
        self.ica_start_edit.setText("0")
        self.ica_end_edit.setText(f"{dataset.duration_seconds:.3f}")
        self._update_streaming_ui()
