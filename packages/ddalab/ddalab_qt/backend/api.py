from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import requests

from .dda_sidecar import DdaSidecarClient
from ..domain.file_types import (
    classify_path,
    supports_qt_dataset_path,
)
from ..domain.models import (
    BrowserEntry,
    DdaResult,
    DdaVariantResult,
    IcaComponent,
    IcaResult,
    LoadedDataset,
    NetworkMotifAdjacencyMatrix,
    NetworkMotifData,
    NetworkMotifEdge,
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
from ..runtime_binary_names import (
    DEV_CLI_BINARY_STEM,
    PACKAGED_CLI_BINARY_STEM,
    platform_binary_name,
)


OPEN_NEURO_GRAPHQL_ENDPOINT = "https://openneuro.org/crn/graphql"
_DDA_CROSS_WINDOW_LENGTH = 2
_DDA_CROSS_WINDOW_STEP = 2
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


class _DdaInputValidationError(RuntimeError):
    pass


def _validate_sy_selection(channel_indices: List[int]) -> None:
    if len(channel_indices) < 2:
        raise _DdaInputValidationError("SY requires at least two selected channels.")
    if len(channel_indices) % 2 != 0:
        raise _DdaInputValidationError(
            "SY expects an even number of selected channels because it "
            "analyzes adjacent channel pairs."
        )


@dataclass(frozen=True)
class _SidecarDdaGroupPreview:
    analysis_id: str
    backend_label: str
    diagnostics: List[str]
    selected_indices: List[int]
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]]
    parsed_result: Optional[dict] = None


class BackendClient(ABC):
    @property
    @abstractmethod
    def connection_label(self) -> str:
        raise NotImplementedError

    def supports_plugins(self) -> bool:
        return False

    def supports_nsg(self) -> bool:
        return False

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
        variant_channel_indices: Optional[Dict[str, List[int]]] = None,
        variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
        model_terms: Optional[List[int]] = None,
        model_dimension: Optional[int] = None,
        polynomial_order: Optional[int] = None,
        nr_tau: Optional[int] = None,
        progress_callback: Optional[Callable[[dict], None]] = None,
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
        variant_channel_indices: Optional[Dict[str, List[int]]] = None,
        variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
        model_terms: Optional[List[int]] = None,
        model_dimension: Optional[int] = None,
        polynomial_order: Optional[int] = None,
        nr_tau: Optional[int] = None,
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> DdaResult:
        _ = progress_callback
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
                variant_channel_indices=variant_channel_indices,
                variant_pair_indices=variant_pair_indices,
                model_terms=model_terms,
                model_dimension=model_dimension,
                polynomial_order=polynomial_order,
                nr_tau=nr_tau,
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
            "Plugin management is not available through remote HTTP backends."
        )

    def fetch_plugin_registry(self) -> List[PluginRegistryEntry]:
        raise RuntimeError(
            "Plugin management is not available through remote HTTP backends."
        )

    def install_plugin(self, plugin_id: str) -> PluginInstalledEntry:
        raise RuntimeError(
            "Plugin management is not available through remote HTTP backends."
        )

    def uninstall_plugin(self, plugin_id: str) -> None:
        raise RuntimeError(
            "Plugin management is not available through remote HTTP backends."
        )

    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> bool:
        raise RuntimeError(
            "Plugin management is not available through remote HTTP backends."
        )

    def run_plugin(
        self,
        plugin_id: str,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
    ) -> PluginExecutionResult:
        raise RuntimeError(
            "Plugin execution is not available through remote HTTP backends."
        )

    def get_nsg_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def save_nsg_credentials(
        self,
        username: str,
        password: str,
        app_key: str,
    ) -> None:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def delete_nsg_credentials(self) -> None:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def test_nsg_connection(self) -> bool:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def list_nsg_jobs(self) -> List[NsgJobSnapshot]:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
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
            "NSG integration is not available through remote HTTP backends."
        )

    def submit_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def refresh_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def cancel_nsg_job(self, job_id: str) -> None:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )

    def download_nsg_results(self, job_id: str) -> List[str]:
        raise RuntimeError(
            "NSG integration is not available through remote HTTP backends."
        )


class LocalBackendClient(BackendClient):
    def __init__(self, runtime_paths: RuntimePaths) -> None:
        self.runtime_paths = runtime_paths
        self.repo_root = runtime_paths.source_repo_root or runtime_paths.browser_fallback_root()
        self._dda_sidecar: Optional[DdaSidecarClient] = None
        self._dda_sidecar_key: Optional[tuple[str, ...]] = None

    @property
    def connection_label(self) -> str:
        return "Local Python backend"

    def health(self) -> ApiHealth:
        return _local_backend_health(self.runtime_paths, self.repo_root)

    def default_root(self) -> str:
        return str(_local_default_root(self.repo_root))

    def list_directory(self, path: str) -> Tuple[str, List[BrowserEntry]]:
        return _list_local_directory(path)

    def load_dataset(self, path: str) -> LoadedDataset:
        path_obj = Path(path)
        if not supports_qt_dataset_path(path, path_obj.is_dir()):
            raise RuntimeError(f"Unsupported local dataset format: {path}")
        return _python_dataset_reader(path).load_metadata()

    def load_waveform_window(
        self,
        path: str,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: List[str],
    ) -> WaveformWindow:
        return _python_dataset_reader(path).load_waveform_window(
            start_time_seconds,
            duration_seconds,
            channel_names,
        )

    def load_waveform_overview(
        self,
        path: str,
        channel_names: List[str],
        max_buckets: int = 1600,
    ) -> WaveformOverview:
        return _python_dataset_reader(path).load_waveform_overview(
            channel_names,
            max_buckets,
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
        variant_channel_indices: Optional[Dict[str, List[int]]] = None,
        variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
        model_terms: Optional[List[int]] = None,
        model_dimension: Optional[int] = None,
        polynomial_order: Optional[int] = None,
        nr_tau: Optional[int] = None,
        progress_callback: Optional[Callable[[dict], None]] = None,
    ) -> DdaResult:
        return _run_local_dda(
            self,
            dataset=dataset,
            selected_channel_indices=selected_channel_indices,
            selected_variants=selected_variants,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            start_time_seconds=start_time_seconds,
            end_time_seconds=end_time_seconds,
            variant_channel_indices=variant_channel_indices,
            variant_pair_indices=variant_pair_indices,
            model_terms=model_terms,
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            progress_callback=progress_callback,
        )

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
        return _run_local_ica(
            self,
            dataset=dataset,
            selected_channel_indices=selected_channel_indices,
            start_time_seconds=start_time_seconds,
            end_time_seconds=end_time_seconds,
            n_components=n_components,
            max_iterations=max_iterations,
            tolerance=tolerance,
            centering=centering,
            whitening=whitening,
        )

    def list_installed_plugins(self) -> List[PluginInstalledEntry]:
        raise RuntimeError(_unsupported_local_feature("Plugin management"))

    def fetch_plugin_registry(self) -> List[PluginRegistryEntry]:
        raise RuntimeError(_unsupported_local_feature("Plugin management"))

    def install_plugin(self, plugin_id: str) -> PluginInstalledEntry:
        raise RuntimeError(_unsupported_local_feature("Plugin installation"))

    def uninstall_plugin(self, plugin_id: str) -> None:
        raise RuntimeError(_unsupported_local_feature("Plugin removal"))

    def set_plugin_enabled(self, plugin_id: str, enabled: bool) -> bool:
        raise RuntimeError(_unsupported_local_feature("Plugin enable/disable"))

    def run_plugin(
        self,
        plugin_id: str,
        dataset: LoadedDataset,
        selected_channel_indices: List[int],
    ) -> PluginExecutionResult:
        raise RuntimeError(_unsupported_local_feature("Plugin execution"))

    def get_nsg_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def save_nsg_credentials(
        self,
        username: str,
        password: str,
        app_key: str,
    ) -> None:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def delete_nsg_credentials(self) -> None:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def test_nsg_connection(self) -> bool:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def list_nsg_jobs(self) -> List[NsgJobSnapshot]:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

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
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def submit_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def refresh_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def cancel_nsg_job(self, job_id: str) -> None:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def download_nsg_results(self, job_id: str) -> List[str]:
        raise RuntimeError(_unsupported_local_feature("NSG integration"))

    def close(self) -> None:
        if self._dda_sidecar is not None:
            self._dda_sidecar.close()
            self._dda_sidecar = None
        _close_python_dataset_readers()


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
    return supports_qt_dataset_path(path, path_obj.is_dir())


