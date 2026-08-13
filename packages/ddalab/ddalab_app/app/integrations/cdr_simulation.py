from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

from .cdr import CDR_DELAYS, CDR_DERIVATIVE_POINTS, CDR_WINDOW_LENGTH, CDR_WINDOW_STEP

CDR_SAMPLE_COUNT = (
    CDR_WINDOW_STEP * 99
    + CDR_WINDOW_LENGTH
    + max(CDR_DELAYS)
    + 2 * CDR_DERIVATIVE_POINTS
    - 1
)
CDR_RANDOM_SEED = 250816733
CDR_INTEGRATION_STEP = 0.05
CDR_OUTPUT_DECIMATION = 2
CDR_TRANSIENT_STEPS = 20_000

_A = np.asarray([0.21, 0.21, 0.21, 0.20, 0.20, 0.20, 0.18])
_B = np.asarray([0.2150, 0.2020, 0.2041, 0.4050, 0.3991, 0.4100, 0.5000])
_C = np.asarray([5.7, 5.7, 5.7, 5.7, 5.7, 5.7, 6.8])
_COUPLINGS = ((0, 6), (3, 6), (4, 6), (6, 2))
_COUPLING_STRENGTH = 0.15
_MANIFEST_VERSION = 1

ProgressCallback = Callable[[dict[str, object]], None]


def generate_cdr_recordings(
    folder: str | Path,
    *,
    seed: int = CDR_RANDOM_SEED,
    sample_count: int = CDR_SAMPLE_COUNT,
    noise_levels: Iterable[int] = range(20, -1, -1),
    transient_steps: int = CDR_TRANSIENT_STEPS,
    progress: ProgressCallback | None = None,
) -> list[Path]:
    """Generate the seven-system CDR paper example and its noisy recordings."""
    root = Path(folder).expanduser()
    root.mkdir(parents=True, exist_ok=True)
    levels = tuple(int(level) for level in noise_levels)
    paths = [
        _recording_path(root, None),
        *(_recording_path(root, level) for level in levels),
    ]
    manifest_path = root / "generation.json"
    manifest = _generation_manifest(seed, sample_count, levels, transient_steps)
    if _manifest_matches(manifest_path, manifest) and all(
        path.is_file() for path in paths
    ):
        _emit(progress, "Generated data already available", len(paths), len(paths))
        return paths

    rng = np.random.default_rng(seed)
    _emit(progress, "Integrating seven coupled Rössler systems", 0, sample_count)
    clean = simulate_cdr_rossler(
        sample_count=sample_count,
        initial_state=rng.random(21),
        transient_steps=transient_steps,
        progress=progress,
    )
    _write_recording(paths[0], clean)

    signal_scale = np.std(clean, axis=0, ddof=1)
    for index, (snr, path) in enumerate(zip(levels, paths[1:]), start=1):
        noise = rng.standard_normal(clean.shape)
        noise -= np.mean(noise, axis=0)
        noise /= np.std(noise, axis=0, ddof=1)
        noisy = clean + noise * signal_scale * (10.0 ** (-snr / 20.0))
        _emit(progress, f"Writing {snr} dB recording", index, len(levels))
        _write_recording(path, noisy)

    _write_json_atomic(manifest_path, manifest)
    return paths


def simulate_cdr_rossler(
    *,
    sample_count: int,
    initial_state: np.ndarray,
    transient_steps: int = CDR_TRANSIENT_STEPS,
    dt: float = CDR_INTEGRATION_STEP,
    decimation: int = CDR_OUTPUT_DECIMATION,
    progress: ProgressCallback | None = None,
) -> np.ndarray:
    """Integrate the seven coupled Rössler equations with fixed-step RK4."""
    if sample_count < 2:
        raise ValueError("CDR generation requires at least two samples.")
    if transient_steps < 0 or dt <= 0 or decimation < 1:
        raise ValueError("Invalid CDR integration settings.")
    state = np.asarray(initial_state, dtype=np.float64).reshape(21).copy()
    for _ in range(transient_steps):
        state = _rk4_step(state, dt)

    samples = np.empty((sample_count, 7), dtype=np.float64)
    report_every = max(sample_count // 100, 1)
    for sample_index in range(sample_count):
        for _ in range(decimation):
            state = _rk4_step(state, dt)
        samples[sample_index] = state[0::3]
        if sample_index % report_every == 0:
            _emit(
                progress,
                "Integrating seven coupled Rössler systems",
                sample_index,
                sample_count,
            )
    _emit(
        progress,
        "Integrating seven coupled Rössler systems",
        sample_count,
        sample_count,
    )
    return samples


def _rossler_derivative(state: np.ndarray) -> np.ndarray:
    systems = state.reshape(7, 3)
    x = systems[:, 0]
    y = systems[:, 1]
    z = systems[:, 2]
    derivative = np.empty_like(systems)
    derivative[:, 0] = -y - z
    for target, source in _COUPLINGS:
        derivative[target, 0] += _COUPLING_STRENGTH * (x[target] - x[source])
    derivative[:, 1] = x + _A * y
    derivative[:, 2] = _B - _C * z + x * z
    return derivative.reshape(21)


def _rk4_step(state: np.ndarray, dt: float) -> np.ndarray:
    k1 = _rossler_derivative(state)
    k2 = _rossler_derivative(state + 0.5 * dt * k1)
    k3 = _rossler_derivative(state + 0.5 * dt * k2)
    k4 = _rossler_derivative(state + dt * k3)
    return state + (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)


def _recording_path(folder: Path, snr: int | None) -> Path:
    condition = "NoNoise" if snr is None else f"{snr:02d}dB"
    return folder / (
        f"CD_DDA_data_{condition}__WL4000_WS2000_WN100__FirstExample.ascii"
    )


def _generation_manifest(
    seed: int,
    sample_count: int,
    noise_levels: tuple[int, ...],
    transient_steps: int,
) -> dict[str, object]:
    return {
        "version": _MANIFEST_VERSION,
        "system": "seven coupled Rossler systems from CDR Figure 8",
        "seed": int(seed),
        "sample_count": int(sample_count),
        "integration_step": CDR_INTEGRATION_STEP,
        "output_decimation": CDR_OUTPUT_DECIMATION,
        "transient_steps": int(transient_steps),
        "noise_snr_db": list(noise_levels),
        "conditions": ["no noise", *(f"{snr} dB" for snr in noise_levels)],
    }


def _manifest_matches(path: Path, expected: dict[str, object]) -> bool:
    try:
        return json.loads(path.read_text(encoding="utf-8")) == expected
    except (OSError, ValueError, TypeError):
        return False


def _write_recording(path: Path, values: np.ndarray) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    np.savetxt(temporary, values, fmt="%.15f", delimiter=" ")
    os.replace(temporary, path)


def _write_json_atomic(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def _emit(
    callback: ProgressCallback | None,
    label: str,
    completed: int,
    total: int,
) -> None:
    if callback is not None:
        callback({"label": label, "completed": completed, "total": total})
