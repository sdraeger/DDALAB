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
    PythonDatasetReader,
    PythonDatasetReaderError,
    _build_channel_waveform,
    _build_overview_channel,
    _resolve_channel_indices,
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
