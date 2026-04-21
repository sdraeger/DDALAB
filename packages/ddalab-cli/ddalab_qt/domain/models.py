from __future__ import annotations

from dataclasses import dataclass, field
import math
import threading
from typing import Callable, Dict, List, Optional


_MISSING = object()


def _json_key(payload: dict, camel_key: str, snake_key: str, default=_MISSING):
    if camel_key in payload:
        return payload[camel_key]
    if snake_key in payload:
        return payload[snake_key]
    if default is not _MISSING:
        return default
    raise KeyError(camel_key)


@dataclass
class BrowserEntry:
    name: str
    path: str
    is_directory: bool
    size_bytes: int
    modified_at_epoch_ms: int
    supported: bool
    type_label: Optional[str] = None
    open_as_dataset: bool = False

    @classmethod
    def from_json(cls, payload: dict) -> "BrowserEntry":
        return cls(
            name=payload["name"],
            path=payload["path"],
            is_directory=payload["isDirectory"],
            size_bytes=payload.get("sizeBytes", 0),
            modified_at_epoch_ms=payload.get("modifiedAtEpochMs", 0),
            supported=payload.get("supported", False),
            type_label=payload.get("typeLabel"),
            open_as_dataset=payload.get("openAsDataset", False),
        )


@dataclass
class ChannelDescriptor:
    name: str
    sample_rate_hz: float
    sample_count: int
    unit: Optional[str] = None

    @classmethod
    def from_json(cls, payload: dict) -> "ChannelDescriptor":
        return cls(
            name=payload["name"],
            sample_rate_hz=float(payload["sampleRateHz"]),
            sample_count=int(payload["sampleCount"]),
            unit=payload.get("unit"),
        )


@dataclass
class LoadedDataset:
    file_path: str
    file_name: str
    format_label: str
    file_size_bytes: int
    duration_seconds: float
    total_sample_count: int
    time_axis_name: str
    source_summary: str
    notes: List[str]
    channels: List[ChannelDescriptor]
    supports_windowed_access: bool

    @property
    def channel_names(self) -> List[str]:
        return [channel.name for channel in self.channels]

    @property
    def dominant_sample_rate_hz(self) -> float:
        if not self.channels:
            return 1.0
        return max(channel.sample_rate_hz for channel in self.channels)

    @classmethod
    def from_json(cls, payload: dict) -> "LoadedDataset":
        return cls(
            file_path=payload["filePath"],
            file_name=payload["fileName"],
            format_label=payload["format"],
            file_size_bytes=int(payload["fileSizeBytes"]),
            duration_seconds=float(payload["durationSeconds"]),
            total_sample_count=int(payload["totalSampleCount"]),
            time_axis_name=payload["timeAxisName"],
            source_summary=payload["sourceSummary"],
            notes=list(payload.get("notes", [])),
            channels=[
                ChannelDescriptor.from_json(item)
                for item in payload.get("channels", [])
            ],
            supports_windowed_access=bool(payload.get("supportsWindowedAccess", False)),
        )


@dataclass
class WaveformEnvelopeLevel:
    bucket_size: int
    mins: List[float]
    maxs: List[float]

    @classmethod
    def from_json(cls, payload: dict) -> "WaveformEnvelopeLevel":
        return cls(
            bucket_size=int(_json_key(payload, "bucketSize", "bucket_size")),
            mins=[float(value) for value in payload.get("mins", [])],
            maxs=[float(value) for value in payload.get("maxs", [])],
        )


@dataclass
class ChannelWaveform:
    name: str
    sample_rate_hz: float
    samples: List[float]
    unit: Optional[str]
    min_value: float
    max_value: float
    levels: List[WaveformEnvelopeLevel]

    @classmethod
    def from_json(cls, payload: dict) -> "ChannelWaveform":
        return cls(
            name=payload["name"],
            sample_rate_hz=float(
                _json_key(payload, "sampleRateHz", "sample_rate_hz")
            ),
            samples=[float(value) for value in payload.get("samples", [])],
            unit=payload.get("unit"),
            min_value=float(_json_key(payload, "minValue", "min_value", 0.0)),
            max_value=float(_json_key(payload, "maxValue", "max_value", 0.0)),
            levels=[
                WaveformEnvelopeLevel.from_json(item)
                for item in payload.get("levels", [])
            ],
        )


