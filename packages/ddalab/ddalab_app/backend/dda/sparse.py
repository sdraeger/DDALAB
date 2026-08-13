from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Sequence

import numpy as np

from .scalar import (
    ScalarRegressionMode,
    WeakQuadratureRule,
    _as_1d_float_array,
    _fit_scalar_regression,
    _integrate_feature_window,
    _normalize_quadrature_rule,
    _normalize_scalar_delays,
    _resolve_dt,
    _resolve_sample_count,
    default_integration_window,
)


@dataclass(slots=True)
class SparseAdditiveDesignMatrix:
    design: np.ndarray
    target: np.ndarray
    window_starts: np.ndarray
    integration_window: int
    stride: int
    term_names: list[str]
    delay_slices: dict[int, slice]
    transformers: dict[int, object]
    trajectory_ids: np.ndarray | None = None


@dataclass(slots=True)
class SparseAdditiveStabilityResult:
    selection_frequency: dict[int, float]
    mean_strength: dict[int, float]
    strength_std: dict[int, float]
    null_selection_frequency: dict[int, float] | None = None
    calibrated_threshold: float = 0.0
    calibrated_selected_delays: list[int] | None = None


@dataclass(slots=True)
class GroupLassoResult:
    coefficients: np.ndarray
    group_strengths: dict[int, float]
    selected_groups: list[int]
    n_iter: int
    objective_history: list[float]
    converged: bool
    final_objective: float


