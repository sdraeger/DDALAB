from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from .scalar import (
    DEFAULT_DELAYS,
    DEFAULT_DERIVATIVE_POINTS,
    DEFAULT_MODEL_TERMS,
    DEFAULT_NR_TAU,
    DEFAULT_ORDER,
    DEFAULT_WINDOW_LENGTH,
    DEFAULT_WINDOW_STEP,
    DDAResult,
    DDAVariantResult,
    NormalizationMode,
    _ModelSpec,
    _PreparedWindow,
    _SolvedBlock,
    _monomial_list,
    _normalize_flavor,
    _select_model_terms,
)


def run_dda_matrix(
    samples: Sequence[Sequence[float]],
    *,
    channels: Sequence[int] | None = None,
    flavors: Sequence[str] = ("ST",),
    window_length: int = DEFAULT_WINDOW_LENGTH,
    window_step: int = DEFAULT_WINDOW_STEP,
    delays: Sequence[int] = DEFAULT_DELAYS,
    model_terms: Sequence[int] = DEFAULT_MODEL_TERMS,
    derivative_points: int = DEFAULT_DERIVATIVE_POINTS,
    order: int = DEFAULT_ORDER,
    nr_tau: int = DEFAULT_NR_TAU,
    ct_channel_pairs: Sequence[Sequence[int]] | None = None,
    cd_channel_pairs: Sequence[Sequence[int]] | None = None,
    ct_window_length: int | None = None,
    ct_window_step: int | None = None,
    channel_labels: Sequence[str] | None = None,
    start: float = 0.0,
    end: float | None = None,
    normalization: NormalizationMode = "zscore",
    nr_exclude: int = 10,
    derivative_step: int = 1,
) -> DDAResult:
    """Run the Python translation of the Rust DDA core engine on a sample matrix.

    The input matrix is row-major: rows are time samples and columns are
    channels. The implementation mirrors `packages/dda-rs/src/engine.rs` for
    the core SELECT-mask flavors ST, CT, CD, DE, and SY.
    """

    data = _validate_samples(samples)
    row_count, col_count = data.shape
    labels = _normalize_channel_labels(channel_labels, col_count)
    selected_channels = _normalize_channels(channels, col_count)
    enabled = {_normalize_flavor(flavor) for flavor in flavors}
    if not enabled:
        raise ValueError("At least one DDA flavor must be enabled.")

    unsupported = enabled.difference({"ST", "CT", "CD", "DE", "SY"})
    if unsupported:
        joined = ", ".join(sorted(unsupported))
        raise ValueError(f"Unsupported Python DDA flavor(s): {joined}")

    model = _build_model_spec(
        window_length=window_length,
        window_step=window_step,
        delays=delays,
        model_terms=model_terms,
        derivative_points=derivative_points,
        order=order,
        nr_tau=nr_tau,
    )
    bounds_start, bounds_len = _analysis_bounds(start, end, row_count)
    native_window_marker = (
        model.window_length + model.max_delay + 2 * model.derivative_points
    )
    required_rows = max(native_window_marker - 1, 0)
    if bounds_len < required_rows:
        raise ValueError(
            "Selected range has "
            f"{bounds_len} samples but DDA requires at least {required_rows} samples "
            "(WL + 2*derivative_points + max(delay) - 1)."
        )
    if model.window_step <= 0:
        raise ValueError("window_step must be greater than zero.")

    st_channels = selected_channels
    de_channels = selected_channels
    sy_channels = selected_channels
    ct_groups = _resolve_ct_groups(
        selected_channels,
        col_count,
        ct_channel_pairs,
        ct_window_length,
        ct_window_step,
    )
    de_groups = _resolve_sliding_groups(
        de_channels or list(range(col_count)),
        ct_window_length,
        ct_window_step,
    )
    cd_pairs = _resolve_cd_pairs(selected_channels, col_count, cd_channel_pairs)
    sy_pairs = _resolve_sy_pairs(sy_channels)

    enabled_st = "ST" in enabled
    enabled_ct = "CT" in enabled
    enabled_cd = "CD" in enabled
    enabled_de = "DE" in enabled
    enabled_sy = "SY" in enabled and bool(sy_pairs)
    if not any((enabled_st, enabled_ct, enabled_cd, enabled_de, enabled_sy)):
        raise ValueError("No DDA flavors enabled for Python engine.")

    num_windows = 1 + (bounds_len - required_rows) // model.window_step
    markers = [
        float(bounds_start + window_idx * model.window_step + native_window_marker)
        for window_idx in range(num_windows)
    ]

    st_matrix = _nan_matrix(len(st_channels), num_windows) if enabled_st else None
    ct_matrix = _nan_matrix(len(ct_groups), num_windows) if enabled_ct else None
    cd_matrix = _nan_matrix(len(cd_pairs), num_windows) if enabled_cd else None
    de_matrix = _nan_matrix(len(de_groups), num_windows) if enabled_de else None
    sy_matrix = _nan_matrix(len(sy_pairs), num_windows) if enabled_sy else None

    analysis_channels = _collect_analysis_channels(
        st_channels, ct_groups, de_groups, cd_pairs
    )

    for window_idx in range(num_windows):
        prepared = _prepare_window_for_analysis(
            data,
            bounds_start,
            model,
            window_idx,
            normalization,
            nr_exclude,
            derivative_step,
        )

        st_blocks: list[_SolvedBlock | None] = [None] * col_count
        if enabled_st or enabled_cd or enabled_de:
            for channel in analysis_channels:
                st_blocks[channel] = _solve_group_block(
                    prepared,
                    [channel],
                    model.primary_terms,
                    model.window_length,
                )

        if st_matrix is not None:
            for row_idx, channel in enumerate(st_channels):
                block = st_blocks[channel]
                if block is not None and block.coefficients.size:
                    st_matrix[row_idx, window_idx] = block.coefficients[0]

        ct_blocks: list[_SolvedBlock] = []
        if enabled_ct:
            ct_blocks = [
                _solve_group_block(
                    prepared, group, model.primary_terms, model.window_length
                )
                for group in ct_groups
            ]
            if ct_matrix is not None:
                for row_idx, block in enumerate(ct_blocks):
                    if block.coefficients.size:
                        ct_matrix[row_idx, window_idx] = block.coefficients[0]

        de_blocks: list[_SolvedBlock] = []
        if enabled_de:
            de_blocks = [
                _solve_group_block(
                    prepared, group, model.primary_terms, model.window_length
                )
                for group in de_groups
            ]
            if de_matrix is not None:
                for row_idx, group in enumerate(de_groups):
                    de_matrix[row_idx, window_idx] = _compute_de_value(
                        group,
                        st_blocks,
                        de_blocks[row_idx].rmse
                        if row_idx < len(de_blocks)
                        else float("nan"),
                    )

        if enabled_cd and cd_matrix is not None:
            for pair_idx, (target, source) in enumerate(cd_pairs):
                directed = _solve_directed_pair(
                    prepared,
                    target,
                    source,
                    target,
                    model.primary_terms,
                    model.secondary_terms,
                    model.window_length,
                )
                baseline = (
                    st_blocks[target].rmse
                    if st_blocks[target] is not None
                    else float("nan")
                )
                cd_matrix[pair_idx, window_idx] = _causal_improvement(
                    baseline, directed.rmse
                )

        if enabled_sy and sy_matrix is not None:
            for pair_idx, (left, right) in enumerate(sy_pairs):
                forward = _solve_directed_pair(
                    prepared,
                    left,
                    right,
                    right,
                    model.primary_terms,
                    model.secondary_terms,
                    model.window_length,
                )
                reverse = _solve_directed_pair(
                    prepared,
                    right,
                    left,
                    left,
                    model.primary_terms,
                    model.secondary_terms,
                    model.window_length,
                )
                sy_matrix[pair_idx, window_idx] = _synchronization_value(
                    forward.rmse, reverse.rmse
                )

    variants: list[DDAVariantResult] = []
    if st_matrix is not None:
        variants.append(
            DDAVariantResult(
                "ST",
                "Single Timeseries (ST)",
                st_matrix,
                _labels_for_channels(labels, st_channels),
                markers,
            )
        )
    if ct_matrix is not None:
        variants.append(
            DDAVariantResult(
                "CT",
                "Cross-Timeseries (CT)",
                ct_matrix,
                _labels_for_groups(labels, ct_groups, "&"),
                markers,
            )
        )
    if cd_matrix is not None:
        variants.append(
            DDAVariantResult(
                "CD",
                "Cross-Dynamical (CD)",
                cd_matrix,
                _labels_for_pairs(labels, cd_pairs, " <- "),
                markers,
            )
        )
    if de_matrix is not None:
        variants.append(
            DDAVariantResult(
                "DE",
                "Dynamical Ergodicity (DE)",
                de_matrix,
                _labels_for_groups(labels, de_groups, "&"),
                markers,
            )
        )
    if sy_matrix is not None:
        variants.append(
            DDAVariantResult(
                "SY",
                "Synchronization (SY)",
                sy_matrix,
                _labels_for_pairs(labels, sy_pairs, " <-> "),
                markers,
            )
        )

    return DDAResult(variants=variants, window_markers=markers, channel_labels=labels)


