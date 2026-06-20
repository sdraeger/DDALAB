from __future__ import annotations

# ruff: noqa: E402
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_qt.domain.models import ChannelWaveform, WaveformWindow
from ddalab_qt.ui import quick_waveform_surface
from ddalab_qt.ui.plot_data import WaveformViewRequest, WaveformWindowPlotProvider
from ddalab_qt.ui.plot_layers import PlotLayerConfig
from ddalab_qt.ui.qt_plot_renderer import (
    QtSceneGraphWaveformRenderer,
    WaveformRenderArtifacts,
)
from ddalab_qt.ui.quick_waveform_surface import (
    QuickWaveformGeometryItem,
    QuickWaveformSurfaceBridge,
    create_quick_waveform_surface_widget,
    quick_waveform_surface_qml_path,
    update_quick_waveform_bridge,
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


def _multi_channel_window() -> WaveformWindow:
    return WaveformWindow(
        dataset_file_path="demo.edf",
        start_time_seconds=0.0,
        duration_seconds=1.0,
        channels=[
            ChannelWaveform(
                name="Fp1",
                sample_rate_hz=1000.0,
                samples=[0.0, 0.5, 1.0],
                unit="uV",
                min_value=0.0,
                max_value=1.0,
                levels=[],
            ),
            ChannelWaveform(
                name="Cz",
                sample_rate_hz=1000.0,
                samples=[10.0, 10.5, 11.0],
                unit="uV",
                min_value=10.0,
                max_value=11.0,
                levels=[],
            ),
        ],
        from_cache=False,
    )


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


class QuickWaveformSurfaceTests(unittest.TestCase):
    def test_qml_asset_is_available_for_packaging(self) -> None:
        qml_path = quick_waveform_surface_qml_path()

        self.assertTrue(qml_path.exists())
        self.assertEqual(qml_path.name, "QuickWaveformSurface.qml")

    def test_bridge_exposes_waveform_geometry_metadata_for_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)

        self.assertEqual(bridge.title, "Waveform")
        self.assertEqual(bridge.rendererName, "Qt Quick scene graph waveform renderer")
        self.assertEqual(bridge.channelStart, 0)
        self.assertEqual(bridge.channelCount, 1)
        self.assertEqual(bridge.totalChannelCount, 1)
        self.assertEqual(bridge.geometryRevision, 1)
        self.assertIn("1 channels", bridge.statusText)
        self.assertEqual(len(bridge.waveform_geometry().lines), 1)

    def test_bridge_exposes_configurable_waveform_layer_for_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        changed = bridge.set_plot_layers(PlotLayerConfig(waveform=False))

        self.assertTrue(changed)
        self.assertFalse(bridge.showWaveformLayer)
        self.assertFalse(bridge.set_plot_layers(PlotLayerConfig(waveform=False)))

    def test_bridge_exposes_configurable_annotation_layer_for_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        changed = bridge.set_plot_layers(PlotLayerConfig(annotations=False))

        self.assertTrue(changed)
        self.assertFalse(bridge.showAnnotationsLayer)

    def test_bridge_clear_removes_stale_waveform_geometry(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)

        bridge.clear()

        self.assertEqual(bridge.title, "DDALAB waveform")
        self.assertEqual(bridge.channelCount, 0)
        self.assertEqual(bridge.geometryRevision, 2)
        self.assertEqual(len(bridge.waveform_geometry().lines), 0)

    def test_bridge_reuses_geometry_cache_for_unchanged_waveform_window(self) -> None:
        renderer = _RecordingWaveformRenderer()
        bridge = QuickWaveformSurfaceBridge(renderer=renderer)
        window = _window()

        bridge.set_waveform_window(window, title="Waveform", target_width=80)
        bridge.set_waveform_window(window, title="Waveform", target_width=80)

        self.assertEqual(renderer.calls, 1)
        self.assertEqual(bridge.geometryRevision, 1)

    def test_bridge_logs_render_cache_lookup_outcomes(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        window = _window()
        logger = Mock()

        with patch(
            "ddalab_qt.ui.quick_waveform_surface.perf_logger",
            return_value=logger,
            create=True,
        ):
            bridge.set_waveform_window(window, title="Waveform", target_width=80)
            bridge.set_waveform_window(window, title="Waveform", target_width=80)

        cache_logs = [
            call
            for call in logger.log.call_args_list
            if call.args == ("qml.render_cache.lookup",)
        ]
        self.assertEqual([call.kwargs["hit"] for call in cache_logs], [False, True])
        self.assertEqual(
            [call.kwargs["surface"] for call in cache_logs],
            ["waveform", "waveform"],
        )
        self.assertEqual([call.kwargs["channels"] for call in cache_logs], [1, 1])
        self.assertEqual([call.kwargs["channelStart"] for call in cache_logs], [0, 0])
        self.assertEqual([call.kwargs["totalChannels"] for call in cache_logs], [1, 1])
        self.assertEqual([call.kwargs["samples"] for call in cache_logs], [3, 3])
        self.assertEqual(
            [call.kwargs["layerWaveform"] for call in cache_logs],
            [True, True],
        )
        self.assertEqual(
            [call.kwargs["layerAnnotations"] for call in cache_logs],
            [True, True],
        )

    def test_bridge_reuses_recent_cached_geometry_after_target_width_switch(
        self,
    ) -> None:
        renderer = _RecordingWaveformRenderer()
        bridge = QuickWaveformSurfaceBridge(renderer=renderer)
        window = _window()

        bridge.set_waveform_window(window, title="Waveform", target_width=80)
        bridge.set_waveform_window(window, title="Waveform", target_width=120)
        bridge.set_waveform_window(window, title="Waveform", target_width=80)

        self.assertEqual(renderer.calls, 2)
        self.assertEqual(bridge.geometryRevision, 3)
        self.assertEqual(bridge.channelCount, 1)

    def test_bridge_invalidates_geometry_cache_when_target_width_changes(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        window = _window()

        bridge.set_waveform_window(window, title="Waveform", target_width=80)
        bridge.set_waveform_window(window, title="Waveform", target_width=120)

        self.assertEqual(bridge.geometryRevision, 2)

    def test_default_waveform_renderer_returns_scene_graph_geometry(self) -> None:
        provider = WaveformWindowPlotProvider(_window())
        request = WaveformViewRequest(target_width=80)

        artifacts = QtSceneGraphWaveformRenderer().render(provider, request)

        self.assertEqual(artifacts.geometry.channel_count, 1)
        self.assertEqual(len(artifacts.geometry.lines), 1)

    def test_bridge_uses_injected_waveform_renderer(self) -> None:
        renderer = _RecordingWaveformRenderer()
        bridge = QuickWaveformSurfaceBridge(renderer=renderer)

        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)

        self.assertEqual(renderer.calls, 1)
        self.assertEqual(renderer.requests[0].target_width, 80)
        self.assertEqual(bridge.rendererName, "Recording waveform renderer")
        self.assertEqual(bridge.channelCount, 1)

    def test_scene_graph_item_tracks_bridge_and_has_contents(self) -> None:
        from PySide6.QtQuick import QQuickItem

        bridge = QuickWaveformSurfaceBridge()
        item = QuickWaveformGeometryItem()

        item.bridge = bridge

        self.assertIs(item.bridge, bridge)
        self.assertTrue(item.flags() & QQuickItem.ItemHasContents)

    def test_scene_graph_item_logs_slow_waveform_updates(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)
        item = QuickWaveformGeometryItem()
        item.bridge = bridge
        item.setWidth(160)
        item.setHeight(80)
        logger = Mock()

        with (
            patch(
                "ddalab_qt.ui.quick_waveform_surface.perf_counter_ns",
                side_effect=[0, 20_000_000],
                create=True,
            ),
            patch(
                "ddalab_qt.ui.quick_waveform_surface.perf_logger",
                return_value=logger,
                create=True,
            ),
        ):
            item.updatePaintNode(None, None)

        logger.log_slow.assert_called_once()
        self.assertEqual(
            logger.log_slow.call_args.args[1],
            "qml.scene_graph.waveform.update",
        )
        self.assertEqual(logger.log_slow.call_args.kwargs["nodes"], 1)
        self.assertEqual(logger.log_slow.call_args.kwargs["vertices"], 3)

    def test_factory_creates_embeddable_qquickwidget_surface(self) -> None:
        from PySide6.QtQuickWidgets import QQuickWidget
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])
        bridge = QuickWaveformSurfaceBridge()

        widget = create_quick_waveform_surface_widget(bridge)

        self.assertIsInstance(widget, QQuickWidget)
        self.assertIs(widget.rootContext().contextProperty("waveformBridge"), bridge)
        self.assertTrue(widget.ddalabWaveformSceneGraphTypesRegistered)
        self.assertEqual(
            widget.source().toLocalFile(), str(quick_waveform_surface_qml_path())
        )
        self.assertIsNotNone(app)

    def test_update_helper_populates_bridge_from_waveform_window(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        update_quick_waveform_bridge(
            bridge,
            _window(),
            target_width=96,
            title="Quick waveform",
        )

        self.assertEqual(bridge.title, "Quick waveform")
        self.assertEqual(bridge.channelCount, 1)
        self.assertEqual(bridge.geometryRevision, 1)

    def test_update_helper_uses_plot_provider_boundary(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        window = _window()

        with patch(
            "ddalab_qt.ui.quick_waveform_surface.WaveformWindowPlotProvider",
            wraps=quick_waveform_surface.WaveformWindowPlotProvider,
        ) as provider_class:
            update_quick_waveform_bridge(
                bridge,
                window,
                target_width=96,
                title="Quick waveform",
            )

        provider_class.assert_called_once_with(window)
        self.assertEqual(bridge.channelCount, 1)

    def test_update_helper_accepts_visible_channel_range(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        update_quick_waveform_bridge(
            bridge,
            _multi_channel_window(),
            target_width=96,
            channel_start=1,
            channel_count=1,
        )

        self.assertEqual(bridge.channelCount, 1)
        self.assertEqual(bridge.channelStart, 1)
        self.assertEqual(bridge.totalChannelCount, 2)
        self.assertEqual(bridge.waveform_geometry().channel_labels, ("Cz",))

    def test_update_helper_accepts_visible_time_window(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        update_quick_waveform_bridge(
            bridge,
            WaveformWindow(
                dataset_file_path="demo.edf",
                start_time_seconds=0.0,
                duration_seconds=1.0,
                channels=[
                    ChannelWaveform(
                        name="Cz",
                        sample_rate_hz=1000.0,
                        samples=[float(value) for value in range(9)],
                        unit="uV",
                        min_value=0.0,
                        max_value=8.0,
                        levels=[],
                    )
                ],
                from_cache=False,
            ),
            target_width=96,
            start_fraction=0.25,
            span_fraction=0.5,
        )

        self.assertEqual(bridge.waveform_geometry().sample_count, 5)
        self.assertIn("5 visible samples", bridge.statusText)


if __name__ == "__main__":
    unittest.main()
