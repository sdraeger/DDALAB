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

import numpy as np

from PySide6.QtCore import QRectF
from PySide6.QtWidgets import QApplication

from qt.domain.models import ChannelWaveform, DdaVariantResult, WaveformWindow
from qt.ui.plot_data import (
    DdaVariantPlotProvider,
    MatrixView,
    MatrixViewRequest,
    WaveformTraceView,
    waveform_render_key,
)
from qt.ui.plot_layers import PlotLayerConfig
from qt.ui.widgets import dda_line_plot_widget, heatmap_widget, waveform_widget
from qt.ui.widgets import plot_widget_helpers
from qt.ui.widgets.plots import DdaLinePlotWidget, HeatmapWidget, WaveformWidget


def _variant() -> DdaVariantResult:
    return DdaVariantResult(
        id="ST",
        label="Single Timeseries",
        row_labels=["A", "B"],
        matrix=[
            list(range(20)),
            list(range(20, 40)),
        ],
        summary="",
        min_value=0.0,
        max_value=40.0,
        column_count=20,
    )


def _channel(samples: list[float], *, name: str = "Cz") -> ChannelWaveform:
    return ChannelWaveform(
        name=name,
        sample_rate_hz=1000.0,
        samples=samples,
        unit="uV",
        min_value=min(samples) if samples else 0.0,
        max_value=max(samples) if samples else 0.0,
        levels=[],
    )


def _waveform_window(channel: ChannelWaveform) -> WaveformWindow:
    return WaveformWindow(
        dataset_file_path="demo.edf",
        start_time_seconds=0.0,
        duration_seconds=1.0,
        channels=[channel],
        from_cache=False,
    )


def _waveform_window_with_duration(
    channel: ChannelWaveform,
    duration_seconds: float,
) -> WaveformWindow:
    return WaveformWindow(
        dataset_file_path="demo.edf",
        start_time_seconds=0.0,
        duration_seconds=duration_seconds,
        channels=[channel],
        from_cache=False,
    )


class _FakePainter:
    Antialiasing = 0

    def __init__(self, *args, **kwargs) -> None:
        pass

    def setRenderHint(self, *args, **kwargs) -> None:
        pass

    def fillRect(self, *args, **kwargs) -> None:
        pass

    def setPen(self, *args, **kwargs) -> None:
        pass

    def drawText(self, *args, **kwargs) -> None:
        pass

    def drawLine(self, *args, **kwargs) -> None:
        pass


class _LineRecordingPainter(_FakePainter):
    def __init__(self) -> None:
        self.lines: list[tuple[object, ...]] = []

    def drawLine(self, *args, **kwargs) -> None:
        self.lines.append(args)


class WidgetPlotProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = QApplication.instance() or QApplication([])

    def test_heatmap_widget_requests_visible_matrix_through_plot_provider(self) -> None:
        widget = HeatmapWidget()
        widget.resize(360, 240)
        widget.set_variant(_variant())
        providers: list[_RecordingProvider] = []

        with patch.object(
            heatmap_widget,
            "DdaVariantPlotProvider",
            side_effect=lambda variant: _RecordingProvider(variant, providers),
            create=True,
        ):
            pixmap = widget._ensure_heatmap_pixmap()

        self.assertIsNotNone(pixmap)
        self.assertEqual(len(providers), 1)
        self.assertIs(providers[0].variant, widget.variant)
        matrix_request = providers[0].requests[0]
        self.assertLessEqual(matrix_request.target_columns, widget.width())
        self.assertEqual(matrix_request.start_fraction, 0.0)
        self.assertEqual(matrix_request.span_fraction, 1.0)

    def test_heatmap_widget_rebuilds_pixmap_when_matrix_changes_in_place(self) -> None:
        variant = _variant()
        widget = HeatmapWidget()
        widget.resize(360, 240)
        widget.set_variant(variant)

        first_pixmap = widget._ensure_heatmap_pixmap()
        variant.matrix[0][0] = 999.0
        second_pixmap = widget._ensure_heatmap_pixmap()

        self.assertIsNot(first_pixmap, second_pixmap)

    def test_heatmap_widget_logs_empty_paint_timing(self) -> None:
        widget = HeatmapWidget()
        widget.resize(360, 240)
        logger = Mock()

        with (
            patch.object(
                plot_widget_helpers,
                "perf_counter_ns",
                side_effect=[0, 20_000_000],
            ),
            patch.object(plot_widget_helpers, "perf_logger", return_value=logger),
            patch.object(heatmap_widget, "QPainter", _FakePainter),
        ):
            widget.paintEvent(None)

        logger.log_slow.assert_called_once()
        self.assertEqual(logger.log_slow.call_args.args[1], "dda.heatmap.paint")
        self.assertEqual(logger.log_slow.call_args.kwargs["rows"], 0)
        self.assertEqual(logger.log_slow.call_args.kwargs["sourceCols"], 0)

    def test_heatmap_widget_emits_view_window_change_when_view_changes(self) -> None:
        widget = HeatmapWidget()
        changes: list[tuple[float, float]] = []
        widget.view_window_changed.connect(
            lambda start, span: changes.append((start, span))
        )

        changed = widget._apply_view_window(0.25, 0.5)

        self.assertTrue(changed)
        self.assertEqual(changes, [(0.25, 0.5)])

    def test_heatmap_widget_applies_external_view_window_without_signal(self) -> None:
        widget = HeatmapWidget()
        changes: list[tuple[float, float]] = []
        widget.view_window_changed.connect(
            lambda start, span: changes.append((start, span))
        )

        changed = widget.set_view_window(0.25, 0.5, emit=False)

        self.assertTrue(changed)
        self.assertEqual(widget._x_view_start, 0.25)
        self.assertEqual(widget._x_view_span, 0.5)
        self.assertEqual(changes, [])

    def test_heatmap_widget_exposes_public_view_window(self) -> None:
        widget = HeatmapWidget()
        widget.set_view_window(0.25, 0.5, emit=False)

        self.assertEqual(widget.view_window(), (0.25, 0.5))

    def test_heatmap_widget_applies_external_cursor_without_signal(self) -> None:
        widget = HeatmapWidget()
        changes: list[float] = []
        widget.cursor_fraction_changed.connect(changes.append)

        changed = widget.set_cursor_fraction(0.25, emit=False)

        self.assertTrue(changed)
        self.assertEqual(widget._cursor_fraction, 0.25)
        self.assertEqual(changes, [])

    def test_heatmap_widget_emits_cursor_change(self) -> None:
        widget = HeatmapWidget()
        changes: list[float] = []
        widget.cursor_fraction_changed.connect(changes.append)

        changed = widget.set_cursor_fraction(0.25)

        self.assertTrue(changed)
        self.assertEqual(changes, [0.25])

    def test_heatmap_widget_can_disable_cursor_layer(self) -> None:
        widget = HeatmapWidget()
        widget.resize(360, 240)
        widget.set_cursor_fraction(0.25, emit=False)
        widget.set_plot_layers(PlotLayerConfig(cursor=False))
        painter = _LineRecordingPainter()

        widget._draw_cursor_overlay(painter)

        self.assertEqual(painter.lines, [])
        self.assertFalse(widget.plot_layers().cursor)

    def test_line_plot_state_uses_visible_matrix_from_plot_provider(self) -> None:
        widget = DdaLinePlotWidget()
        widget.resize(360, 240)
        widget.set_variant(_variant())
        providers: list[_RecordingProvider] = []

        with patch.object(
            dda_line_plot_widget,
            "DdaVariantPlotProvider",
            side_effect=lambda variant: _RecordingProvider(variant, providers),
            create=True,
        ):
            state = widget._line_plot_state()

        self.assertIsNotNone(state)
        self.assertEqual(len(providers), 1)
        self.assertIs(providers[0].variant, widget.variant)
        matrix_request = providers[0].requests[0]
        self.assertEqual(matrix_request.start_fraction, 0.0)
        self.assertEqual(matrix_request.span_fraction, 1.0)
        self.assertIs(state["matrix_view"], providers[0].views[0])

    def test_line_plot_widget_rebuilds_pixmap_when_matrix_changes_in_place(
        self,
    ) -> None:
        variant = _variant()
        widget = DdaLinePlotWidget()
        widget.resize(360, 240)
        widget.set_variant(variant)

        first_pixmap = widget._ensure_lineplot_pixmap()
        variant.matrix[0][0] = 999.0
        second_pixmap = widget._ensure_lineplot_pixmap()

        self.assertIsNot(first_pixmap, second_pixmap)

    def test_line_plot_widget_logs_empty_paint_timing(self) -> None:
        widget = DdaLinePlotWidget()
        widget.resize(360, 240)
        logger = Mock()

        with (
            patch.object(
                plot_widget_helpers,
                "perf_counter_ns",
                side_effect=[0, 20_000_000],
            ),
            patch.object(plot_widget_helpers, "perf_logger", return_value=logger),
            patch.object(dda_line_plot_widget, "QPainter", _FakePainter),
        ):
            widget.paintEvent(None)

        logger.log_slow.assert_called_once()
        self.assertEqual(logger.log_slow.call_args.args[1], "dda.lineplot.paint")
        self.assertEqual(logger.log_slow.call_args.kwargs["rows"], 0)
        self.assertEqual(logger.log_slow.call_args.kwargs["sourceCols"], 0)

    def test_line_plot_widget_applies_external_view_window(self) -> None:
        widget = DdaLinePlotWidget()
        widget.set_variant(_variant())

        changed = widget.set_view_window(0.25, 0.5)

        self.assertTrue(changed)
        self.assertEqual(widget._x_view_start, 0.25)
        self.assertEqual(widget._x_view_span, 0.5)

    def test_line_plot_widget_exposes_public_view_window(self) -> None:
        widget = DdaLinePlotWidget()
        widget.set_view_window(0.25, 0.5, emit=False)

        self.assertEqual(widget.view_window(), (0.25, 0.5))

    def test_line_plot_widget_emits_view_window_change_when_view_changes(self) -> None:
        widget = DdaLinePlotWidget()
        changes: list[tuple[float, float]] = []
        widget.view_window_changed.connect(
            lambda start, span: changes.append((start, span))
        )

        changed = widget.set_view_window(0.25, 0.5)

        self.assertTrue(changed)
        self.assertEqual(changes, [(0.25, 0.5)])

    def test_line_plot_widget_applies_external_cursor_without_signal(self) -> None:
        widget = DdaLinePlotWidget()
        changes: list[float] = []
        widget.cursor_fraction_changed.connect(changes.append)

        changed = widget.set_cursor_fraction(0.25, emit=False)

        self.assertTrue(changed)
        self.assertEqual(widget._cursor_fraction, 0.25)
        self.assertEqual(changes, [])

    def test_line_plot_widget_emits_cursor_change(self) -> None:
        widget = DdaLinePlotWidget()
        changes: list[float] = []
        widget.cursor_fraction_changed.connect(changes.append)

        changed = widget.set_cursor_fraction(0.25)

        self.assertTrue(changed)
        self.assertEqual(changes, [0.25])

    def test_line_plot_widget_can_disable_cursor_layer(self) -> None:
        widget = DdaLinePlotWidget()
        widget.resize(360, 240)
        widget.set_cursor_fraction(0.25, emit=False)
        widget.set_plot_layers(PlotLayerConfig(cursor=False))
        painter = _LineRecordingPainter()

        widget._draw_cursor_overlay(painter)

        self.assertEqual(painter.lines, [])
        self.assertFalse(widget.plot_layers().cursor)

    def test_waveform_widget_requests_channel_pixmap_key_through_plot_provider(
        self,
    ) -> None:
        channel = _channel([0.0, 0.5, 1.0])
        widget = WaveformWidget()
        widget.resize(320, 180)
        widget.set_waveform(_waveform_window(channel), 0.0, 1.0, 1.0)
        providers = []

        with patch.object(
            waveform_widget,
            "WaveformWindowPlotProvider",
            side_effect=lambda window: _RecordingWaveformProvider(window, providers),
            create=True,
        ):
            pixmap = widget._channel_pixmap(channel, widget.size(), channel_index=0)

        self.assertFalse(pixmap.isNull())
        self.assertEqual(len(providers), 1)
        self.assertIs(providers[0].window, widget.window)
        request = providers[0].requests[0]
        self.assertEqual(request.channel_start, 0)
        self.assertEqual(request.channel_count, 1)

    def test_waveform_widget_passes_visible_time_window_to_plot_provider(
        self,
    ) -> None:
        channel = _channel([float(value) for value in range(100)])
        widget = WaveformWidget()
        widget.resize(320, 180)
        widget.set_waveform(
            _waveform_window_with_duration(channel, 10.0),
            viewport_start_seconds=2.0,
            viewport_duration_seconds=4.0,
            dataset_duration_seconds=10.0,
        )
        providers = []

        with patch.object(
            waveform_widget,
            "WaveformWindowPlotProvider",
            side_effect=lambda window: _RecordingWaveformProvider(window, providers),
            create=True,
        ):
            pixmap = widget._channel_pixmap(channel, widget.size(), channel_index=0)

        self.assertFalse(pixmap.isNull())
        request = providers[0].requests[0]
        self.assertEqual(request.start_fraction, 0.2)
        self.assertEqual(request.span_fraction, 0.4)

    def test_waveform_widget_passes_visible_time_window_to_trace_builder(
        self,
    ) -> None:
        channel = _channel([float(value) for value in range(100)])
        widget = WaveformWidget()
        widget.resize(320, 180)
        widget.set_waveform(
            _waveform_window_with_duration(channel, 10.0),
            viewport_start_seconds=2.0,
            viewport_duration_seconds=4.0,
            dataset_duration_seconds=10.0,
        )
        empty_trace = WaveformTraceView(
            mode="empty",
            sample_count=0,
            bucket_size=0,
            x_fraction=np.zeros(0, dtype=np.float32),
            values=np.zeros(0, dtype=np.float32),
            min_values=np.zeros(0, dtype=np.float32),
            max_values=np.zeros(0, dtype=np.float32),
        )

        with patch.object(
            waveform_widget,
            "build_waveform_trace_view",
            return_value=empty_trace,
        ) as build_trace:
            widget._draw_channel_geometry(
                _FakePainter(),
                channel,
                QRectF(0.0, 0.0, 320.0, 180.0),
                ("render-key",),
            )

        self.assertEqual(build_trace.call_args.kwargs["start_fraction"], 0.2)
        self.assertEqual(build_trace.call_args.kwargs["span_fraction"], 0.4)

    def test_waveform_widget_rebuilds_pixmap_when_samples_change_in_place(
        self,
    ) -> None:
        channel = _channel([0.0, 0.5, 1.0])
        widget = WaveformWidget()
        widget.resize(320, 180)
        widget.set_waveform(_waveform_window(channel), 0.0, 1.0, 1.0)

        first_pixmap = widget._channel_pixmap(channel, widget.size(), channel_index=0)
        channel.samples[1] = 99.0
        channel.max_value = 99.0
        second_pixmap = widget._channel_pixmap(channel, widget.size(), channel_index=0)

        self.assertIsNot(first_pixmap, second_pixmap)

    def test_waveform_widget_can_disable_waveform_layer(self) -> None:
        channel = _channel([0.0, 0.5, 1.0])
        widget = WaveformWidget()
        widget.resize(320, 180)
        widget.set_waveform(_waveform_window(channel), 0.0, 1.0, 1.0)
        widget.set_plot_layers(PlotLayerConfig(waveform=False))

        with (
            patch.object(waveform_widget, "QPainter", _FakePainter),
            patch.object(widget, "_draw_channel") as draw_channel,
            patch.object(widget, "_draw_annotation_overlays"),
        ):
            widget.paintEvent(None)

        draw_channel.assert_not_called()
        self.assertFalse(widget.plot_layers().waveform)

    def test_waveform_widget_can_disable_annotation_layer(self) -> None:
        channel = _channel([0.0, 0.5, 1.0])
        widget = WaveformWidget()
        widget.resize(320, 180)
        widget.set_waveform(_waveform_window(channel), 0.0, 1.0, 1.0)
        widget.set_plot_layers(PlotLayerConfig(annotations=False))

        with (
            patch.object(waveform_widget, "QPainter", _FakePainter),
            patch.object(widget, "_draw_channel"),
            patch.object(widget, "_draw_annotation_overlays") as draw_annotations,
        ):
            widget.paintEvent(None)

        draw_annotations.assert_not_called()
        self.assertFalse(widget.plot_layers().annotations)


class _RecordingProvider:
    def __init__(
        self,
        variant: DdaVariantResult,
        registry: list[_RecordingProvider],
    ) -> None:
        self.variant = variant
        self.requests: list[MatrixViewRequest] = []
        self.views: list[MatrixView] = []
        registry.append(self)

    def matrix_view(self, request: MatrixViewRequest) -> MatrixView:
        self.requests.append(request)
        view = DdaVariantPlotProvider(self.variant).matrix_view(request)
        self.views.append(view)
        return view


class _RecordingWaveformProvider:
    def __init__(self, window: WaveformWindow | None, registry: list) -> None:
        self.window = window
        self.requests = []
        registry.append(self)

    def render_key(self, request):
        self.requests.append(request)
        return waveform_render_key(
            self.window,
            target_width=request.target_width,
            channel_start=request.channel_start,
            channel_count=request.channel_count,
        )


if __name__ == "__main__":
    unittest.main()
