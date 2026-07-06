from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import QObject
from PySide6.QtQuickWidgets import QQuickWidget
from PySide6.QtWidgets import QWidget

from .plot_layers import PlotLayerConfig
from .qt_plot_renderer import MatrixPlotRenderer, WaveformPlotRenderer
from .quick_plot_surface import (
    QuickPlotSurfaceBridge,
    create_quick_plot_surface_widget,
    quick_plots_enabled,
)
from .quick_waveform_surface import (
    QuickWaveformSurfaceBridge,
    create_quick_waveform_surface_widget,
)


@dataclass(frozen=True)
class PlotSurface:
    bridge: QObject
    widget: QQuickWidget


def create_waveform_plot_surface(
    parent: QWidget | None = None,
    *,
    enabled: bool | None = None,
    renderer: WaveformPlotRenderer | None = None,
    plot_layers: PlotLayerConfig | None = None,
) -> PlotSurface | None:
    if not _enabled(enabled):
        return None
    bridge = QuickWaveformSurfaceBridge(parent, renderer=renderer)
    if plot_layers is not None:
        bridge.set_plot_layers(plot_layers)
    return PlotSurface(
        bridge=bridge,
        widget=create_quick_waveform_surface_widget(bridge, parent),
    )


def create_result_plot_surface(
    parent: QWidget | None = None,
    *,
    enabled: bool | None = None,
    renderer: MatrixPlotRenderer | None = None,
    plot_layers: PlotLayerConfig | None = None,
) -> PlotSurface | None:
    if not _enabled(enabled):
        return None
    bridge = QuickPlotSurfaceBridge(parent, renderer=renderer)
    if plot_layers is not None:
        bridge.set_plot_layers(plot_layers)
    return PlotSurface(
        bridge=bridge,
        widget=create_quick_plot_surface_widget(bridge, parent),
    )


def _enabled(enabled: bool | None) -> bool:
    return quick_plots_enabled() if enabled is None else bool(enabled)