class SparseAdditiveWeakFormDDA:
    """Scalar weak-form DDA with spline main effects over candidate delays."""

    def __init__(
        self,
        *,
        candidate_delays: Sequence[int],
        n_knots: int = 8,
        spline_degree: int = 3,
        integration_window: int | None = None,
        integration_window_seconds: float | None = None,
        stride: int | None = None,
        stride_seconds: float | None = None,
        quadrature: WeakQuadratureRule = "trapezoid",
        regression: ScalarRegressionMode = "ridge",
        ridge_alpha: float = 1e-6,
        standardize_features: bool = True,
        sparsity: Literal["none"] = "none",
        group_threshold: float | None = None,
        group_lasso_alpha: float = 1e-3,
        max_iter: int = 1000,
        tol: float = 1e-6,
        thin_delays: bool = False,
        max_delay_correlation: float = 0.95,
        min_delay_spacing: int | None = None,
        delay_preference: Literal["small_delay", "acf_peaks"] = "small_delay",
        effect_grid_size: int = 100,
    ) -> None:
        self.original_candidate_delays = tuple(int(delay) for delay in candidate_delays)
        self.candidate_delays = self.original_candidate_delays
        self.n_knots = int(n_knots)
        self.spline_degree = int(spline_degree)
        self.integration_window = integration_window
        self.integration_window_seconds = integration_window_seconds
        self.stride = stride
        self.stride_seconds = stride_seconds
        self.quadrature = quadrature
        self.regression = regression
        self.ridge_alpha = float(ridge_alpha)
        self.standardize_features = bool(standardize_features)
        self.sparsity = sparsity
        self.group_threshold = group_threshold
        self.group_lasso_alpha = float(group_lasso_alpha)
        self.max_iter = int(max_iter)
        self.tol = float(tol)
        self.thin_delays = bool(thin_delays)
        self.max_delay_correlation = float(max_delay_correlation)
        self.min_delay_spacing = min_delay_spacing
        self.delay_preference = delay_preference
        self.effect_grid_size = int(effect_grid_size)
        if self.sparsity != "none":
            raise ValueError(
                "SparseAdditiveWeakFormDDA currently supports sparsity='none' only."
            )

    def fit(
        self,
        x: Sequence[float] | Sequence[Sequence[float]],
        *,
        dt: float | None = None,
        sample_rate: float | None = None,
    ) -> "SparseAdditiveWeakFormDDA":
        trajectories = _as_trajectory_list(x)
        candidate_delays = self.original_candidate_delays
        if self.thin_delays:
            candidate_delays = tuple(
                thin_candidate_delays_by_collinearity(
                    trajectories,
                    candidate_delays,
                    max_block_correlation=self.max_delay_correlation,
                    min_spacing=self.min_delay_spacing,
                    prefer=self.delay_preference,
                )
            )
        design = build_sparse_additive_weak_form_design_matrix_for_trajectories(
            trajectories,
            dt=dt,
            sample_rate=sample_rate,
            candidate_delays=candidate_delays,
            n_knots=self.n_knots,
            spline_degree=self.spline_degree,
            integration_window=self.integration_window,
            integration_window_seconds=self.integration_window_seconds,
            stride=self.stride,
            stride_seconds=self.stride_seconds,
            quadrature=self.quadrature,
        )
        keep = np.isfinite(design.target) & np.all(np.isfinite(design.design), axis=1)
        if not np.any(keep):
            raise ValueError(
                "No finite sparse-additive weak-form rows are available for fitting."
            )
        if self.regression == "group_lasso":
            group_result = fit_group_lasso(
                design.design[keep, :],
                design.target[keep],
                groups=design.delay_slices,
                alpha=self.group_lasso_alpha,
                ridge_alpha=self.ridge_alpha,
                standardize_features=self.standardize_features,
                max_iter=self.max_iter,
                tol=self.tol,
            )
            coefficients = group_result.coefficients
            convergence = {
                "n_iter": group_result.n_iter,
                "objective_history": group_result.objective_history,
                "converged": group_result.converged,
                "final_objective": group_result.final_objective,
            }
            selected_from_solver = group_result.selected_groups
        else:
            coefficients = _fit_scalar_regression(
                design.design[keep, :],
                design.target[keep],
                regression=self.regression,
                ridge_alpha=self.ridge_alpha,
                standardize_features=self.standardize_features,
            )
            convergence = {
                "n_iter": 1,
                "objective_history": [],
                "converged": True,
                "final_objective": float(
                    0.5
                    * np.sum(
                        (design.target[keep] - design.design[keep, :] @ coefficients)
                        ** 2
                    )
                ),
            }
            selected_from_solver = None
        prediction = design.design[keep, :] @ coefficients
        residuals = design.target[keep] - prediction
        self.coefficients_ = coefficients[1:]
        self.intercept_ = float(coefficients[0])
        self.full_coefficients_ = coefficients
        self.original_candidate_delays_ = self.original_candidate_delays
        self.candidate_delays_ = tuple(candidate_delays)
        self.candidate_delays = self.candidate_delays_
        self.term_names_ = design.term_names
        self.delay_slices_ = design.delay_slices
        self.transformers_ = design.transformers
        self.design_matrix_ = design.design[keep, :]
        self.target_ = design.target[keep]
        self.window_starts_ = design.window_starts[keep]
        self.trajectory_ids_ = (
            design.trajectory_ids[keep] if design.trajectory_ids is not None else None
        )
        self.integration_window_ = design.integration_window
        self.stride_ = design.stride
        self.prediction_ = prediction
        self.residuals_ = residuals
        self.rmse_ = float(np.sqrt(np.mean(residuals * residuals)))
        self.delay_strengths_ = self._delay_strengths()
        self.group_strengths_ = dict(self.delay_strengths_)
        self.convergence_ = convergence
        self.selected_delays_ = (
            list(selected_from_solver)
            if selected_from_solver is not None and self.group_threshold is None
            else self._selected_delays()
        )
        self.effect_curves_ = self._effect_curves()
        self.delay_block_correlation_ = compute_delay_block_correlation(
            self.design_matrix_, self.delay_slices_
        )
        self.delay_block_condition_numbers_ = compute_delay_block_condition_numbers(
            self.design_matrix_, self.delay_slices_
        )
        self.state_coverage_ = compute_state_coverage(
            trajectories, self.candidate_delays_, self.transformers_
        )
        return self

    def _delay_strengths(self) -> dict[int, float]:
        strengths: dict[int, float] = {}
        for delay, feature_slice in self.delay_slices_.items():
            local = self.full_coefficients_[feature_slice]
            strengths[delay] = float(np.linalg.norm(local))
        return strengths

    def _selected_delays(self) -> list[int]:
        if self.group_threshold is None:
            return [
                delay
                for delay, strength in self.delay_strengths_.items()
                if strength > 0.0
            ]
        return [
            delay
            for delay, strength in self.delay_strengths_.items()
            if strength >= float(self.group_threshold)
        ]

    def _effect_curves(self) -> dict[int, tuple[np.ndarray, np.ndarray]]:
        curves: dict[int, tuple[np.ndarray, np.ndarray]] = {}
        for delay, transformer in self.transformers_.items():
            x_min, x_max = _transformer_range(transformer)
            if not math.isfinite(x_min) or not math.isfinite(x_max) or x_min == x_max:
                x_min, x_max = -1.0, 1.0
            grid = np.linspace(x_min, x_max, max(self.effect_grid_size, 2))
            curves[delay] = (grid, self.evaluate_effect(delay, grid))
        return curves

    def evaluate_effect(self, delay: int, values: Sequence[float]) -> np.ndarray:
        delay = int(delay)
        if delay not in self.delay_slices_:
            raise KeyError(f"Delay {delay} was not fit.")
        basis = self.transformers_[delay].transform(
            np.asarray(values, dtype=float).reshape(-1, 1)
        )
        coefficients = self.full_coefficients_[self.delay_slices_[delay]]
        return np.asarray(basis @ coefficients, dtype=float)

    def predict_increment(
        self,
        x: Sequence[float],
        *,
        dt: float | None = None,
        sample_rate: float | None = None,
    ) -> np.ndarray:
        design = build_sparse_additive_weak_form_design_matrix(
            x,
            dt=dt,
            sample_rate=sample_rate,
            candidate_delays=self.candidate_delays_,
            n_knots=self.n_knots,
            spline_degree=self.spline_degree,
            integration_window=self.integration_window_,
            stride=self.stride_,
            quadrature=self.quadrature,
            transformers=self.transformers_,
        )
        return np.asarray(design.design @ self.full_coefficients_, dtype=float)

    def score_interval_prediction(
        self,
        x: Sequence[float],
        *,
        dt: float | None = None,
        sample_rate: float | None = None,
    ) -> float:
        design = build_sparse_additive_weak_form_design_matrix(
            x,
            dt=dt,
            sample_rate=sample_rate,
            candidate_delays=self.candidate_delays_,
            n_knots=self.n_knots,
            spline_degree=self.spline_degree,
            integration_window=self.integration_window_,
            stride=self.stride_,
            quadrature=self.quadrature,
            transformers=self.transformers_,
        )
        residual = design.target - design.design @ self.full_coefficients_
        return float(np.mean(residual * residual))

    def plot_effect(self, delay: int):
        import matplotlib.pyplot as plt

        delay = int(delay)
        if delay not in self.effect_curves_:
            raise KeyError(f"Delay {delay} was not fit.")
        grid, values = self.effect_curves_[delay]
        fig, ax = plt.subplots()
        ax.plot(grid, values)
        ax.set_xlabel(f"x(t-{delay})" if delay else "x(t)")
        ax.set_ylabel(f"f_{delay}(x)")
        return fig, ax