def _validate_samples(samples: Sequence[Sequence[float]]) -> np.ndarray:
    data = np.asarray(samples, dtype=float)
    if data.ndim != 2:
        raise ValueError("DDA samples must be a 2D row-major matrix.")
    if data.shape[0] == 0:
        raise ValueError("DDA samples must contain at least one row.")
    if data.shape[1] == 0:
        raise ValueError("DDA samples must contain at least one channel.")
    return data


def _normalize_channel_labels(
    labels: Sequence[str] | None, col_count: int
) -> list[str]:
    if labels is not None and len(labels) == col_count:
        return [str(label) for label in labels]
    return [f"Ch {index}" for index in range(col_count)]


def _normalize_channels(channels: Sequence[int] | None, col_count: int) -> list[int]:
    if channels is None or len(channels) == 0:
        return list(range(col_count))
    normalized = [int(channel) for channel in channels]
    for channel in normalized:
        if channel < 0 or channel >= col_count:
            raise ValueError(
                f"Channel index {channel} is out of range for {col_count} channels."
            )
    return normalized


def _build_model_spec(
    *,
    window_length: int,
    window_step: int,
    delays: Sequence[int],
    model_terms: Sequence[int],
    derivative_points: int,
    order: int,
    nr_tau: int,
) -> _ModelSpec:
    if derivative_points <= 0:
        raise ValueError("derivative_points must be greater than zero.")
    if nr_tau <= 0:
        raise ValueError("nr_tau must be greater than zero.")
    if window_length <= 0:
        raise ValueError("window_length must be greater than zero.")
    if window_step <= 0:
        raise ValueError("window_step must be greater than zero.")
    normalized_delays = _normalize_delays(delays, nr_tau)
    monomials = _monomial_list(nr_tau, order)
    selected_terms = _select_model_terms(monomials, model_terms, normalized_delays)
    return _ModelSpec(
        derivative_points=derivative_points,
        window_length=window_length,
        window_step=window_step,
        max_delay=max(normalized_delays) if normalized_delays else 0,
        primary_terms=selected_terms,
        secondary_terms=[list(term) for term in selected_terms],
    )


