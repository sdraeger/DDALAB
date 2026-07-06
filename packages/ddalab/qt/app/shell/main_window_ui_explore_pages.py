from __future__ import annotations

from typing import Dict

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QPushButton,
    QSplitter,
    QTableWidget,
    QVBoxLayout,
    QWidget,
)

from ...ui.plot_surface_factory import (
    create_waveform_plot_surface,
)
from ...ui.widgets.busy_indicator import BusyIndicatorBar
from ...ui.widgets.plots import (
    OverviewWidget,
    WaveformWidget,
)
from ..support.main_window_support import ToggleListWidget
from .main_window_ui_stack import CurrentPageStackedWidget


class MainWindowUiExplorePagesMixin:
    def _build_overview_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(14)

        hero = QGroupBox("Workspace")
        hero_layout = QVBoxLayout(hero)
        self.overview_summary = QLabel(
            "Connect to the backend and open a dataset to begin."
        )
        self.overview_summary.setWordWrap(True)
        self.overview_summary.setProperty("muted", True)
        hero_layout.addWidget(self.overview_summary)
        self.overview_loading_hint = QLabel("Loading dataset metadata…")
        self.overview_loading_hint.setWordWrap(True)
        self.overview_loading_hint.setProperty("muted", True)
        self.overview_loading_hint.hide()
        hero_layout.addWidget(self.overview_loading_hint)
        self.overview_loading_bar = BusyIndicatorBar(bar_height=5)
        self.overview_loading_bar.hide()
        self.overview_loading_bar.set_running(False)
        hero_layout.addWidget(self.overview_loading_bar)
        layout.addWidget(hero)

        grid = QGridLayout()
        grid.setSpacing(12)
        self.overview_cards: Dict[str, QLabel] = {}
        self.overview_card_supporting: Dict[str, QLabel] = {}
        self.overview_card_loaders: Dict[str, BusyIndicatorBar] = {}
        for index, (title, key) in enumerate(
            [
                ("Format", "format"),
                ("Duration", "duration"),
                ("Channels", "channels"),
                ("Samples", "samples"),
            ]
        ):
            card = QGroupBox(title)
            card_layout = QVBoxLayout(card)
            value_label = QLabel("—")
            value_label.setProperty("title", True)
            supporting = QLabel("")
            supporting.setProperty("muted", True)
            card_layout.addWidget(value_label)
            card_layout.addWidget(supporting)
            loader = BusyIndicatorBar(bar_height=4)
            loader.hide()
            loader.set_running(False)
            card_layout.addWidget(loader)
            grid.addWidget(card, index // 2, index % 2)
            self.overview_cards[key] = value_label
            self.overview_card_supporting[key] = supporting
            self.overview_card_loaders[key] = loader
        layout.addLayout(grid)

        self.dataset_notes = QPlainTextEdit()
        self.dataset_notes.setReadOnly(True)
        self.dataset_notes.setPlaceholderText("Dataset notes will appear here.")
        layout.addWidget(self.dataset_notes, 1)
        return page

    def _build_visualize_page(self) -> QWidget:
        stack = CurrentPageStackedWidget()
        self.visualize_stack = stack
        stack.addWidget(self._build_visualize_time_series_page())
        stack.addWidget(self._build_annotations_page())
        stack.addWidget(self._build_streaming_page())
        stack.addWidget(self._build_data_page())
        return stack

    def _build_visualize_time_series_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        inspector = QGroupBox("Channels")
        inspector_layout = QVBoxLayout(inspector)
        self.channel_filter_edit = QLineEdit()
        self.channel_filter_edit.setPlaceholderText("Search channels")
        self.channel_filter_edit.setClearButtonEnabled(True)
        inspector_layout.addWidget(self.channel_filter_edit)
        channel_actions = QHBoxLayout()
        self.select_all_channels_button = QPushButton("All")
        self.select_no_channels_button = QPushButton("None")
        self.select_top_eight_button = QPushButton("Top 8")
        self.select_top_four_button = QPushButton("Top 4")
        for button in (
            self.select_all_channels_button,
            self.select_no_channels_button,
            self.select_top_eight_button,
            self.select_top_four_button,
        ):
            button.setProperty("secondary", True)
            channel_actions.addWidget(button)
        inspector_layout.addLayout(channel_actions)
        self.channel_list = ToggleListWidget()
        self.channel_list.setSelectionMode(QAbstractItemView.NoSelection)
        self.channel_list.setUniformItemSizes(True)
        self.channel_list.setSpacing(3)
        inspector_layout.addWidget(self.channel_list, 1)

        workspace = QWidget()
        workspace_layout = QVBoxLayout(workspace)
        workspace_layout.setSpacing(10)

        controls = QHBoxLayout()
        self.viewport_label = QLabel("Viewport")
        self.viewport_label.setProperty("muted", True)
        controls.addWidget(self.viewport_label, 1)
        self.pan_left_button = QPushButton("←")
        self.pan_right_button = QPushButton("→")
        self.zoom_out_button = QPushButton("Zoom Out")
        self.zoom_in_button = QPushButton("Zoom In")
        self.reset_view_button = QPushButton("Reset")
        self.waveform_layer_waveform_checkbox = QCheckBox("Waveform")
        self.waveform_layer_annotations_checkbox = QCheckBox("Annotations")
        for button in (
            self.pan_left_button,
            self.pan_right_button,
            self.zoom_out_button,
            self.zoom_in_button,
            self.reset_view_button,
        ):
            button.setProperty("secondary", True)
            controls.addWidget(button)
        controls.addWidget(QLabel("Layers"))
        for checkbox in (
            self.waveform_layer_waveform_checkbox,
            self.waveform_layer_annotations_checkbox,
        ):
            checkbox.setChecked(True)
            controls.addWidget(checkbox)
        workspace_layout.addLayout(controls)

        self.waveform_widget = WaveformWidget()
        self.quick_waveform_bridge = None
        self.quick_waveform_widget = None
        quick_waveform_surface = create_waveform_plot_surface(self)
        if quick_waveform_surface is not None:
            self.quick_waveform_bridge = quick_waveform_surface.bridge
            self.quick_waveform_widget = quick_waveform_surface.widget
            self.quick_waveform_widget.setMinimumHeight(180)
            workspace_layout.addWidget(self.quick_waveform_widget)
        self.overview_widget = OverviewWidget()
        workspace_layout.addWidget(self.waveform_widget, 1)
        workspace_layout.addWidget(self.overview_widget)

        splitter.addWidget(inspector)
        splitter.addWidget(workspace)
        splitter.setSizes([300, 1000])
        return splitter

    def _build_annotations_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        header_box = QGroupBox("Annotation Tools")
        header_layout = QVBoxLayout(header_box)
        self.annotation_scope_label = QLabel(
            "Open a dataset to start annotating the current view."
        )
        self.annotation_scope_label.setProperty("muted", True)
        self.annotation_scope_label.setWordWrap(True)
        header_layout.addWidget(self.annotation_scope_label)
        layout.addWidget(header_box)

        editor_box = QGroupBox("Capture Annotation")
        editor_layout = QFormLayout(editor_box)
        self.annotation_label_edit = QLineEdit()
        self.annotation_label_edit.setPlaceholderText("Optional annotation label")
        self.annotation_notes_edit = QLineEdit()
        self.annotation_notes_edit.setPlaceholderText("Optional note")
        self.annotation_channel_filter_edit = QLineEdit()
        self.annotation_channel_filter_edit.setPlaceholderText("Filter channels")
        self.annotation_channel_filter_edit.setClearButtonEnabled(True)
        self.annotation_channel_combo = QComboBox()
        self.annotation_channel_combo.addItem("Global", None)
        self.annotation_mode_combo = QComboBox()
        self.annotation_mode_combo.addItem("Range from current viewport", "range")
        self.annotation_mode_combo.addItem("Point at current viewport center", "point")
        editor_layout.addRow("Label", self.annotation_label_edit)
        editor_layout.addRow("Note", self.annotation_notes_edit)
        editor_layout.addRow("Scope Filter", self.annotation_channel_filter_edit)
        editor_layout.addRow("Scope", self.annotation_channel_combo)
        editor_layout.addRow("Capture", self.annotation_mode_combo)
        layout.addWidget(editor_box)

        annotation_actions = QHBoxLayout()
        self.capture_annotation_button = QPushButton("Add Annotation")
        self.capture_annotation_button.setProperty("secondary", True)
        self.jump_annotation_button = QPushButton("Jump To")
        self.jump_annotation_button.setProperty("secondary", True)
        self.delete_annotation_button = QPushButton("Delete")
        self.delete_annotation_button.setProperty("secondary", True)
        self.import_annotations_button = QPushButton("Import JSON")
        self.import_annotations_button.setProperty("secondary", True)
        self.export_annotations_button = QPushButton("Export JSON")
        self.export_annotations_button.setProperty("secondary", True)
        annotation_actions.addWidget(self.capture_annotation_button)
        annotation_actions.addWidget(self.jump_annotation_button)
        annotation_actions.addWidget(self.delete_annotation_button)
        annotation_actions.addStretch(1)
        annotation_actions.addWidget(self.import_annotations_button)
        annotation_actions.addWidget(self.export_annotations_button)
        layout.addLayout(annotation_actions)

        table = QTableWidget(0, 5)
        table.setHorizontalHeaderLabels(["Label", "Scope", "Start", "End", "Note"])
        table.setSelectionBehavior(QAbstractItemView.SelectRows)
        table.setSelectionMode(QAbstractItemView.SingleSelection)
        table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().hide()
        table.verticalHeader().setDefaultSectionSize(36)
        table.horizontalHeader().setStretchLastSection(True)
        self._configure_table_columns(table, [180, 120, 96, 96, None])
        self.annotations_table = table
        layout.addWidget(table, 1)
        return page

    def _build_streaming_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        status_box = QGroupBox("Replay Status")
        status_layout = QVBoxLayout(status_box)
        self.streaming_status_label = QLabel("Open a dataset to control replay.")
        self.streaming_status_label.setProperty("muted", True)
        self.streaming_status_label.setWordWrap(True)
        status_layout.addWidget(self.streaming_status_label)
        layout.addWidget(status_box)

        controls_box = QGroupBox("Controls")
        controls_layout = QFormLayout(controls_box)
        self.streaming_stride_spin = QDoubleSpinBox()
        self.streaming_stride_spin.setRange(0.05, 120.0)
        self.streaming_stride_spin.setDecimals(2)
        self.streaming_stride_spin.setValue(1.0)
        self.streaming_speed_combo = QComboBox()
        for label, value in (("0.5×", 0.5), ("1×", 1.0), ("2×", 2.0), ("4×", 4.0)):
            self.streaming_speed_combo.addItem(label, value)
        self.streaming_speed_combo.setCurrentIndex(1)
        self.streaming_loop_checkbox = QCheckBox("Loop at end")
        controls_layout.addRow("Stride (s)", self.streaming_stride_spin)
        controls_layout.addRow("Speed", self.streaming_speed_combo)
        controls_layout.addRow("", self.streaming_loop_checkbox)
        layout.addWidget(controls_box)

        stream_actions = QHBoxLayout()
        self.streaming_back_button = QPushButton("Step Back")
        self.streaming_back_button.setProperty("secondary", True)
        self.streaming_start_button = QPushButton("Start")
        self.streaming_pause_button = QPushButton("Pause")
        self.streaming_pause_button.setProperty("secondary", True)
        self.streaming_forward_button = QPushButton("Step Forward")
        self.streaming_forward_button.setProperty("secondary", True)
        self.streaming_stop_button = QPushButton("Stop")
        self.streaming_stop_button.setProperty("secondary", True)
        for button in (
            self.streaming_back_button,
            self.streaming_start_button,
            self.streaming_pause_button,
            self.streaming_forward_button,
            self.streaming_stop_button,
        ):
            stream_actions.addWidget(button)
        stream_actions.addStretch(1)
        layout.addLayout(stream_actions)

        self.streaming_notes = QPlainTextEdit()
        self.streaming_notes.setReadOnly(True)
        self.streaming_notes.setPlainText(
            "Replay advances the loaded viewport through the active dataset using the current waveform controls. "
            "Use it to inspect longer recordings as a continuous stream."
        )
        layout.addWidget(self.streaming_notes, 1)
        return page