def build_sparse_additive_weak_form_design_matrix(
    x: Sequence[float],
    *,
    dt: float | None = None,
    sample_rate: float | None = None,
    candidate_delays: Sequence[int],
    n_knots: int = 8,
    spline_degree: int = 3,
    integration_window: int | None = None,
    integration_window_seconds: float | None = None,
    stride: int | None = None,
    stride_seconds: float | None = None,
    quadrature: WeakQuadratureRule = "trapezoid",
    transformers: dict[int, object] | None = None,
) -> SparseAdditiveDesignMatrix:
    series = _as_1d_float_array(x)
    resolved_dt = _resolve_dt(dt=dt, sample_rate=sample_rate)
    delays = _normalize_scalar_delays(candidate_delays)
    max_delay = max(delays)
    window = _resolve_sample_count(
        samples=integration_window,
        seconds=integration_window_seconds,
        dt=resolved_dt,
        name="integration_window",
        default=default_integration_window(delays),
    )
    stride_samples = _resolve_sample_count(
        samples=stride,
        seconds=stride_seconds,
        dt=resolved_dt,
        name="stride",
        default=1,
    )
    if series.size <= max_delay + window:
        raise ValueError("Need at least max(delay) + integration_window + 1 samples.")
    quadrature_rule = _normalize_quadrature_rule(quadrature)
    point_indices = np.arange(max_delay, series.size, dtype=int)
    fitted_transformers: dict[int, object] = {}
    pointwise_blocks: dict[int, np.ndarray] = {}
    for delay in delays:
        values = series[point_indices - delay].reshape(-1, 1)
        transformer = transformers.get(delay) if transformers is not None else None
        if transformer is None:
            transformer = _fit_spline_transformer(
                values, n_knots=n_knots, spline_degree=spline_degree
            )
        fitted_transformers[delay] = transformer
        pointwise_blocks[delay] = np.asarray(transformer.transform(values), dtype=float)

    starts = np.arange(max_delay, series.size - window, stride_samples, dtype=int)
    n_features = 1 + sum(block.shape[1] for block in pointwise_blocks.values())
    design = np.empty((starts.size, n_features), dtype=float)
    target = np.empty(starts.size, dtype=float)
    term_names = ["intercept"]
    delay_slices: dict[int, slice] = {}
    cursor = 1
    for delay in delays:
        width = pointwise_blocks[delay].shape[1]
        delay_slices[delay] = slice(cursor, cursor + width)
        term_names.extend(
            [f"spline(delay={delay}, basis={idx})" for idx in range(width)]
        )
        cursor += width
    for row_idx, start_idx in enumerate(starts):
        pointwise_start = start_idx - max_delay
        design[row_idx, 0] = window * resolved_dt
        for delay in delays:
            basis_window = pointwise_blocks[delay][
                pointwise_start : pointwise_start + window + 1, :
            ]
            design[row_idx, delay_slices[delay]] = _integrate_feature_window(
                basis_window,
                dt=resolved_dt,
                quadrature=quadrature_rule,
            )
        target[row_idx] = float(series[start_idx + window] - series[start_idx])
    return SparseAdditiveDesignMatrix(
        design=design,
        target=target,
        window_starts=starts,
        integration_window=window,
        stride=stride_samples,
        term_names=term_names,
        delay_slices=delay_slices,
        transformers=fitted_transformers,
        trajectory_ids=np.zeros(starts.size, dtype=int),
    )


