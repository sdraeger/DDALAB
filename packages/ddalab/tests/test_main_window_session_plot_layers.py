from __future__ import annotations

# ruff: noqa: E402
import sys
import unittest
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_qt.app.main_window_support import MainWindowSupportMixin
from ddalab_qt.ui.plot_layers import PlotLayerConfig


class _Window(MainWindowSupportMixin):
    def __init__(self) -> None:
        self.waveform_layers = PlotLayerConfig(waveform=False, annotations=True)
        self.result_layers = PlotLayerConfig(
            heatmap=False,
            line=True,
            annotations=False,
            cursor=False,
        )
        self.applied_waveform: list[tuple[PlotLayerConfig, bool]] = []
        self.applied_result: list[tuple[PlotLayerConfig, bool]] = []

    def _current_waveform_plot_layers(self) -> PlotLayerConfig:
        return self.waveform_layers

    def _current_result_plot_layers(self) -> PlotLayerConfig:
        return self.result_layers

    def _apply_waveform_plot_layers(
        self,
        layers: PlotLayerConfig,
        *,
        schedule_save: bool = True,
    ) -> bool:
        self.applied_waveform.append((layers, schedule_save))
        return True

    def _apply_result_plot_layers(
        self,
        layers: PlotLayerConfig,
        *,
        schedule_save: bool = True,
    ) -> bool:
        self.applied_result.append((layers, schedule_save))
        return True


class MainWindowSessionPlotLayerTests(unittest.TestCase):
    def test_current_plot_layers_payload_serializes_waveform_and_result_layers(
        self,
    ) -> None:
        window = _Window()

        payload = window._current_plot_layers_payload()

        self.assertEqual(
            payload,
            {
                "waveform": {
                    "waveform": False,
                    "annotations": True,
                },
                "results": {
                    "heatmap": False,
                    "line": True,
                    "annotations": False,
                    "cursor": False,
                },
            },
        )

    def test_apply_plot_layers_payload_restores_without_scheduling_save(self) -> None:
        window = _Window()

        window._apply_plot_layers_payload(
            {
                "waveform": {
                    "waveform": True,
                    "annotations": False,
                },
                "results": {
                    "heatmap": True,
                    "line": False,
                    "annotations": True,
                    "cursor": False,
                },
            }
        )

        self.assertEqual(
            window.applied_waveform,
            [(PlotLayerConfig(waveform=True, annotations=False), False)],
        )
        self.assertEqual(
            window.applied_result,
            [
                (
                    PlotLayerConfig(
                        heatmap=True,
                        line=False,
                        annotations=True,
                        cursor=False,
                    ),
                    False,
                )
            ],
        )


if __name__ == "__main__":
    unittest.main()
