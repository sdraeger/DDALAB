"""Writes the EEGLAB fixtures of tests/io_eeglab.rs with SciPy's MAT-file writer, a writer independent of the reader.

Question: does dda-rs read an EEGLAB dataset as EEGLAB stores it, in both layouts EEGLAB writes?

Both datasets hold 4 channels (Fp1, Fp2, Cz, Pz) of 512 samples at 256 Hz, one trial, with
    data[c, t] = 100 * (c + 1) + (t mod 64) - 32   (microvolts, exact in float32)
and two events: type "stim" at latency 129 (1-based samples) with duration 0, and type 7 at latency 257.5 with
duration 64.

    fixture_eeglab.set + fixture_eeglab.fdt: one variable EEG (a 1x1 struct), uncompressed (MATLAB -v6); EEG.data
        names the .fdt, which holds float32 samples channel by channel within each sample (column-major nbchan x pnts).
    fixture_eeglab_inline.set: EEG's fields as top-level variables (EEGLAB 2019 and later), zlib-compressed
        (MATLAB -v7), the samples inline in `data` as single.

Command (needs NumPy and SciPy): python3 make_eeglab.py <output folder>
"""

import sys
from pathlib import Path

import numpy as np
from scipy.io import savemat

out = Path(sys.argv[1])
nbchan, pnts, srate = 4, 512, 256.0
c, t = np.meshgrid(np.arange(nbchan), np.arange(pnts), indexing="ij")
data = (100 * (c + 1) + (t % 64) - 32).astype("<f4")

chanlocs = np.zeros((1, nbchan), dtype=[("labels", "O"), ("type", "O")])
for i, label in enumerate(["Fp1", "Fp2", "Cz", "Pz"]):
    chanlocs[0, i] = (label, "EEG")
event = np.zeros((1, 2), dtype=[("type", "O"), ("latency", "O"), ("duration", "O")])
event[0, 0] = ("stim", 129.0, 0.0)
event[0, 1] = (7.0, 257.5, 64.0)

fields = {
    "setname": "fixture",
    "nbchan": float(nbchan),
    "trials": 1.0,
    "pnts": float(pnts),
    "srate": srate,
    "xmin": 0.0,
    "xmax": (pnts - 1) / srate,
    "chanlocs": chanlocs,
    "event": event,
}

(out / "fixture_eeglab.fdt").write_bytes(data.tobytes(order="F"))
savemat(out / "fixture_eeglab.set", {"EEG": {**fields, "data": "fixture_eeglab.fdt"}}, format="5")
savemat(out / "fixture_eeglab_inline.set", {**fields, "data": data}, format="5", do_compression=True)
