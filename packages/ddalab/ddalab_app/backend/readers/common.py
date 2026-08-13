from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from abc import ABC, abstractmethod
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

from ...domain.models import (
    ChannelWaveform,
    LoadedDataset,
    WaveformEnvelopeLevel,
    WaveformOverview,
    WaveformOverviewChannel,
    WaveformWindow,
)


class PythonDatasetReaderError(RuntimeError):
    pass


class PythonDatasetReader(ABC):
    def __init__(self, path: str) -> None:
        self.path = str(Path(path))
        self.path_obj = Path(path)

    @abstractmethod
    def load_metadata(self) -> LoadedDataset:
        raise NotImplementedError

    @abstractmethod
    def load_waveform_window(
        self,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: Sequence[str],
    ) -> WaveformWindow:
        raise NotImplementedError

    @abstractmethod
    def load_waveform_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
    ) -> WaveformOverview:
        raise NotImplementedError

    def close(self) -> None:
        return None

    def _cached_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
        *,
        extra_signature: str,
        builder,
    ) -> WaveformOverview:
        cached = _read_cached_overview(
            self.path,
            channel_names,
            max_buckets,
            extra_signature,
        )
        if cached is not None:
            return cached
        overview = builder()
        _write_cached_overview(
            overview,
            self.path,
            channel_names,
            max_buckets,
            extra_signature,
        )
        return overview


_reader_lock = threading.Lock()
_reader_cache: Dict[str, PythonDatasetReader] = {}
_DELIMITED_TIME_HEADERS = {"time", "timestamp", "seconds", "sample", "samples"}
_DEFAULT_NIFTI_BROWSER_CHANNEL_LIMIT = 65_536


def _nifti_browser_channel_limit() -> int:
    raw_limit = os.environ.get(
        "DDALAB_NIFTI_BROWSER_CHANNEL_LIMIT",
        str(_DEFAULT_NIFTI_BROWSER_CHANNEL_LIMIT),
    ).strip()
    try:
        parsed_limit = int(raw_limit)
    except ValueError:
        return _DEFAULT_NIFTI_BROWSER_CHANNEL_LIMIT
    return max(parsed_limit, 0)


def _overview_cache_root() -> Path:
    root = Path.home() / ".ddalab-qt" / "cache" / "overview"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _path_cache_fingerprint(path_obj: Path) -> str:
    try:
        stat = path_obj.stat()
    except OSError:
        return "missing"
    if path_obj.is_file():
        return f"file:{stat.st_size}:{stat.st_mtime_ns}"
    latest_mtime = stat.st_mtime_ns
    child_count = 0
    aggregate_size = 0
    try:
        for child in path_obj.iterdir():
            try:
                child_stat = child.stat()
            except OSError:
                continue
            child_count += 1
            aggregate_size += child_stat.st_size
            latest_mtime = max(latest_mtime, child_stat.st_mtime_ns)
    except OSError:
        return f"dir:{latest_mtime}:unreadable"
    return f"dir:{child_count}:{aggregate_size}:{latest_mtime}"