@dataclass
class WaveformWindow:
    dataset_file_path: str
    start_time_seconds: float
    duration_seconds: float
    channels: List[ChannelWaveform]
    from_cache: bool

    @classmethod
    def from_json(cls, payload: dict) -> "WaveformWindow":
        return cls(
            dataset_file_path=_json_key(
                payload, "datasetFilePath", "dataset_file_path"
            ),
            start_time_seconds=float(
                _json_key(payload, "startTimeSeconds", "start_time_seconds")
            ),
            duration_seconds=float(
                _json_key(payload, "durationSeconds", "duration_seconds")
            ),
            channels=[
                ChannelWaveform.from_json(item) for item in payload.get("channels", [])
            ],
            from_cache=bool(_json_key(payload, "fromCache", "from_cache", False)),
        )


@dataclass
class WaveformOverviewChannel:
    name: str
    bucket_duration_seconds: float
    mins: List[float]
    maxs: List[float]
    min_value: float
    max_value: float

    @classmethod
    def from_json(cls, payload: dict) -> "WaveformOverviewChannel":
        return cls(
            name=payload["name"],
            bucket_duration_seconds=float(
                _json_key(
                    payload,
                    "bucketDurationSeconds",
                    "bucket_duration_seconds",
                )
            ),
            mins=[float(value) for value in payload.get("mins", [])],
            maxs=[float(value) for value in payload.get("maxs", [])],
            min_value=float(_json_key(payload, "minValue", "min_value", 0.0)),
            max_value=float(_json_key(payload, "maxValue", "max_value", 0.0)),
        )


@dataclass
class WaveformOverview:
    dataset_file_path: str
    duration_seconds: float
    channels: List[WaveformOverviewChannel]
    from_cache: bool

    @classmethod
    def from_json(cls, payload: dict) -> "WaveformOverview":
        return cls(
            dataset_file_path=_json_key(
                payload, "datasetFilePath", "dataset_file_path"
            ),
            duration_seconds=float(
                _json_key(payload, "durationSeconds", "duration_seconds")
            ),
            channels=[
                WaveformOverviewChannel.from_json(item)
                for item in payload.get("channels", [])
            ],
            from_cache=bool(_json_key(payload, "fromCache", "from_cache", False)),
        )


@dataclass
class NetworkMotifEdge:
    from_node: int
    to_node: int
    weight: float

    @classmethod
    def from_json(cls, payload: dict) -> "NetworkMotifEdge":
        return cls(
            from_node=int(_json_key(payload, "from", "from_node", 0)),
            to_node=int(_json_key(payload, "to", "to_node", 0)),
            weight=float(payload.get("weight") or 0.0),
        )


@dataclass
class NetworkMotifAdjacencyMatrix:
    index: int
    delay: float
    matrix: List[float]
    edges: List[NetworkMotifEdge] = field(default_factory=list)

    @classmethod
    def from_json(cls, payload: dict) -> "NetworkMotifAdjacencyMatrix":
        return cls(
            index=int(payload.get("index") or 0),
            delay=float(payload.get("delay") or 0.0),
            matrix=[
                float("nan") if value is None else float(value)
                for value in payload.get("matrix", [])
            ],
            edges=[
                NetworkMotifEdge.from_json(item)
                for item in payload.get("edges", [])
                if isinstance(item, dict)
            ],
        )


@dataclass
class NetworkMotifData:
    num_nodes: int
    node_labels: List[str]
    adjacency_matrices: List[NetworkMotifAdjacencyMatrix]
    delay_values: List[float]

    @classmethod
    def from_json(cls, payload: dict) -> "NetworkMotifData":
        return cls(
            num_nodes=int(
                _json_key(payload, "numNodes", "num_nodes", 0)
            ),
            node_labels=[
                str(value)
                for value in (
                    payload.get("nodeLabels")
                    or payload.get("node_labels")
                    or []
                )
                if value is not None
            ],
            adjacency_matrices=[
                NetworkMotifAdjacencyMatrix.from_json(item)
                for item in (
                    payload.get("adjacencyMatrices")
                    or payload.get("adjacency_matrices")
                    or []
                )
                if isinstance(item, dict)
            ],
            delay_values=[
                float(value)
                for value in (
                    payload.get("delayValues")
                    or payload.get("delay_values")
                    or []
                )
                if value is not None
            ],
        )


