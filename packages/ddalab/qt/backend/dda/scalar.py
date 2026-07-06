from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Literal, Sequence

import numpy as np


DEFAULT_MODEL_TERMS = (1, 2, 10)
DEFAULT_DELAYS = (7, 10)
DEFAULT_DERIVATIVE_POINTS = 4
DEFAULT_ORDER = 4
DEFAULT_NR_TAU = 2
DEFAULT_WINDOW_LENGTH = 200
DEFAULT_WINDOW_STEP = 100

NormalizationMode = Literal["zscore", "raw", "minmax"]
ScalarDerivativeMode = Literal["finite_difference", "savgol"]
ScalarRegressionMode = Literal["ols", "ridge", "group_lasso"]
WeakQuadratureRule = Literal[
    "trapezoid",
    "left_rectangle",
    "right_rectangle",
    "midpoint",
    "simpson",
    "rectangle",
]


@dataclass(slots=True)
class DDAVariantResult:
    id: str
    name: str
    matrix: np.ndarray
    row_labels: list[str]
    window_markers: list[float]


@dataclass(slots=True)
class DDAResult:
    variants: list[DDAVariantResult]
    window_markers: list[float]
    channel_labels: list[str]

    def variant(self, flavor: str) -> DDAVariantResult:
        flavor = _normalize_flavor(flavor)
        for result in self.variants:
            if result.id == flavor:
                return result
        raise KeyError(f"DDA flavor {flavor!r} was not computed.")


@dataclass(frozen=True, slots=True)
class _ModelSpec:
    derivative_points: int
    window_length: int
    window_step: int
    max_delay: int
    primary_terms: list[list[int]]
    secondary_terms: list[list[int]]


@dataclass(slots=True)
class _PreparedWindow:
    shifted: np.ndarray
    derivative: np.ndarray
    max_delay: int


@dataclass(slots=True)
class _SolvedBlock:
    coefficients: np.ndarray
    rmse: float

    @classmethod
    def nan(cls, feature_count: int) -> "_SolvedBlock":
        return cls(np.full(feature_count, np.nan, dtype=float), float("nan"))


@dataclass(slots=True)
class PointwiseDesignMatrix:
    design: np.ndarray
    sample_indices: np.ndarray
    term_names: list[str]
    terms: list[list[int]]


@dataclass(slots=True)
class WeakFormDesignMatrix:
    design: np.ndarray
    target: np.ndarray
    window_starts: np.ndarray
    integration_window: int
    stride: int
    term_names: list[str]
    terms: list[list[int]]


def build_pointwise_design_matrix(
    x: Sequence[float],
    *,
    delays: Sequence[int],
    degree: int,
    model_terms: Sequence[int] | None = None,
) -> PointwiseDesignMatrix:
    """Build the scalar DDA polynomial feature library at each valid sample.

    Delay values are integer sample offsets. A delay of zero denotes ``x(t)``;
    a delay of ``d`` denotes ``x(t-d)``. The monomial order is inherited from
    the same DDA model table used by the windowed Python engine.
    """

    series = _as_1d_float_array(x)
    normalized_delays = _normalize_scalar_delays(delays)
    terms = _resolve_scalar_terms(normalized_delays, degree, model_terms)
    term_names = _scalar_term_names(terms)
    max_delay = max(normalized_delays) if normalized_delays else 0
    if series.size <= max_delay:
        raise ValueError(
            f"Need more than max(delay)={max_delay} samples to build scalar DDA features."
        )
    sample_indices = np.arange(max_delay, series.size, dtype=int)
    design = np.empty((sample_indices.size, len(terms)), dtype=float)
    for row_idx, sample_idx in enumerate(sample_indices):
        for col_idx, term in enumerate(terms):
            product = 1.0
            for delay in term:
                product *= float(series[sample_idx - delay])
            design[row_idx, col_idx] = product
    return PointwiseDesignMatrix(
        design=design,
        sample_indices=sample_indices,
        term_names=term_names,
        terms=terms,
    )


