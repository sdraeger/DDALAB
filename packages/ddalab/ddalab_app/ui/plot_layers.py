from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlotLayerConfig:
    waveform: bool = True
    heatmap: bool = True
    line: bool = True
    annotations: bool = True
    cursor: bool = True