def _build_dda_request(
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    start_time_seconds: float,
    end_time_seconds: Optional[float],
    variant_channel_indices: Optional[Dict[str, List[int]]] = None,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
) -> dict:
    payload = {
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
    if variant_channel_indices:
        payload["variantChannelIndices"] = {
            str(variant_id): [int(index) for index in indices]
            for variant_id, indices in variant_channel_indices.items()
        }
    if variant_pair_indices:
        payload["variantPairIndices"] = {
            str(variant_id): [
                [int(left), int(right)] for left, right in indices
            ]
            for variant_id, indices in variant_pair_indices.items()
        }
    if variant_configs:
        request_payload["variant_configs"] = variant_configs
    if model_terms:
        payload["config"]["modelTerms"] = [int(term) for term in model_terms]
    if (
        model_dimension is not None
        or polynomial_order is not None
        or nr_tau is not None
    ):
        payload["config"]["modelParameters"] = {
            "dm": int(model_dimension or 0),
            "order": int(polynomial_order or 0),
            "nrTau": int(nr_tau or 0),
        }
    return payload


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
    try:
        from .local_readers import close_python_dataset_readers
    except ImportError:
        return

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


def _unsupported_local_feature(feature: str) -> str:
    return f"{feature} is not yet available in the Python-only desktop build."


def _local_default_root(repo_root: Path) -> Path:
    data_root = repo_root / "data"
    if data_root.exists():
        return data_root
    return repo_root


def _local_backend_health(runtime_paths: RuntimePaths, repo_root: Path) -> ApiHealth:
    diagnostics = [
        "Python-native desktop backend active.",
        "Filesystem browsing, dataset loading, waveform windows, and overview rendering run locally.",
    ]
    rust_support = _resolve_rust_dda_support(runtime_paths, repo_root)
    if rust_support is None:
        if runtime_paths.is_source_checkout():
            diagnostics.append(
                "DDALAB CLI was not found; DDA is unavailable until the local Rust backend is built or bundled."
            )
        else:
            diagnostics.append(
                "Bundled DDALAB Rust backend was not found in this install; DDA is unavailable."
            )
    else:
        diagnostics.append(
            f"Rust DDA available via {Path(rust_support[0]).name}."
        )
        diagnostics.append(
            "All DDA requests run through the bundled dda-rs backend."
        )
    ica_available = _has_python_ica_support()
    diagnostics.append(
        "ICA available via scikit-learn FastICA."
        if ica_available
        else "ICA requires scikit-learn and scipy in the local desktop environment."
    )
    return ApiHealth(
        service="ddalab-python",
        status="ready",
        dda_available=rust_support is not None,
        ica_available=ica_available,
        diagnostics=diagnostics,
    )


def _list_local_directory(path: str) -> Tuple[str, List[BrowserEntry]]:
    target = Path(path).expanduser()
    if target.is_file():
        target = target.parent
    if not target.exists():
        raise RuntimeError(f"Directory does not exist: {path}")
    if not target.is_dir():
        raise RuntimeError(f"Path is not a directory: {path}")

    entries: List[BrowserEntry] = []
    with os.scandir(target) as iterator:
        children = sorted(
            list(iterator),
            key=lambda item: (not item.is_dir(follow_symlinks=False), item.name.lower()),
        )
    for child in children:
        try:
            is_directory = child.is_dir(follow_symlinks=False)
            stat = child.stat(follow_symlinks=False)
            size_bytes = 0 if is_directory else int(stat.st_size)
            modified_at_epoch_ms = int(stat.st_mtime * 1000)
        except OSError:
            is_directory = False
            size_bytes = 0
            modified_at_epoch_ms = 0
        entries.append(
            BrowserEntry(
                name=child.name,
                path=str(Path(child.path).resolve()),
                is_directory=is_directory,
                size_bytes=size_bytes,
                modified_at_epoch_ms=modified_at_epoch_ms,
                supported=False,
            )
        )
    return str(target.resolve()), _annotate_entries(entries)


def _normalize_variant_channel_indices(
    *,
    selected_variants: List[str],
    selected_channel_indices: List[int],
    variant_channel_indices: Optional[Dict[str, List[int]]],
    channel_count: int,
) -> Dict[str, List[int]]:
    def sanitize(indices: Optional[List[int]]) -> List[int]:
        ordered: List[int] = []
        seen: set[int] = set()
        for raw_index in indices or []:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if index < 0 or index >= channel_count or index in seen:
                continue
            seen.add(index)
            ordered.append(index)
        return ordered

    fallback_indices = sanitize(selected_channel_indices)
    normalized_variant_map: Dict[str, List[int]] = {}
    provided_variant_map = variant_channel_indices or {}
    for variant_id in selected_variants:
        raw_indices = provided_variant_map.get(variant_id)
        normalized_variant_map[variant_id] = sanitize(
            raw_indices if raw_indices is not None else fallback_indices
        )
    return normalized_variant_map


def _normalize_variant_pair_indices(
    *,
    selected_variants: List[str],
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]],
    channel_count: int,
) -> Dict[str, List[tuple[int, int]]]:
    normalized: Dict[str, List[tuple[int, int]]] = {}
    provided_map = variant_pair_indices or {}
    for variant_id in selected_variants:
        if variant_id not in {"CT", "CD"}:
            continue
        raw_pairs = provided_map.get(variant_id) or []
        cleaned: List[tuple[int, int]] = []
        seen: set[tuple[int, int]] = set()
        for raw_left, raw_right in raw_pairs:
            try:
                left = int(raw_left)
                right = int(raw_right)
            except (TypeError, ValueError):
                continue
            if (
                left < 0
                or right < 0
                or left >= channel_count
                or right >= channel_count
                or left == right
            ):
                continue
            canonical = (
                (min(left, right), max(left, right))
                if variant_id == "CT"
                else (left, right)
            )
            if canonical in seen:
                continue
            seen.add(canonical)
            cleaned.append(canonical)
        if cleaned:
            normalized[variant_id] = cleaned
    return normalized


