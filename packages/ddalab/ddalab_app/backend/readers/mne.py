from __future__ import annotations

import math
from typing import Optional, Sequence

import numpy as np

from ...domain.file_types import classify_path
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
