from __future__ import annotations

import math
from typing import Dict, List, Optional


from ...backend.dda.motifs import build_network_motif_data
from ...domain.models import (
    DdaResult,
    DdaVariantResult,
    NetworkMotifData,
)
from ..support.main_window_support import (
    _build_connectivity_metrics,
    _build_variant_comparisons,
)


def _plot_widget_view_window(widget: object | None) -> tuple[float, float]:
    if widget is not None and hasattr(widget, "view_window"):
        start, span = widget.view_window()
        return float(start), float(span)
    return (
        float(getattr(widget, "_x_view_start", 0.0)),
        float(getattr(widget, "_x_view_span", 1.0)),
    )


def _checkbox_checked(owner: object, name: str, default: bool) -> bool:
    checkbox = getattr(owner, name, None)
    if checkbox is None or not hasattr(checkbox, "isChecked"):
        return default
    return bool(checkbox.isChecked())


def _build_connectivity_view_payload(result: DdaResult) -> Dict[str, object]:
    cd_variant = next((item for item in result.variants if item.id == "CD"), None)
    metric_variant = cd_variant
    if metric_variant is None:
        metric_variant = next(
            (item for item in result.variants if item.id in {"CT", "SY"}),
            None,
        )
    metrics = (
        _build_connectivity_metrics(metric_variant)
        if metric_variant is not None
        else []
    )
    motif_data = None
    motif_summary = "Run DDA with CD to inspect directed causality motifs."
    if cd_variant is not None:
        motif_data = cd_variant.network_motifs or _rebuild_network_motif_data(
            result,
            cd_variant,
        )
        if motif_data is not None:
            cd_variant.network_motifs = motif_data
            total_edges = sum(
                len(matrix.edges) for matrix in motif_data.adjacency_matrices
            )
            formatted_delays = ", ".join(
                f"{delay:.2f}" for delay in motif_data.delay_values[:3]
            )
            motif_summary = (
                f"Directed CD causality across {motif_data.num_nodes} channels. "
                f"{len(motif_data.adjacency_matrices)} motif snapshots, "
                f"{total_edges} total edges, "
                f"tau {formatted_delays}."
            )
        else:
            motif_summary = (
                "CD results are available, but the channel-pair metadata needed to "
                "rebuild motif plots is missing."
            )
    return {
        "summary_text": (
            f"File: {result.file_name}\n"
            f"Metrics source: {metric_variant.id if metric_variant else '—'}\n"
            f"Rows: {len(metric_variant.row_labels) if metric_variant else 0}\n"
            f"Motifs: {'CD available' if motif_data is not None else 'unavailable'}\n"
            f"Metrics: {len(metrics)}"
        ),
        "metrics": metrics,
        "motif_data": motif_data,
        "motif_summary": motif_summary,
    }


def _rebuild_network_motif_data(
    result: DdaResult,
    variant: DdaVariantResult,
) -> Optional[NetworkMotifData]:
    reproduction = result.reproduction
    if reproduction is None:
        return None
    pair_indices = list(reproduction.variant_pair_indices.get("CD") or [])
    pair_names = list(reproduction.variant_pair_names.get("CD") or [])
    if not pair_indices:
        return None

    channel_name_lookup: Dict[int, str] = {}
    for index, name in zip(
        reproduction.selected_channel_indices,
        reproduction.selected_channel_names,
    ):
        channel_name_lookup[int(index)] = str(name)
    for (left_index, right_index), (left_name, right_name) in zip(
        pair_indices,
        pair_names,
    ):
        channel_name_lookup[int(left_index)] = str(left_name)
        channel_name_lookup[int(right_index)] = str(right_name)

    if channel_name_lookup:
        max_index = max(channel_name_lookup)
        channel_names = [
            channel_name_lookup.get(index, f"Ch{index + 1}")
            for index in range(max_index + 1)
        ]
    else:
        channel_names = []
    delays = reproduction.delays or list(range(variant.effective_column_count))
    return build_network_motif_data(
        q_matrix=variant.matrix,
        channel_pairs=pair_indices,
        channel_names=channel_names,
        delays=delays,
        threshold=0.25,
    )


def _ordered_shared_variant_ids(
    baseline: DdaResult,
    target: DdaResult,
    variant_order: List[str],
) -> List[str]:
    baseline_ids = {variant.id for variant in baseline.variants}
    target_ids = {variant.id for variant in target.variants}
    shared = baseline_ids & target_ids
    ordered = [variant_id for variant_id in variant_order if variant_id in shared]
    ordered.extend(
        sorted(variant_id for variant_id in shared if variant_id not in ordered)
    )
    return ordered


