from __future__ import annotations

import math
from pathlib import Path
from typing import Optional, Sequence

import numpy as np

from ...domain import bids
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
    _start_sample,
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
            # read_raw dispatches on the extension and knows only ".fif"
            read = mne.io.read_raw_fif if self.path.lower().endswith(".fiff") else mne.io.read_raw
            self.raw = read(self.path, preload=False, verbose="ERROR")
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
            warnings=_data_file_warnings(self.path, int(self.raw.n_times), sample_rate),
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
        start_sample = _start_sample(start_time_seconds, sample_rate)
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


_BRAINVISION_SAMPLE_BYTES = {"INT_16": 2, "UINT_16": 2, "INT_32": 4, "IEEE_FLOAT_32": 4}
# BIDS durations are rounded; only a shortfall above this fraction is reported
_BIDS_DURATION_TOLERANCE = 0.01


def _data_file_warnings(path: str, sample_count: int, header_rate: float) -> list[str]:
    """Report a data file shorter than its header or BIDS sidecar, or a mismatched BIDS rate."""
    header = Path(path)
    warnings = (
        _brainvision_warnings(header, sample_count)
        if header.suffix.lower() == ".vhdr"
        else []
    )
    return warnings + _bids_warnings(header, sample_count, header_rate)


def _brainvision_warnings(header: Path, sample_count: int) -> list[str]:
    try:
        fields = dict(
            line.split("=", 1)
            for line in header.read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()
            if "=" in line and not line.lstrip().startswith(";")
        )
        data_file = header.with_name(fields["DataFile"].strip())
        frame = _BRAINVISION_SAMPLE_BYTES[
            fields.get("BinaryFormat", "INT_16").strip()
        ] * int(fields["NumberOfChannels"])
        size = data_file.stat().st_size
    except (KeyError, ValueError, OSError):
        return []
    warnings = []
    binary = fields.get("DataFormat", "BINARY").strip().upper() == "BINARY"
    if binary and size % frame:
        warnings.append(
            f"The data file {data_file.name} ends with {size % frame} bytes of an "
            f"incomplete sample frame of {frame} bytes."
        )
    declared = fields.get("DataPoints", "").strip()
    if declared.isdigit() and int(declared) > sample_count:
        warnings.append(
            f"The header declares {int(declared)} samples, but the data file "
            f"{data_file.name} holds {sample_count}."
        )
    return warnings


def _bids_warnings(header: Path, sample_count: int, header_rate: float) -> list[str]:
    meta = bids.recording_json(str(header))
    try:
        duration = float(meta["RecordingDuration"])
        sample_rate = float(meta["SamplingFrequency"])
    except (KeyError, TypeError, ValueError):
        return []
    if sample_rate <= 0:
        return []
    warnings = []
    if sample_count < duration * sample_rate * (1 - _BIDS_DURATION_TOLERANCE):
        warnings.append(
            f"The data file holds {sample_count} samples "
            f"({sample_count / sample_rate:.2f} s), but the BIDS sidecar describes "
            f"{duration:.2f} s; the file appears truncated."
        )
    drift = abs(sample_count / header_rate - sample_count / sample_rate)
    if drift > 0.01:
        warnings.append(
            f"The file header gives {header_rate:.3f} Hz and the BIDS sidecar "
            f"{sample_rate:.3f} Hz. DDALAB uses the header rate, so BIDS event times "
            f"drift by up to {drift:.2f} s over the recording."
        )
    return warnings


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
