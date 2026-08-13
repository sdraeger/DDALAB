from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from ...domain.models import DdaResult, DdaVariantResult, LoadedDataset
from ..dda.motifs import (
    _build_directed_pairs,
    _build_undirected_pairs,
    build_network_motif_data,
)


def _payload_channel_labels(payload: dict) -> List[str]:
    raw_labels = payload.get("channel_labels") or payload.get("channelLabels") or []
    if not isinstance(raw_labels, list):
        return []
    return [str(value) for value in raw_labels if str(value).strip()]


def _coerce_variant_value(value: object) -> float:
    if value is None:
        return float("nan")
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _labels_are_generic_channel_numbers(labels: List[str]) -> bool:
    return bool(labels) and all(
        label.startswith("Channel ") and label.removeprefix("Channel ").isdigit()
        for label in labels
    )


def _labels_are_generic_pair_numbers(labels: List[str]) -> bool:
    separators = (" <-> ", " -> ")
    if not labels:
        return False
    for label in labels:
        matched = False
        for separator in separators:
            if separator not in label:
                continue
            left, right = label.split(separator, 1)
            if (
                left.startswith("Ch")
                and left.removeprefix("Ch").isdigit()
                and right.startswith("Ch")
                and right.removeprefix("Ch").isdigit()
            ):
                matched = True
                break
        if not matched:
            return False
    return True


def _default_variant_row_labels(
    *,
    dataset: LoadedDataset,
    selected_indices: List[int],
    selected_names: List[str],
    variant_id: str,
    row_count: int,
    selected_pairs: Optional[List[tuple[int, int]]] = None,
) -> List[str]:
    if variant_id in {"ST", "SY"}:
        return [
            selected_names[row] if row < len(selected_names) else f"Metric {row + 1}"
            for row in range(row_count)
        ]
    if variant_id in {"CT", "DE"}:
        labels = [
            f"{dataset.channel_names[left]} <> {dataset.channel_names[right]}"
            for left, right in (
                selected_pairs or _build_undirected_pairs(selected_indices)
            )
        ]
        labels.extend(f"Metric {row + 1}" for row in range(len(labels), row_count))
        return labels[:row_count]
    if variant_id == "CD":
        labels = [
            f"{dataset.channel_names[left]} -> {dataset.channel_names[right]}"
            for left, right in (
                selected_pairs or _build_directed_pairs(selected_indices)
            )
        ]
        labels.extend(f"Metric {row + 1}" for row in range(len(labels), row_count))
        return labels[:row_count]
    return [f"Metric {row + 1}" for row in range(row_count)]


def _map_cli_result(
    *,
    dataset: LoadedDataset,
    selected_indices: List[int],
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]],
    parsed: dict,
    diagnostics: List[str],
    start_time_seconds: float,
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
) -> DdaResult:
    selected_names = [
        dataset.channel_names[index]
        for index in selected_indices
        if 0 <= index < len(dataset.channel_names)
    ]
    variants: List[DdaVariantResult] = []
    for payload in parsed.get("variant_results") or parsed.get("variantResults") or []:
        if not isinstance(payload, dict):
            continue
        variant_id = str(
            payload.get("variant_id") or payload.get("variantId") or ""
        ).upper()
        matrix = [
            [_coerce_variant_value(value) for value in row]
            for row in payload.get("q_matrix") or payload.get("qMatrix") or []
            if isinstance(row, list)
        ]
        if not matrix:
            continue
        payload_labels = _payload_channel_labels(payload)
        default_labels = _default_variant_row_labels(
            dataset=dataset,
            selected_indices=selected_indices,
            selected_names=selected_names,
            variant_id=variant_id,
            row_count=max(len(matrix), len(payload_labels)),
            selected_pairs=(variant_pair_indices or {}).get(variant_id),
        )
        preferred_labels = (
            default_labels
            if (
                _labels_are_generic_channel_numbers(payload_labels)
                or _labels_are_generic_pair_numbers(payload_labels)
            )
            else payload_labels or default_labels
        )
        row_labels = preferred_labels[: len(matrix)]
        nonfinite_labels = [
            row_labels[index] if index < len(row_labels) else f"Series {index + 1}"
            for index, row in enumerate(matrix)
            if not any(math.isfinite(float(value)) for value in row)
        ]
        if nonfinite_labels:
            note = (
                f"{variant_id} returned non-finite output for: "
                + ", ".join(dict.fromkeys(nonfinite_labels))
                + ". Plots render these rows as 0.0."
            )
            if note not in diagnostics:
                diagnostics.append(note)
        (
            column_count,
            row_mean_absolute,
            row_peak_absolute,
            min_value,
            max_value,
        ) = _summarize_variant_matrix(matrix)
        network_motifs = (
            build_network_motif_data(
                q_matrix=matrix,
                channel_pairs=(variant_pair_indices or {}).get("CD"),
                channel_names=dataset.channel_names,
                delays=delays,
                threshold=0.25,
            )
            if variant_id == "CD"
            else None
        )
        variants.append(
            DdaVariantResult(
                id=variant_id,
                label=str(
                    payload.get("variant_name")
                    or payload.get("variantName")
                    or variant_id
                ),
                row_labels=row_labels,
                matrix=matrix,
                summary=f"Rust {variant_id} view",
                min_value=min_value,
                max_value=max_value,
                column_count=column_count,
                row_mean_absolute=row_mean_absolute,
                row_peak_absolute=row_peak_absolute,
                network_motifs=network_motifs,
            )
        )

    if not variants:
        raise RuntimeError("DDA backend returned no variant matrices.")

    sample_rate = max(dataset.dominant_sample_rate_hz, 1.0)
    step_seconds = window_step_samples / sample_rate
    center_offset = window_length_samples / sample_rate / 2.0
    window_count = max(
        (variant.effective_column_count for variant in variants), default=0
    )
    window_centers_seconds = [
        start_time_seconds + center_offset + index * step_seconds
        for index in range(window_count)
    ]
    return DdaResult(
        id=str(parsed.get("id") or uuid.uuid4().hex),
        file_path=dataset.file_path,
        file_name=dataset.file_name,
        created_at_iso=str(
            parsed.get("created_at")
            or parsed.get("createdAt")
            or datetime.now(timezone.utc).isoformat()
        ),
        engine_label="DDA backend",
        diagnostics=diagnostics,
        window_centers_seconds=window_centers_seconds,
        variants=variants,
        is_fallback=False,
    )


def _summarize_variant_matrix(
    matrix: List[List[float]],
) -> tuple[int, List[float], List[float], float, float]:
    column_count = max((len(row) for row in matrix), default=0)
    row_mean_absolute: List[float] = []
    row_peak_absolute: List[float] = []
    min_value = float("inf")
    max_value = float("-inf")

    for row in matrix:
        if not row:
            row_mean_absolute.append(0.0)
            row_peak_absolute.append(0.0)
            continue
        absolute_sum = 0.0
        row_peak = 0.0
        finite_count = 0
        for value in row:
            numeric = float(value)
            if not math.isfinite(numeric):
                continue
            absolute = abs(numeric)
            absolute_sum += absolute
            if absolute > row_peak:
                row_peak = absolute
            if numeric < min_value:
                min_value = numeric
            if numeric > max_value:
                max_value = numeric
            finite_count += 1
        row_mean_absolute.append(absolute_sum / finite_count if finite_count else 0.0)
        row_peak_absolute.append(row_peak)

    if min_value == float("inf"):
        min_value = 0.0
        max_value = 0.0

    return column_count, row_mean_absolute, row_peak_absolute, min_value, max_value
