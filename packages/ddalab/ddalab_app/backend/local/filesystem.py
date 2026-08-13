from __future__ import annotations

import os
from pathlib import Path
from typing import List, Tuple

from ...domain.file_types import classify_path
from ...domain.models import BrowserEntry
from ...runtime_paths import RuntimePaths
from ..contracts import BackendHealth
from ..readers.local import close_python_dataset_readers, get_python_dataset_reader
from ..services.ica import _has_python_ica_support
from .runtime import _resolve_rust_dda_support


def _python_dataset_reader(path: str):
    return get_python_dataset_reader(path)


def _close_python_dataset_readers() -> None:
    close_python_dataset_readers()


def _annotate_entries(entries: List[BrowserEntry]) -> List[BrowserEntry]:
    enriched: List[BrowserEntry] = []
    for entry in entries:
        info = classify_path(entry.path, entry.is_directory)
        enriched.append(
            BrowserEntry(
                name=entry.name,
                path=entry.path,
                is_directory=entry.is_directory,
                size_bytes=entry.size_bytes,
                modified_at_epoch_ms=entry.modified_at_epoch_ms,
                supported=info.openable,
                type_label=info.label,
                open_as_dataset=info.open_as_dataset,
            )
        )
    return enriched


def _unsupported_local_feature(feature: str) -> str:
    return f"{feature} is not yet available in the Python-only desktop build."


def _local_default_root(repo_root: Path) -> Path:
    data_root = repo_root / "data"
    if data_root.exists():
        return data_root
    return repo_root


def _local_backend_health(
    runtime_paths: RuntimePaths, repo_root: Path
) -> BackendHealth:
    diagnostics = [
        "Python-native desktop backend active.",
        "Filesystem browsing, dataset loading, waveform windows, and overview rendering run locally.",
    ]
    rust_support = _resolve_rust_dda_support(runtime_paths, repo_root)
    if rust_support is None:
        if runtime_paths.is_source_checkout():
            diagnostics.append(
                "DDALAB CLI was not found; DDA is unavailable until the local Rust backend is built or bundled."
            )
        else:
            diagnostics.append(
                "Bundled DDALAB Rust backend was not found in this install; DDA is unavailable."
            )
    else:
        diagnostics.append(f"Rust DDA available via {Path(rust_support[0]).name}.")
        diagnostics.append("All DDA requests run through the bundled dda-rs backend.")
    ica_available = _has_python_ica_support()
    diagnostics.append(
        "ICA available via scikit-learn FastICA."
        if ica_available
        else "ICA requires scikit-learn and scipy in the local desktop environment."
    )
    diagnostics.append(
        "NSG job browsing is available in Settings after you save your NSG credentials."
    )
    return BackendHealth(
        service="ddalab-python",
        status="ready",
        dda_available=rust_support is not None,
        ica_available=ica_available,
        diagnostics=diagnostics,
        nsg_available=True,
    )


def _list_local_directory(path: str) -> Tuple[str, List[BrowserEntry]]:
    target = Path(path).expanduser()
    if target.is_file():
        target = target.parent
    if not target.exists():
        raise RuntimeError(f"Directory does not exist: {path}")
    if not target.is_dir():
        raise RuntimeError(f"Path is not a directory: {path}")

    entries: List[BrowserEntry] = []
    with os.scandir(target) as iterator:
        children = sorted(
            list(iterator),
            key=lambda item: (
                not item.is_dir(follow_symlinks=False),
                item.name.lower(),
            ),
        )
    for child in children:
        try:
            is_directory = child.is_dir(follow_symlinks=False)
            stat = child.stat(follow_symlinks=False)
            size_bytes = 0 if is_directory else int(stat.st_size)
            modified_at_epoch_ms = int(stat.st_mtime * 1000)
        except OSError:
            is_directory = False
            size_bytes = 0
            modified_at_epoch_ms = 0
        entries.append(
            BrowserEntry(
                name=child.name,
                path=str(Path(child.path).resolve()),
                is_directory=is_directory,
                size_bytes=size_bytes,
                modified_at_epoch_ms=modified_at_epoch_ms,
                supported=False,
            )
        )
    return str(target.resolve()), _annotate_entries(entries)