def build_sparse_additive_weak_form_design_matrix_for_trajectories(
    trajectories: Sequence[Sequence[float]],
    *,
    dt: float | None = None,
    sample_rate: float | None = None,
    candidate_delays: Sequence[int],
    n_knots: int = 8,
    spline_degree: int = 3,
    integration_window: int | None = None,
    integration_window_seconds: float | None = None,
    stride: int | None = None,
    stride_seconds: float | None = None,
    quadrature: WeakQuadratureRule = "trapezoid",
) -> SparseAdditiveDesignMatrix:
    series_list = _as_trajectory_list(trajectories)
    delays = _normalize_scalar_delays(candidate_delays)
    max_delay = max(delays)
    all_values: dict[int, list[np.ndarray]] = {delay: [] for delay in delays}
    for series in series_list:
        if series.size <= max_delay:
            continue
        point_indices = np.arange(max_delay, series.size, dtype=int)
        for delay in delays:
            all_values[delay].append(series[point_indices - delay].reshape(-1, 1))
    transformers: dict[int, object] = {}
    for delay in delays:
        if not all_values[delay]:
            raise ValueError(
                "Need at least one trajectory long enough for all candidate delays."
            )
        transformers[delay] = _fit_spline_transformer(
            np.vstack(all_values[delay]),
            n_knots=n_knots,
            spline_degree=spline_degree,
        )

    designs: list[SparseAdditiveDesignMatrix] = []
    trajectory_ids: list[np.ndarray] = []
    for trajectory_idx, series in enumerate(series_list):
        design = build_sparse_additive_weak_form_design_matrix(
            series,
            dt=dt,
            sample_rate=sample_rate,
            candidate_delays=delays,
            n_knots=n_knots,
            spline_degree=spline_degree,
            integration_window=integration_window,
            integration_window_seconds=integration_window_seconds,
            stride=stride,
            stride_seconds=stride_seconds,
            quadrature=quadrature,
            transformers=transformers,
        )
        designs.append(design)
        trajectory_ids.append(
            np.full(design.design.shape[0], trajectory_idx, dtype=int)
        )
    if not designs:
        raise ValueError("No sparse-additive weak-form rows are available for fitting.")
    first = designs[0]
    return SparseAdditiveDesignMatrix(
        design=np.vstack([item.design for item in designs]),
        target=np.concatenate([item.target for item in designs]),
        window_starts=np.concatenate([item.window_starts for item in designs]),
        integration_window=first.integration_window,
        stride=first.stride,
        term_names=first.term_names,
        delay_slices=first.delay_slices,
        transformers=transformers,
        trajectory_ids=np.concatenate(trajectory_ids),
    )


