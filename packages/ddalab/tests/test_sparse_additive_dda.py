from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_app.backend.dda import (  # noqa: E402
    SparseAdditiveWeakFormDDA,
    compute_delay_block_condition_numbers,
    compute_delay_block_correlation,
    compute_state_coverage,
    fit_group_lasso,
    stability_select_sparse_additive_weak_form,
    thin_candidate_delays_by_collinearity,
)


def _simulate_saturating_delay(
    *,
    dt: float = 0.02,
    samples: int = 600,
    delay: int = 5,
) -> np.ndarray:
    x = np.empty(samples, dtype=float)
    for idx in range(delay + 1):
        x[idx] = 0.6 + 0.2 * np.sin(0.4 * idx)
    for idx in range(delay, samples - 1):
        dx = -0.35 * x[idx] + 0.8 * np.tanh(1.5 * x[idx - delay])
        x[idx + 1] = x[idx] + dt * dx
    return x


class SparseAdditiveWeakFormDdaTests(unittest.TestCase):
    def test_fit_runs_and_exposes_expected_shapes(self) -> None:
        x = _simulate_saturating_delay()
        model = SparseAdditiveWeakFormDDA(
            candidate_delays=[0, 5, 11],
            n_knots=6,
            integration_window=7,
            ridge_alpha=1e-5,
            group_threshold=0.01,
        )
        model.fit(x, dt=0.02)

        self.assertEqual(model.design_matrix_.shape[0], model.target_.shape[0])
        self.assertEqual(model.design_matrix_.shape[1], len(model.term_names_))
        self.assertEqual(set(model.delay_strengths_), {0, 5, 11})
        self.assertTrue(model.selected_delays_)
        self.assertIn(5, model.effect_curves_)

    def test_effect_curves_and_prediction_shapes(self) -> None:
        x = _simulate_saturating_delay()
        model = SparseAdditiveWeakFormDDA(
            candidate_delays=[0, 5], n_knots=5, integration_window=5
        )
        model.fit(x, dt=0.02)

        grid = np.linspace(float(np.min(x)), float(np.max(x)), 20)
        values = model.evaluate_effect(5, grid)
        increments = model.predict_increment(x, dt=0.02)

        self.assertEqual(values.shape, grid.shape)
        self.assertEqual(increments.shape, model.target_.shape)
        self.assertGreaterEqual(model.score_interval_prediction(x, dt=0.02), 0.0)

    def test_sparse_additive_fit_is_deterministic(self) -> None:
        x = _simulate_saturating_delay()
        kwargs = dict(
            candidate_delays=[0, 5], n_knots=5, integration_window=5, ridge_alpha=1e-5
        )
        first = SparseAdditiveWeakFormDDA(**kwargs).fit(x, dt=0.02)
        second = SparseAdditiveWeakFormDDA(**kwargs).fit(x, dt=0.02)

        np.testing.assert_allclose(first.coefficients_, second.coefficients_)
        self.assertEqual(first.selected_delays_, second.selected_delays_)

    def test_stability_selection_returns_delay_frequencies(self) -> None:
        x = _simulate_saturating_delay(samples=420)
        scores = stability_select_sparse_additive_weak_form(
            x,
            dt=0.02,
            candidate_delays=[0, 5, 11],
            integration_window=5,
            n_repeats=6,
            block_fraction=0.75,
            random_state=7,
            group_threshold=0.01,
        )

        self.assertEqual(set(scores.selection_frequency), {0, 5, 11})
        for value in scores.selection_frequency.values():
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 1.0)

    def test_group_lasso_recovers_selected_group_and_unpenalized_intercept(
        self,
    ) -> None:
        rng = np.random.default_rng(3)
        x_active = rng.normal(size=(160, 2))
        x_inactive = rng.normal(size=(160, 2))
        design = np.column_stack([np.ones(160), x_active, x_inactive])
        target = 2.5 + x_active @ np.asarray([1.2, -0.7])

        result = fit_group_lasso(
            design,
            target,
            groups={0: slice(1, 3), 1: slice(3, 5)},
            alpha=0.08,
            ridge_alpha=1e-6,
            standardize_features=True,
            max_iter=1200,
            tol=1e-9,
        )

        self.assertTrue(result.converged)
        self.assertAlmostEqual(float(result.coefficients[0]), 2.5, places=2)
        self.assertGreater(result.group_strengths[0], 0.5)
        self.assertLess(result.group_strengths[1], 1e-3)

    def test_delay_thinning_removes_highly_correlated_neighboring_delays(self) -> None:
        x = np.sin(np.linspace(0.0, 6.0, 600))

        thinned = thin_candidate_delays_by_collinearity(
            x,
            [0, 5, 6, 40],
            max_block_correlation=0.995,
            prefer="small_delay",
        )

        self.assertIn(0, thinned)
        self.assertIn(5, thinned)
        self.assertNotIn(6, thinned)

    def test_sparse_additive_group_lasso_and_diagnostics(self) -> None:
        x = _simulate_saturating_delay(samples=620)
        model = SparseAdditiveWeakFormDDA(
            candidate_delays=[0, 5, 6, 14],
            n_knots=6,
            integration_window=7,
            regression="group_lasso",
            group_lasso_alpha=0.002,
            thin_delays=True,
            max_delay_correlation=0.995,
            max_iter=500,
        )
        model.fit(x, dt=0.02)

        self.assertEqual(model.original_candidate_delays_, (0, 5, 6, 14))
        self.assertIn(0, model.candidate_delays_)
        self.assertLessEqual(len(model.candidate_delays_), 4)
        self.assertTrue(model.convergence_["converged"])
        self.assertEqual(set(model.group_strengths_), set(model.candidate_delays_))

        correlation = compute_delay_block_correlation(
            model.design_matrix_, model.delay_slices_
        )
        conditions = compute_delay_block_condition_numbers(
            model.design_matrix_, model.delay_slices_
        )
        coverage = compute_state_coverage(
            x, model.candidate_delays_, model.transformers_
        )

        self.assertEqual(
            correlation.shape,
            (len(model.candidate_delays_), len(model.candidate_delays_)),
        )
        self.assertIn("global", conditions)
        self.assertIn(5, coverage)
        self.assertIn("basis_activation_fraction", coverage[5])

    def test_multi_trajectory_fit_keeps_boundaries_separate(self) -> None:
        first = _simulate_saturating_delay(samples=360)
        second = 1.3 * _simulate_saturating_delay(samples=420) - 0.15
        model = SparseAdditiveWeakFormDDA(
            candidate_delays=[0, 5], n_knots=5, integration_window=5
        )
        model.fit([first, second], dt=0.02)

        separate_rows = []
        for series in (first, second):
            single = SparseAdditiveWeakFormDDA(
                candidate_delays=[0, 5], n_knots=5, integration_window=5
            )
            single.fit(series, dt=0.02)
            separate_rows.append(single.design_matrix_.shape[0])

        self.assertEqual(model.design_matrix_.shape[0], sum(separate_rows))
        self.assertEqual(set(model.trajectory_ids_), {0, 1})

    def test_stability_selection_calibrates_against_null(self) -> None:
        x = _simulate_saturating_delay(samples=460)
        scores = stability_select_sparse_additive_weak_form(
            x,
            dt=0.02,
            candidate_delays=[0, 5, 12],
            integration_window=5,
            regression="group_lasso",
            group_lasso_alpha=0.004,
            n_repeats=5,
            null_repeats=3,
            random_state=11,
            calibrate=True,
        )

        self.assertEqual(set(scores.null_selection_frequency), {0, 5, 12})
        self.assertIsInstance(scores.calibrated_selected_delays, list)
        self.assertGreaterEqual(scores.calibrated_threshold, 0.0)


if __name__ == "__main__":
    unittest.main()