def _pair_channel_indices(
    pair_indices: List[tuple[int, int]],
) -> List[int]:
    ordered: List[int] = []
    seen: set[int] = set()
    for left_index, right_index in pair_indices:
        for index in (left_index, right_index):
            if index in seen:
                continue
            seen.add(index)
            ordered.append(index)
    return ordered


def _union_channel_indices(
    variant_channel_indices: Dict[str, List[int]],
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
) -> List[int]:
    ordered: List[int] = []
    seen: set[int] = set()
    for indices in variant_channel_indices.values():
        for index in indices:
            if index in seen:
                continue
            seen.add(index)
            ordered.append(index)
    for pairs in (variant_pair_indices or {}).values():
        for left_index, right_index in pairs:
            for index in (left_index, right_index):
                if index in seen:
                    continue
                seen.add(index)
                ordered.append(index)
    return ordered


def _run_local_dda(
    client: LocalBackendClient,
    *,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    start_time_seconds: float,
    end_time_seconds: Optional[float],
    variant_channel_indices: Optional[Dict[str, List[int]]] = None,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> DdaResult:
    normalized_variants = [
        str(variant).upper()
        for variant in selected_variants
        if str(variant).strip()
    ]
    if not normalized_variants:
        raise RuntimeError("Select at least one DDA variant.")
    normalized_variant_channel_indices = _normalize_variant_channel_indices(
        selected_variants=normalized_variants,
        selected_channel_indices=selected_channel_indices,
        variant_channel_indices=variant_channel_indices,
        channel_count=len(dataset.channel_names),
    )
    normalized_variant_pair_indices = _normalize_variant_pair_indices(
        selected_variants=normalized_variants,
        variant_pair_indices=variant_pair_indices,
        channel_count=len(dataset.channel_names),
    )
    normalized_selected_channel_indices = _union_channel_indices(
        normalized_variant_channel_indices,
        normalized_variant_pair_indices,
    )
    if not normalized_selected_channel_indices:
        raise RuntimeError("Select at least one channel before running DDA.")

    cli_command = _resolve_rust_dda_support(client.runtime_paths, client.repo_root)
    if cli_command is None:
        raise RuntimeError(
            "Local DDALAB Rust backend was not found in this desktop build. "
            "Build or bundle the local dda-rs backend before running DDA."
        )

    try:
        return _run_rust_default_dda(
            client,
            dataset=dataset,
            selected_channel_indices=normalized_selected_channel_indices,
            selected_variants=normalized_variants,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            start_time_seconds=start_time_seconds,
            end_time_seconds=end_time_seconds,
            cli_command=cli_command,
            variant_channel_indices=normalized_variant_channel_indices,
            variant_pair_indices=normalized_variant_pair_indices,
            model_terms=model_terms,
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            progress_callback=progress_callback,
        )
    except _DdaInputValidationError:
        raise
    except Exception as rust_error:
        raise RuntimeError(
            "Pure Rust DDA backend failed.\n\n"
            f"Rust backend error: {rust_error}\n\n"
            "DDALAB uses the bundled dda-rs backend for local analysis."
        ) from rust_error


def _run_rust_default_dda(
    client: LocalBackendClient,
    *,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    start_time_seconds: float,
    end_time_seconds: Optional[float],
    cli_command: List[str],
    variant_channel_indices: Optional[Dict[str, List[int]]] = None,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> DdaResult:
    variant_channel_index_map = variant_channel_indices or {
        variant_id: list(selected_channel_indices)
        for variant_id in selected_variants
    }
    variant_pair_index_map = variant_pair_indices or {}
    selected_channel_names = [
        dataset.channel_names[index]
        for index in selected_channel_indices
        if 0 <= index < len(dataset.channel_names)
    ]
    if not selected_channel_names:
        raise _DdaInputValidationError("Selected channels could not be resolved.")

    requested_start_seconds = max(float(start_time_seconds), 0.0)
    requested_end_seconds = max(
        float(end_time_seconds if end_time_seconds is not None else dataset.duration_seconds),
        requested_start_seconds,
    )
    if end_time_seconds is not None and requested_end_seconds <= requested_start_seconds:
        raise _DdaInputValidationError("End time must be greater than start time.")

    if progress_callback is not None:
        progress_callback(
            {
                "group_label": "Input Prep",
                "stage_id": "input-prep",
                "stage_label": "Preparing in-memory analysis slice",
                "step_index": 0,
                "total_steps": 0,
                "window_index": 0,
                "total_windows": 0,
                "item_index": 0,
                "total_items": 0,
                "item_kind": "phase",
                "item_label": "analysis matrix",
            }
        )

    analysis_duration_seconds = max(
        requested_end_seconds - requested_start_seconds,
        1.0 / max(dataset.dominant_sample_rate_hz, 1.0),
    )
    analysis_window = client.load_waveform_window(
        dataset.file_path,
        requested_start_seconds,
        analysis_duration_seconds,
        selected_channel_names,
    )
    (
        matrix_path,
        _matrix_channel_labels,
        sample_rate,
        total_samples,
        total_channels,
    ) = _write_waveform_window_matrix_file(analysis_window)
    matrix_index_lookup = {
        dataset_index: matrix_index
        for matrix_index, dataset_index in enumerate(selected_channel_indices)
    }
    requested_start_sample = 0
    safe_end_sample = max(total_samples, requested_start_sample + 1)

    if total_samples <= 0:
        raise _DdaInputValidationError("Analysis slice contains no samples.")
    available_samples = max(safe_end_sample - requested_start_sample, 0)
    if available_samples < int(window_length_samples):
        raise _DdaInputValidationError(
            "Insufficient data for analysis. "
            f"{available_samples} samples available, but window length is {window_length_samples}."
        )

    base_diagnostics = [
        f"Requested variants: {', '.join(selected_variants)}",
        f"Selected channels: {', '.join(selected_channel_names)}",
        f"Window: {window_length_samples}/{window_step_samples} samples",
        f"Bounds: {requested_start_sample}-{safe_end_sample} samples @ {sample_rate:.3f} Hz",
        "Default backend: Rust DDA on an in-memory analysis matrix.",
        "All analysis runs through the bundled dda-rs backend.",
    ]

    def _localize_channels(indices: List[int]) -> List[int]:
        return [
            matrix_index_lookup[index]
            for index in indices
            if index in matrix_index_lookup
        ]

    def _localize_pairs(pairs: List[tuple[int, int]]) -> List[tuple[int, int]]:
        return [
            (matrix_index_lookup[left], matrix_index_lookup[right])
            for left, right in pairs
            if left in matrix_index_lookup and right in matrix_index_lookup
        ]

    full_local_indices = list(range(len(selected_channel_names)))
    variant_configs_payload: dict[str, dict[str, object]] = {}

    if "SY" in selected_variants:
        sy_indices = variant_channel_index_map.get("SY", [])
        _validate_sy_selection(sy_indices)

    def _set_variant_channels(canonical_key: str, dataset_indices: List[int]) -> None:
        localized = _localize_channels(dataset_indices)
        if localized and localized != full_local_indices:
            variant_configs_payload.setdefault(canonical_key, {})[
                "selected_channels"
            ] = localized

    if "ST" in selected_variants:
        st_indices = variant_channel_index_map.get("ST", [])
        if not st_indices:
            raise _DdaInputValidationError("ST requires at least one selected channel.")
        _set_variant_channels("single_timeseries", st_indices)

    if "DE" in selected_variants:
        de_indices = variant_channel_index_map.get("DE", [])
        if not de_indices:
            raise _DdaInputValidationError("DE requires at least one selected channel.")
        _set_variant_channels("dynamical_ergodicity", de_indices)

    if "SY" in selected_variants:
        _set_variant_channels("synchronization", variant_channel_index_map.get("SY", []))

    localized_ct_pairs: Optional[List[tuple[int, int]]] = None
    if "CT" in selected_variants:
        ct_pairs_dataset = variant_pair_index_map.get("CT", [])
        ct_indices = (
            _pair_channel_indices(ct_pairs_dataset)
            if ct_pairs_dataset
            else variant_channel_index_map.get("CT", [])
        )
        if ct_pairs_dataset:
            if not ct_indices:
                raise _DdaInputValidationError("CT requires at least one selected pair.")
            localized_ct_pairs = _localize_pairs(ct_pairs_dataset)
            if not localized_ct_pairs:
                raise _DdaInputValidationError("CT pairs could not be resolved for DDA.")
            variant_configs_payload.setdefault("cross_timeseries", {})[
                "ct_channel_pairs"
            ] = [[left, right] for left, right in localized_ct_pairs]
        elif len(ct_indices) < 2:
            raise _DdaInputValidationError("CT requires at least two selected channels.")
        else:
            _set_variant_channels("cross_timeseries", ct_indices)

    localized_cd_pairs: Optional[List[tuple[int, int]]] = None
    if "CD" in selected_variants:
        cd_pairs_dataset = variant_pair_index_map.get("CD", [])
        cd_indices = (
            _pair_channel_indices(cd_pairs_dataset)
            if cd_pairs_dataset
            else variant_channel_index_map.get("CD", [])
        )
        if cd_pairs_dataset:
            if not cd_indices:
                raise _DdaInputValidationError(
                    "CD requires at least one selected directed pair."
                )
            localized_cd_pairs = _localize_pairs(cd_pairs_dataset)
            if not localized_cd_pairs:
                raise _DdaInputValidationError("CD pairs could not be resolved for DDA.")
            variant_configs_payload.setdefault("cross_dynamical", {})[
                "cd_channel_pairs"
            ] = [[left, right] for left, right in localized_cd_pairs]
        elif len(cd_indices) < 2:
            raise _DdaInputValidationError("CD requires at least two selected channels.")
        else:
            _set_variant_channels("cross_dynamical", cd_indices)

    ct_window_length = (
        _DDA_CROSS_WINDOW_LENGTH
        if any(variant in selected_variants for variant in ("DE", "CT", "CD"))
        else None
    )
    ct_window_step = (
        _DDA_CROSS_WINDOW_STEP
        if ct_window_length is not None
        else None
    )

    try:
        preview = _execute_sidecar_dda_group(
            client=client,
            cli_command=cli_command,
            repo_root=client.repo_root,
            dataset=dataset,
            selected_channel_indices=selected_channel_indices,
            cli_selected_indices=None,
            input_path=None,
            variants=selected_variants,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            requested_start_sample=requested_start_sample,
            safe_end_sample=safe_end_sample,
            sample_rate=sample_rate,
            base_diagnostics=base_diagnostics,
            requested_start_seconds=requested_start_seconds,
            group_label="Combined",
            variant_pair_indices=variant_pair_index_map or None,
            model_terms=model_terms,
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            ct_pairs=localized_ct_pairs,
            cd_pairs=localized_cd_pairs,
            ct_window_length=ct_window_length,
            ct_window_step=ct_window_step,
            progress_callback=progress_callback,
            input_matrix_path=matrix_path,
            input_matrix_rows=total_samples,
            input_matrix_cols=total_channels,
            input_channel_labels=selected_channel_names,
            variant_configs=variant_configs_payload or None,
        )
    finally:
        try:
            matrix_path.unlink(missing_ok=True)
        except Exception:
            pass
    return _materialize_sidecar_dda_result(
        client=client,
        dataset=dataset,
        selected_variants=selected_variants,
        grouped_previews=[preview],
        result_id=uuid.uuid4().hex,
        window_length_samples=window_length_samples,
        window_step_samples=window_step_samples,
        delays=delays,
        requested_start_seconds=requested_start_seconds,
    )


def _execute_sidecar_dda_group(
    *,
    client: LocalBackendClient,
    cli_command: List[str],
    repo_root: Path,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    cli_selected_indices: Optional[List[int]],
    input_path: Optional[Path],
    variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    requested_start_sample: int,
    safe_end_sample: int,
    sample_rate: float,
    base_diagnostics: List[str],
    requested_start_seconds: float,
    group_label: str,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    ct_pairs: Optional[List[tuple[int, int]]] = None,
    cd_pairs: Optional[List[tuple[int, int]]] = None,
    ct_window_length: Optional[int] = None,
    ct_window_step: Optional[int] = None,
    progress_callback: Optional[Callable[[dict], None]] = None,
    input_matrix_path: Optional[Path] = None,
    input_matrix_rows: Optional[int] = None,
    input_matrix_cols: Optional[int] = None,
    input_channel_labels: Optional[List[str]] = None,
    variant_configs: Optional[dict] = None,
) -> _SidecarDdaGroupPreview:
    diagnostics = list(base_diagnostics)
    diagnostics.append(f"Execution group: {group_label}")
    diagnostics.append(
        "Group channels: "
        + ", ".join(
            dataset.channel_names[index]
            for index in selected_channel_indices
            if 0 <= index < len(dataset.channel_names)
        )
    )
    if ct_window_length is not None or ct_window_step is not None:
        diagnostics.append(
            "CT window override: "
            f"{ct_window_length if ct_window_length is not None else window_length_samples}/"
            f"{ct_window_step if ct_window_step is not None else window_step_samples}"
            " samples"
        )
    sidecar = _get_dda_sidecar(
        client=client,
        cli_command=cli_command,
        repo_root=repo_root,
    )

    if input_matrix_path is not None:
        channel_labels = list(input_channel_labels or [])
        request_payload = {
            "file": dataset.file_path,
            "matrix_path": str(input_matrix_path),
            "rows": int(input_matrix_rows or 0),
            "cols": int(input_matrix_cols or len(channel_labels)),
            "channel_labels": channel_labels,
            "channels": list(range(len(channel_labels))),
            "variants": list(variants),
            "wl": int(window_length_samples),
            "ws": int(window_step_samples),
            "delays": [int(delay) for delay in delays],
            "sr": float(sample_rate) if sample_rate > 1000.0 else None,
            "ct_pairs": (
                [[int(left), int(right)] for left, right in ct_pairs]
                if ct_pairs
                else None
            ),
            "cd_pairs": (
                [[int(left), int(right)] for left, right in cd_pairs]
                if cd_pairs
                else None
            ),
            "ct_wl": int(ct_window_length) if ct_window_length is not None else None,
            "ct_ws": int(ct_window_step) if ct_window_step is not None else None,
        }
    else:
        if input_path is None or cli_selected_indices is None:
            raise RuntimeError(
                "Sidecar DDA execution requires either an input matrix file or an input path."
            )
        request_payload = {
            "file": str(input_path),
            "channels": [int(index) for index in cli_selected_indices],
            "variants": list(variants),
            "wl": int(window_length_samples),
            "ws": int(window_step_samples),
            "delays": [int(delay) for delay in delays],
            "start_sample": int(requested_start_sample),
            "end_sample": int(safe_end_sample),
            "sr": float(sample_rate) if sample_rate > 1000.0 else None,
            "ct_pairs": (
                [[int(left), int(right)] for left, right in ct_pairs]
                if ct_pairs
                else None
            ),
            "cd_pairs": (
                [[int(left), int(right)] for left, right in cd_pairs]
                if cd_pairs
                else None
            ),
            "ct_wl": int(ct_window_length) if ct_window_length is not None else None,
            "ct_ws": int(ct_window_step) if ct_window_step is not None else None,
        }

    if variant_configs:
        request_payload["variant_configs"] = variant_configs
    if model_terms:
        request_payload["model_terms"] = [int(term) for term in model_terms]
    if model_dimension is not None:
        request_payload["dm"] = int(model_dimension)
    if polynomial_order is not None:
        request_payload["order"] = int(polynomial_order)
    if nr_tau is not None:
        request_payload["nr_tau"] = int(nr_tau)

    def _handle_progress(payload: dict[str, object]) -> None:
        if progress_callback is None:
            return
        enriched = dict(payload)
        enriched.setdefault("group_label", group_label)
        progress_callback(enriched)

    if input_matrix_path is not None:
        parsed = sidecar.run_group_matrix_file(
            request_payload,
            on_progress=_handle_progress,
        )
    else:
        parsed = sidecar.run_group(request_payload, on_progress=_handle_progress)
    backend_id = str(parsed.get("backend") or "").lower()
    return _SidecarDdaGroupPreview(
        analysis_id=str(parsed.get("id") or uuid.uuid4().hex),
        backend_label=(
            "Rust DDA"
            if backend_id in ("", "pure-rust")
            else f"Unexpected backend: {backend_id}"
        ),
        diagnostics=diagnostics,
        selected_indices=list(selected_channel_indices),
        variant_pair_indices=variant_pair_indices,
        parsed_result=(
            parsed.get("result")
            if isinstance(parsed.get("result"), dict)
            else None
        ),
    )

def _materialize_sidecar_dda_result(
    *,
    client: LocalBackendClient,
    dataset: LoadedDataset,
    selected_variants: List[str],
    grouped_previews: List[_SidecarDdaGroupPreview],
    result_id: str,
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    requested_start_seconds: float,
) -> DdaResult:
    grouped_results: List[DdaResult] = []
    for preview in grouped_previews:
        parsed = preview.parsed_result
        if not isinstance(parsed, dict):
            raise RuntimeError(
                "Rust DDA sidecar did not return an inline result payload."
            )
        grouped_results.append(
            _map_cli_result(
                dataset=dataset,
                selected_indices=preview.selected_indices,
                variant_pair_indices=preview.variant_pair_indices,
                parsed=parsed,
                diagnostics=list(preview.diagnostics)
                + [f"Engine: {preview.backend_label}"],
                start_time_seconds=requested_start_seconds,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
            )
        )
    return _merge_sidecar_dda_results(
        dataset=dataset,
        selected_variants=selected_variants,
        grouped_results=grouped_results,
        result_id=result_id,
        engine_label="Rust sidecar",
    )


def _merge_sidecar_dda_results(
    *,
    dataset: LoadedDataset,
    selected_variants: List[str],
    grouped_results: List[DdaResult],
    result_id: Optional[str] = None,
    engine_label: str = "Rust CLI",
) -> DdaResult:
    ordered_variant_ids: List[str] = []
    for variant_id in selected_variants:
        normalized = str(variant_id).upper()
        if normalized not in ordered_variant_ids:
            ordered_variant_ids.append(normalized)

    variants_by_id: dict[str, DdaVariantResult] = {}
    diagnostics: List[str] = []
    window_centers_seconds: List[float] = []
    created_at_iso = datetime.now(timezone.utc).isoformat()

    for result in grouped_results:
        if result.created_at_iso and not window_centers_seconds:
            created_at_iso = result.created_at_iso
        if len(result.window_centers_seconds) > len(window_centers_seconds):
            window_centers_seconds = list(result.window_centers_seconds)
        for line in result.diagnostics:
            if line not in diagnostics:
                diagnostics.append(line)
        for variant in result.variants:
            variants_by_id[variant.id.upper()] = variant

    merged_variants = [
        variants_by_id[variant_id]
        for variant_id in ordered_variant_ids
        if variant_id in variants_by_id
    ]
    if not merged_variants:
        raise RuntimeError("Rust DDA sidecar returned no variant matrices.")

    return DdaResult(
        id=result_id or uuid.uuid4().hex,
        file_path=dataset.file_path,
        file_name=dataset.file_name,
        created_at_iso=created_at_iso,
        engine_label=engine_label,
        diagnostics=diagnostics,
        window_centers_seconds=window_centers_seconds,
        variants=merged_variants,
        is_fallback=False,
    )


def _resolve_rust_dda_support(
    runtime_paths: RuntimePaths,
    repo_root: Path,
) -> Optional[List[str]]:
    return _find_cli_command(runtime_paths, repo_root)


def _get_dda_sidecar(
    *,
    client: LocalBackendClient,
    cli_command: List[str],
    repo_root: Path,
) -> DdaSidecarClient:
    sidecar_key = tuple(str(part) for part in cli_command)
    if client._dda_sidecar is None or client._dda_sidecar_key != sidecar_key:
        if client._dda_sidecar is not None:
            client._dda_sidecar.close()
        client._dda_sidecar = DdaSidecarClient(
            cli_command=cli_command,
            cwd=str(repo_root),
        )
        client._dda_sidecar_key = sidecar_key
    return client._dda_sidecar


def _find_cli_command(runtime_paths: RuntimePaths, repo_root: Path) -> Optional[List[str]]:
    env_path = os.environ.get("DDALAB_CLI_PATH")
    if env_path:
        candidate = Path(env_path).expanduser()
        if candidate.exists():
            return [str(candidate)]

    if runtime_paths.is_source_checkout():
        dev_cli_name = platform_binary_name(DEV_CLI_BINARY_STEM)
        for candidate in (
            repo_root / "packages" / "dda-rs" / "target" / "release" / dev_cli_name,
            repo_root / "packages" / "dda-rs" / "target" / "debug" / dev_cli_name,
        ):
            if candidate.exists():
                return [str(candidate)]

        manifest = repo_root / "packages" / "dda-rs" / "Cargo.toml"
        if manifest.exists() and shutil.which("cargo"):
            return ["cargo", "run", "--manifest-path", str(manifest), "--"]

        system_binary = shutil.which(dev_cli_name)
        if system_binary:
            return [system_binary]

    packaged_cli_name = platform_binary_name(PACKAGED_CLI_BINARY_STEM)
    for candidate in _runtime_binary_candidates(runtime_paths, packaged_cli_name):
        if candidate.exists():
            return [str(candidate)]
    return None


def _runtime_binary_candidates(
    runtime_paths: RuntimePaths,
    binary_name: str,
) -> List[Path]:
    roots = [
        runtime_paths.package_runtime_bin_dir(),
        runtime_paths.package_root / "bin",
        runtime_paths.executable_dir / "bin",
        runtime_paths.executable_dir / "runtime" / "bin",
        runtime_paths.executable_dir.parent / "Resources" / "bin",
        runtime_paths.executable_dir.parent / "Resources" / "runtime" / "bin",
    ]
    candidates: List[Path] = []
    seen: set[Path] = set()
    for root in roots:
        try:
            resolved = root.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        candidates.append(resolved / binary_name)
    return candidates


def _write_waveform_window_matrix_file(
    window: WaveformWindow,
) -> tuple[Path, List[str], float, int, int]:
    if not window.channels:
        raise RuntimeError("Could not extract any channels for DDA input.")
    import numpy as np

    sample_rate = max(
        min(channel.sample_rate_hz for channel in window.channels),
        1.0,
    )
    sample_count = min(len(channel.samples) for channel in window.channels)
    channel_labels = [channel.name for channel in window.channels]
    if sample_count <= 0:
        raise RuntimeError("Analysis slice contains no samples.")

    matrix = np.column_stack(
        [
            np.asarray(channel.samples[:sample_count], dtype=np.float64)
            for channel in window.channels
        ]
    )
    if matrix.ndim != 2 or matrix.shape[0] != sample_count:
        raise RuntimeError("Could not build a valid in-memory DDA matrix.")
    matrix = np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0).astype(
        "<f8",
        copy=False,
    )
    matrix = np.ascontiguousarray(matrix)

    handle = tempfile.NamedTemporaryFile(
        prefix="ddalab-matrix-",
        suffix=".f64",
        delete=False,
    )
    try:
        matrix.tofile(handle)
        path = Path(handle.name)
    finally:
        handle.close()
    return path, channel_labels, sample_rate, sample_count, int(matrix.shape[1])


def _payload_channel_labels(payload: dict) -> List[str]:
    raw_labels = payload.get("channel_labels") or payload.get("channelLabels") or []
    if not isinstance(raw_labels, list):
        return []
    return [str(value) for value in raw_labels if str(value).strip()]


def _coerce_variant_value(value: object) -> float:
    if value is None:
        return float("nan")
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _labels_are_generic_channel_numbers(labels: List[str]) -> bool:
    return bool(labels) and all(
        label.startswith("Channel ") and label.removeprefix("Channel ").isdigit()
        for label in labels
    )


def _labels_are_generic_pair_numbers(labels: List[str]) -> bool:
    separators = (" <-> ", " -> ")
    if not labels:
        return False
    for label in labels:
        matched = False
        for separator in separators:
            if separator not in label:
                continue
            left, right = label.split(separator, 1)
            if (
                left.startswith("Ch")
                and left.removeprefix("Ch").isdigit()
                and right.startswith("Ch")
                and right.removeprefix("Ch").isdigit()
            ):
                matched = True
                break
        if not matched:
            return False
    return True


def _default_variant_row_labels(
    *,
    dataset: LoadedDataset,
    selected_indices: List[int],
    selected_names: List[str],
    variant_id: str,
    row_count: int,
    selected_pairs: Optional[List[tuple[int, int]]] = None,
) -> List[str]:
    if variant_id in {"ST", "DE", "SY"}:
        return [
            selected_names[row]
            if row < len(selected_names)
            else f"Metric {row + 1}"
            for row in range(row_count)
        ]
    if variant_id == "CT":
        labels = [
            f"{dataset.channel_names[left]} <> {dataset.channel_names[right]}"
            for left, right in (selected_pairs or _build_undirected_pairs(selected_indices))
        ]
        labels.extend(
            f"Metric {row + 1}" for row in range(len(labels), row_count)
        )
        return labels[:row_count]
    if variant_id == "CD":
        labels = [
            f"{dataset.channel_names[left]} -> {dataset.channel_names[right]}"
            for left, right in (selected_pairs or _build_directed_pairs(selected_indices))
        ]
        labels.extend(
            f"Metric {row + 1}" for row in range(len(labels), row_count)
        )
        return labels[:row_count]
    return [f"Metric {row + 1}" for row in range(row_count)]


def _map_cli_result(
    *,
    dataset: LoadedDataset,
    selected_indices: List[int],
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]],
    parsed: dict,
    diagnostics: List[str],
    start_time_seconds: float,
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
) -> DdaResult:
    selected_names = [
        dataset.channel_names[index]
        for index in selected_indices
        if 0 <= index < len(dataset.channel_names)
    ]
    variants: List[DdaVariantResult] = []
    for payload in parsed.get("variant_results") or parsed.get("variantResults") or []:
        if not isinstance(payload, dict):
            continue
        variant_id = str(
            payload.get("variant_id") or payload.get("variantId") or ""
        ).upper()
        matrix = [
            [_coerce_variant_value(value) for value in row]
            for row in payload.get("q_matrix") or payload.get("qMatrix") or []
            if isinstance(row, list)
        ]
        if not matrix:
            continue
        payload_labels = _payload_channel_labels(payload)
        default_labels = _default_variant_row_labels(
            dataset=dataset,
            selected_indices=selected_indices,
            selected_names=selected_names,
            variant_id=variant_id,
            row_count=max(len(matrix), len(payload_labels)),
            selected_pairs=(variant_pair_indices or {}).get(variant_id),
        )
        preferred_labels = (
            default_labels
            if (
                _labels_are_generic_channel_numbers(payload_labels)
                or _labels_are_generic_pair_numbers(payload_labels)
            )
            else payload_labels or default_labels
        )
        row_labels = preferred_labels[: len(matrix)]
        nonfinite_labels = [
            row_labels[index]
            if index < len(row_labels)
            else f"Series {index + 1}"
            for index, row in enumerate(matrix)
            if not any(math.isfinite(float(value)) for value in row)
        ]
        if nonfinite_labels:
            note = (
                f"{variant_id} returned non-finite output for: "
                + ", ".join(dict.fromkeys(nonfinite_labels))
                + ". Plots render these rows as 0.0."
            )
            if note not in diagnostics:
                diagnostics.append(note)
        (
            column_count,
            row_mean_absolute,
            row_peak_absolute,
            min_value,
            max_value,
        ) = _summarize_variant_matrix(matrix)
        network_motifs = (
            build_network_motif_data(
                q_matrix=matrix,
                channel_pairs=(variant_pair_indices or {}).get("CD"),
                channel_names=dataset.channel_names,
                delays=delays,
                threshold=0.25,
            )
            if variant_id == "CD"
            else None
        )
        variants.append(
            DdaVariantResult(
                id=variant_id,
                label=str(payload.get("variant_name") or payload.get("variantName") or variant_id),
                row_labels=row_labels,
                matrix=matrix,
                summary=f"Rust {variant_id} view",
                min_value=min_value,
                max_value=max_value,
                column_count=column_count,
                row_mean_absolute=row_mean_absolute,
                row_peak_absolute=row_peak_absolute,
                network_motifs=network_motifs,
            )
        )

    if not variants:
        raise RuntimeError("Rust DDA sidecar returned no variant matrices.")

    sample_rate = max(dataset.dominant_sample_rate_hz, 1.0)
    step_seconds = window_step_samples / sample_rate
    center_offset = window_length_samples / sample_rate / 2.0
    window_count = max((variant.effective_column_count for variant in variants), default=0)
    window_centers_seconds = [
        start_time_seconds + center_offset + index * step_seconds
        for index in range(window_count)
    ]
    return DdaResult(
        id=str(parsed.get("id") or uuid.uuid4().hex),
        file_path=dataset.file_path,
        file_name=dataset.file_name,
        created_at_iso=str(
            parsed.get("created_at")
            or parsed.get("createdAt")
            or datetime.now(timezone.utc).isoformat()
        ),
        engine_label="Rust DDA sidecar",
        diagnostics=diagnostics,
        window_centers_seconds=window_centers_seconds,
        variants=variants,
        is_fallback=False,
    )