def _normalize_delays(delays: Sequence[int], nr_tau: int) -> list[int]:
    if len(delays) < nr_tau:
        raise ValueError(
            f"Received {len(delays)} delays but nr_tau={nr_tau} requires at least {nr_tau}."
        )
    normalized: list[int] = []
    for delay in delays[:nr_tau]:
        delay = int(delay)
        if delay < 0:
            raise ValueError(f"DDA expects non-negative delays, got {delay}.")
        normalized.append(delay)
    return normalized


def _analysis_bounds(
    start: float, end: float | None, row_count: int
) -> tuple[int, int]:
    start_idx = math.floor(max(start, 0.0))
    end_value = float(row_count - 1) if end is None else end
    end_idx = (
        math.floor(max(end_value, 0.0)) if math.isfinite(end_value) else row_count - 1
    )
    clamped_start = min(start_idx, row_count - 1)
    clamped_end = max(min(end_idx, row_count - 1), clamped_start)
    return clamped_start, clamped_end - clamped_start + 1


def _resolve_ct_groups(
    channels: list[int],
    total_channels: int,
    ct_channel_pairs: Sequence[Sequence[int]] | None,
    ct_window_length: int | None,
    ct_window_step: int | None,
) -> list[list[int]]:
    if ct_channel_pairs:
        return [[int(channel) for channel in pair] for pair in ct_channel_pairs]
    base_channels = channels or list(range(total_channels))
    return _resolve_sliding_groups(base_channels, ct_window_length, ct_window_step)


def _resolve_sliding_groups(
    channels: list[int],
    window_length: int | None,
    window_step: int | None,
) -> list[list[int]]:
    length = int(window_length) if window_length is not None else len(channels)
    step = int(window_step) if window_step is not None else max(length, 1)
    if length <= 0 or len(channels) < length:
        return []
    groups: list[list[int]] = []
    start = 0
    while start + length <= len(channels):
        groups.append(channels[start : start + length])
        start += max(step, 1)
    return groups