def _default_compare_row_labels_from_stats(row_stats: List[dict]) -> List[str]:
    ordered = sorted(
        row_stats,
        key=lambda item: item["mean_abs_diff"],
        reverse=True,
    )
    return [item["row_label"] for item in ordered[: min(6, len(ordered))]]


def _build_compare_view_payload(
    baseline: DdaResult,
    target: DdaResult,
    selected_variant_id: Optional[str],
    requested_row_labels: List[str],
    previous_context_key: Optional[tuple[str, str, str]],
    variant_order: List[str],
) -> Dict[str, object]:
    comparisons = _build_variant_comparisons(baseline, target)
    shared_variant_ids = _ordered_shared_variant_ids(baseline, target, variant_order)
    if not shared_variant_ids:
        return {
            "status": "empty",
            "message": (
                f"Baseline: {baseline.file_name}\n"
                f"Target: {target.file_name}\n\n"
                "These analyses do not share any DDA variants."
            ),
        }

    baseline_variants = {variant.id: variant for variant in baseline.variants}
    target_variants = {variant.id: variant for variant in target.variants}
    resolved_variant_id = (
        selected_variant_id
        if selected_variant_id in shared_variant_ids
        else shared_variant_ids[0]
    )
    baseline_variant = baseline_variants.get(resolved_variant_id)
    target_variant = target_variants.get(resolved_variant_id)
    if baseline_variant is None or target_variant is None:
        return {
            "status": "empty",
            "message": "Select a shared variant to compare.",
        }

    row_stats = _build_compare_row_statistics(baseline_variant, target_variant)
    shared_row_labels = [metric["row_label"] for metric in row_stats]
    context_key = (baseline.id, target.id, resolved_variant_id)
    selected_rows = [
        label for label in requested_row_labels if label in shared_row_labels
    ]
    if not selected_rows and context_key != previous_context_key:
        selected_rows = _default_compare_row_labels_from_stats(row_stats)

    shared_column_count = min(
        baseline_variant.effective_column_count,
        target_variant.effective_column_count,
    )
    shared_window_centers = _compare_window_centers(
        baseline,
        target,
        shared_column_count,
    )
    shared_min_value, shared_max_value = _shared_variant_value_bounds(
        baseline_variant,
        target_variant,
        selected_rows,
    )
    baseline_display_variant = _filtered_compare_variant(
        baseline_variant,
        selected_rows,
        min_value=shared_min_value,
        max_value=shared_max_value,
        summary_prefix="Baseline",
    )
    target_display_variant = _filtered_compare_variant(
        target_variant,
        selected_rows,
        min_value=shared_min_value,
        max_value=shared_max_value,
        summary_prefix="Target",
    )
    diff_display_variant = _difference_compare_variant(
        baseline_variant,
        target_variant,
        selected_rows,
        shared_column_count,
    )
    overlay_display_variant = _overlay_compare_variant(
        baseline_variant,
        target_variant,
        selected_rows,
        shared_column_count,
        baseline.file_name,
        target.file_name,
        min_value=shared_min_value,
        max_value=shared_max_value,
    )
    shared_row_count = len(row_stats)
    selected_row_count = len(selected_rows)
    overlap_notice = (
        f"Overlap columns: {shared_column_count}."
        if baseline_variant.effective_column_count
        != target_variant.effective_column_count
        else f"Columns per result: {shared_column_count}."
    )
    top_row = row_stats[0]["row_label"] if row_stats else "—"
    selected_row_lookup = set(selected_rows)
    visible_row_stats = [
        metric for metric in row_stats if metric["row_label"] in selected_row_lookup
    ]
    return {
        "status": "ready",
        "baseline_result_id": baseline.id,
        "target_result_id": target.id,
        "baseline_window_centers": list(baseline.window_centers_seconds),
        "target_window_centers": list(target.window_centers_seconds),
        "shared_window_centers": shared_window_centers,
        "comparisons": comparisons,
        "shared_variant_ids": shared_variant_ids,
        "variant_labels": {
            variant_id: baseline_variants[variant_id].label or variant_id
            for variant_id in shared_variant_ids
        },
        "selected_variant_id": resolved_variant_id,
        "row_stats": row_stats,
        "selected_rows": selected_rows,
        "context_key": context_key,
        "baseline_display_variant": baseline_display_variant,
        "target_display_variant": target_display_variant,
        "diff_display_variant": diff_display_variant,
        "overlay_display_variant": overlay_display_variant,
        "shared_meta_text": (
            f"Shared variant: {resolved_variant_id} • shared rows: {shared_row_count} "
            f"• selected rows: {selected_row_count} • {overlap_notice}"
        ),
        "summary_text": "\n".join(
            [
                f"Baseline: {baseline.file_name}",
                f"Target: {target.file_name}",
                f"Variant: {resolved_variant_id}",
                f"Shared variants: {len(shared_variant_ids)}",
                f"Shared rows: {shared_row_count}",
                f"Selected rows: {selected_row_count}",
                f"Baseline columns: {baseline_variant.effective_column_count}",
                f"Target columns: {target_variant.effective_column_count}",
                overlap_notice,
                f"Most changed row: {top_row}",
            ]
        ),
        "visible_row_stats": visible_row_stats,
        "stats_summary_text": "\n".join(
            [
                f"Comparing {resolved_variant_id} across {selected_row_count} selected row{'s' if selected_row_count != 1 else ''}.",
                f"Baseline engine: {baseline.engine_label}",
                f"Target engine: {target.engine_label}",
                "Difference values represent target minus baseline over the overlapping column span.",
            ]
        ),
    }


