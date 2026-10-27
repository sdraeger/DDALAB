"""The Python library runs the analysis of `ddalab run`: from a file, a NumPy array or an MNE-like object."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

import ddalab

EDF = Path(__file__).resolve().parents[2] / "dda-rs" / "tests" / "fixtures" / "fixture.edf"


def cli_document(tmp_path, *args):
    """The document `ddalab run` writes for the fixture with `args`."""
    out = tmp_path / "cli.json"
    command = [sys.executable, "-m", "ddalab", "run", "--file", str(EDF), "--quiet", "--compact", "-o", str(out)]
    subprocess.run([*command, *args], check=True)
    return json.loads(out.read_text())


def matrix(rows):
    """A document matrix as an array: JSON writes non-finite values as null."""
    return np.array([[np.nan if v is None else v for v in row] for row in rows], dtype=float)


def assert_same_arrays(a, b):
    assert a.variants.keys() == b.variants.keys()
    for name in a.variants:
        np.testing.assert_array_equal(a.variants[name].q, b.variants[name].q)
    np.testing.assert_array_equal(a.window_centers, b.window_centers)


def test_run_file_equals_cli(tmp_path):
    expected = cli_document(tmp_path)
    result = ddalab.run(EDF)
    assert [v["id"] for v in expected["variants"]] == list(result.variants)
    for variant in expected["variants"]:
        np.testing.assert_array_equal(result.variants[variant["id"]].q, matrix(variant["matrix"]))
        assert result.variants[variant["id"]].row_labels == variant["row_labels"]
    np.testing.assert_array_equal(result.window_centers, expected["window_centers_seconds"])
    assert result.document["reproduction"] == expected["reproduction"]


def test_parameters_reach_the_engine(tmp_path):
    args = ["--variants", "ST", "CT", "--wl", "100", "--ws", "50", "--channels", "0", "1", "--ct-pairs", "0,1"]
    expected = cli_document(tmp_path, *args)
    result = ddalab.run(EDF, variants=["ST", "CT"], wl=100, ws=50, channels=[0, 1], ct_pairs=[(0, 1)])
    assert result.document["reproduction"] == expected["reproduction"]
    assert result.document["reproduction"]["window_length_samples"] == 100
    for variant in expected["variants"]:
        np.testing.assert_array_equal(result.variants[variant["id"]].q, matrix(variant["matrix"]))


def test_read_gives_channels_by_samples():
    recording = ddalab.read(EDF)
    assert recording.data.shape == (len(recording.ch_names), recording.info["sample_count"])
    assert recording.sfreq == recording.info["sample_rate_hz"]
    assert isinstance(recording.events, list)


def test_array_input_equals_file():
    recording = ddalab.read(EDF)
    from_array = ddalab.run(recording.data, sfreq=recording.sfreq, ch_names=recording.ch_names)
    assert_same_arrays(from_array, ddalab.run(EDF))
    assert from_array.variants["ST"].row_labels == ddalab.run(EDF).variants["ST"].row_labels


def test_recording_input_runs_its_file():
    assert_same_arrays(ddalab.run(ddalab.read(EDF)), ddalab.run(EDF))


def test_mne_like_input_equals_file():
    recording = ddalab.read(EDF)

    class Raw:
        info = {"sfreq": recording.sfreq}
        ch_names = recording.ch_names

        def get_data(self, picks=None):
            return recording.data if picks is None else recording.data[picks]

    assert_same_arrays(ddalab.run(Raw()), ddalab.run(EDF))


def test_samples_by_channels_is_refused_by_name():
    recording = ddalab.read(EDF)
    with pytest.raises(ValueError, match=r"\(channels, samples\)"):
        ddalab.run(recording.data.T, sfreq=recording.sfreq)


def test_an_array_needs_its_rate():
    with pytest.raises(ValueError, match="sfreq"):
        ddalab.run(ddalab.read(EDF).data)


def test_float32_and_fortran_order_are_accepted():
    recording = ddalab.read(EDF)
    data = np.asfortranarray(recording.data.astype(np.float32))
    result = ddalab.run(data, sfreq=recording.sfreq)
    assert result.variants["ST"].q.shape == ddalab.run(EDF).variants["ST"].q.shape


def test_a_bad_request_raises_value_error():
    with pytest.raises(ValueError, match="nope"):
        ddalab.run(EDF, variants=["nope"])


def test_save_writes_the_document(tmp_path):
    result = ddalab.run(EDF)
    result.save(tmp_path / "result.json")
    assert json.loads((tmp_path / "result.json").read_text()) == result.document


def headerless_csv(tmp_path):
    """Two channels, 3000 rows, no header and no time column: only a given rate places it in time."""
    rows = np.sin(np.arange(3000)[:, None] * np.array([[0.05, 0.11]]))
    path = tmp_path / "plain.csv"
    np.savetxt(path, rows, delimiter=",")
    return path


def test_the_rate_of_a_text_file_reaches_the_engine(tmp_path):
    path = headerless_csv(tmp_path)
    out = tmp_path / "cli.json"
    command = [sys.executable, "-m", "ddalab", "run", "--file", str(path), "--sr", "500", "--start", "1", "--end", "5"]
    subprocess.run([*command, "--quiet", "--compact", "-o", str(out)], check=True)
    expected = json.loads(out.read_text())
    result = ddalab.run(path, sfreq=500, start=1, end=5)
    np.testing.assert_array_equal(result.window_centers, expected["window_centers_seconds"])
    assert result.document["reproduction"] == expected["reproduction"]
    # A recording read at a rate is run at that rate.
    again = ddalab.run(ddalab.read(path, sfreq=500), start=1, end=5)
    np.testing.assert_array_equal(again.window_centers, result.window_centers)


def test_channel_names_for_a_file_are_refused(tmp_path):
    with pytest.raises(ValueError, match="ch_names"):
        ddalab.run(EDF, ch_names=["a", "b"])


def test_mne_input_leaves_out_bad_and_stimulus_channels():
    recording = ddalab.read(EDF)
    names = [*recording.ch_names, "STI 014"]
    data = np.vstack([recording.data, np.zeros(recording.data.shape[1])])

    class Raw:
        info = {"sfreq": recording.sfreq, "bads": [names[0]]}
        ch_names = names

        def get_channel_types(self):
            return ["eeg"] * len(recording.ch_names) + ["stim"]

        def get_data(self, picks=None):
            return data if picks is None else data[picks]

    result = ddalab.run(Raw())
    assert result.variants["ST"].row_labels == recording.ch_names[1:]


def test_the_command_starts_without_numpy():
    code = "import sys, ddalab._cli; print('numpy' in sys.modules)"
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert done.stdout.strip() == "False"
