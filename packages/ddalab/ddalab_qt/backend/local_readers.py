from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from abc import ABC, abstractmethod
from dataclasses import asdict
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

from ..domain.file_types import classify_path, resolve_dataset_path
from ..domain.models import (
    ChannelDescriptor,
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


def get_python_dataset_reader(path: str) -> PythonDatasetReader:
    resolved_path = resolve_dataset_path(path, Path(path).is_dir())
    with _reader_lock:
        cached = _reader_cache.get(resolved_path)
        if cached is not None:
            return cached
        reader = _build_reader(resolved_path)
        _reader_cache[resolved_path] = reader
        return reader


def close_python_dataset_readers() -> None:
    with _reader_lock:
        readers = list(_reader_cache.values())
        _reader_cache.clear()
    for reader in readers:
        try:
            reader.close()
        except Exception:
            continue


def _build_reader(path: str) -> PythonDatasetReader:
    info = classify_path(path, Path(path).is_dir())
    label = info.label.lower()
    suffix = _normalized_suffix(path)

    if suffix in {".csv", ".ascii", ".txt"}:
        return DelimitedDatasetReader(path)
    if any(
        token in label
        for token in (
            "brainvision",
            "eeglab",
            "fif",
            "bdf",
            "cnt",
            "egi",
            "gdf",
            "kit",
            "meg",
            "edf",
        )
    ) or suffix in {
        ".vhdr",
        ".set",
        ".fif",
        ".fiff",
        ".bdf",
        ".cnt",
        ".egi",
        ".gdf",
        ".con",
        ".sqd",
        ".meg4",
        ".kit",
        ".ds",
        ".mff",
    }:
        return MneDatasetReader(path)
    if suffix in {".nii", ".nii.gz"}:
        return NiftiDatasetReader(path)
    if suffix == ".xdf":
        return XdfDatasetReader(path)
    if suffix == ".nwb":
        return NwbDatasetReader(path)
    raise PythonDatasetReaderError(f"Unsupported fallback dataset format: {path}")


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


class DelimitedDatasetReader(PythonDatasetReader):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        self._metadata: Optional[LoadedDataset] = None
        self._delimiter: Optional[str] = (
            "," if _normalized_suffix(path) == ".csv" else None
        )
        (
            self._channel_names,
            self._time_axis_name,
            self._sample_rate_hz,
            self._duration_seconds,
            self._samples,
            self._timestamps,
            self._notes,
            self._source_summary,
        ) = self._load_file()

    def load_metadata(self) -> LoadedDataset:
        if self._metadata is not None:
            return self._metadata
        format_label = "CSV" if self._delimiter == "," else "ASCII"
        self._metadata = LoadedDataset(
            file_path=self.path,
            file_name=self.path_obj.name,
            format_label=format_label,
            file_size_bytes=self.path_obj.stat().st_size,
            duration_seconds=self._duration_seconds,
            total_sample_count=int(self._samples.shape[1]),
            time_axis_name=self._time_axis_name,
            source_summary=self._source_summary,
            notes=list(self._notes),
            channels=[
                ChannelDescriptor(
                    name=name,
                    sample_rate_hz=self._sample_rate_hz,
                    sample_count=int(self._samples.shape[1]),
                    unit=None,
                )
                for name in self._channel_names
            ],
            supports_windowed_access=True,
        )
        return self._metadata

    def load_waveform_window(
        self,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: Sequence[str],
    ) -> WaveformWindow:
        metadata = self.load_metadata()
        start_index, stop_index, actual_start, actual_duration = self._window_indices(
            start_time_seconds,
            duration_seconds,
        )
        picks = _resolve_channel_indices(self._channel_names, channel_names)
        channels = [
            _build_channel_waveform(
                self._channel_names[pick],
                self._sample_rate_hz,
                self._samples[pick, start_index:stop_index],
                None,
            )
            for pick in picks
        ]
        return WaveformWindow(
            dataset_file_path=self.path,
            start_time_seconds=actual_start,
            duration_seconds=actual_duration,
            channels=channels,
            from_cache=False,
        )

    def load_waveform_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
    ) -> WaveformOverview:
        metadata = self.load_metadata()

        def build() -> WaveformOverview:
            picks = _resolve_channel_indices(self._channel_names, channel_names)
            channels = [
                _build_overview_channel(
                    self._channel_names[pick],
                    metadata.duration_seconds,
                    self._samples[pick],
                    max_buckets,
                )
                for pick in picks
            ]
            return WaveformOverview(
                dataset_file_path=self.path,
                duration_seconds=metadata.duration_seconds,
                channels=channels,
                from_cache=False,
            )

        return self._cached_overview(
            channel_names,
            max_buckets,
            extra_signature=f"{self.__class__.__name__}:{self._samples.shape}",
            builder=build,
        )

    def _load_file(
        self,
    ) -> tuple[
        List[str],
        str,
        float,
        float,
        np.ndarray,
        Optional[np.ndarray],
        List[str],
        str,
    ]:
        try:
            raw_lines = [
                line.strip().lstrip("\ufeff")
                for line in self.path_obj.read_text(
                    encoding="utf-8",
                    errors="replace",
                ).splitlines()
                if line.strip()
            ]
        except OSError as exc:
            raise PythonDatasetReaderError(
                f"Failed to read delimited dataset: {exc}"
            ) from exc
        if not raw_lines:
            raise PythonDatasetReaderError(f"File is empty: {self.path_obj.name}")

        splitter = self._split_line
        first_tokens = splitter(raw_lines[0])
        has_header = any(_safe_float(token) is None for token in first_tokens)
        header = first_tokens if has_header else []
        data_lines = raw_lines[1:] if has_header else raw_lines

        rows: List[List[float]] = []
        for line in data_lines:
            tokens = splitter(line)
            numbers = [_safe_float(token) for token in tokens]
            if numbers and all(value is not None for value in numbers):
                rows.append([float(value) for value in numbers if value is not None])
        if not rows:
            raise PythonDatasetReaderError(
                f"No numeric samples were found in {self.path_obj.name}"
            )

        column_count = min(len(row) for row in rows)
        if column_count <= 0:
            raise PythonDatasetReaderError(
                f"No signal columns were found in {self.path_obj.name}"
            )
        effective_header = (
            header[:column_count]
            if header and len(header) >= column_count
            else [f"Channel {index + 1}" for index in range(column_count)]
        )
        has_explicit_time = (
            effective_header[0].strip().lower() in _DELIMITED_TIME_HEADERS
            if effective_header
            else False
        )
        start_column = 1 if has_explicit_time else 0
        channel_names = [
            name if name.strip() else f"Channel {index + 1}"
            for index, name in enumerate(effective_header[start_column:])
        ]
        if not channel_names:
            raise PythonDatasetReaderError(
                f"At least one signal channel is required in {self.path_obj.name}"
            )

        data = np.asarray([row[:column_count] for row in rows], dtype=np.float64)
        timestamps = data[:, 0].copy() if has_explicit_time else None
        sample_rate = _estimate_sample_rate(
            timestamps.tolist() if timestamps is not None else list(range(len(rows)))
        )
        duration_seconds = (
            max(float(timestamps[-1] - timestamps[0]), 0.0)
            if timestamps is not None and timestamps.size > 1
            else len(rows) / sample_rate
        )
        notes = []
        if has_header:
            notes.append("Header row detected")
        if has_explicit_time:
            notes.append(f"Time axis: {effective_header[0]}")
        notes.append(f"Parsed {len(rows)} rows x {len(channel_names)} channels")
        source_summary = (
            "Explicit time column detected"
            if has_explicit_time
            else "Uniform synthetic sample axis"
        )
        return (
            channel_names,
            effective_header[0] if has_explicit_time else "Sample",
            sample_rate,
            max(duration_seconds, 0.0),
            np.ascontiguousarray(data[:, start_column:].T),
            timestamps,
            notes,
            source_summary,
        )

    def _split_line(self, line: str) -> List[str]:
        if self._delimiter is not None:
            return [token.strip() for token in line.split(self._delimiter)]
        return line.strip().split()

    def _window_indices(
        self,
        start_time_seconds: float,
        duration_seconds: float,
    ) -> tuple[int, int, float, float]:
        sample_count = int(self._samples.shape[1])
        if sample_count <= 0:
            return 0, 0, 0.0, 0.0
        safe_start = max(float(start_time_seconds), 0.0)
        safe_duration = max(float(duration_seconds), 1.0 / max(self._sample_rate_hz, 1.0))
        if self._timestamps is not None and self._timestamps.size:
            base_time = float(self._timestamps[0])
            start_index = int(
                np.searchsorted(self._timestamps, base_time + safe_start, side="left")
            )
            stop_index = int(
                np.searchsorted(
                    self._timestamps,
                    base_time + safe_start + safe_duration,
                    side="right",
                )
            )
            start_index = min(max(start_index, 0), sample_count - 1)
            stop_index = min(max(stop_index, start_index + 1), sample_count)
            actual_start = max(float(self._timestamps[start_index] - base_time), 0.0)
            if stop_index - start_index > 1:
                actual_duration = max(
                    float(self._timestamps[stop_index - 1] - self._timestamps[start_index]),
                    0.0,
                )
            else:
                actual_duration = 1.0 / max(self._sample_rate_hz, 1.0)
            return start_index, stop_index, actual_start, actual_duration

        start_index = max(int(safe_start * self._sample_rate_hz), 0)
        stop_index = min(
            max(
                int(math.ceil((safe_start + safe_duration) * self._sample_rate_hz)),
                start_index + 1,
            ),
            sample_count,
        )
        start_index = min(start_index, max(sample_count - 1, 0))
        actual_start = start_index / self._sample_rate_hz if self._sample_rate_hz > 0 else 0.0
        actual_duration = (
            (stop_index - start_index) / self._sample_rate_hz
            if self._sample_rate_hz > 0
            else 0.0
        )
        return start_index, stop_index, actual_start, actual_duration


