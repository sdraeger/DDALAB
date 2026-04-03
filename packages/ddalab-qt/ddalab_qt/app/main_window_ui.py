from __future__ import annotations

from typing import Dict

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHeaderView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMenu,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
    QSplitter,
    QStackedWidget,
    QStatusBar,
    QTabBar,
    QTableWidget,
    QTextEdit,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from ..ui.widgets.busy_indicator import BusyIndicatorBar
from ..ui.widgets.clickable_label import ClickableLabel
from ..ui.widgets.file_browser import FileBrowserWidget
from ..ui.widgets.plots import (
    DdaLinePlotWidget,
    HEATMAP_COLOR_SCHEME_OPTIONS,
    HeatmapWidget,
    OverviewWidget,
    WaveformWidget,
)
from .main_window_support import ToggleListWidget


class MainWindowUiMixin:
    def _configure_table_columns(
        self, table: QTableWidget, widths: list[int | None]
    ) -> None:
        header = table.horizontalHeader()
        header.setStretchLastSection(False)
        for index, width in enumerate(widths):
            if width is None:
                header.setSectionResizeMode(index, QHeaderView.Stretch)
            else:
                header.setSectionResizeMode(index, QHeaderView.Interactive)
                table.setColumnWidth(index, width)

    def _build_ui(self) -> None:
        central = QWidget()
        root_layout = QVBoxLayout(central)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(0)

        root_layout.addWidget(self._build_title_bar())
        root_layout.addWidget(self._build_file_tabs())
        root_layout.addWidget(self._build_main_area(), 1)

        self.setCentralWidget(central)
        status = QStatusBar()
        self.setStatusBar(status)
        self.status_bar = status
        self.backend_status_label = QLabel("Checking backend…")
        self.backend_status_label.setProperty("muted", True)
        self.file_status_label = QLabel("No file selected")
        self.file_status_label.setProperty("muted", True)
        status.addPermanentWidget(self.backend_status_label, 1)
        status.addPermanentWidget(self.file_status_label, 2)

    def _build_title_bar(self) -> QWidget:
        frame = QFrame()
        frame.setObjectName("title-bar")
        layout = QHBoxLayout(frame)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(12)

        brand = QVBoxLayout()
        brand.setSpacing(2)
        title = QLabel("DDALAB")
        title.setProperty("title", True)
        subtitle = QLabel("Qt workstation aligned to the desktop shell")
        subtitle.setProperty("muted", True)
        brand.addWidget(title)
        brand.addWidget(subtitle)
        layout.addLayout(brand, 1)

        self.dataset_label = QLabel("No dataset open")
        self.dataset_label.setProperty("muted", True)
        layout.addWidget(self.dataset_label, 1)

        self.dda_global_activity = QWidget()
        dda_global_layout = QHBoxLayout(self.dda_global_activity)
        dda_global_layout.setContentsMargins(0, 0, 0, 0)
        dda_global_layout.setSpacing(8)
        self.dda_global_progress = BusyIndicatorBar(bar_height=4, interval_ms=54)
        self.dda_global_progress.setFixedWidth(78)
        self.dda_global_label = ClickableLabel("")
        self.dda_global_label.setProperty("muted", True)
        self.dda_global_label.setToolTip("Show DDA run details")
        dda_global_layout.addWidget(self.dda_global_progress)
        dda_global_layout.addWidget(self.dda_global_label)
        self.dda_global_activity.setVisible(False)
        layout.addWidget(self.dda_global_activity)

        open_button = QPushButton("Open File")
        open_folder_button = QPushButton("Open Folder")
        open_folder_button.setProperty("secondary", True)
        run_button = QPushButton("Run DDA")
        refresh_button = QPushButton("Refresh")
        refresh_button.setProperty("secondary", True)
        layout.addWidget(refresh_button)
        layout.addWidget(open_folder_button)
        layout.addWidget(open_button)
        layout.addWidget(run_button)

        self.refresh_button = refresh_button
        self.open_button = open_button
        self.open_folder_button = open_folder_button
        self.run_button = run_button
        return frame

    def _build_file_tabs(self) -> QWidget:
        frame = QFrame()
        frame.setObjectName("file-tab-strip")
        layout = QVBoxLayout(frame)
        layout.setContentsMargins(16, 0, 16, 12)
        layout.setSpacing(8)

        header = QHBoxLayout()
        header.setSpacing(10)
        title = QLabel("Open Files")
        title.setProperty("muted", True)
        header.addWidget(title)

        self.file_tabs_summary_label = QLabel("No files")
        self.file_tabs_summary_label.setProperty("muted", True)
        header.addWidget(self.file_tabs_summary_label, 1)

        self.close_other_tabs_button = QPushButton("Close Others")
        self.close_other_tabs_button.setProperty("secondary", True)
        self.close_other_tabs_button.setVisible(False)
        header.addWidget(self.close_other_tabs_button)
        layout.addLayout(header)

        tabs = QTabBar()
        tabs.setObjectName("workspace-file-tabs")
        tabs.setDocumentMode(True)
        tabs.setTabsClosable(True)
        tabs.setExpanding(False)
        tabs.setUsesScrollButtons(True)
        tabs.setMovable(True)
        tabs.setElideMode(Qt.ElideMiddle)
        tabs.setDrawBase(False)
        layout.addWidget(tabs)
        self.file_tabs = tabs
        frame.hide()
        self.file_tabs_frame = frame
        return frame

    def _build_main_area(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)
        splitter.addWidget(self._build_sidebar())
        splitter.addWidget(self._build_content_area())
        splitter.setSizes([340, 1200])
        self.main_splitter = splitter

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(16, 0, 16, 16)
        layout.addWidget(splitter)
        return container

    def _build_sidebar(self) -> QWidget:
        browser = FileBrowserWidget()
        self.file_browser = browser
        return browser

    def _build_content_area(self) -> QWidget:
        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        primary_nav = QTabBar()
        primary_nav.setExpanding(False)
        for label in self.primary_sections:
            primary_nav.addTab(label)
        self.primary_nav = primary_nav

        secondary_nav = QTabBar()
        secondary_nav.setExpanding(False)
        self.secondary_nav = secondary_nav

        stack = QStackedWidget()
        self.primary_stack = stack
        self._build_pages()

        layout.addWidget(primary_nav)
        layout.addWidget(secondary_nav)
        layout.addWidget(stack, 1)
        return container

    def _build_pages(self) -> None:
        self.page_registry: Dict[str, QWidget] = {}
        self._add_primary_page("Overview", self._build_overview_page())
        self._add_primary_page("Visualize", self._build_visualize_page())
        self._add_primary_page("DDA", self._build_analyze_page())
        self._add_primary_page("Data", self._build_data_page())
        self._add_primary_page("Learn", self._build_learn_page())
        self._add_primary_page("Plugins", self._build_plugins_page())
        self._add_primary_page("Collaborate", self._build_collaborate_page())
        self._add_primary_page("Settings", self._build_settings_page())
        self._add_primary_page("Notifications", self._build_notifications_page())
        self._rebuild_secondary_nav("Overview")

    def _add_primary_page(self, name: str, widget: QWidget) -> None:
        self.page_registry[name] = widget
        self.primary_stack.addWidget(widget)

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
        layout.addWidget(hero)

        grid = QGridLayout()
        grid.setSpacing(12)
        self.overview_cards: Dict[str, QLabel] = {}
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
            grid.addWidget(card, index // 2, index % 2)
            self.overview_cards[key] = value_label
        layout.addLayout(grid)

        self.dataset_notes = QPlainTextEdit()
        self.dataset_notes.setReadOnly(True)
        self.dataset_notes.setPlaceholderText("Dataset notes will appear here.")
        layout.addWidget(self.dataset_notes, 1)
        return page

    def _build_visualize_page(self) -> QWidget:
        stack = QStackedWidget()
        self.visualize_stack = stack
        stack.addWidget(self._build_visualize_time_series_page())
        stack.addWidget(self._build_annotations_page())
        stack.addWidget(self._build_streaming_page())
        return stack

    def _build_visualize_time_series_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        inspector = QGroupBox("Channels")
        inspector_layout = QVBoxLayout(inspector)
        channel_actions = QHBoxLayout()
        self.select_all_channels_button = QPushButton("All")
        self.select_top_eight_button = QPushButton("Top 8")
        self.select_top_four_button = QPushButton("Top 4")
        for button in (
            self.select_all_channels_button,
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
        for button in (
            self.pan_left_button,
            self.pan_right_button,
            self.zoom_out_button,
            self.zoom_in_button,
            self.reset_view_button,
        ):
            button.setProperty("secondary", True)
            controls.addWidget(button)
        workspace_layout.addLayout(controls)

        self.waveform_widget = WaveformWidget()
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
        self.annotation_channel_combo = QComboBox()
        self.annotation_channel_combo.addItem("Global", None)
        self.annotation_mode_combo = QComboBox()
        self.annotation_mode_combo.addItem("Range from current viewport", "range")
        self.annotation_mode_combo.addItem("Point at current viewport center", "point")
        editor_layout.addRow("Label", self.annotation_label_edit)
        editor_layout.addRow("Note", self.annotation_notes_edit)
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
        annotation_actions.addWidget(self.capture_annotation_button)
        annotation_actions.addWidget(self.jump_annotation_button)
        annotation_actions.addWidget(self.delete_annotation_button)
        annotation_actions.addStretch(1)
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

    def _build_analyze_page(self) -> QWidget:
        stack = QStackedWidget()
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

        form = QFormLayout()
        self.window_length_spin = QSpinBox()
        self.window_length_spin.setRange(1, 65536)
        self.window_length_spin.setValue(64)
        self.window_step_spin = QSpinBox()
        self.window_step_spin.setRange(1, 65536)
        self.window_step_spin.setValue(10)
        self.delays_edit = QLineEdit("7,10")
        self.dda_start_edit = QLineEdit("0")
        self.dda_end_edit = QLineEdit("30")
        form.addRow("Window length", self.window_length_spin)
        form.addRow("Window step", self.window_step_spin)
        form.addRow("Delays", self.delays_edit)
        form.addRow("Start (s)", self.dda_start_edit)
        form.addRow("End (s)", self.dda_end_edit)
        config_layout.addLayout(form)

        self.dda_activity_frame = QFrame()
        dda_activity_layout = QVBoxLayout(self.dda_activity_frame)
        dda_activity_layout.setContentsMargins(0, 0, 0, 0)
        dda_activity_layout.setSpacing(6)
        self.dda_activity_label = ClickableLabel("")
        self.dda_activity_label.setWordWrap(True)
        self.dda_activity_label.setProperty("muted", True)
        self.dda_activity_label.setToolTip("Show DDA run details")
        self.dda_activity_progress = BusyIndicatorBar(bar_height=6, interval_ms=56)
        dda_activity_layout.addWidget(self.dda_activity_label)
        dda_activity_layout.addWidget(self.dda_activity_progress)
        self.dda_activity_frame.setVisible(False)
        config_layout.addWidget(self.dda_activity_frame)

        self.run_dda_from_page_button = QPushButton("Run DDA")
        config_layout.addWidget(self.run_dda_from_page_button)
        self.dda_diagnostics = QPlainTextEdit()
        self.dda_diagnostics.setReadOnly(True)
        self.dda_diagnostics.setPlaceholderText("Diagnostics and execution details")
        config_layout.addWidget(self.dda_diagnostics, 1)
        left_layout.addWidget(config_box, 3)

        history_box = QGroupBox("Analysis History")
        history_layout = QVBoxLayout(history_box)
        history_actions = QHBoxLayout()
        self.dda_import_snapshot_button = QPushButton("Import")
        self.dda_import_snapshot_button.setProperty("secondary", True)
        self.dda_view_history_result_button = QPushButton("Load Selected")
        self.dda_view_history_result_button.setProperty("secondary", True)
        history_actions.addWidget(self.dda_import_snapshot_button)
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
        results_layout.addLayout(header)

        export_actions = QHBoxLayout()
        self.dda_data_export_button = QToolButton()
        self.dda_data_export_button.setText("Data")
        self.dda_data_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.dda_data_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.dda_data_export_button.setProperty("secondary", True)
        dda_data_menu = QMenu(self.dda_data_export_button)
        dda_data_menu.addAction("Export Result JSON", self._export_result_json)
        dda_data_menu.addAction("Export Selected Variant CSV", self._export_result_csv)
        dda_data_menu.addAction("Export All Variants CSV", self._export_all_result_csv)
        self.dda_data_export_button.setMenu(dda_data_menu)

        self.dda_reproduce_export_button = QToolButton()
        self.dda_reproduce_export_button.setText("Reproduce")
        self.dda_reproduce_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.dda_reproduce_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.dda_reproduce_export_button.setProperty("secondary", True)
        dda_reproduce_menu = QMenu(self.dda_reproduce_export_button)
        dda_reproduce_menu.addAction("Python Script", lambda: self._export_result_script("python"))
        dda_reproduce_menu.addAction("MATLAB Script", lambda: self._export_result_script("matlab"))
        dda_reproduce_menu.addAction("Julia Script", lambda: self._export_result_script("julia"))
        dda_reproduce_menu.addAction("Rust Source", lambda: self._export_result_script("rust"))
        self.dda_reproduce_export_button.setMenu(dda_reproduce_menu)

        self.dda_plot_export_button = QToolButton()
        self.dda_plot_export_button.setText("Plot")
        self.dda_plot_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.dda_plot_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.dda_plot_export_button.setProperty("secondary", True)
        dda_plot_menu = QMenu(self.dda_plot_export_button)
        dda_plot_menu.addAction("Heatmap PNG", lambda: self._export_result_plot("heatmap", "png"))
        dda_plot_menu.addAction("Heatmap SVG", lambda: self._export_result_plot("heatmap", "svg"))
        dda_plot_menu.addAction("Heatmap PDF", lambda: self._export_result_plot("heatmap", "pdf"))
        dda_plot_menu.addSeparator()
        dda_plot_menu.addAction("Line Plot PNG", lambda: self._export_result_plot("lineplot", "png"))
        dda_plot_menu.addAction("Line Plot SVG", lambda: self._export_result_plot("lineplot", "svg"))
        dda_plot_menu.addAction("Line Plot PDF", lambda: self._export_result_plot("lineplot", "pdf"))
        self.dda_plot_export_button.setMenu(dda_plot_menu)

        self.dda_snapshot_export_button = QToolButton()
        self.dda_snapshot_export_button.setText("Snapshot")
        self.dda_snapshot_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.dda_snapshot_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.dda_snapshot_export_button.setProperty("secondary", True)
        dda_snapshot_menu = QMenu(self.dda_snapshot_export_button)
        dda_snapshot_menu.addAction("Full Snapshot", lambda: self._export_snapshot("full"))
        dda_snapshot_menu.addAction("Recipe Only", lambda: self._export_snapshot("recipe_only"))
        self.dda_snapshot_export_button.setMenu(dda_snapshot_menu)

        for button in (
            self.dda_data_export_button,
            self.dda_reproduce_export_button,
            self.dda_plot_export_button,
            self.dda_snapshot_export_button,
        ):
            export_actions.addWidget(button)
        export_actions.addStretch(1)
        results_layout.addLayout(export_actions)
        self.heatmap_widget = HeatmapWidget()
        results_layout.addWidget(self.heatmap_widget, 1)
        self.dda_lineplot_widget = DdaLinePlotWidget()
        results_layout.addWidget(self.dda_lineplot_widget, 1)
        self.result_summary = QTextEdit()
        self.result_summary.setReadOnly(True)
        self.result_summary.setMinimumHeight(120)
        results_layout.addWidget(self.result_summary)

        splitter.addWidget(left_panel)
        splitter.addWidget(results_box)
        splitter.setSizes([420, 920])
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
        self.batch_select_open_button = QPushButton("Open Files")
        self.batch_select_open_button.setProperty("secondary", True)
        self.batch_run_button = QPushButton("Run Batch")
        self.batch_run_button.setProperty("secondary", True)
        batch_actions.addWidget(self.batch_select_all_button)
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

        metrics_box = QGroupBox("Ranked Edges / Motifs")
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

        splitter.addWidget(source_box)
        splitter.addWidget(metrics_box)
        splitter.setSizes([360, 940])
        return splitter

    def _build_compare_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        setup_box = QGroupBox("Comparison Setup")
        setup_layout = QFormLayout(setup_box)
        self.compare_baseline_combo = QComboBox()
        self.compare_target_combo = QComboBox()
        setup_layout.addRow("Baseline", self.compare_baseline_combo)
        setup_layout.addRow("Compare against", self.compare_target_combo)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)
        left_layout.addWidget(setup_box)
        self.compare_summary = QPlainTextEdit()
        self.compare_summary.setReadOnly(True)
        self.compare_summary.setPlaceholderText(
            "Select two analyses to compare their variant-level changes."
        )
        left_layout.addWidget(self.compare_summary, 1)

        table_box = QGroupBox("Variant Deltas")
        table_layout = QVBoxLayout(table_box)
        self.compare_table = QTableWidget(0, 5)
        self.compare_table.setHorizontalHeaderLabels(
            ["Variant", "Baseline Mean", "Target Mean", "Delta", "Top Changed Row"]
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
            [78, 118, 118, 108, None],
        )
        table_layout.addWidget(self.compare_table, 1)

        splitter.addWidget(left_panel)
        splitter.addWidget(table_box)
        splitter.setSizes([360, 940])
        return splitter

    def _build_data_page(self) -> QWidget:
        stack = QStackedWidget()
        self.data_stack = stack

        openneuro_page = QWidget()
        layout = QVBoxLayout(openneuro_page)
        layout.setSpacing(12)

        toolbar = QHBoxLayout()
        self.openneuro_search = QLineEdit()
        self.openneuro_search.setPlaceholderText("Filter datasets")
        self.openneuro_refresh_button = QPushButton("Refresh OpenNeuro")
        self.openneuro_refresh_button.setProperty("secondary", True)
        toolbar.addWidget(self.openneuro_search, 1)
        toolbar.addWidget(self.openneuro_refresh_button)
        layout.addLayout(toolbar)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        table = QTableWidget(0, 4)
        table.setHorizontalHeaderLabels(["Dataset", "Subjects", "Modalities", "Size"])
        table.setSelectionBehavior(QAbstractItemView.SelectRows)
        table.setSelectionMode(QAbstractItemView.SingleSelection)
        table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().hide()
        table.verticalHeader().setDefaultSectionSize(36)
        table.horizontalHeader().setStretchLastSection(True)
        self.openneuro_table = table

        details = QPlainTextEdit()
        details.setReadOnly(True)
        details.setPlaceholderText("Select a dataset to inspect the details.")
        self.openneuro_details = details

        splitter.addWidget(table)
        splitter.addWidget(details)
        splitter.setSizes([780, 420])
        layout.addWidget(splitter, 1)
        stack.addWidget(openneuro_page)
        stack.addWidget(self._build_nsg_page())
        return stack

    def _build_plugins_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)

        status_box = QGroupBox("Installed Plugins")
        status_layout = QVBoxLayout(status_box)
        self.plugins_status_label = QLabel(
            "Inspect installed plugins, install new ones from the registry, and run them on the active dataset."
        )
        self.plugins_status_label.setWordWrap(True)
        self.plugins_status_label.setProperty("muted", True)
        status_layout.addWidget(self.plugins_status_label)
        left_layout.addWidget(status_box)

        installed_actions = QHBoxLayout()
        self.refresh_plugins_button = QPushButton("Refresh")
        self.install_plugin_button = QPushButton("Install Selected")
        self.install_plugin_button.setProperty("secondary", True)
        self.uninstall_plugin_button = QPushButton("Uninstall")
        self.uninstall_plugin_button.setProperty("secondary", True)
        self.toggle_plugin_button = QPushButton("Disable")
        self.toggle_plugin_button.setProperty("secondary", True)
        self.run_plugin_button = QPushButton("Run on Dataset")
        self.run_plugin_button.setProperty("secondary", True)
        for button in (
            self.refresh_plugins_button,
            self.install_plugin_button,
            self.uninstall_plugin_button,
            self.toggle_plugin_button,
            self.run_plugin_button,
        ):
            installed_actions.addWidget(button)
        installed_actions.addStretch(1)
        left_layout.addLayout(installed_actions)

        self.installed_plugins_table = QTableWidget(0, 5)
        self.installed_plugins_table.setHorizontalHeaderLabels(
            ["Plugin", "Version", "Category", "Status", "Source"]
        )
        self.installed_plugins_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.installed_plugins_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.installed_plugins_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.installed_plugins_table.setAlternatingRowColors(True)
        self.installed_plugins_table.verticalHeader().hide()
        self.installed_plugins_table.verticalHeader().setDefaultSectionSize(34)
        self.installed_plugins_table.horizontalHeader().setStretchLastSection(True)
        left_layout.addWidget(self.installed_plugins_table, 1)

        registry_box = QGroupBox("Registry")
        registry_layout = QVBoxLayout(registry_box)
        self.plugin_registry_table = QTableWidget(0, 5)
        self.plugin_registry_table.setHorizontalHeaderLabels(
            ["Plugin", "Version", "Category", "Author", "Published"]
        )
        self.plugin_registry_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.plugin_registry_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.plugin_registry_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.plugin_registry_table.setAlternatingRowColors(True)
        self.plugin_registry_table.verticalHeader().hide()
        self.plugin_registry_table.verticalHeader().setDefaultSectionSize(34)
        self.plugin_registry_table.horizontalHeader().setStretchLastSection(True)
        registry_layout.addWidget(self.plugin_registry_table, 1)
        left_layout.addWidget(registry_box, 1)

        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(12)

        details_box = QGroupBox("Plugin Details")
        details_layout = QVBoxLayout(details_box)
        self.plugin_details = QPlainTextEdit()
        self.plugin_details.setReadOnly(True)
        self.plugin_details.setPlaceholderText(
            "Select a plugin to inspect its metadata."
        )
        details_layout.addWidget(self.plugin_details)
        right_layout.addWidget(details_box)

        output_box = QGroupBox("Last Plugin Output")
        output_layout = QVBoxLayout(output_box)
        self.plugin_output = QPlainTextEdit()
        self.plugin_output.setReadOnly(True)
        self.plugin_output.setPlaceholderText(
            "Run a plugin on the active dataset to inspect its output."
        )
        output_layout.addWidget(self.plugin_output)
        right_layout.addWidget(output_box, 1)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_panel)
        splitter.setSizes([900, 620])
        return splitter

    def _build_nsg_page(self) -> QWidget:
        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(12)

        credentials_box = QGroupBox("Credentials")
        credentials_layout = QFormLayout(credentials_box)
        self.nsg_username_edit = QLineEdit()
        self.nsg_password_edit = QLineEdit()
        self.nsg_password_edit.setEchoMode(QLineEdit.EchoMode.Password)
        self.nsg_app_key_edit = QLineEdit()
        self.nsg_app_key_edit.setEchoMode(QLineEdit.EchoMode.Password)
        credentials_layout.addRow("Username", self.nsg_username_edit)
        credentials_layout.addRow("Password", self.nsg_password_edit)
        credentials_layout.addRow("App Key", self.nsg_app_key_edit)

        nsg_credential_actions = QHBoxLayout()
        self.nsg_save_credentials_button = QPushButton("Save")
        self.nsg_delete_credentials_button = QPushButton("Delete")
        self.nsg_delete_credentials_button.setProperty("secondary", True)
        self.nsg_test_connection_button = QPushButton("Test Connection")
        self.nsg_test_connection_button.setProperty("secondary", True)
        nsg_credential_actions.addWidget(self.nsg_save_credentials_button)
        nsg_credential_actions.addWidget(self.nsg_delete_credentials_button)
        nsg_credential_actions.addWidget(self.nsg_test_connection_button)
        nsg_credential_actions.addStretch(1)
        credentials_layout.addRow("", nsg_credential_actions)
        left_layout.addWidget(credentials_box)

        job_box = QGroupBox("Create Job")
        job_layout = QFormLayout(job_box)
        self.nsg_runtime_hours_spin = QDoubleSpinBox()
        self.nsg_runtime_hours_spin.setRange(0.25, 168.0)
        self.nsg_runtime_hours_spin.setDecimals(2)
        self.nsg_runtime_hours_spin.setValue(2.0)
        self.nsg_cores_spin = QSpinBox()
        self.nsg_cores_spin.setRange(1, 128)
        self.nsg_cores_spin.setValue(4)
        self.nsg_nodes_spin = QSpinBox()
        self.nsg_nodes_spin.setRange(1, 32)
        self.nsg_nodes_spin.setValue(1)
        self.nsg_create_job_button = QPushButton("Create from Current DDA Config")
        job_layout.addRow("Runtime (hours)", self.nsg_runtime_hours_spin)
        job_layout.addRow("Cores", self.nsg_cores_spin)
        job_layout.addRow("Nodes", self.nsg_nodes_spin)
        job_layout.addRow("", self.nsg_create_job_button)
        left_layout.addWidget(job_box)

        self.nsg_status_label = QLabel(
            "Configure credentials and submit the active dataset to NSG using the current DDA settings."
        )
        self.nsg_status_label.setWordWrap(True)
        self.nsg_status_label.setProperty("muted", True)
        left_layout.addWidget(self.nsg_status_label)
        left_layout.addStretch(1)

        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)
        right_layout.setContentsMargins(0, 0, 0, 0)
        right_layout.setSpacing(12)

        job_actions = QHBoxLayout()
        self.nsg_refresh_jobs_button = QPushButton("Refresh Jobs")
        self.nsg_submit_job_button = QPushButton("Submit")
        self.nsg_submit_job_button.setProperty("secondary", True)
        self.nsg_refresh_job_button = QPushButton("Refresh Selected")
        self.nsg_refresh_job_button.setProperty("secondary", True)
        self.nsg_cancel_job_button = QPushButton("Cancel")
        self.nsg_cancel_job_button.setProperty("secondary", True)
        self.nsg_download_results_button = QPushButton("Download Results")
        self.nsg_download_results_button.setProperty("secondary", True)
        for button in (
            self.nsg_refresh_jobs_button,
            self.nsg_submit_job_button,
            self.nsg_refresh_job_button,
            self.nsg_cancel_job_button,
            self.nsg_download_results_button,
        ):
            job_actions.addWidget(button)
        job_actions.addStretch(1)
        right_layout.addLayout(job_actions)

        self.nsg_jobs_table = QTableWidget(0, 6)
        self.nsg_jobs_table.setHorizontalHeaderLabels(
            ["Job", "NSG ID", "Status", "Tool", "Progress", "Created"]
        )
        self.nsg_jobs_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.nsg_jobs_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.nsg_jobs_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.nsg_jobs_table.setAlternatingRowColors(True)
        self.nsg_jobs_table.verticalHeader().hide()
        self.nsg_jobs_table.verticalHeader().setDefaultSectionSize(34)
        self.nsg_jobs_table.horizontalHeader().setStretchLastSection(True)
        right_layout.addWidget(self.nsg_jobs_table, 1)

        self.nsg_job_details = QPlainTextEdit()
        self.nsg_job_details.setReadOnly(True)
        self.nsg_job_details.setPlaceholderText("Select a job to inspect its details.")
        right_layout.addWidget(self.nsg_job_details)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_panel)
        splitter.setSizes([420, 1060])
        return splitter

    def _build_learn_page(self) -> QWidget:
        stack = QStackedWidget()
        self.learn_stack = stack
        stack.addWidget(
            self._build_placeholder_page(
                "Tutorials",
                "Use Visualize for waveform inspection, DDA for analysis, and Collaborate for snapshots and workflow exports.",
            )
        )
        stack.addWidget(
            self._build_placeholder_page(
                "Files",
                "BIDS roots, EDF/BDF, BrainVision, FIF/EEGLAB, XDF, NWB, and NIfTI datasets can be opened from the browser or the file/folder picker.",
            )
        )
        stack.addWidget(
            self._build_placeholder_page(
                "Reference",
                "The Qt client keeps the same top-level DDALAB structure while using the local bridge for desktop analysis and OpenNeuro browsing.",
            )
        )
        return stack

    def _build_collaborate_page(self) -> QWidget:
        stack = QStackedWidget()
        self.collaborate_stack = stack
        stack.addWidget(self._build_results_page())
        stack.addWidget(self._build_workflow_page())
        return stack

    def _build_results_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        summary_box = QGroupBox("Current Analysis")
        summary_layout = QVBoxLayout(summary_box)
        self.results_summary_label = QLabel("Run DDA to capture a result snapshot.")
        self.results_summary_label.setWordWrap(True)
        self.results_summary_label.setProperty("muted", True)
        summary_layout.addWidget(self.results_summary_label)
        layout.addWidget(summary_box)

        actions = QHBoxLayout()
        self.import_snapshot_button = QPushButton("Import Snapshot")
        self.import_snapshot_button.setProperty("secondary", True)
        self.view_history_result_button = QPushButton("View Selected")
        self.view_history_result_button.setProperty("secondary", True)

        self.data_export_button = QToolButton()
        self.data_export_button.setText("Data")
        self.data_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.data_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.data_export_button.setProperty("secondary", True)
        data_menu = QMenu(self.data_export_button)
        data_menu.addAction("Export Result JSON", self._export_result_json)
        data_menu.addAction("Export Selected Variant CSV", self._export_result_csv)
        data_menu.addAction("Export All Variants CSV", self._export_all_result_csv)
        self.data_export_button.setMenu(data_menu)

        self.reproduce_export_button = QToolButton()
        self.reproduce_export_button.setText("Reproduce")
        self.reproduce_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.reproduce_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.reproduce_export_button.setProperty("secondary", True)
        reproduce_menu = QMenu(self.reproduce_export_button)
        reproduce_menu.addAction("Python Script", lambda: self._export_result_script("python"))
        reproduce_menu.addAction("MATLAB Script", lambda: self._export_result_script("matlab"))
        reproduce_menu.addAction("Julia Script", lambda: self._export_result_script("julia"))
        reproduce_menu.addAction("Rust Source", lambda: self._export_result_script("rust"))
        self.reproduce_export_button.setMenu(reproduce_menu)

        self.plot_export_button = QToolButton()
        self.plot_export_button.setText("Plot")
        self.plot_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.plot_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.plot_export_button.setProperty("secondary", True)
        plot_menu = QMenu(self.plot_export_button)
        plot_menu.addAction("Heatmap PNG", lambda: self._export_result_plot("heatmap", "png"))
        plot_menu.addAction("Heatmap SVG", lambda: self._export_result_plot("heatmap", "svg"))
        plot_menu.addAction("Heatmap PDF", lambda: self._export_result_plot("heatmap", "pdf"))
        plot_menu.addSeparator()
        plot_menu.addAction("Line Plot PNG", lambda: self._export_result_plot("lineplot", "png"))
        plot_menu.addAction("Line Plot SVG", lambda: self._export_result_plot("lineplot", "svg"))
        plot_menu.addAction("Line Plot PDF", lambda: self._export_result_plot("lineplot", "pdf"))
        self.plot_export_button.setMenu(plot_menu)

        self.snapshot_export_button = QToolButton()
        self.snapshot_export_button.setText("Snapshot")
        self.snapshot_export_button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        self.snapshot_export_button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        self.snapshot_export_button.setProperty("secondary", True)
        snapshot_menu = QMenu(self.snapshot_export_button)
        snapshot_menu.addAction("Full Snapshot", lambda: self._export_snapshot("full"))
        snapshot_menu.addAction("Recipe Only", lambda: self._export_snapshot("recipe_only"))
        self.snapshot_export_button.setMenu(snapshot_menu)

        self.export_annotations_button = QPushButton("Annotations")
        self.export_annotations_button.setProperty("secondary", True)

        for button in (
            self.import_snapshot_button,
            self.view_history_result_button,
            self.data_export_button,
            self.reproduce_export_button,
            self.plot_export_button,
            self.snapshot_export_button,
            self.export_annotations_button,
        ):
            actions.addWidget(button)
        actions.addStretch(1)
        layout.addLayout(actions)

        splitter = QSplitter(Qt.Horizontal)
        splitter.setChildrenCollapsible(False)

        history_panel = QWidget()
        history_layout = QVBoxLayout(history_panel)
        history_layout.setContentsMargins(0, 0, 0, 0)
        history_layout.setSpacing(10)
        self.results_history_status_label = QLabel("No saved analyses for this file yet.")
        self.results_history_status_label.setProperty("muted", True)
        self.results_history_status_label.setWordWrap(True)
        history_layout.addWidget(self.results_history_status_label)
        self.results_history_table = QTableWidget(0, 4)
        self.results_history_table.setHorizontalHeaderLabels(
            ["Created", "Variants", "Engine", "Result ID"]
        )
        self.results_history_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.results_history_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.results_history_table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.results_history_table.setAlternatingRowColors(True)
        self.results_history_table.verticalHeader().hide()
        self.results_history_table.verticalHeader().setDefaultSectionSize(34)
        self.results_history_table.horizontalHeader().setStretchLastSection(True)
        self._configure_table_columns(
            self.results_history_table,
            [168, 126, 132, None],
        )
        history_layout.addWidget(self.results_history_table, 1)

        details_panel = QWidget()
        details_layout = QVBoxLayout(details_panel)
        details_layout.setContentsMargins(0, 0, 0, 0)
        details_layout.setSpacing(10)
        self.results_details = QPlainTextEdit()
        self.results_details.setReadOnly(True)
        self.results_details.setPlaceholderText(
            "Result details, exports, and snapshot metadata appear here."
        )
        details_layout.addWidget(self.results_details, 1)

        splitter.addWidget(history_panel)
        splitter.addWidget(details_panel)
        splitter.setSizes([460, 740])
        layout.addWidget(splitter, 1)
        return page

    def _build_workflow_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        status_box = QGroupBox("Workflow Recorder")
        status_layout = QVBoxLayout(status_box)
        self.workflow_status_label = QLabel("Recorder idle")
        self.workflow_status_label.setWordWrap(True)
        self.workflow_status_label.setProperty("muted", True)
        status_layout.addWidget(self.workflow_status_label)
        layout.addWidget(status_box)

        actions = QHBoxLayout()
        self.start_workflow_button = QPushButton("Start Recording")
        self.stop_workflow_button = QPushButton("Stop Recording")
        self.stop_workflow_button.setProperty("secondary", True)
        self.clear_workflow_button = QPushButton("Clear")
        self.clear_workflow_button.setProperty("secondary", True)
        self.export_workflow_button = QPushButton("Export Workflow")
        self.export_workflow_button.setProperty("secondary", True)
        self.import_workflow_button = QPushButton("Import Workflow")
        self.import_workflow_button.setProperty("secondary", True)
        for button in (
            self.start_workflow_button,
            self.stop_workflow_button,
            self.clear_workflow_button,
            self.export_workflow_button,
            self.import_workflow_button,
        ):
            actions.addWidget(button)
        actions.addStretch(1)
        layout.addLayout(actions)

        table = QTableWidget(0, 4)
        table.setHorizontalHeaderLabels(["Time", "Action", "Description", "File"])
        table.setSelectionBehavior(QAbstractItemView.SelectRows)
        table.setSelectionMode(QAbstractItemView.SingleSelection)
        table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().hide()
        table.verticalHeader().setDefaultSectionSize(34)
        table.horizontalHeader().setStretchLastSection(True)
        self.workflow_table = table
        layout.addWidget(table, 1)
        return page

    def _build_notifications_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        actions = QHBoxLayout()
        self.export_notifications_button = QPushButton("Export Log")
        self.export_notifications_button.setProperty("secondary", True)
        self.clear_notifications_button = QPushButton("Clear")
        self.clear_notifications_button.setProperty("secondary", True)
        actions.addWidget(self.export_notifications_button)
        actions.addWidget(self.clear_notifications_button)
        actions.addStretch(1)
        layout.addLayout(actions)

        table = QTableWidget(0, 5)
        table.setHorizontalHeaderLabels(
            ["Time", "Category", "Level", "Title", "Message"]
        )
        table.setSelectionBehavior(QAbstractItemView.SelectRows)
        table.setSelectionMode(QAbstractItemView.SingleSelection)
        table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        table.setAlternatingRowColors(True)
        table.verticalHeader().hide()
        table.verticalHeader().setDefaultSectionSize(34)
        table.horizontalHeader().setStretchLastSection(True)
        self.notifications_table = table
        layout.addWidget(table, 1)
        return page

    def _build_settings_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        connection_box = QGroupBox("Backend")
        form = QFormLayout(connection_box)
        self.backend_mode_label = QLabel("Local desktop bridge is the default backend.")
        self.backend_mode_label.setWordWrap(True)
        self.backend_mode_label.setProperty("muted", True)
        self.server_url_edit = QLineEdit(self._server_url)
        self.server_url_edit.setPlaceholderText(
            "Optional remote server URL for shared/institutional deployments"
        )
        self.reconnect_button = QPushButton("Connect Remote Backend")
        self.reconnect_button.setProperty("secondary", True)
        self.use_local_bridge_button = QPushButton("Use Local Backend")
        self.use_local_bridge_button.setProperty("secondary", True)
        form.addRow("Current mode", self.backend_mode_label)
        form.addRow("Remote server URL", self.server_url_edit)
        form.addRow("", self.reconnect_button)
        form.addRow("", self.use_local_bridge_button)
        layout.addWidget(connection_box)

        notes_box = QGroupBox("Prototype scope")
        notes_layout = QVBoxLayout(notes_box)
        notes = QPlainTextEdit()
        notes.setReadOnly(True)
        notes.setPlainText(
            "This Qt client now covers the desktop shell, file browsing, waveform inspection, DDA/ICA, exports and snapshots, annotations, replay, plugins, NSG jobs, notifications, and workflow recording."
        )
        notes_layout.addWidget(notes)
        layout.addWidget(notes_box, 1)
        return page

    def _build_placeholder_page(self, title: str, message: str) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        group = QGroupBox(title)
        group_layout = QVBoxLayout(group)
        label = QLabel(message)
        label.setWordWrap(True)
        label.setProperty("muted", True)
        group_layout.addWidget(label)
        layout.addWidget(group)
        layout.addStretch(1)
        return page

    def _bind_ui(self) -> None:
        self.refresh_button.clicked.connect(self._refresh_health)
        self.open_button.clicked.connect(self._choose_local_file)
        self.open_folder_button.clicked.connect(self._choose_local_folder)
        self.run_button.clicked.connect(self._run_dda)
        self.run_dda_from_page_button.clicked.connect(self._run_dda)
        self.run_ica_button.clicked.connect(self._run_ica)
        self.batch_select_all_button.clicked.connect(self._select_all_batch_files)
        self.batch_select_open_button.clicked.connect(self._select_open_batch_files)
        self.batch_run_button.clicked.connect(self._run_batch_analysis)
        self.file_tabs.currentChanged.connect(self._on_tab_changed)
        self.file_tabs.tabCloseRequested.connect(self._close_file_tab)
        self.file_tabs.tabMoved.connect(self._on_file_tab_moved)
        self.close_other_tabs_button.clicked.connect(self._close_other_tabs)
        self.primary_nav.currentChanged.connect(self._on_primary_nav_changed)
        self.secondary_nav.currentChanged.connect(self._on_secondary_nav_changed)

        self.file_browser.refresh_requested.connect(self._refresh_browser)
        self.file_browser.parent_requested.connect(self._open_parent_directory)
        self.file_browser.root_requested.connect(self._bootstrap_browser)
        self.file_browser.open_file_requested.connect(self._choose_local_file)
        self.file_browser.open_folder_requested.connect(self._choose_local_folder)
        self.file_browser.entry_activated.connect(self._open_entry)
        self.file_browser.search_changed.connect(self.file_browser.apply_search_filter)

        self.select_all_channels_button.clicked.connect(self._select_all_channels)
        self.select_top_eight_button.clicked.connect(
            lambda: self._select_top_channels(8)
        )
        self.select_top_four_button.clicked.connect(
            lambda: self._select_top_channels(4)
        )
        self.channel_list.itemChanged.connect(self._schedule_waveform_reload)
        self.waveform_widget.viewport_changed.connect(self._set_viewport)
        self.waveform_widget.annotation_context_requested.connect(
            self._open_waveform_annotation_context_menu
        )
        self.overview_widget.viewport_jump_requested.connect(self._jump_viewport)
        self.overview_widget.annotation_context_requested.connect(
            self._open_overview_annotation_context_menu
        )

        self.pan_left_button.clicked.connect(lambda: self._shift_viewport(-1.0))
        self.pan_right_button.clicked.connect(lambda: self._shift_viewport(1.0))
        self.zoom_in_button.clicked.connect(lambda: self._zoom_viewport(0.7))
        self.zoom_out_button.clicked.connect(lambda: self._zoom_viewport(1.4))
        self.reset_view_button.clicked.connect(self._reset_viewport)
        self.capture_annotation_button.clicked.connect(self._capture_annotation)
        self.jump_annotation_button.clicked.connect(self._jump_to_selected_annotation)
        self.delete_annotation_button.clicked.connect(self._delete_selected_annotation)
        self.annotations_table.itemSelectionChanged.connect(
            self._update_annotation_actions
        )
        self.annotations_table.itemDoubleClicked.connect(
            lambda *_: self._jump_to_selected_annotation()
        )
        self.streaming_start_button.clicked.connect(self._start_streaming)
        self.streaming_pause_button.clicked.connect(self._pause_streaming)
        self.streaming_stop_button.clicked.connect(self._stop_streaming)
        self.streaming_back_button.clicked.connect(lambda: self._step_streaming(-1.0))
        self.streaming_forward_button.clicked.connect(lambda: self._step_streaming(1.0))
        self.streaming_stride_spin.valueChanged.connect(
            lambda *_: self._update_streaming_ui()
        )
        self.streaming_speed_combo.currentIndexChanged.connect(
            lambda *_: self._update_streaming_ui()
        )
        self.streaming_loop_checkbox.toggled.connect(
            lambda *_: self._update_streaming_ui()
        )

        self.variant_combo.currentIndexChanged.connect(self._on_variant_changed)
        self.heatmap_color_scheme_combo.currentIndexChanged.connect(
            self._on_heatmap_color_scheme_changed
        )
        self.dda_import_snapshot_button.clicked.connect(self._import_snapshot)
        self.dda_view_history_result_button.clicked.connect(
            self._view_selected_history_result
        )
        self.dda_history_table.itemSelectionChanged.connect(
            self._on_results_history_selection_changed
        )
        self.dda_history_table.itemDoubleClicked.connect(
            self._view_selected_history_result
        )
        self.ica_components_table.itemSelectionChanged.connect(
            self._update_ica_component_details
        )
        self.connectivity_result_combo.currentIndexChanged.connect(
            self._refresh_connectivity_view
        )
        self.compare_baseline_combo.currentIndexChanged.connect(
            self._refresh_compare_view
        )
        self.compare_target_combo.currentIndexChanged.connect(
            self._refresh_compare_view
        )
        self.refresh_plugins_button.clicked.connect(self._refresh_plugins)
        self.install_plugin_button.clicked.connect(self._install_selected_plugin)
        self.uninstall_plugin_button.clicked.connect(self._uninstall_selected_plugin)
        self.toggle_plugin_button.clicked.connect(self._toggle_selected_plugin)
        self.run_plugin_button.clicked.connect(self._run_selected_plugin)
        self.installed_plugins_table.itemSelectionChanged.connect(
            self._update_plugin_panels
        )
        self.plugin_registry_table.itemSelectionChanged.connect(
            self._update_plugin_panels
        )
        self.openneuro_refresh_button.clicked.connect(self._load_openneuro)
        self.openneuro_search.textChanged.connect(self._filter_openneuro_table)
        self.openneuro_table.itemSelectionChanged.connect(
            self._update_openneuro_details
        )
        self.nsg_save_credentials_button.clicked.connect(self._save_nsg_credentials)
        self.nsg_delete_credentials_button.clicked.connect(self._delete_nsg_credentials)
        self.nsg_test_connection_button.clicked.connect(self._test_nsg_connection)
        self.nsg_create_job_button.clicked.connect(self._create_nsg_job)
        self.nsg_refresh_jobs_button.clicked.connect(self._refresh_nsg_state)
        self.nsg_submit_job_button.clicked.connect(self._submit_selected_nsg_job)
        self.nsg_refresh_job_button.clicked.connect(self._refresh_selected_nsg_job)
        self.nsg_cancel_job_button.clicked.connect(self._cancel_selected_nsg_job)
        self.nsg_download_results_button.clicked.connect(
            self._download_selected_nsg_results
        )
        self.nsg_jobs_table.itemSelectionChanged.connect(self._update_nsg_panels)
        self.export_annotations_button.clicked.connect(self._export_annotations)
        self.import_snapshot_button.clicked.connect(self._import_snapshot)
        self.view_history_result_button.clicked.connect(self._view_selected_history_result)
        self.results_history_table.itemSelectionChanged.connect(
            self._on_results_history_selection_changed
        )
        self.results_history_table.itemDoubleClicked.connect(
            self._view_selected_history_result
        )
        self.start_workflow_button.clicked.connect(self._start_workflow_recording)
        self.stop_workflow_button.clicked.connect(self._stop_workflow_recording)
        self.clear_workflow_button.clicked.connect(self._clear_workflow_actions)
        self.export_workflow_button.clicked.connect(self._export_workflow)
        self.import_workflow_button.clicked.connect(self._import_workflow)
        self.export_notifications_button.clicked.connect(self._export_notifications)
        self.clear_notifications_button.clicked.connect(self._clear_notifications)
        self.reconnect_button.clicked.connect(self._reconnect_backend)
        self.use_local_bridge_button.clicked.connect(self._use_local_backend)

        self.waveform_reload_timer = QTimer(self)
        self.waveform_reload_timer.setSingleShot(True)
        self.waveform_reload_timer.timeout.connect(self._load_waveform_data)

        self.overview_reload_timer = QTimer(self)
        self.overview_reload_timer.setSingleShot(True)
        self.overview_reload_timer.timeout.connect(self._load_waveform_overview)

        self.viewport_reload_timer = QTimer(self)
        self.viewport_reload_timer.setSingleShot(True)
        self.viewport_reload_timer.timeout.connect(self._load_waveform_data)

        self.streaming_timer = QTimer(self)
        self.streaming_timer.setInterval(120)
        self.streaming_timer.timeout.connect(self._advance_streaming)

        self.session_save_timer = QTimer(self)
        self.session_save_timer.setSingleShot(True)
        self.session_save_timer.timeout.connect(self._save_session_state)

        self.dda_activity_timer = QTimer(self)
        self.dda_activity_timer.setInterval(360)
        self.dda_activity_timer.timeout.connect(self._refresh_dda_running_ui)
        self.dda_activity_label.clicked.connect(
            lambda: self._show_dda_run_details_popover(self.dda_activity_label)
        )
        self.dda_global_label.clicked.connect(
            lambda: self._show_dda_run_details_popover(self.dda_global_label)
        )