def _resolve_cd_pairs(
    channels: list[int],
    total_channels: int,
    cd_channel_pairs: Sequence[Sequence[int]] | None,
) -> list[tuple[int, int]]:
    if cd_channel_pairs:
        return [(int(pair[0]), int(pair[1])) for pair in cd_channel_pairs]
    base_channels = channels or list(range(total_channels))
    return [
        (target, source)
        for target in base_channels
        for source in base_channels
        if target != source
    ]


def _resolve_sy_pairs(channels: list[int]) -> list[tuple[int, int]]:
    pairs: list[tuple[int, int]] = []
    for index in range(0, len(channels), 2):
        chunk = channels[index : index + 2]
        if len(chunk) == 2:
            pairs.append((chunk[0], chunk[1]))
    return pairs


def _collect_analysis_channels(
    st_channels: list[int],
    ct_groups: list[list[int]],
    de_groups: list[list[int]],
    cd_pairs: list[tuple[int, int]],
) -> list[int]:
    collected: set[int] = set(st_channels)
    for group in ct_groups:
        collected.update(group)
    for group in de_groups:
        collected.update(group)
    for target, source in cd_pairs:
        collected.add(target)
        collected.add(source)
    return sorted(collected)


def _nan_matrix(rows: int, cols: int) -> np.ndarray:
    return np.full((rows, cols), np.nan, dtype=float)


def _prepare_window_for_analysis(
    data: np.ndarray,
    bounds_start: int,
    model: _ModelSpec,
    window_idx: int,
    normalization: NormalizationMode,
    nr_exclude: int,
    derivative_step: int,
) -> _PreparedWindow:
    native_window_marker = (
        model.window_length + model.max_delay + 2 * model.derivative_points
    )
    slice_start = bounds_start + window_idx * model.window_step
    slice_end = slice_start + native_window_marker
    if slice_end <= data.shape[0]:
        raw_window = data[slice_start:slice_end].copy()
    else:
        available = data[slice_start : data.shape[0]].copy()
        filler = available[-1, -1] if available.size else float("nan")
        pad_rows = native_window_marker - available.shape[0]
        padding = np.full((pad_rows, data.shape[1]), filler, dtype=float)
        raw_window = np.vstack([available, padding])
    return _prepare_raw_window(
        raw_window,
        model,
        normalization=normalization,
        nr_exclude=nr_exclude,
        derivative_step=derivative_step,
    )


def _prepare_raw_window(
    raw_window: np.ndarray,
    model: _ModelSpec,
    *,
    normalization: NormalizationMode,
    nr_exclude: int,
    derivative_step: int,
) -> _PreparedWindow:
    data = raw_window.copy()
    _apply_nan_runs(data, nr_exclude)
    derivative = _deriv_all_2d(data, model.derivative_points, derivative_step)
    shifted, trimmed_derivative = _normalize_window(
        data,
        derivative,
        model.derivative_points,
        model.max_delay,
        normalization,
    )
    return _PreparedWindow(
        shifted=shifted, derivative=trimmed_derivative, max_delay=model.max_delay
    )


def _apply_nan_runs(data: np.ndarray, nr_exclude: int) -> None:
    if nr_exclude == 0 or data.size == 0:
        return
    rows, cols = data.shape
    for col in range(cols):
        runs: list[tuple[int, int]] = []
        current_start: int | None = None
        current_len = 1
        for row in range(1, rows):
            if data[row - 1, col] == data[row, col]:
                if current_start is None:
                    current_start = row - 1
                current_len += 1
                if row == rows - 1 and current_len >= nr_exclude:
                    runs.append(
                        (
                            current_start if current_start is not None else row - 1,
                            row + 1,
                        )
                    )
            elif current_len >= nr_exclude:
                runs.append(
                    (current_start if current_start is not None else row - 1, row)
                )
                current_start = None
                current_len = 1
            else:
                current_start = None
                current_len = 1
        for run_start, run_end in runs:
            data[run_start:run_end, col] = np.nan


