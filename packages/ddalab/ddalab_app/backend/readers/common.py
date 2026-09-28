from __future__ import annotations

import hashlib
import json
import math
import os
import re
import threading
from abc import ABC, abstractmethod
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

from ...domain.models import (
    ChannelWaveform,
    LoadedDataset,
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
_reader_cache: Dict[str, tuple[tuple[int, int], PythonDatasetReader]] = {}  # path -> (mtime, size), reader
_TIME_HEADER = re.compile(r"(time|timestamp|seconds?|samples?)(?![a-z])")


def _is_time_header(name: str) -> bool:
    """True for time column names such as "time", "Time (s)", or "timestamp_ms"."""
    return _TIME_HEADER.match(name.strip().lower()) is not None
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


def _finite_range(values: np.ndarray) -> tuple[float, float]:
    """Min and max of the finite samples, so one gap can't flatten a channel's scale."""
    finite = values[np.isfinite(values)]
    return (float(finite.min()), float(finite.max())) if finite.size else (0.0, 0.0)


def _build_channel_waveform(
    name: str,
    sample_rate_hz: float,
    samples: np.ndarray,
    unit: Optional[str],
) -> ChannelWaveform:
    # float64 arrays: DDA reads these samples, so they keep full precision
    clean = np.asarray(samples, dtype=np.float64).reshape(-1)
    min_value, max_value = _finite_range(clean)
    return ChannelWaveform(
        name=name,
        sample_rate_hz=sample_rate_hz,
        samples=clean,
        unit=unit,
        min_value=min_value,
        max_value=max_value,
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
        min_value=_finite_range(clean)[0],
        max_value=_finite_range(clean)[1],
    )


def _start_sample(seconds: float, sample_rate: float) -> int:
    """First sample at or after `seconds`, tolerant of float round trips (0.29 * 100)."""
    return max(int(math.floor(seconds * sample_rate + 1e-6)), 0)


def _unique_names(names: Sequence[str]) -> List[str]:
    """Suffix repeated names ("A", "A-2", ...) so every channel can be found by name."""
    seen: Dict[str, int] = {}
    unique: List[str] = []
    for name in names:
        seen[name] = seen.get(name, 0) + 1
        candidate = name if seen[name] == 1 else f"{name}-{seen[name]}"
        while candidate in unique:
            seen[name] += 1
            candidate = f"{name}-{seen[name]}"
        unique.append(candidate)
    return unique


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
