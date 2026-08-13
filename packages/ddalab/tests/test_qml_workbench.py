from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QT_QUICK_BACKEND", "software")

from ddalab_app.app.integrations.cdr import (
    CDR_CONDITIONS,
    aggregate_cdr_results,
    all_pair_indices,
    build_cdr_paper_view,
    find_cdr_recordings,
)
from ddalab_app.app.integrations.cdr_simulation import (
    generate_cdr_recordings,
    simulate_cdr_rossler,
)
from ddalab_app.app.workbench.controller import (
    WorkbenchController,
    _compare_results,
    _local_path,
    _parse_delays,
    _parse_positive_integers,
)
from ddalab_app.app.workbench.models import SelectionListModel
from ddalab_app.app.workbench.runtime import build_workbench, workbench_qml_path
from ddalab_app.domain.models import (
    ChannelDescriptor,
    DdaResult,
    DdaVariantResult,
    IcaResult,
    LoadedDataset,
)
from ddalab_app.persistence.state_db import StateDatabase
from ddalab_app.runtime_paths import RuntimePaths
from ddalab_app.ui.quick_waveform_surface import QuickWaveformTextureItem
from PySide6.QtCore import QCoreApplication, QEvent, QObject, QUrl
from PySide6.QtGui import QGuiApplication


class _Backend:
    def close(self) -> None:
        return None


class _DdaBackend(_Backend):
    def __init__(self) -> None:
        self.run_kwargs: dict[str, object] = {}

    def run_dda(self, **kwargs):
        self.run_kwargs = dict(kwargs)
        return _result("cuda-result", 1.0)

    def compute_devices(self) -> list[dict[str, str]]:
        return [
            {"id": "cpu", "label": "CPU"},
            {"id": "cuda:0", "label": "CUDA 0 (NVIDIA A40)"},
            {"id": "cuda:2", "label": "CUDA 2 (NVIDIA A40)"},
        ]


class QmlPathTests(unittest.TestCase):
    def test_local_path_accepts_qurl_from_batch_dialog(self) -> None:
        path = "/tmp/example.ascii"
        self.assertEqual(_local_path(QUrl.fromLocalFile(path)), path)


def _runtime_paths(root: Path) -> RuntimePaths:
    return RuntimePaths(
        package_root=root,
        source_repo_root=root,
        executable_dir=root,
        executable_path=root / "python",
        is_frozen=False,
        app_bundle_path=None,
        appimage_path=None,
    )


def _dataset(path: Path) -> LoadedDataset:
    return LoadedDataset(
        file_path=str(path),
        file_name=path.name,
        format_label="EDF",
        file_size_bytes=1024,
        duration_seconds=20.0,
        total_sample_count=20_000,
        time_axis_name="time",
        source_summary="test",
        notes=[],
        channels=[
            ChannelDescriptor(f"Channel {index + 1}", 1000.0, 20_000)
            for index in range(10)
        ],
        supports_windowed_access=True,
    )


def _result(result_id: str, scale: float) -> DdaResult:
    return DdaResult(
        id=result_id,
        file_path="/tmp/data.edf",
        file_name="data.edf",
        created_at_iso="2026-01-01T00:00:00Z",
        engine_label="Rust sidecar",
        diagnostics=[],
        window_centers_seconds=[0.0, 1.0],
        variants=[
            DdaVariantResult(
                id="ST",
                label="Single Timeseries",
                row_labels=["a1"],
                matrix=[[scale, -scale]],
                summary="",
                min_value=-scale,
                max_value=scale,
            )
        ],
        is_fallback=False,
    )


def _ica_result(result_id: str, path: Path) -> IcaResult:
    return IcaResult(
        id=result_id,
        file_path=str(path),
        file_name=path.name,
        created_at_iso="2026-01-01T00:00:00Z",
        channel_names=["Channel 1", "Channel 2"],
        sample_rate_hz=1000.0,
        sample_count=20_000,
        components=[],
    )


