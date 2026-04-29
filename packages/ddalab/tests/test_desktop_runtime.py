from __future__ import annotations

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication, QComboBox, QListWidgetItem


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_qt.app.analysis_input import parse_time_bounds
from ddalab_qt.app.main_window_support import (
    ToggleListWidget,
    apply_list_widget_filter,
    configure_searchable_combo_box,
    current_combo_box_value,
    set_check_state_for_list_items,
    sync_searchable_combo_box_selection,
)
from ddalab_qt.app.snapshot_payload import relink_snapshot_payload
from ddalab_qt.backend.api import (
    _find_cli_command,
    _parse_health,
    _supports_rust_direct_file_execution,
)
from ddalab_qt.backend.local_nsg import (
    LocalNsgManager,
    NsgCredentialsStore,
    _parse_job_list_xml,
    _parse_job_status_xml,
    _parse_output_files_xml,
)
from ddalab_qt.backend.local_readers import (
    _nifti_browser_channel_limit,
    _representative_nifti_indices,
)
from ddalab_qt.runtime_paths import RuntimePaths
from ddalab_qt.update_manager import (
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


class SelectorSupportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._app = QApplication.instance() or QApplication([])

    def test_apply_list_widget_filter_hides_non_matching_items(self) -> None:
        selector = ToggleListWidget()
        first = QListWidgetItem("Fp1 · 1000.0 Hz")
        first.setData(Qt.UserRole, "Fp1")
        second = QListWidgetItem("T3 · 500.0 Hz")
        second.setData(Qt.UserRole, "T3")
        selector.addItem(first)
        selector.addItem(second)

        visible_count = apply_list_widget_filter(selector, "fp1")

        self.assertEqual(visible_count, 1)
        self.assertFalse(selector.item(0).isHidden())
        self.assertTrue(selector.item(1).isHidden())

    def test_set_check_state_for_list_items_only_updates_visible_rows(self) -> None:
        selector = ToggleListWidget()
        first = QListWidgetItem("Fp1 · 1000.0 Hz")
        first.setData(Qt.UserRole, "Fp1")
        first.setFlags(first.flags() | Qt.ItemIsUserCheckable)
        first.setCheckState(Qt.Unchecked)
        second = QListWidgetItem("T3 · 500.0 Hz")
        second.setData(Qt.UserRole, "T3")
        second.setFlags(second.flags() | Qt.ItemIsUserCheckable)
        second.setCheckState(Qt.Unchecked)
        selector.addItem(first)
        selector.addItem(second)

        apply_list_widget_filter(selector, "fp1")
        changed = set_check_state_for_list_items(selector, Qt.Checked)

        self.assertEqual(changed, 1)
        self.assertEqual(selector.item(0).checkState(), Qt.Checked)
        self.assertEqual(selector.item(1).checkState(), Qt.Unchecked)

    def test_current_combo_box_value_matches_search_text_case_insensitively(self) -> None:
        combo = QComboBox()
        configure_searchable_combo_box(combo, placeholder="Search channels")
        combo.addItem("Fp1", "Fp1")
        combo.addItem("T3", "T3")
        combo.lineEdit().setText("t3")

        self.assertTrue(combo.isEditable())
        self.assertEqual(current_combo_box_value(combo), "T3")

    def test_sync_searchable_combo_box_selection_restores_visible_choice(self) -> None:
        combo = QComboBox()
        configure_searchable_combo_box(combo, placeholder="Search channels")
        combo.addItem("Fp1", "Fp1")
        combo.addItem("T3", "T3")
        combo.lineEdit().setText("custom search")

        combo.clear()
        combo.addItem("Fp1", "Fp1")
        combo.addItem("T3", "T3")
        sync_searchable_combo_box_selection(combo, preferred_value="T3")

        self.assertEqual(combo.currentIndex(), 1)
        self.assertEqual(combo.currentText(), "T3")
        self.assertEqual(combo.lineEdit().text(), "T3")
        self.assertFalse(combo.lineEdit().isClearButtonEnabled())


class BackendApiTests(unittest.TestCase):
    def test_parse_health_supports_optional_capabilities(self) -> None:
        health = _parse_health(
            {
                "service": "remote",
                "status": "ready",
                "ddaAvailable": True,
                "icaAvailable": True,
                "capabilities": {"nsg": True},
            }
        )
        self.assertTrue(health.nsg_available)

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
            with patch.dict(os.environ, {"DDALAB_CLI_PATH": str(fake_cli)}, clear=False):
                command = _find_cli_command(runtime_paths, Path(tmpdir))
            self.assertIsNone(command)

    def test_supports_rust_direct_file_execution_for_ascii_inputs(self) -> None:
        self.assertTrue(_supports_rust_direct_file_execution("/tmp/input.csv"))
        self.assertTrue(_supports_rust_direct_file_execution("/tmp/input.txt"))
        self.assertTrue(_supports_rust_direct_file_execution("/tmp/input.ascii"))

    def test_supports_rust_direct_file_execution_rejects_edf(self) -> None:
        self.assertFalse(_supports_rust_direct_file_execution("/tmp/input.edf"))


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
        self.assertEqual(
            payload["results_uri"], "https://example.com/results&job=1"
        )
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

            def fake_run(*_args, **_kwargs) -> None:
                binary_path.write_text("binary", encoding="utf-8")

            with patch("scripts.prepare_runtime.shutil.which", return_value="cargo"):
                with patch("scripts.prepare_runtime.subprocess.run", side_effect=fake_run):
                    resolved = _ensure_cli_binary(repo_root, build_cli=True)
            self.assertEqual(resolved, binary_path)


if __name__ == "__main__":
    unittest.main()
