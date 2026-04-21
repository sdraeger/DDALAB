from __future__ import annotations

from dataclasses import asdict
import json
import math
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
import uuid
from typing import Callable, Dict, List, Optional

from PySide6.QtCore import (
    QByteArray,
    QEvent,
    QSignalBlocker,
    Qt,
    QTimer,
    Signal,
    QObject,
    QPoint,
)
from PySide6.QtGui import QColor
from PySide6.QtGui import QIcon, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QApplication,
    QFileDialog,
    QListWidget,
    QListWidgetItem,
    QMenu,
    QMessageBox,
    QStyle,
    QStyleOptionViewItem,
    QTableWidgetItem,
    QWidget,
)

from ..domain.file_types import classify_path, open_file_dialog_filter
from ..domain.models import (
    BrowserEntry,
    DdaResult,
    DdaReproductionConfig,
    DdaResultSummary,
    DdaVariantResult,
    IcaComponent,
    IcaResult,
    NetworkMotifData,
    NotificationEntry,
    WaveformAnnotation,
    WorkflowActionEntry,
)
from ..persistence.state_db import StateDatabase
from ..ui.style import apply_theme, current_theme_colors, normalize_theme_mode
from ..update_manager import AvailableUpdate, UpdateDownloadProgress


class WorkerSignals(QObject):
    success = Signal(object)
    error = Signal(str)
    progress = Signal(object)


class ToggleListWidget(QListWidget):
    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self._pressed_item: Optional[QListWidgetItem] = None
        self._pressed_on_indicator = False

    def mousePressEvent(self, event) -> None:  # type: ignore[override]
        item = self.itemAt(event.position().toPoint())
        self._pressed_item = item
        self._pressed_on_indicator = (
            self._is_on_check_indicator(item, event.position().toPoint())
            if item
            else False
        )
        super().mousePressEvent(event)

    def mouseReleaseEvent(self, event) -> None:  # type: ignore[override]
        item = self.itemAt(event.position().toPoint())
        should_toggle = (
            event.button() == Qt.LeftButton
            and item is not None
            and item is self._pressed_item
            and not self._pressed_on_indicator
            and bool(item.flags() & Qt.ItemIsUserCheckable)
        )
        super().mouseReleaseEvent(event)
        if should_toggle:
            item.setCheckState(
                Qt.Unchecked if item.checkState() == Qt.Checked else Qt.Checked
            )
        self._pressed_item = None
        self._pressed_on_indicator = False

    def _is_on_check_indicator(self, item: Optional[QListWidgetItem], point) -> bool:
        if item is None:
            return False
        option = QStyleOptionViewItem()
        option.initFrom(self)
        option.rect = self.visualItemRect(item)
        option.features |= QStyleOptionViewItem.HasCheckIndicator
        option.checkState = item.checkState()
        indicator_rect = self.style().subElementRect(
            QStyle.SE_ItemViewItemCheckIndicator, option, self
        )
        return indicator_rect.contains(point)


