from __future__ import annotations

from typing import Dict

from PySide6.QtCore import QSize, Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QMenu,
    QPushButton,
    QScrollArea,
    QSplitter,
    QStatusBar,
    QTabBar,
    QTableWidget,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from ...ui.widgets.busy_indicator import BusyIndicatorBar
from ...ui.widgets.clickable_label import ClickableLabel
from ...ui.widgets.file_browser import FileBrowserWidget
from .main_window_ui_analysis_pages import MainWindowUiAnalysisPagesMixin
from .main_window_ui_bindings import MainWindowUiBindingsMixin
from .main_window_ui_explore_pages import MainWindowUiExplorePagesMixin
from .main_window_ui_results_pages import MainWindowUiResultsPagesMixin
from .main_window_ui_stack import CurrentPageStackedWidget


class MainWindowUiMixin(
    MainWindowUiExplorePagesMixin,
    MainWindowUiAnalysisPagesMixin,
    MainWindowUiResultsPagesMixin,
    MainWindowUiBindingsMixin,
):
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
                "Export recipe-only .ddalab files, JSON/CSV data, scripts, and plots."
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
        brand.addWidget(title)
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
        self._add_primary_page("Workspace", self._build_visualize_page())
        self._add_primary_page("Run DDA", self._build_analyze_page())
        self._add_primary_page("Results", self._build_collaborate_page())
        self._add_primary_page("Settings", self._build_settings_page())
        self._rebuild_secondary_nav("Workspace")

    def _add_primary_page(self, label: str, widget: QWidget) -> None:
        self.page_registry[label] = widget
        self.primary_stack.addWidget(widget)
