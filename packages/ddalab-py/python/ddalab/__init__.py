"""Delay differential analysis (DDA) of neurophysiological recordings, from Python.

`read` opens a recording; `run` analyzes a file, a `Recording`, an MNE `Raw` or a NumPy array of shape
(channels, samples). Both use the engine, defaults and result document of the `ddalab run` command, which this package
also installs.

    import ddalab
    result = ddalab.run("sub-01_eeg.edf", variants=["ST", "CT"], wl=200, ws=100)
    result.variants["ST"].q          # (channels, windows)
    result.window_centers            # seconds
    result.save("result.json")       # the document `ddalab run -o result.json` writes
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import cached_property
from typing import TYPE_CHECKING, Any, Optional, Sequence, Tuple, Union

from . import _core

# NumPy is imported where an array is made: the `ddalab` command imports this package and starts without it.
if TYPE_CHECKING:
    import numpy as np

__version__: str = _core.__version__
__all__ = ["Recording", "Result", "VariantResult", "read", "run", "__version__"]

PathLike = Union[str, "os.PathLike[str]"]


@dataclass(frozen=True)
class Recording:
    """A recording as `ddalab` reads it: its analysis channels in SI units (volts for EEG)."""

    path: str
    data: np.ndarray
    """(channels, samples)."""
    sfreq: float
    ch_names: list
    events: list
    """Annotations: dicts with onset_s, duration_s, label and source."""
    info: dict
    """Format, all channels, sample count, duration and the reader's warnings."""


@dataclass(frozen=True)
class VariantResult:
    """One variant's arrays. Rows are channels, channel pairs or directed pairs (`row_labels`); columns are windows."""

    id: str
    label: str
    row_labels: list
    q: np.ndarray
    fit_error: Optional[np.ndarray]
    coefficients: Optional[np.ndarray]
    """(coefficients, rows, windows) when the engine fills them."""


class Result:
    """A finished run: the arrays of each variant and the result document `ddalab run` writes."""

    def __init__(self, analysis: Any) -> None:
        self._analysis = analysis
        self.variants = {
            id_: VariantResult(id_, label, rows, q, fit_error, coefficients)
            for id_, label, rows, q, fit_error, coefficients in analysis.variants()
        }
        self.window_centers: np.ndarray = analysis.window_centers()
        self.warnings: list = analysis.warnings

    @cached_property
    def document(self) -> dict:
        """The result document, as JSON would read it: non-finite values are None."""
        return json.loads(self._analysis.document_json())

    def save(self, path: PathLike, *, compact: bool = False) -> None:
        """Writes the result document as `ddalab run -o path` does."""
        self._analysis.save(os.fspath(path), compact)

    def __repr__(self) -> str:
        shapes = ", ".join(f"{k} {v.q.shape}" for k, v in self.variants.items())
        return f"<ddalab.Result {shapes}>"


def read(path: PathLike, *, sfreq: Optional[float] = None) -> Recording:
    """Opens the recording at `path` (EDF, BDF, BrainVision, EEGLAB, CSV or ASCII) with its BIDS sidecars.

    `sfreq` is the sample rate of a text recording without a time column.
    """
    path = os.fspath(path)
    info, data, events = _core.read(path, sfreq)
    info = json.loads(info)
    names = [info["channels"][i]["label"] for i in _analysis_channels(info)]
    return Recording(path, data, float(info["sample_rate_hz"]), names, json.loads(events), info)


TEXT_FORMATS = ("CSV", "ASCII")

# MNE's data channel types: an MNE Raw is analyzed on these, without the channels info["bads"] marks, as a file is on
# its signal channels without the BIDS bad ones. Stimulus, misc and other channels are left out.
DATA_TYPES = {"eeg", "seeg", "ecog", "dbs", "mag", "grad", "csd", "hbo", "hbr"}


def _raw_data(raw: Any) -> "tuple[np.ndarray, list]":
    """The data channels of an MNE Raw that are not marked bad, and their names."""
    names = list(raw.ch_names)
    types = raw.get_channel_types() if hasattr(raw, "get_channel_types") else ["eeg"] * len(names)
    bads = set(raw.info.get("bads", []) if hasattr(raw.info, "get") else [])
    picks = [i for i, (name, kind) in enumerate(zip(names, types)) if kind in DATA_TYPES and name not in bads]
    if not picks:
        raise ValueError("the Raw has no data channel that is not marked bad")
    return raw.get_data(picks=picks), [names[i] for i in picks]


