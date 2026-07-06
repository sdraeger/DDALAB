from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

from ..domain.models import (
    BrowserEntry,
    DdaResult,
    IcaResult,
    LoadedDataset,
    NsgCredentialsStatus,
    NsgJobSnapshot,
    WaveformOverview,
    WaveformWindow,
)


@dataclass
class BackendHealth:
    service: str
    status: str
    dda_available: bool
    ica_available: bool
    diagnostics: List[str]
    nsg_available: bool = False


class BackendClient(ABC):
    @property
    @abstractmethod
    def connection_label(self) -> str:
        raise NotImplementedError

    def supports_nsg(self) -> bool:
        return False

    def supports_nsg_submission(self) -> bool:
        return False

    @abstractmethod
    def health(self) -> BackendHealth:
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
