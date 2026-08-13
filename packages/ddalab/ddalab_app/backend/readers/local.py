from __future__ import annotations

from pathlib import Path

from ...domain.file_types import classify_path, resolve_dataset_path
from .common import (
    PythonDatasetReader,
    PythonDatasetReaderError,
    _nifti_browser_channel_limit,
    _normalized_suffix,
    _reader_cache,
    _reader_lock,
)
from .delimited import DelimitedDatasetReader
from .mne import MneDatasetReader
from .nifti import NiftiDatasetReader, _representative_nifti_indices
from .nwb import NwbDatasetReader
from .xdf import XdfDatasetReader

__all__ = [
    "PythonDatasetReader",
    "PythonDatasetReaderError",
    "close_python_dataset_readers",
    "get_python_dataset_reader",
    "_nifti_browser_channel_limit",
    "_representative_nifti_indices",
]


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
