from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


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
            bucket_size=int(payload["bucketSize"]),
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
            sample_rate_hz=float(payload["sampleRateHz"]),
            samples=[float(value) for value in payload.get("samples", [])],
            unit=payload.get("unit"),
            min_value=float(payload.get("minValue", 0.0)),
            max_value=float(payload.get("maxValue", 0.0)),
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
            dataset_file_path=payload["datasetFilePath"],
            start_time_seconds=float(payload["startTimeSeconds"]),
            duration_seconds=float(payload["durationSeconds"]),
            channels=[
                ChannelWaveform.from_json(item) for item in payload.get("channels", [])
            ],
            from_cache=bool(payload.get("fromCache", False)),
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
            bucket_duration_seconds=float(payload["bucketDurationSeconds"]),
            mins=[float(value) for value in payload.get("mins", [])],
            maxs=[float(value) for value in payload.get("maxs", [])],
            min_value=float(payload.get("minValue", 0.0)),
            max_value=float(payload.get("maxValue", 0.0)),
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
            dataset_file_path=payload["datasetFilePath"],
            duration_seconds=float(payload["durationSeconds"]),
            channels=[
                WaveformOverviewChannel.from_json(item)
                for item in payload.get("channels", [])
            ],
            from_cache=bool(payload.get("fromCache", False)),
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

    @classmethod
    def from_json(cls, payload: dict) -> "DdaVariantResult":
        return cls(
            id=payload["id"],
            label=payload["label"],
            row_labels=list(payload.get("rowLabels", [])),
            matrix=[
                [float(value) for value in row] for row in payload.get("matrix", [])
            ],
            summary=payload.get("summary", ""),
            min_value=float(payload.get("minValue", 0.0)),
            max_value=float(payload.get("maxValue", 0.0)),
        )


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

    @classmethod
    def from_json(cls, payload: dict) -> "DdaResult":
        return cls(
            id=payload["id"],
            file_path=payload["filePath"],
            file_name=payload["fileName"],
            created_at_iso=payload["createdAtIso"],
            engine_label=payload.get("engineLabel", ""),
            diagnostics=list(payload.get("diagnostics", [])),
            window_centers_seconds=[
                float(value) for value in payload.get("windowCentersSeconds", [])
            ],
            variants=[
                DdaVariantResult.from_json(item) for item in payload.get("variants", [])
            ],
            is_fallback=bool(payload.get("isFallback", False)),
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
class DdaRunDetails:
    file_name: str
    file_path: str
    started_at_iso: str
    variant_ids: List[str] = field(default_factory=list)
    channel_names: List[str] = field(default_factory=list)
    channel_indices: List[int] = field(default_factory=list)
    window_length_samples: int = 0
    window_step_samples: int = 0
    delays: List[int] = field(default_factory=list)
    start_time_seconds: float = 0.0
    end_time_seconds: Optional[float] = None
    sample_rate_hz: float = 0.0
    engine_label: str = ""


@dataclass
class AppState:
    browser_path: str = ""
    browser_search: str = ""
    open_files: List[str] = field(default_factory=list)
    active_file_path: Optional[str] = None
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