def _safe_float(value: str) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class MneDatasetReader(PythonDatasetReader):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        try:
            import mne
        except ImportError as exc:
            raise PythonDatasetReaderError(
                "Opening this dataset requires MNE-Python. Re-run ./start.sh so the Qt environment installs optional readers."
            ) from exc
        mne.set_log_level("ERROR")
        self._mne = mne
        try:
            self.raw = mne.io.read_raw(self.path, preload=False, verbose="ERROR")
        except Exception as exc:
            raise PythonDatasetReaderError(
                f"Failed to open dataset with MNE: {exc}"
            ) from exc
        self._metadata: Optional[LoadedDataset] = None
        self._units = {
            channel_name: _mne_channel_unit(self.raw, channel_name)
            for channel_name in self.raw.ch_names
        }

    def load_metadata(self) -> LoadedDataset:
        if self._metadata is not None:
            return self._metadata
        format_label = classify_path(self.path, self.path_obj.is_dir()).label.split(
            " · "
        )[-1]
        sample_rate = float(self.raw.info.get("sfreq") or 1.0)
        channel_names = list(self.raw.ch_names)
        channels = [
            ChannelDescriptor(
                name=name,
                sample_rate_hz=sample_rate,
                sample_count=int(self.raw.n_times),
                unit=self._units.get(name),
            )
            for name in channel_names
        ]
        self._metadata = LoadedDataset(
            file_path=self.path,
            file_name=self.path_obj.name,
            format_label=format_label,
            file_size_bytes=self.path_obj.stat().st_size,
            duration_seconds=float(self.raw.n_times) / sample_rate
            if sample_rate > 0
            else 0.0,
            total_sample_count=int(self.raw.n_times),
            time_axis_name="Time (s)",
            source_summary=f"{format_label} dataset loaded locally through MNE-Python.",
            notes=[f"MNE reader: {self.raw.info.get('description') or format_label}"],
            channels=channels,
            supports_windowed_access=True,
        )
        return self._metadata

    def load_waveform_window(
        self,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: Sequence[str],
    ) -> WaveformWindow:
        metadata = self.load_metadata()
        sample_rate = metadata.dominant_sample_rate_hz
        start_sample = max(int(start_time_seconds * sample_rate), 0)
        sample_count = max(int(math.ceil(duration_seconds * sample_rate)), 1)
        stop_sample = min(start_sample + sample_count, metadata.total_sample_count)
        picks = _resolve_channel_indices(metadata.channel_names, channel_names)
        try:
            data = self.raw.get_data(picks=picks, start=start_sample, stop=stop_sample)
        except Exception as exc:
            raise PythonDatasetReaderError(
                f"Failed to read waveform window: {exc}"
            ) from exc
        channels = [
            _build_channel_waveform(
                metadata.channel_names[pick],
                sample_rate,
                np.asarray(data[index], dtype=np.float64),
                self._units.get(metadata.channel_names[pick]),
            )
            for index, pick in enumerate(picks)
        ]
        return WaveformWindow(
            dataset_file_path=self.path,
            start_time_seconds=start_sample / sample_rate if sample_rate > 0 else 0.0,
            duration_seconds=(stop_sample - start_sample) / sample_rate
            if sample_rate > 0
            else 0.0,
            channels=channels,
            from_cache=False,
        )

    def load_waveform_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
    ) -> WaveformOverview:
        metadata = self.load_metadata()
        
        def build() -> WaveformOverview:
            picks = _resolve_channel_indices(metadata.channel_names, channel_names)
            try:
                data = self.raw.get_data(picks=picks)
            except Exception as exc:
                raise PythonDatasetReaderError(
                    f"Failed to build overview: {exc}"
                ) from exc
            channels = [
                _build_overview_channel(
                    metadata.channel_names[pick],
                    metadata.duration_seconds,
                    np.asarray(data[index], dtype=np.float64),
                    max_buckets,
                )
                for index, pick in enumerate(picks)
            ]
            return WaveformOverview(
                dataset_file_path=self.path,
                duration_seconds=metadata.duration_seconds,
                channels=channels,
                from_cache=False,
            )
        return self._cached_overview(
            channel_names,
            max_buckets,
            extra_signature=f"{self.__class__.__name__}:{metadata.total_sample_count}",
            builder=build,
        )


