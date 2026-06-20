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

from ddalab_qt.app.main_window_visualize import MainWindowVisualizeMixin
from ddalab_qt.domain.models import ChannelWaveform, WaveformWindow
from ddalab_qt.ui.plot_layers import PlotLayerConfig


def _window() -> WaveformWindow:
    return WaveformWindow(
        dataset_file_path="demo.edf",
        start_time_seconds=0.0,
        duration_seconds=10.0,
        channels=[
            ChannelWaveform(
                name="Cz",
                sample_rate_hz=1000.0,
                samples=[float(value) for value in range(100)],
                unit="uV",
                min_value=0.0,
                max_value=99.0,
                levels=[],
            )
        ],
        from_cache=False,
    )


class _QuickWidget:
    def width(self) -> int:
        return 320


class _CheckBox:
    def __init__(self, checked: bool) -> None:
        self._checked = checked

    def isChecked(self) -> bool:
        return self._checked


class _QuickBridge:
    def __init__(self) -> None:
        self.layers: list[PlotLayerConfig] = []

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        self.layers.append(layers)
        return True


class _Label:
    def __init__(self) -> None:
        self.texts: list[str] = []

    def setText(self, text: str) -> None:
        self.texts.append(text)


class _WaveformWidget:
    def __init__(self) -> None:
        self.viewports: list[tuple[float, float, float]] = []
        self.layers: list[PlotLayerConfig] = []

    def set_display_viewport(
        self,
        start_seconds: float,
        duration_seconds: float,
        dataset_duration_seconds: float,
    ) -> None:
        self.viewports.append(
            (start_seconds, duration_seconds, dataset_duration_seconds)
        )

    def set_plot_layers(self, layers: PlotLayerConfig) -> bool:
        self.layers.append(layers)
        return True


class _OverviewWidget:
    def __init__(self) -> None:
        self.calls: list[tuple[object, float, float, float]] = []

    def set_overview(
        self,
        overview: object,
        start_seconds: float,
        duration_seconds: float,
        dataset_duration_seconds: float,
    ) -> None:
        self.calls.append(
            (overview, start_seconds, duration_seconds, dataset_duration_seconds)
        )


class _Timer:
    def __init__(self) -> None:
        self.started: list[int] = []

    def start(self, interval_ms: int) -> None:
        self.started.append(interval_ms)


class _Window(MainWindowVisualizeMixin):
    def __init__(self) -> None:
        self.quick_waveform_bridge = _QuickBridge()
        self.quick_waveform_widget = _QuickWidget()
        self.state = SimpleNamespace(
            waveform_viewport_start_seconds=2.0,
            waveform_viewport_duration_seconds=4.0,
        )


class _ViewportWindow(_Window):
    def __init__(self) -> None:
        super().__init__()
        self.state.selected_dataset = SimpleNamespace(duration_seconds=10.0)
        self.state.waveform_overview = object()
        self.state.waveform_window = _window()
        self.viewport_label = _Label()
        self.waveform_widget = _WaveformWidget()
        self.overview_widget = _OverviewWidget()
        self.viewport_reload_timer = _Timer()
        self.annotation_scope_updates = 0
        self.streaming_updates = 0
        self.session_saves = 0

    def _update_annotation_scope_label(self) -> None:
        self.annotation_scope_updates += 1

    def _update_streaming_ui(self) -> None:
        self.streaming_updates += 1

    def _schedule_session_save(self) -> None:
        self.session_saves += 1


class MainWindowVisualizeQuickWaveformTests(unittest.TestCase):
    def test_quick_waveform_view_forwards_visible_time_window(self) -> None:
        window = _Window()

        with patch(
            "ddalab_qt.app.main_window_visualize.update_quick_waveform_bridge"
        ) as update_bridge:
            window._update_quick_waveform_view(_window())

        update_bridge.assert_called_once()
        kwargs = update_bridge.call_args.kwargs
        self.assertEqual(kwargs["target_width"], 320)
        self.assertEqual(kwargs["start_fraction"], 0.2)
        self.assertEqual(kwargs["span_fraction"], 0.4)

    def test_viewport_change_refreshes_quick_waveform_immediately(self) -> None:
        window = _ViewportWindow()

        with patch.object(window, "_update_quick_waveform_view") as update_view:
            window._set_viewport(3.0, 4.0)

        update_view.assert_called_once_with(window.state.waveform_window)
        self.assertEqual(window.waveform_widget.viewports, [(3.0, 4.0, 10.0)])
        self.assertEqual(window.viewport_reload_timer.started, [140])

    def test_apply_waveform_plot_layers_updates_widget_and_quick_bridge(self) -> None:
        window = _ViewportWindow()
        layers = PlotLayerConfig(waveform=False, annotations=True)

        changed = window._apply_waveform_plot_layers(layers)

        self.assertTrue(changed)
        self.assertEqual(window.waveform_widget.layers, [layers])
        self.assertEqual(window.quick_waveform_bridge.layers, [layers])
        self.assertEqual(window.session_saves, 1)

    def test_waveform_layer_checkbox_change_builds_plot_layer_config(self) -> None:
        window = _ViewportWindow()
        window.waveform_layer_waveform_checkbox = _CheckBox(False)
        window.waveform_layer_annotations_checkbox = _CheckBox(False)

        changed = window._on_waveform_plot_layers_changed()

        expected = PlotLayerConfig(waveform=False, annotations=False)
        self.assertTrue(changed)
        self.assertEqual(window.waveform_widget.layers, [expected])
        self.assertEqual(window.quick_waveform_bridge.layers, [expected])


if __name__ == "__main__":
    unittest.main()
