from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from ...domain.file_types import supports_qt_dataset_path
from ...domain.models import (
    BrowserEntry,
    DdaResult,
    IcaResult,
    LoadedDataset,
    NsgCredentialsStatus,
    NsgJobSnapshot,
    WaveformOverview,
    WaveformWindow,
)
from ...runtime_paths import RuntimePaths
from ..contracts import BackendClient, BackendHealth
from ..dda.sidecar import DdaSidecarClient
from ..services.ica import _run_local_ica
from ..services.nsg import LocalNsgManager
from .dda import _run_local_dda, _supports_rust_direct_file_execution
from .filesystem import (
    _close_python_dataset_readers,
    _list_local_directory,
    _local_backend_health,
    _local_default_root,
    _python_dataset_reader,
)
from .runtime import _find_cli_command, _get_dda_sidecar, _resolve_rust_dda_support

__all__ = [
    "LocalBackendClient",
    "_find_cli_command",
    "_supports_rust_direct_file_execution",
]


class LocalBackendClient(BackendClient):
    def __init__(self, runtime_paths: RuntimePaths) -> None:
        self.runtime_paths = runtime_paths
        self.repo_root = (
            runtime_paths.source_repo_root or runtime_paths.browser_fallback_root()
        )
        self._dda_sidecar: Optional[DdaSidecarClient] = None
        self._dda_sidecar_key: Optional[tuple[str, ...]] = None
        self._nsg_manager: Optional[LocalNsgManager] = None

    @property
    def connection_label(self) -> str:
        return "Local Python backend"

    def supports_nsg(self) -> bool:
        return True

    def _get_nsg_manager(self) -> LocalNsgManager:
        if self._nsg_manager is None:
            self._nsg_manager = LocalNsgManager(self.runtime_paths)
        return self._nsg_manager

    def health(self) -> BackendHealth:
        return _local_backend_health(self.runtime_paths, self.repo_root)

    def compute_devices(self) -> List[Dict[str, str]]:
        devices = super().compute_devices()
        cli_command = _resolve_rust_dda_support(self.runtime_paths, self.repo_root)
        if cli_command is None:
            return devices
        try:
            cuda_devices = _get_dda_sidecar(
                client=self,
                cli_command=cli_command,
                repo_root=self.repo_root,
            ).cuda_devices()
        except (OSError, RuntimeError):
            return devices
        for item in cuda_devices:
            try:
                index = int(item["index"])
            except (KeyError, TypeError, ValueError):
                continue
            name = str(item.get("name") or f"CUDA device {index}")
            devices.append({"id": f"cuda:{index}", "label": f"CUDA {index} ({name})"})
        return devices

    def default_root(self) -> str:
        return str(_local_default_root(self.repo_root))

    def list_directory(self, path: str) -> Tuple[str, List[BrowserEntry]]:
        return _list_local_directory(path)

    def load_dataset(self, path: str) -> LoadedDataset:
        path_obj = Path(path)
        if not supports_qt_dataset_path(path, path_obj.is_dir()):
            raise RuntimeError(f"Unsupported local dataset format: {path}")
        try:
            return _python_dataset_reader(path).load_metadata()
        except Exception as exc:
            raise RuntimeError(f"Could not open {path_obj.name}: {exc}") from exc

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
        compute_device: str = "cpu",
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
            compute_device=compute_device,
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

    def get_nsg_credentials_status(self) -> Optional[NsgCredentialsStatus]:
        return self._get_nsg_manager().get_credentials_status()

    def save_nsg_credentials(
        self,
        username: str,
        password: str,
        app_key: str,
    ) -> None:
        self._get_nsg_manager().save_credentials(username, password, app_key)

    def delete_nsg_credentials(self) -> None:
        self._get_nsg_manager().delete_credentials()

    def test_nsg_connection(self) -> bool:
        return self._get_nsg_manager().test_connection()

    def list_nsg_jobs(self) -> List[NsgJobSnapshot]:
        return self._get_nsg_manager().list_jobs()

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
        return self._get_nsg_manager().create_job(
            dataset=dataset,
            selected_channel_indices=selected_channel_indices,
            selected_variants=selected_variants,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            start_time_seconds=start_time_seconds,
            end_time_seconds=end_time_seconds,
            runtime_hours=runtime_hours,
            cores=cores,
            nodes=nodes,
        )

    def submit_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        return self._get_nsg_manager().submit_job(job_id)

    def refresh_nsg_job(self, job_id: str) -> NsgJobSnapshot:
        return self._get_nsg_manager().refresh_job(job_id)

    def cancel_nsg_job(self, job_id: str) -> None:
        self._get_nsg_manager().cancel_job(job_id)

    def download_nsg_results(self, job_id: str) -> List[str]:
        return self._get_nsg_manager().download_results(job_id)

    def close(self) -> None:
        if self._dda_sidecar is not None:
            self._dda_sidecar.close()
            self._dda_sidecar = None
        if self._nsg_manager is not None:
            self._nsg_manager.close()
            self._nsg_manager = None
        _close_python_dataset_readers()
