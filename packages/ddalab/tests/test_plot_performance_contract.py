from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

# ruff: noqa: E402
PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_qt.ui.plot_benchmarks import (
    dense_matrix_tile_contract,
    dense_waveform_geometry_contract,
    run_plot_performance_contracts,
)


class PlotPerformanceContractTests(unittest.TestCase):
    def test_dense_waveform_contract_bounds_vertices_by_viewport(self) -> None:
        contract = dense_waveform_geometry_contract(
            channel_count=3,
            sample_count=20_000,
            target_width=200,
        )

        self.assertEqual(contract["surface"], "waveform")
        self.assertEqual(contract["channels"], 3)
        self.assertEqual(contract["sourceSamplesPerChannel"], 20_000)
        self.assertEqual(contract["visibleSamples"], 60_000)
        self.assertEqual(contract["drawModes"], ("lines", "lines", "lines"))
        self.assertLessEqual(contract["vertices"], 3 * 200 * 4)

    def test_dense_matrix_contract_bounds_tile_cells_by_request(self) -> None:
        contract = dense_matrix_tile_contract(
            row_count=20,
            column_count=10_000,
            target_columns=300,
            max_rows=10,
        )

        self.assertEqual(contract["surface"], "matrix")
        self.assertEqual(contract["sourceRows"], 20)
        self.assertEqual(contract["sourceColumns"], 10_000)
        self.assertEqual(contract["tileRows"], 10)
        self.assertEqual(contract["tileColumns"], 300)
        self.assertLessEqual(contract["tileCells"], 10 * 300)

    def test_dense_matrix_contract_records_provider_cache_reuse(self) -> None:
        contract = dense_matrix_tile_contract(
            row_count=8,
            column_count=1_000,
            target_columns=100,
            max_rows=4,
        )

        self.assertTrue(contract["cacheReused"])
        self.assertEqual(contract["cacheEntries"], 1)

    def test_contract_runner_logs_required_performance_metadata(self) -> None:
        logger = Mock()

        with patch(
            "ddalab_qt.ui.plot_benchmarks.perf_logger",
            return_value=logger,
        ):
            contracts = run_plot_performance_contracts(log=True)

        self.assertEqual(len(contracts), 2)
        self.assertEqual(logger.log.call_count, 2)
        logged_surfaces = [call.kwargs["surface"] for call in logger.log.call_args_list]
        self.assertEqual(logged_surfaces, ["waveform", "matrix"])
        waveform_log = logger.log.call_args_list[0]
        matrix_log = logger.log.call_args_list[1]
        self.assertEqual(waveform_log.args, ("plot.performance_contract",))
        self.assertIn("visibleSamples", waveform_log.kwargs)
        self.assertIn("vertices", waveform_log.kwargs)
        self.assertIn("targetWidth", waveform_log.kwargs)
        self.assertIn("tileRows", matrix_log.kwargs)
        self.assertIn("tileColumns", matrix_log.kwargs)
        self.assertIn("cacheReused", matrix_log.kwargs)


if __name__ == "__main__":
    unittest.main()