def build_weak_form_design_matrix(
    x: Sequence[float],
    *,
    dt: float | None = None,
    sample_rate: float | None = None,
    delays: Sequence[int],
    degree: int,
    model_terms: Sequence[int] | None = None,
    integration_window: int | None = None,
    integration_window_seconds: float | None = None,
    stride: int | None = None,
    stride_seconds: float | None = None,
    quadrature: WeakQuadratureRule = "trapezoid",
) -> WeakFormDesignMatrix:
    """Build integrated weak-form DDA rows.

    The returned rows solve the integral equation

    ``x(t + Delta) - x(t) ~= integral_t^{t+Delta} Phi(s) ds @ beta``.

    Coefficients therefore have the same differential-equation interpretation
    as derivative-regression DDA coefficients.
    """

    series = _as_1d_float_array(x)
    resolved_dt = _resolve_dt(dt=dt, sample_rate=sample_rate)
    normalized_delays = _normalize_scalar_delays(delays)
    window = _resolve_sample_count(
        samples=integration_window,
        seconds=integration_window_seconds,
        dt=resolved_dt,
        name="integration_window",
        default=default_integration_window(normalized_delays),
    )
    stride_samples = _resolve_sample_count(
        samples=stride,
        seconds=stride_seconds,
        dt=resolved_dt,
        name="stride",
        default=1,
    )
    if window <= 0:
        raise ValueError("integration_window must be greater than zero.")
    if stride_samples <= 0:
        raise ValueError("stride must be greater than zero.")
    quadrature = _normalize_quadrature_rule(quadrature)

    pointwise = build_pointwise_design_matrix(
        series,
        delays=normalized_delays,
        degree=degree,
        model_terms=model_terms,
    )
    max_delay = int(pointwise.sample_indices[0])
    if series.size <= max_delay + window:
        raise ValueError(
            "Need at least max(delay) + integration_window + 1 samples "
            "to build weak-form DDA rows."
        )

    starts = np.arange(max_delay, series.size - window, stride_samples, dtype=int)
    design = np.empty((starts.size, pointwise.design.shape[1]), dtype=float)
    target = np.empty(starts.size, dtype=float)
    for row_idx, start_idx in enumerate(starts):
        pointwise_start = start_idx - max_delay
        phi_window = pointwise.design[pointwise_start : pointwise_start + window + 1, :]
        design[row_idx, :] = _integrate_feature_window(
            phi_window,
            dt=resolved_dt,
            quadrature=quadrature,
        )
        target[row_idx] = float(series[start_idx + window] - series[start_idx])

    return WeakFormDesignMatrix(
        design=design,
        target=target,
        window_starts=starts,
        integration_window=window,
        stride=stride_samples,
        term_names=pointwise.term_names,
        terms=pointwise.terms,
    )


