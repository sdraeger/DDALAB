from __future__ import annotations

import math
import re
import uuid
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Iterable

from ...domain.models import DdaResult, DdaVariantResult

_SNR_PATTERN = re.compile(r"_(\d{2})dB__")
_CD_PAIR_PATTERN = re.compile(r"(?:Channel|Ch)\s*(\d+)\s*<-\s*(?:Channel|Ch)\s*(\d+)")
_DE_PAIR_PATTERN = re.compile(r"(?:Channel|Ch)\s*(\d+)\s*&\s*(?:Channel|Ch)\s*(\d+)")
_RECORDING_PATTERN = "CD_DDA_data_*__WL4000_WS2000_WN100__FirstExample.ascii"

CDR_FLAVORS = ("CD", "DE")
CDR_WINDOW_LENGTH = 4000
CDR_WINDOW_STEP = 2000
CDR_DELAYS = (32, 9)
CDR_MODEL_TERMS = (1, 2, 6)
CDR_DERIVATIVE_POINTS = 4
CDR_POLYNOMIAL_ORDER = 3
CDR_NR_TAU = 2
CDR_CONDITIONS = ("no noise", *(f"{snr} dB" for snr in range(20, -1, -1)))
CDR_TRUE_EDGES = ((2, 6), (6, 0), (6, 3), (6, 4))
CDR_FALSE_REFERENCE_EDGE = (2, 1)


def find_cdr_recordings(folder: str | Path) -> list[Path]:
    root = Path(folder).expanduser()
    if not root.is_dir():
        raise ValueError(f"CDR data folder does not exist: {root}")

    recordings = list(root.glob(_RECORDING_PATTERN))
    if not recordings and (root / "data").is_dir():
        root = root / "data"
        recordings = list(root.glob(_RECORDING_PATTERN))

    by_condition: dict[str, Path] = {}
    duplicates: set[str] = set()
    for recording in recordings:
        condition = _condition_label(recording.name)
        if condition in by_condition:
            duplicates.add(condition)
        by_condition[condition] = recording

    expected = set(CDR_CONDITIONS)
    missing = [
        condition for condition in CDR_CONDITIONS if condition not in by_condition
    ]
    unexpected = sorted(set(by_condition) - expected)
    if len(recordings) != len(CDR_CONDITIONS) or missing or unexpected or duplicates:
        details = []
        if missing:
            details.append("missing " + ", ".join(missing))
        if unexpected:
            details.append("unexpected " + ", ".join(unexpected))
        if duplicates:
            details.append("duplicate " + ", ".join(sorted(duplicates)))
        suffix = "; ".join(details) or f"found {len(recordings)} files"
        raise ValueError(
            "CDR reproduction requires 22 recordings: one clean recording and "
            f"one for every SNR from 20 dB through 0 dB ({suffix})."
        )

    return [by_condition[condition] for condition in CDR_CONDITIONS]


def all_pair_indices(
    channel_indices: Iterable[int], flavors: Iterable[str]
) -> dict[str, list[tuple[int, int]]]:
    channels = [int(index) for index in channel_indices]
    undirected = list(combinations(channels, 2))
    selected = {str(flavor).upper() for flavor in flavors}
    pairs: dict[str, list[tuple[int, int]]] = {}
    for flavor in ("CT", "DE"):
        if flavor in selected:
            pairs[flavor] = undirected
    if "CD" in selected:
        pairs["CD"] = [
            directed
            for left, right in undirected
            for directed in ((left, right), (right, left))
        ]
    return pairs


def aggregate_cdr_results(results: Iterable[DdaResult]) -> DdaResult | None:
    ordered = sorted(list(results), key=_condition_sort_key)
    if not ordered:
        return None
    variants = [
        summary
        for variant_id, label in (
            ("CD", "Causal dependence"),
            ("DE", "Dynamical ergodicity"),
        )
        if (summary := _aggregate_variant(ordered, variant_id, label)) is not None
    ]
    if len(variants) != 2:
        return None
    conditions = [_condition_label(result.file_name) for result in ordered]
    return DdaResult(
        id=uuid.uuid4().hex,
        file_path=str(Path(ordered[0].file_path).parent),
        file_name="CDR batch summary",
        created_at_iso=datetime.now(timezone.utc).isoformat(),
        engine_label="CDR batch aggregate",
        diagnostics=["Conditions: " + ", ".join(conditions)],
        window_centers_seconds=[float(index) for index in range(len(ordered))],
        variants=variants,
        is_fallback=False,
    )