class MainWindowSupportMixin:
    def _refresh_settings_overview(self) -> None:
        if hasattr(self, "settings_backend_summary_value"):
            if self._server_url:
                self.settings_backend_summary_value.setText("Remote")
                self.settings_backend_summary_caption.setText(
                    "Connected to a shared backend"
                )
                if hasattr(self, "settings_backend_hint_label"):
                    self.settings_backend_hint_label.setText(
                        "Remote mode is active. Clear the URL or use the local button to return to the bundled backend."
                    )
            else:
                self.settings_backend_summary_value.setText("Local")
                self.settings_backend_summary_caption.setText(
                    "Bundled backend on this device"
                )
                if hasattr(self, "settings_backend_hint_label"):
                    self.settings_backend_hint_label.setText(
                        "Leave this empty to keep using the bundled local backend."
                    )

        if hasattr(self, "settings_theme_summary_value"):
            if self.state.theme_mode == "light":
                self.settings_theme_summary_value.setText("Light")
                self.settings_theme_summary_caption.setText(
                    "Brighter review and presentation mode"
                )
                if hasattr(self, "theme_mode_hint"):
                    self.theme_mode_hint.setText(
                        "Light mode works well for screenshots, daytime review, and side-by-side reading."
                    )
            else:
                self.settings_theme_summary_value.setText("Dark")
                self.settings_theme_summary_caption.setText(
                    "Focused analysis workspace"
                )
                if hasattr(self, "theme_mode_hint"):
                    self.theme_mode_hint.setText(
                        "Dark mode keeps attention on plots during longer analysis sessions."
                    )

        if hasattr(self, "settings_analysis_summary_value"):
            if self.state.expert_mode:
                self.settings_analysis_summary_value.setText("Expert")
                self.settings_analysis_summary_caption.setText(
                    "Custom DDA controls are available"
                )
            else:
                self.settings_analysis_summary_value.setText("Standard")
                self.settings_analysis_summary_caption.setText(
                    "Archived EEG defaults stay in control"
                )

        self._refresh_update_ui()

    def _initialize_update_support(self) -> None:
        self._refresh_update_ui()
        if self._allow_update_checks and self._update_manager.supports_updates():
            QTimer.singleShot(1800, self._run_startup_update_check)

    def _run_startup_update_check(self) -> None:
        self._check_for_updates(manual=False)

    def _refresh_update_ui(self) -> None:
        if not hasattr(self, "settings_update_status_label"):
            return

        supports_updates = self._update_manager.supports_updates()
        latest_version = (
            f"v{self._pending_update.latest_version}"
            if self._pending_update is not None
            else "Not checked yet"
        )
        if hasattr(self, "settings_update_current_version_value"):
            self.settings_update_current_version_value.setText(f"v{self._app_version}")
        if hasattr(self, "settings_update_release_value"):
            self.settings_update_release_value.setText(latest_version)
        if supports_updates:
            self.settings_update_status_label.setText(self._update_status_text)
            self.settings_update_hint_label.setText(
                "Packaged desktop builds check GitHub Releases and install the matching asset for this platform."
            )
        else:
            self.settings_update_status_label.setText(
                "Automatic updates are available only in packaged desktop builds."
            )
            self.settings_update_hint_label.setText(
                "Use a release installer or frozen app build to enable update checks and one-click installs."
            )

        busy = self._update_check_in_progress or self._update_install_in_progress
        self.settings_update_check_button.setEnabled(supports_updates and not busy)
        self.settings_update_install_button.setEnabled(
            supports_updates and self._pending_update is not None and not busy
        )
        self.settings_update_check_button.setText(
            "Checking…"
            if self._update_check_in_progress
            else "Check for Updates"
        )
        self.settings_update_install_button.setText(
            "Downloading…"
            if self._update_install_in_progress
            else "Install Latest Update"
        )

        if self._update_install_in_progress:
            self.settings_update_progress.setVisible(True)
            if self._update_download_percent is None:
                self.settings_update_progress.setRange(0, 0)
            else:
                self.settings_update_progress.setRange(0, 100)
                self.settings_update_progress.setValue(self._update_download_percent)
        else:
            self.settings_update_progress.setVisible(False)
            self.settings_update_progress.setRange(0, 100)
            self.settings_update_progress.setValue(0)

    def _on_check_for_updates_clicked(self) -> None:
        self._check_for_updates(manual=True)

    def _check_for_updates(self, *, manual: bool) -> None:
        if self._update_check_in_progress or self._update_install_in_progress:
            return
        if not self._update_manager.supports_updates():
            if manual:
                QMessageBox.information(
                    self,
                    "DDALAB Updates",
                    "Automatic updates are available only in packaged desktop builds.",
                )
            return

        self._update_check_in_progress = True
        self._update_status_text = "Checking GitHub releases…"
        self._update_download_percent = None
        self._refresh_update_ui()

        def on_success(result: object) -> None:
            self._update_check_in_progress = False
            update = result if isinstance(result, AvailableUpdate) else None
            self._pending_update = update
            if update is None:
                self._update_status_text = f"DDALAB v{self._app_version} is up to date."
                self._refresh_update_ui()
                if manual:
                    QMessageBox.information(
                        self,
                        "DDALAB Updates",
                        f"DDALAB v{self._app_version} is already the latest release.",
                    )
                return

            self._update_status_text = (
                f"DDALAB v{update.latest_version} is available for install."
            )
            self._refresh_update_ui()
            if not manual:
                self._notify(
                    "system",
                    "info",
                    "Update Available",
                    f"DDALAB v{update.latest_version} is ready to install.",
                    show_status=False,
                )
            self._prompt_for_update_install(update)

        def on_error(message: str) -> None:
            self._update_check_in_progress = False
            self._update_status_text = f"Update check failed: {message}"
            self._refresh_update_ui()
            if manual:
                self._show_error(f"Update check failed: {message}")
            else:
                self._notify(
                    "system",
                    "warning",
                    "Update Check Failed",
                    message,
                    show_status=False,
                )

        self._run_task(self._update_manager.check_for_updates, on_success, on_error)

    def _prompt_for_update_install(self, update: AvailableUpdate) -> None:
        release_line = (
            f"Release tag: {update.tag_name}\n" if update.tag_name else ""
        )
        published_line = (
            f"Published: {update.published_at_iso}\n"
            if update.published_at_iso
            else ""
        )
        should_install = (
            QMessageBox.question(
                self,
                "DDALAB Update Available",
                (
                    f"DDALAB v{update.latest_version} is available.\n\n"
                    f"Current version: v{update.current_version}\n"
                    f"{release_line}"
                    f"{published_line}\n"
                    "Install it now? DDALAB will close to finish the update."
                ),
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes,
            )
            == QMessageBox.Yes
        )
        if should_install:
            self._install_available_update(update)

    def _on_install_update_clicked(self) -> None:
        if self._pending_update is None:
            self._check_for_updates(manual=True)
            return
        self._install_available_update(self._pending_update)

    def _install_available_update(self, update: AvailableUpdate) -> None:
        if self._update_check_in_progress or self._update_install_in_progress:
            return

        self._update_install_in_progress = True
        self._update_download_percent = None
        self._update_status_text = f"Downloading DDALAB v{update.latest_version}…"
        self._refresh_update_ui()

        def task(progress_callback: Callable[[object], None]) -> object:
            return self._update_manager.download_update(
                update,
                progress_callback=lambda progress: progress_callback(progress),
            )

        def on_progress(result: object) -> None:
            if not isinstance(result, UpdateDownloadProgress):
                return
            self._update_download_percent = result.percent
            if result.total_bytes > 0:
                downloaded_mib = result.downloaded_bytes / (1024 * 1024)
                total_mib = result.total_bytes / (1024 * 1024)
                self._update_status_text = (
                    f"Downloading DDALAB v{update.latest_version}… "
                    f"{downloaded_mib:.1f} / {total_mib:.1f} MiB"
                )
            else:
                self._update_status_text = (
                    f"Downloading DDALAB v{update.latest_version}…"
                )
            self._refresh_update_ui()

        def on_success(result: object) -> None:
            downloaded_asset = Path(str(result))
            self._update_status_text = f"Preparing DDALAB v{update.latest_version}…"
            self._refresh_update_ui()
            try:
                launch_message = self._update_manager.start_install(
                    downloaded_asset,
                    current_pid=os.getpid(),
                )
            except Exception as exc:  # noqa: BLE001
                self._update_install_in_progress = False
                self._update_download_percent = None
                self._update_status_text = f"Update install failed: {exc}"
                self._refresh_update_ui()
                self._show_error(f"Could not start the update installer: {exc}")
                return

            self._notify(
                "system",
                "info",
                "Installing Update",
                f"Updating to DDALAB v{update.latest_version}",
                show_status=False,
            )
            QMessageBox.information(self, "DDALAB Updates", launch_message)
            app = QApplication.instance()
            if app is not None:
                QTimer.singleShot(150, app.quit)

        def on_error(message: str) -> None:
            self._update_install_in_progress = False
            self._update_download_percent = None
            self._update_status_text = f"Update download failed: {message}"
            self._refresh_update_ui()
            self._show_error(f"Update download failed: {message}")

        self._run_task_with_progress(task, on_success, on_error, on_progress)

    def _session_state_path(self) -> Path:
        return Path.home() / ".ddalab-qt" / "session.json"

    def _schedule_session_save(self) -> None:
        if self._restoring_session:
            return
        self.session_save_timer.start(180)

    def _current_session_payload(self) -> dict:
        return {
            "openFiles": [path for path in self.state.open_files if path],
            "pinnedFiles": [path for path in self.state.pinned_file_paths if path],
            "activeFilePath": self.state.active_file_path,
            "browserPath": self.state.browser_path,
            "browserSearch": self.state.browser_search,
            "primarySection": self._current_primary_section(),
            "secondarySection": self._current_secondary_section(),
            "selectedChannelNames": list(self.state.selected_channel_names),
            "selectedResultsHistoryId": self.state.selected_results_history_id,
            "activeVariantId": self._active_variant_id,
            "activeDdaSelectorVariantId": getattr(
                self, "_active_dda_selector_variant_id", None
            ),
            "viewport": {
                "startSeconds": self.state.waveform_viewport_start_seconds,
                "durationSeconds": self.state.waveform_viewport_duration_seconds,
            },
            "ddaConfig": self._current_dda_config_payload(),
            "compareConfig": self._current_compare_config_payload(),
            "windowGeometry": bytes(self.saveGeometry().toBase64()).decode("ascii"),
            "windowMaximized": self.isMaximized(),
            "ddaColorScheme": self.heatmap_color_scheme_combo.currentData(),
            "themeMode": self.state.theme_mode,
            "expertMode": self.state.expert_mode,
        }

    def _save_session_state(self) -> None:
        payload = self._current_session_payload()
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        if payload_json == self._last_saved_session_payload_json:
            return
        self.state_db.save_session_payload(payload)
        self._last_saved_session_payload_json = payload_json

    def _load_session_state(self) -> dict:
        payload = self.state_db.load_session_payload()
        return payload if isinstance(payload, dict) else {}

    def _normalized_session_open_files(self, payload: dict) -> List[str]:
        open_files = payload.get("openFiles") or []
        active_file = payload.get("activeFilePath")
        if not isinstance(open_files, list):
            open_files = []
        seen: set[str] = set()
        restored_paths: List[str] = []
        for raw_path in open_files:
            if not isinstance(raw_path, str) or not raw_path or raw_path in seen:
                continue
            if not self._server_url and not Path(raw_path).exists():
                continue
            seen.add(raw_path)
            restored_paths.append(raw_path)
        if (
            isinstance(active_file, str)
            and active_file
            and active_file not in seen
            and (self._server_url or Path(active_file).exists())
        ):
            restored_paths.append(active_file)
        return restored_paths

    def _restore_file_tabs_from_paths(
        self,
        restored_paths: List[str],
        *,
        pinned_files: object,
        current_path: Optional[str],
    ) -> None:
        self.state.open_files = list(restored_paths)
        self.state.pinned_file_paths = [
            path
            for path in (pinned_files if isinstance(pinned_files, list) else [])
            if isinstance(path, str) and path in restored_paths
        ]
        self._rebuild_file_tabs(current_path=current_path)

    def _preferred_session_browser_path(self, default_path: str) -> str:
        payload = self._cached_session_payload or {}
        saved_browser_path = payload.get("browserPath")
        if isinstance(saved_browser_path, str) and saved_browser_path:
            if self._server_url or Path(saved_browser_path).exists():
                return saved_browser_path
        return default_path

    def _apply_primary_secondary_view_state(
        self,
        primary_section: str,
        secondary_section: Optional[str],
    ) -> None:
        if hasattr(self, "primary_stack") and primary_section in self.page_registry:
            self.primary_stack.setCurrentWidget(self.page_registry[primary_section])
        self._rebuild_secondary_nav(primary_section)
        if secondary_section is None:
            secondary_section = self._current_secondary_section()
        tabs = self.secondary_sections.get(primary_section, [])
        if secondary_section not in tabs:
            secondary_section = tabs[0] if tabs else None
        if secondary_section is None:
            return
        secondary_index = tabs.index(secondary_section)
        with QSignalBlocker(self.secondary_nav):
            self.secondary_nav.setCurrentIndex(secondary_index)
        if primary_section == "DDA" and hasattr(self, "analyze_stack"):
            self.analyze_stack.setCurrentIndex(
                {"DDA": 0, "ICA": 1, "Batch": 2, "Connectivity": 3, "Compare": 4}.get(
                    secondary_section, 0
                )
            )
        elif primary_section == "Visualize" and hasattr(self, "visualize_stack"):
            self.visualize_stack.setCurrentIndex(
                {"Time Series": 0, "Annotations": 1, "Streaming": 2}.get(
                    secondary_section, 0
                )
            )
        elif primary_section == "Data" and hasattr(self, "data_stack"):
            self.data_stack.setCurrentIndex(
                {"OpenNeuro": 0}.get(secondary_section, 0)
            )
        elif primary_section == "Collaborate" and hasattr(self, "collaborate_stack"):
            self.collaborate_stack.setCurrentIndex(
                {"Results": 0, "Workflow": 1}.get(secondary_section, 0)
            )
        elif primary_section == "Learn" and hasattr(self, "learn_stack"):
            self.learn_stack.setCurrentIndex(
                {"Tutorials": 0, "Files": 1, "Reference": 2}.get(
                    secondary_section, 0
                )
            )

    def _apply_lightweight_session_state(self, payload: dict) -> None:
        if not isinstance(payload, dict):
            return
        restored_paths = self._normalized_session_open_files(payload)
        active_file = payload.get("activeFilePath")
        if restored_paths:
            self._restoring_session = True
            try:
                self._restore_file_tabs_from_paths(
                    restored_paths,
                    pinned_files=payload.get("pinnedFiles"),
                    current_path=active_file if isinstance(active_file, str) else None,
                )
            finally:
                self._restoring_session = False
        if isinstance(active_file, str) and active_file:
            self.state.active_file_path = active_file
            if hasattr(self, "dataset_label"):
                self.dataset_label.setText(Path(active_file).name or active_file)
            if hasattr(self, "file_status_label"):
                self.file_status_label.setText(active_file)
        browser_path = payload.get("browserPath")
        if isinstance(browser_path, str) and browser_path:
            self.state.browser_path = browser_path
            self.file_browser.set_path(browser_path)
        browser_search = payload.get("browserSearch")
        if isinstance(browser_search, str):
            self.state.browser_search = browser_search
            with QSignalBlocker(self.file_browser.search_edit):
                self.file_browser.search_edit.setText(browser_search)
        selected_channel_names = payload.get("selectedChannelNames")
        if isinstance(selected_channel_names, list):
            self.state.selected_channel_names = [
                str(name) for name in selected_channel_names if isinstance(name, str)
            ]
        viewport = payload.get("viewport")
        if isinstance(viewport, dict):
            try:
                self.state.waveform_viewport_start_seconds = float(
                    viewport.get("startSeconds", self.state.waveform_viewport_start_seconds)
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
        if "expertMode" in payload:
            self._apply_expert_mode(payload.get("expertMode"), schedule_save=False)
        self._apply_dda_config_payload(payload.get("ddaConfig"))
        self._apply_compare_config_payload(payload.get("compareConfig"))
        if hasattr(self, "viewport_label"):
            self.viewport_label.setText(
                f"{self.state.waveform_viewport_start_seconds:.2f}s → "
                f"{self.state.waveform_viewport_start_seconds + self.state.waveform_viewport_duration_seconds:.2f}s"
            )
        self._update_annotation_scope_label()
        self._update_streaming_ui()
        primary_section = payload.get("primarySection")
        secondary_section = payload.get("secondarySection")
        if isinstance(primary_section, str) and primary_section in self.primary_sections:
            primary_index = self.primary_sections.index(primary_section)
            with QSignalBlocker(self.primary_nav):
                self.primary_nav.setCurrentIndex(primary_index)
            self._apply_primary_secondary_view_state(
                primary_section,
                secondary_section if isinstance(secondary_section, str) else None,
            )

    def _restore_session_state(self) -> None:
        if self._session_restored:
            return
        self._session_restored = True
        payload = self._cached_session_payload
        self._cached_session_payload = None
        active_file = payload.get("activeFilePath")
        restored_paths = self._normalized_session_open_files(payload)
        if not restored_paths:
            self._sync_file_tab_bar()
            return
        self._restoring_session = True
        try:
            self._restore_file_tabs_from_paths(
                restored_paths,
                pinned_files=payload.get("pinnedFiles"),
                current_path=active_file if isinstance(active_file, str) else None,
            )
        finally:
            self._restoring_session = False

        target_path = (
            active_file
            if isinstance(active_file, str) and active_file in restored_paths
            else restored_paths[0]
        )
        self._pending_session_restore = payload
        target_index = self._file_tab_index_for_path(target_path)
        if target_index >= 0:
            with QSignalBlocker(self.file_tabs):
                self.file_tabs.setCurrentIndex(target_index)
            self._sync_file_tab_bar()
        self._schedule_session_save()
        self._set_dataset_loading_state(
            target_path,
            detail="Loading dataset metadata and restoring saved results…",
        )
        QTimer.singleShot(0, lambda path=target_path: self._open_dataset(path))

    def _apply_window_session_state(self, payload: dict) -> None:
        geometry = payload.get("windowGeometry")
        if isinstance(geometry, str) and geometry:
            try:
                self.restoreGeometry(QByteArray.fromBase64(geometry.encode("ascii")))
            except Exception:
                pass
        if payload.get("windowMaximized"):
            self.setWindowState(self.windowState() | Qt.WindowMaximized)
        color_scheme = payload.get("ddaColorScheme")
        if isinstance(color_scheme, str):
            index = self.heatmap_color_scheme_combo.findData(color_scheme)
            if index >= 0:
                with QSignalBlocker(self.heatmap_color_scheme_combo):
                    self.heatmap_color_scheme_combo.setCurrentIndex(index)
                self.heatmap_widget.set_color_scheme(color_scheme)
        theme_mode = normalize_theme_mode(
            payload.get("themeMode", self.state.theme_mode)
        )
        self.state.theme_mode = theme_mode
        theme_index = self.theme_mode_combo.findData(theme_mode)
        if theme_index >= 0:
            with QSignalBlocker(self.theme_mode_combo):
                self.theme_mode_combo.setCurrentIndex(theme_index)

    def _on_theme_mode_changed(self) -> None:
        self._apply_theme_mode(self.theme_mode_combo.currentData())

    def _apply_theme_mode(self, mode: object) -> None:
        normalized = normalize_theme_mode(mode)
        combo_index = self.theme_mode_combo.findData(normalized)
        if combo_index >= 0 and self.theme_mode_combo.currentIndex() != combo_index:
            with QSignalBlocker(self.theme_mode_combo):
                self.theme_mode_combo.setCurrentIndex(combo_index)
        if self.state.theme_mode == normalized:
            return
        self.state.theme_mode = normalized
        app = QApplication.instance()
        if app is not None:
            apply_theme(app, self.runtime_paths, normalized)
        self.waveform_widget.refresh_theme()
        self.overview_widget.refresh_theme()
        self.heatmap_widget.refresh_theme()
        self.dda_lineplot_widget.refresh_theme()
        self.connectivity_motif_widget.refresh_theme()
        self.compare_baseline_heatmap.refresh_theme()
        self.compare_difference_heatmap.refresh_theme()
        self.compare_target_heatmap.refresh_theme()
        self.compare_overlay_lineplot.refresh_theme()
        self.compare_difference_lineplot.refresh_theme()
        self.dda_expert_summary_equation.refresh_theme()
        self.dda_model_preview_label.refresh_theme()
        self._refresh_settings_overview()
        self.dda_global_progress.update()
        self._refresh_file_tab_labels()
        self.update()
        self._schedule_session_save()

    def _file_tab_index_for_path(self, path: str) -> int:
        for index in range(self.file_tabs.count()):
            if self.file_tabs.tabData(index) == path:
                return index
        return -1

    def _is_pinned_file(self, path: Optional[str]) -> bool:
        return bool(path) and path in self.state.pinned_file_paths

    def _normalize_pinned_file_paths(self) -> None:
        normalized: List[str] = []
        seen: set[str] = set()
        open_paths = {path for path in self.state.open_files if path}
        for path in self.state.pinned_file_paths:
            if not isinstance(path, str) or not path or path in seen or path not in open_paths:
                continue
            normalized.append(path)
            seen.add(path)
        self.state.pinned_file_paths = normalized

    def _ordered_open_files(self) -> List[str]:
        self._normalize_pinned_file_paths()
        pinned_set = set(self.state.pinned_file_paths)
        pinned = [path for path in self.state.open_files if path in pinned_set]
        unpinned = [path for path in self.state.open_files if path not in pinned_set]
        return pinned + unpinned

    def _rebuild_file_tabs(self, *, current_path: Optional[str] = None) -> None:
        ordered_paths = self._ordered_open_files()
        self.state.open_files = ordered_paths
        selected_path = (
            current_path
            if isinstance(current_path, str) and current_path in ordered_paths
            else self.state.active_file_path
            if isinstance(self.state.active_file_path, str)
            and self.state.active_file_path in ordered_paths
            else ordered_paths[0]
            if ordered_paths
            else None
        )
        with QSignalBlocker(self.file_tabs):
            while self.file_tabs.count() > 0:
                self.file_tabs.removeTab(0)
            for path in ordered_paths:
                self.file_tabs.addTab("")
                self.file_tabs.setTabData(self.file_tabs.count() - 1, path)
            if selected_path is not None:
                selected_index = ordered_paths.index(selected_path)
                self.file_tabs.setCurrentIndex(selected_index)
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()

    def _toggle_file_tab_pin(self, path: str) -> None:
        if not path:
            return
        if path in self.state.pinned_file_paths:
            self.state.pinned_file_paths = [
                value for value in self.state.pinned_file_paths if value != path
            ]
        else:
            self.state.pinned_file_paths.append(path)
        self._rebuild_file_tabs(current_path=path)
        self._schedule_session_save()

    def _close_tabs_to_side(self, anchor_index: int, *, direction: str) -> None:
        current_path = self.file_tabs.tabData(anchor_index)
        if not isinstance(current_path, str):
            return
        all_paths = [
            self.file_tabs.tabData(index)
            for index in range(self.file_tabs.count())
            if isinstance(self.file_tabs.tabData(index), str)
        ]
        if direction == "left":
            kept_paths = all_paths[anchor_index:]
        else:
            kept_paths = all_paths[: anchor_index + 1]
        self.state.open_files = kept_paths
        self.state.pinned_file_paths = [
            path for path in self.state.pinned_file_paths if path in kept_paths
        ]
        self._rebuild_file_tabs(current_path=current_path)
        self._schedule_session_save()

    def _tab_title_for_path(self, path: str) -> str:
        target = Path(path)
        basename = target.name or path
        duplicate_count = sum(
            1 for other in self.state.open_files if Path(other).name == basename
        )
        if duplicate_count <= 1:
            return basename
        parent = target.parent.name
        return f"{basename} · {parent}" if parent else basename

    def _refresh_file_tab_labels(self) -> None:
        colors = current_theme_colors(self.file_tabs)
        pinned_color = QColor(colors.accent_bg)
        default_color = QColor(colors.text)
        pinned_icon = self._pinned_tab_icon()
        for index in range(self.file_tabs.count()):
            path = self.file_tabs.tabData(index)
            if not isinstance(path, str):
                continue
            self.file_tabs.setTabText(index, self._tab_title_for_path(path))
            tooltip_lines = [path]
            if self._is_pinned_file(path):
                tooltip_lines.insert(0, "Pinned tab")
                self.file_tabs.setTabTextColor(index, pinned_color)
                self.file_tabs.setTabIcon(index, pinned_icon)
            else:
                self.file_tabs.setTabTextColor(index, default_color)
                self.file_tabs.setTabIcon(index, QIcon())
            self.file_tabs.setTabToolTip(index, "\n".join(tooltip_lines))

    def _pinned_tab_icon(self) -> QIcon:
        colors = current_theme_colors(self.file_tabs)
        icon_color = QColor(colors.accent_bg)
        pixmap = QPixmap(12, 12)
        pixmap.fill(Qt.transparent)
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing, True)
        pen = QPen(icon_color, 1.25)
        pen.setCapStyle(Qt.RoundCap)
        painter.setPen(pen)
        painter.setBrush(icon_color)
        painter.drawEllipse(3.0, 1.0, 5.0, 3.5)
        painter.drawRect(4.5, 4.0, 2.0, 1.8)
        painter.drawLine(5.5, 5.8, 5.5, 10.0)
        painter.drawLine(5.5, 10.0, 4.0, 11.0)
        painter.end()
        return QIcon(pixmap)

    def _sync_file_tab_bar(self) -> None:
        tab_count = self.file_tabs.count()
        has_tabs = tab_count > 0
        self.file_tabs_frame.setVisible(has_tabs)
        self.close_other_tabs_button.setVisible(tab_count > 1)
        if not has_tabs:
            self.file_tabs_summary_label.setText("No files")
            return
        current_path = (
            self.file_tabs.tabData(self.file_tabs.currentIndex())
            if self.file_tabs.currentIndex() >= 0
            else None
        )
        current_label = (
            self._tab_title_for_path(current_path)
            if isinstance(current_path, str)
            else "No selection"
        )
        suffix = "file" if tab_count == 1 else "files"
        pinned_count = len(self.state.pinned_file_paths)
        pinned_label = (
            f" • {pinned_count} pinned"
            if pinned_count > 0
            else ""
        )
        self.file_tabs_summary_label.setText(
            f"{tab_count} {suffix} open{pinned_label} • {current_label}"
        )

    def _append_file_tab(self, path: str) -> None:
        if path in self.state.open_files:
            self._refresh_file_tab_labels()
            self._sync_file_tab_bar()
            return
        self.state.open_files.append(path)
        self._rebuild_file_tabs(current_path=path)

    def _rebuild_open_files_from_tabs(self) -> None:
        self.state.open_files = [
            self.file_tabs.tabData(index)
            for index in range(self.file_tabs.count())
            if isinstance(self.file_tabs.tabData(index), str)
        ]
        self.state.open_files = self._ordered_open_files()
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()

    def _on_file_tab_moved(self, from_index: int, to_index: int) -> None:
        _ = from_index, to_index
        current_path = self.file_tabs.tabData(self.file_tabs.currentIndex())
        self._rebuild_open_files_from_tabs()
        self._rebuild_file_tabs(current_path=current_path if isinstance(current_path, str) else None)
        self._schedule_session_save()

    def _close_other_tabs(self) -> None:
        current_index = self.file_tabs.currentIndex()
        if current_index < 0:
            return
        current_path = self.file_tabs.tabData(current_index)
        if not isinstance(current_path, str):
            return
        self._close_other_tabs_for_path(current_path)

    def _close_other_tabs_for_path(self, current_path: str) -> None:
        self.state.open_files = [current_path]
        self.state.pinned_file_paths = [
            path for path in self.state.pinned_file_paths if path == current_path
        ]
        self._rebuild_file_tabs(current_path=current_path)
        self._schedule_session_save()

    def _run_task(
        self,
        task: Callable[[], object],
        on_success: Callable[[object], None],
        on_error: Optional[Callable[[str], None]] = None,
    ) -> None:
        signals = WorkerSignals(self)
        signals.success.connect(on_success)
        signals.error.connect(on_error or self._show_error)

        def runner() -> None:
            try:
                result = task()
            except Exception as exc:  # noqa: BLE001
                signals.error.emit(str(exc))
                return
            signals.success.emit(result)

        self._task_executor.submit(runner)

    def _run_task_with_progress(
        self,
        task: Callable[[Callable[[object], None]], object],
        on_success: Callable[[object], None],
        on_error: Optional[Callable[[str], None]] = None,
        on_progress: Optional[Callable[[object], None]] = None,
    ) -> None:
        signals = WorkerSignals(self)
        signals.success.connect(on_success)
        signals.error.connect(on_error or self._show_error)
        if on_progress is not None:
            signals.progress.connect(on_progress)

        def runner() -> None:
            try:
                result = task(signals.progress.emit)
            except Exception as exc:  # noqa: BLE001
                signals.error.emit(str(exc))
                return
            signals.success.emit(result)

        self._task_executor.submit(runner)

    def _refresh_health(self) -> None:
        self.backend_status_label.setText("Checking backend…")

        def on_success(result: object) -> None:
            health = result
            self.backend_status_label.setText(
                f"{health.service}: {health.status} • DDA {'ready' if health.dda_available else 'offline'}"
            )
            self._notify(
                "system",
                "info",
                "Backend Ready",
                self.backend_status_label.text(),
                show_status=False,
            )

        def on_error(message: str) -> None:
            self.backend_status_label.setText("Backend offline")
            self._notify("system", "error", "Backend Offline", message)

        self._run_task(self.backend.health, on_success, on_error)

    def _bootstrap_browser(self) -> None:
        def on_success(result: object) -> None:
            root_path = str(result)
            browser_path = self._preferred_session_browser_path(root_path)
            self.state.browser_path = browser_path
            self._refresh_browser(browser_path)
            self._restore_session_state()

        def on_error(message: str) -> None:
            browser_path = self._preferred_session_browser_path(str(self.repo_root))
            self.state.browser_path = browser_path
            self.file_browser.set_path(browser_path)
            self.file_browser.set_entries([])
            self._notify("file", "error", "Root Lookup Failed", message)
            self._restore_session_state()

        self._run_task(self.backend.default_root, on_success, on_error)

    def _refresh_browser(self, path: Optional[str] = None) -> None:
        target_path = path or self.state.browser_path
        if not target_path:
            return
        self.status_bar.showMessage(f"Loading directory: {target_path}", 3000)

        def task() -> object:
            return self.backend.list_directory(target_path)

        def on_success(result: object) -> None:
            path_value, entries = result
            self.state.browser_path = path_value
            self.directory_entries = entries
            self.file_browser.set_path(path_value)
            self.file_browser.set_entries(entries)
            self.file_browser.apply_search_filter(self.state.browser_search)
            self._schedule_session_save()

        self._run_task(
            task,
            on_success,
            lambda message: self.status_bar.showMessage(
                f"Directory load failed: {message}", 5000
            ),
        )

    def _on_browser_search_changed(self, text: str) -> None:
        self.state.browser_search = text
        self.file_browser.apply_search_filter(text)
        self._schedule_session_save()

    def _open_parent_directory(self) -> None:
        if not self.state.browser_path:
            return
        current = Path(self.state.browser_path)
        self._refresh_browser(
            str(current.parent if current.parent != current else current)
        )

    def _open_entry(self, entry: object) -> None:
        browser_entry = entry
        if browser_entry.open_as_dataset:
            self._open_dataset(browser_entry.path)
        elif browser_entry.is_directory:
            self._refresh_browser(browser_entry.path)
        elif browser_entry.supported:
            self._open_dataset(browser_entry.path)

    def _handle_file_browser_context_action(self, action: str, entry: object) -> None:
        if not isinstance(entry, BrowserEntry):
            return
        if action == "open":
            self._open_entry(entry)
            return
        if action == "browse":
            target = entry.path if entry.is_directory else str(Path(entry.path).parent)
            self._refresh_browser(target)
            return
        if action == "browse_parent":
            self._refresh_browser(str(Path(entry.path).parent))
            return
        if action == "reveal":
            self._reveal_path_in_system(entry.path)
            return
        if action == "copy_path":
            self._copy_text_to_clipboard(entry.path, "Path copied")
            return
        if action == "copy_name":
            self._copy_text_to_clipboard(entry.name, "Name copied")

    def _copy_text_to_clipboard(self, text: str, status_message: str) -> None:
        clipboard = QApplication.clipboard()
        clipboard.setText(text)
        self.status_bar.showMessage(status_message, 2500)

    def _reveal_path_in_system(self, path: str) -> None:
        target = Path(path)
        if not target.exists():
            self._show_error(f"Path does not exist: {path}")
            return
        try:
            if sys.platform == "darwin":
                if target.is_file():
                    subprocess.Popen(["open", "-R", str(target)])
                else:
                    subprocess.Popen(["open", str(target)])
            elif sys.platform.startswith("win"):
                if target.is_file():
                    subprocess.Popen(["explorer", f"/select,{target}"])
                else:
                    subprocess.Popen(["explorer", str(target)])
            else:
                subprocess.Popen(["xdg-open", str(target if target.is_dir() else target.parent)])
        except Exception as exc:  # noqa: BLE001
            self._show_error(f"Could not reveal path: {exc}")
            return
        self.status_bar.showMessage(f"Revealed: {target.name}", 3000)

    def _choose_local_file(self) -> None:
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Open DDALAB Dataset",
            self.state.browser_path or str(self.repo_root),
            open_file_dialog_filter(),
        )
        if file_path:
            self._open_dataset(file_path)

    def _choose_local_folder(self) -> None:
        directory_path = QFileDialog.getExistingDirectory(
            self,
            "Open DDALAB Folder",
            self.state.browser_path or str(self.repo_root),
        )
        if not directory_path:
            return
        type_info = classify_path(directory_path, True)
        entry = BrowserEntry(
            name=Path(directory_path).name or directory_path,
            path=directory_path,
            is_directory=True,
            size_bytes=0,
            modified_at_epoch_ms=0,
            supported=type_info.openable,
            type_label=type_info.label,
            open_as_dataset=type_info.open_as_dataset,
        )
        self._open_entry(entry)

    def _open_dataset(self, path: str) -> None:
        self.status_bar.showMessage(f"Opening dataset: {path}", 4000)
        self._dataset_request_serial += 1
        request_serial = self._dataset_request_serial
        self._set_dataset_loading_state(path)

        def on_success(result: object) -> None:
            if request_serial != self._dataset_request_serial:
                return
            dataset = result
            self._stop_streaming()
            self.state.selected_dataset = dataset
            self.state.active_file_path = dataset.file_path
            self._append_file_tab(dataset.file_path)
            self._select_file_tab(dataset.file_path)
            session_payload = (
                self._pending_session_restore
                if isinstance(self._pending_session_restore, dict)
                and self._pending_session_restore.get("activeFilePath")
                == dataset.file_path
                else None
            )
            default_channels = self._preferred_channel_names(
                dataset,
                min(8, len(dataset.channel_names)),
            )
            self.state.selected_channel_names = default_channels
            self.state.waveform_viewport_start_seconds = 0.0
            self.state.waveform_viewport_duration_seconds = (
                self._recommended_viewport_duration(dataset)
            )
            self.state.annotations_by_file[dataset.file_path] = []
            self.state.dda_history = []
            self.state.dda_history_summaries = []
            self.state.dda_result = None
            self.state.ica_result = None
            self.state.selected_results_history_id = None
            self.state.waveform_window = None
            self.state.waveform_overview = None
            self._overview_signature = None
            self._clear_dataset_loading_state()
            self._update_dataset_ui()
            self._populate_channels()
            self._sync_default_dda_config()
            if session_payload is not None:
                self._apply_session_restore_to_dataset(session_payload)
                self._pending_session_restore = None
            if (
                self._pending_snapshot_restore is not None
                and self._pending_snapshot_restore.get("activeFilePath")
                == dataset.file_path
            ):
                snapshot_payload = self._pending_snapshot_restore
                self._pending_snapshot_restore = None
                QTimer.singleShot(
                    0,
                    lambda payload=snapshot_payload: self._apply_snapshot_restore_to_dataset(
                        payload
                    ),
                )
            else:
                self._load_waveform_data()
                self._schedule_overview_reload(force=True)
                self._set_saved_state_loading_state(dataset.file_name)
                self._load_saved_dataset_state_async(dataset.file_path, request_serial)
            self._refresh_results_page()
            self._record_workflow_action(
                "open-dataset",
                f"Opened {dataset.file_name}",
                {"path": dataset.file_path, "format": dataset.format_label},
                file_path=dataset.file_path,
            )
            self._notify("file", "info", "Dataset Opened", dataset.file_name)
            self._schedule_session_save()

        def on_error(message: str) -> None:
            if request_serial != self._dataset_request_serial:
                return
            if (
                isinstance(self._pending_session_restore, dict)
                and self._pending_session_restore.get("activeFilePath") == path
            ):
                self._pending_session_restore = None
            self._clear_dataset_loading_state()
            self._update_dataset_ui()
            self._notify("file", "error", "Dataset Open Failed", message)

        self._run_task(
            lambda: self.backend.load_dataset(path),
            on_success,
            on_error,
        )

    def _set_saved_state_loading_state(self, file_name: str) -> None:
        if hasattr(self, "results_summary_label"):
            self.results_summary_label.setText(
                f"Loading saved analyses for {file_name}…"
            )
        if hasattr(self, "results_details"):
            self.results_details.setPlainText("")
        if hasattr(self, "results_history_status_label"):
            self.results_history_status_label.setText("Loading saved analyses…")
        if hasattr(self, "dda_history_status_label"):
            self.dda_history_status_label.setText("Loading saved analyses…")
        if hasattr(self, "batch_details"):
            self.batch_details.setPlainText("Loading saved batch/result history…")
        if hasattr(self, "batch_status_label"):
            self.batch_status_label.setText("Loading saved batch/result history…")

    def _set_startup_analysis_restore_loading_state(
        self,
        secondary_section: Optional[str],
    ) -> None:
        if secondary_section == "Batch":
            if hasattr(self, "batch_details"):
                self.batch_details.setPlainText(
                    "Restoring batch/result history after startup…"
                )
            if hasattr(self, "batch_status_label"):
                self.batch_status_label.setText(
                    "Restoring batch/result history after startup…"
                )
        elif secondary_section == "DDA":
            if hasattr(self, "dda_diagnostics"):
                self.dda_diagnostics.setPlainText(
                    "Restoring the last saved DDA result after startup…"
                )
            if hasattr(self, "result_summary"):
                self.result_summary.setPlainText(
                    "Restoring the last saved DDA result after startup…"
                )
        elif secondary_section == "ICA":
            if hasattr(self, "ica_diagnostics"):
                self.ica_diagnostics.setPlainText(
                    "Restoring the last saved ICA result after startup…"
                )
            if hasattr(self, "ica_result_summary"):
                self.ica_result_summary.setPlainText(
                    "Restoring the last saved ICA result after startup…"
                )
        elif secondary_section == "Connectivity":
            if hasattr(self, "connectivity_summary"):
                self.connectivity_summary.setPlainText(
                    "Restoring connectivity views after startup…"
                )
            if hasattr(self, "connectivity_motif_summary_label"):
                self.connectivity_motif_summary_label.setText(
                    "Restoring network motif plots after startup…"
                )
        elif secondary_section == "Compare":
            if hasattr(self, "compare_summary"):
                self.compare_summary.setPlainText(
                    "Restoring comparison views after startup…"
                )
            if hasattr(self, "compare_shared_meta_label"):
                self.compare_shared_meta_label.setText(
                    "Restoring comparison views after startup…"
                )
            if hasattr(self, "compare_stats_summary"):
                self.compare_stats_summary.setPlainText(
                    "Restoring comparison views after startup…"
                )

    def _schedule_startup_analysis_restore(
        self,
        file_path: str,
        request_serial: int,
        primary_section: Optional[str],
        secondary_section: Optional[str],
    ) -> None:
        if primary_section != "DDA":
            return
        if secondary_section not in {"Batch", "DDA", "ICA", "Connectivity", "Compare"}:
            return
        self._startup_analysis_restore_serial += 1
        restore_serial = self._startup_analysis_restore_serial
        self._set_startup_analysis_restore_loading_state(secondary_section)

        def restore_when_idle() -> None:
            if restore_serial != self._startup_analysis_restore_serial:
                return
            if request_serial != self._dataset_request_serial:
                return
            dataset = self.state.selected_dataset
            if dataset is None or dataset.file_path != file_path:
                return
            current_primary = self._current_primary_section()
            current_secondary = self._current_secondary_section()
            if current_primary != "DDA":
                return
            if current_secondary == "Batch":
                self._refresh_batch_candidates()
                self._refresh_batch_results()
            elif current_secondary == "DDA":
                self._ensure_cached_dda_result_loaded(
                    defer_view_render=True,
                    refresh_auxiliary_views=False,
                )
            elif current_secondary == "ICA":
                self._ensure_cached_ica_result_loaded()
            elif current_secondary == "Connectivity":
                self._refresh_connectivity_sources()
                self._refresh_connectivity_view()
            elif current_secondary == "Compare":
                self._refresh_compare_sources()
                self._refresh_compare_view()

        QTimer.singleShot(220, restore_when_idle)

    def _load_saved_dataset_state_async(
        self,
        file_path: str,
        request_serial: int,
    ) -> None:
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                annotations = temp_db.load_annotations_for_file(file_path)
                dda_history_summaries = temp_db.load_dda_history_summaries(file_path)
            finally:
                temp_db.close()
            return {
                "file_path": file_path,
                "annotations": annotations,
                "dda_history_summaries": dda_history_summaries,
            }

        def on_success(result: object) -> None:
            if request_serial != self._dataset_request_serial:
                return
            dataset = self.state.selected_dataset
            if dataset is None or dataset.file_path != file_path:
                return
            payload = result if isinstance(result, dict) else {}
            annotations = list(payload.get("annotations") or [])
            dda_history_summaries = list(payload.get("dda_history_summaries") or [])
            self.state.annotations_by_file[file_path] = annotations
            self.state.dda_history_summaries = dda_history_summaries
            self.state.dda_history = []
            self.state.dda_result = None
            self.state.ica_result = None
            selected_history_id = self.state.selected_results_history_id
            valid_history_ids = {item.id for item in dda_history_summaries}
            if not selected_history_id or selected_history_id not in valid_history_ids:
                self.state.selected_results_history_id = (
                    dda_history_summaries[0].id if dda_history_summaries else None
                )
            self._refresh_annotations_table()
            self._update_annotation_scope_label()
            self._apply_annotations_to_views()
            self._refresh_results_page()
            current_primary = self._current_primary_section()
            current_secondary = self._current_secondary_section()
            if current_primary == "DDA":
                if current_secondary == "Batch":
                    self._refresh_batch_candidates()
                    self._refresh_batch_results()
                elif current_secondary == "Connectivity":
                    self._refresh_connectivity_sources()
                elif current_secondary == "Compare":
                    self._refresh_compare_sources()
            self._schedule_startup_analysis_restore(
                file_path,
                request_serial,
                current_primary,
                current_secondary,
            )

        def on_error(message: str) -> None:
            if request_serial != self._dataset_request_serial:
                return
            self.status_bar.showMessage(
                f"Saved state load failed: {message}",
                5000,
            )
            self._refresh_results_page()
            self._refresh_visible_analysis_subviews()

        self._run_task(task, on_success, on_error)

    def _select_file_tab(self, path: str) -> None:
        for index in range(self.file_tabs.count()):
            if self.file_tabs.tabData(index) == path:
                self.file_tabs.setCurrentIndex(index)
                self._sync_file_tab_bar()
                break

    def _open_file_tab_context_menu(self, position: QPoint) -> None:
        index = self.file_tabs.tabAt(position)
        if index < 0:
            return
        path = self.file_tabs.tabData(index)
        if not isinstance(path, str):
            return
        is_pinned = self._is_pinned_file(path)
        menu = QMenu(self.file_tabs)
        pin_action = menu.addAction("Unpin Tab" if is_pinned else "Pin Tab")
        browse_action = menu.addAction("Open Containing Folder")
        reveal_action = menu.addAction(_system_reveal_label())
        copy_action = menu.addAction("Copy Path")
        menu.addSeparator()
        close_action = menu.addAction("Close")
        close_others_action = menu.addAction("Close Others")
        close_left_action = menu.addAction("Close Tabs to the Left")
        close_right_action = menu.addAction("Close Tabs to the Right")
        close_others_action.setEnabled(self.file_tabs.count() > 1)
        close_left_action.setEnabled(index > 0)
        close_right_action.setEnabled(index < self.file_tabs.count() - 1)
        chosen = menu.exec(self.file_tabs.mapToGlobal(position))
        if chosen is pin_action:
            self._toggle_file_tab_pin(path)
        elif chosen is browse_action:
            self._refresh_browser(str(Path(path).parent))
        elif chosen is reveal_action:
            self._reveal_path_in_system(path)
        elif chosen is copy_action:
            self._copy_text_to_clipboard(path, "Path copied")
        elif chosen is close_action:
            self._close_file_tab(index)
        elif chosen is close_others_action:
            self._close_other_tabs_for_path(path)
        elif chosen is close_left_action:
            self._close_tabs_to_side(index, direction="left")
        elif chosen is close_right_action:
            self._close_tabs_to_side(index, direction="right")

    def _on_tab_changed(self, index: int) -> None:
        if index < 0:
            return
        self._sync_file_tab_bar()
        path = self.file_tabs.tabData(index)
        if self._restoring_session:
            return
        if path and path != self.state.active_file_path:
            self._open_dataset(path)

    def _close_file_tab(self, index: int) -> None:
        path = self.file_tabs.tabData(index)
        with QSignalBlocker(self.file_tabs):
            self.file_tabs.removeTab(index)
        if path in self.state.open_files:
            self.state.open_files.remove(path)
        if path in self.state.pinned_file_paths:
            self.state.pinned_file_paths = [
                value for value in self.state.pinned_file_paths if value != path
            ]
        if self.file_tabs.count() == 0:
            self._stop_streaming()
            self.state.active_file_path = None
            self.state.selected_dataset = None
            self.state.pinned_file_paths = []
            self._update_dataset_ui()
            self._sync_file_tab_bar()
            self._schedule_session_save()
            return
        if path == self.state.active_file_path:
            next_path = self.file_tabs.tabData(
                max(0, min(index, self.file_tabs.count() - 1))
            )
            if next_path:
                self._open_dataset(next_path)
        self._refresh_file_tab_labels()
        self._sync_file_tab_bar()
        self._schedule_session_save()

    def _on_primary_nav_changed(self, index: int) -> None:
        section = self.primary_sections[index]
        self.primary_stack.setCurrentWidget(self.page_registry[section])
        self._rebuild_secondary_nav(section)
        if section == "Data":
            self._load_openneuro()
        elif section == "DDA":
            current_tab = self._current_secondary_section()
            if current_tab == "DDA":
                self._ensure_cached_dda_result_loaded()
            elif current_tab == "ICA":
                self._ensure_cached_ica_result_loaded()
        elif section == "Collaborate":
            self._refresh_results_page()
            self._refresh_workflow_table()
            self._update_workflow_ui()
        elif section == "Notifications":
            self._refresh_notifications_table()
        self._schedule_session_save()

    def _switch_primary_section(
        self, index: int, *, secondary_index: Optional[int] = 0
    ) -> None:
        if not hasattr(self, "primary_nav"):
            return
        if index < 0 or index >= len(self.primary_sections):
            return
        with QSignalBlocker(self.primary_nav):
            self.primary_nav.setCurrentIndex(index)
        self._on_primary_nav_changed(index)
        if secondary_index is not None:
            self._switch_secondary_section(secondary_index)

    def _rebuild_secondary_nav(self, section: str) -> None:
        with QSignalBlocker(self.secondary_nav):
            while self.secondary_nav.count() > 0:
                self.secondary_nav.removeTab(0)
            tabs = self.secondary_sections.get(section, [])
            if not tabs:
                self.secondary_nav.hide()
                return
            for label in tabs:
                self.secondary_nav.addTab(label)
            self.secondary_nav.setCurrentIndex(0)
            self.secondary_nav.show()

    def _switch_secondary_section(self, index: int) -> None:
        if not hasattr(self, "secondary_nav"):
            return
        if self.secondary_nav.count() <= 0:
            return
        if index < 0 or index >= self.secondary_nav.count():
            return
        with QSignalBlocker(self.secondary_nav):
            self.secondary_nav.setCurrentIndex(index)
        self._on_secondary_nav_changed(index)

    def _on_secondary_nav_changed(self, index: int) -> None:
        section = self.primary_sections[self.primary_nav.currentIndex()]
        tabs = self.secondary_sections.get(section, [])
        if not tabs:
            return
        tab = tabs[index]
        if section == "DDA":
            if hasattr(self, "analyze_stack"):
                self.analyze_stack.setCurrentIndex(
                    {
                        "DDA": 0,
                        "ICA": 1,
                        "Batch": 2,
                        "Connectivity": 3,
                        "Compare": 4,
                    }.get(tab, 0)
                )
            if tab == "DDA":
                self._ensure_cached_dda_result_loaded()
            elif tab == "ICA":
                self._ensure_cached_ica_result_loaded()
                self._update_ica_channel_summary()
            elif tab == "Batch":
                self._refresh_batch_candidates()
                self._refresh_batch_results()
            elif tab == "Connectivity":
                self._refresh_connectivity_sources()
                self._refresh_connectivity_view()
            elif tab == "Compare":
                self._refresh_compare_sources()
                self._refresh_compare_view()
        elif section == "Visualize":
            if hasattr(self, "visualize_stack"):
                self.visualize_stack.setCurrentIndex(
                    {"Time Series": 0, "Annotations": 1, "Streaming": 2}.get(tab, 0)
                )
            self._update_annotation_scope_label()
            self._update_streaming_ui()
        elif section == "Data":
            if hasattr(self, "data_stack"):
                self.data_stack.setCurrentIndex({"OpenNeuro": 0}.get(tab, 0))
            if tab == "OpenNeuro":
                self._load_openneuro()
        elif section == "Collaborate":
            if hasattr(self, "collaborate_stack"):
                self.collaborate_stack.setCurrentIndex(
                    {"Results": 0, "Workflow": 1}.get(tab, 0)
                )
            self._refresh_results_page()
            self._refresh_workflow_table()
            self._update_workflow_ui()
        elif section == "Learn":
            if hasattr(self, "learn_stack"):
                self.learn_stack.setCurrentIndex(
                    {"Tutorials": 0, "Files": 1, "Reference": 2}.get(tab, 0)
                )
        self._schedule_session_save()

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _notify(
        self,
        category: str,
        level: str,
        title: str,
        message: str,
        *,
        show_status: bool = True,
    ) -> None:
        entry = NotificationEntry(
            id=uuid.uuid4().hex,
            category=category,
            level=level,
            title=title,
            message=message,
            created_at_iso=self._now_iso(),
        )
        self.state.notifications.insert(0, entry)
        self.state.notifications = self.state.notifications[:250]
        self.state_db.replace_notifications(self.state.notifications)
        self._refresh_notifications_table()
        if show_status:
            self.status_bar.showMessage(f"{title}: {message}", 4000)

    def _record_workflow_action(
        self,
        action_type: str,
        description: str,
        payload: Optional[Dict[str, str]] = None,
        file_path: Optional[str] = None,
    ) -> None:
        if not self.state.workflow_recording_enabled:
            return
        self.state.workflow_actions.append(
            WorkflowActionEntry(
                id=uuid.uuid4().hex,
                action_type=action_type,
                description=description,
                created_at_iso=self._now_iso(),
                file_path=file_path or self.state.active_file_path,
                payload=payload or {},
            )
        )
        self.state_db.replace_workflow_actions(self.state.workflow_actions)
        self._refresh_workflow_table()
        self._update_workflow_ui()

    def _refresh_notifications_table(self) -> None:
        if not hasattr(self, "notifications_table"):
            return
        entries = self.state.notifications
        self.notifications_table.setRowCount(len(entries))
        for row, entry in enumerate(entries):
            values = [
                entry.created_at_iso.replace("T", " ").replace("+00:00", "Z"),
                entry.category,
                entry.level.upper(),
                entry.title,
                entry.message,
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                self.notifications_table.setItem(row, column, item)
        self.notifications_table.resizeColumnsToContents()

    def _refresh_workflow_table(self) -> None:
        if not hasattr(self, "workflow_table"):
            return
        actions = self.state.workflow_actions
        self.workflow_table.setRowCount(len(actions))
        for row, action in enumerate(actions):
            values = [
                action.created_at_iso.replace("T", " ").replace("+00:00", "Z"),
                action.action_type,
                action.description,
                action.file_path or "—",
            ]
            for column, value in enumerate(values):
                item = QTableWidgetItem(value)
                self.workflow_table.setItem(row, column, item)
        self.workflow_table.resizeColumnsToContents()

    def _update_workflow_ui(self) -> None:
        if not hasattr(self, "workflow_status_label"):
            return
        status = "Recording" if self.state.workflow_recording_enabled else "Idle"
        action_count = len(self.state.workflow_actions)
        self.workflow_status_label.setText(
            f"{status} • {action_count} recorded action{'s' if action_count != 1 else ''}"
        )
        self.start_workflow_button.setEnabled(not self.state.workflow_recording_enabled)
        self.stop_workflow_button.setEnabled(self.state.workflow_recording_enabled)
        self.clear_workflow_button.setEnabled(bool(self.state.workflow_actions))
        self.export_workflow_button.setEnabled(bool(self.state.workflow_actions))

    def _refresh_results_page(self) -> None:
        if not hasattr(self, "results_details"):
            return
        self._refresh_results_history_table()
        self._refresh_results_details()

    def _dda_result_to_summary(self, result: DdaResult) -> DdaResultSummary:
        return DdaResultSummary(
            id=result.id,
            file_path=result.file_path,
            file_name=result.file_name,
            created_at_iso=result.created_at_iso,
            engine_label=result.engine_label,
            variant_ids=[variant.id for variant in result.variants],
            is_fallback=result.is_fallback,
        )

    def _cache_dda_result(self, result: DdaResult) -> None:
        self.state.dda_history = [result] + [
            item for item in self.state.dda_history if item.id != result.id
        ]
        self.state.dda_history.sort(key=lambda item: item.created_at_iso, reverse=True)
        self.state.dda_history = self.state.dda_history[:10]

    def _upsert_dda_history_summary(self, summary: DdaResultSummary) -> None:
        self.state.dda_history_summaries = [summary] + [
            item
            for item in self.state.dda_history_summaries
            if item.id != summary.id
        ]
        self.state.dda_history_summaries.sort(
            key=lambda item: item.created_at_iso, reverse=True
        )
        self.state.dda_history_summaries = self.state.dda_history_summaries[:30]

    def _remember_dda_result(self, result: DdaResult, *, persist: bool = True) -> None:
        self._cache_dda_result(result)
        self._upsert_dda_history_summary(self._dda_result_to_summary(result))
        if persist:
            self._persist_dda_result_async(result)

    def _persist_dda_result_async(self, result: DdaResult) -> None:
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                temp_db.save_dda_result(result)
            finally:
                temp_db.close()
            return None

        self._run_task(
            task,
            lambda _result: None,
            lambda message: self.status_bar.showMessage(
                f"Could not persist DDA result: {message}",
                5000,
            ),
        )

    def _load_dda_result_from_history_async(
        self,
        result_id: Optional[str],
        on_success: Callable[[Optional[DdaResult]], None],
    ) -> None:
        if not result_id:
            on_success(None)
            return
        cached = self._cached_history_result(result_id)
        if cached is not None and cached.id == result_id:
            on_success(cached)
            return
        pending_callbacks = self._pending_dda_result_load_callbacks.get(result_id)
        if pending_callbacks is not None:
            pending_callbacks.append(on_success)
            return
        self._pending_dda_result_load_callbacks[result_id] = [on_success]
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                return temp_db.load_dda_result_by_id(result_id)
            finally:
                temp_db.close()

        def handle_success(result: object) -> None:
            callbacks = self._pending_dda_result_load_callbacks.pop(result_id, [])
            loaded = result if isinstance(result, DdaResult) else None
            if loaded is not None:
                self._cache_dda_result(loaded)
            for callback in callbacks:
                callback(loaded)

        def handle_error(message: str) -> None:
            callbacks = self._pending_dda_result_load_callbacks.pop(result_id, [])
            self.status_bar.showMessage(f"Saved DDA load failed: {message}", 5000)
            for callback in callbacks:
                callback(None)

        self._run_task(task, handle_success, handle_error)

    def _load_latest_ica_result_async(
        self,
        file_path: str,
        on_success: Callable[[Optional[IcaResult]], None],
    ) -> None:
        if self._pending_ica_result_load_file_path == file_path:
            return
        self._pending_ica_result_load_file_path = file_path
        db_path = self.state_db.db_path

        def task() -> object:
            temp_db = StateDatabase(db_path)
            try:
                return temp_db.load_latest_ica_result(file_path)
            finally:
                temp_db.close()

        def handle_success(result: object) -> None:
            if self._pending_ica_result_load_file_path == file_path:
                self._pending_ica_result_load_file_path = None
            on_success(result if isinstance(result, IcaResult) else None)

        def handle_error(message: str) -> None:
            if self._pending_ica_result_load_file_path == file_path:
                self._pending_ica_result_load_file_path = None
            self.status_bar.showMessage(f"Saved ICA load failed: {message}", 5000)
            on_success(None)

        self._run_task(task, handle_success, handle_error)

    def _selected_history_summary(self) -> Optional[DdaResultSummary]:
        target_id = self.state.selected_results_history_id
        if target_id:
            for summary in self.state.dda_history_summaries:
                if summary.id == target_id:
                    return summary
        if self.state.dda_result is not None:
            return self._dda_result_to_summary(self.state.dda_result)
        if self.state.dda_history_summaries:
            return self.state.dda_history_summaries[0]
        return None

    def _cached_history_result(self, result_id: Optional[str] = None) -> Optional[DdaResult]:
        target_id = result_id or self.state.selected_results_history_id
        if target_id and self.state.dda_result is not None and self.state.dda_result.id == target_id:
            return self.state.dda_result
        if target_id:
            for result in self.state.dda_history:
                if result.id == target_id:
                    return result
        if self.state.dda_result is not None:
            return self.state.dda_result
        if self.state.dda_history:
            return self.state.dda_history[0]
        return None

    def _schedule_deferred_startup_dda_render(
        self,
        expected_result_id: Optional[str],
        *,
        delay_ms: int = 280,
    ) -> None:
        restore_serial = self._startup_analysis_restore_serial

        def render_when_idle() -> None:
            if restore_serial != self._startup_analysis_restore_serial:
                return
            if self._current_primary_section() != "DDA":
                return
            if self._current_secondary_section() != "DDA":
                return
            result = self.state.dda_result
            if result is None:
                return
            if expected_result_id and result.id != expected_result_id:
                return
            self._update_variant_view()

        QTimer.singleShot(max(int(delay_ms), 0), render_when_idle)

    def _ensure_cached_dda_result_loaded(
        self,
        *,
        defer_view_render: bool = False,
        refresh_auxiliary_views: bool = True,
    ) -> None:
        if self.state.dda_result is not None:
            if (
                self._current_primary_section() == "DDA"
                and self._current_secondary_section() == "DDA"
            ):
                if defer_view_render:
                    self._schedule_deferred_startup_dda_render(
                        self.state.dda_result.id
                    )
                else:
                    self._update_variant_view()
            return
        target_id = self.state.selected_results_history_id
        if not target_id and self.state.dda_history_summaries:
            target_id = self.state.dda_history_summaries[0].id
        if not target_id:
            return
        cached = self._cached_history_result(target_id)
        if cached is not None and cached.id == target_id:
            self._apply_dda_result(
                cached,
                persist=False,
                render_variant_view=not defer_view_render,
                refresh_auxiliary_views=refresh_auxiliary_views,
            )
            if defer_view_render:
                self._schedule_deferred_startup_dda_render(cached.id)
            return
        if hasattr(self, "dda_diagnostics"):
            self.dda_diagnostics.setPlainText("Loading saved DDA result…")
        if hasattr(self, "result_summary"):
            self.result_summary.setPlainText("Loading saved DDA result…")

        def on_success(result: Optional[DdaResult]) -> None:
            if result is None:
                return
            if self.state.selected_results_history_id and self.state.selected_results_history_id != result.id:
                return
            if self._current_primary_section() == "DDA" and self._current_secondary_section() == "DDA":
                self._apply_dda_result(
                    result,
                    persist=False,
                    render_variant_view=not defer_view_render,
                    refresh_auxiliary_views=refresh_auxiliary_views,
                )
                if defer_view_render:
                    self._schedule_deferred_startup_dda_render(result.id)

        self._load_dda_result_from_history_async(target_id, on_success)

    def _ensure_cached_ica_result_loaded(self) -> None:
        if self.state.ica_result is not None:
            return
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        if hasattr(self, "ica_diagnostics"):
            self.ica_diagnostics.setPlainText("Loading saved ICA result…")

        def on_success(result: Optional[IcaResult]) -> None:
            if result is None:
                return
            current_dataset = self.state.selected_dataset
            if current_dataset is None or current_dataset.file_path != dataset.file_path:
                return
            if self._current_primary_section() == "DDA" and self._current_secondary_section() == "ICA":
                self._apply_ica_result(result, persist=False)

        self._load_latest_ica_result_async(dataset.file_path, on_success)

    def _refresh_results_history_table(self) -> None:
        tables = [
            table
            for table_name in ("results_history_table", "dda_history_table")
            if (table := getattr(self, table_name, None)) is not None
        ]
        if not tables:
            return
        history = list(self.state.dda_history_summaries)
        if not history:
            self.state.selected_results_history_id = None
        selected_id = self.state.selected_results_history_id
        if selected_id is None and self.state.dda_result is not None:
            selected_id = self.state.dda_result.id
        if selected_id is None and history:
            selected_id = history[0].id
            self.state.selected_results_history_id = selected_id

        for table in tables:
            with QSignalBlocker(table):
                table.setRowCount(len(history))
                selected_row = -1
                for row, result in enumerate(history):
                    values = [
                        result.created_at_iso.replace("T", " "),
                        ", ".join(result.variant_ids) or "—",
                        result.engine_label or "—",
                        result.id,
                    ]
                    for column, value in enumerate(values):
                        item = QTableWidgetItem(value)
                        if column == 0:
                            item.setData(Qt.UserRole, result.id)
                            item.setToolTip(
                                f"{result.file_name}\n{result.created_at_iso}\n{result.engine_label}"
                            )
                        table.setItem(row, column, item)
                    if result.id == selected_id:
                        selected_row = row
                if selected_row >= 0:
                    table.selectRow(selected_row)
                else:
                    table.clearSelection()

        status_text = (
            f"{len(history)} saved analysis result{'s' if len(history) != 1 else ''} "
            f"for {history[0].file_name}"
            if history
            else "No saved analyses for this file yet."
        )
        if hasattr(self, "results_history_status_label"):
            self.results_history_status_label.setText(status_text)
        if hasattr(self, "dda_history_status_label"):
            self.dda_history_status_label.setText(status_text)

    def _selected_history_result(self) -> Optional[DdaResult]:
        target_id = self.state.selected_results_history_id
        if target_id:
            cached = self._cached_history_result(target_id)
            if cached is not None and cached.id == target_id:
                return cached
            return None
        if self.state.dda_result is not None:
            return self.state.dda_result
        if self.state.dda_history:
            return self.state.dda_history[0]
        return None

    def _refresh_visible_analysis_subviews(self) -> None:
        current_primary = self._current_primary_section()
        current_secondary = self._current_secondary_section()
        if current_primary != "DDA":
            return
        if current_secondary == "Batch":
            self._refresh_batch_candidates()
            self._refresh_batch_results()
        elif current_secondary == "Connectivity":
            self._refresh_connectivity_sources()
            self._refresh_connectivity_view()
        elif current_secondary == "Compare":
            self._refresh_compare_sources()
            self._refresh_compare_view()

    def _on_results_history_selection_changed(self) -> None:
        source_table = self.sender()
        if source_table is None or not hasattr(source_table, "selectionModel"):
            return
        selected_rows = source_table.selectionModel().selectedRows()
        if selected_rows:
            item = source_table.item(selected_rows[0].row(), 0)
            result_id = item.data(Qt.UserRole) if item is not None else None
            self.state.selected_results_history_id = (
                str(result_id) if result_id else None
            )
            for table_name in ("results_history_table", "dda_history_table"):
                table = getattr(self, table_name, None)
                if table is None or table is source_table:
                    continue
                with QSignalBlocker(table):
                    if selected_rows[0].row() < table.rowCount():
                        table.selectRow(selected_rows[0].row())
            if isinstance(self.state.selected_results_history_id, str):
                self._load_dda_result_from_history_async(
                    self.state.selected_results_history_id,
                    lambda _result: None,
                )
        self._refresh_results_details()

    def _view_selected_history_result(self, *_args) -> None:
        target_id = self.state.selected_results_history_id
        if not target_id and self.state.dda_history_summaries:
            target_id = self.state.dda_history_summaries[0].id
        if not target_id:
            return
        cached = self._cached_history_result(target_id)
        if cached is not None and cached.id == target_id:
            self.state.selected_results_history_id = cached.id
            self._apply_dda_result(cached, persist=False)
            if "DDA" in self.primary_sections:
                dda_index = self.primary_sections.index("DDA")
                self._switch_primary_section(dda_index)
            return
        self.status_bar.showMessage("Loading saved DDA result…", 3000)

        def on_success(result: Optional[DdaResult]) -> None:
            if result is None:
                self.status_bar.showMessage("Saved DDA result is unavailable.", 5000)
                return
            current_target_id = self.state.selected_results_history_id
            if current_target_id and current_target_id != result.id:
                return
            self.state.selected_results_history_id = result.id
            self._apply_dda_result(result, persist=False)
            if "DDA" in self.primary_sections:
                dda_index = self.primary_sections.index("DDA")
                self._switch_primary_section(dda_index)

        self._load_dda_result_from_history_async(target_id, on_success)

    def _refresh_results_details(self) -> None:
        dataset = self.state.selected_dataset
        result_summary = self._selected_history_summary()
        ica_result = self.state.ica_result
        annotation_count = (
            len(self._current_annotations()) if self.state.active_file_path else 0
        )
        if dataset is None and result_summary is None and ica_result is None:
            self.results_summary_label.setText(
                "Run DDA or import a portable .ddalab file."
            )
            self.results_details.setPlainText("")
        else:
            lines = []
            if dataset is not None:
                lines.extend(
                    [
                        f"Dataset: {dataset.file_name}",
                        f"Format: {dataset.format_label}",
                        f"Channels: {len(dataset.channels)}",
                        f"Duration: {dataset.duration_seconds:.3f}s",
                        f"Annotations: {annotation_count}",
                    ]
                )
            if result_summary is not None:
                lines.extend(
                    [
                        f"Result ID: {result_summary.id}",
                        f"Engine: {result_summary.engine_label}",
                        f"Created: {result_summary.created_at_iso}",
                        f"Variants: {', '.join(result_summary.variant_ids)}",
                    ]
                )
            if ica_result is not None:
                lines.extend(
                    [
                        f"ICA Result ID: {ica_result.id}",
                        f"ICA Channels: {len(ica_result.channel_names)}",
                        f"ICA Components: {len(ica_result.components)}",
                        f"ICA Created: {ica_result.created_at_iso}",
                    ]
                )
            self.results_summary_label.setText(
                "Current file state, DDA output, and portable .ddalab exports."
            )
            self.results_details.setPlainText("\n".join(lines))
        has_result = result_summary is not None
        has_dataset = dataset is not None
        has_exportable_state = has_dataset or has_result or ica_result is not None
        for widget_name in ("view_history_result_button", "dda_view_history_result_button"):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.setEnabled(has_result)
        for widget_name in ("snapshot_export_button", "dda_snapshot_export_button"):
            widget = getattr(self, widget_name, None)
            if widget is not None:
                widget.setEnabled(has_exportable_state)
        results_more_exports = getattr(self, "data_export_button", None)
        if results_more_exports is not None:
            results_more_exports.setEnabled(has_exportable_state or annotation_count > 0)
        dda_more_exports = getattr(self, "dda_data_export_button", None)
        if dda_more_exports is not None:
            dda_more_exports.setEnabled(has_exportable_state)
        import_buttons = [
            getattr(self, widget_name, None)
            for widget_name in ("import_snapshot_button", "dda_import_snapshot_button")
        ]
        for button in import_buttons:
            if button is not None:
                button.setEnabled(True)

        result_action_keys = (
            "result_json",
            "selected_csv",
            "all_csv",
            "python_script",
            "matlab_script",
            "julia_script",
            "rust_source",
            "heatmap_png",
            "heatmap_svg",
            "heatmap_pdf",
            "lineplot_png",
            "lineplot_svg",
            "lineplot_pdf",
        )

        def set_action_state(actions_attr: str, keys: tuple[str, ...], enabled: bool) -> None:
            actions = getattr(self, actions_attr, None)
            if not isinstance(actions, dict):
                return
            for key in keys:
                action = actions.get(key)
                if action is not None:
                    action.setEnabled(enabled)

        set_action_state("results_more_export_actions", ("recipe_ddalab",), has_exportable_state)
        set_action_state("dda_more_export_actions", ("recipe_ddalab",), has_exportable_state)
        set_action_state("results_more_export_actions", result_action_keys, has_result)
        set_action_state("dda_more_export_actions", result_action_keys, has_result)
        set_action_state(
            "results_more_export_actions",
            ("annotations",),
            has_dataset and annotation_count > 0,
        )

    def _workflow_payload(self) -> dict:
        return {
            "name": (
                f"{Path(self.state.active_file_path).name} workflow"
                if self.state.active_file_path
                else "DDALAB workflow"
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
        end_text = self.dda_end_edit.text().strip()
        try:
            delays = self._parse_dda_delay_values()
        except ValueError:
            delays = self._safe_dda_delay_values()
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
            "startTimeSeconds": float(self.dda_start_edit.text() or "0"),
            "endTimeSeconds": float(end_text) if end_text else None,
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
        self.state.selected_results_history_id = result.id if result is not None else None
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
                and self._current_primary_section() == "DDA"
                and self._current_secondary_section() == "DDA"
            ):
                self._update_variant_view()
            elif (
                self._current_primary_section() == "DDA"
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
            if current_primary == "DDA" and current_secondary == "Connectivity":
                self._refresh_connectivity_view()
            if current_primary == "DDA" and current_secondary == "Compare":
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
            self.state.selected_channel_names = dataset.channel_names[: min(8, len(dataset.channel_names))]
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
                if not self._server_url and not Path(value).exists():
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
            if self._server_url or Path(target_file).exists():
                self._pending_snapshot_restore = payload
                self._open_dataset(target_file)
                return
            self._notify(
                "snapshot",
                "error",
                "Snapshot Source Missing",
                f"Could not reopen {target_file}. Restored exports and annotations only.",
            )
        self._refresh_results_page()

    def _show_error(self, message: str) -> None:
        self._notify("system", "error", "Error", message, show_status=False)
        QMessageBox.critical(self, "DDALAB Qt", message)

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


def _human_bytes(size_bytes: Optional[int]) -> str:
    if not size_bytes:
        return "—"
    value = float(size_bytes)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024.0 or unit == "TB":
            if unit == "B":
                return f"{int(value)} {unit}"
            return f"{value:.1f} {unit}"
        value /= 1024.0
    return f"{size_bytes} B"


def _system_reveal_label() -> str:
    if sys.platform == "darwin":
        return "Reveal in Finder"
    if sys.platform.startswith("win"):
        return "Show in Explorer"
    return "Show in Folder"


def _mean_absolute(values: List[float]) -> float:
    if not values:
        return 0.0
    finite = [abs(float(value)) for value in values if math.isfinite(float(value))]
    if not finite:
        return 0.0
    return sum(finite) / len(finite)


def _variant_mean_absolute(variant: DdaVariantResult) -> float:
    if variant.row_mean_absolute:
        finite = [
            float(value)
            for value in variant.row_mean_absolute
            if math.isfinite(float(value))
        ]
        if finite:
            return sum(finite) / len(finite)
        return 0.0
    return _mean_absolute([value for row in variant.matrix for value in row])


def _build_connectivity_metrics(variant: DdaVariantResult) -> List[dict]:
    metrics: List[dict] = []
    for index, label in enumerate(variant.row_labels):
        row = variant.matrix[index] if index < len(variant.matrix) else []
        if not row:
            continue
        metrics.append(
            {
                "label": label,
                "mean_absolute": variant.row_mean_absolute_value(index),
                "peak_absolute": variant.row_peak_absolute_value(index),
            }
        )
    return sorted(metrics, key=lambda item: item["mean_absolute"], reverse=True)


def _row_mean_abs_map(variant: DdaVariantResult) -> Dict[str, float]:
    values: Dict[str, float] = {}
    for index, label in enumerate(variant.row_labels):
        values[label] = variant.row_mean_absolute_value(index)
    return values


def _build_variant_comparisons(baseline: DdaResult, target: DdaResult) -> List[dict]:
    baseline_by_id = {variant.id: variant for variant in baseline.variants}
    target_by_id = {variant.id: variant for variant in target.variants}
    comparisons: List[dict] = []
    for variant_id in sorted(set(baseline_by_id) & set(target_by_id)):
        baseline_variant = baseline_by_id[variant_id]
        target_variant = target_by_id[variant_id]
        baseline_rows = _row_mean_abs_map(baseline_variant)
        target_rows = _row_mean_abs_map(target_variant)
        shared_rows = set(baseline_rows) & set(target_rows)
        top_changed_row = None
        if shared_rows:
            top_changed_row = max(
                shared_rows,
                key=lambda label: abs(target_rows[label] - baseline_rows[label]),
            )
        baseline_mean = _variant_mean_absolute(baseline_variant)
        target_mean = _variant_mean_absolute(target_variant)
        comparisons.append(
            {
                "variant_id": variant_id,
                "baseline_mean_abs": baseline_mean,
                "target_mean_abs": target_mean,
                "delta": target_mean - baseline_mean,
                "shared_row_count": len(shared_rows),
                "top_changed_row": top_changed_row,
            }
        )
    return comparisons