def _overview_cache_path(
    path: str,
    channel_names: Sequence[str],
    max_buckets: int,
    extra_signature: str,
) -> Path:
    payload = {
        "version": 1,
        "path": str(Path(path).resolve()),
        "fingerprint": _path_cache_fingerprint(Path(path)),
        "channels": list(channel_names),
        "maxBuckets": int(max_buckets),
        "extra": extra_signature,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return _overview_cache_root() / digest[:2] / f"{digest}.json"


def _read_cached_overview(
    path: str,
    channel_names: Sequence[str],
    max_buckets: int,
    extra_signature: str,
) -> Optional[WaveformOverview]:
    cache_path = _overview_cache_path(path, channel_names, max_buckets, extra_signature)
    if not cache_path.exists():
        return None
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    payload["fromCache"] = True
    return WaveformOverview.from_json(payload)


def _write_cached_overview(
    overview: WaveformOverview,
    path: str,
    channel_names: Sequence[str],
    max_buckets: int,
    extra_signature: str,
) -> None:
    cache_path = _overview_cache_path(path, channel_names, max_buckets, extra_signature)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(overview)
    payload["from_cache"] = True
    try:
        cache_path.write_text(
            json.dumps(payload, separators=(",", ":")),
            encoding="utf-8",
        )
    except OSError:
        return None


def _normalized_suffix(path: str) -> str:
    lower = Path(path).name.lower()
    if lower.endswith(".nii.gz"):
        return ".nii.gz"
    return Path(path).suffix.lower()


def _bucket_extrema(
    values: np.ndarray, bucket_size: int
) -> tuple[np.ndarray, np.ndarray]:
    if values.size == 0:
        return np.empty(0, dtype=np.float64), np.empty(0, dtype=np.float64)
    bucket_size = max(int(bucket_size), 1)
    bucket_count = int(math.ceil(values.size / bucket_size))
    padded_size = bucket_count * bucket_size
    if padded_size == values.size:
        reshaped = values.reshape(bucket_count, bucket_size)
    else:
        padded = np.empty(padded_size, dtype=np.float64)
        padded[:] = np.nan
        padded[: values.size] = values
        reshaped = padded.reshape(bucket_count, bucket_size)
    return np.nanmin(reshaped, axis=1), np.nanmax(reshaped, axis=1)


def _build_envelope_levels(samples: np.ndarray) -> List[WaveformEnvelopeLevel]:
    sample_count = int(samples.size)
    if sample_count <= 0:
        return []
    levels: List[WaveformEnvelopeLevel] = []
    for bucket_size in (8, 32, 128, 512, 2048):
        if sample_count <= bucket_size * 2:
            continue
        mins, maxs = _bucket_extrema(samples, bucket_size)
        levels.append(
            WaveformEnvelopeLevel(
                bucket_size=bucket_size,
                mins=mins.astype(np.float64).tolist(),
                maxs=maxs.astype(np.float64).tolist(),
            )
        )
    return levels


def _build_channel_waveform(
    name: str,
    sample_rate_hz: float,
    samples: np.ndarray,
    unit: Optional[str],
) -> ChannelWaveform:
    clean = np.asarray(samples, dtype=np.float64).reshape(-1)
    min_value = float(np.min(clean)) if clean.size else 0.0
    max_value = float(np.max(clean)) if clean.size else 0.0
    return ChannelWaveform(
        name=name,
        sample_rate_hz=sample_rate_hz,
        samples=clean.tolist(),
        unit=unit,
        min_value=min_value,
        max_value=max_value,
        levels=_build_envelope_levels(clean),
    )


def _build_overview_channel(
    name: str,
    duration_seconds: float,
    samples: np.ndarray,
    max_buckets: int,
) -> WaveformOverviewChannel:
    clean = np.asarray(samples, dtype=np.float64).reshape(-1)
    bucket_size = max(1, int(math.ceil(clean.size / max(float(max_buckets), 1.0))))
    mins, maxs = _bucket_extrema(clean, bucket_size)
    bucket_count = max(int(mins.size), 1)
    return WaveformOverviewChannel(
        name=name,
        bucket_duration_seconds=duration_seconds / bucket_count
        if duration_seconds > 0
        else 0.0,
        mins=mins.astype(np.float64).tolist(),
        maxs=maxs.astype(np.float64).tolist(),
        min_value=float(np.min(clean)) if clean.size else 0.0,
        max_value=float(np.max(clean)) if clean.size else 0.0,
    )


def _resolve_channel_indices(
    available_names: Sequence[str],
    requested_names: Sequence[str],
) -> List[int]:
    index_map = {name: index for index, name in enumerate(available_names)}
    return [index_map[name] for name in requested_names if name in index_map]


def _estimate_sample_rate(times: Sequence[float]) -> float:
    if len(times) < 2:
        return 1.0
    deltas = [
        float(right) - float(left)
        for left, right in zip(times, times[1:])
        if math.isfinite(float(left)) and math.isfinite(float(right))
    ]
    positive = [delta for delta in deltas if delta > 0.0 and math.isfinite(delta)]
    if not positive:
        return 1.0
    return 1.0 / max(sum(positive) / len(positive), 1e-6)