def _cdr_result(file_name: str, scale: float) -> DdaResult:
    return DdaResult(
        id=file_name,
        file_path=f"/tmp/{file_name}",
        file_name=file_name,
        created_at_iso="2026-01-01T00:00:00Z",
        engine_label="Rust sidecar",
        diagnostics=[],
        window_centers_seconds=[0.0, 1.0],
        variants=[
            DdaVariantResult(
                id=variant_id,
                label=variant_id,
                row_labels=["Channel 1 -> Channel 2"],
                matrix=[[scale, scale * 3]],
                summary="",
                min_value=scale,
                max_value=scale * 3,
            )
            for variant_id in ("CD", "DE")
        ],
        is_fallback=False,
    )


def _create_cdr_recordings(root: Path) -> Path:
    data_dir = root / "data"
    data_dir.mkdir(parents=True)
    conditions = ["NoNoise", *(f"{snr:02d}dB" for snr in range(21))]
    for condition in conditions:
        (
            data_dir
            / f"CD_DDA_data_{condition}__WL4000_WS2000_WN100__FirstExample.ascii"
        ).touch()
    return data_dir


def _full_cdr_summary() -> DdaResult:
    conditions = len(CDR_CONDITIONS)
    directed_pairs = [
        (target, source)
        for left in range(7)
        for right in range(left + 1, 7)
        for target, source in ((left, right), (right, left))
    ]
    undirected_pairs = [
        (left, right) for left in range(7) for right in range(left + 1, 7)
    ]
    return DdaResult(
        id="cdr-summary",
        file_path="/tmp/cdr",
        file_name="CDR batch summary",
        created_at_iso="2026-01-01T00:00:00Z",
        engine_label="CDR batch aggregate",
        diagnostics=[],
        window_centers_seconds=list(range(conditions)),
        variants=[
            DdaVariantResult(
                id="CD",
                label="Causal dependence",
                row_labels=[
                    f"Ch {target} <- Ch {source}" for target, source in directed_pairs
                ],
                matrix=[
                    [
                        0.001 * (target + source + 1) / (condition + 1)
                        for condition in range(conditions)
                    ]
                    for target, source in directed_pairs
                ],
                summary="",
                min_value=0.0,
                max_value=0.01,
                column_count=conditions,
            ),
            DdaVariantResult(
                id="DE",
                label="Dynamical ergodicity",
                row_labels=[
                    f"Ch {left}&Ch {right}" for left, right in undirected_pairs
                ],
                matrix=[
                    [
                        0.1 * (left + right + 1) / (condition + 1)
                        for condition in range(conditions)
                    ]
                    for left, right in undirected_pairs
                ],
                summary="",
                min_value=0.0,
                max_value=1.0,
                column_count=conditions,
            ),
        ],
        is_fallback=False,
    )


class QmlWorkbenchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QGuiApplication.instance() or QGuiApplication([])

    def test_selection_model_updates_rows_without_duplicate_state(self) -> None:
        model = SelectionListModel(("name", "selected"))
        model.replace(
            [
                {"name": "A", "selected": False},
                {"name": "B", "selected": True},
            ]
        )

        model.setSelected(0, True)
        model.selectAll(False)

        self.assertEqual(model.count, 2)
        self.assertEqual(model.selected_rows(), [])

    def test_result_history_includes_all_recordings(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            database = StateDatabase(root / "state.sqlite3")
            first = _result("first", 1.0)
            first.file_path = str(root / "first.edf")
            first.file_name = "first.edf"
            second = _result("second", 2.0)
            second.file_path = str(root / "second.edf")
            second.file_name = "second.edf"
            second.created_at_iso = "2026-01-02T00:00:00Z"
            database.save_dda_result(first)
            database.save_dda_result(second)

            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=database,
            )
            self.assertEqual(controller.history_model.count, 2)
            self.assertEqual(
                {
                    controller.history_model.row(index)["fileName"]
                    for index in range(controller.history_model.count)
                },
                {"first.edf", "second.edf"},
            )
            controller.close()

    def test_component_loading_waits_for_all_overlapping_requests(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            completions: list = []

            with patch.object(
                controller._tasks,
                "submit",
                side_effect=lambda _task,
                success,
                _failed,
                _progress: completions.append(success),
            ):
                for status in ("Loading first waveform", "Loading second waveform"):
                    controller._submit(
                        lambda _progress: None,
                        lambda _value: controller._finish_task(),
                        status=status,
                        component="waveform",
                    )

            self.assertTrue(controller.loadingComponents["waveform"])
            completions[0](None)
            self.assertTrue(controller.loadingComponents["waveform"])
            completions[1](None)
            self.assertNotIn("waveform", controller.loadingComponents)
            self.assertFalse(controller.busy)
            controller.close()

    def test_controller_owns_navigation_and_dataset_selection_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            database = StateDatabase(root / "state.sqlite3")
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=database,
            )

            controller._activate_dataset(_dataset(root / "data.edf"))
            controller.setWorkspaceMode("annotations")
            controller.setAnalysisMode("ica")
            controller.setResultsMode("compare")

            self.assertTrue(controller.datasetLoaded)
            self.assertEqual(controller.channel_model.count, 10)
            self.assertEqual(len(controller.channel_model.selected_rows()), 8)
            self.assertEqual(controller.workspaceMode, "annotations")
            self.assertEqual(controller.analysisMode, "ica")
            self.assertEqual(controller.resultsMode, "compare")
            controller.close()

    def test_workspace_and_dda_navigation_are_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )

            controller.setAnalysisMode("batch")
            controller.showDdaSetup()
            self.assertEqual(controller.currentPage, "analysis")
            self.assertEqual(controller.analysisMode, "dda")

            controller.setWorkspaceMode("annotations")
            controller.showWorkspace()
            self.assertEqual(controller.currentPage, "workspace")
            self.assertEqual(controller.workspaceMode, "inspect")
            controller.close()

    def test_channel_selection_refreshes_the_authoritative_waveform(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "data.edf"))

            with patch.object(controller, "refreshWaveform") as refresh:
                controller.channel_model.setSelected(0, False)

            refresh.assert_called_once_with()
            self.assertEqual(controller.selectedChannelCount, 7)
            self.assertEqual(
                controller.selectedChannelSummary,
                ", ".join(f"Channel {index}" for index in range(2, 9)),
            )
            controller.close()

    def test_opening_a_recording_clears_outputs_and_returns_to_waveform(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "first.edf"))
            controller._set_result(_result("result", 1.0))
            controller.setCurrentPage("results")
            controller.setResultsMode("connectivity")

            controller._activate_dataset(_dataset(root / "second.edf"))

            self.assertFalse(controller.resultAvailable)
            self.assertEqual(controller.variant_model.count, 0)
            self.assertEqual(controller.connectivity_model.count, 0)
            self.assertEqual(controller.currentPage, "workspace")
            self.assertEqual(controller.workspaceMode, "inspect")
            controller.close()

    def test_invalid_analysis_interval_is_rejected_before_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "data.edf"))
            controller.analysisStart = 12.0
            controller.analysisEnd = 8.0
            errors: list[str] = []
            controller.errorRaised.connect(errors.append)

            controller.runDda()

            self.assertFalse(controller.analysisIntervalValid)
            self.assertEqual(errors, ["Analysis start must be before analysis end."])
            controller.close()

    def test_detected_cuda_device_is_persisted_and_passed_to_the_backend(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            backend = _DdaBackend()
            database_path = root / "state.sqlite3"
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=backend,
                state_db=StateDatabase(database_path),
            )
            controller._activate_dataset(_dataset(root / "data.edf"))
            controller._set_compute_devices(backend.compute_devices())
            controller.computeDevice = "cuda:2"
            submitted: dict[str, object] = {}

            with patch.object(
                controller,
                "_submit",
                side_effect=lambda task, _success, **_kwargs: submitted.update(
                    task=task
                ),
            ):
                controller.runDda()

            task = submitted["task"]
            assert callable(task)
            task(lambda _value: None)
            self.assertEqual(backend.run_kwargs["compute_device"], "cuda:2")
            controller.close()

            restored = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(database_path),
            )
            restored._set_compute_devices(backend.compute_devices())
            self.assertEqual(restored.computeDevice, "cuda:2")
            restored.close()

    def test_undetected_cuda_device_cannot_be_selected(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )

            controller.computeDevice = "cuda:0"

            self.assertEqual(controller.computeDevice, "cpu")
            self.assertEqual(controller.computeDeviceModel.count, 1)
            controller.close()

    def test_legacy_cuda_selection_uses_first_detected_device(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            database = StateDatabase(root / "state.sqlite3")
            database.save_session_payload({"computeDevice": "cuda"})
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=database,
            )

            controller._set_compute_devices(
                [
                    {"id": "cpu", "label": "CPU"},
                    {"id": "cuda:1", "label": "CUDA 1"},
                    {"id": "cuda:3", "label": "CUDA 3"},
                ]
            )

            self.assertEqual(controller.computeDevice, "cuda:1")
            controller.close()

    def test_stale_dda_completion_cannot_replace_a_new_recording(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "first.edf"))
            callbacks: list = []

            with patch.object(
                controller,
                "_submit",
                side_effect=lambda _task, success, **_kwargs: callbacks.append(success),
            ):
                controller.runDda()

            controller._activate_dataset(_dataset(root / "second.edf"))
            callbacks[0](_result("stale", 1.0))

            self.assertFalse(controller.resultAvailable)
            self.assertEqual(controller.datasetName, "second.edf")
            self.assertIsNotNone(controller.state_db.load_dda_result_by_id("stale"))
            controller.close()

    def test_stale_ica_completion_is_saved_without_replacing_new_context(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            first_path = root / "first.edf"
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(first_path))
            callbacks: list = []

            with patch.object(
                controller,
                "_submit",
                side_effect=lambda _task, success, **_kwargs: callbacks.append(success),
            ):
                controller.runIca()

            controller._activate_dataset(_dataset(root / "second.edf"))
            callbacks[0](_ica_result("stale-ica", first_path))

            self.assertIsNone(controller.state.ica_result)
            self.assertEqual(controller.ica_model.count, 0)
            self.assertIsNotNone(
                controller.state_db.load_latest_ica_result(str(first_path))
            )
            controller.close()

    def test_dataset_activation_clears_the_previous_waveform_immediately(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "first.edf"))
            controller.state.waveform_window = object()

            with patch.object(controller.waveform_bridge, "clear") as clear:
                controller._activate_dataset(_dataset(root / "second.edf"))

            self.assertIsNone(controller.state.waveform_window)
            clear.assert_called_once_with()
            controller.close()

    def test_annotations_support_all_channels_update_and_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            path = root / "data.edf"
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(path))

            controller.saveAnnotation("Event", "", "", 1.5, -1.0, "")
            annotation = controller.state.annotations_by_file[str(path)][0]
            self.assertIsNone(annotation.channel_name)
            self.assertEqual(
                controller.annotation_model.row(0)["channel"], "All channels"
            )

            controller.saveAnnotation(
                "Updated event",
                "note",
                "Channel 2",
                2.0,
                -1.0,
                annotation.id,
            )
            annotations = controller.state.annotations_by_file[str(path)]
            self.assertEqual(len(annotations), 1)
            self.assertEqual(annotations[0].channel_name, "Channel 2")
            self.assertEqual(annotations[0].label, "Updated event")

            controller.deleteAnnotationById(annotation.id)
            self.assertEqual(controller.state.annotations_by_file[str(path)], [])
            self.assertEqual(controller.annotation_model.count, 0)
            controller.close()

    def test_latest_saved_result_request_wins(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller.history_model.replace(
                [
                    {
                        "id": "first",
                        "fileName": "a",
                        "created": "",
                        "engine": "",
                        "variants": "ST",
                    },
                    {
                        "id": "second",
                        "fileName": "b",
                        "created": "",
                        "engine": "",
                        "variants": "ST",
                    },
                ]
            )
            callbacks: list = []

            with patch.object(
                controller,
                "_submit",
                side_effect=lambda _task, success, **_kwargs: callbacks.append(success),
            ):
                controller.openHistoryResult(0)
                controller.openHistoryResult(1)

            callbacks[0](_result("first", 1.0))
            self.assertFalse(controller.resultAvailable)
            callbacks[1](_result("second", 2.0))
            self.assertEqual(controller._active_result.id, "second")
            controller.close()

    def test_result_routing_and_file_open_stop_replay(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "data.edf"))
            controller._replay_active = True
            controller._replay_timer.start()

            controller._show_results("history")

            self.assertFalse(controller.replayActive)
            self.assertFalse(controller._replay_timer.isActive())
            controller._replay_active = True
            controller._replay_timer.start()
            with patch.object(controller, "_submit"):
                controller.openDataset(str(root / "other.edf"))
            self.assertFalse(controller.replayActive)
            controller.close()

    def test_replay_reaches_terminal_window_and_hidden_expert_values_are_ignored(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "data.edf"))
            controller.state.waveform_viewport_start_seconds = 5.0
            controller.state.waveform_viewport_duration_seconds = 10.0
            controller._replay_active = True
            controller._model_terms_text = "invalid"

            with patch.object(controller, "refreshWaveform"):
                controller._advance_replay()

            self.assertEqual(controller.waveformStart, 10.0)
            self.assertTrue(controller.replayActive)
            self.assertEqual(
                controller._resolved_model_parameters(),
                ([1, 2, 10], 4, 4, 2),
            )
            controller.close()

    def test_visible_waveform_range_can_be_used_for_analysis(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            controller._activate_dataset(_dataset(root / "data.edf"))
            controller.state.waveform_viewport_start_seconds = 4.0
            controller.state.waveform_viewport_duration_seconds = 6.0

            controller.useVisibleWaveformRange()

            self.assertEqual(controller.analysisStart, 4.0)
            self.assertEqual(controller.analysisEnd, 10.0)
            controller.close()

    def test_batch_progress_marks_only_the_active_recording_as_running(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            targets = [str(root / "first.edf"), str(root / "second.edf")]
            with patch.object(controller, "_submit") as submit:
                controller._run_batch(
                    targets,
                    flavors=["ST"],
                    selected_channels=[],
                    use_all_channels=False,
                    window_length=128,
                    window_step=100,
                    delays=[7, 10],
                    model_terms=[1, 2, 10],
                    derivative_points=4,
                    polynomial_order=4,
                    nr_tau=2,
                    compute_device="cpu",
                    cdr_aggregate=False,
                )

            on_progress = submit.call_args.kwargs["on_progress"]
            on_progress(
                {
                    "file": "first.edf",
                    "index": 1,
                    "total": 2,
                    "status": "Running",
                    "stage": "Fitting ST",
                }
            )
            self.assertEqual(controller.batch_model.row(0)["status"], "Running")
            self.assertEqual(controller.batch_model.row(0)["details"], "Fitting ST")
            self.assertEqual(controller.batch_model.row(1)["status"], "Queued")

            on_progress(
                {
                    "file": "first.edf",
                    "index": 1,
                    "total": 2,
                    "status": "Complete",
                    "details": "ST",
                }
            )
            on_progress(
                {
                    "file": "second.edf",
                    "index": 2,
                    "total": 2,
                    "status": "Running",
                }
            )
            self.assertEqual(controller.batch_model.row(0)["status"], "Complete")
            self.assertEqual(controller.batch_model.row(1)["status"], "Running")
            controller.close()

    def test_waveform_viewport_is_restored_for_the_active_recording(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            path = root / "data.edf"
            database = StateDatabase(root / "state.sqlite3")
            database.save_session_payload(
                {
                    "activeFilePath": str(path),
                    "viewport": {"startSeconds": 7.0, "durationSeconds": 5.0},
                }
            )
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=database,
            )

            controller._activate_dataset(_dataset(path))

            self.assertEqual(controller.waveformStart, 7.0)
            self.assertEqual(controller.waveformDuration, 5.0)
            controller.close()

    def test_first_waveform_view_uses_the_default_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )

            controller._activate_dataset(_dataset(root / "data.edf"))

            self.assertEqual(controller.waveformStart, 0.0)
            self.assertEqual(controller.waveformDuration, 10.0)
            controller.close()

    def test_waveform_zoom_carries_to_a_new_recording_and_is_saved(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            database_path = root / "state.sqlite3"
            database = StateDatabase(database_path)
            database.save_session_payload(
                {
                    "activeFilePath": str(root / "old.edf"),
                    "viewport": {"startSeconds": 7.0, "durationSeconds": 5.0},
                }
            )
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=database,
            )

            controller._activate_dataset(_dataset(root / "new.edf"))
            with patch.object(controller, "refreshWaveform"):
                controller._zoom_waveform(2.0, 0.5)

            self.assertEqual(controller.waveformStart, 0.0)
            self.assertEqual(controller.waveformDuration, 10.0)
            controller.close()

            saved = StateDatabase(database_path)
            viewport = saved.load_session_payload()["viewport"]
            self.assertEqual(viewport, {"startSeconds": 0.0, "durationSeconds": 10.0})
            saved.close()

    def test_delay_parser_and_result_comparison_are_deterministic(self) -> None:
        self.assertEqual(_parse_delays("7, 10"), [7, 10])
        self.assertEqual(_parse_positive_integers("1, 2, 6", "MODEL"), [1, 2, 6])
        with self.assertRaisesRegex(ValueError, "non-negative"):
            _parse_delays("-1")

        rows = _compare_results(_result("left", 1.0), _result("right", 2.0))

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["flavor"], "ST")
        self.assertEqual(rows[0]["baselineValue"], 1.0)
        self.assertEqual(rows[0]["targetValue"], 2.0)
        self.assertEqual(rows[0]["delta"], 1.0)

    def test_cdr_pair_generation_and_batch_aggregation(self) -> None:
        pair_map = all_pair_indices([0, 1, 2], ["CD", "DE"])
        self.assertEqual(pair_map["DE"], [(0, 1), (0, 2), (1, 2)])
        self.assertEqual(
            pair_map["CD"],
            [(0, 1), (1, 0), (0, 2), (2, 0), (1, 2), (2, 1)],
        )

        summary = aggregate_cdr_results(
            [
                _cdr_result("CD_DDA_data_15dB__example.ascii", 2.0),
                _cdr_result("CD_DDA_data_NoNoise__example.ascii", 1.0),
            ]
        )

        self.assertIsNotNone(summary)
        assert summary is not None
        self.assertEqual(summary.diagnostics, ["Conditions: no noise, 15 dB"])
        self.assertEqual(summary.engine_label, "CDR batch aggregate")
        self.assertEqual(summary.variants[0].label, "Causal dependence")
        self.assertEqual(summary.variants[0].matrix, [[2.0, 4.0]])

    def test_cdr_paper_view_restores_network_matrices_and_curves(self) -> None:
        view = build_cdr_paper_view(_full_cdr_summary())

        self.assertEqual(len(view["heatmaps"]), 6)
        self.assertEqual(len(view["heatmaps"][0]["matrix"]), 7)
        self.assertEqual(len(view["causalityCurves"]), 42)
        self.assertEqual(len(view["phaseCurves"]), 42)
        clean_values = [curve["values"][0] for curve in view["causalityCurves"]]
        self.assertEqual(clean_values, sorted(clean_values, reverse=True))
        self.assertTrue(
            all(curve["color"].startswith("#") for curve in view["phaseCurves"])
        )
        self.assertEqual(
            {curve["label"] for curve in view["causalityCurves"] if curve["highlight"]},
            {"7 → 1", "3 → 7", "7 → 4", "7 → 5"},
        )

    def test_cdr_qml_uses_concise_copy_and_paper_plot_semantics(self) -> None:
        qml_root = workbench_qml_path().parent
        analysis = (qml_root / "pages" / "AnalysisPage.qml").read_text()
        results = (qml_root / "components" / "CdrResultsView.qml").read_text()

        self.assertNotIn("Run the public CDR example", analysis)
        self.assertNotIn("Generates the seven coupled", analysis)
        self.assertIn('text: "Reproduce CDR"', analysis)
        self.assertIn('title: "C vs SNR"', results)
        self.assertIn("logY: true", results)
        self.assertIn("showMarkers: true", results)

    def test_qml_results_page_has_history_sidebar_and_accelerator_label(self) -> None:
        qml_root = workbench_qml_path().parent
        results = (qml_root / "pages" / "ResultsPage.qml").read_text()
        analysis_inspector = (
            qml_root / "components" / "AnalysisInspector.qml"
        ).read_text()

        self.assertIn('objectName: "resultsHistorySidebar"', results)
        self.assertIn("ResultHistoryList", results)
        self.assertIn('text: "Accelerator"', analysis_inspector)
        self.assertNotIn('text: "Compute"', analysis_inspector)

    def test_cdr_generator_is_deterministic_and_writes_noise_conditions(self) -> None:
        initial_state = np.arange(1, 22, dtype=float) / 100.0
        first = simulate_cdr_rossler(
            sample_count=12,
            initial_state=initial_state,
            transient_steps=4,
        )
        second = simulate_cdr_rossler(
            sample_count=12,
            initial_state=initial_state,
            transient_steps=4,
        )
        self.assertEqual(first.shape, (12, 7))
        self.assertTrue(np.isfinite(first).all())
        np.testing.assert_array_equal(first, second)

        with tempfile.TemporaryDirectory() as tmpdir:
            paths = generate_cdr_recordings(
                tmpdir,
                seed=9,
                sample_count=12,
                noise_levels=(1, 0),
                transient_steps=4,
            )
            self.assertEqual(len(paths), 3)
            self.assertTrue(all(path.is_file() for path in paths))
            self.assertTrue((Path(tmpdir) / "generation.json").is_file())

    def test_cdr_recording_discovery_validates_and_orders_the_series(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            data_dir = _create_cdr_recordings(root)

            recordings = find_cdr_recordings(root)

            self.assertEqual(recordings[0].parent, data_dir)
            self.assertIn("NoNoise", recordings[0].name)
            self.assertIn("20dB", recordings[1].name)
            self.assertIn("00dB", recordings[-1].name)
            self.assertEqual(len(recordings), len(CDR_CONDITIONS))

            recordings[-1].unlink()
            with self.assertRaisesRegex(ValueError, "missing 0 dB"):
                find_cdr_recordings(root)

    def test_included_cdr_action_uses_fixed_settings_and_all_channels(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            data_dir = _create_cdr_recordings(root)
            controller = WorkbenchController(
                _runtime_paths(root),
                bootstrap_backend=False,
                backend=_Backend(),
                state_db=StateDatabase(root / "state.sqlite3"),
            )
            with patch.object(controller, "_run_batch") as run_batch:
                controller._start_cdr_reproduction(data_dir)

            self.assertEqual(len(run_batch.call_args.args[0]), 22)
            self.assertEqual(run_batch.call_args.kwargs["flavors"], ["CD", "DE"])
            self.assertTrue(run_batch.call_args.kwargs["use_all_channels"])
            self.assertEqual(run_batch.call_args.kwargs["window_length"], 4000)
            self.assertEqual(run_batch.call_args.kwargs["window_step"], 2000)
            self.assertEqual(run_batch.call_args.kwargs["delays"], [32, 9])
            self.assertEqual(run_batch.call_args.kwargs["model_terms"], [1, 2, 6])
            self.assertEqual(run_batch.call_args.kwargs["derivative_points"], 4)
            self.assertEqual(run_batch.call_args.kwargs["polynomial_order"], 3)
            self.assertEqual(run_batch.call_args.kwargs["nr_tau"], 2)
            self.assertTrue(run_batch.call_args.kwargs["cdr_aggregate"])
            controller.close()

    def test_qml_shell_is_workbench_based_without_widget_tabs_or_group_boxes(
        self,
    ) -> None:
        qml = workbench_qml_path().read_text(encoding="utf-8")

        self.assertIn("ApplicationWindow", qml)
        self.assertIn("LibraryRail", qml)
        self.assertIn("InspectorPanel", qml)
        self.assertNotIn("QTabBar", qml)
        self.assertNotIn("QGroupBox", qml)

    def test_qml_views_expose_component_loading_feedback(self) -> None:
        qml_root = workbench_qml_path().parent
        qml = "\n".join(
            path.read_text(encoding="utf-8") for path in qml_root.rglob("*.qml")
        )

        for message in (
            "Loading library…",
            "Loading recording…",
            "Loading waveform…",
            "Loading DDA result…",
            "Loading ICA result…",
            "Loading batch recordings…",
            "Loading OpenNeuro datasets…",
            "Loading NSG jobs…",
            "Loading update status…",
        ):
            self.assertIn(message, qml)

    def test_annotation_dialog_exposes_scope_and_delete_controls(self) -> None:
        qml = workbench_qml_path().read_text(encoding="utf-8")

        self.assertIn('text: "All channels"', qml)
        self.assertIn('text: "Delete"', qml)
        self.assertIn("deleteAnnotationById", qml)

    def test_qml_runtime_loads_with_python_controller(self) -> None:
        with (
            tempfile.TemporaryDirectory() as tmpdir,
            patch.dict(
                os.environ,
                {"HOME": tmpdir},
            ),
        ):
            runtime = build_workbench(
                _runtime_paths(Path(tmpdir)),
                bootstrap_backend=False,
            )
            self.app.processEvents()

            self.assertEqual(runtime.window.property("title"), "DDALAB")
            self.assertEqual(runtime.controller.currentPage, "workspace")
            self.assertEqual(
                len(runtime.window.findChildren(QuickWaveformTextureItem)),
                1,
            )

            for page, modes in (
                ("workspace", ("inspect", "annotations", "openneuro")),
                ("analysis", ("dda", "ica", "batch")),
                (
                    "results",
                    ("history", "connectivity", "compare"),
                ),
                ("settings", (None,)),
            ):
                runtime.controller.setCurrentPage(page)
                for mode in modes:
                    if page == "workspace":
                        runtime.controller.setWorkspaceMode(mode)
                    elif page == "analysis":
                        runtime.controller.setAnalysisMode(mode)
                    elif page == "results":
                        runtime.controller.setResultsMode(mode)
                    self.app.processEvents()
                    self.assertEqual(
                        len(runtime.window.findChildren(QuickWaveformTextureItem)),
                        1,
                    )

            runtime.controller.setCurrentPage("results")
            runtime.controller.setResultsMode("history")
            history_sidebar = runtime.window.findChild(QObject, "resultsHistorySidebar")
            self.assertIsNotNone(history_sidebar)
            self.assertTrue(history_sidebar.property("visible"))
            runtime.controller._set_result(_full_cdr_summary())
            self.app.processEvents()
            cdr_view = runtime.window.findChild(QObject, "cdrResultsView")
            self.assertIsNotNone(cdr_view)
            self.assertTrue(cdr_view.property("visible"))

            runtime.window.setProperty("visible", False)
            runtime.window.deleteLater()
            QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)
            self.app.processEvents()
            runtime.controller.close()


if __name__ == "__main__":
    unittest.main()