class DerivativeDDA:
    """Scalar derivative-regression DDA estimator.

    This is the vanilla pointwise DDA formulation: numerical derivatives are
    regressed on the delayed polynomial feature library.
    """

    def __init__(
        self,
        *,
        degree: int = 3,
        delays: Sequence[int] = (0,),
        model_terms: Sequence[int] | None = None,
        derivative: ScalarDerivativeMode = "finite_difference",
        savgol_window: int = 11,
        savgol_polyorder: int = 3,
        regression: ScalarRegressionMode = "ols",
        ridge_alpha: float = 0.0,
    ) -> None:
        self.degree = int(degree)
        self.delays = tuple(int(delay) for delay in delays)
        self.model_terms = (
            tuple(int(term) for term in model_terms)
            if model_terms is not None
            else None
        )
        self.derivative = derivative
        self.savgol_window = int(savgol_window)
        self.savgol_polyorder = int(savgol_polyorder)
        self.regression = regression
        self.ridge_alpha = float(ridge_alpha)

    def fit(
        self,
        x: Sequence[float],
        *,
        dt: float | None = None,
        sample_rate: float | None = None,
    ) -> "DerivativeDDA":
        series = _as_1d_float_array(x)
        resolved_dt = _resolve_dt(dt=dt, sample_rate=sample_rate)
        pointwise = build_pointwise_design_matrix(
            series,
            delays=self.delays,
            degree=self.degree,
            model_terms=self.model_terms,
        )
        derivative = _scalar_derivative(
            series,
            dt=resolved_dt,
            method=self.derivative,
            savgol_window=self.savgol_window,
            savgol_polyorder=self.savgol_polyorder,
        )
        target = derivative[pointwise.sample_indices]
        keep = np.isfinite(target) & np.all(np.isfinite(pointwise.design), axis=1)
        if not np.any(keep):
            raise ValueError("No finite scalar DDA rows are available for fitting.")
        coefficients = _fit_scalar_regression(
            pointwise.design[keep, :],
            target[keep],
            regression=self.regression,
            ridge_alpha=self.ridge_alpha,
        )
        prediction = pointwise.design[keep, :] @ coefficients
        residuals = target[keep] - prediction
        self.coefficients_ = coefficients
        self.term_names_ = pointwise.term_names
        self.terms_ = pointwise.terms
        self.design_matrix_ = pointwise.design[keep, :]
        self.target_ = target[keep]
        self.sample_indices_ = pointwise.sample_indices[keep]
        self.prediction_ = prediction
        self.residuals_ = residuals
        self.rmse_ = float(np.sqrt(np.mean(residuals * residuals)))
        return self


class WeakFormDDA:
    """Scalar weak-form DDA estimator based on integrated feature rows."""

    def __init__(
        self,
        *,
        degree: int = 3,
        delays: Sequence[int] = (0,),
        model_terms: Sequence[int] | None = None,
        integration_window: int | None = None,
        integration_window_seconds: float | None = None,
        stride: int | None = None,
        stride_seconds: float | None = None,
        quadrature: WeakQuadratureRule = "trapezoid",
        regression: ScalarRegressionMode = "ols",
        ridge_alpha: float = 1e-6,
        standardize_features: bool = True,
    ) -> None:
        self.degree = int(degree)
        self.delays = tuple(int(delay) for delay in delays)
        self.model_terms = (
            tuple(int(term) for term in model_terms)
            if model_terms is not None
            else None
        )
        self.integration_window = integration_window
        self.integration_window_seconds = integration_window_seconds
        self.stride = stride
        self.stride_seconds = stride_seconds
        self.quadrature = quadrature
        self.regression = regression
        self.ridge_alpha = float(ridge_alpha)
        self.standardize_features = bool(standardize_features)

    def fit(
        self,
        x: Sequence[float],
        *,
        dt: float | None = None,
        sample_rate: float | None = None,
    ) -> "WeakFormDDA":
        weak = build_weak_form_design_matrix(
            x,
            dt=dt,
            sample_rate=sample_rate,
            delays=self.delays,
            degree=self.degree,
            model_terms=self.model_terms,
            integration_window=self.integration_window,
            integration_window_seconds=self.integration_window_seconds,
            stride=self.stride,
            stride_seconds=self.stride_seconds,
            quadrature=self.quadrature,
        )
        keep = np.isfinite(weak.target) & np.all(np.isfinite(weak.design), axis=1)
        if not np.any(keep):
            raise ValueError("No finite weak-form DDA rows are available for fitting.")
        coefficients = _fit_scalar_regression(
            weak.design[keep, :],
            weak.target[keep],
            regression=self.regression,
            ridge_alpha=self.ridge_alpha,
            standardize_features=self.standardize_features,
        )
        prediction = weak.design[keep, :] @ coefficients
        residuals = weak.target[keep] - prediction
        self.coefficients_ = coefficients
        self.term_names_ = weak.term_names
        self.terms_ = weak.terms
        self.design_matrix_ = weak.design[keep, :]
        self.target_ = weak.target[keep]
        self.window_starts_ = weak.window_starts[keep]
        self.integration_window_ = weak.integration_window
        self.stride_ = weak.stride
        self.prediction_ = prediction
        self.residuals_ = residuals
        self.rmse_ = float(np.sqrt(np.mean(residuals * residuals)))
        return self