class NiftiDatasetReader(PythonDatasetReader):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        try:
            import nibabel as nib
        except ImportError as exc:
            raise PythonDatasetReaderError(
                "Opening NIfTI datasets requires nibabel. Re-run ./start.sh so the Qt environment installs optional readers."
            ) from exc
        self._nib = nib
        try:
            self.image = nib.load(self.path)
        except Exception as exc:
            raise PythonDatasetReaderError(
                f"Failed to open NIfTI dataset: {exc}"
            ) from exc
        self.dataobj = self.image.dataobj
        self.shape = tuple(int(value) for value in self.image.shape)
        if len(self.shape) < 3:
            raise PythonDatasetReaderError(
                f"Unsupported NIfTI dimensionality: {self.shape}"
            )
        self.spatial_shape = self.shape[:3]
        self.num_timepoints = self.shape[3] if len(self.shape) > 3 else 1
        self.num_voxels = int(np.prod(self.spatial_shape))
        self.sample_rate_hz = _nifti_sample_rate(self.image)
        self._metadata: Optional[LoadedDataset] = None

    def load_metadata(self) -> LoadedDataset:
        if self._metadata is not None:
            return self._metadata
        zooms = self.image.header.get_zooms()
        representative_indices = _representative_nifti_indices(
            self.num_voxels,
            _nifti_browser_channel_limit(),
        )
        truncated = len(representative_indices) < self.num_voxels
        notes = [
            f"Spatial dimensions: {self.spatial_shape[0]}×{self.spatial_shape[1]}×{self.spatial_shape[2]}",
            f"Voxel size: {', '.join(f'{value:.3f}' for value in zooms[: min(len(zooms), 3)])}",
        ]
        if truncated:
            notes.append(
                "Showing a representative subset of "
                f"{len(representative_indices):,} voxels out of {self.num_voxels:,} total."
            )
        self._metadata = LoadedDataset(
            file_path=self.path,
            file_name=self.path_obj.name,
            format_label="NIfTI",
            file_size_bytes=self.path_obj.stat().st_size,
            duration_seconds=self.num_timepoints / self.sample_rate_hz
            if self.sample_rate_hz > 0
            else 0.0,
            total_sample_count=self.num_timepoints,
            time_axis_name="Timepoints",
            source_summary=(
                "NIfTI volume exposed as per-voxel time series for inspection."
                if not truncated
                else "NIfTI volume exposed as a representative per-voxel subset for inspection."
            ),
            notes=notes,
            channels=[
                ChannelDescriptor(
                    name=_voxel_name(index, self.spatial_shape),
                    sample_rate_hz=self.sample_rate_hz,
                    sample_count=self.num_timepoints,
                    unit="a.u.",
                )
                for index in representative_indices
            ],
            supports_windowed_access=True,
        )
        return self._metadata

    def load_waveform_window(
        self,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: Sequence[str],
    ) -> WaveformWindow:
        self.load_metadata()
        start_sample = max(int(start_time_seconds * self.sample_rate_hz), 0)
        stop_sample = min(
            max(
                start_sample + int(math.ceil(duration_seconds * self.sample_rate_hz)),
                start_sample + 1,
            ),
            self.num_timepoints,
        )
        channels: List[ChannelWaveform] = []
        for name in channel_names:
            coordinates = _voxel_coordinates_from_name(name)
            if coordinates is None:
                continue
            x, y, z = coordinates
            if self.num_timepoints == 1:
                samples = np.asarray([self.dataobj[x, y, z]], dtype=np.float64)
            else:
                samples = np.asarray(
                    self.dataobj[x, y, z, start_sample:stop_sample], dtype=np.float64
                )
            channels.append(
                _build_channel_waveform(name, self.sample_rate_hz, samples, "a.u.")
            )
        return WaveformWindow(
            dataset_file_path=self.path,
            start_time_seconds=start_sample / self.sample_rate_hz
            if self.sample_rate_hz > 0
            else 0.0,
            duration_seconds=(stop_sample - start_sample) / self.sample_rate_hz
            if self.sample_rate_hz > 0
            else 0.0,
            channels=channels,
            from_cache=False,
        )

    def load_waveform_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
    ) -> WaveformOverview:
        metadata = self.load_metadata()
        
        def build() -> WaveformOverview:
            channels: List[WaveformOverviewChannel] = []
            for name in channel_names:
                coordinates = _voxel_coordinates_from_name(name)
                if coordinates is None:
                    continue
                x, y, z = coordinates
                if self.num_timepoints == 1:
                    samples = np.asarray([self.dataobj[x, y, z]], dtype=np.float64)
                else:
                    samples = np.asarray(self.dataobj[x, y, z, :], dtype=np.float64)
                channels.append(
                    _build_overview_channel(
                        name,
                        metadata.duration_seconds,
                        samples,
                        max_buckets,
                    )
                )
            return WaveformOverview(
                dataset_file_path=self.path,
                duration_seconds=metadata.duration_seconds,
                channels=channels,
                from_cache=False,
            )
        return self._cached_overview(
            channel_names,
            max_buckets,
            extra_signature=(
                f"{self.__class__.__name__}:{self.spatial_shape}:{self.num_timepoints}"
            ),
            builder=build,
        )


