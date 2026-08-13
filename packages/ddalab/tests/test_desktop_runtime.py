from __future__ import annotations

# ruff: noqa: E402
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tomllib

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

import ddalab_app.backend as backend_package
from ddalab_app.app.core.analysis_input import parse_time_bounds
from ddalab_app.app.core.snapshot_payload import relink_snapshot_payload
from ddalab_app.app.integrations.dda_export_utils import _build_reproduction_cli_args
from ddalab_app.backend.dda.sidecar import DdaSidecarClient
from ddalab_app.backend.local import (
    _find_cli_command,
    _supports_rust_direct_file_execution,
)
from ddalab_app.backend.local.dda import (
    _execute_sidecar_dda_group,
    _normalize_compute_device,
)
from ddalab_app.backend.readers.local import (
    _nifti_browser_channel_limit,
    _representative_nifti_indices,
)
from ddalab_app.backend.services.nsg import (
    LocalNsgManager,
    NsgCredentialsStore,
    _parse_job_list_xml,
    _parse_job_status_xml,
    _parse_output_files_xml,
)
from ddalab_app.cli_main import _build_parser
from ddalab_app.domain.models import (
    ChannelDescriptor,
    DdaReproductionConfig,
    DdaResult,
    LoadedDataset,
    NotificationEntry,
)
from ddalab_app.persistence.state_db import StateDatabase
from ddalab_app.runtime_paths import RuntimePaths
from ddalab_app.update_manager import (
    UpdateManager,
    _build_linux_installer_script,
    _build_macos_installer_script,
)

from scripts.prepare_runtime import _ensure_cli_binary


class AnalysisInputTests(unittest.TestCase):
    def test_parse_time_bounds_accepts_blank_end(self) -> None:
        start, end = parse_time_bounds("0", "", label="DDA time range")
        self.assertEqual(start, 0.0)
        self.assertIsNone(end)

    def test_parse_time_bounds_rejects_invalid_number(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid number of seconds"):
            parse_time_bounds("abc", "", label="DDA time range")

    def test_parse_time_bounds_rejects_reversed_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "greater than the start time"):
            parse_time_bounds("10", "5", label="DDA time range")


class SnapshotPayloadTests(unittest.TestCase):
    def test_relink_snapshot_payload_updates_known_file_paths(self) -> None:
        payload = {
            "activeFilePath": "/old/data.edf",
            "openFiles": ["/old/data.edf", "/old/other.edf"],
            "pinnedFiles": ["/old/data.edf"],
            "annotationsByFile": {"/old/data.edf": [{"label": "A"}]},
            "ddaResult": {"filePath": "/old/data.edf"},
            "icaResult": {"file_path": "/old/data.edf"},
        }
        rewritten = relink_snapshot_payload(
            payload,
            old_path="/old/data.edf",
            new_path="/new/data.edf",
        )
        self.assertEqual(rewritten["activeFilePath"], "/new/data.edf")
        self.assertEqual(
            rewritten["openFiles"],
            ["/new/data.edf", "/old/other.edf"],
        )
        self.assertEqual(rewritten["pinnedFiles"], ["/new/data.edf"])
        self.assertIn("/new/data.edf", rewritten["annotationsByFile"])
        self.assertEqual(rewritten["ddaResult"]["filePath"], "/new/data.edf")
        self.assertEqual(rewritten["icaResult"]["file_path"], "/new/data.edf")


