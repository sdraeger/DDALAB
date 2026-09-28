import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

from ddalab_app.cli.commands import circular_shift_test
from ddalab_app.cli.runtime import (
    _read_result_file,
    _resolve_batch_input_paths,
    _write_result_file,
)
from ddalab_app.domain.models import DdaResult

ENGINE = Path(__file__).resolve().parents[2] / "dda-rs" / "target" / "release" / "ddalab"


class CliToolsTest(unittest.TestCase):
    def test_circular_shift_test_separates_a_step_from_noise(self) -> None:
        post = np.arange(200) >= 100
        step = np.where(post, 1.0, 0.0) + np.random.default_rng(1).normal(0, 0.1, 200)
        noise = np.random.default_rng(2).normal(0, 1.0, 200)
        delta, p_step = circular_shift_test(step, post)
        self.assertAlmostEqual(delta, 1.0, delta=0.05)
        self.assertLess(p_step, 0.02)
        self.assertGreater(circular_shift_test(noise, post)[1], 0.05)

    def test_npz_result_keeps_matrix_labels_and_metadata(self) -> None:
        result = DdaResult.from_json(
            {
                "id": "r1",
                "file_path": "a.edf",
                "file_name": "a.edf",
                "created_at_iso": "2026-09-27T00:00:00Z",
                "engine_label": "DDA (CPU)",
                "diagnostics": [],
                "window_centers_seconds": [0.5, 1.5],
                "variants": [
                    {
                        "id": "ST",
                        "label": "Single timeseries",
                        "row_labels": ["C3", "C4"],
                        "matrix": [[1.0, 2.0], [3.0, 4.0]],
                        "coefficient_matrices": [[[1.0, 2.0], [3.0, 4.0]], [[5.0, 6.0], [7.0, 8.0]]],
                        "summary": "",
                    }
                ],
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "r.npz"
            _write_result_file(path, result, compact=True)
            with np.load(path) as stored:
                self.assertEqual(stored["ST_matrix"].tolist(), [[1.0, 2.0], [3.0, 4.0]])
                self.assertEqual(stored["ST_row_labels"].tolist(), ["C3", "C4"])
                self.assertEqual(json.loads(str(stored["metadata"]))["file_name"], "a.edf")
            restored = _read_result_file(path)
            self.assertEqual(restored["variants"][0]["coefficient_matrices"][1], [[5.0, 6.0], [7.0, 8.0]])
            self.assertEqual(restored["window_centers_seconds"], [0.5, 1.5])

    def test_bids_batch_takes_only_recordings(self) -> None:
        import argparse

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in (
                "code/requirements.txt",
                "derivatives/p/sub-01/eeg/sub-01_eeg.csv",
                "sourcedata/raw.csv",
                "sub-01/eeg/sub-01_task-rest_eeg.ascii",
                "sub-01/meg/sub-01_meg.ds/sub-01_meg.meg4",
            ):
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text("1 2\n")
            found = _resolve_batch_input_paths(
                argparse.Namespace(glob=None, files=None, bids_dir=str(root))
            )
            self.assertEqual(
                [Path(path).name for path in found],
                ["sub-01_task-rest_eeg.ascii", "sub-01_meg.ds"],
            )

    @unittest.skipUnless(ENGINE.exists(), "needs a built dda-rs binary")
    def test_infinite_sample_does_not_hang_cd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            samples = np.random.default_rng(1).standard_normal((1017, 2)).cumsum(0)
            samples[500, 0] = np.inf
            path, output = Path(tmp) / "inf.ascii", Path(tmp) / "cd.json"
            np.savetxt(path, samples)
            subprocess.run(
                [sys.executable, "-m", "ddalab_app", "dda", "run", str(path), "--channels", "0", "1",
                 "--variants", "CD", "--variant-pairs", "CD:0<1", "--wl", "1000", "--ws", "200",
                 "--compact", "--output", str(output)],
                check=True, capture_output=True, timeout=60,
            )
            self.assertEqual(len(json.loads(output.read_text())["variants"][0]["matrix"]), 1)


if __name__ == "__main__":
    unittest.main()
