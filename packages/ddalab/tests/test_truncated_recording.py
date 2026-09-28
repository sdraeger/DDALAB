import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from ddalab_app.backend.readers.mne import MneDatasetReader

HEADER = """Brain Vision Data Exchange Header File Version 1.0

[Common Infos]
Codepage=UTF-8
DataFile={stem}.eeg
MarkerFile={stem}.vmrk
DataFormat=BINARY
DataOrientation=MULTIPLEXED
NumberOfChannels=2
SamplingInterval=1000

[Binary Infos]
BinaryFormat=IEEE_FLOAT_32

[Channel Infos]
Ch1=A1,,1,uV
Ch2=A2,,1,uV
"""
MARKERS = """Brain Vision Data Exchange Marker File, Version 1.0

[Common Infos]
Codepage=UTF-8
DataFile={stem}.eeg

[Marker Infos]
Mk1=New Segment,,1,1,0
"""


def write_recording(
    folder: Path, name: str, samples: int, extra_bytes: int, rate: float = 1000
) -> str:
    stem = f"sub-{name}_task-rest_ieeg"
    (folder / f"{stem}.vhdr").write_text(HEADER.format(stem=stem))
    (folder / f"{stem}.vmrk").write_text(MARKERS.format(stem=stem))
    data = np.zeros((samples, 2), dtype="<f4").tobytes() + b"\0" * extra_bytes
    (folder / f"{stem}.eeg").write_bytes(data)
    sidecar = {"SamplingFrequency": rate, "RecordingDuration": 10.0}
    (folder / f"{stem}.json").write_text(json.dumps(sidecar))
    return str(folder / f"{stem}.vhdr")


class TruncatedRecordingTest(unittest.TestCase):
    def test_delimited_file_keeps_gaps_duplicate_names_and_time_header(self) -> None:
        from ddalab_app.backend.readers.delimited import DelimitedDatasetReader

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gap.csv"
            rows = [f"{i / 100},{i},{'' if 40 <= i < 45 else -i}" for i in range(100)]
            path.write_text("Time (s),A,A\n" + "\n".join(rows) + "\n1.0,5\n")
            reader = DelimitedDatasetReader(str(path))
            meta = reader.load_metadata()
            self.assertEqual(meta.channel_names, ["A", "A-2"])
            self.assertEqual(meta.channels[0].sample_rate_hz, 100.0)
            self.assertEqual(meta.total_sample_count, 101)
            self.assertTrue(any("gaps (NaN)" in warning for warning in meta.warnings))
            window = reader.load_waveform_window(0.0, 1.0, ["A-2"])
            self.assertEqual(window.channels[0].samples[1], -1.0)
            # DDA reads these samples; float32 changed coefficients by 0.7%
            self.assertEqual(window.channels[0].samples.dtype, np.float64)
            self.assertEqual(window.channels[0].min_value, -99.0)

    def test_nwb_uses_the_series_electrodes_and_scaling(self) -> None:
        from datetime import datetime, timezone

        from pynwb import NWBHDF5IO, NWBFile
        from pynwb.ecephys import ElectricalSeries

        from ddalab_app.backend.readers.nwb import NwbDatasetReader

        nwb = NWBFile("probe", "probe", datetime(2026, 1, 1, tzinfo=timezone.utc))
        device = nwb.create_device("amp")
        group = nwb.create_electrode_group("g", "g", "brain", device)
        for _ in range(4):
            nwb.add_electrode(group=group, location="brain")
        region = nwb.create_electrode_table_region([1, 3], "recorded")
        data = np.arange(20, dtype=np.int16).reshape(10, 2)
        nwb.add_acquisition(
            ElectricalSeries(
                "es",
                data,
                region,
                rate=100.0,
                conversion=2.0,
                offset=0.5,
                starting_time=10.0,
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "probe.nwb"
            with NWBHDF5IO(str(path), "w") as io:
                io.write(nwb)
            reader = NwbDatasetReader(str(path))
            meta = reader.load_metadata()
            window = reader.load_waveform_window(0.0, 0.1, meta.channel_names)
            reader.close()
        self.assertEqual(meta.channel_names, ["Electrode 1", "Electrode 3"])
        self.assertEqual(
            window.channels[1].samples[:2].tolist(), [2 * 1 + 0.5, 2 * 3 + 0.5]
        )
        self.assertTrue(any("10.0 s" in note for note in meta.notes))

    def test_truncated_or_drifting_brainvision_file_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            truncated = MneDatasetReader(write_recording(folder, "a", 1339, 4))
            intact = MneDatasetReader(write_recording(folder, "b", 10_000, 0))
            drifting = MneDatasetReader(write_recording(folder, "c", 10_000, 0, 990))
            warnings = truncated.load_metadata().warnings
            self.assertEqual(truncated.load_metadata().total_sample_count, 1339)
            self.assertEqual(len(warnings), 2)
            self.assertIn("incomplete sample frame", warnings[0])
            self.assertIn("appears truncated", warnings[1])
            self.assertEqual(intact.load_metadata().warnings, [])
            self.assertIn("drift", drifting.load_metadata().warnings[0])


if __name__ == "__main__":
    unittest.main()
