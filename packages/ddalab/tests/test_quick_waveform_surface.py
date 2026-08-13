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

from ddalab_app.domain.models import ChannelWaveform, WaveformAnnotation, WaveformWindow
from ddalab_app.ui import quick_waveform_surface
from ddalab_app.ui.plot_data import WaveformViewRequest, WaveformWindowPlotProvider
from ddalab_app.ui.plot_layers import PlotLayerConfig
from ddalab_app.ui.qt_plot_renderer import (
    QtSceneGraphWaveformRenderer,
    WaveformRenderArtifacts,
)
from ddalab_app.ui.quick_waveform_surface import (
    QuickWaveformSurfaceBridge,
    QuickWaveformTextureItem,
    quick_waveform_surface_qml_path,
    update_quick_waveform_bridge,
)
from ddalab_app.ui.style import theme_colors


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

        qml = qml_path.read_text(encoding="utf-8")
        self.assertIn("QuickWaveformTextureItem", qml)
        self.assertIn("root.waveformBridge.hasImage", qml)

    def test_bridge_emits_viewport_interactions(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        zoom_requests: list[tuple[float, float]] = []
        pan_requests: list[float] = []
        bridge.viewport_zoom_requested.connect(
            lambda factor, anchor: zoom_requests.append((factor, anchor))
        )
        bridge.viewport_pan_requested.connect(pan_requests.append)

        bridge.requestZoom(0.8, 0.25)
        bridge.requestPan(0.1)

        self.assertEqual(zoom_requests, [(0.8, 0.25)])
        self.assertEqual(pan_requests, [0.1])

    def test_qml_exposes_pan_zoom_and_annotation_interactions(self) -> None:
        qml = quick_waveform_surface_qml_path().read_text(encoding="utf-8")

        self.assertIn("requestZoom", qml)
        self.assertIn("requestPan", qml)
        self.assertIn("requestAnnotationContext", qml)

    def test_qml_exposes_time_and_channel_axes(self) -> None:
        qml = quick_waveform_surface_qml_path().read_text(encoding="utf-8")

        self.assertIn("waveformBridge.channelLabels", qml)
        self.assertIn("waveformBridge.timeTicks", qml)
        self.assertIn('text: "Time (s)"', qml)

    def test_qml_uses_bridge_theme_tokens_instead_of_hardcoded_dark_colors(
        self,
    ) -> None:
        qml = quick_waveform_surface_qml_path().read_text(encoding="utf-8")

        self.assertIn("root.theme.surface", qml)
        self.assertIn("root.theme.canvas", qml)
        self.assertNotIn('color: "#101820"', qml)
        self.assertNotIn('color: "#111c29"', qml)

    def test_bridge_exposes_current_theme_for_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        with patch(
            "ddalab_app.ui.quick_waveform_surface.current_theme_colors",
            return_value=theme_colors("light"),
        ):
            theme = bridge.theme

        self.assertEqual(theme["surface"], "#ffffff")
        self.assertEqual(theme["canvas"], "#f3f7fb")
        self.assertEqual(theme["text"], "#13202c")
        self.assertEqual(theme["mutedText"], "#627387")
        self.assertEqual(theme["border"], "#b7c7d8")
        self.assertEqual(theme["annotationChannel"], "#d97706")
        self.assertEqual(theme["annotationGlobal"], "#0891b2")

    def test_refresh_theme_notifies_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        emissions: list[bool] = []
        bridge.changed.connect(lambda: emissions.append(True))

        bridge.refresh_theme()

        self.assertEqual(emissions, [True])

    def test_bridge_exposes_waveform_geometry_metadata_for_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()

        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)

        self.assertEqual(bridge.title, "Waveform")
        self.assertEqual(bridge.rendererName, "Qt Quick texture waveform renderer")
        self.assertEqual(bridge.channelStart, 0)
        self.assertEqual(bridge.channelCount, 1)
        self.assertEqual(bridge.totalChannelCount, 1)
        self.assertEqual(bridge.geometryRevision, 1)
        self.assertTrue(bridge.hasImage)
        image = bridge.image()
        self.assertFalse(image.isNull())
        self.assertTrue(
            any(
                image.pixelColor(x, y).alpha() > 0
                for y in range(image.height())
                for x in range(image.width())
            )
        )
        self.assertIn("1 channels", bridge.statusText)
        self.assertEqual(len(bridge.waveform_geometry().lines), 1)
        self.assertEqual(bridge.channelLabels, ["Cz"])
        self.assertEqual(
            bridge.timeTicks,
            [
                {"position": 0.0, "label": "0.0"},
                {"position": 0.2, "label": "0.2"},
                {"position": 0.4, "label": "0.4"},
                {"position": 0.6, "label": "0.6"},
                {"position": 0.8, "label": "0.8"},
                {"position": 1.0, "label": "1.0"},
            ],
        )

    def test_bridge_time_axis_uses_absolute_window_time(self) -> None:
        window = _window()
        window.start_time_seconds = 12.5
        window.duration_seconds = 2.0
        bridge = QuickWaveformSurfaceBridge()

        bridge.set_waveform_window(window, title="Waveform", target_width=80)

        self.assertEqual(bridge.timeTicks[0], {"position": 0.0, "label": "12.5"})
        self.assertEqual(bridge.timeTicks[-1], {"position": 1.0, "label": "14.5"})

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

    def test_bridge_exposes_visible_annotation_items_for_qml(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        bridge.set_waveform_window(
            _multi_channel_window(),
            title="Waveform",
            target_width=80,
        )

        changed = bridge.set_annotations(
            [
                WaveformAnnotation(
                    id="global",
                    label="Seizure",
                    notes="",
                    channel_name=None,
                    start_seconds=0.25,
                    end_seconds=0.75,
                ),
                WaveformAnnotation(
                    id="channel",
                    label="Spike",
                    notes="",
                    channel_name="Cz",
                    start_seconds=0.5,
                ),
                WaveformAnnotation(
                    id="hidden",
                    label="Hidden",
                    notes="",
                    channel_name="Missing",
                    start_seconds=0.5,
                ),
            ]
        )

        self.assertTrue(changed)
        self.assertEqual(len(bridge.annotationItems), 2)
        self.assertEqual(
            bridge.annotationItems,
            [
                {
                    "x": 0.25,
                    "width": 0.5,
                    "y": 0.0,
                    "height": 1.0,
                    "label": "Seizure",
                    "channelName": "",
                },
                {
                    "x": 0.5,
                    "width": 0.0,
                    "y": 0.5,
                    "height": 0.5,
                    "label": "Spike",
                    "channelName": "Cz",
                },
            ],
        )

    def test_bridge_clear_removes_stale_waveform_geometry(self) -> None:
        bridge = QuickWaveformSurfaceBridge()
        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)
        bridge.set_annotations(
            [
                WaveformAnnotation(
                    id="global",
                    label="Seizure",
                    notes="",
                    channel_name=None,
                    start_seconds=0.25,
                    end_seconds=0.75,
                )
            ]
        )

        bridge.clear()

        self.assertEqual(bridge.title, "DDALAB waveform")
        self.assertEqual(bridge.channelCount, 0)
        self.assertEqual(bridge.channelLabels, [])
        self.assertEqual(bridge.timeTicks, [])
        self.assertEqual(bridge.annotationItems, [])
        self.assertEqual(bridge.geometryRevision, 2)
        self.assertEqual(len(bridge.waveform_geometry().lines), 0)

        bridge.set_waveform_window(_window(), title="Waveform", target_width=80)

        self.assertEqual(bridge.annotationItems, [])

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
            "ddalab_app.ui.quick_waveform_surface.perf_logger",
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

    def test_texture_item_tracks_bridge_and_has_contents(self) -> None:
        from PySide6.QtQuick import QQuickItem

        bridge = QuickWaveformSurfaceBridge()
        item = QuickWaveformTextureItem()

        item.bridge = bridge

        self.assertIs(item.bridge, bridge)
        self.assertTrue(item.flags() & QQuickItem.ItemHasContents)

    def test_texture_item_reuses_scene_graph_node_when_view_changes(self) -> None:
        from PySide6.QtGui import QGuiApplication
        from PySide6.QtQuick import QQuickWindow

        app = QGuiApplication.instance() or QGuiApplication([])
        bridge = QuickWaveformSurfaceBridge()
        window = QQuickWindow()
        item = QuickWaveformTextureItem(window.contentItem())
        item.bridge = bridge
        item.setWidth(160)
        item.setHeight(80)
        update_quick_waveform_bridge(bridge, _window(), target_width=80)
        node = item.updatePaintNode(None, None)
        first_texture = node.texture()

        update_quick_waveform_bridge(
            bridge,
            _window(),
            target_width=80,
            start_fraction=0.25,
            span_fraction=0.5,
        )
        updated_node = item.updatePaintNode(node, None)

        self.assertIs(updated_node, node)
        self.assertIsNot(updated_node.texture(), first_texture)
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
            "ddalab_app.ui.quick_waveform_surface.WaveformWindowPlotProvider",
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
