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
from typing import Any, Optional, Sequence, Tuple, Union

import numpy as np

from . import _core

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
    data = None
    if isinstance(source, (str, os.PathLike)):
        file = os.fspath(source)
    elif isinstance(source, Recording):
        file = source.path
    elif hasattr(source, "get_data") and hasattr(source, "info"):
        data = source.get_data()
        sfreq = float(source.info["sfreq"])
        ch_names = list(source.ch_names)
        file = "raw"
    else:
        data = source
        file = "array"
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