def compute_delay_block_correlation(
    A: np.ndarray, groups: dict[int, slice]
) -> np.ndarray:
    """Return Frobenius-normalized cross-Gram magnitudes between delay blocks."""

    design = np.asarray(A, dtype=float)
    delays = list(groups)
    matrix = np.eye(len(delays), dtype=float)
    centered_blocks: dict[int, np.ndarray] = {}
    norms: dict[int, float] = {}
    for delay in delays:
        block = design[:, groups[delay]]
        centered = block - np.mean(block, axis=0, keepdims=True)
        centered_blocks[delay] = centered
        norms[delay] = float(np.linalg.norm(centered, ord="fro"))
    for row, left in enumerate(delays):
        for col, right in enumerate(delays):
            if row == col:
                continue
            denom = norms[left] * norms[right]
            if denom <= 0.0:
                matrix[row, col] = 0.0
            else:
                cross = centered_blocks[left].T @ centered_blocks[right]
                matrix[row, col] = float(np.linalg.norm(cross, ord="fro") / denom)
    return matrix


def compute_delay_block_condition_numbers(
    A: np.ndarray, groups: dict[int, slice]
) -> dict[int | str, float]:
    """Return per-delay block condition numbers plus a global design condition number."""

    design = np.asarray(A, dtype=float)
    values: dict[int | str, float] = {"global": _safe_condition_number(design)}
    for delay, feature_slice in groups.items():
        values[int(delay)] = _safe_condition_number(design[:, feature_slice])
    return values


def compute_state_coverage(
    x: Sequence[float] | Sequence[Sequence[float]],
    candidate_delays: Sequence[int],
    spline_transformers: dict[int, object],
    *,
    activation_threshold: float = 1e-6,
) -> dict[int, dict[str, float]]:
    """Summarize delayed-state coverage for fitted sparse-additive spline bases."""

    trajectories = _as_trajectory_list(x)
    delays = _normalize_scalar_delays(candidate_delays)
    max_delay = max(delays)
    coverage: dict[int, dict[str, float]] = {}
    for delay in delays:
        values: list[np.ndarray] = []
        for series in trajectories:
            if series.size <= max_delay:
                continue
            point_indices = np.arange(max_delay, series.size, dtype=int)
            values.append(series[point_indices - delay])
        if not values:
            coverage[delay] = {
                "min": float("nan"),
                "max": float("nan"),
                "occupied_basis_count": 0.0,
                "basis_activation_fraction": 0.0,
                "effective_samples_per_basis": 0.0,
            }
            continue
        delayed = np.concatenate(values)
        basis = np.asarray(
            spline_transformers[int(delay)].transform(delayed.reshape(-1, 1)),
            dtype=float,
        )
        activation = np.sum(np.abs(basis), axis=0)
        active = activation > float(activation_threshold)
        occupied = int(np.sum(active))
        coverage[delay] = {
            "min": float(np.min(delayed)),
            "max": float(np.max(delayed)),
            "occupied_basis_count": float(occupied),
            "basis_activation_fraction": float(occupied / basis.shape[1])
            if basis.shape[1]
            else 0.0,
            "effective_samples_per_basis": float(delayed.size / max(occupied, 1)),
        }
    return coverage