def _variant_by_row_label(variant: DdaVariantResult) -> Dict[str, List[float]]:
    return {
        label: list(variant.matrix[index]) if index < len(variant.matrix) else []
        for index, label in enumerate(variant.row_labels)
    }


def _finite_aligned_pairs(
    baseline_row: List[float],
    target_row: List[float],
) -> List[tuple[float, float]]:
    limit = min(len(baseline_row), len(target_row))
    pairs: List[tuple[float, float]] = []
    for index in range(limit):
        baseline_value = float(baseline_row[index])
        target_value = float(target_row[index])
        if not math.isfinite(baseline_value) or not math.isfinite(target_value):
            continue
        pairs.append((baseline_value, target_value))
    return pairs


def _mean_absolute(values: List[float]) -> float:
    finite = [abs(float(value)) for value in values if math.isfinite(float(value))]
    if not finite:
        return 0.0
    return sum(finite) / len(finite)


def _pearson_correlation(pairs: List[tuple[float, float]]) -> float:
    if len(pairs) < 2:
        return float("nan")
    xs = [pair[0] for pair in pairs]
    ys = [pair[1] for pair in pairs]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    numerator = 0.0
    denominator_x = 0.0
    denominator_y = 0.0
    for x_value, y_value in pairs:
        dx = x_value - mean_x
        dy = y_value - mean_y
        numerator += dx * dy
        denominator_x += dx * dx
        denominator_y += dy * dy
    denominator = math.sqrt(denominator_x * denominator_y)
    if denominator <= 0.0:
        return float("nan")
    return numerator / denominator


def _build_compare_row_statistics(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
) -> List[dict]:
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    shared_labels = [
        label for label in baseline_variant.row_labels if label in target_rows
    ]
    row_stats: List[dict] = []
    for label in shared_labels:
        baseline_row = baseline_rows.get(label, [])
        target_row = target_rows.get(label, [])
        pairs = _finite_aligned_pairs(baseline_row, target_row)
        if pairs:
            diffs = [
                target_value - baseline_value for baseline_value, target_value in pairs
            ]
            mean_abs_diff = sum(abs(value) for value in diffs) / len(diffs)
            max_abs_diff = max(abs(value) for value in diffs)
            rms_diff = math.sqrt(sum(value * value for value in diffs) / len(diffs))
        else:
            mean_abs_diff = 0.0
            max_abs_diff = 0.0
            rms_diff = 0.0
        row_stats.append(
            {
                "row_label": label,
                "baseline_mean_abs": _mean_absolute(baseline_row),
                "target_mean_abs": _mean_absolute(target_row),
                "mean_abs_diff": mean_abs_diff,
                "max_abs_diff": max_abs_diff,
                "rms_diff": rms_diff,
                "correlation": _pearson_correlation(pairs),
                "shared_points": len(pairs),
            }
        )
    return sorted(row_stats, key=lambda item: item["mean_abs_diff"], reverse=True)


def _row_bounds(matrix: List[List[float]]) -> tuple[float, float]:
    finite = [
        float(value) for row in matrix for value in row if math.isfinite(float(value))
    ]
    if not finite:
        return (0.0, 0.0)
    return (min(finite), max(finite))


def _shared_variant_value_bounds(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
    row_labels: List[str],
) -> tuple[float, float]:
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    selected_rows = row_labels or [
        label for label in baseline_variant.row_labels if label in target_rows
    ]
    combined: List[List[float]] = []
    for label in selected_rows:
        if label in baseline_rows:
            combined.append(baseline_rows[label])
        if label in target_rows:
            combined.append(target_rows[label])
    return _row_bounds(combined)