class BackendApiTests(unittest.TestCase):
    def test_pyproject_uses_single_gui_package(self) -> None:
        pyproject = tomllib.loads((PACKAGE_ROOT / "pyproject.toml").read_text())
        scripts = pyproject["project"]["scripts"]
        package_include = pyproject["tool"]["setuptools"]["packages"]["find"]["include"]

        self.assertEqual(scripts["ddalab"], "ddalab_app.__main__:main")
        self.assertEqual(scripts["ddalab-cli"], "ddalab_app.__main__:main")
        self.assertEqual(scripts["ddalab-gui"], "ddalab_app.gui_main:main")
        self.assertEqual(package_include, ["ddalab_app*"])

    def test_gui_command_no_longer_accepts_remote_server_flag(self) -> None:
        parser = _build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(["gui", "--server", "http://127.0.0.1:8000"])

    def test_backend_package_exports_local_clients_only(self) -> None:
        self.assertFalse(hasattr(backend_package, "RemoteBackendClient"))
        self.assertTrue(hasattr(backend_package, "LocalBackendClient"))
        self.assertTrue(hasattr(backend_package, "OpenNeuroClient"))

    def test_sidecar_cuda_inventory_ignores_malformed_records(self) -> None:
        client = DdaSidecarClient(cli_command=["ddalab"], cwd="/tmp")
        payload = [
            {"index": 0, "name": "NVIDIA A40"},
            "invalid",
            {"index": 1, "name": "NVIDIA A40"},
        ]
        with patch.object(client, "request", return_value=payload):
            self.assertEqual(client.cuda_devices(), [payload[0], payload[2]])

    def test_find_cli_command_rejects_non_executable_env_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            fake_cli = Path(tmpdir) / "ddalab"
            fake_cli.write_text("not executable", encoding="utf-8")
            runtime_paths = RuntimePaths(
                package_root=Path(tmpdir) / "package",
                source_repo_root=None,
                executable_dir=Path(tmpdir),
                executable_path=Path(tmpdir) / "python",
                is_frozen=False,
                app_bundle_path=None,
                appimage_path=None,
            )
            with patch.dict(
                os.environ, {"DDALAB_CLI_PATH": str(fake_cli)}, clear=False
            ):
                command = _find_cli_command(runtime_paths, Path(tmpdir))
            self.assertIsNone(command)

    def test_supports_rust_direct_file_execution_for_ascii_inputs(self) -> None:
        self.assertTrue(_supports_rust_direct_file_execution("/tmp/input.csv"))
        self.assertTrue(_supports_rust_direct_file_execution("/tmp/input.txt"))
        self.assertTrue(_supports_rust_direct_file_execution("/tmp/input.ascii"))

    def test_supports_rust_direct_file_execution_rejects_edf(self) -> None:
        self.assertFalse(_supports_rust_direct_file_execution("/tmp/input.edf"))

    def test_compute_device_validation_accepts_cuda_indices(self) -> None:
        self.assertEqual(_normalize_compute_device("cpu"), "cpu")
        self.assertEqual(_normalize_compute_device("CUDA"), "cuda")
        self.assertEqual(_normalize_compute_device("cuda:2"), "cuda:2")
        with self.assertRaisesRegex(RuntimeError, "expected cpu, cuda, or cuda:N"):
            _normalize_compute_device("metal")

    def test_sidecar_request_includes_selected_compute_device(self) -> None:
        class Sidecar:
            payload: dict = {}

            def run_group(self, params, *, on_progress=None):
                del on_progress
                self.payload = dict(params)
                return {"id": "test", "backend": "pure-rust", "result": {}}

        dataset = LoadedDataset(
            file_path="/tmp/input.csv",
            file_name="input.csv",
            format_label="CSV",
            file_size_bytes=128,
            duration_seconds=1.0,
            total_sample_count=128,
            time_axis_name="time",
            source_summary="test",
            notes=[],
            channels=[ChannelDescriptor("A", 128.0, 128)],
            supports_windowed_access=True,
        )
        sidecar = Sidecar()
        with patch(
            "ddalab_app.backend.local.dda._get_dda_sidecar",
            return_value=sidecar,
        ):
            _execute_sidecar_dda_group(
                client=object(),
                cli_command=["ddalab"],
                repo_root=Path("/tmp"),
                dataset=dataset,
                selected_channel_indices=[0],
                cli_selected_indices=[0],
                input_path=Path(dataset.file_path),
                variants=["ST"],
                window_length_samples=32,
                window_step_samples=16,
                delays=[1, 2],
                requested_start_sample=0,
                safe_end_sample=127,
                sample_rate=128.0,
                base_diagnostics=[],
                requested_start_seconds=0.0,
                group_label="Combined",
                compute_device="cuda:2",
            )
        self.assertEqual(sidecar.payload["device"], "cuda:2")

    def test_reproduction_command_preserves_compute_device(self) -> None:
        result = DdaResult(
            id="result",
            file_path="/tmp/input.csv",
            file_name="input.csv",
            created_at_iso="2026-01-01T00:00:00Z",
            engine_label="DDA (CUDA)",
            diagnostics=[],
            window_centers_seconds=[],
            variants=[],
            is_fallback=False,
        )
        reproduction = DdaReproductionConfig(
            compute_device="cuda",
            variant_ids=["ST"],
            selected_channel_indices=[0],
            window_length_samples=32,
            window_step_samples=16,
            delays=[1, 2],
            model_terms=[1, 2, 10],
            model_dimension=4,
            polynomial_order=4,
            nr_tau=2,
            end_time_seconds=1.0,
        )
        args = _build_reproduction_cli_args(result, reproduction)
        device_index = args.index("--device")
        self.assertEqual(args[device_index + 1], "cuda")

    def test_cli_accepts_cuda_device_selection(self) -> None:
        args = _build_parser().parse_args(
            ["dda", "run", "--file", "/tmp/input.csv", "--device", "cuda:1"]
        )
        self.assertEqual(args.device, "cuda:1")