@dataclass
class DdaVariantResult:
    id: str
    label: str
    row_labels: List[str]
    matrix: List[List[float]]
    summary: str
    min_value: float
    max_value: float
    column_count: int = 0
    row_mean_absolute: List[float] = field(default_factory=list)
    row_peak_absolute: List[float] = field(default_factory=list)
    network_motifs: Optional[NetworkMotifData] = None

    @classmethod
    def from_json(cls, payload: dict) -> "DdaVariantResult":
        return cls(
            id=payload["id"],
            label=payload["label"],
            row_labels=list(
                payload.get("rowLabels") or payload.get("row_labels") or []
            ),
            matrix=[
                [
                    float("nan") if value is None else float(value)
                    for value in row
                ]
                for row in payload.get("matrix", [])
            ],
            summary=payload.get("summary", ""),
            min_value=float(
                payload.get("minValue")
                if payload.get("minValue") is not None
                else payload.get("min_value", 0.0)
            ),
            max_value=float(
                payload.get("maxValue")
                if payload.get("maxValue") is not None
                else payload.get("max_value", 0.0)
            ),
            column_count=int(
                payload.get("columnCount") or payload.get("column_count") or 0
            ),
            row_mean_absolute=[
                float(value)
                for value in (
                    payload.get("rowMeanAbsolute")
                    or payload.get("row_mean_absolute")
                    or []
                )
            ],
            row_peak_absolute=[
                float(value)
                for value in (
                    payload.get("rowPeakAbsolute")
                    or payload.get("row_peak_absolute")
                    or []
                )
            ],
            network_motifs=(
                NetworkMotifData.from_json(
                    payload.get("networkMotifs")
                    or payload.get("network_motifs")
                )
                if isinstance(
                    payload.get("networkMotifs")
                    or payload.get("network_motifs"),
                    dict,
                )
                else None
            ),
        )

    @property
    def effective_column_count(self) -> int:
        if self.column_count > 0:
            return self.column_count
        return max((len(row) for row in self.matrix), default=0)

    def row_mean_absolute_value(self, index: int) -> float:
        if 0 <= index < len(self.row_mean_absolute):
            return float(self.row_mean_absolute[index])
        row = self.matrix[index] if 0 <= index < len(self.matrix) else []
        if not row:
            return 0.0
        finite = [
            abs(float(value)) for value in row if math.isfinite(float(value))
        ]
        if not finite:
            return 0.0
        return sum(finite) / len(finite)

    def row_peak_absolute_value(self, index: int) -> float:
        if 0 <= index < len(self.row_peak_absolute):
            return float(self.row_peak_absolute[index])
        row = self.matrix[index] if 0 <= index < len(self.matrix) else []
        if not row:
            return 0.0
        finite = [
            abs(float(value)) for value in row if math.isfinite(float(value))
        ]
        if not finite:
            return 0.0
        return max(finite)


