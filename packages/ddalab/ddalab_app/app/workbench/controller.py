from __future__ import annotations

import math
import uuid
from pathlib import Path
from typing import Callable

from PySide6.QtCore import Property, QObject, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QGuiApplication

from ...backend.local import LocalBackendClient
from ...backend.services.openneuro import OpenNeuroClient
from ...domain.models import (
    AppState,
    BrowserEntry,
    DdaResult,
    DdaRunProgress,
    DdaVariantResult,
    IcaResult,
    LoadedDataset,
    WaveformAnnotation,
    WaveformWindow,
)
from ...persistence.state_db import StateDatabase
from ...runtime_paths import RuntimePaths
from ...ui.quick_plot_surface import (
    QuickPlotSurfaceBridge,
    update_quick_variant_bridge,
)
from ...ui.quick_waveform_surface import (
    QuickWaveformSurfaceBridge,
    update_quick_waveform_bridge,
)
from ...ui.style import apply_theme, normalize_theme_mode, theme_colors
from ...update_manager import UpdateManager
from ...version import get_app_version
from ..integrations.cdr import (
    CDR_DELAYS,
    CDR_DERIVATIVE_POINTS,
    CDR_FLAVORS,
    CDR_MODEL_TERMS,
    CDR_NR_TAU,
    CDR_POLYNOMIAL_ORDER,
    CDR_WINDOW_LENGTH,
    CDR_WINDOW_STEP,
    aggregate_cdr_results,
    all_pair_indices,
    build_cdr_paper_view,
    find_cdr_recordings,
)
from ..integrations.cdr_simulation import generate_cdr_recordings
from ..integrations.dda_export_utils import export_result_json, export_variant_csv
from .models import RecordListModel, SelectionListModel
from .tasks import TaskRunner

_FLAVORS = (
    ("ST", "Single timeseries"),
    ("SY", "Synchronization"),
    ("DE", "Dynamical ergodicity"),
    ("CT", "Cross-timeseries"),
    ("CD", "Causal dependence"),
)
_FLAVOR_LABELS = dict(_FLAVORS)
_DEFAULT_MODEL_TERMS = (1, 2, 10)
_DEFAULT_DERIVATIVE_POINTS = 4
_DEFAULT_POLYNOMIAL_ORDER = 4
_DEFAULT_NR_TAU = 2


