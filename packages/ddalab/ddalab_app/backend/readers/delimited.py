from __future__ import annotations

import math
from typing import List, Optional, Sequence

import numpy as np

from ...domain.models import (
    ChannelDescriptor,
    LoadedDataset,
    WaveformOverview,
    WaveformWindow,
)
from .common import (
    _DELIMITED_TIME_HEADERS,
    PythonDatasetReader,
    PythonDatasetReaderError,
    _build_channel_waveform,
    _build_overview_channel,
    _estimate_sample_rate,
    _normalized_suffix,
    _resolve_channel_indices,
)


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
        safe_duration = max(
            float(duration_seconds), 1.0 / max(self._sample_rate_hz, 1.0)
        )
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
                    float(
                        self._timestamps[stop_index - 1] - self._timestamps[start_index]
                    ),
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
        actual_start = (
            start_index / self._sample_rate_hz if self._sample_rate_hz > 0 else 0.0
        )
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