@dataclass
class DdaResult:
    id: str
    file_path: str
    file_name: str
    created_at_iso: str
    engine_label: str
    diagnostics: List[str]
    window_centers_seconds: List[float]
    variants: List[DdaVariantResult]
    is_fallback: bool
    reproduction: Optional["DdaReproductionConfig"] = None

    @classmethod
    def from_json(cls, payload: dict) -> "DdaResult":
        return cls(
            id=payload["id"],
            file_path=_json_key(payload, "filePath", "file_path"),
            file_name=_json_key(payload, "fileName", "file_name"),
            created_at_iso=_json_key(payload, "createdAtIso", "created_at_iso"),
            engine_label=str(
                _json_key(payload, "engineLabel", "engine_label", "")
            ),
            diagnostics=list(payload.get("diagnostics", [])),
            window_centers_seconds=[
                float(value)
                for value in (
                    payload.get("windowCentersSeconds")
                    or payload.get("window_centers_seconds")
                    or []
                )
            ],
            variants=[
                DdaVariantResult.from_json(item) for item in payload.get("variants", [])
            ],
            is_fallback=bool(
                _json_key(payload, "isFallback", "is_fallback", False)
            ),
            reproduction=(
                DdaReproductionConfig.from_json(payload["reproduction"])
                if isinstance(payload.get("reproduction"), dict)
                else None
            ),
        )

    def set_materializer(self, callback: Callable[[], "DdaResult"]) -> None:
        setattr(self, "_materialize_callback", callback)
        setattr(self, "_materialize_lock", threading.RLock())

    def has_materializer(self) -> bool:
        return callable(getattr(self, "_materialize_callback", None))

    def materialize(self) -> "DdaResult":
        callback = getattr(self, "_materialize_callback", None)
        if not callable(callback):
            return self
        lock = getattr(self, "_materialize_lock", None)
        if lock is None:
            lock = threading.RLock()
            setattr(self, "_materialize_lock", lock)
        with lock:
            callback = getattr(self, "_materialize_callback", None)
            if not callable(callback):
                return self
            materialized = callback()
            if not isinstance(materialized, DdaResult):
                raise RuntimeError("DDA materializer returned an unexpected value.")
            self.id = materialized.id
            self.file_path = materialized.file_path
            self.file_name = materialized.file_name
            self.created_at_iso = materialized.created_at_iso
            self.engine_label = materialized.engine_label
            self.diagnostics = list(materialized.diagnostics)
            self.window_centers_seconds = list(materialized.window_centers_seconds)
            self.variants = list(materialized.variants)
            self.is_fallback = materialized.is_fallback
            self.reproduction = materialized.reproduction
            setattr(self, "_materialize_callback", None)
            return self


@dataclass
class DdaReproductionConfig:
    expert_mode: bool = False
    variant_ids: List[str] = field(default_factory=list)
    selected_channel_indices: List[int] = field(default_factory=list)
    selected_channel_names: List[str] = field(default_factory=list)
    variant_channel_indices: Dict[str, List[int]] = field(default_factory=dict)
    variant_channel_names: Dict[str, List[str]] = field(default_factory=dict)
    variant_pair_indices: Dict[str, List[tuple[int, int]]] = field(default_factory=dict)
    variant_pair_names: Dict[str, List[tuple[str, str]]] = field(default_factory=dict)
    window_length_samples: int = 0
    window_step_samples: int = 0
    delays: List[int] = field(default_factory=list)
    model_terms: List[int] = field(default_factory=list)
    model_dimension: int = 0
    polynomial_order: int = 0
    nr_tau: int = 0
    start_time_seconds: float = 0.0
    end_time_seconds: Optional[float] = None

    @classmethod
    def from_json(cls, payload: dict) -> "DdaReproductionConfig":
        def _int_list(value: object) -> List[int]:
            if not isinstance(value, list):
                return []
            return [int(item) for item in value if item is not None]

        def _str_list(value: object) -> List[str]:
            if not isinstance(value, list):
                return []
            return [str(item) for item in value if item is not None]

        def _variant_index_map(value: object) -> Dict[str, List[int]]:
            if not isinstance(value, dict):
                return {}
            restored: Dict[str, List[int]] = {}
            for key, items in value.items():
                restored[str(key)] = _int_list(items)
            return restored

        def _variant_name_map(value: object) -> Dict[str, List[str]]:
            if not isinstance(value, dict):
                return {}
            restored: Dict[str, List[str]] = {}
            for key, items in value.items():
                restored[str(key)] = _str_list(items)
            return restored

        def _pair_index_map(value: object) -> Dict[str, List[tuple[int, int]]]:
            if not isinstance(value, dict):
                return {}
            restored: Dict[str, List[tuple[int, int]]] = {}
            for key, items in value.items():
                pairs: List[tuple[int, int]] = []
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, (list, tuple)) and len(item) >= 2:
                            try:
                                pairs.append((int(item[0]), int(item[1])))
                            except (TypeError, ValueError):
                                continue
                restored[str(key)] = pairs
            return restored

        def _pair_name_map(value: object) -> Dict[str, List[tuple[str, str]]]:
            if not isinstance(value, dict):
                return {}
            restored: Dict[str, List[tuple[str, str]]] = {}
            for key, items in value.items():
                pairs: List[tuple[str, str]] = []
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, (list, tuple)) and len(item) >= 2:
                            pairs.append((str(item[0]), str(item[1])))
                restored[str(key)] = pairs
            return restored

        return cls(
            expert_mode=bool(
                payload.get("expertMode")
                if payload.get("expertMode") is not None
                else payload.get("expert_mode", False)
            ),
            variant_ids=_str_list(payload.get("variantIds") or payload.get("variant_ids")),
            selected_channel_indices=_int_list(
                payload.get("selectedChannelIndices")
                or payload.get("selected_channel_indices")
            ),
            selected_channel_names=_str_list(
                payload.get("selectedChannelNames")
                or payload.get("selected_channel_names")
            ),
            variant_channel_indices=_variant_index_map(
                payload.get("variantChannelIndices")
                or payload.get("variant_channel_indices")
            ),
            variant_channel_names=_variant_name_map(
                payload.get("variantChannelNames")
                or payload.get("variant_channel_names")
            ),
            variant_pair_indices=_pair_index_map(
                payload.get("variantPairIndices")
                or payload.get("variant_pair_indices")
            ),
            variant_pair_names=_pair_name_map(
                payload.get("variantPairNames")
                or payload.get("variant_pair_names")
            ),
            window_length_samples=int(
                payload.get("windowLengthSamples")
                or payload.get("window_length_samples")
                or 0
            ),
            window_step_samples=int(
                payload.get("windowStepSamples")
                or payload.get("window_step_samples")
                or 0
            ),
            delays=_int_list(payload.get("delays")),
            model_terms=_int_list(
                payload.get("modelTerms") or payload.get("model_terms")
            ),
            model_dimension=int(
                payload.get("modelDimension")
                or payload.get("model_dimension")
                or 0
            ),
            polynomial_order=int(
                payload.get("polynomialOrder")
                or payload.get("polynomial_order")
                or 0
            ),
            nr_tau=int(payload.get("nrTau") or payload.get("nr_tau") or 0),
            start_time_seconds=float(
                payload.get("startTimeSeconds")
                or payload.get("start_time_seconds")
                or 0.0
            ),
            end_time_seconds=(
                float(
                    payload.get("endTimeSeconds")
                    if payload.get("endTimeSeconds") is not None
                    else payload.get("end_time_seconds")
                )
                if (
                    payload.get("endTimeSeconds") is not None
                    or payload.get("end_time_seconds") is not None
                )
                else None
            ),
        )


