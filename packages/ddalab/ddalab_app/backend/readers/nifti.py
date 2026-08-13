from __future__ import annotations

import math
from functools import lru_cache
from typing import List, Optional, Sequence

import numpy as np

from ...domain.models import (
    ChannelDescriptor,
    ChannelWaveform,
    LoadedDataset,
    WaveformOverview,
    WaveformOverviewChannel,
    WaveformWindow,
)
from .common import (
    PythonDatasetReader,
    PythonDatasetReaderError,
    _build_channel_waveform,
    _build_overview_channel,
    _nifti_browser_channel_limit,
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
    return [round(index * (total_voxels - 1) / (limit - 1)) for index in range(limit)]