def thin_candidate_delays_by_collinearity(
    x: Sequence[float] | Sequence[Sequence[float]],
    candidate_delays: Sequence[int],
    *,
    max_block_correlation: float = 0.95,
    min_spacing: int | None = None,
    prefer: Literal["small_delay", "acf_peaks"] = "small_delay",
) -> list[int]:
    """Greedily remove delayed scalar copies that are nearly redundant."""

    trajectories = _as_trajectory_list(x)
    delays = _normalize_scalar_delays(candidate_delays)
    max_delay = max(delays)
    delayed_series: dict[int, np.ndarray] = {}
    for delay in delays:
        pieces: list[np.ndarray] = []
        for series in trajectories:
            if series.size <= max_delay:
                continue
            point_indices = np.arange(max_delay, series.size, dtype=int)
            pieces.append(series[point_indices - delay])
        if pieces:
            delayed_series[delay] = np.concatenate(pieces)
    if not delayed_series:
        return list(delays)

    if prefer == "acf_peaks":
        current = delayed_series.get(0)
        if current is None:
            current = next(iter(delayed_series.values()))
        scores = {
            delay: abs(_safe_scalar_correlation(current, values))
            for delay, values in delayed_series.items()
        }
        ordered = sorted(
            delays, key=lambda delay: (delay != 0, -scores.get(delay, 0.0), delay)
        )
    elif prefer == "small_delay":
        ordered = sorted(delays)
        if 0 in ordered:
            ordered = [0] + [delay for delay in ordered if delay != 0]
    else:
        raise ValueError("prefer must be 'small_delay' or 'acf_peaks'.")

    kept: list[int] = []
    for delay in ordered:
        if delay not in delayed_series:
            continue
        if min_spacing is not None and any(
            abs(delay - existing) < int(min_spacing) for existing in kept
        ):
            continue
        redundant = False
        for existing in kept:
            if existing == 0 and delay != 0:
                continue
            corr = abs(
                _safe_scalar_correlation(
                    delayed_series[delay], delayed_series[existing]
                )
            )
            if corr >= float(max_block_correlation):
                redundant = True
                break
        if not redundant:
            kept.append(delay)
    return kept


def stability_select_sparse_additive_weak_form(
    x: Sequence[float] | Sequence[Sequence[float]],
    *,
    dt: float | None = None,
    sample_rate: float | None = None,
    candidate_delays: Sequence[int],
    integration_window: int | None = None,
    n_repeats: int = 20,
    null_repeats: int = 0,
    block_fraction: float = 0.80,
    random_state: int = 0,
    group_threshold: float | None = None,
    calibrate: bool = False,
    calibration_margin: float = 0.05,
    calibration_quantile: float | None = None,
    **model_kwargs,
) -> SparseAdditiveStabilityResult:
    trajectories = _as_trajectory_list(x)
    rng = np.random.default_rng(random_state)
    strengths: dict[int, list[float]] = {int(delay): [] for delay in candidate_delays}
    selected: dict[int, list[float]] = {int(delay): [] for delay in candidate_delays}
    for _ in range(int(n_repeats)):
        block = _sample_contiguous_block(
            trajectories, candidate_delays, block_fraction=block_fraction, rng=rng
        )
        model = SparseAdditiveWeakFormDDA(
            candidate_delays=candidate_delays,
            integration_window=integration_window,
            group_threshold=group_threshold,
            **model_kwargs,
        )
        model.fit(block, dt=dt, sample_rate=sample_rate)
        for delay in strengths:
            strength = model.delay_strengths_.get(delay, 0.0)
            strengths[delay].append(strength)
            selected[delay].append(1.0 if delay in model.selected_delays_ else 0.0)
    null_selected: dict[int, list[float]] = {
        int(delay): [] for delay in candidate_delays
    }
    for _ in range(int(null_repeats)):
        block = _sample_contiguous_block(
            trajectories, candidate_delays, block_fraction=block_fraction, rng=rng
        )
        null_block = np.asarray(block, dtype=float).copy()
        rng.shuffle(null_block)
        model = SparseAdditiveWeakFormDDA(
            candidate_delays=candidate_delays,
            integration_window=integration_window,
            group_threshold=group_threshold,
            **model_kwargs,
        )
        model.fit(null_block, dt=dt, sample_rate=sample_rate)
        for delay in null_selected:
            null_selected[delay].append(1.0 if delay in model.selected_delays_ else 0.0)
    selection_frequency = {
        delay: float(np.mean(values)) for delay, values in selected.items()
    }
    null_frequency = {
        delay: float(np.mean(values)) if values else 0.0
        for delay, values in null_selected.items()
    }
    if calibrate:
        null_values = np.asarray(list(null_frequency.values()), dtype=float)
        if calibration_quantile is not None and null_values.size:
            threshold = float(
                np.quantile(null_values, float(calibration_quantile))
            ) + float(calibration_margin)
        else:
            threshold = (
                float(np.max(null_values)) if null_values.size else 0.0
            ) + float(calibration_margin)
        threshold = min(max(threshold, 0.0), 1.0)
    else:
        threshold = 0.0
    calibrated = [
        delay
        for delay, value in selection_frequency.items()
        if calibrate and value >= threshold
    ]
    return SparseAdditiveStabilityResult(
        selection_frequency=selection_frequency,
        mean_strength={
            delay: float(np.mean(values)) for delay, values in strengths.items()
        },
        strength_std={
            delay: float(np.std(values, ddof=1)) if len(values) > 1 else 0.0
            for delay, values in strengths.items()
        },
        null_selection_frequency=null_frequency,
        calibrated_threshold=threshold,
        calibrated_selected_delays=calibrated,
    )


