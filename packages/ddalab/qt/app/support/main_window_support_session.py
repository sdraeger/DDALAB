from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable, List, Optional

from PySide6.QtCore import (
    QByteArray,
    QSignalBlocker,
    Qt,
    QTimer,
)
from PySide6.QtWidgets import (
    QApplication,
    QMessageBox,
)

from ...ui.style import apply_theme, normalize_theme_mode
from ...update_manager import AvailableUpdate, UpdateDownloadProgress
from ..core.navigation import normalize_navigation

from .main_window_support_helpers import (
    _plot_layer_config_from_payload,
    _plot_layer_payload,
)


class MainWindowSupportSessionMixin:
    def _refresh_settings_overview(self) -> None:
        if hasattr(self, "settings_backend_summary_value"):
            self.settings_backend_summary_value.setText("Local")
            self.settings_backend_summary_caption.setText(
                "Bundled backend on this device"
            )
            if hasattr(self, "settings_backend_hint_label"):
                self.settings_backend_hint_label.setText(
                    "DDALAB uses the bundled local backend."
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
            "Checking…" if self._update_check_in_progress else "Check for Updates"
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
        release_line = f"Release tag: {update.tag_name}\n" if update.tag_name else ""
        published_line = (
            f"Published: {update.published_at_iso}\n" if update.published_at_iso else ""
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
            "plotLayers": self._current_plot_layers_payload(),
            "windowGeometry": bytes(self.saveGeometry().toBase64()).decode("ascii"),
            "windowMaximized": self.isMaximized(),
            "ddaColorScheme": self.heatmap_color_scheme_combo.currentData(),
            "themeMode": self.state.theme_mode,
            "expertMode": self.state.expert_mode,
        }

    def _current_plot_layers_payload(self) -> dict:
        waveform_layers = self._current_waveform_plot_layers()
        result_layers = self._current_result_plot_layers()
        return {
            "waveform": _plot_layer_payload(
                waveform_layers,
                ("waveform", "annotations"),
            ),
            "results": _plot_layer_payload(
                result_layers,
                ("heatmap", "line", "annotations", "cursor"),
            ),
        }

    def _apply_plot_layers_payload(self, payload: object) -> None:
        if not isinstance(payload, dict):
            return
        waveform_payload = payload.get("waveform")
        if isinstance(waveform_payload, dict):
            waveform_layers = _plot_layer_config_from_payload(
                waveform_payload,
                ("waveform", "annotations"),
            )
            self._set_plot_layer_checkboxes(
                {
                    "waveform_layer_waveform_checkbox": waveform_layers.waveform,
                    "waveform_layer_annotations_checkbox": waveform_layers.annotations,
                }
            )
            self._apply_waveform_plot_layers(waveform_layers, schedule_save=False)
        result_payload = payload.get("results")
        if isinstance(result_payload, dict):
            result_layers = _plot_layer_config_from_payload(
                result_payload,
                ("heatmap", "line", "annotations", "cursor"),
            )
            self._set_plot_layer_checkboxes(
                {
                    "result_layer_heatmap_checkbox": result_layers.heatmap,
                    "result_layer_line_checkbox": result_layers.line,
                    "result_layer_annotations_checkbox": result_layers.annotations,
                    "result_layer_cursor_checkbox": result_layers.cursor,
                }
            )
            self._apply_result_plot_layers(result_layers, schedule_save=False)

    def _set_plot_layer_checkboxes(self, values: dict[str, bool]) -> None:
        for name, checked in values.items():
            checkbox = getattr(self, name, None)
            if checkbox is None or not hasattr(checkbox, "setChecked"):
                continue
            try:
                with QSignalBlocker(checkbox):
                    checkbox.setChecked(bool(checked))
            except TypeError:
                checkbox.setChecked(bool(checked))

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
            if not Path(raw_path).exists():
                continue
            seen.add(raw_path)
            restored_paths.append(raw_path)
        if (
            isinstance(active_file, str)
            and active_file
            and active_file not in seen
            and Path(active_file).exists()
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
            if Path(saved_browser_path).exists():
                return saved_browser_path
        return default_path

    def _apply_primary_secondary_view_state(
        self,
        primary_section: str,
        secondary_section: Optional[str],
    ) -> None:
        primary_section, secondary_section = normalize_navigation(
            primary_section,
            secondary_section,
        )
        if hasattr(self, "primary_stack") and primary_section in self.page_registry:
            self.primary_stack.setCurrentWidget(self.page_registry[primary_section])
        self._rebuild_secondary_nav(primary_section)
        if secondary_section is None:
            return
        tabs = self.secondary_sections.get(primary_section, [])
        secondary_index = tabs.index(secondary_section)
        with QSignalBlocker(self.secondary_nav):
            self.secondary_nav.setCurrentIndex(secondary_index)
        if primary_section == "Run DDA" and hasattr(self, "analyze_stack"):
            self.analyze_stack.setCurrentIndex(
                {"DDA": 0, "ICA": 1, "Batch": 2, "Connectivity": 3, "Compare": 4}.get(
                    secondary_section, 0
                )
            )
        elif primary_section == "Workspace" and hasattr(self, "visualize_stack"):
            self.visualize_stack.setCurrentIndex(
                {"Inspect": 0, "Annotate": 1, "Replay": 2, "OpenNeuro": 3}.get(
                    secondary_section,
                    0,
                )
            )
        elif primary_section == "Results" and hasattr(self, "collaborate_stack"):
            self.collaborate_stack.setCurrentIndex(
                {"History": 0, "Action Log": 1, "Notifications": 2}.get(
                    secondary_section,
                    0,
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
        if "expertMode" in payload:
            self._apply_expert_mode(payload.get("expertMode"), schedule_save=False)
        self._apply_dda_config_payload(payload.get("ddaConfig"))
        self._apply_compare_config_payload(payload.get("compareConfig"))
        self._apply_plot_layers_payload(payload.get("plotLayers"))
        if hasattr(self, "viewport_label"):
            self.viewport_label.setText(
                f"{self.state.waveform_viewport_start_seconds:.2f}s → "
                f"{self.state.waveform_viewport_start_seconds + self.state.waveform_viewport_duration_seconds:.2f}s"
            )
        self._update_annotation_scope_label()
        self._update_streaming_ui()
        primary_section = payload.get("primarySection")
        secondary_section = payload.get("secondarySection")
        primary_section, secondary_section = normalize_navigation(
            primary_section,
            secondary_section,
        )
        if (
            isinstance(primary_section, str)
            and primary_section in self.primary_sections
        ):
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
        self._refresh_quick_plot_themes()
        self._refresh_settings_overview()
        self.dda_global_progress.update()
        self._refresh_file_tab_labels()
        self.update()
        self._schedule_session_save()

    def _refresh_quick_plot_themes(self) -> None:
        for name in ("quick_waveform_bridge", "quick_heatmap_bridge"):
            bridge = getattr(self, name, None)
            if bridge is not None and hasattr(bridge, "refresh_theme"):
                bridge.refresh_theme()
