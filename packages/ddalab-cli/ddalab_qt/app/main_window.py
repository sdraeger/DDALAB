from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from typing import Callable, Dict, List, Optional

from PySide6.QtWidgets import QApplication, QMainWindow, QMenu

from ..backend.api import (
    BackendClient,
    LocalBackendClient,
    OpenNeuroClient,
    RemoteBackendClient,
)
from ..domain.models import AppState, BrowserEntry, OpenNeuroDataset
from ..persistence.state_db import StateDatabase
from ..runtime_paths import RuntimePaths
from ..ui.style import apply_theme, normalize_theme_mode
from .main_window_analysis import MainWindowAnalysisMixin
from .main_window_integrations import MainWindowIntegrationsMixin
from .main_window_support import MainWindowSupportMixin
from .main_window_ui import MainWindowUiMixin
from .main_window_visualize import MainWindowVisualizeMixin


class MainWindow(
    MainWindowUiMixin,
    MainWindowSupportMixin,
    MainWindowVisualizeMixin,
    MainWindowAnalysisMixin,
    MainWindowIntegrationsMixin,
    QMainWindow,
):
    primary_sections = [
        "Overview",
        "Visualize",
        "DDA",
        "Data",
        "Learn",
        "Collaborate",
        "Settings",
        "Notifications",
    ]

    secondary_sections: Dict[str, List[str]] = {
        "Visualize": ["Time Series", "Annotations", "Streaming"],
        "DDA": ["DDA", "ICA", "Batch", "Connectivity", "Compare"],
        "Data": ["OpenNeuro"],
        "Learn": ["Tutorials", "Files", "Reference"],
        "Collaborate": ["Results", "Workflow"],
    }

    def __init__(
        self,
        runtime_paths: RuntimePaths,
        server_url: Optional[str],
        bootstrap_backend: bool = True,
    ) -> None:
        super().__init__()
        self.runtime_paths = runtime_paths
        self.repo_root = runtime_paths.browser_fallback_root()
        self.backend: BackendClient = (
            RemoteBackendClient(server_url)
            if server_url
            else LocalBackendClient(runtime_paths)
        )
        self.state_db = StateDatabase()
        self.state_db.migrate_legacy_session(
            Path.home() / ".ddalab-qt" / "session.json"
        )
        self.state_db.purge_fallback_dda_results()
        self._server_url = server_url or ""
        self.openneuro = OpenNeuroClient()
        self.state = AppState()
        self._task_executor = ThreadPoolExecutor(
            max_workers=4,
            thread_name_prefix="ddalab-qt",
        )
        self.state.notifications = self.state_db.load_notifications()
        self.state.workflow_actions = self.state_db.load_workflow_actions()
        self.state.saved_workflow_sessions = self.state_db.load_workflow_sessions()
        self.directory_entries: List[BrowserEntry] = []
        self.openneuro_datasets: List[OpenNeuroDataset] = []
        self._openneuro_end_cursor: Optional[str] = None
        self._openneuro_has_more = True
        self._active_variant_id: Optional[str] = None
        self._dataset_loading_path: Optional[str] = None
        self._dataset_request_serial = 0
        self._waveform_request_serial = 0
        self._overview_request_serial = 0
        self._overview_signature: Optional[tuple[str, tuple[str, ...]]] = None
        self._waveform_request_in_flight = False
        self._waveform_reload_pending = False
        self._overview_request_in_flight = False
        self._overview_reload_pending = False
        self._stream_running = False
        self._stream_pause_requested = False
        self._restoring_session = False
        self._session_restored = False
        self._pending_session_restore: Optional[dict] = None
        self._pending_snapshot_restore: Optional[dict] = None
        self._annotation_context_menu: Optional[QMenu] = None
        self._dda_run_details_menu: Optional[QMenu] = None
        self._startup_analysis_restore_serial = 0
        self._pending_dda_result_load_callbacks: Dict[
            str,
            List[Callable[[object], None]],
        ] = {}
        self._pending_ica_result_load_file_path: Optional[str] = None
        self._connectivity_refresh_serial = 0
        self._compare_refresh_serial = 0
        self._compare_baseline_id: Optional[str] = None
        self._compare_target_id: Optional[str] = None
        self._compare_variant_id: Optional[str] = None
        self._compare_view_mode = "summary"
        self._compare_selected_row_labels: List[str] = []
        self._compare_row_context_key: Optional[tuple[str, str, str]] = None
        self._dda_last_progress_ui_refresh_monotonic = 0.0
        self._dda_last_progress_stage_signature: Optional[tuple[str, str]] = None
        self._cached_session_payload = self._load_session_state()
        self.state.theme_mode = normalize_theme_mode(
            self._cached_session_payload.get("themeMode", self.state.theme_mode)
        )
        self.state.expert_mode = bool(
            self._cached_session_payload.get("expertMode", self.state.expert_mode)
        )
        self._last_saved_session_payload_json = json.dumps(
            self._cached_session_payload,
            sort_keys=True,
            separators=(",", ":"),
        )
        self._dda_run_started_at: Optional[float] = None
        self._dda_run_animation_tick = 0

        self.setWindowTitle("DDALAB")
        self.resize(1560, 980)
        app = QApplication.instance()
        if app is not None:
            apply_theme(app, self.runtime_paths, self.state.theme_mode)
        self._build_ui()
        self._bind_ui()
        self._refresh_dda_model_term_list()
        self._apply_expert_mode(self.state.expert_mode, schedule_save=False)
        self._update_backend_mode_ui()
        self._apply_window_session_state(self._cached_session_payload)
        self._apply_lightweight_session_state(self._cached_session_payload)
        if bootstrap_backend:
            self._refresh_health()
            self._bootstrap_browser()
        else:
            self.backend_status_label.setText("Smoke test mode")
            self.file_browser.set_path(str(self.repo_root))
            self.file_browser.set_entries([])
            self._sync_file_tab_bar()


def build_main_window(
    runtime_paths: RuntimePaths,
    server_url: Optional[str],
    bootstrap_backend: bool = True,
) -> MainWindow:
    return MainWindow(
        runtime_paths=runtime_paths,
        server_url=server_url,
        bootstrap_backend=bootstrap_backend,
    )
