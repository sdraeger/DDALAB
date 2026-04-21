from __future__ import annotations

from typing import Dict

from PySide6.QtCore import QSize, Qt, QTimer
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
    QListWidget,
    QMenu,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QScrollArea,
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
    NetworkMotifWidget,
    OverviewWidget,
    WaveformWidget,
)
from ..ui.widgets.math_label import MathLabel
from .main_window_support import ToggleListWidget


class CurrentPageStackedWidget(QStackedWidget):
    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.currentChanged.connect(self.updateGeometry)

    def sizeHint(self) -> QSize:  # type: ignore[override]
        current = self.currentWidget()
        if current is None:
            return super().sizeHint()
        hint = current.sizeHint()
        return hint if hint.isValid() else super().sizeHint()

    def minimumSizeHint(self) -> QSize:  # type: ignore[override]
        current = self.currentWidget()
        if current is None:
            return super().minimumSizeHint()
        hint = current.minimumSizeHint()
        if hint.isValid():
            return hint
        fallback = current.sizeHint()
        return fallback if fallback.isValid() else super().minimumSizeHint()


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

    def _wrap_scroll_panel(self, widget: QWidget) -> QScrollArea:
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setWidget(widget)
        return scroll

    def _build_settings_card(
        self,
        *,
        title: str,
        description: str,
    ) -> tuple[QFrame, QVBoxLayout]:
        card = QFrame()
        card.setProperty("settingsCard", True)
        layout = QVBoxLayout(card)
        layout.setContentsMargins(18, 18, 18, 18)
        layout.setSpacing(12)

        title_label = QLabel(title)
        title_label.setProperty("settingsSectionTitle", True)
        layout.addWidget(title_label)

        description_label = QLabel(description)
        description_label.setWordWrap(True)
        description_label.setProperty("settingsCaption", True)
        layout.addWidget(description_label)
        return card, layout

    def _build_settings_stat(
        self,
        *,
        title: str,
        value: str,
        caption: str,
    ) -> tuple[QFrame, QLabel, QLabel]:
        stat = QFrame()
        stat.setProperty("settingsStat", True)
        layout = QVBoxLayout(stat)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(4)

        title_label = QLabel(title)
        title_label.setProperty("settingsEyebrow", True)
        layout.addWidget(title_label)

        value_label = QLabel(value)
        value_label.setProperty("settingsValue", True)
        layout.addWidget(value_label)

        caption_label = QLabel(caption)
        caption_label.setWordWrap(True)
        caption_label.setProperty("settingsCaption", True)
        layout.addWidget(caption_label)
        return stat, value_label, caption_label

    def _build_more_exports_button(
        self,
        *,
        include_annotations: bool,
        actions_attr: str,
    ) -> QToolButton:
        button = QToolButton()
        button.setText("More Exports")
        button.setPopupMode(QToolButton.ToolButtonPopupMode.InstantPopup)
        button.setToolButtonStyle(Qt.ToolButtonStyle.ToolButtonTextOnly)
        button.setProperty("secondary", True)
        if include_annotations:
            button.setToolTip(
                "Export recipe-only .ddalab files, JSON/CSV data, scripts,"
                " plots, and annotations."
            )
        else:
            button.setToolTip(
                "Export recipe-only .ddalab files, JSON/CSV data, scripts,"
                " and plots."
            )
        menu = QMenu(button)
        actions: Dict[str, object] = {}
        actions["recipe_ddalab"] = menu.addAction(
            "Export Recipe-only .ddalab",
            lambda: self._export_snapshot("recipe_only"),
        )
        menu.addSeparator()
        actions["result_json"] = menu.addAction(
            "Export Result JSON", self._export_result_json
        )
        actions["selected_csv"] = menu.addAction(
            "Export Selected Variant CSV", self._export_result_csv
        )
        actions["all_csv"] = menu.addAction(
            "Export All Variants CSV", self._export_all_result_csv
        )
        menu.addSeparator()
        actions["python_script"] = menu.addAction(
            "Python Script", lambda: self._export_result_script("python")
        )
        actions["matlab_script"] = menu.addAction(
            "MATLAB Script", lambda: self._export_result_script("matlab")
        )
        actions["julia_script"] = menu.addAction(
            "Julia Script", lambda: self._export_result_script("julia")
        )
        actions["rust_source"] = menu.addAction(
            "Rust Source", lambda: self._export_result_script("rust")
        )
        menu.addSeparator()
        actions["heatmap_png"] = menu.addAction(
            "Heatmap PNG", lambda: self._export_result_plot("heatmap", "png")
        )
        actions["heatmap_svg"] = menu.addAction(
            "Heatmap SVG", lambda: self._export_result_plot("heatmap", "svg")
        )
        actions["heatmap_pdf"] = menu.addAction(
            "Heatmap PDF", lambda: self._export_result_plot("heatmap", "pdf")
        )
        menu.addSeparator()
        actions["lineplot_png"] = menu.addAction(
            "Line Plot PNG", lambda: self._export_result_plot("lineplot", "png")
        )
        actions["lineplot_svg"] = menu.addAction(
            "Line Plot SVG", lambda: self._export_result_plot("lineplot", "svg")
        )
        actions["lineplot_pdf"] = menu.addAction(
            "Line Plot PDF", lambda: self._export_result_plot("lineplot", "pdf")
        )
        if include_annotations:
            menu.addSeparator()
            actions["annotations"] = menu.addAction(
                "Export Annotations", self._export_annotations
            )
        button.setMenu(menu)
        setattr(self, actions_attr, actions)
        return button

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
        tabs.setChangeCurrentOnDrag(True)
        tabs.setElideMode(Qt.ElideMiddle)
        tabs.setDrawBase(False)
        tabs.setIconSize(QSize(12, 12))
        tabs.setContextMenuPolicy(Qt.CustomContextMenu)
        tabs.setSelectionBehaviorOnRemove(QTabBar.SelectionBehavior.SelectPreviousTab)
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

        stack = CurrentPageStackedWidget()
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
        self.dda_variant_pair_lists: Dict[str, QListWidget] = {}
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
                pair_list = QListWidget()
                pair_list.setSelectionMode(QAbstractItemView.ExtendedSelection)
                pair_list.setAlternatingRowColors(True)
                pair_list.setMinimumHeight(200)
                section_layout.addWidget(pair_list, 1)

                pair_controls = QHBoxLayout()
                source_combo = QComboBox()
                source_combo.setMinimumWidth(120)
                target_combo = QComboBox()
                target_combo.setMinimumWidth(120)
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
                pair_controls.addWidget(source_combo, 1)
                pair_controls.addWidget(arrow)
                pair_controls.addWidget(target_combo, 1)
                pair_controls.addWidget(add_button)
                pair_controls.addWidget(remove_button)
                pair_controls.addWidget(clear_button)
                section_layout.addLayout(pair_controls)

                self.dda_variant_pair_lists[variant] = pair_list
                self.dda_variant_pair_source_combos[variant] = source_combo
                self.dda_variant_pair_target_combos[variant] = target_combo
                self.dda_variant_pair_add_buttons[variant] = add_button
                self.dda_variant_pair_remove_buttons[variant] = remove_button
                self.dda_variant_pair_clear_buttons[variant] = clear_button
            else:
                channel_list = ToggleListWidget()
                channel_list.setSelectionMode(QAbstractItemView.NoSelection)
                channel_list.setUniformItemSizes(True)
                channel_list.setSpacing(3)
                channel_list.setMinimumHeight(220)
                section_layout.addWidget(channel_list, 1)
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
            "Open a portable DDALAB file (.ddalab)."
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
        results_layout.addLayout(header)

        export_actions = QHBoxLayout()
        export_actions.addWidget(self.dda_import_snapshot_button)
        self.dda_snapshot_export_button = QPushButton("Export .ddalab")
        self.dda_snapshot_export_button.setProperty("secondary", True)
        self.dda_snapshot_export_button.setToolTip(
            "Save the current dataset state and result to a portable DDALAB file."
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
        self.connectivity_motif_scroll.setVerticalScrollBarPolicy(
            Qt.ScrollBarAsNeeded
        )
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

    def _build_data_page(self) -> QWidget:
        stack = CurrentPageStackedWidget()
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
        return stack

    def _build_learn_page(self) -> QWidget:
        stack = CurrentPageStackedWidget()
        self.learn_stack = stack
        stack.addWidget(
            self._build_info_page(
                "Tutorials",
                "Use Visualize for waveform inspection, DDA for analysis, and Collaborate for snapshots and workflow exports.",
            )
        )
        stack.addWidget(
            self._build_info_page(
                "Files",
                "BIDS roots, EDF/BDF, BrainVision, FIF/EEGLAB, XDF, NWB, and NIfTI datasets can be opened from the browser or the file/folder picker.",
            )
        )
        stack.addWidget(
            self._build_info_page(
                "Reference",
                "The Qt client keeps the same top-level DDALAB structure while using a Python-native desktop backend for analysis and OpenNeuro browsing.",
            )
        )
        return stack

    def _build_collaborate_page(self) -> QWidget:
        stack = CurrentPageStackedWidget()
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
        self.results_summary_label = QLabel("Run DDA to create or export a portable .ddalab file.")
        self.results_summary_label.setWordWrap(True)
        self.results_summary_label.setProperty("muted", True)
        summary_layout.addWidget(self.results_summary_label)
        layout.addWidget(summary_box)

        actions = QHBoxLayout()
        self.import_snapshot_button = QPushButton("Import .ddalab")
        self.import_snapshot_button.setProperty("secondary", True)
        self.import_snapshot_button.setToolTip(
            "Open a portable DDALAB file (.ddalab)."
        )
        self.snapshot_export_button = QPushButton("Export .ddalab")
        self.snapshot_export_button.setProperty("secondary", True)
        self.snapshot_export_button.setToolTip(
            "Save the current dataset state and result to a portable DDALAB file."
        )
        self.view_history_result_button = QPushButton("Open Selected")
        self.view_history_result_button.setProperty("secondary", True)
        self.data_export_button = self._build_more_exports_button(
            include_annotations=True,
            actions_attr="results_more_export_actions",
        )

        for button in (
            self.import_snapshot_button,
            self.snapshot_export_button,
            self.view_history_result_button,
            self.data_export_button,
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
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(0, 0, 0, 12)
        layout.setSpacing(16)

        hero = QFrame()
        hero.setProperty("settingsHero", True)
        hero_layout = QVBoxLayout(hero)
        hero_layout.setContentsMargins(22, 20, 22, 20)
        hero_layout.setSpacing(14)

        hero_kicker = QLabel("Workspace Preferences")
        hero_kicker.setProperty("settingsEyebrow", True)
        hero_layout.addWidget(hero_kicker)

        hero_title = QLabel("Tune how DDALAB behaves on this machine")
        hero_title.setProperty("title", True)
        hero_layout.addWidget(hero_title)

        hero_copy = QLabel(
            "Choose your backend mode, switch themes, and decide whether the interface should stay streamlined or expose expert DDA controls."
        )
        hero_copy.setWordWrap(True)
        hero_copy.setProperty("settingsCaption", True)
        hero_layout.addWidget(hero_copy)

        hero_stats = QGridLayout()
        hero_stats.setHorizontalSpacing(12)
        hero_stats.setVerticalSpacing(12)
        (
            backend_stat,
            self.settings_backend_summary_value,
            self.settings_backend_summary_caption,
        ) = self._build_settings_stat(
            title="Backend",
            value="Local",
            caption="Default on-device mode",
        )
        (
            theme_stat,
            self.settings_theme_summary_value,
            self.settings_theme_summary_caption,
        ) = self._build_settings_stat(
            title="Theme",
            value="Dark",
            caption="Focused analysis workspace",
        )
        (
            analysis_stat,
            self.settings_analysis_summary_value,
            self.settings_analysis_summary_caption,
        ) = self._build_settings_stat(
            title="Analysis",
            value="Standard",
            caption="Archived EEG defaults",
        )
        hero_stats.addWidget(backend_stat, 0, 0)
        hero_stats.addWidget(theme_stat, 0, 1)
        hero_stats.addWidget(analysis_stat, 0, 2)
        hero_layout.addLayout(hero_stats)
        layout.addWidget(hero)

        cards = QGridLayout()
        cards.setHorizontalSpacing(16)
        cards.setVerticalSpacing(16)
        cards.setColumnStretch(0, 1)
        cards.setColumnStretch(1, 1)

        backend_card, backend_layout = self._build_settings_card(
            title="Backend",
            description=(
                "Local mode is recommended for everyday use. Remote mode is available for shared or institutional deployments."
            ),
        )
        backend_mode_panel = QFrame()
        backend_mode_panel.setProperty("settingsSubcard", True)
        backend_mode_layout = QVBoxLayout(backend_mode_panel)
        backend_mode_layout.setContentsMargins(14, 12, 14, 12)
        backend_mode_layout.setSpacing(6)
        backend_mode_heading = QLabel("Current mode")
        backend_mode_heading.setProperty("settingsEyebrow", True)
        backend_mode_layout.addWidget(backend_mode_heading)
        self.backend_mode_label = QLabel("Local Python backend is the default backend.")
        self.backend_mode_label.setWordWrap(True)
        self.backend_mode_label.setProperty("muted", True)
        backend_mode_layout.addWidget(self.backend_mode_label)
        backend_layout.addWidget(backend_mode_panel)

        backend_url_label = QLabel("Remote server URL")
        backend_url_label.setProperty("settingsFieldLabel", True)
        backend_layout.addWidget(backend_url_label)
        self.server_url_edit = QLineEdit(self._server_url)
        self.server_url_edit.setPlaceholderText(
            "Optional remote server URL for shared or institutional deployments"
        )
        backend_layout.addWidget(self.server_url_edit)

        self.settings_backend_hint_label = QLabel(
            "Leave this empty to keep using the bundled local backend."
        )
        self.settings_backend_hint_label.setWordWrap(True)
        self.settings_backend_hint_label.setProperty("settingsCaption", True)
        backend_layout.addWidget(self.settings_backend_hint_label)

        backend_actions = QHBoxLayout()
        backend_actions.setSpacing(10)
        self.reconnect_button = QPushButton("Connect Remote Backend")
        self.reconnect_button.setProperty("secondary", True)
        self.use_local_bridge_button = QPushButton("Use Local Backend")
        self.use_local_bridge_button.setProperty("secondary", True)
        backend_actions.addWidget(self.reconnect_button)
        backend_actions.addWidget(self.use_local_bridge_button)
        backend_actions.addStretch(1)
        backend_layout.addLayout(backend_actions)
        cards.addWidget(backend_card, 0, 0)

        appearance_card, appearance_layout = self._build_settings_card(
            title="Appearance",
            description=(
                "Switch between the darker analysis workspace and a lighter review mode without restarting the app."
            ),
        )
        appearance_row = QHBoxLayout()
        appearance_row.setSpacing(12)
        theme_label = QLabel("Theme")
        theme_label.setProperty("settingsFieldLabel", True)
        appearance_row.addWidget(theme_label)
        self.theme_mode_combo = QComboBox()
        self.theme_mode_combo.addItem("Dark", "dark")
        self.theme_mode_combo.addItem("Light", "light")
        current_theme_index = self.theme_mode_combo.findData(self.state.theme_mode)
        if current_theme_index >= 0:
            self.theme_mode_combo.setCurrentIndex(current_theme_index)
        appearance_row.addWidget(self.theme_mode_combo, 1)
        appearance_layout.addLayout(appearance_row)

        appearance_preview = QFrame()
        appearance_preview.setProperty("settingsSubcard", True)
        appearance_preview_layout = QVBoxLayout(appearance_preview)
        appearance_preview_layout.setContentsMargins(14, 12, 14, 12)
        appearance_preview_layout.setSpacing(6)
        preview_heading = QLabel("Current feel")
        preview_heading.setProperty("settingsEyebrow", True)
        appearance_preview_layout.addWidget(preview_heading)
        self.theme_mode_hint = QLabel(
            "Dark mode keeps focus on plots and long sessions."
        )
        self.theme_mode_hint.setWordWrap(True)
        self.theme_mode_hint.setProperty("muted", True)
        appearance_preview_layout.addWidget(self.theme_mode_hint)
        appearance_layout.addWidget(appearance_preview)
        cards.addWidget(appearance_card, 0, 1)

        analysis_card, analysis_layout = self._build_settings_card(
            title="Analysis Controls",
            description=(
                "Choose whether DDALAB should stay streamlined or expose the full expert DDA parameter space."
            ),
        )
        analysis_mode_panel = QFrame()
        analysis_mode_panel.setProperty("settingsSubcard", True)
        analysis_mode_layout = QVBoxLayout(analysis_mode_panel)
        analysis_mode_layout.setContentsMargins(14, 12, 14, 12)
        analysis_mode_layout.setSpacing(8)
        self.settings_expert_mode_checkbox = QCheckBox("Enable Expert Mode")
        self.settings_expert_mode_checkbox.setChecked(self.state.expert_mode)
        analysis_mode_layout.addWidget(self.settings_expert_mode_checkbox)
        self.settings_expert_mode_hint = QLabel(
            "Expert mode exposes custom delays, MODEL dimensions, polynomial order, and explicit term selection. When disabled, DDALAB runs with the archived EEG defaults."
        )
        self.settings_expert_mode_hint.setWordWrap(True)
        self.settings_expert_mode_hint.setProperty("muted", True)
        analysis_mode_layout.addWidget(self.settings_expert_mode_hint)
        analysis_layout.addWidget(analysis_mode_panel)
        cards.addWidget(analysis_card, 1, 0)

        updates_card, updates_layout = self._build_settings_card(
            title="Updates",
            description=(
                "Installed desktop builds can check GitHub Releases, download the correct asset for this platform, and hand off installation automatically."
            ),
        )
        updates_panel = QFrame()
        updates_panel.setProperty("settingsSubcard", True)
        updates_panel_layout = QGridLayout(updates_panel)
        updates_panel_layout.setContentsMargins(14, 12, 14, 12)
        updates_panel_layout.setHorizontalSpacing(12)
        updates_panel_layout.setVerticalSpacing(8)

        current_version_label = QLabel("Current version")
        current_version_label.setProperty("settingsEyebrow", True)
        updates_panel_layout.addWidget(current_version_label, 0, 0)
        self.settings_update_current_version_value = QLabel("v0.0.0")
        self.settings_update_current_version_value.setProperty("title", True)
        updates_panel_layout.addWidget(self.settings_update_current_version_value, 1, 0)

        latest_release_label = QLabel("Latest release")
        latest_release_label.setProperty("settingsEyebrow", True)
        updates_panel_layout.addWidget(latest_release_label, 0, 1)
        self.settings_update_release_value = QLabel("Not checked yet")
        self.settings_update_release_value.setProperty("title", True)
        updates_panel_layout.addWidget(self.settings_update_release_value, 1, 1)

        self.settings_update_status_label = QLabel(
            "Check GitHub releases for packaged desktop updates."
        )
        self.settings_update_status_label.setWordWrap(True)
        self.settings_update_status_label.setProperty("muted", True)
        updates_panel_layout.addWidget(self.settings_update_status_label, 2, 0, 1, 2)

        updates_layout.addWidget(updates_panel)

        self.settings_update_hint_label = QLabel(
            "Automatic checks run only for installed desktop builds."
        )
        self.settings_update_hint_label.setWordWrap(True)
        self.settings_update_hint_label.setProperty("settingsCaption", True)
        updates_layout.addWidget(self.settings_update_hint_label)

        self.settings_update_progress = QProgressBar()
        self.settings_update_progress.setRange(0, 100)
        self.settings_update_progress.setValue(0)
        self.settings_update_progress.setVisible(False)
        updates_layout.addWidget(self.settings_update_progress)

        updates_actions = QHBoxLayout()
        updates_actions.setSpacing(10)
        self.settings_update_check_button = QPushButton("Check for Updates")
        self.settings_update_check_button.setProperty("secondary", True)
        self.settings_update_install_button = QPushButton("Install Latest Update")
        self.settings_update_install_button.setEnabled(False)
        updates_actions.addWidget(self.settings_update_check_button)
        updates_actions.addWidget(self.settings_update_install_button)
        updates_actions.addStretch(1)
        updates_layout.addLayout(updates_actions)
        cards.addWidget(updates_card, 1, 1)

        scope_card, scope_layout = self._build_settings_card(
            title="Desktop Scope",
            description=(
                "This desktop build focuses on active local workflows and keeps unsupported integrations hidden from the main navigation."
            ),
        )
        included_panel = QFrame()
        included_panel.setProperty("settingsSubcard", True)
        included_layout = QVBoxLayout(included_panel)
        included_layout.setContentsMargins(14, 12, 14, 12)
        included_layout.setSpacing(6)
        included_heading = QLabel("Included in this build")
        included_heading.setProperty("settingsEyebrow", True)
        included_layout.addWidget(included_heading)
        for line in (
            "Waveform inspection and viewport navigation",
            "DDA, ICA, batch analysis, connectivity, and compare views",
            "Annotations, portable .ddalab snapshots, and reproducible exports",
            "Workflow recording, notifications, and OpenNeuro browsing",
        ):
            item = QLabel(line)
            item.setWordWrap(True)
            item.setProperty("settingsListItem", True)
            included_layout.addWidget(item)
        scope_layout.addWidget(included_panel)
        cards.addWidget(scope_card, 2, 0, 1, 2)

        layout.addLayout(cards)
        layout.addStretch(1)
        page = self._wrap_scroll_panel(content)
        self._refresh_settings_overview()
        return page

    def _build_info_page(self, title: str, message: str) -> QWidget:
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
        self.window_length_spin.valueChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.window_step_spin.valueChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.delays_edit.textChanged.connect(lambda *_: self._schedule_session_save())
        self.dda_expert_mode_checkbox.toggled.connect(self._on_expert_mode_toggled)
        self.settings_expert_mode_checkbox.toggled.connect(self._on_expert_mode_toggled)
        self.dda_start_edit.textChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.dda_end_edit.textChanged.connect(lambda *_: self._schedule_session_save())
        self.delays_edit.textChanged.connect(self._on_dda_expert_controls_changed)
        self.dda_model_dimension_spin.valueChanged.connect(
            self._on_dda_model_space_changed
        )
        self.dda_polynomial_order_spin.valueChanged.connect(
            self._on_dda_model_space_changed
        )
        self.dda_nr_tau_spin.valueChanged.connect(self._on_dda_model_space_changed)
        self.dda_model_terms_list.itemChanged.connect(
            self._on_dda_model_terms_changed
        )
        self.dda_apply_model_preset_button.clicked.connect(
            self._apply_selected_dda_model_preset
        )
        self.dda_reset_model_button.clicked.connect(self._reset_dda_model_to_default)
        self.ica_start_edit.textChanged.connect(
            lambda *_: self._schedule_session_save()
        )
        self.ica_end_edit.textChanged.connect(lambda *_: self._schedule_session_save())
        for variant_id, checkbox in self.variant_checkboxes.items():
            checkbox.toggled.connect(
                lambda checked, target_variant=variant_id: self._on_dda_variant_checkbox_toggled(
                    target_variant, checked
                )
            )
        self.dda_variant_selector_nav.currentChanged.connect(
            self._on_dda_variant_selector_changed
        )
        for variant_id, channel_list in self.dda_variant_channel_lists.items():
            channel_list.itemChanged.connect(
                lambda *_args, target_variant=variant_id: self._on_dda_variant_channel_list_changed(
                    target_variant
                )
            )
        for variant_id, pair_list in self.dda_variant_pair_lists.items():
            pair_list.itemSelectionChanged.connect(
                lambda target_variant=variant_id: self._update_dda_variant_pair_buttons(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_pair_add_buttons.items():
            button.clicked.connect(
                lambda _checked=False, target_variant=variant_id: self._on_dda_variant_pair_add_requested(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_pair_remove_buttons.items():
            button.clicked.connect(
                lambda _checked=False, target_variant=variant_id: self._on_dda_variant_pair_remove_requested(
                    target_variant
                )
            )
        for variant_id, button in self.dda_variant_pair_clear_buttons.items():
            button.clicked.connect(
                lambda _checked=False, target_variant=variant_id: self._on_dda_variant_pair_clear_requested(
                    target_variant
                )
            )
        self.run_ica_button.clicked.connect(self._run_ica)
        self.batch_select_all_button.clicked.connect(self._select_all_batch_files)
        self.batch_select_open_button.clicked.connect(self._select_open_batch_files)
        self.batch_run_button.clicked.connect(self._run_batch_analysis)
        self.file_tabs.currentChanged.connect(self._on_tab_changed)
        self.file_tabs.tabCloseRequested.connect(self._close_file_tab)
        self.file_tabs.tabMoved.connect(self._on_file_tab_moved)
        self.file_tabs.customContextMenuRequested.connect(
            self._open_file_tab_context_menu
        )
        self.close_other_tabs_button.clicked.connect(self._close_other_tabs)
        self.primary_nav.currentChanged.connect(self._on_primary_nav_changed)
        self.secondary_nav.currentChanged.connect(self._on_secondary_nav_changed)

        self.file_browser.refresh_requested.connect(self._refresh_browser)
        self.file_browser.parent_requested.connect(self._open_parent_directory)
        self.file_browser.root_requested.connect(self._bootstrap_browser)
        self.file_browser.open_file_requested.connect(self._choose_local_file)
        self.file_browser.open_folder_requested.connect(self._choose_local_folder)
        self.file_browser.navigate_requested.connect(self._refresh_browser)
        self.file_browser.entry_activated.connect(self._open_entry)
        self.file_browser.context_action_requested.connect(
            self._handle_file_browser_context_action
        )
        self.file_browser.search_changed.connect(self._on_browser_search_changed)

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
        self.heatmap_widget.annotation_context_requested.connect(
            self._open_dda_heatmap_annotation_context_menu
        )
        self.dda_lineplot_widget.annotation_context_requested.connect(
            self._open_dda_lineplot_annotation_context_menu
        )

        self.pan_left_button.clicked.connect(lambda: self._shift_viewport(-1.0))
        self.pan_right_button.clicked.connect(lambda: self._shift_viewport(1.0))
        self.zoom_in_button.clicked.connect(lambda: self._zoom_viewport(0.7))
        self.zoom_out_button.clicked.connect(lambda: self._zoom_viewport(1.4))
        self.reset_view_button.clicked.connect(self._reset_viewport)
        self.capture_annotation_button.clicked.connect(self._capture_annotation)
        self.jump_annotation_button.clicked.connect(self._jump_to_selected_annotation)
        self.delete_annotation_button.clicked.connect(self._delete_selected_annotation)
        self.import_annotations_button.clicked.connect(self._import_annotations)
        self.export_annotations_button.clicked.connect(self._export_annotations)
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
        self.dda_snapshot_export_button.clicked.connect(self._export_snapshot)
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
            self._on_compare_source_changed
        )
        self.compare_target_combo.currentIndexChanged.connect(
            self._on_compare_source_changed
        )
        self.compare_swap_button.clicked.connect(self._swap_compare_sources)
        self.compare_variant_combo.currentIndexChanged.connect(
            self._on_compare_variant_changed
        )
        self.compare_view_nav.currentChanged.connect(self._on_compare_view_mode_changed)
        self.compare_row_list.itemChanged.connect(self._on_compare_row_selection_changed)
        self.compare_select_top_rows_button.clicked.connect(
            self._select_top_changed_compare_rows
        )
        self.compare_select_all_rows_button.clicked.connect(
            self._select_all_compare_rows
        )
        self.compare_clear_rows_button.clicked.connect(self._clear_compare_rows)
        self.compare_table.itemSelectionChanged.connect(
            self._on_compare_variant_table_selection_changed
        )
        if hasattr(self, "refresh_plugins_button"):
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
        self.theme_mode_combo.currentIndexChanged.connect(self._on_theme_mode_changed)
        self.openneuro_refresh_button.clicked.connect(self._load_openneuro)
        self.openneuro_search.textChanged.connect(self._filter_openneuro_table)
        self.openneuro_table.itemSelectionChanged.connect(
            self._update_openneuro_details
        )
        if hasattr(self, "nsg_save_credentials_button"):
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
        self.import_snapshot_button.clicked.connect(self._import_snapshot)
        self.snapshot_export_button.clicked.connect(self._export_snapshot)
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
        self.settings_update_check_button.clicked.connect(
            self._on_check_for_updates_clicked
        )
        self.settings_update_install_button.clicked.connect(
            self._on_install_update_clicked
        )

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