def _deriv_all_2d(data: np.ndarray, derivative_points: int, step: int) -> np.ndarray:
    rows, cols = data.shape
    if rows <= 2 * derivative_points:
        raise ValueError(
            f"Need more than 2*derivative_points={2 * derivative_points} rows, got {rows}."
        )
    step = max(int(step), 1)
    stencil_count = derivative_points // step
    if stencil_count == 0:
        raise ValueError(
            f"Invalid derivative_step={step} for derivative_points={derivative_points}."
        )
    effective_rows = rows - 2 * derivative_points
    derivative = np.full((cols, effective_rows), np.nan, dtype=float)
    for col in range(cols):
        for center in range(derivative_points, rows - derivative_points):
            valid = not np.isnan(data[center, col])
            value = 0.0
            for stencil in range(1, stencil_count + 1):
                offset = stencil * step
                plus = data[center + offset, col]
                minus = data[center - offset, col]
                if np.isnan(plus) or np.isnan(minus):
                    valid = False
                if valid:
                    value += (plus - minus) / stencil
            if valid:
                derivative[col, center - derivative_points] = value / stencil_count
    return derivative


def _normalize_window(
    raw: np.ndarray,
    derivative: np.ndarray,
    derivative_points: int,
    max_delay: int,
    mode: NormalizationMode,
) -> tuple[np.ndarray, np.ndarray]:
    rows, cols = raw.shape
    shifted_rows = rows - 2 * derivative_points
    window_length = shifted_rows - max_delay
    if window_length < 0:
        raise ValueError("Window length became negative after max(delay) trim.")

    shifted = np.full((shifted_rows, cols), np.nan, dtype=float)
    trimmed_derivative = np.full((cols, window_length), np.nan, dtype=float)
    for col in range(cols):
        shifted[:, col] = raw[derivative_points : derivative_points + shifted_rows, col]
        if mode == "raw":
            trimmed_derivative[col, :] = derivative[
                col, max_delay : max_delay + window_length
            ]
        elif mode == "minmax":
            valid = shifted[:, col][~np.isnan(shifted[:, col])]
            if valid.size == 0:
                continue
            min_value = float(np.min(valid))
            max_value = float(np.max(valid))
            scale = max_value - min_value
            if not math.isfinite(scale) or scale == 0.0:
                continue
            shifted[:, col] = (shifted[:, col] - min_value) / scale
            trimmed_derivative[col, :] = (
                derivative[col, max_delay : max_delay + window_length] / scale
            )
        elif mode == "zscore":
            valid = shifted[:, col][~np.isnan(shifted[:, col])]
            if valid.size < 2:
                continue
            mean = float(np.mean(valid))
            std = float(np.std(valid, ddof=1))
            if not math.isfinite(std) or std == 0.0:
                continue
            shifted[:, col] = (shifted[:, col] - mean) / std
            trimmed_derivative[col, :] = (
                derivative[col, max_delay : max_delay + window_length] / std
            )
        else:
            raise ValueError(f"Unknown normalization mode {mode!r}.")
    return shifted, trimmed_derivative


def _solve_group_block(
    prepared: _PreparedWindow,
    channels: Sequence[int],
    model_terms: Sequence[Sequence[int]],
    window_length: int,
) -> _SolvedBlock:
    total_points = len(channels) * window_length
    feature_count = len(model_terms)
    if total_points == 0:
        return _SolvedBlock.nan(feature_count)
    design_rows: list[list[float]] = []
    target: list[float] = []
    for channel in channels:
        for sample in range(window_length):
            target_value = prepared.derivative[channel, sample]
            if np.isnan(target_value):
                continue
            row_values = [
                _evaluate_term(
                    prepared.shifted, channel, sample, prepared.max_delay, term
                )
                for term in model_terms
            ]
            if any(np.isnan(value) for value in row_values):
                continue
            design_rows.append(row_values)
            target.append(float(target_value))
    if len(design_rows) / total_points < 0.60:
        return _SolvedBlock.nan(feature_count)
    return _solve_least_squares(
        np.asarray(design_rows), np.asarray(target), np.asarray(target)
    )