@dataclass
class DdaResultSummary:
    id: str
    file_path: str
    file_name: str
    created_at_iso: str
    engine_label: str
    variant_ids: List[str]
    is_fallback: bool


@dataclass
class IcaComponent:
    component_id: int
    spatial_map: List[float]
    time_series_preview: List[float]
    kurtosis: float
    non_gaussianity: float
    variance_explained: float
    power_frequencies: List[float]
    power_values: List[float]

    @classmethod
    def from_json(cls, payload: dict) -> "IcaComponent":
        return cls(
            component_id=int(payload["componentId"]),
            spatial_map=[float(value) for value in payload.get("spatialMap", [])],
            time_series_preview=[
                float(value) for value in payload.get("timeSeriesPreview", [])
            ],
            kurtosis=float(payload.get("kurtosis", 0.0)),
            non_gaussianity=float(payload.get("nonGaussianity", 0.0)),
            variance_explained=float(payload.get("varianceExplained", 0.0)),
            power_frequencies=[
                float(value) for value in payload.get("powerFrequencies", [])
            ],
            power_values=[float(value) for value in payload.get("powerValues", [])],
        )


@dataclass
class IcaResult:
    id: str
    file_path: str
    file_name: str
    created_at_iso: str
    channel_names: List[str]
    sample_rate_hz: float
    sample_count: int
    components: List[IcaComponent]

    @classmethod
    def from_json(cls, payload: dict) -> "IcaResult":
        return cls(
            id=payload["id"],
            file_path=payload["filePath"],
            file_name=payload["fileName"],
            created_at_iso=payload["createdAtIso"],
            channel_names=[str(value) for value in payload.get("channelNames", [])],
            sample_rate_hz=float(payload.get("sampleRateHz", 0.0)),
            sample_count=int(payload.get("sampleCount", 0)),
            components=[
                IcaComponent.from_json(item) for item in payload.get("components", [])
            ],
        )


@dataclass
class WaveformAnnotation:
    id: str
    label: str
    notes: str
    channel_name: Optional[str]
    start_seconds: float
    end_seconds: Optional[float] = None

    @property
    def is_range(self) -> bool:
        return self.end_seconds is not None and self.end_seconds > self.start_seconds

    @property
    def center_seconds(self) -> float:
        if self.is_range and self.end_seconds is not None:
            return self.start_seconds + (self.end_seconds - self.start_seconds) / 2.0
        return self.start_seconds


