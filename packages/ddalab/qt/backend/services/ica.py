from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import List, Optional

from ...domain.models import IcaComponent, IcaResult, LoadedDataset


def _run_local_ica(
    client: object,
    *,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    start_time_seconds: Optional[float],
    end_time_seconds: Optional[float],
    n_components: Optional[int],
    max_iterations: int,
    tolerance: float,
    centering: bool,
    whitening: bool,
) -> IcaResult:
    if not _has_python_ica_support():
        raise RuntimeError(
            "ICA requires scikit-learn and scipy. Re-run ./start.sh so the local desktop environment installs them."
        )

    import numpy as np
    from scipy.signal import welch
    from scipy.stats import kurtosis as scipy_kurtosis
    from sklearn.decomposition import FastICA

    selected_channel_names = [
        dataset.channel_names[index]
        for index in selected_channel_indices
        if 0 <= index < len(dataset.channel_names)
    ]
    if len(selected_channel_names) < 2:
        raise RuntimeError("Select at least two channels before running ICA.")

    sample_rate = max(dataset.dominant_sample_rate_hz, 1.0)
    start_seconds = max(float(start_time_seconds or 0.0), 0.0)
    requested_end = float(
        end_time_seconds if end_time_seconds is not None else dataset.duration_seconds
    )
    duration_seconds = max(requested_end - start_seconds, 1.0 / sample_rate)
    window = client.load_waveform_window(
        dataset.file_path,
        start_seconds,
        duration_seconds + (1.0 / sample_rate),
        selected_channel_names,
    )
    if len(window.channels) < 2:
        raise RuntimeError(
            "ICA could not load enough channels from the selected dataset."
        )

    sample_count = min(len(channel.samples) for channel in window.channels)
    if sample_count < 4:
        raise RuntimeError("ICA requires at least four samples in the selected window.")

    matrix = np.vstack(
        [
            np.asarray(channel.samples[:sample_count], dtype=np.float64)
            for channel in window.channels
        ]
    )
    if centering:
        matrix = matrix - matrix.mean(axis=1, keepdims=True)

    component_count = min(
        int(n_components or len(window.channels)),
        len(window.channels),
        sample_count,
    )
    ica = FastICA(
        n_components=component_count,
        whiten="unit-variance" if whitening else False,
        max_iter=max_iterations,
        tol=tolerance,
        random_state=0,
    )
    transformed = np.asarray(ica.fit_transform(matrix.T), dtype=np.float64)
    mixing = getattr(ica, "mixing_", None)
    if mixing is None:
        components = getattr(ica, "components_", None)
        mixing = (
            np.linalg.pinv(np.asarray(components, dtype=np.float64))
            if components is not None
            else np.eye(matrix.shape[0], transformed.shape[1], dtype=np.float64)
        )
    mixing = np.asarray(mixing, dtype=np.float64)
    source_variances = np.var(transformed, axis=0)
    total_variance = float(np.sum(source_variances)) or 1.0

    components: List[IcaComponent] = []
    for component_index in range(transformed.shape[1]):
        source = np.asarray(transformed[:, component_index], dtype=np.float64)
        spatial_map = (
            mixing[:, component_index]
            if mixing.ndim == 2 and component_index < mixing.shape[1]
            else np.zeros(matrix.shape[0], dtype=np.float64)
        )
        frequencies, power_values = welch(
            source,
            fs=sample_rate,
            nperseg=min(256, source.size),
        )
        kurtosis_value = (
            float(scipy_kurtosis(source, fisher=False, bias=False))
            if source.size >= 4
            else 0.0
        )
        components.append(
            IcaComponent(
                component_id=component_index + 1,
                spatial_map=spatial_map.astype(np.float64).tolist(),
                time_series_preview=_downsample_list(
                    source.astype(np.float64).tolist(),
                    768,
                ),
                kurtosis=kurtosis_value,
                non_gaussianity=abs(kurtosis_value - 3.0),
                variance_explained=float(
                    source_variances[component_index] / total_variance
                ),
                power_frequencies=_downsample_list(
                    frequencies.astype(np.float64).tolist(),
                    256,
                ),
                power_values=_downsample_list(
                    power_values.astype(np.float64).tolist(),
                    256,
                ),
            )
        )

    return IcaResult(
        id=f"ica-{uuid.uuid4().hex[:12]}",
        file_path=dataset.file_path,
        file_name=dataset.file_name,
        created_at_iso=datetime.now(timezone.utc).isoformat(),
        channel_names=selected_channel_names,
        sample_rate_hz=sample_rate,
        sample_count=sample_count,
        components=components,
    )


def _has_python_ica_support() -> bool:
    try:
        from scipy.signal import welch  # noqa: F401
        from sklearn.decomposition import FastICA  # noqa: F401
    except ImportError:
        return False
    return True


def _downsample_list(values: List[float], max_points: int) -> List[float]:
    if max_points <= 0 or len(values) <= max_points:
        return list(values)
    step = len(values) / max_points
    return [
        float(values[min(int(index * step), len(values) - 1)])
        for index in range(max_points)
    ]
