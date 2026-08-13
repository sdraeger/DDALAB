from __future__ import annotations

from typing import List, Optional, Sequence

import numpy as np

from ...domain.models import (
    ChannelDescriptor,
    LoadedDataset,
    WaveformOverview,
    WaveformWindow,
)
from .common import (
    PythonDatasetReader,
    PythonDatasetReaderError,
    _build_channel_waveform,
    _build_overview_channel,
    _resolve_channel_indices,
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