@dataclass
class OpenNeuroDataset:
    dataset_id: str
    name: str
    description: str
    created_at_iso: Optional[str]
    snapshot_tag: Optional[str]
    modalities: List[str]
    subjects: Optional[int]
    tasks: List[str]
    size_bytes: Optional[int]
    total_files: Optional[int]


@dataclass
class PluginInstalledEntry:
    plugin_id: str
    name: str
    version: str
    description: Optional[str]
    author: Optional[str]
    category: str
    permissions: List[str]
    source: str
    source_url: Optional[str]
    installed_at: str
    enabled: bool

    @classmethod
    def from_json(cls, payload: dict) -> "PluginInstalledEntry":
        return cls(
            plugin_id=payload["id"],
            name=payload["name"],
            version=payload["version"],
            description=payload.get("description"),
            author=payload.get("author"),
            category=payload.get("category", ""),
            permissions=[str(value) for value in payload.get("permissions", [])],
            source=payload.get("source", ""),
            source_url=payload.get("sourceUrl"),
            installed_at=payload.get("installedAt", ""),
            enabled=bool(payload.get("enabled", False)),
        )


@dataclass
class PluginRegistryEntry:
    plugin_id: str
    name: str
    version: str
    description: str
    author: str
    category: str
    permissions: List[str]
    artifact_url: str
    published_at: str

    @classmethod
    def from_json(cls, payload: dict) -> "PluginRegistryEntry":
        return cls(
            plugin_id=payload["id"],
            name=payload["name"],
            version=payload["version"],
            description=payload.get("description", ""),
            author=payload.get("author", ""),
            category=payload.get("category", ""),
            permissions=[str(value) for value in payload.get("permissions", [])],
            artifact_url=payload.get("artifactUrl", ""),
            published_at=payload.get("publishedAt", ""),
        )


@dataclass
class PluginExecutionResult:
    plugin_id: str
    output_json: str
    logs: List[str]

    @classmethod
    def from_json(cls, payload: dict) -> "PluginExecutionResult":
        return cls(
            plugin_id=payload["pluginId"],
            output_json=payload.get("outputJson", ""),
            logs=[str(value) for value in payload.get("logs", [])],
        )


@dataclass
class NsgCredentialsStatus:
    username: str
    has_password: bool
    has_app_key: bool

    @classmethod
    def from_json(cls, payload: dict) -> "NsgCredentialsStatus":
        return cls(
            username=payload.get("username", ""),
            has_password=bool(payload.get("hasPassword", False)),
            has_app_key=bool(payload.get("hasAppKey", False)),
        )


@dataclass
class NsgJobSnapshot:
    job_id: str
    nsg_job_id: Optional[str]
    tool: str
    status: str
    created_at: str
    submitted_at: Optional[str]
    completed_at: Optional[str]
    input_file_path: str
    output_files: List[str]
    error_message: Optional[str]
    last_polled: Optional[str]
    progress: Optional[int]

    @classmethod
    def from_json(cls, payload: dict) -> "NsgJobSnapshot":
        return cls(
            job_id=payload["id"],
            nsg_job_id=payload.get("nsgJobId"),
            tool=payload.get("tool", ""),
            status=str(payload.get("status", "")),
            created_at=payload.get("createdAt", ""),
            submitted_at=payload.get("submittedAt"),
            completed_at=payload.get("completedAt"),
            input_file_path=payload.get("inputFilePath", ""),
            output_files=[str(value) for value in payload.get("outputFiles", [])],
            error_message=payload.get("errorMessage"),
            last_polled=payload.get("lastPolled"),
            progress=(
                int(payload["progress"])
                if payload.get("progress") is not None
                else None
            ),
        )


@dataclass
class NotificationEntry:
    id: str
    category: str
    level: str
    title: str
    message: str
    created_at_iso: str


@dataclass
class WorkflowActionEntry:
    id: str
    action_type: str
    description: str
    created_at_iso: str
    file_path: Optional[str] = None
    payload: Dict[str, str] = field(default_factory=dict)