def _sample_contiguous_block(
    trajectories: Sequence[np.ndarray],
    candidate_delays: Sequence[int],
    *,
    block_fraction: float,
    rng: np.random.Generator,
) -> np.ndarray:
    min_len = max(candidate_delays) + 10
    eligible = [series for series in trajectories if series.size >= min_len]
    if not eligible:
        raise ValueError("No trajectory is long enough for stability selection.")
    series = eligible[int(rng.integers(0, len(eligible)))]
    block_len = max(int(round(series.size * float(block_fraction))), min_len)
    block_len = min(block_len, series.size)
    start = int(rng.integers(0, max(series.size - block_len + 1, 1)))
    return np.asarray(series[start : start + block_len], dtype=float)


def fit_group_lasso(
    design: np.ndarray,
    target: np.ndarray,
    *,
    groups: dict[int, slice],
    alpha: float,
    ridge_alpha: float = 1e-6,
    standardize_features: bool = True,
    max_iter: int = 1000,
    tol: float = 1e-6,
) -> GroupLassoResult:
    """Fit an unpenalized-intercept group lasso by deterministic FISTA."""

    if design.ndim != 2 or target.ndim != 1:
        raise ValueError("Group lasso expects a 2D design and 1D target.")
    if design.shape[0] != target.shape[0]:
        raise ValueError("Group lasso design and target row counts do not match.")
    if design.shape[1] < 2:
        raise ValueError(
            "Group lasso expects an intercept and at least one penalized feature."
        )
    alpha = float(alpha)
    ridge_alpha = float(ridge_alpha)
    if alpha < 0.0 or ridge_alpha < 0.0:
        raise ValueError("group lasso and ridge penalties must be non-negative.")

    X = np.asarray(design, dtype=float)
    y = np.asarray(target, dtype=float)
    feature_scale = np.ones(X.shape[1], dtype=float)
    if standardize_features:
        feature_scale[1:] = np.std(X[:, 1:], axis=0, ddof=0)
        feature_scale[~np.isfinite(feature_scale) | (feature_scale == 0.0)] = 1.0
        X = X / feature_scale

    beta = np.zeros(X.shape[1], dtype=float)
    intercept_col = X[:, 0]
    denom = float(np.dot(intercept_col, intercept_col))
    if denom > 0.0:
        beta[0] = float(np.dot(intercept_col, y) / denom)
    z = beta.copy()
    momentum = 1.0
    spectral = float(np.linalg.norm(X, ord=2) ** 2) if X.size else 1.0
    step = 1.0 / max(spectral + ridge_alpha, 1e-12)
    history: list[float] = []
    converged = False
    previous = math.inf
    max_iter = max(int(max_iter), 1)
    tol = max(float(tol), 0.0)
    penalized_slices = {
        int(delay): feature_slice for delay, feature_slice in groups.items()
    }

    for iteration in range(1, max_iter + 1):
        residual = X @ z - y
        gradient = X.T @ residual
        gradient[1:] += ridge_alpha * z[1:]
        candidate = z - step * gradient
        next_beta = candidate.copy()
        for feature_slice in penalized_slices.values():
            block = candidate[feature_slice]
            norm = float(np.linalg.norm(block))
            threshold = alpha * step
            if norm <= threshold:
                next_beta[feature_slice] = 0.0
            else:
                next_beta[feature_slice] = (1.0 - threshold / norm) * block
        next_momentum = 0.5 * (1.0 + math.sqrt(1.0 + 4.0 * momentum * momentum))
        z = next_beta + ((momentum - 1.0) / next_momentum) * (next_beta - beta)
        beta = next_beta
        momentum = next_momentum
        objective = _group_lasso_objective(
            X, y, beta, penalized_slices, alpha=alpha, ridge_alpha=ridge_alpha
        )
        history.append(objective)
        if math.isfinite(previous):
            rel_change = abs(previous - objective) / max(abs(previous), 1.0)
            if rel_change <= tol:
                converged = True
                break
        previous = objective

    coefficients = beta / feature_scale
    group_strengths = {
        delay: float(np.linalg.norm(coefficients[feature_slice]))
        for delay, feature_slice in penalized_slices.items()
    }
    selected = [delay for delay, strength in group_strengths.items() if strength > 1e-8]
    return GroupLassoResult(
        coefficients=np.asarray(coefficients, dtype=float),
        group_strengths=group_strengths,
        selected_groups=selected,
        n_iter=len(history),
        objective_history=history,
        converged=converged,
        final_objective=history[-1] if history else float("nan"),
    )