def default_integration_window(delays: Sequence[int]) -> int:
    """Conservative default weak-form window in samples.

    If positive delays are present, use half of the smallest positive delay,
    bounded below by three samples. For nondelayed scalar systems, use five
    samples to gain modest noise averaging without heavily blurring dynamics.
    """

    positive = [int(delay) for delay in delays if int(delay) > 0]
    if not positive:
        return 5
    return max(3, int(round(0.5 * min(positive))))


def _as_1d_float_array(x: Sequence[float]) -> np.ndarray:
    series = np.asarray(x, dtype=float)
    if series.ndim != 1:
        raise ValueError("Scalar DDA expects a 1D time series.")
    if series.size < 3:
        raise ValueError("Scalar DDA expects at least three samples.")
    return series


def _resolve_dt(*, dt: float | None, sample_rate: float | None) -> float:
    if dt is not None and sample_rate is not None:
        raise ValueError("Pass either dt or sample_rate, not both.")
    if sample_rate is not None:
        sample_rate = float(sample_rate)
        if not math.isfinite(sample_rate) or sample_rate <= 0.0:
            raise ValueError("sample_rate must be positive.")
        return 1.0 / sample_rate
    if dt is None:
        return 1.0
    dt = float(dt)
    if not math.isfinite(dt) or dt <= 0.0:
        raise ValueError("dt must be positive.")
    return dt


def _normalize_scalar_delays(delays: Sequence[int]) -> list[int]:
    if not delays:
        raise ValueError("Scalar DDA expects at least one delay; use delay 0 for x(t).")
    normalized: list[int] = []
    for delay in delays:
        delay = int(delay)
        if delay < 0:
            raise ValueError(f"DDA expects non-negative delays, got {delay}.")
        normalized.append(delay)
    return normalized


def _resolve_scalar_terms(
    delays: Sequence[int],
    degree: int,
    model_terms: Sequence[int] | None,
) -> list[list[int]]:
    degree = int(degree)
    if degree <= 0:
        raise ValueError("degree must be greater than zero.")
    monomials = _monomial_list(len(delays), degree)
    if model_terms is None:
        model_terms = range(1, len(monomials) + 1)
    return _select_model_terms(monomials, model_terms, delays)


def _scalar_term_names(terms: Sequence[Sequence[int]]) -> list[str]:
    return [_scalar_term_name(term) for term in terms]


def _scalar_term_name(term: Sequence[int]) -> str:
    if not term:
        return "1"
    parts: list[str] = []
    for delay in sorted(set(term), key=list(term).index):
        count = sum(1 for value in term if value == delay)
        factor = _scalar_factor_name(delay)
        parts.append(f"{factor}^{count}" if count > 1 else factor)
    return "*".join(parts)


def _scalar_factor_name(delay: int) -> str:
    return "x(t)" if delay == 0 else f"x(t-{delay})"


def _resolve_sample_count(
    *,
    samples: int | None,
    seconds: float | None,
    dt: float,
    name: str,
    default: int,
) -> int:
    if samples is not None and seconds is not None:
        raise ValueError(f"Pass either {name} samples or {name}_seconds, not both.")
    if seconds is not None:
        seconds = float(seconds)
        if not math.isfinite(seconds) or seconds <= 0.0:
            raise ValueError(f"{name}_seconds must be positive.")
        return max(1, int(round(seconds / dt)))
    if samples is None:
        return int(default)
    return int(samples)