def _summarize_variant_matrix(
    matrix: List[List[float]],
) -> tuple[int, List[float], List[float], float, float]:
    column_count = max((len(row) for row in matrix), default=0)
    row_mean_absolute: List[float] = []
    row_peak_absolute: List[float] = []
    min_value = float("inf")
    max_value = float("-inf")

    for row in matrix:
        if not row:
            row_mean_absolute.append(0.0)
            row_peak_absolute.append(0.0)
            continue
        absolute_sum = 0.0
        row_peak = 0.0
        finite_count = 0
        for value in row:
            numeric = float(value)
            if not math.isfinite(numeric):
                continue
            absolute = abs(numeric)
            absolute_sum += absolute
            if absolute > row_peak:
                row_peak = absolute
            if numeric < min_value:
                min_value = numeric
            if numeric > max_value:
                max_value = numeric
            finite_count += 1
        row_mean_absolute.append(absolute_sum / finite_count if finite_count else 0.0)
        row_peak_absolute.append(row_peak)

    if min_value == float("inf"):
        min_value = 0.0
        max_value = 0.0

    return column_count, row_mean_absolute, row_peak_absolute, min_value, max_value


def build_network_motif_data(
    *,
    q_matrix: List[List[float]],
    channel_pairs: Optional[List[tuple[int, int]]],
    channel_names: List[str],
    delays: List[int | float],
    threshold: float = 0.25,
) -> Optional[NetworkMotifData]:
    if not q_matrix or not channel_pairs:
        return None
    num_timepoints = len(q_matrix[0]) if q_matrix and q_matrix[0] else 0
    if num_timepoints <= 0:
        return None

    unique_nodes = sorted(
        {
            int(node_index)
            for pair in channel_pairs
            for node_index in pair
        }
    )
    if not unique_nodes:
        return None
    node_index_map = {
        original_index: mapped_index
        for mapped_index, original_index in enumerate(unique_nodes)
    }
    node_labels = [
        channel_names[index]
        if 0 <= index < len(channel_names)
        else f"Ch{index + 1}"
        for index in unique_nodes
    ]

    if num_timepoints >= 3:
        selected_indices = [
            num_timepoints // 4,
            num_timepoints // 2,
            (num_timepoints * 3) // 4,
        ]
    elif num_timepoints == 2:
        selected_indices = [0, 1, 1]
    else:
        selected_indices = [0, 0, 0]

    delay_values = [
        float(delays[index]) if 0 <= index < len(delays) else float(index)
        for index in selected_indices
    ]
    adjacency_matrices: List[NetworkMotifAdjacencyMatrix] = []

    for matrix_index, time_index in enumerate(selected_indices):
        values = [
            float(q_matrix[pair_index][time_index])
            if pair_index < len(q_matrix) and time_index < len(q_matrix[pair_index])
            else float("nan")
            for pair_index, _pair in enumerate(channel_pairs)
        ]
        finite_values = [
            value for value in values if math.isfinite(float(value))
        ]
        if finite_values:
            min_value = min(finite_values)
            max_value = max(finite_values)
            value_range = max_value - min_value
            if value_range > 1e-10:
                values = [
                    (value - min_value) / value_range
                    if math.isfinite(float(value))
                    else float("nan")
                    for value in values
                ]
            else:
                values = [
                    1.0 if math.isfinite(float(value)) else float("nan")
                    for value in values
                ]

        matrix_values = [0.0] * (len(unique_nodes) * len(unique_nodes))
        edges: List[NetworkMotifEdge] = []
        for pair_index, (from_index, to_index) in enumerate(channel_pairs):
            mapped_from = node_index_map.get(int(from_index))
            mapped_to = node_index_map.get(int(to_index))
            if mapped_from is None or mapped_to is None:
                continue
            weight = values[pair_index] if pair_index < len(values) else float("nan")
            if not math.isfinite(float(weight)) or float(weight) < threshold:
                weight = 0.0
            numeric_weight = float(weight)
            matrix_values[mapped_from * len(unique_nodes) + mapped_to] = numeric_weight
            if numeric_weight > 0.0:
                edges.append(
                    NetworkMotifEdge(
                        from_node=mapped_from,
                        to_node=mapped_to,
                        weight=numeric_weight,
                    )
                )

        adjacency_matrices.append(
            NetworkMotifAdjacencyMatrix(
                index=matrix_index,
                delay=delay_values[matrix_index],
                matrix=matrix_values,
                edges=edges,
            )
        )

    return NetworkMotifData(
        num_nodes=len(unique_nodes),
        node_labels=node_labels,
        adjacency_matrices=adjacency_matrices,
        delay_values=delay_values,
    )


