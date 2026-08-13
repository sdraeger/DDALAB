from __future__ import annotations

import numpy as np

from .plot_data_common import _INFERNO_STOPS, _PLASMA_STOPS, _VIRIDIS_STOPS
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
    rgb = _heatmap_rgb(normalized, color_scheme)
    alpha = np.full((*normalized.shape, 1), 255, dtype=np.uint8)
    return np.ascontiguousarray(np.concatenate((rgb, alpha), axis=2))


def _heatmap_rgb(normalized: np.ndarray, color_scheme: str) -> np.ndarray:
    if color_scheme == "plasma":
        return _interpolate_stops(normalized, _PLASMA_STOPS)
    if color_scheme == "inferno":
        return _interpolate_stops(normalized, _INFERNO_STOPS)
    if color_scheme == "jet":
        red = np.clip(1.5 - 4.0 * np.abs(normalized - 0.75), 0.0, 1.0)
        green = np.clip(1.5 - 4.0 * np.abs(normalized - 0.5), 0.0, 1.0)
        blue = np.clip(1.5 - 4.0 * np.abs(normalized - 0.25), 0.0, 1.0)
        return _stack_rgb(red, green, blue)
    if color_scheme == "cool":
        return _stack_rgb(normalized, 1.0 - normalized, np.ones_like(normalized))
    if color_scheme == "hot":
        red = np.where(normalized < 0.4, normalized / 0.4, 1.0)
        green = np.where(
            normalized < 0.4,
            0.0,
            np.where(normalized < 0.8, (normalized - 0.4) / 0.4, 1.0),
        )
        blue = np.where(normalized < 0.8, 0.0, (normalized - 0.8) / 0.2)
        return _stack_rgb(
            np.clip(red, 0.0, 1.0),
            np.clip(green, 0.0, 1.0),
            np.clip(blue, 0.0, 1.0),
        )
    return _interpolate_stops(normalized, _VIRIDIS_STOPS)


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


def _stack_rgb(
    red: np.ndarray | float,
    green: np.ndarray | float,
    blue: np.ndarray | float,
) -> np.ndarray:
    channels = np.stack(np.broadcast_arrays(red, green, blue), axis=2)
    return np.rint(channels * 255.0).astype(np.uint8)