def _analysis_channels(info: dict) -> list:
    rate = info["sample_rate_hz"]
    return [
        i
        for i, c in enumerate(info["channels"])
        if c["kind"] == "Signal" and c["sample_rate_hz"] == rate
    ]


def run(
    source: Any,
    *,
    variants: Optional[Sequence[str]] = None,
    wl: Optional[int] = None,
    ws: Optional[int] = None,
    delays: Optional[Sequence[int]] = None,
    model: Optional[Sequence[int]] = None,
    dm: Optional[int] = None,
    order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    channels: Optional[Sequence[int]] = None,
    start: Optional[float] = None,
    end: Optional[float] = None,
    ct_pairs: Optional[Sequence[Tuple[int, int]]] = None,
    cd_pairs: Optional[Sequence[Tuple[int, int]]] = None,
    sfreq: Optional[float] = None,
    ch_names: Optional[Sequence[str]] = None,
    device: Optional[str] = None,
) -> Result:
    """Runs DDA on `source` as `ddalab run` does; a parameter left None takes the command's default.

    `source` is a path, a `Recording` (its file is read again), an MNE `Raw` (anything with `get_data()`, `info["sfreq"]`
    and `ch_names`) or an array of shape (channels, samples) with `sfreq` and optional `ch_names`. `channels` index the
    analysis channels; `start` and `end` are seconds; pairs index `channels`. Raises ValueError for a request or input
    the command refuses.
    """
    import numpy as np

    data = None
    if isinstance(source, (str, os.PathLike)):
        file = os.fspath(source)
    elif isinstance(source, Recording):
        file = source.path
        # A text recording's rate is the one `read` was given (or found); other formats carry their own.
        if sfreq is None and source.info["format"] in TEXT_FORMATS:
            sfreq = source.sfreq
    elif hasattr(source, "get_data") and hasattr(source, "info"):
        data, ch_names = _raw_data(source)
        sfreq = float(source.info["sfreq"])
        file = "raw"
    else:
        data = source
        file = "array"
    if data is None and ch_names is not None:
        raise ValueError("ch_names names the rows of an array; a file names its own channels")
    if data is not None:
        data = np.ascontiguousarray(data, dtype=np.float64)
        if data.ndim != 2:
            raise ValueError(f"data has shape {data.shape}: pass a 2-D array of shape (channels, samples)")
        if data.shape[0] > data.shape[1]:
            raise ValueError(
                f"data has shape {data.shape}, more channels than samples: pass it as (channels, samples)"
            )
        if sfreq is None:
            raise ValueError("an array needs its sample rate: pass sfreq=")
        if ch_names is not None and len(ch_names) != data.shape[0]:
            raise ValueError(f"{len(ch_names)} ch_names for {data.shape[0]} channels")

    argv = ["ddalab", "run", "--file", file, "--quiet"]

    def flag(name: str, value: Any) -> None:
        if value is None:
            return
        values = value if isinstance(value, (list, tuple)) else [value]
        argv.extend([f"--{name}", *map(str, values)])

    if data is None:
        # The rate of a text file without a time column; other formats ignore it, as `ddalab run --sr` does.
        flag("sr", sfreq)
    flag("variants", list(variants) if variants is not None else None)
    flag("wl", wl)
    flag("ws", ws)
    flag("delays", list(delays) if delays is not None else None)
    flag("model", list(model) if model is not None else None)
    flag("dm", dm)
    flag("order", order)
    flag("nr-tau", nr_tau)
    flag("channels", list(channels) if channels is not None else None)
    flag("start", start)
    flag("end", end)
    flag("ct-pairs", [f"{i},{j}" for i, j in ct_pairs] if ct_pairs is not None else None)
    flag("cd-pairs", [f"{i},{j}" for i, j in cd_pairs] if cd_pairs is not None else None)
    flag("device", device)
    names = list(ch_names) if ch_names is not None else None
    return Result(_core.run(argv, data, sfreq, names))
