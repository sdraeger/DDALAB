from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Deque, List, Optional, Tuple

import requests

from ..domain.file_types import (
    classify_path,
    is_bridge_native_path,
    supports_qt_dataset_path,
)
from ..domain.models import (
    BrowserEntry,
    DdaResult,
    IcaResult,
    LoadedDataset,
    NsgCredentialsStatus,
    NsgJobSnapshot,
    OpenNeuroDataset,
    PluginExecutionResult,
    PluginInstalledEntry,
    PluginRegistryEntry,
    WaveformOverview,
    WaveformWindow,
)
from ..runtime_paths import RuntimePaths


OPEN_NEURO_GRAPHQL_ENDPOINT = "https://openneuro.org/crn/graphql"
OPEN_NEURO_BATCH_QUERY = """
query PublicDatasets($after: String, $first: Int!) {
  datasets(first: $first, after: $after) {
    edges {
      cursor
      node {
        id
        latestSnapshot {
          tag
          created
          description {
            Name
          }
          summary {
            modalities
            subjects
            tasks
            size
            totalFiles
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
"""


@dataclass
class ApiHealth:
    service: str
    status: str
    dda_available: bool
    ica_available: bool
    diagnostics: List[str]


class BackendClient(ABC):
    @property
    @abstractmethod
    def connection_label(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def health(self) -> ApiHealth:
        raise NotImplementedError

    @abstractmethod
    def default_root(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def list_directory(self, path: str) -> Tuple[str, List[BrowserEntry]]:
        raise NotImplementedError

    @abstractmethod
    def load_dataset(self, path: str) -> LoadedDataset:
        raise NotImplementedError

    @abstractmethod
    def load_waveform_window(
        self,
        path: str,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: List[str],
    ) -> WaveformWindow:
        raise NotImplementedError

    @abstractmethod
    def load_waveform_overview(
        self,
        path: str,
        channel_names: List[str],
        max_buckets: int = 1600,
    ) -> WaveformOverview:
        raise NotImplementedError

    @abstractmethod
    def run_dda(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        selected_variants: List[str],
        window_length_samples: int,
        window_step_samples: int,
        delays: List[int],
        start_time_seconds: float,
        end_time_seconds: Optional[float],
    ) -> DdaResult:
        raise NotImplementedError

    @abstractmethod
    def run_ica(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        start_time_seconds: Optional[float],
        end_time_seconds: Optional[float],
        n_components: Optional[int],
        max_iterations: int,
        tolerance: float,
        centering: bool,
        whitening: bool,
    ) -> IcaResult:
        raise NotImplementedError

    @abstractmethod
    def list_installed_plugins(self) -> List[PluginInstalledEntry]:
        raise NotImplementedError

    @abstractmethod
    def fetch_plugin_registry(self) -> List[PluginRegistryEntry]:
        raise NotImplementedError

    @abstractmethod
    def install_plugin(self, plugin_id: str) -> PluginInstalledEntry:
        raise NotImplementedError

    @abstractmethod
    def uninstall_plugin(self, plugin_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> bool:
        raise NotImplementedError

    @abstractmethod
    def run_plugin(
        self,
        plugin_id: str,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
    ) -> PluginExecutionResult:
        raise NotImplementedError

    @abstractmethod
    def get_nsg_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        raise NotImplementedError

    @abstractmethod
    def save_nsg_credentials(
        self,
        username: str,
        password: str,
        app_key: str,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def delete_nsg_credentials(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def test_nsg_connection(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def list_nsg_jobs(self) -> List[NsgJobSnapshot]:
        raise NotImplementedError

    @abstractmethod
    def create_nsg_job(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        selected_variants: List[str],
        window_length_samples: int,
        window_step_samples: int,
        delays: List[int],
        start_time_seconds: float,
        end_time_seconds: Optional[float],
        runtime_hours: Optional[float],
        cores: Optional[int],
        nodes: Optional[int],
    ) -> NsgJobSnapshot:
        raise NotImplementedError

    @abstractmethod
    def submit_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise NotImplementedError

    @abstractmethod
    def refresh_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise NotImplementedError

    @abstractmethod
    def cancel_nsg_job(self, job_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def download_nsg_results(self, job_id: str) -> List[str]:
        raise NotImplementedError

    def close(self) -> None:
        return None


class _RequestsSessionPool:
    def __init__(
        self,
        headers: Optional[dict[str, str]] = None,
        *,
        pool_connections: int = 8,
        pool_maxsize: int = 8,
    ) -> None:
        self._headers = headers or {}
        self._pool_connections = pool_connections
        self._pool_maxsize = pool_maxsize
        self._local = threading.local()
        self._lock = threading.Lock()
        self._sessions: list[requests.Session] = []

    def session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is not None:
            return session
        session = requests.Session()
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=self._pool_connections,
            pool_maxsize=self._pool_maxsize,
            max_retries=0,
        )
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        session.headers.update(self._headers)
        with self._lock:
            self._sessions.append(session)
        self._local.session = session
        return session

    def close(self) -> None:
        with self._lock:
            sessions = list(self._sessions)
            self._sessions.clear()
        for session in sessions:
            try:
                session.close()
            except Exception:
                continue


class RemoteBackendClient(BackendClient):
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self._headers = {"Content-Type": "application/json"}
        self._session_pool = _RequestsSessionPool(self._headers)

    @property
    def connection_label(self) -> str:
        return self.base_url

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        timeout: int,
        payload: Optional[dict] = None,
    ) -> dict:
        response = self._session_pool.session().request(
            method,
            self._url(path),
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        parsed = response.json()
        return parsed if isinstance(parsed, dict) else {}

    def health(self) -> ApiHealth:
        return _parse_health(self._request_json("GET", "/api/health", timeout=15))

    def default_root(self) -> str:
        return self._request_json("GET", "/api/fs/root", timeout=15)["path"]

    def list_directory(self, path: str) -> Tuple[str, List[BrowserEntry]]:
        payload = self._request_json(
            "POST",
            "/api/fs/list",
            payload={"path": path},
            timeout=30,
        )
        return payload["path"], _annotate_entries(
            BrowserEntry.from_json(item) for item in payload.get("entries", [])
        )

    def load_dataset(self, path: str) -> LoadedDataset:
        return LoadedDataset.from_json(
            self._request_json(
                "POST",
                "/api/datasets/metadata",
                payload={"path": path},
                timeout=60,
            )
        )

    def load_waveform_window(
        self,
        path: str,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: List[str],
    ) -> WaveformWindow:
        return WaveformWindow.from_json(
            self._request_json(
                "POST",
                "/api/datasets/waveform/window",
                payload={
                    "path": path,
                    "startTimeSeconds": start_time_seconds,
                    "durationSeconds": duration_seconds,
                    "channelNames": channel_names,
                },
                timeout=120,
            )
        )

    def load_waveform_overview(
        self,
        path: str,
        channel_names: List[str],
        max_buckets: int = 1600,
    ) -> WaveformOverview:
        return WaveformOverview.from_json(
            self._request_json(
                "POST",
                "/api/datasets/waveform/overview",
                payload={
                    "path": path,
                    "channelNames": channel_names,
                    "maxBuckets": max_buckets,
                },
                timeout=120,
            )
        )

    def run_dda(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        selected_variants: List[str],
        window_length_samples: int,
        window_step_samples: int,
        delays: List[int],
        start_time_seconds: float,
        end_time_seconds: Optional[float],
    ) -> DdaResult:
        payload = self._request_json(
            "POST",
            "/api/analysis/dda/by-path",
            payload=_build_dda_request(
                dataset=dataset,
                selected_channel_indices=selected_channel_indices,
                selected_variants=selected_variants,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
                start_time_seconds=start_time_seconds,
                end_time_seconds=end_time_seconds,
            ),
            timeout=300,
        )
        return DdaResult.from_json(payload["result"])

    def run_ica(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        start_time_seconds: Optional[float],
        end_time_seconds: Optional[float],
        n_components: Optional[int],
        max_iterations: int,
        tolerance: float,
        centering: bool,
        whitening: bool,
    ) -> IcaResult:
        payload = self._request_json(
            "POST",
            "/api/analysis/ica/by-path",
            payload=_build_ica_request(
                dataset=dataset,
                selected_channel_indices=selected_channel_indices,
                start_time_seconds=start_time_seconds,
                end_time_seconds=end_time_seconds,
                n_components=n_components,
                max_iterations=max_iterations,
                tolerance=tolerance,
                centering=centering,
                whitening=whitening,
            ),
            timeout=300,
        )
        return IcaResult.from_json(payload["result"])

    def close(self) -> None:
        self._session_pool.close()

    def list_installed_plugins(self) -> List[PluginInstalledEntry]:
        raise RuntimeError(
            "Plugin management is only available through the local desktop bridge."
        )

    def fetch_plugin_registry(self) -> List[PluginRegistryEntry]:
        raise RuntimeError(
            "Plugin management is only available through the local desktop bridge."
        )

    def install_plugin(self, plugin_id: str) -> PluginInstalledEntry:
        raise RuntimeError(
            "Plugin management is only available through the local desktop bridge."
        )

    def uninstall_plugin(self, plugin_id: str) -> None:
        raise RuntimeError(
            "Plugin management is only available through the local desktop bridge."
        )

    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> bool:
        raise RuntimeError(
            "Plugin management is only available through the local desktop bridge."
        )

    def run_plugin(
        self,
        plugin_id: str,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
    ) -> PluginExecutionResult:
        raise RuntimeError(
            "Plugin execution is only available through the local desktop bridge."
        )

    def get_nsg_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def save_nsg_credentials(
        self,
        username: str,
        password: str,
        app_key: str,
    ) -> None:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def delete_nsg_credentials(self) -> None:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def test_nsg_connection(self) -> bool:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def list_nsg_jobs(self) -> List[NsgJobSnapshot]:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def create_nsg_job(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        selected_variants: List[str],
        window_length_samples: int,
        window_step_samples: int,
        delays: List[int],
        start_time_seconds: float,
        end_time_seconds: Optional[float],
        runtime_hours: Optional[float],
        cores: Optional[int],
        nodes: Optional[int],
    ) -> NsgJobSnapshot:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def submit_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def refresh_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def cancel_nsg_job(self, job_id: str) -> None:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )

    def download_nsg_results(self, job_id: str) -> List[str]:
        raise RuntimeError(
            "NSG integration is only available through the local desktop bridge."
        )


class LocalBackendClient(BackendClient):
    def __init__(self, runtime_paths: RuntimePaths) -> None:
        self.runtime_paths = runtime_paths
        self.repo_root = runtime_paths.source_repo_root
        self.kmp_root = runtime_paths.local_bridge_build_root()
        self._process: Optional[subprocess.Popen[str]] = None
        self._lock = threading.Lock()
        self._stderr_tail: Deque[str] = deque(maxlen=40)
        self._stderr_thread: Optional[threading.Thread] = None

    @property
    def connection_label(self) -> str:
        return "Local bridge"

    def health(self) -> ApiHealth:
        payload = self._request("health")
        return _parse_health(payload)

    def default_root(self) -> str:
        payload = self._request("default_root")
        return payload["path"]

    def list_directory(self, path: str) -> Tuple[str, List[BrowserEntry]]:
        payload = self._request("list_directory", {"path": path})
        return payload["path"], _annotate_entries(
            BrowserEntry.from_json(item) for item in payload.get("entries", [])
        )

    def load_dataset(self, path: str) -> LoadedDataset:
        if self._should_use_python_reader(path):
            return _python_dataset_reader(path).load_metadata()
        return LoadedDataset.from_json(self._request("load_dataset", {"path": path}))

    def load_waveform_window(
        self,
        path: str,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: List[str],
    ) -> WaveformWindow:
        if self._should_use_python_reader(path):
            return _python_dataset_reader(path).load_waveform_window(
                start_time_seconds,
                duration_seconds,
                channel_names,
            )
        return WaveformWindow.from_json(
            self._request(
                "load_waveform_window",
                {
                    "path": path,
                    "startTimeSeconds": start_time_seconds,
                    "durationSeconds": duration_seconds,
                    "channelNames": channel_names,
                },
            ),
        )

    def load_waveform_overview(
        self,
        path: str,
        channel_names: List[str],
        max_buckets: int = 1600,
    ) -> WaveformOverview:
        if self._should_use_python_reader(path):
            return _python_dataset_reader(path).load_waveform_overview(
                channel_names,
                max_buckets,
            )
        return WaveformOverview.from_json(
            self._request(
                "load_waveform_overview",
                {
                    "path": path,
                    "channelNames": channel_names,
                    "maxBuckets": max_buckets,
                },
            ),
        )

    def run_dda(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        selected_variants: List[str],
        window_length_samples: int,
        window_step_samples: int,
        delays: List[int],
        start_time_seconds: float,
        end_time_seconds: Optional[float],
    ) -> DdaResult:
        payload = self._request(
            "run_dda",
            _build_dda_request(
                dataset=dataset,
                selected_channel_indices=selected_channel_indices,
                selected_variants=selected_variants,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
                start_time_seconds=start_time_seconds,
                end_time_seconds=end_time_seconds,
            ),
        )
        result = DdaResult.from_json(payload["result"])
        result.diagnostics = [
            line.replace("via Ktor server", "via local bridge")
            for line in result.diagnostics
        ]
        return result

    def run_ica(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        start_time_seconds: Optional[float],
        end_time_seconds: Optional[float],
        n_components: Optional[int],
        max_iterations: int,
        tolerance: float,
        centering: bool,
        whitening: bool,
    ) -> IcaResult:
        payload = self._request(
            "run_ica",
            _build_ica_request(
                dataset=dataset,
                selected_channel_indices=selected_channel_indices,
                start_time_seconds=start_time_seconds,
                end_time_seconds=end_time_seconds,
                n_components=n_components,
                max_iterations=max_iterations,
                tolerance=tolerance,
                centering=centering,
                whitening=whitening,
            ),
        )
        result = IcaResult.from_json(payload["result"])
        result.diagnostics = [
            line.replace("via Ktor server", "via local bridge")
            for line in result.diagnostics
        ]
        return result

    def list_installed_plugins(self) -> List[PluginInstalledEntry]:
        payload = self._request("plugin_list")
        return [
            PluginInstalledEntry.from_json(item) for item in payload.get("plugins", [])
        ]

    def fetch_plugin_registry(self) -> List[PluginRegistryEntry]:
        payload = self._request("plugin_fetch_registry")
        return [
            PluginRegistryEntry.from_json(item) for item in payload.get("plugins", [])
        ]

    def install_plugin(self, plugin_id: str) -> PluginInstalledEntry:
        payload = self._request("plugin_install", {"pluginId": plugin_id})
        return PluginInstalledEntry.from_json(payload)

    def uninstall_plugin(self, plugin_id: str) -> None:
        self._request("plugin_uninstall", {"pluginId": plugin_id})

    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> bool:
        payload = self._request(
            "plugin_set_enabled",
            {"pluginId": plugin_id, "enabled": enabled},
        )
        return bool(payload.get("enabled", enabled))

    def run_plugin(
        self,
        plugin_id: str,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
    ) -> PluginExecutionResult:
        payload = self._request(
            "plugin_run",
            {
                "pluginId": plugin_id,
                "filePath": dataset.file_path,
                "selectedChannelIndices": selected_channel_indices,
            },
        )
        return PluginExecutionResult.from_json(payload)

    def get_nsg_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        payload = self._request("nsg_get_credentials")
        if not payload:
            return None
        return NsgCredentialsStatus.from_json(payload)

    def save_nsg_credentials(
        self,
        username: str,
        password: str,
        app_key: str,
    ) -> None:
        self._request(
            "nsg_save_credentials",
            {
                "username": username,
                "password": password,
                "appKey": app_key,
            },
        )

    def delete_nsg_credentials(self) -> None:
        self._request("nsg_delete_credentials")

    def test_nsg_connection(self) -> bool:
        payload = self._request("nsg_test_connection")
        return bool(payload.get("connected", False))

    def list_nsg_jobs(self) -> List[NsgJobSnapshot]:
        payload = self._request("nsg_list_jobs")
        return [NsgJobSnapshot.from_json(item) for item in payload.get("jobs", [])]

    def create_nsg_job(
        self,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
        selected_variants: List[str],
        window_length_samples: int,
        window_step_samples: int,
        delays: List[int],
        start_time_seconds: float,
        end_time_seconds: Optional[float],
        runtime_hours: Optional[float],
        cores: Optional[int],
        nodes: Optional[int],
    ) -> NsgJobSnapshot:
        payload = self._request(
            "nsg_create_job",
            {
                "filePath": dataset.file_path,
                "selectedChannelIndices": selected_channel_indices,
                "selectedVariants": selected_variants,
                "windowLengthSamples": window_length_samples,
                "windowStepSamples": window_step_samples,
                "delayList": delays,
                "startTimeSeconds": start_time_seconds,
                "endTimeSeconds": end_time_seconds,
                "runtimeHours": runtime_hours,
                "cores": cores,
                "nodes": nodes,
            },
        )
        return NsgJobSnapshot.from_json(payload)

    def submit_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        payload = self._request("nsg_submit_job", {"jobId": job_id})
        return NsgJobSnapshot.from_json(payload)

    def refresh_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        payload = self._request("nsg_refresh_job", {"jobId": job_id})
        return NsgJobSnapshot.from_json(payload)

    def cancel_nsg_job(self, job_id: str) -> None:
        self._request("nsg_cancel_job", {"jobId": job_id})

    def download_nsg_results(self, job_id: str) -> List[str]:
        payload = self._request("nsg_download_results", {"jobId": job_id})
        return [str(value) for value in payload.get("paths", [])]

    def close(self) -> None:
        with self._lock:
            if not self._process:
                _close_python_dataset_readers()
                return
            try:
                if self._process.stdin:
                    self._process.stdin.close()
            except OSError:
                pass
            try:
                self._process.terminate()
                self._process.wait(timeout=5)
            except Exception:
                try:
                    self._process.kill()
                except Exception:
                    pass
            finally:
                self._process = None
        _close_python_dataset_readers()

    def _request(self, method: str, params: Optional[dict] = None) -> dict:
        with self._lock:
            process = self._ensure_process()
            if not process.stdin or not process.stdout:
                raise RuntimeError("Local bridge pipes are unavailable.")

            envelope = {
                "id": uuid.uuid4().hex,
                "method": method,
                "params": params or {},
            }
            try:
                process.stdin.write(json.dumps(envelope, separators=(",", ":")) + "\n")
                process.stdin.flush()
            except OSError as exc:
                self._process = None
                raise RuntimeError(f"Failed to write to local bridge: {exc}") from exc

            line = process.stdout.readline()
            if not line:
                stderr_text = "\n".join(self._stderr_tail).strip()
                exit_code = process.poll()
                self._process = None
                detail = f"Local bridge exited unexpectedly (exit code {exit_code})."
                if stderr_text:
                    detail = f"{detail}\n{stderr_text}"
                raise RuntimeError(detail)

            response = json.loads(line)
            if not response.get("ok", False):
                message = response.get("error") or "Local bridge request failed."
                diagnostics = response.get("diagnostics") or []
                if diagnostics:
                    message = f"{message}\n" + "\n".join(
                        str(item) for item in diagnostics
                    )
                raise RuntimeError(message)
            result = response.get("result")
            return result if isinstance(result, dict) else {}

    def _ensure_process(self) -> subprocess.Popen[str]:
        if self._process and self._process.poll() is None:
            return self._process

        script_path = self._helper_script_path()
        self._ensure_helper_installed(script_path)
        if not script_path.exists():
            raise RuntimeError(f"Local bridge launcher was not found at {script_path}.")

        self._stderr_tail.clear()
        self._process = subprocess.Popen(
            [str(script_path)],
            cwd=str(self.runtime_paths.local_bridge_workdir(script_path)),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
        self._stderr_thread.start()
        return self._process

    def _ensure_helper_installed(self, script_path: Path) -> None:
        if script_path.exists() and not self._helper_is_stale(script_path):
            return
        if self.kmp_root is None:
            raise RuntimeError(
                "Local bridge is not bundled with this app build. "
                "Set DDALAB_QT_LOCAL_BRIDGE to a packaged bridge path or use a remote backend."
            )

        gradle = "gradlew.bat" if os.name == "nt" else "./gradlew"
        subprocess.run(
            [gradle, ":serverApp:installLocalBridgeDist", "--quiet"],
            cwd=str(self.kmp_root),
            check=True,
        )

    def _helper_is_stale(self, script_path: Path) -> bool:
        if self.kmp_root is None:
            return False
        try:
            helper_mtime = script_path.stat().st_mtime
        except FileNotFoundError:
            return True

        for path in self.runtime_paths.helper_watch_paths():
            if not path.exists():
                continue
            if path.is_file() and path.stat().st_mtime > helper_mtime:
                return True
            if path.is_dir():
                for child in path.rglob("*"):
                    if child.is_file() and child.stat().st_mtime > helper_mtime:
                        return True
        return False

    def _helper_script_path(self) -> Path:
        script_path = self.runtime_paths.find_local_bridge_script()
        if script_path is not None:
            return script_path
        if self.kmp_root is None:
            raise RuntimeError(
                "Could not locate a packaged local DDALAB bridge or a source checkout."
            )
        script_name = (
            "ddalab-kmp-local-bridge.bat"
            if os.name == "nt"
            else "ddalab-kmp-local-bridge"
        )
        return (
            self.kmp_root
            / "serverApp"
            / "build"
            / "install"
            / "ddalab-kmp-local-bridge"
            / "bin"
            / script_name
        )

    def _drain_stderr(self) -> None:
        process = self._process
        if not process or not process.stderr:
            return
        try:
            for line in process.stderr:
                line = line.rstrip()
                if line:
                    self._stderr_tail.append(line)
        except Exception:
            return

    def _should_use_python_reader(self, path: str) -> bool:
        return _should_use_python_reader_cached(path)


class OpenNeuroClient:
    def __init__(self) -> None:
        self._headers = {"Content-Type": "application/json"}
        self._session_pool = _RequestsSessionPool(self._headers, pool_connections=4, pool_maxsize=4)

    def list_datasets(
        self,
        limit: int = 50,
        after: Optional[str] = None,
    ) -> Tuple[List[OpenNeuroDataset], Optional[str], bool]:
        response = self._session_pool.session().request(
            "POST",
            OPEN_NEURO_GRAPHQL_ENDPOINT,
            json={
                "query": OPEN_NEURO_BATCH_QUERY,
                "variables": {"after": after, "first": max(1, min(limit, 100))},
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        connection = payload["data"]["datasets"]
        datasets: List[OpenNeuroDataset] = []
        for edge in connection.get("edges", []):
            node = edge.get("node")
            if not node:
                continue
            snapshot = node.get("latestSnapshot") or {}
            description = snapshot.get("description") or {}
            summary = snapshot.get("summary") or {}
            datasets.append(
                OpenNeuroDataset(
                    dataset_id=node["id"],
                    name=(description.get("Name") or node["id"]).strip(),
                    description=(description.get("Name") or "").strip(),
                    created_at_iso=snapshot.get("created"),
                    snapshot_tag=snapshot.get("tag"),
                    modalities=list(summary.get("modalities") or []),
                    subjects=_coerce_optional_int(summary.get("subjects")),
                    tasks=list(summary.get("tasks") or []),
                    size_bytes=_coerce_optional_int(summary.get("size")),
                    total_files=_coerce_optional_int(summary.get("totalFiles")),
                )
            )
        page_info = connection.get("pageInfo") or {}
        return (
            datasets,
            page_info.get("endCursor"),
            bool(page_info.get("hasNextPage", False)),
        )

    def close(self) -> None:
        self._session_pool.close()


@lru_cache(maxsize=2048)
def _should_use_python_reader_cached(path: str) -> bool:
    path_obj = Path(path)
    is_dir = path_obj.is_dir()
    if is_bridge_native_path(path, is_dir):
        return False
    return supports_qt_dataset_path(path, is_dir)


def _build_dda_request(
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    start_time_seconds: float,
    end_time_seconds: Optional[float],
) -> dict:
    return {
        "dataset": {
            "clientFilePath": dataset.file_path,
            "clientFileName": dataset.file_name,
            "dominantSampleRateHz": dataset.dominant_sample_rate_hz,
            "durationSeconds": dataset.duration_seconds,
        },
        "config": {
            "selectedVariants": selected_variants,
            "windowLengthSamples": window_length_samples,
            "windowStepSamples": window_step_samples,
            "delayList": delays,
            "startTimeSeconds": start_time_seconds,
            "endTimeSeconds": end_time_seconds,
        },
        "selectedChannelIndices": selected_channel_indices,
    }


def _build_ica_request(
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    start_time_seconds: Optional[float],
    end_time_seconds: Optional[float],
    n_components: Optional[int],
    max_iterations: int,
    tolerance: float,
    centering: bool,
    whitening: bool,
) -> dict:
    return {
        "dataset": {
            "clientFilePath": dataset.file_path,
            "clientFileName": dataset.file_name,
            "dominantSampleRateHz": dataset.dominant_sample_rate_hz,
            "durationSeconds": dataset.duration_seconds,
        },
        "selectedChannelIndices": selected_channel_indices,
        "startTimeSeconds": start_time_seconds,
        "endTimeSeconds": end_time_seconds,
        "nComponents": n_components,
        "maxIterations": max_iterations,
        "tolerance": tolerance,
        "centering": centering,
        "whitening": whitening,
    }


def _parse_health(payload: dict) -> ApiHealth:
    return ApiHealth(
        service=payload.get("service", "ddalab"),
        status=payload.get("status", "unknown"),
        dda_available=bool(payload.get("ddaAvailable", False)),
        ica_available=bool(payload.get("icaAvailable", False)),
        diagnostics=list(payload.get("diagnostics", [])),
    )


def _coerce_optional_int(value: object) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _python_dataset_reader(path: str):
    from .local_readers import get_python_dataset_reader

    return get_python_dataset_reader(path)


def _close_python_dataset_readers() -> None:
    from .local_readers import close_python_dataset_readers

    close_python_dataset_readers()


def _annotate_entries(entries: List[BrowserEntry]) -> List[BrowserEntry]:
    enriched: List[BrowserEntry] = []
    for entry in entries:
        info = classify_path(entry.path, entry.is_directory)
        enriched.append(
            BrowserEntry(
                name=entry.name,
                path=entry.path,
                is_directory=entry.is_directory,
                size_bytes=entry.size_bytes,
                modified_at_epoch_ms=entry.modified_at_epoch_ms,
                supported=info.openable,
                type_label=info.label,
                open_as_dataset=info.open_as_dataset,
            )
        )
    return enriched
