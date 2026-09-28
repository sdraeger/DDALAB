from __future__ import annotations

import math

import numpy as np

HEATMAP_COLOR_SCHEME_OPTIONS: tuple[tuple[str, str], ...] = (
    ("auto", "Auto"),  # diverging for signed values, inferno otherwise
    ("viridis", "Viridis"),
    ("plasma", "Plasma"),
    ("inferno", "Inferno"),
    ("diverging", "Diverging"),
)

# Okabe-Ito: distinguishable with the common color-vision deficiencies
LINE_PLOT_COLORS: tuple[str, ...] = (
    "#0072b2",
    "#e69f00",
    "#56b4e9",
    "#d55e00",
    "#009e73",
    "#cc79a7",
    "#f0e442",
    "#999999",
)

WAVEFORM_LINE_COLOR = "#7dd3fc"

# ColorBrewer RdBu, reversed: blue below zero, white at zero, red above
_DIVERGING_STOPS = np.asarray(
    (
        (5, 48, 97),
        (33, 102, 172),
        (67, 147, 195),
        (146, 197, 222),
        (209, 229, 240),
        (247, 247, 247),
        (253, 219, 199),
        (244, 165, 130),
        (214, 96, 77),
        (178, 24, 43),
        (103, 0, 31),
    ),
    dtype=np.float32,
)

_VIRIDIS_STOPS = np.asarray(
    (
        (68, 1, 84),
        (72, 40, 120),
        (62, 73, 137),
        (49, 104, 142),
        (38, 130, 142),
        (31, 158, 137),
        (53, 183, 121),
        (109, 205, 89),
        (180, 222, 44),
        (253, 231, 37),
    ),
    dtype=np.float32,
)

_PLASMA_STOPS = np.asarray(
    (
        (13, 8, 135),
        (75, 3, 161),
        (125, 3, 168),
        (168, 34, 150),
        (203, 70, 121),
        (229, 107, 93),
        (248, 148, 65),
        (253, 195, 40),
        (239, 248, 33),
    ),
    dtype=np.float32,
)

_INFERNO_STOPS = np.asarray(
    (
        (0, 0, 4),
        (31, 12, 72),
        (85, 15, 109),
        (136, 34, 106),
        (186, 54, 85),
        (227, 89, 51),
        (249, 140, 10),
        (249, 201, 50),
        (252, 255, 164),
    ),
    dtype=np.float32,
)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _finite_or_zero(value: float) -> float:
    return value if math.isfinite(value) else 0.0


def _x_fraction(length: int) -> np.ndarray:
    if length <= 0:
        return np.zeros(0, dtype=np.float32)
    if length == 1:
        return np.zeros(1, dtype=np.float32)
    return np.linspace(0.0, 1.0, length, dtype=np.float32)


def _clamp_view_window(start: float, span: float) -> tuple[float, float]:
    clamped_span = max(0.0, min(1.0, float(span)))
    if clamped_span >= 1.0:
        return 0.0, 1.0
    clamped_start = max(0.0, min(1.0 - clamped_span, float(start)))
    return clamped_start, clamped_span


def _sample_window_bounds(
    sample_count: int,
    *,
    start_fraction: float,
    span_fraction: float,
) -> tuple[int, int]:
    if sample_count <= 0:
        return 0, 0
    if sample_count == 1:
        return 0, 1
    start_fraction, span_fraction = _clamp_view_window(start_fraction, span_fraction)
    if _is_full_view_window(start_fraction, span_fraction):
        return 0, sample_count
    last_index = sample_count - 1
    start_index = int(math.floor(start_fraction * last_index))
    end_index = int(math.ceil((start_fraction + span_fraction) * last_index))
    start_index = max(0, min(last_index, start_index))
    end_index = max(start_index, min(last_index, end_index))
    return start_index, end_index + 1


def _is_full_view_window(start_fraction: float, span_fraction: float) -> bool:
    return start_fraction <= 0.0 and span_fraction >= 1.0