@dataclass
class WorkflowSessionEntry:
    id: str
    name: str
    created_at_iso: str
    actions: List[WorkflowActionEntry] = field(default_factory=list)


@dataclass
class DdaRunProgress:
    group_label: str = ""
    stage_id: str = ""
    stage_label: str = ""
    step_index: int = 0
    total_steps: int = 0
    window_index: int = 0
    total_windows: int = 0
    item_index: int = 0
    total_items: int = 0
    item_kind: str = ""
    item_label: str = ""

    @classmethod
    def from_json(cls, payload: object) -> "DdaRunProgress | None":
        if not isinstance(payload, dict):
            return None
        return cls(
            group_label=str(payload.get("group_label") or ""),
            stage_id=str(payload.get("stage_id") or ""),
            stage_label=str(payload.get("stage_label") or ""),
            step_index=int(payload.get("step_index") or 0),
            total_steps=int(payload.get("total_steps") or 0),
            window_index=int(payload.get("window_index") or 0),
            total_windows=int(payload.get("total_windows") or 0),
            item_index=int(payload.get("item_index") or 0),
            total_items=int(payload.get("total_items") or 0),
            item_kind=str(payload.get("item_kind") or ""),
            item_label=str(payload.get("item_label") or ""),
        )


@dataclass
class DdaRunDetails:
    file_name: str
    file_path: str
    started_at_iso: str
    expert_mode: bool = False
    variant_ids: List[str] = field(default_factory=list)
    channel_names: List[str] = field(default_factory=list)
    channel_indices: List[int] = field(default_factory=list)
    variant_channel_names: Dict[str, List[str]] = field(default_factory=dict)
    variant_channel_indices: Dict[str, List[int]] = field(default_factory=dict)
    variant_pair_names: Dict[str, List[tuple[str, str]]] = field(default_factory=dict)
    variant_pair_indices: Dict[str, List[tuple[int, int]]] = field(default_factory=dict)
    window_length_samples: int = 0
    window_step_samples: int = 0
    delays: List[int] = field(default_factory=list)
    model_terms: List[int] = field(default_factory=list)
    model_dimension: int = 0
    polynomial_order: int = 0
    nr_tau: int = 0
    start_time_seconds: float = 0.0
    end_time_seconds: Optional[float] = None
    sample_rate_hz: float = 0.0
    engine_label: str = ""


@dataclass
class AppState:
    browser_path: str = ""
    browser_search: str = ""
    open_files: List[str] = field(default_factory=list)
    pinned_file_paths: List[str] = field(default_factory=list)
    active_file_path: Optional[str] = None
    theme_mode: str = "dark"
    expert_mode: bool = False
    selected_dataset: Optional[LoadedDataset] = None
    selected_channel_names: List[str] = field(default_factory=list)
    waveform_viewport_start_seconds: float = 0.0
    waveform_viewport_duration_seconds: float = 10.0
    waveform_window: Optional[WaveformWindow] = None
    waveform_overview: Optional[WaveformOverview] = None
    dda_result: Optional[DdaResult] = None
    dda_history: List[DdaResult] = field(default_factory=list)
    dda_history_summaries: List[DdaResultSummary] = field(default_factory=list)
    selected_results_history_id: Optional[str] = None
    dda_run_in_progress: bool = False
    dda_run_file_name: Optional[str] = None
    dda_run_variant_ids: List[str] = field(default_factory=list)
    dda_run_details: Optional[DdaRunDetails] = None
    dda_run_progress: Optional[DdaRunProgress] = None
    ica_result: Optional[IcaResult] = None
    installed_plugins: List[PluginInstalledEntry] = field(default_factory=list)
    plugin_registry: List[PluginRegistryEntry] = field(default_factory=list)
    current_plugin_output: Optional[PluginExecutionResult] = None
    nsg_credentials: Optional[NsgCredentialsStatus] = None
    nsg_jobs: List[NsgJobSnapshot] = field(default_factory=list)
    annotations_by_file: Dict[str, List[WaveformAnnotation]] = field(
        default_factory=dict
    )
    notifications: List[NotificationEntry] = field(default_factory=list)
    workflow_recording_enabled: bool = False
    workflow_actions: List[WorkflowActionEntry] = field(default_factory=list)
    saved_workflow_sessions: List[WorkflowSessionEntry] = field(default_factory=list)
