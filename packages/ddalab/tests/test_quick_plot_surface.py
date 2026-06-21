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

from ddalab_qt.domain.models import DdaVariantResult
from ddalab_qt.ui import plot_data, quick_plot_surface
from ddalab_qt.ui.plot_data import build_matrix_view
from ddalab_qt.ui.plot_layers import PlotLayerConfig
from ddalab_qt.ui.qt_plot_renderer import MatrixRenderArtifacts, QtCpuMatrixPlotRenderer
from ddalab_qt.ui.quick_plot_surface import (
    QuickHeatmapTextureItem,
    QuickLineGeometryItem,
    QuickPlotSurfaceBridge,
    create_quick_plot_surface_widget,
    quick_plot_surface_qml_path,
    quick_plots_enabled,
    update_quick_heatmap_bridge,
    update_quick_variant_bridge,
)


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


class _RecordingMatrixRenderer:
    name = "Recording renderer"

    def __init__(self) -> None:
        self.calls = 0
        self.color_schemes: list[str] = []

    def render(self, view, *, color_scheme: str) -> MatrixRenderArtifacts:
        self.calls += 1
        self.color_schemes.append(color_scheme)
        return QtCpuMatrixPlotRenderer().render(view, color_scheme=color_scheme)


class QuickPlotSurfaceTests(unittest.TestCase):
    def test_quick_plots_enabled_accepts_explicit_truthy_env_values(self) -> None:
        for value in ("1", "true", "yes", "on"):
            with self.subTest(value=value):
                self.assertTrue(quick_plots_enabled({"DDALAB_ENABLE_QML_PLOTS": value}))

    def test_quick_plots_enabled_is_on_by_default(self) -> None:
        self.assertTrue(quick_plots_enabled({}))

    def test_quick_plots_enabled_accepts_explicit_falsey_env_values(self) -> None:
        for value in ("0", "false", "no", "off"):
            with self.subTest(value=value):
                self.assertFalse(
                    quick_plots_enabled({"DDALAB_ENABLE_QML_PLOTS": value})
                )

    def test_qml_asset_is_available_for_packaging(self) -> None:
        qml_path = quick_plot_surface_qml_path()

        self.assertTrue(qml_path.exists())
        self.assertEqual(qml_path.name, "QuickPlotSurface.qml")

    def test_qml_uses_direct_texture_availability_for_scene_graph_item(self) -> None:
        qml = quick_plot_surface_qml_path().read_text(encoding="utf-8")

        self.assertIn("root.plotBridge.hasImage", qml)
        self.assertNotIn("imageSource", qml)

    def test_bridge_does_not_expose_unused_image_provider_source(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        self.assertFalse(hasattr(bridge, "imageSource"))

    def test_bridge_exposes_matrix_view_metadata_for_qml(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        view = build_matrix_view(_variant(), target_columns=4)

        self.assertFalse(bridge.hasImage)
        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt CPU image",
        )

        self.assertEqual(bridge.title, "ST heatmap")
        self.assertEqual(bridge.rendererName, "Qt CPU image")
        self.assertEqual(bridge.rowStart, 0)
        self.assertEqual(bridge.rowCount, 2)
        self.assertEqual(bridge.totalRowCount, 2)
        self.assertEqual(bridge.visibleColumnCount, 4)
        self.assertEqual(bridge.sourceColumnCount, 10)
        self.assertEqual(bridge.sourceColumnStart, 0)
        self.assertEqual(bridge.sourceColumnEnd, 10)
        self.assertTrue(bridge.hasImage)
        self.assertIn("2 rows", bridge.statusText)
        self.assertIn("4 visible columns", bridge.statusText)
        self.assertEqual(bridge.lineGeometryRevision, 1)
        self.assertEqual(len(bridge.line_geometry().lines), 2)

    def test_bridge_revisions_scene_graph_render_when_plot_data_changes(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        first_view = build_matrix_view(_variant(), target_columns=4)
        second_view = build_matrix_view(_variant(), target_columns=6)

        bridge.set_matrix_view(
            first_view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )
        first_revision = bridge.lineGeometryRevision
        bridge.set_matrix_view(
            second_view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )

        self.assertEqual(first_revision, 1)
        self.assertEqual(bridge.lineGeometryRevision, 2)
        self.assertEqual(bridge.visibleColumnCount, 6)

    def test_bridge_reuses_render_cache_for_unchanged_matrix_view(self) -> None:
        renderer = _RecordingMatrixRenderer()
        bridge = QuickPlotSurfaceBridge(renderer=renderer)
        view = build_matrix_view(_variant(), target_columns=4)

        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )
        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )

        self.assertEqual(renderer.calls, 1)
        self.assertEqual(bridge.lineGeometryRevision, 1)

    def test_bridge_logs_render_cache_lookup_outcomes(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        view = build_matrix_view(_variant(), target_columns=4)
        logger = Mock()

        with patch(
            "ddalab_qt.ui.quick_plot_surface.perf_logger",
            return_value=logger,
            create=True,
        ):
            bridge.set_matrix_view(
                view,
                title="ST heatmap",
                renderer_name="Qt Quick scene graph texture",
            )
            bridge.set_matrix_view(
                view,
                title="ST heatmap",
                renderer_name="Qt Quick scene graph texture",
            )

        cache_logs = [
            call
            for call in logger.log.call_args_list
            if call.args == ("qml.render_cache.lookup",)
        ]
        self.assertEqual([call.kwargs["hit"] for call in cache_logs], [False, True])
        self.assertEqual(
            [call.kwargs["surface"] for call in cache_logs], ["result", "result"]
        )
        self.assertEqual(
            [call.kwargs["layerHeatmap"] for call in cache_logs], [True, True]
        )
        self.assertEqual(
            [call.kwargs["layerLine"] for call in cache_logs], [True, True]
        )
        self.assertEqual(
            [call.kwargs["layerAnnotations"] for call in cache_logs], [True, True]
        )
        self.assertEqual(
            [call.kwargs["layerCursor"] for call in cache_logs], [True, True]
        )
        self.assertEqual([call.kwargs["sourceColStart"] for call in cache_logs], [0, 0])
        self.assertEqual([call.kwargs["sourceColEnd"] for call in cache_logs], [10, 10])

    def test_bridge_reuses_recent_cached_matrix_view_after_view_switch(self) -> None:
        renderer = _RecordingMatrixRenderer()
        bridge = QuickPlotSurfaceBridge(renderer=renderer)
        first_view = build_matrix_view(_variant(), target_columns=4)
        second_view = build_matrix_view(_variant(), target_columns=6)

        bridge.set_matrix_view(
            first_view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )
        bridge.set_matrix_view(
            second_view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )
        bridge.set_matrix_view(
            first_view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )

        self.assertEqual(renderer.calls, 2)
        self.assertEqual(bridge.lineGeometryRevision, 3)
        self.assertEqual(bridge.visibleColumnCount, 4)

    def test_bridge_invalidates_render_cache_when_color_scheme_changes(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        view = build_matrix_view(_variant(), target_columns=4)

        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
            color_scheme="viridis",
        )
        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
            color_scheme="cool",
        )

        self.assertEqual(bridge.lineGeometryRevision, 2)

    def test_default_matrix_renderer_returns_heatmap_and_line_geometry(self) -> None:
        view = build_matrix_view(_variant(), target_columns=4)

        artifacts = QtCpuMatrixPlotRenderer().render(view, color_scheme="viridis")

        self.assertFalse(artifacts.image.isNull())
        self.assertEqual(artifacts.image.width(), 4)
        self.assertEqual(len(artifacts.line_geometry.lines), 2)

    def test_bridge_uses_injected_matrix_renderer(self) -> None:
        renderer = _RecordingMatrixRenderer()
        bridge = QuickPlotSurfaceBridge(renderer=renderer)
        view = build_matrix_view(_variant(), target_columns=4)

        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            color_scheme="cool",
        )

        self.assertEqual(renderer.calls, 1)
        self.assertEqual(renderer.color_schemes, ["cool"])
        self.assertEqual(bridge.rendererName, "Recording renderer")
        self.assertEqual(bridge.image().width(), 4)
        self.assertEqual(len(bridge.line_geometry().lines), 2)

    def test_bridge_clear_removes_stale_image_and_metadata(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        bridge.set_matrix_view(
            build_matrix_view(_variant(), target_columns=4),
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )

        bridge.clear()

        self.assertEqual(bridge.title, "DDALAB plot")
        self.assertEqual(bridge.rowCount, 0)
        self.assertEqual(bridge.visibleColumnCount, 0)
        self.assertEqual(bridge.sourceColumnCount, 0)
        self.assertFalse(bridge.hasImage)
        self.assertEqual(bridge.statusText, "No plot data loaded")
        self.assertEqual(bridge.lineGeometryRevision, 2)
        self.assertEqual(len(bridge.line_geometry().lines), 0)

    def test_bridge_exposes_cursor_fraction_for_qml_overlays(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        changed = bridge.set_cursor_fraction(0.25)

        self.assertTrue(changed)
        self.assertEqual(bridge.cursorFraction, 0.25)

    def test_bridge_clamps_cursor_fraction(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        bridge.set_cursor_fraction(2.0)

        self.assertEqual(bridge.cursorFraction, 1.0)

    def test_bridge_exposes_configurable_result_layers_for_qml(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        changed = bridge.set_plot_layers(
            PlotLayerConfig(heatmap=False, line=False, cursor=False)
        )

        self.assertTrue(changed)
        self.assertFalse(bridge.showHeatmapLayer)
        self.assertFalse(bridge.showLineLayer)
        self.assertFalse(bridge.showCursorLayer)

    def test_factory_creates_embeddable_qquickwidget_surface(self) -> None:
        from PySide6.QtQuickWidgets import QQuickWidget
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])
        bridge = QuickPlotSurfaceBridge()

        widget = create_quick_plot_surface_widget(bridge)

        self.assertIsInstance(widget, QQuickWidget)
        self.assertIs(widget.rootContext().contextProperty("plotBridge"), bridge)
        self.assertFalse(hasattr(widget, "ddalabImageProvider"))
        self.assertTrue(widget.ddalabSceneGraphTypesRegistered)
        self.assertEqual(
            widget.source().toLocalFile(), str(quick_plot_surface_qml_path())
        )
        self.assertIsNotNone(app)

    def test_scene_graph_item_tracks_bridge_and_has_contents(self) -> None:
        from PySide6.QtQuick import QQuickItem

        bridge = QuickPlotSurfaceBridge()
        item = QuickHeatmapTextureItem()

        item.bridge = bridge

        self.assertIs(item.bridge, bridge)
        self.assertTrue(item.flags() & QQuickItem.ItemHasContents)

    def test_heatmap_texture_item_logs_scene_graph_texture_updates(self) -> None:
        from PySide6.QtGui import QGuiApplication
        from PySide6.QtQuick import QQuickWindow, QSGSimpleTextureNode

        app = QGuiApplication.instance() or QGuiApplication([])
        bridge = QuickPlotSurfaceBridge()
        bridge.set_matrix_view(
            build_matrix_view(_variant(), target_columns=4),
            title="ST heatmap",
        )
        window = QQuickWindow()
        item = QuickHeatmapTextureItem(window.contentItem())
        item.bridge = bridge
        item.setWidth(120)
        item.setHeight(80)
        logger = Mock()

        with (
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_counter_ns",
                side_effect=[0, 20_000_000],
                create=True,
            ),
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_logger",
                return_value=logger,
                create=True,
            ),
        ):
            node = item.updatePaintNode(None, None)

        self.assertIsNotNone(app)
        self.assertIsInstance(node, QSGSimpleTextureNode)
        logger.log_slow.assert_called_once()
        self.assertEqual(
            logger.log_slow.call_args.args[1],
            "qml.scene_graph.result_heatmap.update",
        )
        self.assertEqual(logger.log_slow.call_args.kwargs["imageWidth"], 4)
        self.assertEqual(logger.log_slow.call_args.kwargs["imageHeight"], 2)
        self.assertEqual(logger.log_slow.call_args.kwargs["width"], 120.0)
        self.assertEqual(logger.log_slow.call_args.kwargs["height"], 80.0)

    def test_line_geometry_item_tracks_bridge_and_has_contents(self) -> None:
        from PySide6.QtQuick import QQuickItem

        bridge = QuickPlotSurfaceBridge()
        item = QuickLineGeometryItem()

        item.bridge = bridge

        self.assertIs(item.bridge, bridge)
        self.assertTrue(item.flags() & QQuickItem.ItemHasContents)

    def test_line_geometry_item_logs_slow_scene_graph_updates(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        bridge.set_matrix_view(
            build_matrix_view(_variant(), target_columns=4),
            title="ST heatmap",
        )
        item = QuickLineGeometryItem()
        item.bridge = bridge
        item.setWidth(120)
        item.setHeight(60)
        logger = Mock()

        with (
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_counter_ns",
                side_effect=[0, 20_000_000],
                create=True,
            ),
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_logger",
                return_value=logger,
                create=True,
            ),
        ):
            item.updatePaintNode(None, None)

        logger.log_slow.assert_called_once()
        self.assertEqual(
            logger.log_slow.call_args.args[1],
            "qml.scene_graph.result_line.update",
        )
        self.assertEqual(logger.log_slow.call_args.kwargs["nodes"], 2)
        self.assertEqual(logger.log_slow.call_args.kwargs["vertices"], 8)

    def test_bridge_exposes_line_geometry_for_scene_graph_renderer(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        view = build_matrix_view(_variant(), target_columns=4)
        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
        )

        geometry = bridge.line_geometry()

        self.assertEqual(len(geometry.lines), 2)
        self.assertEqual(geometry.source_column_count, 10)
        self.assertEqual(geometry.target_column_count, 4)

    def test_bridge_honors_configured_heatmap_color_scheme(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        view = build_matrix_view(_variant(), target_columns=4)

        bridge.set_matrix_view(
            view,
            title="ST heatmap",
            renderer_name="Qt Quick scene graph texture",
            color_scheme="cool",
        )

        self.assertEqual(bridge.image().pixelColor(0, 0).getRgb(), (0, 255, 255, 255))

    def test_bridge_logs_slow_matrix_renderer_preparation(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        view = build_matrix_view(_variant(), target_columns=4)
        logger = Mock()

        with (
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_counter_ns",
                side_effect=[0, 20_000_000, 20_000_000, 45_000_000],
                create=True,
            ),
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_logger",
                return_value=logger,
                create=True,
            ),
        ):
            bridge.set_matrix_view(
                view,
                title="ST heatmap",
                renderer_name="Qt Quick scene graph texture",
            )

        self.assertEqual(logger.log_slow.call_count, 1)
        self.assertEqual(
            [call.args[1] for call in logger.log_slow.call_args_list],
            ["qml.matrix_renderer.build"],
        )

    def test_update_helper_populates_bridge_from_variant(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        update_quick_heatmap_bridge(
            bridge,
            _variant(),
            target_columns=5,
            title="ST quick heatmap",
            color_scheme="cool",
        )

        self.assertEqual(bridge.title, "ST quick heatmap")
        self.assertEqual(bridge.rendererName, "Qt Quick scene graph texture")
        self.assertEqual(bridge.rowCount, 2)
        self.assertEqual(bridge.visibleColumnCount, 5)

    def test_update_variant_helper_exposes_source_column_window(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        update_quick_variant_bridge(
            bridge,
            _variant(),
            target_columns=4,
            start_fraction=0.25,
            span_fraction=0.5,
        )

        self.assertEqual(bridge.sourceColumnStart, 2)
        self.assertEqual(bridge.sourceColumnEnd, 8)

    def test_update_variant_helper_populates_heatmap_and_line_bridge_images(
        self,
    ) -> None:
        bridge = QuickPlotSurfaceBridge()

        update_quick_variant_bridge(
            bridge,
            _variant(),
            target_columns=5,
            title="ST quick result",
            color_scheme="cool",
        )

        self.assertEqual(bridge.title, "ST quick result")
        self.assertEqual(bridge.rendererName, "Qt Quick scene graph texture")
        self.assertTrue(bridge.hasImage)
        self.assertEqual(bridge.lineGeometryRevision, 1)
        self.assertEqual(len(bridge.line_geometry().lines), 2)

    def test_update_variant_helper_uses_plot_provider_boundary(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        variant = _variant()

        with patch(
            "ddalab_qt.ui.quick_plot_surface.DdaVariantPlotProvider",
            wraps=quick_plot_surface.DdaVariantPlotProvider,
        ) as provider_class:
            update_quick_variant_bridge(
                bridge,
                variant,
                target_columns=5,
                start_fraction=0.25,
                span_fraction=0.5,
            )

        provider_class.assert_called_once_with(
            variant,
            tile_cache=bridge.matrix_tile_cache(),
        )
        self.assertEqual(bridge.visibleColumnCount, 5)

    def test_update_variant_helper_reuses_bridge_matrix_tile_cache(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        variant = _variant()

        with patch(
            "ddalab_qt.ui.plot_data.build_matrix_view",
            wraps=plot_data.build_matrix_view,
        ) as build:
            update_quick_variant_bridge(bridge, variant, target_columns=5)
            update_quick_variant_bridge(bridge, variant, target_columns=5)

        self.assertEqual(build.call_count, 1)
        self.assertEqual(bridge.matrix_tile_cache().size, 1)

    def test_update_variant_helper_accepts_visible_row_range(self) -> None:
        bridge = QuickPlotSurfaceBridge()

        update_quick_variant_bridge(
            bridge,
            _variant(),
            target_columns=5,
            row_start=1,
            row_count=1,
        )

        self.assertEqual(bridge.rowCount, 1)
        self.assertEqual(bridge.rowStart, 1)
        self.assertEqual(bridge.totalRowCount, 2)
        self.assertEqual(len(bridge.line_geometry().lines), 1)

    def test_update_variant_helper_logs_slow_matrix_view_preparation(self) -> None:
        bridge = QuickPlotSurfaceBridge()
        logger = Mock()

        with (
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_counter_ns",
                side_effect=[
                    0,
                    20_000_000,
                    20_000_000,
                    21_000_000,
                    21_000_000,
                    22_000_000,
                ],
                create=True,
            ),
            patch(
                "ddalab_qt.ui.quick_plot_surface.perf_logger",
                return_value=logger,
                create=True,
            ),
        ):
            update_quick_variant_bridge(
                bridge,
                _variant(),
                target_columns=5,
                start_fraction=0.25,
                span_fraction=0.5,
                row_start=1,
                row_count=1,
            )

        self.assertIn(
            "qml.matrix_view.build",
            [call.args[1] for call in logger.log_slow.call_args_list],
        )
        matrix_log = next(
            call
            for call in logger.log_slow.call_args_list
            if call.args[1] == "qml.matrix_view.build"
        )
        self.assertEqual(matrix_log.kwargs["rowStart"], 1)
        self.assertEqual(matrix_log.kwargs["rowCount"], 1)
        self.assertEqual(matrix_log.kwargs["totalRows"], 2)


if __name__ == "__main__":
    unittest.main()
