from __future__ import annotations

from typing import Dict

from PySide6.QtCore import Qt
from PySide6.QtGui import QDoubleValidator
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QSplitter,
    QTabBar,
    QTableWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from ...ui.plot_surface_factory import (
    create_result_plot_surface,
)
from ...ui.widgets.busy_indicator import BusyIndicatorBar
from ...ui.widgets.clickable_label import ClickableLabel
from ...ui.widgets.math_label import MathLabel
from ...ui.widgets.plots import (
    HEATMAP_COLOR_SCHEME_OPTIONS,
    DdaLinePlotWidget,
    HeatmapWidget,
    NetworkMotifWidget,
)
from ..support.main_window_support import ToggleListWidget
from .main_window_ui_stack import CurrentPageStackedWidget


class MainWindowUiAnalysisPagesMixin:
    def _build_analyze_page(self) -> QWidget:
        stack = CurrentPageStackedWidget()
        self.analyze_stack = stack
        stack.addWidget(self._build_dda_page())
        stack.addWidget(self._build_ica_page())
        stack.addWidget(self._build_batch_page())
        stack.addWidget(self._build_connectivity_page())
        stack.addWidget(self._build_compare_page())
        return stack

    def _build_dda_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)

        config_box = QGroupBox("DDA Configuration")
        config_layout = QVBoxLayout(config_box)

        variants_group = QGroupBox("Variants")
        variants_layout = QHBoxLayout(variants_group)
        self.variant_checkboxes: Dict[str, QCheckBox] = {}
        for variant in ("ST", "SY", "DE", "CT", "CD"):
            checkbox = QCheckBox(variant)
            checkbox.setChecked(variant == "ST")
            variants_layout.addWidget(checkbox)
            self.variant_checkboxes[variant] = checkbox
        config_layout.addWidget(variants_group)

        variant_channels_group = QGroupBox("Variant Channels")
        variant_channels_group_layout = QVBoxLayout(variant_channels_group)
        variant_channels_hint = QLabel(
            "These channel selections are specific to each DDA variant and do not follow the Visualize tab."
        )
        variant_channels_hint.setWordWrap(True)
        variant_channels_hint.setProperty("muted", True)
        variant_channels_group_layout.addWidget(variant_channels_hint)
        variant_channels_header = QHBoxLayout()
        self.dda_variant_selector_nav = QTabBar()
        self.dda_variant_selector_nav.setExpanding(False)
        self.dda_variant_selector_nav.setDrawBase(False)
        self.dda_variant_selector_nav.setElideMode(Qt.ElideNone)
        self.dda_variant_selector_nav.setDocumentMode(True)
        variant_channels_header.addWidget(self.dda_variant_selector_nav, 1)
        self.dda_variant_selector_status = QLabel(
            "Select a variant above to configure its channels or pairs."
        )
        self.dda_variant_selector_status.setProperty("muted", True)
        self.dda_variant_selector_status.setAlignment(
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
        )
        variant_channels_header.addWidget(self.dda_variant_selector_status)
        variant_channels_group_layout.addLayout(variant_channels_header)

        self.dda_variant_selector_empty = QLabel(
            "Turn on at least one DDA variant to configure its dedicated selector."
        )
        self.dda_variant_selector_empty.setWordWrap(True)
        self.dda_variant_selector_empty.setProperty("muted", True)
        variant_channels_group_layout.addWidget(self.dda_variant_selector_empty)

        self.dda_variant_selector_stack = CurrentPageStackedWidget()
        self.dda_variant_channel_sections: Dict[str, QGroupBox] = {}
        self.dda_variant_channel_lists: Dict[str, ToggleListWidget] = {}
        self.dda_variant_channel_filter_edits: Dict[str, QLineEdit] = {}
        self.dda_variant_channel_select_all_buttons: Dict[str, QPushButton] = {}
        self.dda_variant_channel_select_none_buttons: Dict[str, QPushButton] = {}
        self.dda_variant_pair_lists: Dict[str, QListWidget] = {}
        self.dda_variant_pair_filter_edits: Dict[str, QLineEdit] = {}
        self.dda_variant_pair_source_filter_edits: Dict[str, QLineEdit] = {}
        self.dda_variant_pair_target_filter_edits: Dict[str, QLineEdit] = {}
        self.dda_variant_pair_source_combos: Dict[str, QComboBox] = {}
        self.dda_variant_pair_target_combos: Dict[str, QComboBox] = {}
        self.dda_variant_pair_add_buttons: Dict[str, QPushButton] = {}
        self.dda_variant_pair_remove_buttons: Dict[str, QPushButton] = {}
        self.dda_variant_pair_clear_buttons: Dict[str, QPushButton] = {}
        self.dda_variant_channel_summaries: Dict[str, QLabel] = {}
        self._dda_variant_channel_names: Dict[str, list[str]] = {}
        self._dda_variant_pair_names: Dict[str, list[tuple[str, str]]] = {}
        self._dda_variant_selector_page_indices: Dict[str, int] = {}
        for variant in ("ST", "SY", "DE", "CT", "CD"):
            section = QGroupBox(
                f"{variant} {'Pairs' if variant in {'CT', 'CD'} else 'Channels'}"
            )
            section_layout = QVBoxLayout(section)
            section_layout.setContentsMargins(12, 12, 12, 12)
            section_layout.setSpacing(8)
            summary = QLabel("Open a dataset to configure channels.")
            summary.setWordWrap(True)
            summary.setProperty("muted", True)
            section_layout.addWidget(summary)
            if variant in {"CT", "CD"}:
                pair_filter_edit = QLineEdit()
                pair_filter_edit.setPlaceholderText("Search selected pairs")
                pair_filter_edit.setClearButtonEnabled(True)
                section_layout.addWidget(pair_filter_edit)
                pair_list = QListWidget()
                pair_list.setSelectionMode(QAbstractItemView.ExtendedSelection)
                pair_list.setAlternatingRowColors(True)
                pair_list.setMinimumHeight(200)
                section_layout.addWidget(pair_list, 1)

                pair_controls = QHBoxLayout()
                source_column = QVBoxLayout()
                source_filter_edit = QLineEdit()
                source_filter_edit.setPlaceholderText("Filter source channels")
                source_filter_edit.setClearButtonEnabled(True)
                source_combo = QComboBox()
                source_combo.setMinimumWidth(120)
                source_column.addWidget(source_filter_edit)
                source_column.addWidget(source_combo)
                target_column = QVBoxLayout()
                target_filter_edit = QLineEdit()
                target_filter_edit.setPlaceholderText("Filter target channels")
                target_filter_edit.setClearButtonEnabled(True)
                target_combo = QComboBox()
                target_combo.setMinimumWidth(120)
                target_column.addWidget(target_filter_edit)
                target_column.addWidget(target_combo)
                arrow = QLabel("<>")
                if variant == "CD":
                    arrow.setText("→")
                arrow.setProperty("muted", True)
                add_button = QPushButton("Add Pair")
                add_button.setProperty("secondary", True)
                remove_button = QPushButton("Remove Selected")
                remove_button.setProperty("secondary", True)
                clear_button = QPushButton("Clear")
                clear_button.setProperty("secondary", True)
                pair_controls.addLayout(source_column, 1)
                pair_controls.addWidget(arrow)
                pair_controls.addLayout(target_column, 1)
                pair_controls.addWidget(add_button)
                pair_controls.addWidget(remove_button)
                pair_controls.addWidget(clear_button)
                section_layout.addLayout(pair_controls)

                self.dda_variant_pair_filter_edits[variant] = pair_filter_edit
                self.dda_variant_pair_source_filter_edits[variant] = source_filter_edit
                self.dda_variant_pair_target_filter_edits[variant] = target_filter_edit
                self.dda_variant_pair_lists[variant] = pair_list
                self.dda_variant_pair_source_combos[variant] = source_combo
                self.dda_variant_pair_target_combos[variant] = target_combo
                self.dda_variant_pair_add_buttons[variant] = add_button
                self.dda_variant_pair_remove_buttons[variant] = remove_button
                self.dda_variant_pair_clear_buttons[variant] = clear_button
            else:
                channel_filter_edit = QLineEdit()
                channel_filter_edit.setPlaceholderText("Search channels")
                channel_filter_edit.setClearButtonEnabled(True)
                section_layout.addWidget(channel_filter_edit)
                channel_actions = QHBoxLayout()
                select_all_button = QPushButton("All")
                select_all_button.setProperty("secondary", True)
                select_none_button = QPushButton("None")
                select_none_button.setProperty("secondary", True)
                channel_actions.addWidget(select_all_button)
                channel_actions.addWidget(select_none_button)
                channel_actions.addStretch(1)
                section_layout.addLayout(channel_actions)
                channel_list = ToggleListWidget()
                channel_list.setSelectionMode(QAbstractItemView.NoSelection)
                channel_list.setUniformItemSizes(True)
                channel_list.setSpacing(3)
                channel_list.setMinimumHeight(220)
                section_layout.addWidget(channel_list, 1)
                self.dda_variant_channel_filter_edits[variant] = channel_filter_edit
                self.dda_variant_channel_select_all_buttons[variant] = select_all_button
                self.dda_variant_channel_select_none_buttons[variant] = (
                    select_none_button
                )
                self.dda_variant_channel_lists[variant] = channel_list
            self.dda_variant_channel_sections[variant] = section
            self.dda_variant_channel_summaries[variant] = summary
            self._dda_variant_selector_page_indices[variant] = (
                self.dda_variant_selector_stack.addWidget(section)
            )
        variant_channels_group_layout.addWidget(self.dda_variant_selector_stack, 1)
        config_layout.addWidget(variant_channels_group, 2)

        form = QFormLayout()
        self.window_length_spin = QSpinBox()
        self.window_length_spin.setRange(1, 65536)
        self.window_length_spin.setValue(64)
        self.window_step_spin = QSpinBox()
        self.window_step_spin.setRange(1, 65536)
        self.window_step_spin.setValue(10)
        self.dda_start_edit = QLineEdit("0")
        self.dda_end_edit = QLineEdit("30")
        dda_time_validator = QDoubleValidator(0.0, 1_000_000_000.0, 6, self)
        dda_time_validator.setNotation(QDoubleValidator.StandardNotation)
        self.dda_start_edit.setValidator(dda_time_validator)
        self.dda_end_edit.setValidator(dda_time_validator)
        self.dda_end_edit.setPlaceholderText("Leave blank for end")
        form.addRow("Window length", self.window_length_spin)
        form.addRow("Window step", self.window_step_spin)
        form.addRow("Start (s)", self.dda_start_edit)
        form.addRow("End (s)", self.dda_end_edit)
        config_layout.addLayout(form)

        expert_box = QGroupBox("Expert Mode")
        expert_layout = QVBoxLayout(expert_box)
        expert_layout.setSpacing(8)

        expert_header = QHBoxLayout()
        self.dda_expert_mode_checkbox = QCheckBox("Enable advanced DDA controls")
        self.dda_expert_mode_checkbox.setChecked(self.state.expert_mode)
        expert_header.addWidget(self.dda_expert_mode_checkbox)
        expert_header.addStretch(1)
        self.dda_expert_mode_status = QLabel("Standard EEG preset active")
        self.dda_expert_mode_status.setProperty("muted", True)
        expert_header.addWidget(self.dda_expert_mode_status)
        expert_layout.addLayout(expert_header)

        self.dda_expert_summary_label = QLabel(
            "Standard mode uses the archived DDALAB EEG defaults for delays and MODEL selection."
        )
        self.dda_expert_summary_label.setWordWrap(True)
        self.dda_expert_summary_label.setProperty("muted", True)
        expert_layout.addWidget(self.dda_expert_summary_label)

        self.dda_expert_summary_equation = MathLabel()
        expert_layout.addWidget(self.dda_expert_summary_equation)

        self.dda_expert_panel = QWidget()
        dda_expert_panel_layout = QVBoxLayout(self.dda_expert_panel)
        dda_expert_panel_layout.setContentsMargins(0, 0, 0, 0)
        dda_expert_panel_layout.setSpacing(8)

        expert_form = QFormLayout()
        self.delays_edit = QLineEdit("7,10")
        self.dda_model_dimension_spin = QSpinBox()
        self.dda_model_dimension_spin.setRange(1, 16)
        self.dda_model_dimension_spin.setValue(4)
        self.dda_polynomial_order_spin = QSpinBox()
        self.dda_polynomial_order_spin.setRange(1, 8)
        self.dda_polynomial_order_spin.setValue(4)
        self.dda_nr_tau_spin = QSpinBox()
        self.dda_nr_tau_spin.setRange(1, 8)
        self.dda_nr_tau_spin.setValue(2)
        expert_form.addRow("Delays", self.delays_edit)
        expert_form.addRow("Embedding dim", self.dda_model_dimension_spin)
        expert_form.addRow("Polynomial order", self.dda_polynomial_order_spin)
        expert_form.addRow("Model delays", self.dda_nr_tau_spin)
        dda_expert_panel_layout.addLayout(expert_form)

        preset_row = QHBoxLayout()
        self.dda_model_preset_combo = QComboBox()
        self.dda_model_preset_combo.addItem("EEG Standard", "eeg-standard")
        self.dda_model_preset_combo.addItem("Linear Only", "linear-only")
        self.dda_model_preset_combo.addItem("Quadratic Diagonal", "quadratic-diagonal")
        self.dda_model_preset_combo.addItem("Full Quadratic", "full-quadratic")
        self.dda_model_preset_combo.addItem("Symmetric", "symmetric")
        self.dda_apply_model_preset_button = QPushButton("Apply Preset")
        self.dda_apply_model_preset_button.setProperty("secondary", True)
        self.dda_reset_model_button = QPushButton("Reset Default")
        self.dda_reset_model_button.setProperty("secondary", True)
        preset_row.addWidget(self.dda_model_preset_combo, 1)
        preset_row.addWidget(self.dda_apply_model_preset_button)
        preset_row.addWidget(self.dda_reset_model_button)
        dda_expert_panel_layout.addLayout(preset_row)

        self.dda_model_terms_hint = QLabel(
            "Select the polynomial terms that should be sent to the DDA backend."
        )
        self.dda_model_terms_hint.setWordWrap(True)
        self.dda_model_terms_hint.setProperty("muted", True)
        dda_expert_panel_layout.addWidget(self.dda_model_terms_hint)

        self.dda_model_terms_list = ToggleListWidget()
        self.dda_model_terms_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.dda_model_terms_list.setSpacing(3)
        self.dda_model_terms_list.setMinimumHeight(220)
        dda_expert_panel_layout.addWidget(self.dda_model_terms_list, 1)

        self.dda_model_term_summary = QLabel("")
        self.dda_model_term_summary.setWordWrap(True)
        self.dda_model_term_summary.setProperty("muted", True)
        dda_expert_panel_layout.addWidget(self.dda_model_term_summary)

        self.dda_model_preview_label = MathLabel()
        dda_expert_panel_layout.addWidget(self.dda_model_preview_label)

        expert_layout.addWidget(self.dda_expert_panel)
        config_layout.addWidget(expert_box)

        self.dda_activity_frame = QFrame()
        dda_activity_layout = QVBoxLayout(self.dda_activity_frame)
        dda_activity_layout.setContentsMargins(0, 0, 0, 0)
        dda_activity_layout.setSpacing(6)
        self.dda_activity_label = ClickableLabel("")
        self.dda_activity_label.setWordWrap(True)
        self.dda_activity_label.setProperty("muted", True)
        self.dda_activity_label.setToolTip("Show DDA run details")
        self.dda_activity_detail_label = QLabel("")
        self.dda_activity_detail_label.setWordWrap(True)
        self.dda_activity_detail_label.setProperty("muted", True)
        self.dda_activity_progress_bar = QProgressBar()
        self.dda_activity_progress_bar.setRange(0, 0)
        self.dda_activity_progress_bar.setTextVisible(True)
        self.dda_activity_progress = BusyIndicatorBar(bar_height=6, interval_ms=56)
        dda_activity_layout.addWidget(self.dda_activity_label)
        dda_activity_layout.addWidget(self.dda_activity_detail_label)
        dda_activity_layout.addWidget(self.dda_activity_progress_bar)
        dda_activity_layout.addWidget(self.dda_activity_progress)
        self.dda_activity_frame.setVisible(False)
        config_layout.addWidget(self.dda_activity_frame)

        self.run_dda_from_page_button = QPushButton("Run DDA")
        config_layout.addWidget(self.run_dda_from_page_button)
        self.dda_diagnostics = QPlainTextEdit()
        self.dda_diagnostics.setReadOnly(True)
        self.dda_diagnostics.setPlaceholderText("Diagnostics and execution details")
        config_layout.addWidget(self.dda_diagnostics, 1)
        left_layout.addWidget(config_box, 4)

        self.dda_import_snapshot_button = QPushButton("Import .ddalab")
        self.dda_import_snapshot_button.setProperty("secondary", True)
        self.dda_import_snapshot_button.setToolTip(
            "Open a DDALAB snapshot file (.ddalab)."
        )
        history_box = QGroupBox("Analysis History")
        history_layout = QVBoxLayout(history_box)
        history_actions = QHBoxLayout()
        self.dda_view_history_result_button = QPushButton("Load Selected")
        self.dda_view_history_result_button.setProperty("secondary", True)
        history_actions.addWidget(self.dda_view_history_result_button)
        history_actions.addStretch(1)
        history_layout.addLayout(history_actions)

        self.dda_history_status_label = QLabel("No saved analyses for this file yet.")
        self.dda_history_status_label.setWordWrap(True)
        self.dda_history_status_label.setProperty("muted", True)
        history_layout.addWidget(self.dda_history_status_label)

        self.dda_history_table = QTableWidget(0, 4)
        self.dda_history_table.setHorizontalHeaderLabels(
            ["Created", "Variants", "Engine", "Result ID"]
        )
        self.dda_history_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.dda_history_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.dda_history_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.dda_history_table.setAlternatingRowColors(True)
        self.dda_history_table.verticalHeader().hide()
        self.dda_history_table.verticalHeader().setDefaultSectionSize(34)
        self.dda_history_table.horizontalHeader().setStretchLastSection(True)
        self._configure_table_columns(
            self.dda_history_table,
            [168, 126, 132, None],
        )
        history_layout.addWidget(self.dda_history_table, 1)
        left_layout.addWidget(history_box, 2)
        left_scroll = self._wrap_scroll_panel(left_panel)

        results_box = QGroupBox("Results")
        results_layout = QVBoxLayout(results_box)
        header = QHBoxLayout()
        self.variant_combo = QComboBox()
        header.addWidget(QLabel("Variant"))
        header.addWidget(self.variant_combo, 1)
        self.heatmap_color_scheme_combo = QComboBox()
        for scheme_id, scheme_label in HEATMAP_COLOR_SCHEME_OPTIONS:
            self.heatmap_color_scheme_combo.addItem(scheme_label, scheme_id)
        self.heatmap_color_scheme_combo.setCurrentIndex(
            self.heatmap_color_scheme_combo.findData("viridis")
        )
        header.addWidget(QLabel("Colors"))
        header.addWidget(self.heatmap_color_scheme_combo)
        header.addWidget(QLabel("Layers"))
        self.result_layer_heatmap_checkbox = QCheckBox("Heatmap")
        self.result_layer_line_checkbox = QCheckBox("Line")
        self.result_layer_cursor_checkbox = QCheckBox("Cursor")
        self.result_layer_annotations_checkbox = QCheckBox("Annotations")
        for checkbox in (
            self.result_layer_heatmap_checkbox,
            self.result_layer_line_checkbox,
            self.result_layer_cursor_checkbox,
            self.result_layer_annotations_checkbox,
        ):
            checkbox.setChecked(True)
            header.addWidget(checkbox)
        results_layout.addLayout(header)

        export_actions = QHBoxLayout()
        export_actions.addWidget(self.dda_import_snapshot_button)
        self.dda_snapshot_export_button = QPushButton("Export .ddalab")
        self.dda_snapshot_export_button.setProperty("secondary", True)
        self.dda_snapshot_export_button.setToolTip(
            "Save the current dataset state and result to a DDALAB snapshot file."
        )
        self.dda_data_export_button = self._build_more_exports_button(
            include_annotations=False,
            actions_attr="dda_more_export_actions",
        )

        for button in (
            self.dda_snapshot_export_button,
            self.dda_data_export_button,
        ):
            export_actions.addWidget(button)
        export_actions.addStretch(1)
        results_layout.addLayout(export_actions)
        self.quick_heatmap_bridge = None
        self.quick_heatmap_widget = None
        quick_result_surface = create_result_plot_surface(self)
        if quick_result_surface is not None:
            quick_heatmap_box = QGroupBox("Qt Quick Heatmap")
            quick_heatmap_layout = QVBoxLayout(quick_heatmap_box)
            self.quick_heatmap_bridge = quick_result_surface.bridge
            self.quick_heatmap_widget = quick_result_surface.widget
            self.quick_heatmap_widget.setMinimumHeight(260)
            quick_heatmap_layout.addWidget(self.quick_heatmap_widget)
            results_layout.addWidget(quick_heatmap_box, 1)
        self.heatmap_widget = HeatmapWidget()
        results_layout.addWidget(self.heatmap_widget, 1)
        self.dda_lineplot_widget = DdaLinePlotWidget()
        results_layout.addWidget(self.dda_lineplot_widget, 1)
        self.result_summary = QTextEdit()
        self.result_summary.setReadOnly(True)
        self.result_summary.setMinimumHeight(120)
        results_layout.addWidget(self.result_summary)
        results_scroll = self._wrap_scroll_panel(results_box)

        splitter.addWidget(left_scroll)
        splitter.addWidget(results_scroll)
        splitter.setSizes([520, 900])
        return splitter

    def _build_ica_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        config_box = QGroupBox("ICA Configuration")
        config_layout = QVBoxLayout(config_box)

        guidance = QLabel(
            "ICA uses the channels currently selected in Visualize. Select at least two channels before running."
        )
        guidance.setWordWrap(True)
        guidance.setProperty("muted", True)
        config_layout.addWidget(guidance)
        self.ica_channel_summary_label = guidance

        form = QFormLayout()
        self.ica_n_components_spin = QSpinBox()
        self.ica_n_components_spin.setRange(0, 256)
        self.ica_n_components_spin.setValue(0)
        self.ica_n_components_spin.setSpecialValueText("Auto")
        self.ica_max_iterations_spin = QSpinBox()
        self.ica_max_iterations_spin.setRange(10, 5000)
        self.ica_max_iterations_spin.setValue(500)
        self.ica_tolerance_spin = QDoubleSpinBox()
        self.ica_tolerance_spin.setDecimals(6)
        self.ica_tolerance_spin.setRange(0.000001, 1.0)
        self.ica_tolerance_spin.setSingleStep(0.0001)
        self.ica_tolerance_spin.setValue(0.0001)
        self.ica_start_edit = QLineEdit("0")
        self.ica_end_edit = QLineEdit("")
        ica_time_validator = QDoubleValidator(0.0, 1_000_000_000.0, 6, self)
        ica_time_validator.setNotation(QDoubleValidator.StandardNotation)
        self.ica_start_edit.setValidator(ica_time_validator)
        self.ica_end_edit.setValidator(ica_time_validator)
        self.ica_end_edit.setPlaceholderText("Leave blank for end")
        form.addRow("Components", self.ica_n_components_spin)
        form.addRow("Max iterations", self.ica_max_iterations_spin)
        form.addRow("Tolerance", self.ica_tolerance_spin)
        form.addRow("Start (s)", self.ica_start_edit)
        form.addRow("End (s)", self.ica_end_edit)
        config_layout.addLayout(form)

        toggles = QHBoxLayout()
        self.ica_centering_checkbox = QCheckBox("Centering")
        self.ica_centering_checkbox.setChecked(True)
        self.ica_whitening_checkbox = QCheckBox("Whitening")
        self.ica_whitening_checkbox.setChecked(True)
        toggles.addWidget(self.ica_centering_checkbox)
        toggles.addWidget(self.ica_whitening_checkbox)
        toggles.addStretch(1)
        config_layout.addLayout(toggles)

        self.run_ica_button = QPushButton("Run ICA")
        config_layout.addWidget(self.run_ica_button)
        self.ica_diagnostics = QPlainTextEdit()
        self.ica_diagnostics.setReadOnly(True)
        self.ica_diagnostics.setPlaceholderText("ICA diagnostics and execution details")
        config_layout.addWidget(self.ica_diagnostics, 1)

        results_box = QGroupBox("ICA Results")
        results_layout = QVBoxLayout(results_box)
        self.ica_result_summary = QTextEdit()
        self.ica_result_summary.setReadOnly(True)
        self.ica_result_summary.setMinimumHeight(110)
        results_layout.addWidget(self.ica_result_summary)

        self.ica_components_table = QTableWidget(0, 4)
        self.ica_components_table.setHorizontalHeaderLabels(
            ["Component", "Variance", "Kurtosis", "Non-Gaussianity"]
        )
        self.ica_components_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.ica_components_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.ica_components_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.ica_components_table.setAlternatingRowColors(True)
        self.ica_components_table.verticalHeader().hide()
        self.ica_components_table.verticalHeader().setDefaultSectionSize(34)
        self.ica_components_table.horizontalHeader().setStretchLastSection(True)
        results_layout.addWidget(self.ica_components_table, 1)

        self.ica_component_details = QPlainTextEdit()
        self.ica_component_details.setReadOnly(True)
        self.ica_component_details.setPlaceholderText(
            "Select a component to inspect the preview metrics."
        )
        results_layout.addWidget(self.ica_component_details)

        splitter.addWidget(config_box)
        splitter.addWidget(results_box)
        splitter.setSizes([340, 960])
        return splitter

    def _build_batch_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        queue_box = QGroupBox("Batch Queue")
        queue_layout = QVBoxLayout(queue_box)
        guidance = QLabel(
            "Select multiple datasets and reuse the current DDA configuration across them."
        )
        guidance.setWordWrap(True)
        guidance.setProperty("muted", True)
        queue_layout.addWidget(guidance)

        batch_actions = QHBoxLayout()
        self.batch_select_all_button = QPushButton("Select All")
        self.batch_add_files_button = QPushButton("Add Files")
        self.batch_add_files_button.setProperty("secondary", True)
        self.batch_select_open_button = QPushButton("Select Open")
        self.batch_select_open_button.setProperty("secondary", True)
        self.batch_run_button = QPushButton("Run Batch")
        self.batch_run_button.setProperty("secondary", True)
        batch_actions.addWidget(self.batch_select_all_button)
        batch_actions.addWidget(self.batch_add_files_button)
        batch_actions.addWidget(self.batch_select_open_button)
        batch_actions.addWidget(self.batch_run_button)
        batch_actions.addStretch(1)
        queue_layout.addLayout(batch_actions)

        self.batch_file_list = ToggleListWidget()
        self.batch_file_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.batch_file_list.setUniformItemSizes(True)
        self.batch_file_list.setSpacing(3)
        queue_layout.addWidget(self.batch_file_list, 1)

        results_box = QGroupBox("Batch Results")
        results_layout = QVBoxLayout(results_box)
        self.batch_status_label = QLabel("Select files to start batch analysis.")
        self.batch_status_label.setWordWrap(True)
        self.batch_status_label.setProperty("muted", True)
        results_layout.addWidget(self.batch_status_label)

        self.batch_results_table = QTableWidget(0, 4)
        self.batch_results_table.setHorizontalHeaderLabels(
            ["File", "Result", "Variants", "Created"]
        )
        self.batch_results_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.batch_results_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.batch_results_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.batch_results_table.setAlternatingRowColors(True)
        self.batch_results_table.verticalHeader().hide()
        self.batch_results_table.verticalHeader().setDefaultSectionSize(34)
        self.batch_results_table.horizontalHeader().setStretchLastSection(True)
        self._configure_table_columns(
            self.batch_results_table,
            [224, 96, 128, None],
        )
        results_layout.addWidget(self.batch_results_table, 1)

        self.batch_details = QPlainTextEdit()
        self.batch_details.setReadOnly(True)
        self.batch_details.setPlaceholderText("Batch run details will appear here.")
        results_layout.addWidget(self.batch_details)

        splitter.addWidget(queue_box)
        splitter.addWidget(results_box)
        splitter.setSizes([420, 880])
        return splitter

    def _build_connectivity_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        source_box = QGroupBox("Connectivity Source")
        source_layout = QVBoxLayout(source_box)
        self.connectivity_result_combo = QComboBox()
        source_layout.addWidget(self.connectivity_result_combo)
        self.connectivity_summary = QPlainTextEdit()
        self.connectivity_summary.setReadOnly(True)
        self.connectivity_summary.setPlaceholderText(
            "Run DDA with CT, CD, or SY to inspect connectivity metrics."
        )
        source_layout.addWidget(self.connectivity_summary, 1)

        motif_box = QGroupBox("Network Motifs")
        motif_layout = QVBoxLayout(motif_box)
        self.connectivity_motif_summary_label = QLabel(
            "Run DDA with CD to inspect directed causality motifs."
        )
        self.connectivity_motif_summary_label.setWordWrap(True)
        self.connectivity_motif_summary_label.setProperty("muted", True)
        motif_layout.addWidget(self.connectivity_motif_summary_label)

        self.connectivity_motif_scroll = QScrollArea()
        self.connectivity_motif_scroll.setWidgetResizable(False)
        self.connectivity_motif_scroll.setFrameShape(QFrame.NoFrame)
        self.connectivity_motif_scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarAsNeeded
        )
        self.connectivity_motif_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        self.connectivity_motif_widget = NetworkMotifWidget()
        self.connectivity_motif_scroll.setWidget(self.connectivity_motif_widget)
        motif_layout.addWidget(self.connectivity_motif_scroll, 1)

        metrics_box = QGroupBox("Ranked Edges")
        metrics_layout = QVBoxLayout(metrics_box)
        self.connectivity_table = QTableWidget(0, 3)
        self.connectivity_table.setHorizontalHeaderLabels(
            ["Label", "Mean |x|", "Peak |x|"]
        )
        self.connectivity_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.connectivity_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.connectivity_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.connectivity_table.setAlternatingRowColors(True)
        self.connectivity_table.verticalHeader().hide()
        self.connectivity_table.verticalHeader().setDefaultSectionSize(34)
        self.connectivity_table.horizontalHeader().setStretchLastSection(True)
        self._configure_table_columns(
            self.connectivity_table,
            [None, 118, 118],
        )
        metrics_layout.addWidget(self.connectivity_table, 1)

        right_splitter = QSplitter(Qt.Vertical)
        right_splitter.setChildrenCollapsible(False)
        right_splitter.addWidget(motif_box)
        right_splitter.addWidget(metrics_box)
        right_splitter.setSizes([430, 290])

        splitter.addWidget(source_box)
        splitter.addWidget(right_splitter)
        splitter.setSizes([360, 940])
        return splitter

    def _build_compare_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        setup_box = QGroupBox("Comparison Setup")
        setup_layout = QFormLayout(setup_box)
        self.compare_baseline_combo = QComboBox()
        self.compare_target_combo = QComboBox()
        self.compare_swap_button = QPushButton("Swap")
        self.compare_swap_button.setProperty("secondary", True)
        self.compare_variant_combo = QComboBox()
        self.compare_shared_meta_label = QLabel(
            "Select two analyses to inspect their shared variants and rows."
        )
        self.compare_shared_meta_label.setProperty("muted", True)
        self.compare_shared_meta_label.setWordWrap(True)
        setup_layout.addRow("Baseline", self.compare_baseline_combo)
        setup_layout.addRow("Compare against", self.compare_target_combo)
        setup_layout.addRow("", self.compare_swap_button)
        setup_layout.addRow("Variant", self.compare_variant_combo)
        setup_layout.addRow("", self.compare_shared_meta_label)

        row_box = QGroupBox("Shared Rows")
        row_layout = QVBoxLayout(row_box)
        row_actions = QHBoxLayout()
        self.compare_select_top_rows_button = QPushButton("Top Changed")
        self.compare_select_top_rows_button.setProperty("secondary", True)
        self.compare_select_all_rows_button = QPushButton("Select All")
        self.compare_select_all_rows_button.setProperty("secondary", True)
        self.compare_clear_rows_button = QPushButton("Clear")
        self.compare_clear_rows_button.setProperty("secondary", True)
        row_actions.addWidget(self.compare_select_top_rows_button)
        row_actions.addWidget(self.compare_select_all_rows_button)
        row_actions.addWidget(self.compare_clear_rows_button)
        row_actions.addStretch(1)
        row_layout.addLayout(row_actions)
        self.compare_row_list = ToggleListWidget()
        self.compare_row_list.setMinimumHeight(220)
        self.compare_row_list.setAlternatingRowColors(True)
        row_layout.addWidget(self.compare_row_list, 1)
        self.compare_row_summary_label = QLabel(
            "Choose the shared rows to use in heatmaps, lines, and statistics."
        )
        self.compare_row_summary_label.setProperty("muted", True)
        self.compare_row_summary_label.setWordWrap(True)
        row_layout.addWidget(self.compare_row_summary_label)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)
        left_layout.addWidget(setup_box)
        left_layout.addWidget(row_box, 1)
        self.compare_summary = QPlainTextEdit()
        self.compare_summary.setReadOnly(True)
        self.compare_summary.setPlaceholderText(
            "Select two analyses to compare their shared variants, rows, and trends."
        )
        left_layout.addWidget(self.compare_summary, 1)

        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(12)

        self.compare_view_nav = QTabBar()
        self.compare_view_nav.setDocumentMode(True)
        self.compare_view_nav.setDrawBase(False)
        self.compare_view_nav.setExpanding(False)
        self.compare_view_nav.addTab("Summary")
        self.compare_view_nav.addTab("Heatmaps")
        self.compare_view_nav.addTab("Lines")
        self.compare_view_nav.addTab("Stats")
        right_layout.addWidget(self.compare_view_nav)

        self.compare_view_stack = CurrentPageStackedWidget()

        summary_page = QWidget()
        summary_layout = QVBoxLayout(summary_page)
        summary_layout.setContentsMargins(0, 0, 0, 0)
        summary_layout.setSpacing(12)
        table_box = QGroupBox("Variant Deltas")
        table_layout = QVBoxLayout(table_box)
        self.compare_table = QTableWidget(0, 6)
        self.compare_table.setHorizontalHeaderLabels(
            [
                "Variant",
                "Baseline Mean",
                "Target Mean",
                "Delta",
                "Shared Rows",
                "Top Changed Row",
            ]
        )
        self.compare_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.compare_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.compare_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.compare_table.setAlternatingRowColors(True)
        self.compare_table.verticalHeader().hide()
        self.compare_table.verticalHeader().setDefaultSectionSize(34)
        self.compare_table.horizontalHeader().setStretchLastSection(True)
        self._configure_table_columns(
            self.compare_table,
            [78, 118, 118, 108, 96, None],
        )
        table_layout.addWidget(self.compare_table, 1)
        summary_layout.addWidget(table_box, 1)
        self.compare_view_stack.addWidget(summary_page)

        heatmap_page = QWidget()
        heatmap_layout = QHBoxLayout(heatmap_page)
        heatmap_layout.setContentsMargins(0, 0, 0, 0)
        heatmap_layout.setSpacing(12)
        baseline_heatmap_box = QGroupBox("Baseline Heatmap")
        baseline_heatmap_layout = QVBoxLayout(baseline_heatmap_box)
        self.compare_baseline_heatmap = HeatmapWidget()
        baseline_heatmap_layout.addWidget(self.compare_baseline_heatmap, 1)
        diff_heatmap_box = QGroupBox("Difference Heatmap")
        diff_heatmap_layout = QVBoxLayout(diff_heatmap_box)
        self.compare_difference_heatmap = HeatmapWidget()
        self.compare_difference_heatmap.set_color_scheme("jet")
        diff_heatmap_layout.addWidget(self.compare_difference_heatmap, 1)
        target_heatmap_box = QGroupBox("Target Heatmap")
        target_heatmap_layout = QVBoxLayout(target_heatmap_box)
        self.compare_target_heatmap = HeatmapWidget()
        target_heatmap_layout.addWidget(self.compare_target_heatmap, 1)
        heatmap_layout.addWidget(baseline_heatmap_box, 1)
        heatmap_layout.addWidget(diff_heatmap_box, 1)
        heatmap_layout.addWidget(target_heatmap_box, 1)
        self.compare_view_stack.addWidget(heatmap_page)

        lines_page = QWidget()
        lines_layout = QVBoxLayout(lines_page)
        lines_layout.setContentsMargins(0, 0, 0, 0)
        lines_layout.setSpacing(12)
        overlay_box = QGroupBox("Overlay Line Plot")
        overlay_layout = QVBoxLayout(overlay_box)
        self.compare_overlay_lineplot = DdaLinePlotWidget()
        overlay_layout.addWidget(self.compare_overlay_lineplot, 1)
        diff_line_box = QGroupBox("Difference Line Plot")
        diff_line_layout = QVBoxLayout(diff_line_box)
        self.compare_difference_lineplot = DdaLinePlotWidget()
        diff_line_layout.addWidget(self.compare_difference_lineplot, 1)
        lines_layout.addWidget(overlay_box, 1)
        lines_layout.addWidget(diff_line_box, 1)
        self.compare_view_stack.addWidget(lines_page)

        stats_page = QWidget()
        stats_layout = QVBoxLayout(stats_page)
        stats_layout.setContentsMargins(0, 0, 0, 0)
        stats_layout.setSpacing(12)
        self.compare_stats_summary = QPlainTextEdit()
        self.compare_stats_summary.setReadOnly(True)
        self.compare_stats_summary.setPlaceholderText(
            "Row-level statistics will appear here when two analyses share a variant."
        )
        stats_layout.addWidget(self.compare_stats_summary)
        stats_box = QGroupBox("Row Statistics")
        stats_box_layout = QVBoxLayout(stats_box)
        self.compare_stats_table = QTableWidget(0, 7)
        self.compare_stats_table.setHorizontalHeaderLabels(
            [
                "Row",
                "Correlation",
                "Baseline Mean",
                "Target Mean",
                "Mean |Diff|",
                "Max |Diff|",
                "RMS Diff",
            ]
        )
        self.compare_stats_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.compare_stats_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.compare_stats_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.compare_stats_table.setAlternatingRowColors(True)
        self.compare_stats_table.verticalHeader().hide()
        self.compare_stats_table.verticalHeader().setDefaultSectionSize(34)
        self.compare_stats_table.horizontalHeader().setStretchLastSection(False)
        self._configure_table_columns(
            self.compare_stats_table,
            [None, 112, 112, 112, 112, 112, 112],
        )
        stats_box_layout.addWidget(self.compare_stats_table, 1)
        stats_layout.addWidget(stats_box, 1)
        self.compare_view_stack.addWidget(stats_page)

        right_layout.addWidget(self.compare_view_stack, 1)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_panel)
        splitter.setSizes([360, 1040])
        return splitter