def _normalize_quadrature_rule(quadrature: str) -> str:
    rule = quadrature.lower().strip().replace("-", "_")
    if rule == "rectangle":
        rule = "left_rectangle"
    supported = {
        "trapezoid",
        "left_rectangle",
        "right_rectangle",
        "midpoint",
        "simpson",
    }
    if rule not in supported:
        joined = ", ".join(sorted(supported))
        raise ValueError(f"quadrature must be one of: {joined}.")
    return rule


def _integrate_feature_window(
    phi_window: np.ndarray,
    *,
    dt: float,
    quadrature: str,
) -> np.ndarray:
    if quadrature == "trapezoid":
        return _trapezoid(phi_window, dx=dt, axis=0)
    if quadrature == "left_rectangle":
        return dt * np.sum(phi_window[:-1, :], axis=0)
    if quadrature == "right_rectangle":
        return dt * np.sum(phi_window[1:, :], axis=0)
    if quadrature == "midpoint":
        interval_count = phi_window.shape[0] - 1
        midpoint = interval_count / 2.0
        lower = int(math.floor(midpoint))
        upper = int(math.ceil(midpoint))
        if lower == upper:
            midpoint_value = phi_window[lower, :]
        else:
            midpoint_value = 0.5 * (phi_window[lower, :] + phi_window[upper, :])
        return dt * interval_count * midpoint_value
    if quadrature == "simpson":
        return _simpson(phi_window, dx=dt, axis=0)
    raise ValueError(f"Unsupported quadrature rule {quadrature!r}.")


def _scalar_derivative(
    x: np.ndarray,
    *,
    dt: float,
    method: ScalarDerivativeMode,
    savgol_window: int,
    savgol_polyorder: int,
) -> np.ndarray:
    method = method.lower()
    if method == "finite_difference":
        return _forward_difference(x, dt=dt)
    if method == "savgol":
        return _savgol_derivative(
            x,
            dt=dt,
            window=savgol_window,
            polyorder=savgol_polyorder,
        )
    raise ValueError("derivative must be 'finite_difference' or 'savgol'.")


def _savgol_derivative(
    x: np.ndarray,
    *,
    dt: float,
    window: int,
    polyorder: int,
) -> np.ndarray:
    try:
        from scipy.signal import savgol_filter
    except Exception as exc:  # pragma: no cover - depends on optional SciPy install.
        raise RuntimeError("Savitzky-Golay derivatives require scipy.") from exc
    window = max(int(window), 3)
    if window % 2 == 0:
        window += 1
    if window > x.size:
        window = x.size if x.size % 2 == 1 else x.size - 1
    if window <= polyorder:
        polyorder = max(1, window - 1)
    if window < 3:
        return _forward_difference(x, dt=dt)
    smoothed = np.asarray(
        savgol_filter(
            x,
            window_length=window,
            polyorder=int(polyorder),
            mode="interp",
        ),
        dtype=float,
    )
    return _forward_difference(smoothed, dt=dt)


def _forward_difference(x: np.ndarray, *, dt: float) -> np.ndarray:
    derivative = np.empty_like(x, dtype=float)
    derivative[:-1] = np.diff(x) / dt
    derivative[-1] = np.nan
    return derivative