class XdfDatasetReader(PythonDatasetReader):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        try:
            import pyxdf
        except ImportError as exc:
            raise PythonDatasetReaderError(
                "Opening XDF datasets requires pyxdf. Re-run ./start.sh so the Qt environment installs optional readers."
            ) from exc
        try:
            streams, _ = pyxdf.load_xdf(self.path)
        except Exception as exc:
            raise PythonDatasetReaderError(
                f"Failed to open XDF dataset: {exc}"
            ) from exc
        if not streams:
            raise PythonDatasetReaderError("No streams were found in the XDF dataset.")
        self.stream = _select_xdf_stream(streams)
        self.samples = np.asarray(self.stream["time_series"], dtype=np.float64)
        if self.samples.ndim == 1:
            self.samples = self.samples[:, np.newaxis]
        self.timestamps = np.asarray(self.stream["time_stamps"], dtype=np.float64)
        self.channel_names = _extract_xdf_channel_names(
            self.stream, self.samples.shape[1]
        )
        self.sample_rate_hz = _xdf_sample_rate(self.stream, self.timestamps)
        self._metadata: Optional[LoadedDataset] = None

    def load_metadata(self) -> LoadedDataset:
        if self._metadata is not None:
            return self._metadata
        duration_seconds = (
            float(self.timestamps[-1] - self.timestamps[0])
            if self.timestamps.size > 1
            else float(self.samples.shape[0] / max(self.sample_rate_hz, 1.0))
        )
        self._metadata = LoadedDataset(
            file_path=self.path,
            file_name=self.path_obj.name,
            format_label="XDF",
            file_size_bytes=self.path_obj.stat().st_size,
            duration_seconds=duration_seconds,
            total_sample_count=int(self.samples.shape[0]),
            time_axis_name="LSL Time",
            source_summary="Primary XDF stream loaded locally for waveform inspection.",
            notes=[f"Stream: {_xdf_stream_name(self.stream)}"],
            channels=[
                ChannelDescriptor(
                    name=name,
                    sample_rate_hz=self.sample_rate_hz,
                    sample_count=int(self.samples.shape[0]),
                    unit="a.u.",
                )
                for name in self.channel_names
            ],
            supports_windowed_access=True,
        )
        return self._metadata

    def load_waveform_window(
        self,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: Sequence[str],
    ) -> WaveformWindow:
        self.load_metadata()
        start_index, stop_index = _xdf_window_indices(
            self.timestamps, start_time_seconds, duration_seconds
        )
        indices = _resolve_channel_indices(self.channel_names, channel_names)
        channels = [
            _build_channel_waveform(
                self.channel_names[index],
                self.sample_rate_hz,
                self.samples[start_index:stop_index, index],
                "a.u.",
            )
            for index in indices
        ]
        return WaveformWindow(
            dataset_file_path=self.path,
            start_time_seconds=float(self.timestamps[start_index] - self.timestamps[0])
            if self.timestamps.size
            else start_time_seconds,
            duration_seconds=float(
                self.timestamps[stop_index - 1] - self.timestamps[start_index]
            )
            if stop_index - start_index > 1
            else duration_seconds,
            channels=channels,
            from_cache=False,
        )

    def load_waveform_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
    ) -> WaveformOverview:
        metadata = self.load_metadata()
        
        def build() -> WaveformOverview:
            indices = _resolve_channel_indices(self.channel_names, channel_names)
            channels = [
                _build_overview_channel(
                    self.channel_names[index],
                    metadata.duration_seconds,
                    self.samples[:, index],
                    max_buckets,
                )
                for index in indices
            ]
            return WaveformOverview(
                dataset_file_path=self.path,
                duration_seconds=metadata.duration_seconds,
                channels=channels,
                from_cache=False,
            )
        return self._cached_overview(
            channel_names,
            max_buckets,
            extra_signature=f"{self.__class__.__name__}:{self.samples.shape}",
            builder=build,
        )