def _solve_directed_pair(
    prepared: _PreparedWindow,
    primary_channel: int,
    secondary_channel: int,
    response_channel: int,
    primary_terms: Sequence[Sequence[int]],
    secondary_terms: Sequence[Sequence[int]],
    window_length: int,
) -> _SolvedBlock:
    feature_count = len(primary_terms) + len(secondary_terms)
    design_rows: list[list[float]] = []
    fit_target: list[float] = []
    residual_target: list[float] = []
    for sample in range(window_length):
        fit_value = prepared.derivative[primary_channel, sample]
        if np.isnan(fit_value):
            continue
        row_values = [
            _evaluate_term(
                prepared.shifted, secondary_channel, sample, prepared.max_delay, term
            )
            for term in secondary_terms
        ]
        if any(np.isnan(value) for value in row_values):
            continue
        primary_values = [
            _evaluate_term(
                prepared.shifted, primary_channel, sample, prepared.max_delay, term
            )
            for term in primary_terms
        ]
        if any(np.isnan(value) for value in primary_values):
            continue
        design_rows.append(row_values + primary_values)
        fit_target.append(float(fit_value))
        residual_target.append(float(prepared.derivative[response_channel, sample]))
    if len(design_rows) / window_length < 0.60:
        return _SolvedBlock.nan(feature_count)
    return _solve_least_squares(
        np.asarray(design_rows),
        np.asarray(fit_target),
        np.asarray(residual_target),
    )


def _solve_least_squares(
    design: np.ndarray,
    fit_target: np.ndarray,
    residual_target: np.ndarray,
) -> _SolvedBlock:
    if design.size == 0 or design.shape[0] == 0 or design.shape[1] == 0:
        cols = design.shape[1] if design.ndim == 2 else 0
        return _SolvedBlock.nan(cols)
    try:
        u, singular_values, vt = np.linalg.svd(design, full_matrices=False)
    except np.linalg.LinAlgError:
        return _SolvedBlock.nan(design.shape[1])
    sigma_max = float(np.max(singular_values)) if singular_values.size else 0.0
    tolerance = max(design.shape) * np.finfo(float).eps * max(sigma_max, 1.0)
    projected = u.T @ fit_target
    scaled = np.zeros_like(projected)
    keep = singular_values > tolerance
    scaled[keep] = projected[keep] / singular_values[keep]
    coefficients = vt.T @ scaled
    prediction = design @ coefficients
    residual = residual_target - prediction
    rmse = float(np.sqrt(np.sum(residual * residual) / design.shape[0]))
    return _SolvedBlock(coefficients=coefficients, rmse=rmse)


def _evaluate_term(
    shifted: np.ndarray,
    channel: int,
    sample: int,
    max_delay: int,
    delays: Sequence[int],
) -> float:
    product = 1.0
    for delay in delays:
        shifted_row = sample + max(max_delay - delay, 0)
        value = shifted[shifted_row, channel]
        if np.isnan(value):
            return float("nan")
        product *= float(value)
    return product


def _compute_de_value(
    channels: Sequence[int],
    st_blocks: Sequence[_SolvedBlock | None],
    ct_rmse: float,
) -> float:
    if not channels or np.isnan(ct_rmse) or ct_rmse == 0.0:
        return float("nan")
    baseline = 0.0
    for channel in channels:
        block = st_blocks[channel] if channel < len(st_blocks) else None
        baseline += block.rmse if block is not None else float("nan")
    baseline /= len(channels)
    if np.isnan(baseline):
        return float("nan")
    return abs(baseline / ct_rmse - 1.0)


def _causal_improvement(baseline_rmse: float, causal_rmse: float) -> float:
    if np.isnan(baseline_rmse) or np.isnan(causal_rmse):
        return float("nan")
    return baseline_rmse - causal_rmse


def _synchronization_value(forward_rmse: float, reverse_rmse: float) -> float:
    if np.isnan(forward_rmse) or np.isnan(reverse_rmse):
        return float("nan")
    if forward_rmse == 0.0 or reverse_rmse == 0.0:
        return float("nan")
    return reverse_rmse / forward_rmse - forward_rmse / reverse_rmse


def _labels_for_channels(labels: Sequence[str], channels: Sequence[int]) -> list[str]:
    return [
        labels[channel] if channel < len(labels) else f"Ch {channel}"
        for channel in channels
    ]


def _labels_for_groups(
    labels: Sequence[str], groups: Sequence[Sequence[int]], joiner: str
) -> list[str]:
    return [joiner.join(_labels_for_channels(labels, group)) for group in groups]


def _labels_for_pairs(
    labels: Sequence[str], pairs: Sequence[tuple[int, int]], joiner: str
) -> list[str]:
    rendered: list[str] = []
    for left, right in pairs:
        left_label = labels[left] if left < len(labels) else f"Ch {left}"
        right_label = labels[right] if right < len(labels) else f"Ch {right}"
        rendered.append(f"{left_label}{joiner}{right_label}")
    return rendered