class WorkbenchController(QObject):
    changed = Signal()
    errorRaised = Signal(str)
    annotationEditRequested = Signal(float, str, str, str, float, str, bool)

    def __init__(
        self,
        runtime_paths: RuntimePaths,
        *,
        bootstrap_backend: bool = True,
        backend=None,
        state_db: StateDatabase | None = None,
    ) -> None:
        super().__init__()
        self.runtime_paths = runtime_paths
        self.backend = backend or LocalBackendClient(runtime_paths)
        self.state_db = state_db or StateDatabase()
        self.state = AppState()
        self._tasks = TaskRunner(self)
        self._busy_count = 0
        self._loading_components: dict[str, int] = {}
        self._status_text = "Ready"
        self._progress_text = ""
        self._current_page = "workspace"
        self._workspace_mode = "inspect"
        self._analysis_mode = "dda"
        self._results_mode = "history"
        self._library_collapsed = False
        self._inspector_collapsed = False
        self._analysis_start = 0.0
        self._analysis_end = 0.0
        self._window_length = 128
        self._window_step = 100
        self._compute_device = "cpu"
        self._delays_text = "7, 10"
        self._model_terms_text = ", ".join(map(str, _DEFAULT_MODEL_TERMS))
        self._derivative_points = _DEFAULT_DERIVATIVE_POINTS
        self._polynomial_order = _DEFAULT_POLYNOMIAL_ORDER
        self._nr_tau = _DEFAULT_NR_TAU
        self._expert_mode = False
        self._active_variant_index = -1
        self._active_result: DdaResult | None = None
        self._cdr_view: dict[str, object] = {}
        self._ica_summary = "No ICA result"
        self._update_status = "Updates are checked against GitHub releases."
        self._replay_active = False
        self._browser_entries: list[BrowserEntry] = []
        self._dataset_serial = 0
        self._waveform_serial = 0
        self._result_serial = 0
        self._viewport_file_path = ""
        self._viewport_restored = False
        self._cdr_data_dir = (
            self.state_db.db_path.parent / "reproductions" / "cdr" / "data"
        )

        self.browser_model = RecordListModel(
            ("name", "path", "directory", "supported", "type", "size", "search")
        )
        self.channel_model = SelectionListModel(
            ("name", "sampleRate", "sampleCount", "unit", "selected")
        )
        self.flavor_model = SelectionListModel(("id", "label", "selected"))
        self.compute_device_model = RecordListModel(("id", "label"))
        self.variant_model = RecordListModel(("id", "label", "summary"))
        self.history_model = RecordListModel(
            ("id", "fileName", "created", "engine", "variants")
        )
        self.nsg_jobs_model = RecordListModel(
            ("id", "name", "status", "created", "updated")
        )
        self.ica_model = RecordListModel(
            ("component", "variance", "kurtosis", "nonGaussianity")
        )
        self.batch_model = RecordListModel(("file", "status", "details"))
        self.connectivity_model = RecordListModel(("label", "mean", "peak"))
        self.compare_model = RecordListModel(
            ("flavor", "baselineValue", "targetValue", "delta")
        )
        self.openneuro_model = RecordListModel(
            ("id", "name", "modalities", "subjects", "size")
        )
        self.annotation_model = RecordListModel(
            ("id", "label", "channel", "start", "end", "notes")
        )
        self.flavor_model.replace(
            {
                "id": flavor_id,
                "label": label,
                "selected": flavor_id == "ST",
            }
            for flavor_id, label in _FLAVORS
        )
        self.compute_device_model.replace(({"id": "cpu", "label": "CPU"},))
        self.channel_model.selectionChanged.connect(self._on_channel_selection_changed)
        self.flavor_model.selectionChanged.connect(self.changed)

        self.waveform_bridge = QuickWaveformSurfaceBridge(self)
        self.result_bridge = QuickPlotSurfaceBridge(self)
        self.waveform_bridge.viewport_zoom_requested.connect(self._zoom_waveform)
        self.waveform_bridge.viewport_pan_requested.connect(self._pan_waveform)
        self.waveform_bridge.annotation_context_requested.connect(
            self._request_waveform_annotation
        )
        self.result_bridge.view_window_requested.connect(self._set_result_view)
        self._replay_timer = QTimer(self)
        self._replay_timer.setInterval(800)
        self._replay_timer.timeout.connect(self._advance_replay)
        self.openneuro = OpenNeuroClient()
        self.update_manager = UpdateManager(
            runtime_paths,
            get_app_version(),
        )

        session = self.state_db.load_session_payload()
        self.state.theme_mode = normalize_theme_mode(session.get("themeMode", "light"))
        self.state.browser_path = str(session.get("browserPath") or "")
        self.state.open_files = [
            str(path) for path in session.get("openFiles", []) if str(path)
        ]
        viewport = session.get("viewport")
        if isinstance(viewport, dict):
            try:
                start = float(viewport.get("startSeconds", 0.0))
                duration = float(viewport.get("durationSeconds", 0.0))
            except (TypeError, ValueError):
                start = duration = 0.0
            if math.isfinite(start) and math.isfinite(duration) and duration > 0:
                self.state.waveform_viewport_start_seconds = max(0.0, start)
                self.state.waveform_viewport_duration_seconds = duration
                self._viewport_file_path = str(
                    session.get("activeFilePath")
                    or (self.state.open_files[0] if self.state.open_files else "")
                )
                self._viewport_restored = True
        self._expert_mode = bool(session.get("expertMode", False))
        compute_device = str(session.get("computeDevice") or "cpu").lower()
        self._compute_device = (
            compute_device if _is_compute_device(compute_device) else "cpu"
        )
        app = QGuiApplication.instance()
        if app is not None:
            apply_theme(app, runtime_paths, self.state.theme_mode)
        self._load_history()

        if bootstrap_backend:
            self._bootstrap()
        else:
            self._status_text = "Smoke test mode"

    def close(self) -> None:
        self._stop_replay()
        self._save_session()
        self._tasks.close()
        self.backend.close()
        self.openneuro.close()
        self.state_db.close()

    def _bootstrap(self) -> None:
        def task(_progress: Callable[[object], None]) -> object:
            health = self.backend.health()
            root = self.state.browser_path or self.backend.default_root()
            return (
                health,
                self.backend.list_directory(root),
                self.backend.compute_devices(),
            )

        def success(value: object) -> None:
            health, listing, devices = value
            path, entries = listing
            self._set_browser(path, entries)
            self._set_compute_devices(devices)
            dda_status = "DDA ready" if health.dda_available else "DDA unavailable"
            self._finish_task(f"{health.service}: {dda_status}")
            restored = next(
                (path for path in self.state.open_files if Path(path).exists()),
                None,
            )
            if restored:
                self.openDataset(restored)

        self._submit(task, success, status="Opening workspace", component="library")

    def _submit(
        self,
        task: Callable[[Callable[[object], None]], object],
        on_success: Callable[[object], None],
        *,
        status: str,
        on_progress: Callable[[object], None] | None = None,
        component: str = "",
    ) -> None:
        self._busy_count += 1
        if component:
            self._loading_components[component] = (
                self._loading_components.get(component, 0) + 1
            )
        self._status_text = status
        self.changed.emit()

        def completed(value: object) -> None:
            self._finish_component_load(component)
            on_success(value)

        def failed(message: str) -> None:
            self._finish_component_load(component)
            self._finish_task(message)
            self.errorRaised.emit(message)

        self._tasks.submit(task, completed, failed, on_progress)

    def _finish_component_load(self, component: str) -> None:
        if not component:
            return
        remaining = self._loading_components.get(component, 0) - 1
        if remaining > 0:
            self._loading_components[component] = remaining
        else:
            self._loading_components.pop(component, None)

    def _finish_task(self, status: str = "Ready") -> None:
        self._busy_count = max(0, self._busy_count - 1)
        self._status_text = status
        if self._busy_count == 0:
            self._progress_text = ""
        self.changed.emit()

    @Property(QObject, constant=True)
    def browserModel(self) -> QObject:
        return self.browser_model

    @Property(QObject, constant=True)
    def channelModel(self) -> QObject:
        return self.channel_model

    @Property(QObject, constant=True)
    def flavorModel(self) -> QObject:
        return self.flavor_model

    @Property(QObject, constant=True)
    def computeDeviceModel(self) -> QObject:
        return self.compute_device_model

    @Property(QObject, constant=True)
    def variantModel(self) -> QObject:
        return self.variant_model

    @Property(QObject, constant=True)
    def historyModel(self) -> QObject:
        return self.history_model

    @Property(QObject, constant=True)
    def nsgJobsModel(self) -> QObject:
        return self.nsg_jobs_model

    @Property(QObject, constant=True)
    def icaModel(self) -> QObject:
        return self.ica_model

    @Property(QObject, constant=True)
    def batchModel(self) -> QObject:
        return self.batch_model

    @Property(QObject, constant=True)
    def connectivityModel(self) -> QObject:
        return self.connectivity_model

    @Property(QObject, constant=True)
    def compareModel(self) -> QObject:
        return self.compare_model

    @Property(QObject, constant=True)
    def openneuroModel(self) -> QObject:
        return self.openneuro_model

    @Property(QObject, constant=True)
    def annotationModel(self) -> QObject:
        return self.annotation_model

    @Property(QObject, constant=True)
    def waveformBridge(self) -> QObject:
        return self.waveform_bridge

    @Property(QObject, constant=True)
    def resultBridge(self) -> QObject:
        return self.result_bridge

    @Property("QVariantMap", notify=changed)
    def cdrView(self) -> dict[str, object]:
        return self._cdr_view

    @Property("QVariantMap", notify=changed)
    def theme(self) -> dict[str, object]:
        colors = theme_colors(self.state.theme_mode)
        return {
            "mode": colors.mode,
            "window": colors.window_bg,
            "surface": colors.surface_bg,
            "surfaceAlt": colors.surface_alt_bg,
            "panel": colors.panel_bg,
            "panelAlt": colors.panel_alt_bg,
            "input": colors.input_bg,
            "border": colors.border,
            "borderStrong": colors.border_strong,
            "text": colors.text,
            "muted": colors.text_muted,
            "title": colors.text_title,
            "accent": colors.accent_bg,
            "accentHover": colors.accent_hover_bg,
            "accentPressed": colors.accent_pressed_bg,
            "accentText": colors.accent_text,
            "selection": colors.selection_bg,
            "selectionText": colors.selection_text,
            "danger": "#b42318" if colors.mode == "light" else "#ff8a80",
        }

    @Property(str, notify=changed)
    def currentPage(self) -> str:
        return self._current_page

    @Property(str, notify=changed)
    def workspaceMode(self) -> str:
        return self._workspace_mode

    @Property(str, notify=changed)
    def analysisMode(self) -> str:
        return self._analysis_mode

    @Property(str, notify=changed)
    def resultsMode(self) -> str:
        return self._results_mode

    @Property(bool, notify=changed)
    def libraryCollapsed(self) -> bool:
        return self._library_collapsed

    @Property(bool, notify=changed)
    def inspectorCollapsed(self) -> bool:
        return self._inspector_collapsed

    @Property(bool, notify=changed)
    def busy(self) -> bool:
        return self._busy_count > 0

    @Property("QVariantMap", notify=changed)
    def loadingComponents(self) -> dict[str, bool]:
        return {name: count > 0 for name, count in self._loading_components.items()}

    @Property(str, notify=changed)
    def statusText(self) -> str:
        return self._status_text

    @Property(str, notify=changed)
    def progressText(self) -> str:
        return self._progress_text

    @Property(str, notify=changed)
    def browserPath(self) -> str:
        return self.state.browser_path

    @Property(bool, notify=changed)
    def datasetLoaded(self) -> bool:
        return self.state.selected_dataset is not None

    @Property(str, notify=changed)
    def datasetName(self) -> str:
        dataset = self.state.selected_dataset
        return dataset.file_name if dataset else "No recording open"

    @Property(str, notify=changed)
    def datasetSummary(self) -> str:
        dataset = self.state.selected_dataset
        if dataset is None:
            return "Open a physiological recording to begin."
        return (
            f"{dataset.format_label} · {len(dataset.channels)} channels · "
            f"{dataset.duration_seconds:.2f} s · "
            f"{dataset.dominant_sample_rate_hz:.0f} Hz"
        )

    @Property(float, notify=changed)
    def waveformStart(self) -> float:
        return self.state.waveform_viewport_start_seconds

    @Property(float, notify=changed)
    def waveformDuration(self) -> float:
        return self.state.waveform_viewport_duration_seconds

    @Property(float, notify=changed)
    def analysisStart(self) -> float:
        return self._analysis_start

    @analysisStart.setter
    def analysisStart(self, value: float) -> None:
        self._analysis_start = max(0.0, float(value))
        self.changed.emit()

    @Property(float, notify=changed)
    def analysisEnd(self) -> float:
        return self._analysis_end

    @analysisEnd.setter
    def analysisEnd(self, value: float) -> None:
        self._analysis_end = max(0.0, float(value))
        self.changed.emit()

    @Property(int, notify=changed)
    def selectedChannelCount(self) -> int:
        return len(self.channel_model.selected_rows())

    @Property(str, notify=changed)
    def selectedChannelSummary(self) -> str:
        return ", ".join(str(row["name"]) for row in self.channel_model.selected_rows())

    @Property(str, notify=changed)
    def selectedFlavorSummary(self) -> str:
        return ", ".join(str(row["id"]) for row in self.flavor_model.selected_rows())

    @Property(bool, notify=changed)
    def analysisIntervalValid(self) -> bool:
        dataset = self.state.selected_dataset
        return bool(
            dataset is not None
            and 0.0 <= self._analysis_start < self._analysis_end
            and self._analysis_end <= dataset.duration_seconds
        )

    @Property(int, notify=changed)
    def windowLength(self) -> int:
        return self._window_length

    @windowLength.setter
    def windowLength(self, value: int) -> None:
        self._window_length = max(1, int(value))
        self.changed.emit()

    @Property(int, notify=changed)
    def windowStep(self) -> int:
        return self._window_step

    @windowStep.setter
    def windowStep(self, value: int) -> None:
        self._window_step = max(1, int(value))
        self.changed.emit()

    @Property(str, notify=changed)
    def computeDevice(self) -> str:
        return self._compute_device

    @computeDevice.setter
    def computeDevice(self, value: str) -> None:
        device = str(value).strip().lower()
        available = {
            str(self.compute_device_model.row(index)["id"])
            for index in range(self.compute_device_model.count)
        }
        if device not in available or device == self._compute_device:
            return
        self._compute_device = device
        self._save_session()
        self.changed.emit()

    def _set_compute_devices(self, devices: object) -> None:
        rows = [{"id": "cpu", "label": "CPU"}]
        if isinstance(devices, list):
            for item in devices:
                if not isinstance(item, dict):
                    continue
                device_id = str(item.get("id") or "").lower()
                if device_id.startswith("cuda:") and device_id[5:].isdigit():
                    rows.append(
                        {"id": device_id, "label": str(item.get("label") or device_id)}
                    )
        self.compute_device_model.replace(rows)
        available = {str(row["id"]) for row in rows}
        if self._compute_device == "cuda":
            self._compute_device = next(
                (str(row["id"]) for row in rows if str(row["id"]).startswith("cuda:")),
                "cpu",
            )
        elif self._compute_device not in available:
            self._compute_device = "cpu"
        self.changed.emit()

    @Property(str, notify=changed)
    def delaysText(self) -> str:
        return self._delays_text

    @delaysText.setter
    def delaysText(self, value: str) -> None:
        self._delays_text = str(value)
        self.changed.emit()

    @Property(str, notify=changed)
    def modelTermsText(self) -> str:
        return self._model_terms_text

    @modelTermsText.setter
    def modelTermsText(self, value: str) -> None:
        self._model_terms_text = str(value)
        self.changed.emit()

    @Property(int, notify=changed)
    def derivativePoints(self) -> int:
        return self._derivative_points

    @derivativePoints.setter
    def derivativePoints(self, value: int) -> None:
        self._derivative_points = max(1, int(value))
        self.changed.emit()

    @Property(int, notify=changed)
    def polynomialOrder(self) -> int:
        return self._polynomial_order

    @polynomialOrder.setter
    def polynomialOrder(self, value: int) -> None:
        self._polynomial_order = max(1, int(value))
        self.changed.emit()

    @Property(int, notify=changed)
    def nrTau(self) -> int:
        return self._nr_tau

    @nrTau.setter
    def nrTau(self, value: int) -> None:
        self._nr_tau = max(1, int(value))
        self.changed.emit()

    @Property(bool, notify=changed)
    def expertMode(self) -> bool:
        return self._expert_mode

    @expertMode.setter
    def expertMode(self, value: bool) -> None:
        self._expert_mode = bool(value)
        self._save_session()
        self.changed.emit()

    @Property(bool, notify=changed)
    def resultAvailable(self) -> bool:
        return self._active_result is not None

    @Property(bool, notify=changed)
    def cdrResultAvailable(self) -> bool:
        return bool(self._cdr_view)

    @Property(str, notify=changed)
    def resultSummary(self) -> str:
        result = self._active_result
        if result is None:
            return "Run DDA or choose a saved result."
        if self._cdr_view:
            return "CDR · 22 conditions · CD + DE"
        variant = self._active_variant()
        if variant is None:
            return result.created_at_iso
        column_unit = (
            "conditions" if result.file_name == "CDR batch summary" else "windows"
        )
        return (
            f"{_FLAVOR_LABELS.get(variant.id, variant.label)} · "
            f"{len(variant.row_labels)} rows · "
            f"{variant.effective_column_count} {column_unit}"
        )

    @Property(str, notify=changed)
    def icaSummary(self) -> str:
        return self._ica_summary

    @Property(str, notify=changed)
    def updateStatus(self) -> str:
        return self._update_status

    @Property(bool, notify=changed)
    def replayActive(self) -> bool:
        return self._replay_active

    @Property(int, notify=changed)
    def activeVariantIndex(self) -> int:
        return self._active_variant_index

    @Slot(str)
    def setCurrentPage(self, page: str) -> None:
        normalized = (
            page
            if page in {"workspace", "analysis", "results", "settings"}
            else "workspace"
        )
        if normalized == self._current_page:
            return
        if normalized != "workspace":
            self._stop_replay()
        self._current_page = normalized
        self.changed.emit()

    @Slot()
    def showWorkspace(self) -> None:
        self._current_page = "workspace"
        self._workspace_mode = "inspect"
        self.changed.emit()

    @Slot()
    def showDdaSetup(self) -> None:
        self._stop_replay()
        self._current_page = "analysis"
        self._analysis_mode = "dda"
        self.changed.emit()

    def _show_results(self, mode: str) -> None:
        self._stop_replay()
        self._current_page = "results"
        self._results_mode = mode

    @Slot(str)
    def setWorkspaceMode(self, mode: str) -> None:
        normalized = (
            mode if mode in {"inspect", "annotations", "openneuro"} else "inspect"
        )
        if normalized == self._workspace_mode:
            return
        if normalized != "inspect":
            self._stop_replay()
        self._workspace_mode = normalized
        self.changed.emit()

    @Slot(str)
    def setAnalysisMode(self, mode: str) -> None:
        normalized = mode if mode in {"dda", "ica", "batch"} else "dda"
        if normalized == self._analysis_mode:
            return
        self._analysis_mode = normalized
        self.changed.emit()

    @Slot(str)
    def setResultsMode(self, mode: str) -> None:
        normalized = (
            mode if mode in {"history", "connectivity", "compare"} else "history"
        )
        if normalized == self._results_mode:
            return
        self._results_mode = normalized
        if normalized == "connectivity":
            self._refresh_connectivity_model()
        self.changed.emit()

    @Slot()
    def toggleLibrary(self) -> None:
        self._library_collapsed = not self._library_collapsed
        self.changed.emit()

    @Slot()
    def toggleInspector(self) -> None:
        self._inspector_collapsed = not self._inspector_collapsed
        self.changed.emit()

    @Slot(str)
    def setThemeMode(self, mode: str) -> None:
        normalized = normalize_theme_mode(mode)
        if normalized == self.state.theme_mode:
            return
        self.state.theme_mode = normalized
        app = QGuiApplication.instance()
        if app is not None:
            apply_theme(app, self.runtime_paths, normalized)
        self.waveform_bridge.refresh_theme()
        self.result_bridge.refresh_theme()
        self._save_session()
        self.changed.emit()

    @Slot(str)
    def refreshDirectory(self, path: str = "") -> None:
        target = (
            _local_path(path) or self.state.browser_path or self.backend.default_root()
        )

        def task(_progress: Callable[[object], None]) -> object:
            return self.backend.list_directory(target)

        def success(value: object) -> None:
            current_path, entries = value
            self._set_browser(current_path, entries)
            self._finish_task(f"Library: {current_path}")

        self._submit(task, success, status="Loading library", component="library")

    @Slot()
    def goUp(self) -> None:
        if self.state.browser_path:
            self.refreshDirectory(str(Path(self.state.browser_path).parent))

    @Slot(int)
    def openBrowserIndex(self, index: int) -> None:
        row = self.browser_model.row(index)
        if row is None:
            return
        path = str(row.get("path") or "")
        if bool(row.get("directory")):
            self.refreshDirectory(path)
        elif bool(row.get("supported")):
            self.openDataset(path)

    @Slot(str)
    def openDataset(self, path: str) -> None:
        target = _local_path(path)
        if not target:
            return
        self._stop_replay()
        self._dataset_serial += 1
        serial = self._dataset_serial

        def task(_progress: Callable[[object], None]) -> object:
            return self.backend.load_dataset(target)

        def success(value: object) -> None:
            if serial != self._dataset_serial or not isinstance(value, LoadedDataset):
                self._finish_task()
                return
            self._activate_dataset(value)
            self._finish_task(f"Opened {value.file_name}")
            self.refreshWaveform()

        self._submit(
            task,
            success,
            status=f"Opening {Path(target).name}",
            component="recording",
        )

    def _activate_dataset(self, dataset: LoadedDataset) -> None:
        self._stop_replay()
        self._result_serial += 1
        self._clear_outputs()
        self._waveform_serial += 1
        self.state.waveform_window = None
        self.waveform_bridge.clear()
        self._current_page = "workspace"
        self._workspace_mode = "inspect"
        total_duration = max(dataset.duration_seconds, 0.01)
        if self._viewport_restored:
            duration = min(
                max(self.state.waveform_viewport_duration_seconds, 0.01),
                total_duration,
            )
            start = (
                self.state.waveform_viewport_start_seconds
                if dataset.file_path == self._viewport_file_path
                else 0.0
            )
            start = min(max(start, 0.0), max(total_duration - duration, 0.0))
        else:
            start = 0.0
            duration = min(total_duration, 10.0)
        self.state.selected_dataset = dataset
        self.state.active_file_path = dataset.file_path
        self.state.open_files = [dataset.file_path]
        self.state.waveform_viewport_start_seconds = start
        self.state.waveform_viewport_duration_seconds = duration
        self._viewport_file_path = dataset.file_path
        self._viewport_restored = True
        self._analysis_start = 0.0
        self._analysis_end = dataset.duration_seconds
        selected_count = min(8, len(dataset.channels))
        self.channel_model.replace(
            {
                "name": channel.name,
                "sampleRate": channel.sample_rate_hz,
                "sampleCount": channel.sample_count,
                "unit": channel.unit or "",
                "selected": index < selected_count,
                "index": index,
            }
            for index, channel in enumerate(dataset.channels)
        )
        annotations = self.state_db.load_annotations_for_file(dataset.file_path)
        self.state.annotations_by_file[dataset.file_path] = annotations
        self.waveform_bridge.set_annotations(annotations)
        self._replace_annotation_model(annotations)
        self._load_history()
        self._save_session()
        self.changed.emit()

    def _on_channel_selection_changed(self) -> None:
        self.changed.emit()
        self.refreshWaveform()

    @Slot()
    def refreshWaveform(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        names = [str(row["name"]) for row in self.channel_model.selected_rows()]
        self._waveform_serial += 1
        serial = self._waveform_serial
        if not names:
            self.state.waveform_window = None
            self.waveform_bridge.clear()
            self.changed.emit()
            return
        start = self.state.waveform_viewport_start_seconds
        duration = self.state.waveform_viewport_duration_seconds

        def task(_progress: Callable[[object], None]) -> object:
            return self.backend.load_waveform_window(
                dataset.file_path,
                start,
                duration,
                names,
            )

        def success(value: object) -> None:
            if serial != self._waveform_serial or not isinstance(value, WaveformWindow):
                self._finish_task()
                return
            self.state.waveform_window = value
            update_quick_waveform_bridge(
                self.waveform_bridge,
                value,
                target_width=1600,
                title=dataset.file_name,
            )
            self._finish_task(
                f"{len(value.channels)} channels · {start:.2f}–{start + duration:.2f} s"
            )
            self.changed.emit()

        self._submit(task, success, status="Loading waveform", component="waveform")

    @Slot()
    def showEntireRecording(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        self.state.waveform_viewport_start_seconds = 0.0
        self.state.waveform_viewport_duration_seconds = dataset.duration_seconds
        self.refreshWaveform()

    @Slot()
    def resetWaveformView(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        self.state.waveform_viewport_start_seconds = 0.0
        self.state.waveform_viewport_duration_seconds = min(
            dataset.duration_seconds, 10.0
        )
        self.refreshWaveform()

    @Slot()
    def useVisibleWaveformRange(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        self._analysis_start = self.state.waveform_viewport_start_seconds
        self._analysis_end = min(
            dataset.duration_seconds,
            self._analysis_start + self.state.waveform_viewport_duration_seconds,
        )
        self.changed.emit()

    def _validated_analysis_interval(
        self, dataset: LoadedDataset
    ) -> tuple[float, float]:
        if not 0.0 <= self._analysis_start < self._analysis_end:
            raise ValueError("Analysis start must be before analysis end.")
        if self._analysis_end > dataset.duration_seconds:
            raise ValueError(
                f"Analysis end exceeds the {dataset.duration_seconds:.3f} s recording."
            )
        return self._analysis_start, self._analysis_end

    def _resolved_model_parameters(self) -> tuple[list[int], int, int, int]:
        if not self._expert_mode:
            return (
                list(_DEFAULT_MODEL_TERMS),
                _DEFAULT_DERIVATIVE_POINTS,
                _DEFAULT_POLYNOMIAL_ORDER,
                _DEFAULT_NR_TAU,
            )
        return (
            _parse_positive_integers(self._model_terms_text, "MODEL terms"),
            self._derivative_points,
            self._polynomial_order,
            self._nr_tau,
        )

    @Slot()
    def toggleReplay(self) -> None:
        if self.state.selected_dataset is None or self.busy:
            return
        self._replay_active = not self._replay_active
        if self._replay_active:
            self._workspace_mode = "inspect"
            self._replay_timer.start()
        else:
            self._replay_timer.stop()
        self.changed.emit()

    def _stop_replay(self) -> None:
        if not self._replay_active:
            return
        self._replay_active = False
        self._replay_timer.stop()

    def _advance_replay(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None or self.busy:
            return
        duration = self.state.waveform_viewport_duration_seconds
        next_start = self.state.waveform_viewport_start_seconds + duration * 0.5
        if next_start + duration > dataset.duration_seconds:
            self._replay_active = False
            self._replay_timer.stop()
            self.changed.emit()
            return
        self.state.waveform_viewport_start_seconds = next_start
        self.refreshWaveform()

    @Slot()
    def runDda(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            self.errorRaised.emit("Open a recording before running DDA.")
            return
        channel_rows = self.channel_model.selected_rows()
        channel_indices = [int(row["index"]) for row in channel_rows]
        flavors = [str(row["id"]) for row in self.flavor_model.selected_rows()]
        if not channel_indices:
            self.errorRaised.emit("Select at least one channel.")
            return
        if not flavors:
            self.errorRaised.emit("Select at least one DDA flavor.")
            return
        try:
            delays = _parse_delays(self._delays_text)
            model_terms, derivative_points, polynomial_order, nr_tau = (
                self._resolved_model_parameters()
            )
            start, end = self._validated_analysis_interval(dataset)
        except ValueError as exc:
            self.errorRaised.emit(str(exc))
            return
        pair_map = all_pair_indices(channel_indices, flavors)
        compute_device = self._compute_device
        self._result_serial += 1
        result_serial = self._result_serial
        dataset_serial = self._dataset_serial

        def task(progress: Callable[[object], None]) -> object:
            return self.backend.run_dda(
                dataset=dataset,
                selected_channel_indices=channel_indices,
                selected_variants=flavors,
                window_length_samples=self._window_length,
                window_step_samples=self._window_step,
                delays=delays,
                start_time_seconds=start,
                end_time_seconds=end,
                variant_channel_indices={flavor: channel_indices for flavor in flavors},
                variant_pair_indices=pair_map or None,
                model_terms=model_terms,
                model_dimension=derivative_points,
                polynomial_order=polynomial_order,
                nr_tau=nr_tau,
                compute_device=compute_device,
                progress_callback=progress,
            )

        def progress(value: object) -> None:
            parsed = DdaRunProgress.from_json(value)
            if parsed is None:
                return
            parts = [part for part in (parsed.stage_label, parsed.item_label) if part]
            if parsed.total_windows:
                parts.append(f"window {parsed.window_index}/{parsed.total_windows}")
            self._progress_text = " · ".join(parts)
            self.changed.emit()

        def success(value: object) -> None:
            if not isinstance(value, DdaResult):
                self._finish_task("DDA returned no result")
                return
            self.state_db.save_dda_result(value)
            active_dataset = self.state.selected_dataset
            if (
                result_serial != self._result_serial
                or dataset_serial != self._dataset_serial
                or active_dataset is None
                or active_dataset.file_path != dataset.file_path
            ):
                self._finish_task("DDA result discarded after context changed")
                return
            self.state.dda_result = value
            self._set_result(value)
            self._load_history()
            self._show_results("history")
            self._finish_task("DDA complete")

        self._submit(
            task,
            success,
            status=f"Running {', '.join(flavors)} on {compute_device.upper()}",
            on_progress=progress,
            component="dda",
        )

    @Slot()
    def runIca(self) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            self.errorRaised.emit("Open a recording before running ICA.")
            return
        channel_indices = [
            int(row["index"]) for row in self.channel_model.selected_rows()
        ]
        if len(channel_indices) < 2:
            self.errorRaised.emit("Select at least two channels for ICA.")
            return
        try:
            start, end = self._validated_analysis_interval(dataset)
        except ValueError as exc:
            self.errorRaised.emit(str(exc))
            return
        self._result_serial += 1
        result_serial = self._result_serial
        dataset_serial = self._dataset_serial

        def task(_progress: Callable[[object], None]) -> object:
            return self.backend.run_ica(
                dataset=dataset,
                selected_channel_indices=channel_indices,
                start_time_seconds=start,
                end_time_seconds=end,
                n_components=min(len(channel_indices), 20),
                max_iterations=500,
                tolerance=1e-6,
                centering=True,
                whitening=True,
            )

        def success(value: object) -> None:
            if not isinstance(value, IcaResult):
                self._finish_task("ICA returned no result")
                return
            self.state_db.save_ica_result(value)
            active_dataset = self.state.selected_dataset
            if (
                result_serial != self._result_serial
                or dataset_serial != self._dataset_serial
                or active_dataset is None
                or active_dataset.file_path != dataset.file_path
            ):
                self._finish_task("ICA result discarded after context changed")
                return
            self.state.ica_result = value
            self.ica_model.replace(
                {
                    "component": item.component_id,
                    "variance": item.variance_explained,
                    "kurtosis": item.kurtosis,
                    "nonGaussianity": item.non_gaussianity,
                }
                for item in value.components
            )
            self._ica_summary = (
                f"{len(value.components)} components · {value.sample_count} samples · "
                f"{value.sample_rate_hz:.0f} Hz"
            )
            self._finish_task("ICA complete")

        self._submit(task, success, status="Running ICA", component="ica")

    @Slot("QVariantList")
    def runBatch(self, paths: list[object]) -> None:
        targets = [_local_path(path) for path in paths]
        targets = [path for path in targets if path]
        if not targets:
            return
        flavors = [str(row["id"]) for row in self.flavor_model.selected_rows()] or [
            "ST"
        ]
        try:
            delays = _parse_delays(self._delays_text)
            model_terms, derivative_points, polynomial_order, nr_tau = (
                self._resolved_model_parameters()
            )
        except ValueError as exc:
            self.errorRaised.emit(str(exc))
            return
        selected_channels = [
            int(row["index"]) for row in self.channel_model.selected_rows()
        ]
        self._run_batch(
            targets,
            flavors=flavors,
            selected_channels=selected_channels,
            use_all_channels=False,
            window_length=self._window_length,
            window_step=self._window_step,
            delays=delays,
            model_terms=model_terms,
            derivative_points=derivative_points,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            compute_device=self._compute_device,
            cdr_aggregate=False,
        )

    @Slot()
    def runIncludedCdrReproduction(self) -> None:
        def task(progress: Callable[[object], None]) -> object:
            return generate_cdr_recordings(
                self._cdr_data_dir,
                progress=progress,
            )

        def on_progress(value: object) -> None:
            payload = value if isinstance(value, dict) else {}
            completed = int(payload.get("completed", 0))
            total = int(payload.get("total", 0))
            count = f" · {completed}/{total}" if total else ""
            self._progress_text = (
                f"{payload.get('label', 'Generating CDR data')}{count}"
            )
            self.changed.emit()

        def success(_value: object) -> None:
            self._finish_task("CDR recordings generated")
            self._start_cdr_reproduction(self._cdr_data_dir)

        self._submit(
            task,
            success,
            status="Generating CDR paper data",
            on_progress=on_progress,
            component="batch",
        )

    @Slot(str)
    def runCdrReproduction(self, folder: str) -> None:
        path = _local_path(folder)
        if path:
            self._start_cdr_reproduction(Path(path))

    def _start_cdr_reproduction(self, folder: Path) -> None:
        try:
            targets = [str(path) for path in find_cdr_recordings(folder)]
        except ValueError as exc:
            self.errorRaised.emit(str(exc))
            return
        self._run_batch(
            targets,
            flavors=list(CDR_FLAVORS),
            selected_channels=[],
            use_all_channels=True,
            window_length=CDR_WINDOW_LENGTH,
            window_step=CDR_WINDOW_STEP,
            delays=list(CDR_DELAYS),
            model_terms=list(CDR_MODEL_TERMS),
            derivative_points=CDR_DERIVATIVE_POINTS,
            polynomial_order=CDR_POLYNOMIAL_ORDER,
            nr_tau=CDR_NR_TAU,
            compute_device=self._compute_device,
            cdr_aggregate=True,
        )

    def _run_batch(
        self,
        targets: list[str],
        *,
        flavors: list[str],
        selected_channels: list[int],
        use_all_channels: bool,
        window_length: int,
        window_step: int,
        delays: list[int],
        model_terms: list[int],
        derivative_points: int,
        polynomial_order: int,
        nr_tau: int,
        compute_device: str,
        cdr_aggregate: bool,
    ) -> None:
        result_serial = None
        if cdr_aggregate:
            self._result_serial += 1
            result_serial = self._result_serial
        self.batch_model.replace(
            {
                "file": Path(path).name,
                "status": "Queued",
                "details": ", ".join(flavors),
            }
            for path in targets
        )

        def task(progress: Callable[[object], None]) -> object:
            rows: list[dict[str, object]] = []
            for index, path in enumerate(targets):
                progress(
                    {
                        "file": Path(path).name,
                        "index": index + 1,
                        "total": len(targets),
                        "status": "Running",
                    }
                )
                try:
                    dataset = self.backend.load_dataset(path)
                    if use_all_channels:
                        if len(dataset.channels) != 7:
                            raise ValueError(
                                "The CDR reproduction expects seven channels; "
                                f"{dataset.file_name} has {len(dataset.channels)}."
                            )
                        channels = list(range(len(dataset.channels)))
                    else:
                        channels = [
                            channel
                            for channel in selected_channels
                            if channel < len(dataset.channels)
                        ] or list(range(min(8, len(dataset.channels))))
                    pair_map = all_pair_indices(channels, flavors)

                    def dda_progress(event: dict) -> None:
                        progress(
                            {
                                "file": dataset.file_name,
                                "index": index + 1,
                                "total": len(targets),
                                "stage": event.get("stage_label", ""),
                            }
                        )

                    result = self.backend.run_dda(
                        dataset=dataset,
                        selected_channel_indices=channels,
                        selected_variants=flavors,
                        window_length_samples=window_length,
                        window_step_samples=window_step,
                        delays=delays,
                        start_time_seconds=0.0,
                        end_time_seconds=dataset.duration_seconds,
                        variant_channel_indices={
                            flavor: channels for flavor in flavors
                        },
                        variant_pair_indices=pair_map or None,
                        model_terms=model_terms,
                        model_dimension=derivative_points,
                        polynomial_order=polynomial_order,
                        nr_tau=nr_tau,
                        compute_device=compute_device,
                        progress_callback=dda_progress,
                    )
                    rows.append(
                        {
                            "file": dataset.file_name,
                            "status": "Complete",
                            "details": ", ".join(item.id for item in result.variants),
                            "result": result,
                        }
                    )
                    progress(
                        {
                            "file": dataset.file_name,
                            "index": index + 1,
                            "total": len(targets),
                            "status": "Complete",
                            "details": ", ".join(item.id for item in result.variants),
                        }
                    )
                except Exception as exc:  # noqa: BLE001
                    rows.append(
                        {
                            "file": Path(path).name,
                            "status": "Failed",
                            "details": str(exc),
                        }
                    )
                    progress(
                        {
                            "file": Path(path).name,
                            "index": index + 1,
                            "total": len(targets),
                            "status": "Failed",
                            "details": str(exc),
                        }
                    )
            return rows

        def progress(value: object) -> None:
            payload = value if isinstance(value, dict) else {}
            row_index = int(payload.get("index", 0)) - 1
            row = self.batch_model.row(row_index)
            status = str(payload.get("status") or "Running")
            details = str(
                payload.get("stage")
                or payload.get("details")
                or (row or {}).get("details")
                or ""
            )
            self.batch_model.update(row_index, status=status, details=details)
            self._progress_text = (
                f"{payload.get('file', '')} · "
                f"{payload.get('index', 0)}/{payload.get('total', 0)}"
            )
            if payload.get("stage"):
                self._progress_text += f" · {payload['stage']}"
            self.changed.emit()

        def success(value: object) -> None:
            rows = list(value or [])
            completed_results: list[DdaResult] = []
            for row in rows:
                result = row.pop("result", None)
                if isinstance(result, DdaResult):
                    self.state_db.save_dda_result(result)
                    completed_results.append(result)
            aggregate = (
                aggregate_cdr_results(completed_results) if cdr_aggregate else None
            )
            if aggregate is not None:
                self.state_db.save_dda_result(aggregate)
                if result_serial == self._result_serial:
                    self._show_results("history")
                    self._set_result(aggregate)
            self.batch_model.replace(rows)
            complete = sum(row.get("status") == "Complete" for row in rows)
            if cdr_aggregate and aggregate is None:
                message = f"CDR reproduction incomplete: {complete}/{len(rows)}"
                self._finish_task(message)
                self.errorRaised.emit(message)
            else:
                label = "CDR reproduction" if cdr_aggregate else "Batch"
                self._finish_task(f"{label} complete: {complete}/{len(rows)}")
            self._load_history()

        status = "Running CDR reproduction" if cdr_aggregate else "Running batch"
        self._submit(
            task,
            success,
            status=f"{status} on {compute_device.upper()}",
            on_progress=progress,
        )

    def _refresh_connectivity_model(self) -> None:
        variant = self._active_variant()
        if variant is None:
            self.connectivity_model.replace([])
            return
        self.connectivity_model.replace(
            {
                "label": label,
                "mean": variant.row_mean_absolute_value(index),
                "peak": variant.row_peak_absolute_value(index),
            }
            for index, label in enumerate(variant.row_labels)
        )

    @Slot(int, int)
    def compareHistoryResults(self, left_index: int, right_index: int) -> None:
        if left_index == right_index:
            self.errorRaised.emit("Choose two different saved results.")
            return
        left = self.history_model.row(left_index)
        right = self.history_model.row(right_index)
        if left is None or right is None:
            self.errorRaised.emit("Choose two saved results to compare.")
            return
        left_id = str(left["id"])
        right_id = str(right["id"])
        self._result_serial += 1
        result_serial = self._result_serial

        def task(_progress: Callable[[object], None]) -> object:
            database = StateDatabase(self.state_db.db_path)
            try:
                return (
                    database.load_dda_result_by_id(left_id),
                    database.load_dda_result_by_id(right_id),
                )
            finally:
                database.close()

        def success(value: object) -> None:
            if result_serial != self._result_serial:
                self._finish_task("Comparison discarded after context changed")
                return
            left_result, right_result = value
            rows = _compare_results(left_result, right_result)
            self.compare_model.replace(rows)
            self._show_results("compare")
            self._finish_task(f"Compared {len(rows)} common flavors")

        self._submit(
            task,
            success,
            status="Comparing saved results",
            component="comparison",
        )

    @Slot()
    def refreshOpenNeuro(self) -> None:
        def task(_progress: Callable[[object], None]) -> object:
            return self.openneuro.list_datasets(limit=60)

        def success(value: object) -> None:
            datasets, _, _ = value
            self.openneuro_model.replace(
                {
                    "id": item.dataset_id,
                    "name": item.name,
                    "modalities": ", ".join(item.modalities),
                    "subjects": item.subjects or 0,
                    "size": _format_bytes(item.size_bytes or 0),
                }
                for item in datasets
            )
            self._finish_task(f"{len(datasets)} OpenNeuro datasets")

        self._submit(
            task,
            success,
            status="Loading OpenNeuro",
            component="openneuro",
        )

    @Slot()
    def checkForUpdates(self) -> None:
        if not self.update_manager.supports_updates():
            self._update_status = (
                "Automatic updates are available in packaged desktop builds."
            )
            self._status_text = self._update_status
            self.changed.emit()
            return

        def task(_progress: Callable[[object], None]) -> object:
            return self.update_manager.check_for_updates()

        def success(value: object) -> None:
            if value is None:
                self._update_status = "DDALAB is up to date."
            else:
                self._update_status = (
                    f"DDALAB {value.latest_version} is available: {value.asset.name}"
                )
            self._finish_task(self._update_status)

        self._submit(
            task,
            success,
            status="Checking for updates",
            component="updates",
        )

    def _set_result(self, result: DdaResult) -> None:
        self._active_result = result.materialize()
        self._cdr_view = build_cdr_paper_view(self._active_result)
        self.variant_model.replace(
            {
                "id": item.id,
                "label": _FLAVOR_LABELS.get(item.id, item.label),
                "summary": item.summary,
            }
            for item in self._active_result.variants
        )
        self._active_variant_index = 0 if self._active_result.variants else -1
        self.result_bridge.set_view_window(0.0, 1.0)
        self._render_result()
        self.changed.emit()

    def _clear_outputs(self) -> None:
        self.state.dda_result = None
        self.state.ica_result = None
        self._active_result = None
        self._cdr_view = {}
        self._active_variant_index = -1
        self._ica_summary = "No ICA result"
        self.variant_model.replace([])
        self.ica_model.replace([])
        self.connectivity_model.replace([])
        self.compare_model.replace([])
        self.result_bridge.clear()

    def _active_variant(self) -> DdaVariantResult | None:
        result = self._active_result
        if result is None or not 0 <= self._active_variant_index < len(result.variants):
            return None
        return result.variants[self._active_variant_index]

    def _render_result(self) -> None:
        if self._cdr_view:
            self.result_bridge.clear()
            return
        variant = self._active_variant()
        if variant is None:
            self.result_bridge.clear()
            return
        start, span = self.result_bridge.view_window()
        update_quick_variant_bridge(
            self.result_bridge,
            variant,
            target_columns=min(max(variant.effective_column_count, 1), 1600),
            title=_FLAVOR_LABELS.get(variant.id, variant.label),
            color_scheme="inferno",
            start_fraction=start,
            span_fraction=span,
        )
        if self._active_result is not None:
            annotations = self.state.annotations_by_file.get(
                self._active_result.file_path, []
            )
            self.result_bridge.set_annotations(
                annotations,
                self._active_result.window_centers_seconds,
                variant.row_labels,
            )

    @Slot(int)
    def selectVariant(self, index: int) -> None:
        if self._active_result is None or not 0 <= index < len(
            self._active_result.variants
        ):
            return
        self._active_variant_index = index
        self.result_bridge.set_view_window(0.0, 1.0)
        self._render_result()
        self._refresh_connectivity_model()
        self.changed.emit()

    def _load_history(self) -> None:
        summaries = self.state_db.load_dda_history_summaries()
        self.state.dda_history_summaries = summaries
        self.history_model.replace(
            {
                "id": item.id,
                "fileName": item.file_name,
                "created": item.created_at_iso,
                "engine": item.engine_label,
                "variants": ", ".join(item.variant_ids),
            }
            for item in summaries
        )

    @Slot(int)
    def openHistoryResult(self, index: int) -> None:
        row = self.history_model.row(index)
        if row is None:
            return
        result_id = str(row["id"])
        source_mode = self._results_mode
        self._result_serial += 1
        result_serial = self._result_serial

        def task(_progress: Callable[[object], None]) -> object:
            database = StateDatabase(self.state_db.db_path)
            try:
                return database.load_dda_result_by_id(result_id)
            finally:
                database.close()

        def success(value: object) -> None:
            if result_serial != self._result_serial:
                self._finish_task("Saved result discarded after context changed")
                return
            if isinstance(value, DdaResult):
                self._set_result(value)
                self._show_results(
                    "connectivity" if source_mode == "connectivity" else "history"
                )
                if self._results_mode == "connectivity":
                    self._refresh_connectivity_model()
                self._finish_task("Saved result loaded")
            else:
                self._finish_task("Saved result not found")

        self._submit(
            task,
            success,
            status="Loading saved result",
            component="result",
        )

    @Slot(str)
    def exportResultJson(self, path: str) -> None:
        self._export(path, export_result_json, "JSON result exported")

    @Slot(str)
    def exportVariantCsv(self, path: str) -> None:
        variant = self._active_variant()
        variant_id = variant.id if variant is not None else None
        self._export(
            path,
            lambda result: export_variant_csv(result, variant_id),
            "CSV result exported",
        )

    def _export(
        self,
        path: str,
        serializer: Callable[[DdaResult], str],
        success_message: str,
    ) -> None:
        result = self._active_result
        target = _local_path(path)
        if result is None or not target:
            self.errorRaised.emit("Choose a result and output path first.")
            return

        def task(_progress: Callable[[object], None]) -> object:
            Path(target).write_text(serializer(result), encoding="utf-8")
            return target

        def success(_value: object) -> None:
            self._finish_task(success_message)

        self._submit(task, success, status="Exporting result")

    @Slot(str, str, str, float, float, str)
    def saveAnnotation(
        self,
        label: str,
        notes: str,
        channel_name: str,
        start_seconds: float,
        end_seconds: float,
        annotation_id: str = "",
    ) -> None:
        dataset = self.state.selected_dataset
        if dataset is None or not label.strip():
            return
        annotations = list(self.state.annotations_by_file.get(dataset.file_path, []))
        annotation = WaveformAnnotation(
            id=annotation_id or str(uuid.uuid4()),
            label=label.strip(),
            notes=notes.strip(),
            channel_name=channel_name or None,
            start_seconds=max(0.0, start_seconds),
            end_seconds=end_seconds if end_seconds > start_seconds else None,
        )
        for index, existing in enumerate(annotations):
            if existing.id == annotation.id:
                annotations[index] = annotation
                break
        else:
            annotations.append(annotation)
        self._store_annotations(dataset.file_path, annotations)

    @Slot(int)
    def deleteAnnotation(self, index: int) -> None:
        dataset = self.state.selected_dataset
        row = self.annotation_model.row(index)
        if dataset is None or row is None:
            return
        self._delete_annotation(str(row["id"]))

    @Slot(str)
    def deleteAnnotationById(self, annotation_id: str) -> None:
        self._delete_annotation(annotation_id)

    def _delete_annotation(self, annotation_id: str) -> None:
        dataset = self.state.selected_dataset
        if dataset is None or not annotation_id:
            return
        annotations = [
            item
            for item in self.state.annotations_by_file.get(dataset.file_path, [])
            if item.id != annotation_id
        ]
        self._store_annotations(dataset.file_path, annotations)

    def _store_annotations(
        self,
        file_path: str,
        annotations: list[WaveformAnnotation],
    ) -> None:
        self.state.annotations_by_file[file_path] = annotations
        self.state_db.replace_annotations_for_file(file_path, annotations)
        self._replace_annotation_model(annotations)
        self.waveform_bridge.set_annotations(annotations)
        self._render_result()

    def _replace_annotation_model(
        self,
        annotations: list[WaveformAnnotation],
    ) -> None:
        self.annotation_model.replace(
            {
                "id": item.id,
                "label": item.label,
                "channel": item.channel_name or "All channels",
                "start": item.start_seconds,
                "end": item.end_seconds if item.end_seconds is not None else -1.0,
                "notes": item.notes,
            }
            for item in annotations
        )

    @Slot(str, str, str)
    def saveNsgCredentials(self, username: str, password: str, app_key: str) -> None:
        def task(_progress: Callable[[object], None]) -> object:
            self.backend.save_nsg_credentials(username, password, app_key)
            return self.backend.test_nsg_connection()

        def success(value: object) -> None:
            self._finish_task(
                "NSG credentials verified" if value else "NSG connection failed"
            )

        self._submit(
            task,
            success,
            status="Verifying NSG credentials",
            component="nsgCredentials",
        )

    @Slot()
    def refreshNsgJobs(self) -> None:
        def task(_progress: Callable[[object], None]) -> object:
            return self.backend.list_nsg_jobs()

        def success(value: object) -> None:
            jobs = list(value or [])
            self.nsg_jobs_model.replace(
                {
                    "id": job.job_id,
                    "name": Path(job.input_file_path).name or job.job_id,
                    "status": job.status,
                    "created": job.created_at,
                    "updated": job.last_polled or job.completed_at or "",
                }
                for job in jobs
            )
            self._finish_task(f"{len(jobs)} NSG jobs")

        self._submit(
            task,
            success,
            status="Loading NSG jobs",
            component="nsgJobs",
        )

    def _set_browser(self, path: str, entries: list[BrowserEntry]) -> None:
        self.state.browser_path = path
        self._browser_entries = list(entries)
        self.browser_model.replace(_browser_row(entry) for entry in entries)
        self._save_session()
        self.changed.emit()

    def _zoom_waveform(self, factor: float, anchor: float) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        old_duration = self.state.waveform_viewport_duration_seconds
        min_duration = max(0.05, 4.0 / dataset.dominant_sample_rate_hz)
        new_duration = min(
            dataset.duration_seconds,
            max(min_duration, old_duration * factor),
        )
        anchor_time = self.state.waveform_viewport_start_seconds + anchor * old_duration
        self.state.waveform_viewport_start_seconds = max(
            0.0,
            min(
                dataset.duration_seconds - new_duration,
                anchor_time - anchor * new_duration,
            ),
        )
        self.state.waveform_viewport_duration_seconds = new_duration
        self.refreshWaveform()

    def _pan_waveform(self, delta: float) -> None:
        dataset = self.state.selected_dataset
        if dataset is None:
            return
        duration = self.state.waveform_viewport_duration_seconds
        self.state.waveform_viewport_start_seconds = max(
            0.0,
            min(
                dataset.duration_seconds - duration,
                self.state.waveform_viewport_start_seconds + delta * duration,
            ),
        )
        self.refreshWaveform()

    def _set_result_view(self, start: float, span: float) -> None:
        self.result_bridge.set_view_window(start, span)
        self._render_result()

    def _request_waveform_annotation(self, x: float, y: float) -> None:
        seconds, channel, existing = self.waveform_bridge.annotation_context(x, y)
        self.annotationEditRequested.emit(
            seconds,
            channel or "",
            existing.label if existing else "",
            existing.notes if existing else "",
            existing.end_seconds if existing and existing.end_seconds else -1.0,
            existing.id if existing else "",
            existing is not None and existing.channel_name is None,
        )

    def _save_session(self) -> None:
        self.state_db.save_session_payload(
            {
                "themeMode": self.state.theme_mode,
                "browserPath": self.state.browser_path,
                "expertMode": self._expert_mode,
                "computeDevice": self._compute_device,
                "activeFilePath": self.state.active_file_path,
                "viewport": {
                    "startSeconds": self.state.waveform_viewport_start_seconds,
                    "durationSeconds": self.state.waveform_viewport_duration_seconds,
                },
                "openFiles": list(self.state.open_files),
            }
        )


def _local_path(value: object) -> str:
    if isinstance(value, QUrl):
        return value.toLocalFile()
    text = str(value or "").strip()
    if text.startswith("file:"):
        return QUrl(text).toLocalFile()
    return text


def _is_compute_device(value: str) -> bool:
    return value in {"cpu", "cuda"} or (
        value.startswith("cuda:") and value.removeprefix("cuda:").isdigit()
    )


def _parse_delays(value: str) -> list[int]:
    tokens = str(value).replace(";", ",").replace(" ", ",").split(",")
    delays = [int(token) for token in tokens if token.strip()]
    if not delays or any(delay < 0 for delay in delays):
        raise ValueError("Delays must contain one or more non-negative integers.")
    return delays


def _parse_positive_integers(value: str, label: str) -> list[int]:
    tokens = str(value).replace(";", ",").replace(" ", ",").split(",")
    values = [int(token) for token in tokens if token.strip()]
    if not values or any(item <= 0 for item in values):
        raise ValueError(f"{label} must contain one or more positive integers.")
    return values


def _browser_row(entry: BrowserEntry) -> dict[str, object]:
    return {
        "name": entry.name,
        "path": entry.path,
        "directory": entry.is_directory,
        "supported": entry.supported or entry.is_directory,
        "type": "Folder" if entry.is_directory else (entry.type_label or "File"),
        "size": _format_bytes(entry.size_bytes),
        "search": f"{entry.name} {entry.type_label or ''}".lower(),
    }


def _format_bytes(size: int) -> str:
    value = float(max(0, size))
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024.0 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024.0
    return "0 B"


def _compare_results(
    left: DdaResult | None,
    right: DdaResult | None,
) -> list[dict[str, object]]:
    if left is None or right is None:
        return []
    left_variants = {item.id: item for item in left.materialize().variants}
    right_variants = {item.id: item for item in right.materialize().variants}
    rows: list[dict[str, object]] = []
    for flavor in sorted(left_variants.keys() & right_variants.keys()):
        left_value = _variant_mean_absolute(left_variants[flavor])
        right_value = _variant_mean_absolute(right_variants[flavor])
        rows.append(
            {
                "flavor": flavor,
                "baselineValue": left_value,
                "targetValue": right_value,
                "delta": right_value - left_value,
            }
        )
    return rows


def _variant_mean_absolute(variant: DdaVariantResult) -> float:
    values = [
        abs(float(value))
        for row in variant.matrix
        for value in row
        if math.isfinite(float(value))
    ]
    return sum(values) / len(values) if values else 0.0
