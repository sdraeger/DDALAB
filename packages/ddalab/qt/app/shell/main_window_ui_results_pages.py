from __future__ import annotations


from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFrame,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPlainTextEdit,
    QProgressBar,
    QPushButton,
    QSplitter,
    QTableWidget,
    QVBoxLayout,
    QWidget,
)

from .main_window_ui_stack import CurrentPageStackedWidget


class MainWindowUiResultsPagesMixin:
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
        self.openneuro_load_more_button = QPushButton("Load More")
        self.openneuro_load_more_button.setProperty("secondary", True)
        self.openneuro_open_button = QPushButton("Open Dataset Page")
        self.openneuro_open_button.setProperty("secondary", True)
        self.openneuro_copy_id_button = QPushButton("Copy Dataset ID")
        self.openneuro_copy_id_button.setProperty("secondary", True)
        self.openneuro_open_button.setEnabled(False)
        self.openneuro_copy_id_button.setEnabled(False)
        toolbar.addWidget(self.openneuro_search, 1)
        toolbar.addWidget(self.openneuro_refresh_button)
        toolbar.addWidget(self.openneuro_load_more_button)
        toolbar.addWidget(self.openneuro_open_button)
        toolbar.addWidget(self.openneuro_copy_id_button)
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

    def _build_collaborate_page(self) -> QWidget:
        stack = CurrentPageStackedWidget()
        self.collaborate_stack = stack
        stack.addWidget(self._build_results_page())
        stack.addWidget(self._build_workflow_page())
        stack.addWidget(self._build_notifications_page())
        return stack

    def _build_results_page(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        layout.setSpacing(12)

        summary_box = QGroupBox("Current Analysis")
        summary_layout = QVBoxLayout(summary_box)
        self.results_summary_label = QLabel(
            "Run DDA to create or export a DDALAB snapshot file."
        )
        self.results_summary_label.setWordWrap(True)
        self.results_summary_label.setProperty("muted", True)
        summary_layout.addWidget(self.results_summary_label)
        layout.addWidget(summary_box)

        actions = QHBoxLayout()
        self.import_snapshot_button = QPushButton("Import .ddalab")
        self.import_snapshot_button.setProperty("secondary", True)
        self.import_snapshot_button.setToolTip("Open a DDALAB snapshot file (.ddalab).")
        self.snapshot_export_button = QPushButton("Export .ddalab")
        self.snapshot_export_button.setProperty("secondary", True)
        self.snapshot_export_button.setToolTip(
            "Save the current dataset state and result to a DDALAB snapshot file."
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
        self.results_history_status_label = QLabel(
            "No saved analyses for this file yet."
        )
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

        status_box = QGroupBox("Workflow Log")
        status_layout = QVBoxLayout(status_box)
        self.workflow_status_label = QLabel("Action log idle")
        self.workflow_status_label.setWordWrap(True)
        self.workflow_status_label.setProperty("muted", True)
        status_layout.addWidget(self.workflow_status_label)
        layout.addWidget(status_box)

        actions = QHBoxLayout()
        self.start_workflow_button = QPushButton("Start Logging")
        self.stop_workflow_button = QPushButton("Stop Logging")
        self.stop_workflow_button.setProperty("secondary", True)
        self.clear_workflow_button = QPushButton("Clear")
        self.clear_workflow_button.setProperty("secondary", True)
        self.export_workflow_button = QPushButton("Export Action Log")
        self.export_workflow_button.setProperty("secondary", True)
        self.import_workflow_button = QPushButton("Import Action Log")
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
            "Review the local backend status, switch themes, and decide whether the interface should stay streamlined or expose expert DDA controls."
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
                "DDALAB runs through the bundled local Python backend and Rust DDA sidecar."
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

        self.settings_backend_hint_label = QLabel(
            "External services are limited to OpenNeuro, NSG, and update checks."
        )
        self.settings_backend_hint_label.setWordWrap(True)
        self.settings_backend_hint_label.setProperty("settingsCaption", True)
        backend_layout.addWidget(self.settings_backend_hint_label)
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
            "Annotations, DDALAB snapshots, and reproducible exports",
            "Workflow logging, notifications, and OpenNeuro browsing",
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