def _fit_scalar_regression(
    design: np.ndarray,
    target: np.ndarray,
    *,
    regression: ScalarRegressionMode,
    ridge_alpha: float,
    standardize_features: bool = False,
) -> np.ndarray:
    if design.ndim != 2 or target.ndim != 1:
        raise ValueError("Scalar DDA regression expects a 2D design and 1D target.")
    if design.shape[0] != target.shape[0]:
        raise ValueError("Scalar DDA design and target row counts do not match.")
    if design.shape[0] == 0 or design.shape[1] == 0:
        raise ValueError("Scalar DDA regression received an empty design matrix.")
    regression = regression.lower()
    fit_design = np.asarray(design, dtype=float)
    feature_scale = np.ones(fit_design.shape[1], dtype=float)
    if standardize_features:
        feature_scale = np.std(fit_design, axis=0, ddof=0)
        feature_scale[~np.isfinite(feature_scale) | (feature_scale == 0.0)] = 1.0
        fit_design = fit_design / feature_scale
    alpha = float(ridge_alpha)
    if regression == "ridge":
        if alpha < 0.0:
            raise ValueError("ridge_alpha must be non-negative.")
        gram = fit_design.T @ fit_design
        rhs = fit_design.T @ target
        scaled = np.linalg.solve(gram + alpha * np.eye(gram.shape[0]), rhs)
        return np.asarray(scaled / feature_scale, dtype=float)
    if regression != "ols":
        raise ValueError("regression must be 'ols' or 'ridge'.")
    scaled, *_ = np.linalg.lstsq(fit_design, target, rcond=None)
    return np.asarray(scaled / feature_scale, dtype=float)


def _trapezoid(values: np.ndarray, *, dx: float, axis: int) -> np.ndarray:
    if hasattr(np, "trapezoid"):
        return np.trapezoid(values, dx=dx, axis=axis)
    return np.trapz(values, dx=dx, axis=axis)


def _simpson(values: np.ndarray, *, dx: float, axis: int) -> np.ndarray:
    try:
        from scipy.integrate import simpson
    except Exception as exc:  # pragma: no cover - depends on optional SciPy install.
        raise RuntimeError("Simpson quadrature requires scipy.") from exc
    return np.asarray(simpson(values, dx=dx, axis=axis), dtype=float)


def _normalize_flavor(flavor: str) -> str:
    token = flavor.strip().upper().replace("-", "_").replace(" ", "_")
    aliases = {
        "SINGLE_TIMESERIES": "ST",
        "CROSS_TIMESERIES": "CT",
        "CROSS_DYNAMICAL": "CD",
        "DYNAMICAL_ERGODICITY": "DE",
        "DELAY_EMBEDDING": "DE",
        "SYNCHRONIZATION": "SY",
        "SYNCHRONY": "SY",
    }
    return aliases.get(token, token)


def _nr_multicombinations(nr_tau: int, order: int) -> int:
    combinations = 1
    total = 0
    for degree in range(1, order + 1):
        combinations = round(combinations * ((degree + nr_tau - 1) / degree))
        total += combinations
    return total


def _monomial_list(nr_tau: int, order: int) -> list[list[int]]:
    total = _nr_multicombinations(nr_tau, order)
    table = [[0 for _ in range(order)] for _ in range(total)]
    row = 0
    for degree in range(1, order + 1):
        degree_total = _nr_multicombinations(nr_tau, degree) - (
            _nr_multicombinations(nr_tau, degree - 1) if degree > 1 else 0
        )
        start_row = row
        for slot in range(order - degree, order):
            table[row][slot] = 1

        for _ in range(1, degree_total):
            previous = list(table[row])
            row += 1
            table[row] = previous
            updated = False
            for index in range(order):
                if table[row][index] == nr_tau:
                    replacement = 1 if index == 0 else table[row][index - 1] + 1
                    for slot in range(max(index - 1, 0), order):
                        table[row][slot] = replacement
                    updated = True
                    break
            if not updated:
                table[row][order - 1] += 1
        row += 1
        if row == start_row + degree_total:
            continue
    return table


def _select_model_terms(
    monomials: Sequence[Sequence[int]],
    model_terms: Sequence[int],
    delays: Sequence[int],
) -> list[list[int]]:
    selected: list[list[int]] = []
    for term in model_terms:
        term = int(term)
        if term <= 0:
            raise ValueError(f"Model terms are 1-based, got {term}.")
        try:
            monomial = monomials[term - 1]
        except IndexError as exc:
            raise ValueError(
                f"Model term {term} is out of range for the monomial table."
            ) from exc
        selected.append([delays[entry - 1] for entry in monomial if entry != 0])
    return selected