def build_cdr_paper_view(result: DdaResult | None) -> dict[str, object]:
    if result is None or result.file_name != "CDR batch summary":
        return {}
    cd = next((item for item in result.variants if item.id == "CD"), None)
    de = next((item for item in result.variants if item.id == "DE"), None)
    if cd is None or de is None:
        return {}

    condition_count = min(cd.effective_column_count, len(CDR_CONDITIONS))
    if condition_count < 1:
        return {}
    conditions = list(CDR_CONDITIONS[:condition_count])
    cd_rows = _indexed_rows(cd, _CD_PAIR_PATTERN, condition_count)
    de_rows = {
        tuple(sorted(pair)): values
        for pair, values in _indexed_rows(de, _DE_PAIR_PATTERN, condition_count)
    }
    if len(cd_rows) != 42 or len(de_rows) != 21:
        return {}

    matrices = _causality_matrices(cd_rows, condition_count)
    clean_scale = max(
        max(
            (value for row in matrices[0] for value in row if math.isfinite(value)),
            default=1.0,
        ),
        1e-15,
    )
    heatmap_conditions = {"no noise", "20 dB", "15 dB", "10 dB", "5 dB", "0 dB"}
    heatmaps = [
        {
            "label": condition,
            "matrix": [
                [
                    None
                    if target == source
                    else max(0.0, min(1.0, value / clean_scale))
                    for source, value in enumerate(row)
                ]
                for target, row in enumerate(matrices[index])
            ],
        }
        for index, condition in enumerate(conditions)
        if condition in heatmap_conditions
    ]

    ranked_rows = sorted(cd_rows, key=lambda item: item[1][0], reverse=True)
    causality_curves = []
    phase_curves = []
    for rank, ((target, source), values) in enumerate(ranked_rows):
        edge = (source, target)
        label = f"{source + 1} → {target + 1}"
        color = _curve_color(rank, len(ranked_rows))
        causality_curves.append(
            {
                "label": label,
                "values": values,
                "color": color,
                "highlight": edge in CDR_TRUE_EDGES,
            }
        )
        ergodicity = de_rows[tuple(sorted((target, source)))]
        phase_curves.append(
            {
                "label": label,
                "x": values,
                "y": ergodicity,
                "color": color,
                "highlight": edge in (CDR_TRUE_EDGES[0], CDR_FALSE_REFERENCE_EDGE),
            }
        )

    return {
        "conditions": conditions,
        "heatmaps": heatmaps,
        "causalityCurves": causality_curves,
        "phaseCurves": phase_curves,
    }


def _curve_color(rank: int, count: int) -> str:
    fraction = rank / max(count - 1, 1)
    strong = (239, 45, 225)
    weak = (21, 219, 226)
    rgb = tuple(
        round(start + fraction * (end - start)) for start, end in zip(strong, weak)
    )
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def _aggregate_variant(
    results: list[DdaResult], variant_id: str, label: str
) -> DdaVariantResult | None:
    selected: list[DdaVariantResult] = []
    for result in results:
        variant = next(
            (item for item in result.variants if item.id == variant_id), None
        )
        if variant is None:
            return None
        selected.append(variant)
    row_labels = selected[0].row_labels
    if any(variant.row_labels != row_labels for variant in selected[1:]):
        return None
    matrix = [
        [_finite_mean(variant.matrix[row]) for variant in selected]
        for row in range(len(row_labels))
    ]
    finite = [value for row in matrix for value in row if math.isfinite(value)]
    return DdaVariantResult(
        id=variant_id,
        label=label,
        row_labels=list(row_labels),
        matrix=matrix,
        summary=f"{len(results)} recording conditions",
        min_value=min(finite, default=0.0),
        max_value=max(finite, default=0.0),
        column_count=len(results),
        row_mean_absolute=[
            _finite_mean([abs(value) for value in row]) for row in matrix
        ],
        row_peak_absolute=[
            max((abs(value) for value in row if math.isfinite(value)), default=0.0)
            for row in matrix
        ],
    )


def _finite_mean(values: Iterable[float]) -> float:
    finite = [float(value) for value in values if math.isfinite(float(value))]
    return sum(finite) / len(finite) if finite else float("nan")


def _indexed_rows(
    variant: DdaVariantResult,
    pattern: re.Pattern[str],
    column_count: int,
) -> list[tuple[tuple[int, int], list[float]]]:
    rows: list[tuple[tuple[int, int], list[float]]] = []
    for label, values in zip(variant.row_labels, variant.matrix):
        match = pattern.fullmatch(label.strip())
        if match is None or len(values) < column_count:
            continue
        rows.append(
            (
                (int(match.group(1)), int(match.group(2))),
                [float(value) for value in values[:column_count]],
            )
        )
    return rows


def _causality_matrices(
    rows: list[tuple[tuple[int, int], list[float]]],
    condition_count: int,
) -> list[list[list[float]]]:
    matrices = [
        [[0.0 for _ in range(7)] for _ in range(7)] for _ in range(condition_count)
    ]
    for (target, source), values in rows:
        for condition, value in enumerate(values):
            matrices[condition][target][source] = value
    return matrices


def _condition_sort_key(result: DdaResult) -> tuple[int, int, str]:
    name = result.file_name
    if "_NoNoise__" in name:
        return (0, 0, name)
    match = _SNR_PATTERN.search(name)
    if match:
        return (1, -int(match.group(1)), name)
    return (2, 0, name)


def _condition_label(file_name: str) -> str:
    if "_NoNoise__" in file_name:
        return "no noise"
    match = _SNR_PATTERN.search(file_name)
    return f"{int(match.group(1))} dB" if match else Path(file_name).stem
