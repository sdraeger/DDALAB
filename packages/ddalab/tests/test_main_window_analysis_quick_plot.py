from __future__ import annotations

# ruff: noqa: E402
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from qt.app.analysis.main_window_analysis import MainWindowAnalysisMixin
from qt.domain.models import DdaVariantResult
from qt.ui.plot_layers import PlotLayerConfig


def _variant() -> DdaVariantResult:
    return DdaVariantResult(
        id="ST",
        label="Single Timeseries",
        row_labels=["A"],
        matrix=[list(range(20))],
        summary="",
        min_value=0.0,
        max_value=20.0,
        column_count=20,
    )


class _Combo:
    def currentData(self) -> str:
        return "cool"


class _CheckBox:
    def __init__(self, checked: bool) -> None:
        self._checked = checked

    def isChecked(self) -> bool:
        return self._checked


class _QuickWidget:
    def width(self) -> int:
        return 6


class _HeatmapWidget:
    _x_view_start = 0.91
    _x_view_span = 0.09

    def __init__(self) -> None:
        self.view_windows: list[tuple[float, float, bool]] = []
        self.cursor_fractions: list[tuple[float, bool]] = []
        self.layers: list[PlotLayerConfig] = []

    def view_window(self) -> tuple[float, float]:
        return (0.25, 0.5)

    def set_view_window(self, start: float, span: float, *, emit: bool = True) -> bool:
        self.view_windows.append((start, span, emit))
        self._x_view_start = start
        self._x_view_span = span
        return True

    def set_cursor_fraction(self, fraction: float, *, emit: bool = True) -> bool:
        self.cursor_fractions.append((fraction, emit))
        return True

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        self.layers.append(layers)
        return True


class _LinePlotWidget:
    def __init__(self) -> None:
        self.view_windows: list[tuple[float, float, bool]] = []
        self.cursor_fractions: list[tuple[float, bool]] = []
        self.layers: list[PlotLayerConfig] = []

    def set_view_window(self, start: float, span: float, *, emit: bool = True) -> bool:
        self.view_windows.append((start, span, emit))
        return True

    def set_cursor_fraction(self, fraction: float, *, emit: bool = True) -> bool:
        self.cursor_fractions.append((fraction, emit))
        return True

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        self.layers.append(layers)
        return True


class _QuickBridge:
    def __init__(self) -> None:
        self.cursor_fractions: list[float] = []
        self.layers: list[PlotLayerConfig] = []

    def set_cursor_fraction(self, fraction: float) -> bool:
        self.cursor_fractions.append(fraction)
        return True

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        self.layers.append(layers)
        return True


class _Window(MainWindowAnalysisMixin):
    def __init__(self) -> None:
        self.quick_heatmap_bridge = _QuickBridge()
        self.quick_heatmap_widget = _QuickWidget()
        self.heatmap_color_scheme_combo = _Combo()
        self.heatmap_widget = _HeatmapWidget()
        self.dda_lineplot_widget = _LinePlotWidget()
        self.session_saves = 0

    def _schedule_session_save(self) -> None:
        self.session_saves += 1


class MainWindowAnalysisQuickPlotTests(unittest.TestCase):
    def test_quick_variant_view_forwards_current_heatmap_viewport(self) -> None:
        window = _Window()

        with patch(
            "qt.app.analysis.main_window_analysis_results.update_quick_variant_bridge"
        ) as update_bridge:
            window._update_quick_variant_view(_variant())

        update_bridge.assert_called_once()
        kwargs = update_bridge.call_args.kwargs
        self.assertEqual(kwargs["target_columns"], 6)
        self.assertEqual(kwargs["color_scheme"], "cool")
        self.assertEqual(kwargs["start_fraction"], 0.25)
        self.assertEqual(kwargs["span_fraction"], 0.5)

    def test_refresh_quick_variant_viewport_uses_active_result_variant(self) -> None:
        window = _Window()
        variant = _variant()
        window._active_variant_id = variant.id
        window.state = SimpleNamespace(dda_result=SimpleNamespace(variants=[variant]))

        with patch.object(window, "_update_quick_variant_view") as update_view:
            window._refresh_quick_variant_viewport()

        update_view.assert_called_once_with(variant)

    def test_sync_result_viewport_updates_line_plot_and_quick_view(self) -> None:
        window = _Window()
        variant = _variant()
        window._active_variant_id = variant.id
        window.state = SimpleNamespace(dda_result=SimpleNamespace(variants=[variant]))

        with patch.object(window, "_update_quick_variant_view") as update_view:
            window._sync_result_plot_viewport(0.25, 0.5)

        self.assertEqual(window.heatmap_widget.view_windows, [(0.25, 0.5, False)])
        self.assertEqual(window.dda_lineplot_widget.view_windows, [(0.25, 0.5, False)])
        update_view.assert_called_once_with(variant)

    def test_sync_result_cursor_updates_plots_and_quick_bridge(self) -> None:
        window = _Window()

        window._sync_result_plot_cursor(0.25)

        self.assertEqual(window.heatmap_widget.cursor_fractions, [(0.25, False)])
        self.assertEqual(window.dda_lineplot_widget.cursor_fractions, [(0.25, False)])
        self.assertEqual(window.quick_heatmap_bridge.cursor_fractions, [0.25])

    def test_apply_result_plot_layers_updates_widgets_and_quick_bridge(self) -> None:
        window = _Window()
        layers = PlotLayerConfig(heatmap=False, line=True, cursor=False)

        changed = window._apply_result_plot_layers(layers)

        self.assertTrue(changed)
        self.assertEqual(window.heatmap_widget.layers, [layers])
        self.assertEqual(window.dda_lineplot_widget.layers, [layers])
        self.assertEqual(window.quick_heatmap_bridge.layers, [layers])
        self.assertEqual(window.session_saves, 1)

    def test_result_layer_checkbox_change_builds_plot_layer_config(self) -> None:
        window = _Window()
        window.result_layer_heatmap_checkbox = _CheckBox(False)
        window.result_layer_line_checkbox = _CheckBox(True)
        window.result_layer_cursor_checkbox = _CheckBox(False)
        window.result_layer_annotations_checkbox = _CheckBox(False)

        changed = window._on_result_plot_layers_changed()

        expected = PlotLayerConfig(
            heatmap=False,
            line=True,
            cursor=False,
            annotations=False,
        )
        self.assertTrue(changed)
        self.assertEqual(window.heatmap_widget.layers, [expected])
        self.assertEqual(window.dda_lineplot_widget.layers, [expected])
        self.assertEqual(window.quick_heatmap_bridge.layers, [expected])


if __name__ == "__main__":
    unittest.main()