def _build_undirected_pairs(indices: List[int]) -> List[tuple[int, int]]:
    pairs: List[tuple[int, int]] = []
    for left_index in range(len(indices)):
        for right_index in range(left_index + 1, len(indices)):
            pairs.append((indices[left_index], indices[right_index]))
    return pairs


def _build_directed_pairs(indices: List[int]) -> List[tuple[int, int]]:
    pairs: List[tuple[int, int]] = []
    for left in indices:
        for right in indices:
            if left != right:
                pairs.append((left, right))
    return pairs


def _run_local_ica(
    client: LocalBackendClient,
    *,
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
    if not _has_python_ica_support():
        raise RuntimeError(
            "ICA requires scikit-learn and scipy. Re-run ./start.sh so the local desktop environment installs them."
        )

    import numpy as np
    from scipy.signal import welch
    from scipy.stats import kurtosis as scipy_kurtosis
    from sklearn.decomposition import FastICA

    selected_channel_names = [
        dataset.channel_names[index]
        for index in selected_channel_indices
        if 0 <= index < len(dataset.channel_names)
    ]
    if len(selected_channel_names) < 2:
        raise RuntimeError("Select at least two channels before running ICA.")

    sample_rate = max(dataset.dominant_sample_rate_hz, 1.0)
    start_seconds = max(float(start_time_seconds or 0.0), 0.0)
    requested_end = float(
        end_time_seconds if end_time_seconds is not None else dataset.duration_seconds
    )
    duration_seconds = max(requested_end - start_seconds, 1.0 / sample_rate)
    window = client.load_waveform_window(
        dataset.file_path,
        start_seconds,
        duration_seconds + (1.0 / sample_rate),
        selected_channel_names,
    )
    if len(window.channels) < 2:
        raise RuntimeError("ICA could not load enough channels from the selected dataset.")

    sample_count = min(len(channel.samples) for channel in window.channels)
    if sample_count < 4:
        raise RuntimeError("ICA requires at least four samples in the selected window.")

    matrix = np.vstack(
        [
            np.asarray(channel.samples[:sample_count], dtype=np.float64)
            for channel in window.channels
        ]
    )
    if centering:
        matrix = matrix - matrix.mean(axis=1, keepdims=True)

    component_count = min(
        int(n_components or len(window.channels)),
        len(window.channels),
        sample_count,
    )
    ica = FastICA(
        n_components=component_count,
        whiten="unit-variance" if whitening else False,
        max_iter=max_iterations,
        tol=tolerance,
        random_state=0,
    )
    transformed = np.asarray(ica.fit_transform(matrix.T), dtype=np.float64)
    mixing = getattr(ica, "mixing_", None)
    if mixing is None:
        components = getattr(ica, "components_", None)
        mixing = (
            np.linalg.pinv(np.asarray(components, dtype=np.float64))
            if components is not None
            else np.eye(matrix.shape[0], transformed.shape[1], dtype=np.float64)
        )
    mixing = np.asarray(mixing, dtype=np.float64)
    source_variances = np.var(transformed, axis=0)
    total_variance = float(np.sum(source_variances)) or 1.0

    components: List[IcaComponent] = []
    for component_index in range(transformed.shape[1]):
        source = np.asarray(transformed[:, component_index], dtype=np.float64)
        spatial_map = (
            mixing[:, component_index]
            if mixing.ndim == 2 and component_index < mixing.shape[1]
            else np.zeros(matrix.shape[0], dtype=np.float64)
        )
        frequencies, power_values = welch(
            source,
            fs=sample_rate,
            nperseg=min(256, source.size),
        )
        kurtosis_value = (
            float(scipy_kurtosis(source, fisher=False, bias=False))
            if source.size >= 4
            else 0.0
        )
        components.append(
            IcaComponent(
                component_id=component_index + 1,
                spatial_map=spatial_map.astype(np.float64).tolist(),
                time_series_preview=_downsample_list(
                    source.astype(np.float64).tolist(),
                    768,
                ),
                kurtosis=kurtosis_value,
                non_gaussianity=abs(kurtosis_value - 3.0),
                variance_explained=float(source_variances[component_index] / total_variance),
                power_frequencies=_downsample_list(
                    frequencies.astype(np.float64).tolist(),
                    256,
                ),
                power_values=_downsample_list(
                    power_values.astype(np.float64).tolist(),
                    256,
                ),
            )
        )

    return IcaResult(
        id=f"ica-{uuid.uuid4().hex[:12]}",
        file_path=dataset.file_path,
        file_name=dataset.file_name,
        created_at_iso=datetime.now(timezone.utc).isoformat(),
        channel_names=selected_channel_names,
        sample_rate_hz=sample_rate,
        sample_count=sample_count,
        components=components,
    )


def _has_python_ica_support() -> bool:
    try:
        from scipy.signal import welch  # noqa: F401
        from sklearn.decomposition import FastICA  # noqa: F401
    except ImportError:
        return False
    return True


def _downsample_list(values: List[float], max_points: int) -> List[float]:
    if max_points <= 0 or len(values) <= max_points:
        return list(values)
    step = len(values) / max_points
    return [
        float(values[min(int(index * step), len(values) - 1)])
        for index in range(max_points)
    ]
