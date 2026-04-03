from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional


BRIDGE_NATIVE_EXTENSIONS = {".edf", ".csv", ".ascii", ".txt"}
MNE_FILE_EXTENSIONS = {
    ".edf",
    ".bdf",
    ".fif",
    ".fiff",
    ".vhdr",
    ".set",
    ".cnt",
    ".egi",
    ".gdf",
    ".con",
    ".sqd",
    ".meg4",
    ".kit",
}
DIRECTORY_DATASET_SUFFIXES = {".ds", ".mff"}
OTHER_DIRECT_EXTENSIONS = {".xdf", ".nwb", ".nii", ".nii.gz"}
ALL_OPENABLE_SUFFIXES = (
    BRIDGE_NATIVE_EXTENSIONS
    | MNE_FILE_EXTENSIONS
    | DIRECTORY_DATASET_SUFFIXES
    | OTHER_DIRECT_EXTENSIONS
)
PRIMARY_OPEN_DIALOG_PATTERNS = [
    "*.edf",
    "*.bdf",
    "*.csv",
    "*.ascii",
    "*.txt",
    "*.vhdr",
    "*.set",
    "*.fif",
    "*.fiff",
    "*.cnt",
    "*.egi",
    "*.gdf",
    "*.con",
    "*.sqd",
    "*.meg4",
    "*.kit",
    "*.xdf",
    "*.nwb",
    "*.nii",
    "*.nii.gz",
]
BIDS_MODALITY_DIRECTORIES = {
    "eeg": "BIDS EEG",
    "ieeg": "BIDS iEEG",
    "meg": "BIDS MEG",
    "anat": "BIDS Anat",
    "func": "BIDS Func",
    "dwi": "BIDS DWI",
    "pet": "BIDS PET",
}
_SUBJECT_PATTERN = re.compile(r"^sub-[a-zA-Z0-9]+$")
_SESSION_PATTERN = re.compile(r"^ses-[a-zA-Z0-9]+$")


@dataclass(frozen=True)
class PathTypeInfo:
    label: str
    openable: bool
    open_as_dataset: bool = False
    is_bids_root: bool = False


def open_file_dialog_filter() -> str:
    patterns = " ".join(PRIMARY_OPEN_DIALOG_PATTERNS)
    return (
        f"DDALAB Datasets ({patterns});;"
        "Delimited Data (*.csv *.ascii *.txt);;"
        "All Files (*)"
    )


def is_bridge_native_path(path: str, is_directory: bool = False) -> bool:
    if is_directory:
        return False
    return _path_suffix(Path(path)) in BRIDGE_NATIVE_EXTENSIONS


def supports_qt_dataset_path(path: str, is_directory: bool = False) -> bool:
    return classify_path(path, is_directory).openable


def classify_path(path: str, is_directory: bool) -> PathTypeInfo:
    target = Path(path)
    suffix = _path_suffix(target)
    lower_name = target.name.lower()

    if is_directory:
        if suffix == ".ds":
            return PathTypeInfo("CTF MEG", True, open_as_dataset=True)
        if suffix == ".mff":
            return PathTypeInfo("EGI MFF", True, open_as_dataset=True)
        if _is_bids_root(path):
            return PathTypeInfo("BIDS Dataset", False, is_bids_root=True)
        if _SUBJECT_PATTERN.match(target.name):
            return PathTypeInfo("BIDS Subject", False)
        if _SESSION_PATTERN.match(target.name):
            return PathTypeInfo("BIDS Session", False)
        modality_label = BIDS_MODALITY_DIRECTORIES.get(lower_name)
        if modality_label:
            return PathTypeInfo(f"{modality_label} Folder", False)
        return PathTypeInfo("Folder", False)

    if lower_name.endswith(".nii.gz"):
        return _with_bids_context(target, "NIfTI", True)
    if suffix == ".edf":
        return _with_bids_context(target, "EDF", True)
    if suffix == ".bdf":
        return _with_bids_context(target, "BDF", True)
    if suffix == ".csv":
        return _with_bids_context(target, "CSV", True)
    if suffix == ".ascii":
        return _with_bids_context(target, "ASCII", True)
    if suffix == ".txt":
        return _with_bids_context(target, "Text", True)
    if suffix == ".vhdr":
        return _with_bids_context(target, "BrainVision", True)
    if suffix == ".set":
        return _with_bids_context(target, "EEGLAB", True)
    if suffix in {".fif", ".fiff"}:
        return _with_bids_context(target, "FIF", True)
    if suffix == ".cnt":
        return _with_bids_context(target, "CNT", True)
    if suffix == ".egi":
        return _with_bids_context(target, "EGI", True)
    if suffix == ".gdf":
        return _with_bids_context(target, "GDF", True)
    if suffix == ".con":
        return _with_bids_context(target, "KIT CON", True)
    if suffix == ".sqd":
        return _with_bids_context(target, "SQD", True)
    if suffix == ".meg4":
        return _with_bids_context(target, "MEG4", True)
    if suffix == ".kit":
        return _with_bids_context(target, "KIT", True)
    if suffix == ".xdf":
        return _with_bids_context(target, "XDF", True)
    if suffix == ".nwb":
        return _with_bids_context(target, "NWB", True)
    if suffix == ".nii":
        return _with_bids_context(target, "NIfTI", True)
    return _with_bids_context(target, "File", False)


def _with_bids_context(target: Path, base_label: str, openable: bool) -> PathTypeInfo:
    bids_modality = _bids_modality_from_path(target)
    if bids_modality:
        return PathTypeInfo(f"{bids_modality} · {base_label}", openable)
    return PathTypeInfo(base_label, openable)


def _path_suffix(path: Path) -> str:
    lower_name = path.name.lower()
    if lower_name.endswith(".nii.gz"):
        return ".nii.gz"
    return path.suffix.lower()


def _bids_modality_from_path(path: Path) -> Optional[str]:
    for part in path.parts:
        label = BIDS_MODALITY_DIRECTORIES.get(part.lower())
        if label:
            return label

    lower_name = path.name.lower()
    if "_eeg." in lower_name:
        return "BIDS EEG"
    if "_ieeg." in lower_name:
        return "BIDS iEEG"
    if "_meg." in lower_name:
        return "BIDS MEG"
    if "_anat." in lower_name:
        return "BIDS Anat"
    if "_func." in lower_name:
        return "BIDS Func"
    if "_dwi." in lower_name:
        return "BIDS DWI"
    if "_pet." in lower_name:
        return "BIDS PET"
    return None


@lru_cache(maxsize=2048)
def _is_bids_root(path: str) -> bool:
    try:
        target = Path(path)
        if not target.is_dir():
            return False
        description = target / "dataset_description.json"
        if not description.is_file():
            return False
        payload = json.loads(description.read_text(encoding="utf-8"))
        return isinstance(payload, dict)
    except Exception:
        return False