class NwbDatasetReader(PythonDatasetReader):
    def __init__(self, path: str) -> None:
        super().__init__(path)
        try:
            from pynwb import NWBHDF5IO
        except ImportError as exc:
            raise PythonDatasetReaderError(
                "Opening NWB datasets requires pynwb. Re-run ./start.sh so the Qt environment installs optional readers."
            ) from exc
        try:
            self._io = NWBHDF5IO(self.path, "r", load_namespaces=True)
            self.nwbfile = self._io.read()
        except Exception as exc:
            raise PythonDatasetReaderError(
                f"Failed to open NWB dataset: {exc}"
            ) from exc
        self.series = _select_nwb_series(self.nwbfile)
        self.sample_rate_hz = _nwb_sample_rate(self.series)
        self.channel_names = _nwb_channel_names(self.series)
        data = self.series.data
        self.num_samples = int(data.shape[0])
        self._metadata: Optional[LoadedDataset] = None

    def close(self) -> None:
        try:
            self._io.close()
        except Exception:
            return

    def load_metadata(self) -> LoadedDataset:
        if self._metadata is not None:
            return self._metadata
        duration_seconds = (
            self.num_samples / self.sample_rate_hz if self.sample_rate_hz > 0 else 0.0
        )
        self._metadata = LoadedDataset(
            file_path=self.path,
            file_name=self.path_obj.name,
            format_label="NWB",
            file_size_bytes=self.path_obj.stat().st_size,
            duration_seconds=duration_seconds,
            total_sample_count=self.num_samples,
            time_axis_name="Time (s)",
            source_summary="ElectricalSeries loaded locally from the NWB container.",
            notes=[f"Series: {getattr(self.series, 'name', 'ElectricalSeries')}"],
            channels=[
                ChannelDescriptor(
                    name=name,
                    sample_rate_hz=self.sample_rate_hz,
                    sample_count=self.num_samples,
                    unit=getattr(self.series, "unit", "V"),
                )
                for name in self.channel_names
            ],
            supports_windowed_access=True,
        )
        return self._metadata

    def load_waveform_window(
        self,
        start_time_seconds: float,
        duration_seconds: float,
        channel_names: Sequence[str],
    ) -> WaveformWindow:
        start_sample = max(int(start_time_seconds * self.sample_rate_hz), 0)
        stop_sample = min(
            max(
                start_sample + int(math.ceil(duration_seconds * self.sample_rate_hz)),
                start_sample + 1,
            ),
            self.num_samples,
        )
        indices = _resolve_channel_indices(self.channel_names, channel_names)
        data = np.asarray(
            self.series.data[start_sample:stop_sample, indices], dtype=np.float64
        )
        if data.ndim == 1:
            data = data[:, np.newaxis]
        channels = [
            _build_channel_waveform(
                self.channel_names[index],
                self.sample_rate_hz,
                data[:, position],
                getattr(self.series, "unit", "V"),
            )
            for position, index in enumerate(indices)
        ]
        return WaveformWindow(
            dataset_file_path=self.path,
            start_time_seconds=start_sample / self.sample_rate_hz
            if self.sample_rate_hz > 0
            else 0.0,
            duration_seconds=(stop_sample - start_sample) / self.sample_rate_hz
            if self.sample_rate_hz > 0
            else 0.0,
            channels=channels,
            from_cache=False,
        )

    def load_waveform_overview(
        self,
        channel_names: Sequence[str],
        max_buckets: int,
    ) -> WaveformOverview:
        metadata = self.load_metadata()
        
        def build() -> WaveformOverview:
            indices = _resolve_channel_indices(self.channel_names, channel_names)
            data = np.asarray(self.series.data[:, indices], dtype=np.float64)
            if data.ndim == 1:
                data = data[:, np.newaxis]
            channels = [
                _build_overview_channel(
                    self.channel_names[index],
                    metadata.duration_seconds,
                    data[:, position],
                    max_buckets,
                )
                for position, index in enumerate(indices)
            ]
            return WaveformOverview(
                dataset_file_path=self.path,
                duration_seconds=metadata.duration_seconds,
                channels=channels,
                from_cache=False,
            )
        return self._cached_overview(
            channel_names,
            max_buckets,
            extra_signature=f"{self.__class__.__name__}:{self.num_samples}",
            builder=build,
        )


