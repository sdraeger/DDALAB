from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_app.backend.dda import (  # noqa: E402
    DerivativeDDA,
    WeakFormDDA,
    build_pointwise_design_matrix,
    build_weak_form_design_matrix,
)

from experiments.weak_form_dda_reliability import (  # noqa: E402
    select_validation_window,
    simulate_polynomial_ode,
)


def _simulate_polynomial_system(
    *,
    beta: tuple[float, float, float] = (-0.45, 0.08, -0.02),
    x0: float = 1.8,
    dt: float = 0.01,
    samples: int = 1200,
) -> np.ndarray:
    def rhs(value: float) -> float:
        return beta[0] * value + beta[1] * value**2 + beta[2] * value**3

    x = np.empty(samples, dtype=float)
    x[0] = x0
    for idx in range(samples - 1):
        current = float(x[idx])
        k1 = rhs(current)
        k2 = rhs(current + 0.5 * dt * k1)
        k3 = rhs(current + 0.5 * dt * k2)
        k4 = rhs(current + dt * k3)
        x[idx + 1] = current + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
    return x


class WeakFormDdaTests(unittest.TestCase):
    def test_weak_form_design_matrix_shapes_and_term_names(self) -> None:
        dt = 0.1
        x = np.sin(np.arange(80, dtype=float) * dt) + 0.1 * np.cos(
            np.arange(80, dtype=float) * 0.7 * dt
        )

        pointwise = build_pointwise_design_matrix(x, delays=[0, 2], degree=2)
        weak = build_weak_form_design_matrix(
            x,
            dt=dt,
            delays=[0, 2],
            degree=2,
            integration_window=5,
            stride=2,
        )

        self.assertEqual(weak.design.shape[0], weak.target.shape[0])
        self.assertEqual(weak.design.shape[1], len(weak.term_names))
        self.assertEqual(weak.term_names, pointwise.term_names)
        self.assertGreaterEqual(int(weak.window_starts[0]), 2)
        self.assertEqual(int(weak.window_starts[1] - weak.window_starts[0]), 2)
        self.assertAlmostEqual(
            weak.target[0],
            x[int(weak.window_starts[0]) + 5] - x[int(weak.window_starts[0])],
        )

        weak_seconds = build_weak_form_design_matrix(
            x,
            dt=dt,
            delays=[0, 2],
            degree=2,
            integration_window_seconds=0.5,
            stride_seconds=0.2,
        )
        self.assertEqual(weak_seconds.integration_window, 5)
        self.assertEqual(weak_seconds.stride, 2)

    def test_weak_form_quadrature_rules_have_comparable_scale(self) -> None:
        x = np.asarray([0.0, 1.0, 4.0, 9.0, 16.0], dtype=float)

        left = build_weak_form_design_matrix(
            x,
            dt=1.0,
            delays=[0],
            degree=1,
            integration_window=2,
            stride=1,
            quadrature="left_rectangle",
        )
        right = build_weak_form_design_matrix(
            x,
            dt=1.0,
            delays=[0],
            degree=1,
            integration_window=2,
            stride=1,
            quadrature="right_rectangle",
        )
        midpoint = build_weak_form_design_matrix(
            x,
            dt=1.0,
            delays=[0],
            degree=1,
            integration_window=2,
            stride=1,
            quadrature="midpoint",
        )
        trapezoid = build_weak_form_design_matrix(
            x,
            dt=1.0,
            delays=[0],
            degree=1,
            integration_window=2,
            stride=1,
            quadrature="trapezoid",
        )

        self.assertAlmostEqual(float(left.design[0, 0]), 1.0)
        self.assertAlmostEqual(float(right.design[0, 0]), 5.0)
        self.assertAlmostEqual(float(midpoint.design[0, 0]), 2.0)
        self.assertAlmostEqual(float(trapezoid.design[0, 0]), 3.0)
        self.assertAlmostEqual(float(left.target[0]), float(trapezoid.target[0]))

    def test_midpoint_quadrature_interpolates_between_central_rows(self) -> None:
        weak = build_weak_form_design_matrix(
            np.asarray([0.0, 1.0, 4.0, 9.0], dtype=float),
            dt=1.0,
            delays=[0],
            degree=1,
            integration_window=3,
            quadrature="midpoint",
        )

        self.assertAlmostEqual(float(weak.design[0, 0]), 7.5)

    def test_weak_form_recovers_clean_polynomial_coefficients(self) -> None:
        dt = 0.01
        true_beta = np.asarray([-0.45, 0.08, -0.02])
        x = _simulate_polynomial_system(beta=tuple(true_beta), dt=dt)

        model = WeakFormDDA(degree=3, delays=[0], integration_window=9, stride=1)
        model.fit(x, dt=dt)

        self.assertEqual(model.term_names_, ["x(t)", "x(t)^2", "x(t)^3"])
        np.testing.assert_allclose(
            model.coefficients_, true_beta, atol=0.035, rtol=0.20
        )

    def test_weak_form_ridge_standardization_back_transforms_coefficients(self) -> None:
        dt = 0.01
        true_beta = np.asarray([-0.45, 0.08, -0.02])
        x = _simulate_polynomial_system(beta=tuple(true_beta), dt=dt)

        ols = WeakFormDDA(degree=3, delays=[0], integration_window=9, regression="ols")
        ols.fit(x, dt=dt)
        ridge = WeakFormDDA(
            degree=3,
            delays=[0],
            integration_window=9,
            regression="ridge",
            ridge_alpha=1e-8,
            standardize_features=True,
        )
        ridge.fit(x, dt=dt)

        self.assertTrue(ridge.standardize_features)
        self.assertEqual(ridge.coefficients_.shape, ols.coefficients_.shape)
        np.testing.assert_allclose(
            ridge.coefficients_, ols.coefficients_, atol=5e-3, rtol=0.05
        )
        np.testing.assert_allclose(
            ridge.design_matrix_ @ ridge.coefficients_, ridge.prediction_
        )

    def test_weak_form_is_less_noise_sensitive_than_finite_difference(self) -> None:
        dt = 0.01
        true_beta = np.asarray([-0.45, 0.08, -0.02])
        clean = _simulate_polynomial_system(beta=tuple(true_beta), dt=dt, samples=1400)
        noise_scale = 0.04 * float(np.std(clean))

        finite_difference_errors: list[float] = []
        weak_errors: list[float] = []
        for seed in range(8):
            rng = np.random.default_rng(seed)
            noisy = clean + rng.normal(0.0, noise_scale, size=clean.shape)
            derivative = DerivativeDDA(
                degree=3, delays=[0], derivative="finite_difference"
            )
            derivative.fit(noisy, dt=dt)
            weak = WeakFormDDA(degree=3, delays=[0], integration_window=15, stride=1)
            weak.fit(noisy, dt=dt)
            finite_difference_errors.append(
                float(np.linalg.norm(derivative.coefficients_ - true_beta))
            )
            weak_errors.append(float(np.linalg.norm(weak.coefficients_ - true_beta)))

        self.assertLess(
            float(np.mean(weak_errors)), 0.65 * float(np.mean(finite_difference_errors))
        )

    def test_scalar_estimators_keep_derivative_api_separate_from_matrix_runner(
        self,
    ) -> None:
        x = np.array([math.sin(0.05 * idx) for idx in range(200)], dtype=float)

        derivative = DerivativeDDA(degree=2, delays=[0, 3])
        derivative.fit(x, dt=0.05)
        weak = WeakFormDDA(degree=2, delays=[0, 3], integration_window=7)
        weak.fit(x, dt=0.05)

        self.assertEqual(derivative.term_names_, weak.term_names_)
        self.assertEqual(derivative.coefficients_.shape, weak.coefficients_.shape)
        self.assertGreater(weak.design_matrix_.shape[0], 0)

    def test_validation_window_selection_uses_contiguous_validation_split(self) -> None:
        system = simulate_polynomial_ode(samples=360)
        selected = select_validation_window(
            system.x,
            dt=system.dt,
            delays=system.delays,
            degree=system.degree,
            candidate_windows=[3, 5, 9],
            quadrature_rule="trapezoid",
            train_end=180,
            validation_end=270,
        )

        self.assertIn(selected.selected_window, {3, 5, 9})
        self.assertEqual(set(selected.validation_errors), {3, 5, 9})
        self.assertGreater(selected.validation_mse, 0.0)
        for start in selected.validation_window_starts:
            self.assertGreaterEqual(int(start), 180)
            self.assertLess(int(start) + selected.selected_window, 270)


if __name__ == "__main__":
    unittest.main()
