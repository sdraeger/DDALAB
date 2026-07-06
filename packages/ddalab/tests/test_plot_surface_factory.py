from __future__ import annotations

# ruff: noqa: E402
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from PySide6.QtQuickWidgets import QQuickWidget
from PySide6.QtWidgets import QApplication

from qt.domain.models import ChannelWaveform, DdaVariantResult, WaveformWindow
from qt.ui.plot_data import (
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_matrix_view,
)
from qt.ui.plot_layers import PlotLayerConfig
from qt.ui.qt_plot_renderer import (
    MatrixRenderArtifacts,
    QtCpuMatrixPlotRenderer,
    QtSceneGraphWaveformRenderer,
    WaveformRenderArtifacts,
)
from qt.ui.plot_surface_factory import (
    create_result_plot_surface,
    create_waveform_plot_surface,
)
from qt.ui.quick_plot_surface import QuickPlotSurfaceBridge
from qt.ui.quick_waveform_surface import QuickWaveformSurfaceBridge


class PlotSurfaceFactoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def test_waveform_surface_factory_creates_qml_surface_when_enabled(self) -> None:
        surface = create_waveform_plot_surface(enabled=True)

        self.assertIsNotNone(surface)
        assert surface is not None
        self.assertIsInstance(surface.bridge, QuickWaveformSurfaceBridge)
        self.assertIsInstance(surface.widget, QQuickWidget)
        self.assertIs(
            surface.widget.rootContext().contextProperty("waveformBridge"),
            surface.bridge,
        )

    def test_result_surface_factory_creates_qml_surface_when_enabled(self) -> None:
        surface = create_result_plot_surface(enabled=True)

        self.assertIsNotNone(surface)
        assert surface is not None
        self.assertIsInstance(surface.bridge, QuickPlotSurfaceBridge)
        self.assertIsInstance(surface.widget, QQuickWidget)
        self.assertIs(
            surface.widget.rootContext().contextProperty("plotBridge"),
            surface.bridge,
        )

    def test_surface_factories_return_none_when_disabled(self) -> None:
        self.assertIsNone(create_waveform_plot_surface(enabled=False))
        self.assertIsNone(create_result_plot_surface(enabled=False))

    def test_surface_factories_do_not_embed_qml_surfaces_by_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(create_waveform_plot_surface())
            self.assertIsNone(create_result_plot_surface())

    def test_result_surface_factory_accepts_replaceable_matrix_renderer(self) -> None:
        renderer = _RecordingMatrixRenderer()
        surface = create_result_plot_surface(enabled=True, renderer=renderer)
        assert surface is not None

        surface.bridge.set_matrix_view(
            build_matrix_view(_variant(), target_columns=4),
            title="ST heatmap",
            color_scheme="cool",
        )

        self.assertEqual(renderer.calls, 1)
        self.assertEqual(renderer.color_schemes, ["cool"])
        self.assertEqual(surface.bridge.rendererName, "Recording matrix renderer")

    def test_result_surface_factory_applies_plot_layer_config(self) -> None:
        surface = create_result_plot_surface(
            enabled=True,
            plot_layers=PlotLayerConfig(cursor=False, line=False),
        )
        assert surface is not None

        self.assertFalse(surface.bridge.showCursorLayer)
        self.assertFalse(surface.bridge.showLineLayer)
        self.assertTrue(surface.bridge.showHeatmapLayer)

    def test_waveform_surface_factory_applies_plot_layer_config(self) -> None:
        surface = create_waveform_plot_surface(
            enabled=True,
            plot_layers=PlotLayerConfig(waveform=False, annotations=False),
        )
        assert surface is not None

        self.assertFalse(surface.bridge.showWaveformLayer)
        self.assertFalse(surface.bridge.showAnnotationsLayer)

    def test_waveform_surface_factory_accepts_replaceable_waveform_renderer(
        self,
    ) -> None:
        renderer = _RecordingWaveformRenderer()
        surface = create_waveform_plot_surface(enabled=True, renderer=renderer)
        assert surface is not None

        surface.bridge.set_waveform_window(_window(), title="Waveform", target_width=80)

        self.assertEqual(renderer.calls, 1)
        self.assertEqual(renderer.requests[0].target_width, 80)
        self.assertEqual(surface.bridge.rendererName, "Recording waveform renderer")


def _variant() -> DdaVariantResult:
    return DdaVariantResult(
        id="ST",
        label="Single Timeseries",
        row_labels=["A", "B"],
        matrix=[
            list(range(10)),
            list(range(10, 20)),
        ],
        summary="",
        min_value=0.0,
        max_value=20.0,
        column_count=10,
    )


def _window() -> WaveformWindow:
    return WaveformWindow(
        dataset_file_path="demo.edf",
        start_time_seconds=0.0,
        duration_seconds=1.0,
        channels=[
            ChannelWaveform(
                name="Cz",
                sample_rate_hz=1000.0,
                samples=[0.0, 0.5, 1.0],
                unit="uV",
                min_value=0.0,
                max_value=1.0,
                levels=[],
            )
        ],
        from_cache=False,
    )


class _RecordingMatrixRenderer:
    name = "Recording matrix renderer"

    def __init__(self) -> None:
        self.calls = 0
        self.color_schemes: list[str] = []

    def render(self, view, *, color_scheme: str) -> MatrixRenderArtifacts:
        self.calls += 1
        self.color_schemes.append(color_scheme)
        return QtCpuMatrixPlotRenderer().render(view, color_scheme=color_scheme)


class _RecordingWaveformRenderer:
    name = "Recording waveform renderer"

    def __init__(self) -> None:
        self.calls = 0
        self.requests: list[WaveformViewRequest] = []

    def render(
        self,
        provider: WaveformWindowPlotProvider,
        request: WaveformViewRequest,
    ) -> WaveformRenderArtifacts:
        self.calls += 1
        self.requests.append(request)
        return QtSceneGraphWaveformRenderer().render(provider, request)


if __name__ == "__main__":
    unittest.main()