def _mne_channel_unit(raw, channel_name: str) -> str:
    idx = raw.ch_names.index(channel_name)
    ch_info = raw.info["chs"][idx]
    unit_code = ch_info.get("unit", 0)
    unit_mul = ch_info.get("unit_mul", 0)
    unit_map = {
        107: "V",
        112: "T",
        201: "Am",
    }
    prefix_map = {
        0: "",
        -3: "m",
        -6: "u",
        -9: "n",
        -12: "p",
        -15: "f",
        3: "k",
        6: "M",
    }
    base = unit_map.get(unit_code, "")
    prefix = prefix_map.get(unit_mul, "")
    return f"{prefix}{base}" if base else "uV"


def _nifti_sample_rate(image) -> float:
    zooms = image.header.get_zooms()
    if len(zooms) > 3 and zooms[3] > 0:
        return 1.0 / float(zooms[3])
    return 1.0


def _voxel_name(index: int, spatial_shape: Sequence[int]) -> str:
    x, y, z = _voxel_coordinates(index, spatial_shape)
    return f"Voxel_{x}_{y}_{z}"


def _voxel_coordinates(
    index: int, spatial_shape: Sequence[int]
) -> tuple[int, int, int]:
    x = index % spatial_shape[0]
    y = (index // spatial_shape[0]) % spatial_shape[1]
    z = index // (spatial_shape[0] * spatial_shape[1])
    return x, y, z


@lru_cache(maxsize=8192)
def _voxel_coordinates_from_name(name: str) -> Optional[tuple[int, int, int]]:
    if not name.startswith("Voxel_"):
        return None
    try:
        _, x_value, y_value, z_value = name.split("_", 3)
        return int(x_value), int(y_value), int(z_value)
    except (TypeError, ValueError):
        return None


def _representative_nifti_indices(total_voxels: int, limit: int) -> list[int]:
    if total_voxels <= 0:
        return []
    if limit <= 0 or total_voxels <= limit:
        return list(range(total_voxels))
    if limit == 1:
        return [0]
    return [
        round(index * (total_voxels - 1) / (limit - 1))
        for index in range(limit)
    ]


def _select_xdf_stream(streams: Sequence[dict]) -> dict:
    def score(stream: dict) -> int:
        info = stream.get("info") or {}
        stream_type = "".join(info.get("type") or []).lower()
        if "eeg" in stream_type:
            return 2
        if "signal" in stream_type:
            return 1
        return 0

    return max(streams, key=score)


def _xdf_stream_name(stream: dict) -> str:
    info = stream.get("info") or {}
    names = info.get("name") or []
    return names[0] if names else "XDF Stream"


def _extract_xdf_channel_names(stream: dict, channel_count: int) -> List[str]:
    try:
        channels = (
            ((stream.get("info") or {}).get("desc") or [{}])[0].get("channels") or [{}]
        )[0].get("channel") or []
        names = []
        for index, channel in enumerate(channels):
            label = (
                (channel.get("label") or [None])[0]
                if isinstance(channel, dict)
                else None
            ) or f"Ch {index + 1}"
            names.append(str(label))
        if len(names) == channel_count:
            return names
    except Exception:
        pass
    return [f"Ch {index + 1}" for index in range(channel_count)]


def _xdf_sample_rate(stream: dict, timestamps: np.ndarray) -> float:
    info = stream.get("info") or {}
    nominal = info.get("nominal_srate") or []
    try:
        rate = float(nominal[0])
        if rate > 0:
            return rate
    except (TypeError, ValueError, IndexError):
        pass
    if timestamps.size > 1:
        diffs = np.diff(timestamps)
        median = float(np.median(diffs))
        if median > 0:
            return 1.0 / median
    return 1.0


def _xdf_window_indices(
    timestamps: np.ndarray,
    start_time_seconds: float,
    duration_seconds: float,
) -> tuple[int, int]:
    if timestamps.size == 0:
        return 0, 0
    base = timestamps[0]
    start_index = int(
        np.searchsorted(timestamps, base + start_time_seconds, side="left")
    )
    stop_index = int(
        np.searchsorted(
            timestamps, base + start_time_seconds + duration_seconds, side="right"
        )
    )
    stop_index = max(stop_index, min(start_index + 1, timestamps.size))
    return start_index, min(stop_index, timestamps.size)


def _select_nwb_series(nwbfile):
    for series in getattr(nwbfile, "acquisition", {}).values():
        if series.__class__.__name__.endswith("ElectricalSeries"):
            return series
    raise PythonDatasetReaderError("No ElectricalSeries found in the NWB dataset.")


def _nwb_sample_rate(series) -> float:
    rate = getattr(series, "rate", None)
    if rate:
        return float(rate)
    timestamps = getattr(series, "timestamps", None)
    if timestamps is not None and len(timestamps) > 1:
        diffs = np.diff(np.asarray(timestamps, dtype=np.float64))
        median = float(np.median(diffs))
        if median > 0:
            return 1.0 / median
    return 1.0


def _nwb_channel_names(series) -> List[str]:
    electrodes = getattr(series, "electrodes", None)
    if electrodes is not None:
        table = getattr(electrodes, "table", None)
        if table is not None and hasattr(table, "id"):
            try:
                ids = list(table.id[:])
                return [f"Electrode {int(value)}" for value in ids]
            except Exception:
                pass
    data = getattr(series, "data")
    return [f"Electrode {index + 1}" for index in range(int(data.shape[1]))]