def _filtered_compare_variant(
    variant: DdaVariantResult,
    row_labels: List[str],
    *,
    min_value: float,
    max_value: float,
    summary_prefix: str,
) -> Optional[DdaVariantResult]:
    if not row_labels:
        return None
    row_lookup = _variant_by_row_label(variant)
    filtered_labels = [label for label in row_labels if label in row_lookup]
    matrix = [list(row_lookup[label]) for label in filtered_labels]
    if not matrix:
        return None
    row_mean_absolute = [_mean_absolute(row) for row in matrix]
    row_peak_absolute = [
        max(
            (abs(float(value)) for value in row if math.isfinite(float(value))),
            default=0.0,
        )
        for row in matrix
    ]
    return DdaVariantResult(
        id=variant.id,
        label=f"{summary_prefix} {variant.label}",
        row_labels=filtered_labels,
        matrix=matrix,
        summary=f"{summary_prefix} view for {variant.id}",
        min_value=min_value,
        max_value=max_value,
        column_count=max((len(row) for row in matrix), default=0),
        row_mean_absolute=row_mean_absolute,
        row_peak_absolute=row_peak_absolute,
    )


def _difference_compare_variant(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
    row_labels: List[str],
    column_count: int,
) -> Optional[DdaVariantResult]:
    if not row_labels or column_count <= 0:
        return None
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    matrix: List[List[float]] = []
    filtered_labels: List[str] = []
    for label in row_labels:
        baseline_row = baseline_rows.get(label)
        target_row = target_rows.get(label)
        if baseline_row is None or target_row is None:
            continue
        diff_row: List[float] = []
        for index in range(column_count):
            baseline_value = (
                float(baseline_row[index])
                if index < len(baseline_row)
                else float("nan")
            )
            target_value = (
                float(target_row[index]) if index < len(target_row) else float("nan")
            )
            if not math.isfinite(baseline_value) or not math.isfinite(target_value):
                diff_row.append(float("nan"))
            else:
                diff_row.append(target_value - baseline_value)
        filtered_labels.append(label)
        matrix.append(diff_row)
    if not matrix:
        return None
    _, max_value = _row_bounds([[abs(value) for value in row] for row in matrix])
    symmetric_bound = max(max_value, 1e-6)
    row_mean_absolute = [_mean_absolute(row) for row in matrix]
    row_peak_absolute = [
        max(
            (abs(float(value)) for value in row if math.isfinite(float(value))),
            default=0.0,
        )
        for row in matrix
    ]
    return DdaVariantResult(
        id=f"{baseline_variant.id}-diff",
        label=f"{baseline_variant.label} Difference",
        row_labels=filtered_labels,
        matrix=matrix,
        summary="Target minus baseline over the overlapping window span.",
        min_value=-symmetric_bound,
        max_value=symmetric_bound,
        column_count=column_count,
        row_mean_absolute=row_mean_absolute,
        row_peak_absolute=row_peak_absolute,
    )


def _overlay_compare_variant(
    baseline_variant: DdaVariantResult,
    target_variant: DdaVariantResult,
    row_labels: List[str],
    column_count: int,
    baseline_label: str,
    target_label: str,
    *,
    min_value: float,
    max_value: float,
) -> Optional[DdaVariantResult]:
    if not row_labels or column_count <= 0:
        return None
    baseline_rows = _variant_by_row_label(baseline_variant)
    target_rows = _variant_by_row_label(target_variant)
    matrix: List[List[float]] = []
    overlay_labels: List[str] = []
    for label in row_labels:
        baseline_row = baseline_rows.get(label)
        target_row = target_rows.get(label)
        if baseline_row is None or target_row is None:
            continue
        overlay_labels.append(f"{baseline_label} · {label}")
        matrix.append(list(baseline_row[:column_count]))
        overlay_labels.append(f"{target_label} · {label}")
        matrix.append(list(target_row[:column_count]))
    if not matrix:
        return None
    row_mean_absolute = [_mean_absolute(row) for row in matrix]
    row_peak_absolute = [
        max(
            (abs(float(value)) for value in row if math.isfinite(float(value))),
            default=0.0,
        )
        for row in matrix
    ]
    return DdaVariantResult(
        id=f"{baseline_variant.id}-overlay",
        label=f"{baseline_variant.label} Overlay",
        row_labels=overlay_labels,
        matrix=matrix,
        summary="Baseline and target lines overlaid for the selected rows.",
        min_value=min_value,
        max_value=max_value,
        column_count=column_count,
        row_mean_absolute=row_mean_absolute,
        row_peak_absolute=row_peak_absolute,
    )


def _compare_window_centers(
    baseline: DdaResult,
    target: DdaResult,
    column_count: int,
) -> List[float]:
    if column_count <= 0:
        return []
    if len(baseline.window_centers_seconds) >= column_count:
        return list(baseline.window_centers_seconds[:column_count])
    if len(target.window_centers_seconds) >= column_count:
        return list(target.window_centers_seconds[:column_count])
    return [float(index) for index in range(column_count)]


def _format_compare_numeric(value: float) -> str:
    return f"{value:.4f}" if math.isfinite(value) else "—"
