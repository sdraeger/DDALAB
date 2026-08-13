from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_app.backend.dda import run_dda_matrix  # noqa: E402


def _parity_fixture() -> list[list[float]]:
    samples: list[list[float]] = []
    for t in range(96):
        x = math.sin(t * 0.11) + 0.03 * math.cos(t * 0.37)
        y = 0.42 * math.sin(t * 0.11 + 0.4) + 0.18 * math.cos(t * 0.07)
        z = 0.25 * x + 0.35 * y + 0.08 * math.sin(t * 0.19 + 0.2)
        samples.append([x, y, z])
    return samples


class PythonDdaParityTests(unittest.TestCase):
    def test_core_flavors_match_rust_reference(self) -> None:
        result = run_dda_matrix(
            _parity_fixture(),
            channels=[0, 1, 2],
            flavors=["ST", "CT", "CD", "DE", "SY"],
            window_length=32,
            window_step=16,
            delays=[1, 2],
            model_terms=[1, 2, 4],
            derivative_points=3,
            order=3,
            nr_tau=2,
            ct_channel_pairs=[(0, 1), (1, 2)],
            cd_channel_pairs=[(0, 1), (1, 0), (2, 1)],
            ct_window_length=2,
            ct_window_step=1,
        )

        self.assertEqual(result.window_markers, [40.0, 56.0, 72.0, 88.0])
        self.assertEqual(
            [variant.id for variant in result.variants], ["ST", "CT", "CD", "DE", "SY"]
        )
        self.assertEqual(result.variant("ST").row_labels, ["Ch 0", "Ch 1", "Ch 2"])
        self.assertEqual(result.variant("CT").row_labels, ["Ch 0&Ch 1", "Ch 1&Ch 2"])
        self.assertEqual(
            result.variant("CD").row_labels,
            ["Ch 0 <- Ch 1", "Ch 1 <- Ch 0", "Ch 2 <- Ch 1"],
        )
        self.assertEqual(result.variant("DE").row_labels, ["Ch 0&Ch 1", "Ch 1&Ch 2"])
        self.assertEqual(result.variant("SY").row_labels, ["Ch 0 <-> Ch 1"])

        expected = {
            "ST": [
                [1.973444341356, 1.841545857354, 2.003185043142, 1.885291325996],
                [2.025111106589, 1.847634039673, 1.986256200640, 1.837801225124],
                [1.902336013334, 1.777259029120, 2.161582204063, 1.899445940956],
            ],
            "CT": [
                [1.990182542284, 1.845707597562, 1.991823686485, 1.860031840421],
                [1.950545902080, 1.821266554039, 2.073120721445, 1.865684403341],
            ],
            "CD": [
                [0.005953420797, 0.005251563906, 0.011315953838, 0.010937784290],
                [0.001965274791, 0.012051424377, 0.001590852203, 0.015272098482],
                [0.002282108860, 0.018393432760, 0.003182694468, 0.010282281326],
            ],
            "DE": [
                [0.484785019689, 0.054670849622, 0.280102825445, 0.016186927079],
                [0.606556023271, 0.081611340763, 0.612910698557, 0.100614186601],
            ],
            "SY": [
                [0.001195397813, -0.001673205084, 0.001008255784, 0.030790748346],
            ],
        }

        for flavor, expected_matrix in expected.items():
            np.testing.assert_allclose(
                result.variant(flavor).matrix,
                np.asarray(expected_matrix),
                rtol=1e-9,
                atol=1e-9,
                err_msg=flavor,
            )


if __name__ == "__main__":
    unittest.main()