def _group_lasso_objective(
    design: np.ndarray,
    target: np.ndarray,
    coefficients: np.ndarray,
    groups: dict[int, slice],
    *,
    alpha: float,
    ridge_alpha: float,
) -> float:
    residual = target - design @ coefficients
    penalty = sum(
        float(np.linalg.norm(coefficients[feature_slice]))
        for feature_slice in groups.values()
    )
    ridge = float(np.dot(coefficients[1:], coefficients[1:]))
    return float(
        0.5 * np.dot(residual, residual)
        + float(alpha) * penalty
        + 0.5 * float(ridge_alpha) * ridge
    )


def _fit_spline_transformer(
    values: np.ndarray,
    *,
    n_knots: int,
    spline_degree: int,
) -> object:
    try:
        from sklearn.preprocessing import SplineTransformer
    except Exception as exc:  # pragma: no cover - depends on optional sklearn install.
        raise RuntimeError(
            "SparseAdditiveWeakFormDDA requires scikit-learn's SplineTransformer."
        ) from exc
    n_knots = max(int(n_knots), 2)
    spline_degree = max(int(spline_degree), 1)
    transformer = SplineTransformer(
        n_knots=n_knots,
        degree=spline_degree,
        include_bias=False,
        extrapolation="constant",
    )
    transformer.fit(values)
    return transformer


def _transformer_range(transformer: object) -> tuple[float, float]:
    knots = getattr(transformer, "bsplines_", None)
    if not knots:
        return -1.0, 1.0
    knot_vector = np.asarray(knots[0].t, dtype=float)
    degree = int(getattr(knots[0], "k", 0))
    if knot_vector.size <= 2 * degree:
        return float(np.min(knot_vector)), float(np.max(knot_vector))
    interior = knot_vector[degree : knot_vector.size - degree]
    return float(np.min(interior)), float(np.max(interior))


def _as_trajectory_list(
    x: Sequence[float] | Sequence[Sequence[float]],
) -> list[np.ndarray]:
    if isinstance(x, np.ndarray):
        if x.ndim == 1:
            return [_as_1d_float_array(x)]
        if x.ndim == 2:
            return [_as_1d_float_array(row) for row in x]
    try:
        arr = np.asarray(x, dtype=float)
        if arr.ndim == 1:
            return [_as_1d_float_array(arr)]
        if arr.ndim == 2:
            return [_as_1d_float_array(row) for row in arr]
    except (TypeError, ValueError):
        pass
    trajectories = [_as_1d_float_array(item) for item in x]  # type: ignore[arg-type]
    if not trajectories:
        raise ValueError("At least one trajectory is required.")
    return trajectories


def _safe_condition_number(matrix: np.ndarray) -> float:
    arr = np.asarray(matrix, dtype=float)
    if arr.size == 0:
        return float("nan")
    try:
        value = float(np.linalg.cond(arr))
    except np.linalg.LinAlgError:
        return float("inf")
    return value if math.isfinite(value) else float("inf")


def _safe_scalar_correlation(left: np.ndarray, right: np.ndarray) -> float:
    a = np.asarray(left, dtype=float)
    b = np.asarray(right, dtype=float)
    n = min(a.size, b.size)
    if n == 0:
        return 0.0
    a = a[:n] - float(np.mean(a[:n]))
    b = b[:n] - float(np.mean(b[:n]))
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom <= 0.0:
        return 0.0
    return float(np.dot(a, b) / denom)