class LocalReaderTests(unittest.TestCase):
    def test_representative_nifti_indices_caps_output(self) -> None:
        indices = _representative_nifti_indices(10_000, 4)
        self.assertEqual(indices[0], 0)
        self.assertEqual(indices[-1], 9_999)
        self.assertEqual(len(indices), 4)

    def test_representative_nifti_indices_returns_all_when_limit_disabled(self) -> None:
        self.assertEqual(_representative_nifti_indices(8, 0), list(range(8)))

    def test_nifti_browser_channel_limit_honors_env_override(self) -> None:
        with patch.dict(
            os.environ,
            {"DDALAB_NIFTI_BROWSER_CHANNEL_LIMIT": "1024"},
            clear=False,
        ):
            self.assertEqual(_nifti_browser_channel_limit(), 1024)


class LocalNsgTests(unittest.TestCase):
    def test_credentials_store_round_trips_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            store = NsgCredentialsStore(Path(tmpdir))
            store.save("alice", "secret", "app-key")
            status = store.status()
            self.assertIsNotNone(status)
            assert status is not None
            self.assertEqual(status.username, "alice")
            self.assertTrue(status.has_password)
            self.assertTrue(status.has_app_key)
            store.delete()
            self.assertIsNone(store.status())

    def test_parse_job_list_xml_extracts_handles_and_urls(self) -> None:
        xml = """
        <joblist>
          <jobs>
            <jobstatus>
              <selfUri>
                <url>https://nsgr.sdsc.edu/job/user/JOB-1</url>
                <title>JOB-1</title>
              </selfUri>
            </jobstatus>
            <jobstatus>
              <selfUri>
                <title>JOB-2</title>
              </selfUri>
            </jobstatus>
          </jobs>
        </joblist>
        """
        jobs = _parse_job_list_xml(
            xml,
            base_url="https://nsgr.sdsc.edu:8443/cipresrest/v1",
            username="user",
        )
        self.assertEqual(
            jobs,
            [
                ("JOB-1", "https://nsgr.sdsc.edu/job/user/JOB-1"),
                (
                    "JOB-2",
                    "https://nsgr.sdsc.edu:8443/cipresrest/v1/job/user/JOB-2",
                ),
            ],
        )

    def test_parse_job_status_xml_extracts_status_results_and_messages(self) -> None:
        xml = """
        <jobStatusResponse>
          <jobStage>COMPLETED</jobStage>
          <failed>false</failed>
          <dateSubmitted>2026-04-28T10:00:00Z</dateSubmitted>
          <dateCompleted>2026-04-28T11:00:00Z</dateCompleted>
          <resultsUri><url>https://example.com/results&amp;job=1</url></resultsUri>
          <messages>
            <message><text>Finished successfully</text></message>
          </messages>
          <jobfile>
            <filename>results.tar.gz</filename>
            <length>512</length>
            <downloadUri><url>https://example.com/download&amp;file=1</url></downloadUri>
          </jobfile>
        </jobStatusResponse>
        """
        payload = _parse_job_status_xml(xml)
        self.assertEqual(payload["status"], "completed")
        self.assertEqual(payload["results_uri"], "https://example.com/results&job=1")
        self.assertEqual(payload["submitted_at"], "2026-04-28T10:00:00Z")
        self.assertEqual(payload["completed_at"], "2026-04-28T11:00:00Z")
        self.assertEqual(payload["messages"], ["Finished successfully"])
        self.assertEqual(
            payload["output_files"],
            [
                {
                    "filename": "results.tar.gz",
                    "download_uri": "https://example.com/download&file=1",
                    "length": 512,
                }
            ],
        )

    def test_parse_output_files_xml_extracts_download_targets(self) -> None:
        xml = """
        <results>
          <jobfile>
            <filename>one.txt</filename>
            <length>10</length>
            <downloadUri><url>https://example.com/one</url></downloadUri>
          </jobfile>
          <jobfile>
            <filename>two.txt</filename>
            <length>20</length>
            <downloadUri><url>https://example.com/two</url></downloadUri>
          </jobfile>
        </results>
        """
        self.assertEqual(
            _parse_output_files_xml(xml),
            [
                {
                    "filename": "one.txt",
                    "download_uri": "https://example.com/one",
                    "length": 10,
                },
                {
                    "filename": "two.txt",
                    "download_uri": "https://example.com/two",
                    "length": 20,
                },
            ],
        )

    def test_local_nsg_manager_requires_credentials_for_job_listing(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            runtime_paths = RuntimePaths(
                package_root=Path(tmpdir) / "package",
                source_repo_root=None,
                executable_dir=Path(tmpdir),
                executable_path=Path(tmpdir) / "python",
                is_frozen=False,
                app_bundle_path=None,
                appimage_path=None,
            )
            manager = LocalNsgManager(runtime_paths, base_dir=Path(tmpdir) / "state")
            self.assertEqual(manager.list_jobs(), [])
            manager.close()


class UpdateScriptTests(unittest.TestCase):
    def test_macos_installer_script_logs_and_restores_backup(self) -> None:
        script = _build_macos_installer_script(
            current_pid=123,
            target_app=Path("/Applications/DDALAB.app"),
            extracted_app=Path("/tmp/DDALAB.app"),
            installer_log_path=Path("/tmp/ddalab-update.log"),
        )
        self.assertIn('exec >>"$LOG_FILE" 2>&1', script)
        self.assertIn('BACKUP="${TARGET}.previous"', script)
        self.assertIn("restore_backup()", script)
        self.assertIn('open "$TARGET"', script)

    def test_linux_installer_script_logs_and_restores_backup(self) -> None:
        script = _build_linux_installer_script(
            current_pid=123,
            target_binary=Path("/opt/DDALAB/DDALAB"),
            downloaded_binary=Path("/tmp/DDALAB"),
            installer_log_path=Path("/tmp/ddalab-update.log"),
        )
        self.assertIn('exec >>"$LOG_FILE" 2>&1', script)
        self.assertIn('BACKUP="${TARGET}.previous"', script)
        self.assertIn("restore_backup()", script)
        self.assertIn('"$TARGET" &', script)


class StateDatabaseSqlSafetyTests(unittest.TestCase):
    def _open_db(self, directory: str) -> StateDatabase:
        return StateDatabase(Path(directory) / "state.sqlite3")

    def test_session_values_are_bound_as_data(self) -> None:
        injection_text = "x'); DROP TABLE session_state; --"
        with tempfile.TemporaryDirectory() as tmpdir:
            db = self._open_db(tmpdir)
            try:
                db.save_session_payload(
                    {
                        "openFiles": [injection_text],
                        "activeFilePath": injection_text,
                    }
                )

                payload = db.load_session_payload()
                self.assertEqual(payload["openFiles"], [injection_text])
                self.assertEqual(payload["activeFilePath"], injection_text)
            finally:
                db.close()

    def test_default_database_uses_ddalab_home_and_migrates_legacy_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            legacy_path = home / ".ddalab-qt" / "state.sqlite3"
            legacy = StateDatabase(legacy_path)
            legacy.save_session_payload({"activeFilePath": "/tmp/example.edf"})
            legacy.close()

            with patch("ddalab_app.persistence.state_db.Path.home", return_value=home):
                db = StateDatabase()
            try:
                self.assertEqual(db.db_path, home / ".ddalab" / "state.sqlite3")
                self.assertEqual(
                    db.load_session_payload()["activeFilePath"],
                    "/tmp/example.edf",
                )
            finally:
                db.close()

    def test_dynamic_sql_identifiers_are_validated_before_execution(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db = self._open_db(tmpdir)
            try:
                with self.assertRaises(ValueError):
                    db._replace_timestamped_payload_rows(
                        "notifications; DROP TABLE notifications; --",
                        "notification_id",
                        [],
                    )

                entry = NotificationEntry(
                    id="safe",
                    category="system",
                    level="info",
                    title="Still Available",
                    message="notifications table was not modified by invalid SQL",
                    created_at_iso="2026-01-01T00:00:00Z",
                )
                db.replace_notifications([entry])
                self.assertEqual(db.load_notifications(), [entry])
            finally:
                db.close()


class UpdateManagerTests(unittest.TestCase):
    def test_linux_updates_expect_appimage_assets(self) -> None:
        runtime_paths = RuntimePaths(
            package_root=Path("/tmp/package"),
            source_repo_root=None,
            executable_dir=Path("/tmp"),
            executable_path=Path("/tmp/DDALAB"),
            is_frozen=True,
            app_bundle_path=None,
            appimage_path=Path("/tmp/DDALAB.AppImage"),
        )

        class LinuxManager(UpdateManager):
            @property
            def platform_name(self) -> str:
                return "linux"

            @property
            def architecture(self) -> str:
                return "x64"

        manager = LinuxManager(runtime_paths, "1.0.0")
        self.assertEqual(manager._supported_asset_suffix(), "-linux-x64.AppImage")


class PrepareRuntimeTests(unittest.TestCase):
    def test_ensure_cli_binary_requires_release_binary_when_not_building(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            (repo_root / "packages" / "dda-rs" / "target" / "release").mkdir(
                parents=True
            )
            (repo_root / "packages" / "dda-rs" / "Cargo.toml").write_text(
                "[package]\nname='dda-rs'\nversion='0.1.0'\n",
                encoding="utf-8",
            )
            with self.assertRaises(FileNotFoundError):
                _ensure_cli_binary(repo_root, build_cli=False)

    def test_ensure_cli_binary_builds_release_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo_root = Path(tmpdir)
            release_dir = repo_root / "packages" / "dda-rs" / "target" / "release"
            release_dir.mkdir(parents=True)
            binary_path = release_dir / ("ddalab.exe" if os.name == "nt" else "ddalab")
            manifest = repo_root / "packages" / "dda-rs" / "Cargo.toml"
            manifest.write_text(
                "[package]\nname='dda-rs'\nversion='0.1.0'\n",
                encoding="utf-8",
            )

            commands: list[list[str]] = []

            def fake_run(command, **_kwargs) -> None:
                commands.append(command)
                binary_path.write_text("binary", encoding="utf-8")

            with patch("scripts.prepare_runtime.shutil.which", return_value="cargo"):
                with patch(
                    "scripts.prepare_runtime.subprocess.run", side_effect=fake_run
                ):
                    resolved = _ensure_cli_binary(repo_root, build_cli=True)
            self.assertEqual(resolved, binary_path)
            self.assertIn("--features", commands[0])
            self.assertIn("cuda", commands[0])


if __name__ == "__main__":
    unittest.main()
