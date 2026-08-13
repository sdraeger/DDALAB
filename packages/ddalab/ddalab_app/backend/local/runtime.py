from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from time import perf_counter_ns
from typing import TYPE_CHECKING, List, Optional

from ...app.runtime.perf_logging import perf_logger
from ...domain.models import WaveformWindow
from ...runtime_binary_names import (
    DEV_CLI_BINARY_STEM,
    PACKAGED_CLI_BINARY_STEM,
    platform_binary_name,
)
from ...runtime_paths import RuntimePaths
from ..dda.sidecar import DdaSidecarClient

if TYPE_CHECKING:
    from .client import LocalBackendClient


def _resolve_rust_dda_support(
    runtime_paths: RuntimePaths,
    repo_root: Path,
) -> Optional[List[str]]:
    return _find_cli_command(runtime_paths, repo_root)


def _get_dda_sidecar(
    *,
    client: LocalBackendClient,
    cli_command: List[str],
    repo_root: Path,
) -> DdaSidecarClient:
    sidecar_key = tuple(str(part) for part in cli_command)
    if client._dda_sidecar is None or client._dda_sidecar_key != sidecar_key:
        sidecar_start_ns = perf_counter_ns()
        if client._dda_sidecar is not None:
            client._dda_sidecar.close()
        client._dda_sidecar = DdaSidecarClient(
            cli_command=cli_command,
            cwd=str(repo_root),
        )
        client._dda_sidecar_key = sidecar_key
        perf_logger().log_duration(
            "dda.sidecar.client.start",
            sidecar_start_ns,
            command=" ".join(str(part) for part in cli_command),
        )
    return client._dda_sidecar


def _find_cli_command(
    runtime_paths: RuntimePaths, repo_root: Path
) -> Optional[List[str]]:
    env_path = os.environ.get("DDALAB_CLI_PATH")
    if env_path:
        candidate = Path(env_path).expanduser()
        if _is_executable_binary(candidate):
            return [str(candidate)]

    if runtime_paths.is_source_checkout():
        dev_cli_name = platform_binary_name(DEV_CLI_BINARY_STEM)
        for candidate in (
            repo_root / "packages" / "dda-rs" / "target" / "release" / dev_cli_name,
            repo_root / "packages" / "dda-rs" / "target" / "debug" / dev_cli_name,
        ):
            if _is_executable_binary(candidate):
                return [str(candidate)]

        manifest = repo_root / "packages" / "dda-rs" / "Cargo.toml"
        if manifest.exists() and shutil.which("cargo"):
            return [
                "cargo",
                "run",
                "--features",
                "cuda",
                "--manifest-path",
                str(manifest),
                "--",
            ]

        system_binary = shutil.which(dev_cli_name)
        if system_binary:
            return [system_binary]

    packaged_cli_name = platform_binary_name(PACKAGED_CLI_BINARY_STEM)
    for candidate in _runtime_binary_candidates(runtime_paths, packaged_cli_name):
        if _is_executable_binary(candidate):
            return [str(candidate)]
    return None


def _is_executable_binary(path: Path) -> bool:
    if not path.is_file():
        return False
    if os.name == "nt":
        executable_suffixes = os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(
            ";"
        )
        return path.suffix.casefold() in {
            suffix.casefold() for suffix in executable_suffixes
        }
    return os.access(path, os.X_OK)


def _runtime_binary_candidates(
    runtime_paths: RuntimePaths,
    binary_name: str,
) -> List[Path]:
    roots = [
        runtime_paths.package_runtime_bin_dir(),
        runtime_paths.package_root / "bin",
        runtime_paths.executable_dir / "bin",
        runtime_paths.executable_dir / "runtime" / "bin",
        runtime_paths.executable_dir.parent / "Resources" / "bin",
        runtime_paths.executable_dir.parent / "Resources" / "runtime" / "bin",
    ]
    candidates: List[Path] = []
    seen: set[Path] = set()
    for root in roots:
        try:
            resolved = root.resolve()
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        candidates.append(resolved / binary_name)
    return candidates


def _write_waveform_window_matrix_file(
    window: WaveformWindow,
) -> tuple[Path, List[str], float, int, int]:
    if not window.channels:
        raise RuntimeError("Could not extract any channels for DDA input.")
    import numpy as np

    sample_rate = max(
        min(channel.sample_rate_hz for channel in window.channels),
        1.0,
    )
    sample_count = min(len(channel.samples) for channel in window.channels)
    channel_labels = [channel.name for channel in window.channels]
    if sample_count <= 0:
        raise RuntimeError("Analysis slice contains no samples.")

    matrix = np.column_stack(
        [
            np.asarray(channel.samples[:sample_count], dtype=np.float64)
            for channel in window.channels
        ]
    )
    if matrix.ndim != 2 or matrix.shape[0] != sample_count:
        raise RuntimeError("Could not build a valid in-memory DDA matrix.")
    matrix = np.nan_to_num(matrix, nan=0.0, posinf=0.0, neginf=0.0).astype(
        "<f8",
        copy=False,
    )
    matrix = np.ascontiguousarray(matrix)

    handle = tempfile.NamedTemporaryFile(
        prefix="ddalab-matrix-",
        suffix=".f64",
        delete=False,
    )
    try:
        matrix.tofile(handle)
        path = Path(handle.name)
    finally:
        handle.close()
    return path, channel_labels, sample_rate, sample_count, int(matrix.shape[1])
