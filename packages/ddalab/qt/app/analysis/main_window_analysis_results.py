from __future__ import annotations

from typing import Optional

from PySide6.QtWidgets import (
    QTableWidgetItem,
)

from ...domain.models import (
    DdaVariantResult,
    IcaResult,
)
from ...ui.quick_plot_surface import update_quick_variant_bridge
from ...ui.plot_layers import PlotLayerConfig

from .main_window_analysis_helpers import (
    _checkbox_checked,
    _plot_widget_view_window,
)


class MainWindowAnalysisResultsMixin:
    def _on_variant_changed(self, index: int) -> None:
        if index < 0:
            return
        self._active_variant_id = str(self.variant_combo.currentData())
        self._update_variant_view()
        self._schedule_session_save()

    def _on_heatmap_color_scheme_changed(self, index: int) -> None:
        if index < 0:
            return
        scheme = self.heatmap_color_scheme_combo.currentData()
        if isinstance(scheme, str):
            self.heatmap_widget.set_color_scheme(scheme)
            if hasattr(self, "compare_baseline_heatmap"):
                self.compare_baseline_heatmap.set_color_scheme(scheme)
                self.compare_target_heatmap.set_color_scheme(scheme)
            result = self.state.dda_result
            if result and result.variants:
                variant = next(
                    (
                        item
                        for item in result.variants
                        if item.id == self._active_variant_id
                    ),
                    result.variants[0],
                )
                self._update_quick_variant_view(variant)
            self._schedule_session_save()

    def _update_variant_view(self) -> None:
        result = self.state.dda_result
        if not result or not result.variants:
            self.heatmap_widget.set_variant(None)
            self.dda_lineplot_widget.set_variant(None)
            self._update_quick_variant_view(None)
            return
        variant = next(
            (item for item in result.variants if item.id == self._active_variant_id),
            result.variants[0],
        )
        view_key = (result.id, variant.id)
        self.heatmap_widget.set_variant(
            variant,
            result.window_centers_seconds,
            view_key=view_key,
        )
        self.dda_lineplot_widget.set_variant(
            variant,
            result.window_centers_seconds,
            view_key=view_key,
        )
        self._update_quick_variant_view(variant)
        self.result_summary.setPlainText(
            f"{variant.label}\n\n"
            f"{variant.summary}\n\n"
            f"Rows: {len(variant.row_labels)}\n"
            f"Columns: {variant.effective_column_count}\n"
            f"Value range: {variant.min_value:.4f} → {variant.max_value:.4f}\n"
            f"Engine: {result.engine_label}\n"
            f"Created: {result.created_at_iso}"
        )

    def _update_quick_variant_view(
        self,
        variant: Optional[DdaVariantResult],
    ) -> None:
        bridge = getattr(self, "quick_heatmap_bridge", None)
        if bridge is None:
            return
        if variant is None or variant.effective_column_count <= 0:
            bridge.clear()
            return
        color_scheme = self.heatmap_color_scheme_combo.currentData()
        if not isinstance(color_scheme, str):
            color_scheme = "viridis"
        quick_widget = getattr(self, "quick_heatmap_widget", None)
        target_columns = 512
        if quick_widget is not None:
            target_columns = max(1, int(quick_widget.width()) or target_columns)
        target_columns = min(variant.effective_column_count, target_columns)
        heatmap_widget = getattr(self, "heatmap_widget", None)
        start_fraction, span_fraction = _plot_widget_view_window(heatmap_widget)
        update_quick_variant_bridge(
            bridge,
            variant,
            target_columns=target_columns,
            title=f"{variant.label} heatmap",
            color_scheme=color_scheme,
            start_fraction=start_fraction,
            span_fraction=span_fraction,
        )

    def _refresh_quick_variant_viewport(self) -> None:
        self._update_quick_variant_view(self._active_dda_result_variant())

    def _sync_result_plot_viewport(
        self, start_fraction: float, span_fraction: float
    ) -> None:
        heatmap = getattr(self, "heatmap_widget", None)
        if heatmap is not None:
            heatmap.set_view_window(start_fraction, span_fraction, emit=False)
        lineplot = getattr(self, "dda_lineplot_widget", None)
        if lineplot is not None:
            lineplot.set_view_window(start_fraction, span_fraction, emit=False)
        self._refresh_quick_variant_viewport()

    def _sync_result_plot_cursor(self, cursor_fraction: float) -> None:
        heatmap = getattr(self, "heatmap_widget", None)
        if heatmap is not None and hasattr(heatmap, "set_cursor_fraction"):
            heatmap.set_cursor_fraction(cursor_fraction, emit=False)
        lineplot = getattr(self, "dda_lineplot_widget", None)
        if lineplot is not None and hasattr(lineplot, "set_cursor_fraction"):
            lineplot.set_cursor_fraction(cursor_fraction, emit=False)
        bridge = getattr(self, "quick_heatmap_bridge", None)
        if bridge is not None and hasattr(bridge, "set_cursor_fraction"):
            bridge.set_cursor_fraction(cursor_fraction)

    def _apply_result_plot_layers(
        self,
        layers: PlotLayerConfig,
        *,
        schedule_save: bool = True,
    ) -> bool:
        changed = False
        for target_name in (
            "heatmap_widget",
            "dda_lineplot_widget",
            "quick_heatmap_bridge",
        ):
            target = getattr(self, target_name, None)
            if target is not None and hasattr(target, "set_plot_layers"):
                changed = bool(target.set_plot_layers(layers)) or changed
        if changed and schedule_save and hasattr(self, "_schedule_session_save"):
            self._schedule_session_save()
        return changed

    def _current_result_plot_layers(self) -> PlotLayerConfig:
        return PlotLayerConfig(
            heatmap=_checkbox_checked(self, "result_layer_heatmap_checkbox", True),
            line=_checkbox_checked(self, "result_layer_line_checkbox", True),
            annotations=_checkbox_checked(
                self,
                "result_layer_annotations_checkbox",
                True,
            ),
            cursor=_checkbox_checked(self, "result_layer_cursor_checkbox", True),
        )

    def _on_result_plot_layers_changed(self) -> bool:
        return self._apply_result_plot_layers(self._current_result_plot_layers())

    def _active_dda_result_variant(self) -> Optional[DdaVariantResult]:
        result = getattr(getattr(self, "state", None), "dda_result", None)
        variants = list(getattr(result, "variants", []) or [])
        if not variants:
            return None
        active_variant_id = getattr(self, "_active_variant_id", None)
        return next(
            (item for item in variants if item.id == active_variant_id),
            variants[0],
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

    def _apply_ica_result(
        self,
        result: Optional[IcaResult],
        *,
        persist: bool = True,
    ) -> None:
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
        if persist:
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
