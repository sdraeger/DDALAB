from __future__ import annotations

import numpy as np

from .plot_data_common import (
    _DIVERGING_STOPS,
    _INFERNO_STOPS,
    _PLASMA_STOPS,
    _VIRIDIS_STOPS,
)
from .plot_matrix_data import MatrixView


def heatmap_rgba(view: MatrixView, color_scheme: str) -> np.ndarray:
    if view.values.size == 0:
        return np.zeros((0, 0, 4), dtype=np.uint8)
    values = np.where(np.isfinite(view.values), view.values, 0.0)
    normalized = np.clip(
        (values - view.display_min_value) / view.value_range,
        0.0,
        1.0,
    )
    rgb = _interpolate_stops(normalized, color_stops(color_scheme, view.diverging))
    # Failed (non-finite) cells stay transparent so they can't pass for real values.
    alpha = np.where(np.isfinite(view.values), 255, 0).astype(np.uint8)[..., None]
    return np.ascontiguousarray(np.concatenate((rgb, alpha), axis=2))


def color_stops(color_scheme: str, diverging: bool) -> np.ndarray:
    """RGB stops of a scheme; "auto" picks the diverging map for signed values."""
    if color_scheme == "auto":
        color_scheme = "diverging" if diverging else "inferno"
    return {
        "plasma": _PLASMA_STOPS,
        "inferno": _INFERNO_STOPS,
        "diverging": _DIVERGING_STOPS,
    }.get(color_scheme, _VIRIDIS_STOPS)


def _interpolate_stops(normalized: np.ndarray, stops: np.ndarray) -> np.ndarray:
    if len(stops) == 1:
        return np.broadcast_to(
            stops[0].round().astype(np.uint8),
            (*normalized.shape, 3),
        ).copy()
    position = normalized * float(len(stops) - 1)
    lower = np.minimum(position.astype(np.int64), len(stops) - 1)
    upper = np.minimum(lower + 1, len(stops) - 1)
    fraction = (position - lower)[..., np.newaxis]
    rgb = stops[lower] + fraction * (stops[upper] - stops[lower])
    return np.rint(rgb).astype(np.uint8)
