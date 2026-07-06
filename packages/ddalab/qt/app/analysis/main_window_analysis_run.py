from __future__ import annotations

import time
from time import perf_counter_ns
from typing import List, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QMenu,
    QVBoxLayout,
    QWidget,
    QWidgetAction,
)

from ...domain.models import (
    DdaReproductionConfig,
    DdaResult,
    DdaRunDetails,
    DdaRunProgress,
)
from ..core.analysis_input import parse_time_bounds
from ..runtime.perf_logging import perf_logger
from ..support.main_window_support import (
    _human_bytes,
)


class MainWindowAnalysisRunMixin:
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
        self.state.dda_run_progress = None
        self._dda_run_animation_tick = 0
        self._dda_run_started_at = time.monotonic() if running else None
        self._dda_last_progress_ui_refresh_monotonic = 0.0
        self._dda_last_progress_stage_signature = None
        if running:
            self.dda_activity_timer.start()
            if hasattr(self, "dda_diagnostics"):
                self.dda_diagnostics.setPlainText(
                    "Running DDA… live progress is shown in the activity panel."
                )
            if hasattr(self, "result_summary"):
                self.result_summary.setPlainText(
                    "DDA is running…\n\nLive progress is shown in the activity panel."
                )
        else:
            self.dda_activity_timer.stop()
        self._refresh_dda_running_ui()

    def _update_dda_run_progress(self, payload: object) -> None:
        progress = DdaRunProgress.from_json(payload)
        if progress is None:
            return
        self.state.dda_run_progress = progress
        if not self.state.dda_run_in_progress:
            return
        now = time.monotonic()
        stage_signature = (
            progress.group_label,
            progress.stage_id,
        )
        should_refresh = (
            progress.step_index <= 1
            or progress.step_index >= progress.total_steps
            or stage_signature != self._dda_last_progress_stage_signature
            or now - self._dda_last_progress_ui_refresh_monotonic >= 0.35
        )
        if not should_refresh:
            return
        self._dda_last_progress_ui_refresh_monotonic = now
        self._dda_last_progress_stage_signature = stage_signature
        self._refresh_dda_running_ui()

    def _format_dda_progress_lines(self) -> tuple[str, str]:
        progress = self.state.dda_run_progress
        if progress is None:
            return ("", "")
        percent = (
            100.0 * progress.step_index / progress.total_steps
            if progress.total_steps > 0
            else 0.0
        )
        group_prefix = f"{progress.group_label} • " if progress.group_label else ""
        stage_line = (
            f"{percent:.1f}% • {group_prefix}{progress.stage_label or 'Running DDA'}"
        )
        detail_parts: List[str] = []
        if progress.window_index > 0 and progress.total_windows > 0:
            detail_parts.append(
                f"window {progress.window_index}/{progress.total_windows}"
            )
        if progress.item_index > 0 and progress.total_items > 0:
            item_kind = progress.item_kind or "item"
            detail_parts.append(
                f"{item_kind} {progress.item_index}/{progress.total_items}"
            )
        if progress.item_label:
            detail_parts.append(progress.item_label)
        if progress.step_index > 0 and progress.total_steps > 0:
            detail_parts.append(f"step {progress.step_index}/{progress.total_steps}")
        return stage_line, " • ".join(detail_parts)

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
            self.dda_activity_detail_label.clear()
            self.dda_activity_progress_bar.reset()
            self.dda_activity_progress_bar.setRange(0, 1)
            self.dda_activity_progress_bar.setValue(0)
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
        progress_headline, progress_detail = self._format_dda_progress_lines()
        subline = (
            f"{progress_headline}\n{progress_detail}\nElapsed: {elapsed_seconds}s"
            if progress_headline
            else f"Worker is active asynchronously. Elapsed: {elapsed_seconds}s{dots}"
        )
        self.dda_activity_label.setText(f"{headline}\n{subline}")
        self.dda_activity_detail_label.setText(progress_detail)
        self.dda_global_label.setText(
            (
                f"DDA {progress_headline} • {file_name}"
                if progress_headline
                else f"DDA running • {file_name} • {elapsed_seconds}s{dots}"
            )
        )
        progress = self.state.dda_run_progress
        if progress is not None and progress.total_steps > 0:
            self.dda_activity_progress_bar.setRange(0, progress.total_steps)
            self.dda_activity_progress_bar.setValue(
                min(progress.step_index, progress.total_steps)
            )
            self.dda_activity_progress_bar.setFormat(
                f"%p%  ({min(progress.step_index, progress.total_steps)}/{progress.total_steps})"
            )
        else:
            self.dda_activity_progress_bar.setRange(0, 0)
        detail_hint = "Click for run details"
        self.dda_activity_label.setToolTip(detail_hint)
        self.dda_global_label.setToolTip(detail_hint)

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
        channel_indices = (
            ", ".join(str(index) for index in details.channel_indices) or "—"
        )
        delays = ", ".join(str(delay) for delay in details.delays) or "—"
        model_terms = ", ".join(str(term) for term in details.model_terms) or "—"
        variants = ", ".join(details.variant_ids) or "—"
        sample_rate = (
            f"{details.sample_rate_hz:.3f} Hz" if details.sample_rate_hz > 0 else "—"
        )
        start_sample = max(
            int(round(details.start_time_seconds * details.sample_rate_hz)), 0
        )
        if details.end_time_seconds is None:
            end_sample = "end"
            bounds_seconds = f"{details.start_time_seconds:.2f}s → end"
        else:
            end_sample = str(
                max(
                    int(round(details.end_time_seconds * details.sample_rate_hz)),
                    start_sample,
                )
            )
            bounds_seconds = (
                f"{details.start_time_seconds:.2f}s → {details.end_time_seconds:.2f}s"
            )
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
            f"Mode: {'Expert' if details.expert_mode else 'Standard EEG preset'}",
            f"Selected channels: {channel_indices}",
            f"Channel names: {channel_names}",
            f"Window: {details.window_length_samples}/{details.window_step_samples} samples",
            f"Delays: {delays}",
            "MODEL: "
            f"dm={details.model_dimension or self.DDA_DEFAULT_MODEL_DIMENSION}, "
            f"order={details.polynomial_order or self.DDA_DEFAULT_POLYNOMIAL_ORDER}, "
            f"nr_tau={details.nr_tau or self.DDA_DEFAULT_NR_TAU}, "
            f"terms={model_terms}",
            f"Bounds: {bounds_seconds} ({start_sample} → {end_sample} samples)",
            f"Sample rate: {sample_rate}",
        ]
        progress_headline, progress_detail = self._format_dda_progress_lines()
        if progress_headline:
            lines.extend(["", "Live progress:", progress_headline])
            if progress_detail:
                lines.append(progress_detail)
        if details.variant_channel_names:
            lines.extend(["", "Variant-specific selectors:"])
            for variant_id in details.variant_ids:
                pair_names = details.variant_pair_names.get(variant_id, [])
                if pair_names:
                    names = (
                        ", ".join(
                            self._format_dda_pair_label(variant_id, left, right)
                            for left, right in pair_names
                        )
                        or "—"
                    )
                    indices = (
                        ", ".join(
                            self._format_dda_pair_label(
                                variant_id,
                                str(left_index),
                                str(right_index),
                            )
                            for left_index, right_index in details.variant_pair_indices.get(
                                variant_id, []
                            )
                        )
                        or "—"
                    )
                    lines.append(f"{variant_id}: {indices} ({names})")
                    continue
                names = (
                    ", ".join(details.variant_channel_names.get(variant_id, [])) or "—"
                )
                indices = (
                    ", ".join(
                        str(index)
                        for index in details.variant_channel_indices.get(variant_id, [])
                    )
                    or "—"
                )
                lines.append(f"{variant_id}: {indices} ({names})")
        return "\n".join(lines)

    def _run_dda(self) -> None:
        dataset = self.state.selected_dataset
        if not dataset:
            self._show_error("Open a dataset before running DDA.")
            return
        variant_ids = self._active_dda_variant_ids()
        if not variant_ids:
            self._show_error("Select at least one DDA variant.")
            return
        variant_channel_names = self._selected_dda_variant_channel_names_map(
            variant_ids
        )
        variant_pair_names = self._selected_dda_variant_pair_names_map(variant_ids)
        missing_channel_variants = [
            variant_id
            for variant_id in variant_ids
            if variant_id in self.DDA_SINGLE_CHANNEL_VARIANTS
            and not variant_channel_names.get(variant_id)
        ]
        if missing_channel_variants:
            self._show_error(
                "Select at least one channel for: "
                + ", ".join(missing_channel_variants)
                + "."
            )
            return
        missing_pair_variants = [
            variant_id
            for variant_id in variant_ids
            if variant_id in self.DDA_PAIR_VARIANTS
            and not variant_pair_names.get(variant_id)
        ]
        if missing_pair_variants:
            self._show_error(
                "Select at least one pair for: "
                + ", ".join(missing_pair_variants)
                + "."
            )
            return
        variant_channel_indices = self._selected_dda_variant_channel_indices_map(
            dataset,
            variant_channel_names,
        )
        variant_pair_indices = self._selected_dda_variant_pair_indices_map(
            dataset,
            variant_pair_names,
        )
        selected_indices, selected_channel_names = self._union_channel_selection(
            dataset,
            variant_channel_indices,
            variant_pair_indices,
        )
        if not selected_indices:
            self._show_error("Select at least one DDA channel before running.")
            return
        window_length_samples = self.window_length_spin.value()
        window_step_samples = self.window_step_spin.value()
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
                label="DDA time range",
                default_start=0.0,
            )
        except ValueError as exc:
            self._show_error(str(exc))
            return
        details = DdaRunDetails(
            file_name=dataset.file_name,
            file_path=dataset.file_path,
            started_at_iso=time.strftime("%Y-%m-%dT%H:%M:%S"),
            expert_mode=self.state.expert_mode,
            variant_ids=list(variant_ids),
            channel_names=list(selected_channel_names),
            channel_indices=list(selected_indices),
            variant_channel_names={
                variant_id: list(channel_names)
                for variant_id, channel_names in variant_channel_names.items()
            },
            variant_channel_indices={
                variant_id: list(channel_indices)
                for variant_id, channel_indices in variant_channel_indices.items()
            },
            variant_pair_names={
                variant_id: list(pair_names)
                for variant_id, pair_names in variant_pair_names.items()
            },
            variant_pair_indices={
                variant_id: list(pair_indices)
                for variant_id, pair_indices in variant_pair_indices.items()
            },
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=list(delays),
            model_terms=list(model_terms),
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            start_time_seconds=start,
            end_time_seconds=end,
            sample_rate_hz=dataset.dominant_sample_rate_hz,
            engine_label=self.backend.connection_label,
        )
        dda_run_started_ns = perf_counter_ns()
        perf_logger().log(
            "dda.ui.run.start",
            file=dataset.file_path,
            variants=",".join(variant_ids),
            channelCount=len(selected_indices),
            wl=window_length_samples,
            ws=window_step_samples,
            startSeconds=start,
            endSeconds=end,
        )
        self._set_dda_running_state(
            True,
            dataset_name=dataset.file_name,
            variant_ids=variant_ids,
            details=details,
        )

        def task(progress_callback) -> object:
            return self.backend.run_dda(
                dataset=dataset,
                selected_channel_indices=selected_indices,
                selected_variants=variant_ids,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
                start_time_seconds=start,
                end_time_seconds=end,
                variant_channel_indices=variant_channel_indices,
                variant_pair_indices=variant_pair_indices,
                model_terms=model_terms,
                model_dimension=model_dimension,
                polynomial_order=polynomial_order,
                nr_tau=nr_tau,
                progress_callback=progress_callback,
            )

        def on_success(result: object) -> None:
            self._set_dda_running_state(False)
            dda_result = result
            if isinstance(dda_result, DdaResult):
                dda_result.reproduction = DdaReproductionConfig(
                    expert_mode=details.expert_mode,
                    variant_ids=list(details.variant_ids),
                    selected_channel_indices=list(details.channel_indices),
                    selected_channel_names=list(details.channel_names),
                    variant_channel_indices={
                        variant_id: list(channel_indices)
                        for variant_id, channel_indices in details.variant_channel_indices.items()
                    },
                    variant_channel_names={
                        variant_id: list(channel_names)
                        for variant_id, channel_names in details.variant_channel_names.items()
                    },
                    variant_pair_indices={
                        variant_id: list(pair_indices)
                        for variant_id, pair_indices in details.variant_pair_indices.items()
                    },
                    variant_pair_names={
                        variant_id: list(pair_names)
                        for variant_id, pair_names in details.variant_pair_names.items()
                    },
                    window_length_samples=details.window_length_samples,
                    window_step_samples=details.window_step_samples,
                    delays=list(details.delays),
                    model_terms=list(details.model_terms),
                    model_dimension=details.model_dimension,
                    polynomial_order=details.polynomial_order,
                    nr_tau=details.nr_tau,
                    start_time_seconds=details.start_time_seconds,
                    end_time_seconds=details.end_time_seconds,
                )
            self._apply_dda_result(dda_result)
            self._record_workflow_action(
                "run-dda",
                f"Ran DDA on {dataset.file_name}",
                {
                    "variants": ", ".join(variant_ids),
                    "channels": self._format_variant_channel_summary(
                        variant_channel_names,
                        variant_pair_names,
                    ),
                },
                file_path=dataset.file_path,
            )
            self._notify(
                "analysis",
                "info",
                "DDA Completed",
                f"{dataset.file_name} • {', '.join(variant_ids)}",
            )
            perf_logger().log_duration(
                "dda.ui.run.complete",
                dda_run_started_ns,
                file=dataset.file_path,
                variants=",".join(variant_ids),
                channelCount=len(selected_indices),
                resultVariants=(
                    len(dda_result.variants) if isinstance(dda_result, DdaResult) else 0
                ),
            )

        def on_error(message: str) -> None:
            self._set_dda_running_state(False)
            self.dda_diagnostics.setPlainText(f"DDA failed:\n{message}")
            self.result_summary.setPlainText(f"DDA failed.\n\n{message}")
            self._notify("analysis", "error", "DDA Failed", message)
            perf_logger().log_duration(
                "dda.ui.run.error",
                dda_run_started_ns,
                file=dataset.file_path,
                variants=",".join(variant_ids),
                channelCount=len(selected_indices),
                error=message,
            )

        self._run_task_with_progress(
            task,
            on_success,
            on_error,
            self._update_dda_run_progress,
        )
