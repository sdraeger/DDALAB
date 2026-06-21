from __future__ import annotations

import sys
import unittest
from unittest.mock import patch

# ruff: noqa: E402
from pathlib import Path

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_qt.domain.models import (
    ChannelWaveform,
    DdaVariantResult,
    WaveformEnvelopeLevel,
    WaveformWindow,
)
from ddalab_qt.ui.plot_data import (
    DdaVariantPlotProvider,
    LINE_PLOT_COLORS,
    MatrixTileCache,
    MatrixViewRequest,
    WAVEFORM_LINE_COLOR,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_line_geometry_view,
    build_matrix_view,
    build_waveform_geometry_view,
    build_waveform_trace_view,
    heatmap_rgba,
    variant_plot_bounds,
    windowed_resample_indices,
)
from ddalab_qt.ui.qt_plot_renderer import heatmap_qimage, lineplot_qimage


def _variant(matrix: list[list[float]], *, min_value=0.0, max_value=1.0):
    return DdaVariantResult(
        id="ST",
        label="Single Timeseries",
        row_labels=[f"Row {index + 1}" for index in range(len(matrix))],
        matrix=matrix,
        summary="",
        min_value=min_value,
        max_value=max_value,
        column_count=max((len(row) for row in matrix), default=0),
    )


def _channel(
    samples: list[float],
    *,
    name: str = "Cz",
    levels: list[WaveformEnvelopeLevel] | None = None,
    min_value: float | None = None,
    max_value: float | None = None,
) -> ChannelWaveform:
    return ChannelWaveform(
        name=name,
        sample_rate_hz=1000.0,
        samples=samples,
        unit="uV",
        min_value=min_value
        if min_value is not None
        else min(samples)
        if samples
        else 0.0,
        max_value=max_value
        if max_value is not None
        else max(samples)
        if samples
        else 0.0,
        levels=levels or [],
    )


def _waveform_window(
    channels: list[ChannelWaveform],
    *,
    dataset_file_path: str = "demo.edf",
    start_time_seconds: float = 0.0,
    duration_seconds: float = 1.0,
) -> WaveformWindow:
    return WaveformWindow(
        dataset_file_path=dataset_file_path,
        start_time_seconds=start_time_seconds,
        duration_seconds=duration_seconds,
        channels=channels,
        from_cache=False,
    )


class PlotDataTests(unittest.TestCase):
    def test_windowed_resample_indices_respects_view_window(self) -> None:
        self.assertEqual(
            windowed_resample_indices(
                10,
                4,
                start_fraction=0.25,
                span_fraction=0.5,
            ),
            [2, 4, 5, 7],
        )

    def test_build_matrix_view_samples_columns_and_tracks_source_shape(self) -> None:
        view = build_matrix_view(
            _variant(
                [
                    list(range(10)),
                    list(range(10, 20)),
                ],
                min_value=0.0,
                max_value=20.0,
            ),
            target_columns=5,
            start_fraction=0.0,
            span_fraction=1.0,
        )

        self.assertEqual(view.source_row_count, 2)
        self.assertEqual(view.source_column_count, 10)
        self.assertEqual(view.sample_indices, (0, 2, 4, 7, 9))
        np.testing.assert_array_equal(
            view.values,
            np.asarray(
                [
                    [0, 2, 4, 7, 9],
                    [10, 12, 14, 17, 19],
                ],
                dtype=np.float32,
            ),
        )

    def test_variant_plot_provider_builds_requested_matrix_view(self) -> None:
        provider = DdaVariantPlotProvider(
            _variant(
                [
                    list(range(10)),
                    list(range(10, 20)),
                ],
                min_value=0.0,
                max_value=20.0,
            )
        )

        view = provider.matrix_view(
            MatrixViewRequest(
                target_columns=4,
                start_fraction=0.25,
                span_fraction=0.5,
                max_rows=1,
            )
        )

        self.assertEqual(view.source_row_count, 1)
        self.assertEqual(view.source_column_count, 10)
        self.assertEqual(view.source_column_start, 2)
        self.assertEqual(view.source_column_end, 8)
        self.assertEqual(view.sample_indices, (2, 4, 5, 7))
        np.testing.assert_array_equal(
            view.values,
            np.asarray([[2, 4, 5, 7]], dtype=np.float32),
        )

    def test_matrix_view_source_column_window_tracks_requested_window(self) -> None:
        view = build_matrix_view(
            _variant([list(range(10))]),
            target_columns=1,
            start_fraction=0.0,
            span_fraction=1.0,
        )

        self.assertEqual(view.source_column_start, 0)
        self.assertEqual(view.source_column_end, 10)
        self.assertEqual(view.sample_indices, (4,))

    def test_variant_plot_provider_logs_slow_matrix_view_metadata(self) -> None:
        provider = DdaVariantPlotProvider(
            _variant(
                [
                    list(range(10)),
                    list(range(10, 20)),
                ],
                min_value=0.0,
                max_value=20.0,
            )
        )
        request = MatrixViewRequest(
            target_columns=4,
            start_fraction=0.25,
            span_fraction=0.5,
            row_start=1,
            row_count=1,
        )

        with (
            patch(
                "ddalab_qt.ui.plot_data.perf_counter_ns", side_effect=[0, 20_000_000]
            ),
            patch("ddalab_qt.ui.plot_data.perf_logger", create=True) as perf_logger,
        ):
            provider.matrix_view(request)

        perf_logger.return_value.log_slow.assert_called_once_with(
            "plot.provider.matrix_view",
            "plot.provider.matrix_view.build",
            20.0,
            threshold_ms=12.0,
            rows=1,
            rowStart=1,
            totalRows=2,
            sourceCols=10,
            sourceColStart=2,
            sourceColEnd=8,
            targetCols=4,
            startFraction=0.25,
            spanFraction=0.5,
        )

    def test_variant_plot_provider_reuses_cached_matrix_tiles(self) -> None:
        tile_cache = MatrixTileCache()
        provider = DdaVariantPlotProvider(
            _variant(
                [
                    list(range(10)),
                    list(range(10, 20)),
                ],
                min_value=0.0,
                max_value=20.0,
            ),
            tile_cache=tile_cache,
        )
        request = MatrixViewRequest(
            target_columns=4,
            start_fraction=0.25,
            span_fraction=0.5,
            row_start=1,
            row_count=1,
        )

        first = provider.matrix_view(request)
        second = provider.matrix_view(request)

        self.assertIs(first, second)
        self.assertEqual(tile_cache.size, 1)

    def test_variant_plot_provider_cache_key_separates_viewports(self) -> None:
        tile_cache = MatrixTileCache()
        provider = DdaVariantPlotProvider(
            _variant(
                [
                    list(range(10)),
                    list(range(10, 20)),
                ],
                min_value=0.0,
                max_value=20.0,
            ),
            tile_cache=tile_cache,
        )

        first = provider.matrix_view(MatrixViewRequest(target_columns=4))
        second = provider.matrix_view(
            MatrixViewRequest(
                target_columns=4,
                start_fraction=0.25,
                span_fraction=0.5,
            )
        )

        self.assertIsNot(first, second)
        self.assertEqual(tile_cache.size, 2)

    def test_variant_plot_provider_honors_visible_row_range(self) -> None:
        provider = DdaVariantPlotProvider(
            _variant(
                [
                    list(range(5)),
                    list(range(10, 15)),
                    list(range(20, 25)),
                ],
                min_value=0.0,
                max_value=25.0,
            )
        )

        view = provider.matrix_view(
            MatrixViewRequest(
                target_columns=3,
                row_start=1,
                row_count=1,
            )
        )

        self.assertEqual(view.source_row_count, 1)
        self.assertEqual(view.row_start, 1)
        self.assertEqual(view.total_row_count, 3)
        self.assertEqual(view.row_labels, ("Row 2",))
        np.testing.assert_array_equal(
            view.values,
            np.asarray([[10, 12, 14]], dtype=np.float32),
        )

    def test_variant_plot_bounds_include_zero_when_values_are_nonfinite(self) -> None:
        self.assertEqual(
            variant_plot_bounds(
                _variant([[1.0, float("nan")]], min_value=2.0, max_value=3.0)
            ),
            (0.0, 3.0),
        )

    def test_heatmap_rgba_returns_renderer_ready_buffer(self) -> None:
        view = build_matrix_view(
            _variant([[0.0, 0.5, 1.0]], min_value=0.0, max_value=1.0),
            target_columns=3,
        )
        image = heatmap_rgba(view, "viridis")

        self.assertEqual(image.shape, (1, 3, 4))
        self.assertEqual(image.dtype, np.uint8)
        np.testing.assert_array_equal(image[0, 0], np.asarray([68, 1, 84, 255]))
        np.testing.assert_array_equal(image[0, 2], np.asarray([253, 231, 37, 255]))

    def test_heatmap_rgba_maps_nonfinite_values_as_zero(self) -> None:
        view = build_matrix_view(
            _variant([[float("nan")]], min_value=-1.0, max_value=1.0),
            target_columns=1,
        )
        image = heatmap_rgba(view, "cool")

        np.testing.assert_array_equal(image[0, 0], np.asarray([128, 128, 255, 255]))

    def test_heatmap_qimage_wraps_provider_buffer_for_qt_renderer(self) -> None:
        view = build_matrix_view(
            _variant([[0.0, 1.0]], min_value=0.0, max_value=1.0),
            target_columns=2,
        )

        image = heatmap_qimage(view, "viridis")

        self.assertEqual(image.width(), 2)
        self.assertEqual(image.height(), 1)
        self.assertEqual(image.pixelColor(0, 0).getRgb(), (68, 1, 84, 255))
        self.assertEqual(image.pixelColor(1, 0).getRgb(), (253, 231, 37, 255))

    def test_lineplot_qimage_renders_matrix_view_for_qt_quick_texture(self) -> None:
        view = build_matrix_view(
            _variant([[0.0, 0.5, 1.0]], min_value=0.0, max_value=1.0),
            target_columns=3,
        )

        image = lineplot_qimage(view, width=120, height=80)

        self.assertEqual(image.width(), 120)
        self.assertEqual(image.height(), 80)
        self.assertFalse(image.isNull())

    def test_line_geometry_view_normalizes_rows_for_scene_graph_renderer(self) -> None:
        view = build_matrix_view(
            _variant([[0.0, 0.5, 1.0]], min_value=0.0, max_value=1.0),
            target_columns=3,
        )

        geometry = build_line_geometry_view(view)

        self.assertEqual(geometry.source_row_count, 1)
        self.assertEqual(geometry.source_column_count, 3)
        self.assertEqual(geometry.colors, (LINE_PLOT_COLORS[0],))
        np.testing.assert_allclose(
            geometry.lines[0],
            np.asarray(
                [
                    [0.0, 1.0],
                    [0.5, 0.5],
                    [1.0, 0.0],
                ],
                dtype=np.float32,
            ),
        )

    def test_waveform_plot_provider_honors_visible_channel_range(self) -> None:
        provider = WaveformWindowPlotProvider(
            _waveform_window(
                [
                    _channel([0.0, 1.0, 2.0], name="Fp1"),
                    _channel([10.0, 11.0, 12.0], name="Cz"),
                    _channel([20.0, 21.0, 22.0], name="Pz"),
                ]
            )
        )

        geometry = provider.geometry_view(
            WaveformViewRequest(
                target_width=50,
                channel_start=1,
                channel_count=1,
            )
        )

        self.assertEqual(geometry.channel_count, 1)
        self.assertEqual(geometry.channel_start, 1)
        self.assertEqual(geometry.total_channel_count, 3)
        self.assertEqual(geometry.channel_labels, ("Cz",))
        self.assertEqual(geometry.sample_count, 3)

    def test_waveform_render_key_includes_dataset_identity(self) -> None:
        channel = _channel([0.0, 1.0, 2.0])
        request = WaveformViewRequest(target_width=50)
        first_provider = WaveformWindowPlotProvider(
            _waveform_window([channel], dataset_file_path="first.edf")
        )
        second_provider = WaveformWindowPlotProvider(
            _waveform_window([channel], dataset_file_path="second.edf")
        )

        self.assertNotEqual(
            first_provider.render_key(request),
            second_provider.render_key(request),
        )

    def test_waveform_render_key_includes_visible_time_range(self) -> None:
        channel = _channel([0.0, 1.0, 2.0])
        request = WaveformViewRequest(target_width=50)
        first_provider = WaveformWindowPlotProvider(
            _waveform_window(
                [channel],
                start_time_seconds=0.0,
                duration_seconds=1.0,
            )
        )
        second_provider = WaveformWindowPlotProvider(
            _waveform_window(
                [channel],
                start_time_seconds=10.0,
                duration_seconds=2.0,
            )
        )

        self.assertNotEqual(
            first_provider.render_key(request),
            second_provider.render_key(request),
        )

    def test_waveform_render_key_includes_visible_time_window_request(self) -> None:
        provider = WaveformWindowPlotProvider(
            _waveform_window([_channel(list(range(9)))])
        )

        full = provider.render_key(WaveformViewRequest(target_width=50))
        zoomed = provider.render_key(
            WaveformViewRequest(
                target_width=50,
                start_fraction=0.25,
                span_fraction=0.5,
            )
        )

        self.assertNotEqual(full, zoomed)

    def test_waveform_render_key_is_stable_after_lazy_envelope_build(self) -> None:
        channel = _channel(
            [
                value
                for bucket in range(10)
                for value in (float(bucket), -float(bucket + 1))
            ]
        )
        provider = WaveformWindowPlotProvider(_waveform_window([channel]))
        request = WaveformViewRequest(target_width=2)

        before = provider.render_key(request)
        provider.geometry_view(request)
        after = provider.render_key(request)

        self.assertEqual(before, after)

    def test_waveform_trace_view_uses_raw_samples_for_small_channels(self) -> None:
        view = build_waveform_trace_view(_channel([1.0, 2.0, 4.0]), target_width=20)

        self.assertEqual(view.mode, "samples")
        self.assertEqual(view.sample_count, 3)
        np.testing.assert_allclose(view.x_fraction, np.asarray([0.0, 0.5, 1.0]))
        np.testing.assert_allclose(view.values, np.asarray([1.0, 2.0, 4.0]))

    def test_waveform_trace_view_selects_envelope_level_for_dense_channels(
        self,
    ) -> None:
        levels = [
            WaveformEnvelopeLevel(bucket_size=5, mins=[0.0], maxs=[1.0]),
            WaveformEnvelopeLevel(
                bucket_size=20,
                mins=[-1.0, -2.0, -3.0],
                maxs=[1.0, 2.0, 3.0],
            ),
            WaveformEnvelopeLevel(bucket_size=50, mins=[-5.0], maxs=[5.0]),
        ]

        view = build_waveform_trace_view(
            _channel(list(range(1000)), levels=levels),
            target_width=20,
        )

        self.assertEqual(view.mode, "envelope")
        self.assertEqual(view.bucket_size, 20)
        np.testing.assert_allclose(view.x_fraction, np.asarray([0.0, 0.5, 1.0]))
        np.testing.assert_allclose(view.min_values, np.asarray([-1.0, -2.0, -3.0]))
        np.testing.assert_allclose(view.max_values, np.asarray([1.0, 2.0, 3.0]))

    def test_waveform_trace_view_builds_envelope_when_dense_channel_has_no_levels(
        self,
    ) -> None:
        samples = [
            value
            for bucket in range(10)
            for value in (float(bucket), -float(bucket + 1))
        ]

        view = build_waveform_trace_view(_channel(samples), target_width=2)

        self.assertEqual(view.mode, "envelope")
        self.assertGreater(view.bucket_size, 1)
        self.assertLessEqual(len(view.min_values), 4)
        self.assertEqual(float(view.min_values.min()), -10.0)
        self.assertEqual(float(view.max_values.max()), 9.0)

    def test_waveform_trace_view_stores_generated_envelope_level_for_reuse(
        self,
    ) -> None:
        channel = _channel(
            [
                value
                for bucket in range(10)
                for value in (float(bucket), -float(bucket + 1))
            ]
        )

        first = build_waveform_trace_view(channel, target_width=2)
        second = build_waveform_trace_view(channel, target_width=2)

        self.assertEqual(len(channel.levels), 1)
        self.assertEqual(channel.levels[0].bucket_size, first.bucket_size)
        self.assertEqual(second.bucket_size, first.bucket_size)
        np.testing.assert_allclose(second.min_values, first.min_values)
        np.testing.assert_allclose(second.max_values, first.max_values)

    def test_waveform_trace_view_is_empty_without_samples(self) -> None:
        view = build_waveform_trace_view(_channel([]), target_width=20)

        self.assertEqual(view.mode, "empty")
        self.assertEqual(view.sample_count, 0)

    def test_waveform_geometry_view_maps_samples_to_scene_graph_lines(self) -> None:
        geometry = build_waveform_geometry_view(
            _waveform_window([_channel([0.0, 5.0, 10.0])]),
            target_width=50,
        )

        self.assertEqual(geometry.channel_count, 1)
        self.assertEqual(geometry.channel_labels, ("Cz",))
        self.assertEqual(geometry.colors, (WAVEFORM_LINE_COLOR,))
        self.assertEqual(geometry.draw_modes, ("line_strip",))
        np.testing.assert_allclose(
            geometry.lines[0],
            np.asarray(
                [
                    [0.0, 1.0],
                    [0.5, 0.5],
                    [1.0, 0.0],
                ],
                dtype=np.float32,
            ),
        )

    def test_waveform_geometry_view_honors_visible_time_window(self) -> None:
        geometry = build_waveform_geometry_view(
            _waveform_window([_channel([float(value) for value in range(9)])]),
            target_width=50,
            start_fraction=0.25,
            span_fraction=0.5,
        )

        self.assertEqual(geometry.sample_count, 5)
        np.testing.assert_allclose(
            geometry.lines[0],
            np.asarray(
                [
                    [0.0, 0.75],
                    [0.25, 0.625],
                    [0.5, 0.5],
                    [0.75, 0.375],
                    [1.0, 0.25],
                ],
                dtype=np.float32,
            ),
        )

    def test_waveform_plot_provider_builds_requested_geometry_view(self) -> None:
        provider = WaveformWindowPlotProvider(
            _waveform_window([_channel([0.0, 5.0, 10.0])])
        )

        geometry = provider.geometry_view(WaveformViewRequest(target_width=50))

        self.assertEqual(geometry.channel_count, 1)
        self.assertEqual(geometry.sample_count, 3)
        self.assertEqual(geometry.draw_modes, ("line_strip",))
        np.testing.assert_allclose(
            geometry.lines[0],
            np.asarray(
                [
                    [0.0, 1.0],
                    [0.5, 0.5],
                    [1.0, 0.0],
                ],
                dtype=np.float32,
            ),
        )

    def test_waveform_plot_provider_logs_slow_geometry_metadata(self) -> None:
        provider = WaveformWindowPlotProvider(
            _waveform_window(
                [
                    _channel([0.0, 5.0, 10.0], name="Fp1"),
                    _channel([10.0, 11.0, 12.0], name="Cz"),
                ],
                dataset_file_path="demo.edf",
            )
        )
        request = WaveformViewRequest(
            target_width=50,
            channel_start=1,
            channel_count=1,
            start_fraction=0.25,
            span_fraction=0.5,
        )

        with (
            patch(
                "ddalab_qt.ui.plot_data.perf_counter_ns", side_effect=[0, 20_000_000]
            ),
            patch("ddalab_qt.ui.plot_data.perf_logger", create=True) as perf_logger,
        ):
            provider.geometry_view(request)

        perf_logger.return_value.log_slow.assert_called_once_with(
            "plot.provider.waveform_geometry",
            "plot.provider.waveform_geometry.build",
            20.0,
            threshold_ms=12.0,
            channels=1,
            channelStart=1,
            totalChannels=2,
            samples=3,
            lines=1,
            vertices=3,
            targetWidth=50,
            startFraction=0.25,
            spanFraction=0.5,
        )

    def test_waveform_geometry_view_maps_envelopes_to_vertical_segments(self) -> None:
        levels = [
            WaveformEnvelopeLevel(
                bucket_size=20,
                mins=[-1.0, -2.0, -3.0],
                maxs=[1.0, 2.0, 3.0],
            )
        ]

        geometry = build_waveform_geometry_view(
            _waveform_window(
                [
                    _channel(
                        list(range(1000)), levels=levels, min_value=-3.0, max_value=3.0
                    )
                ]
            ),
            target_width=20,
        )

        self.assertEqual(geometry.draw_modes, ("lines",))
        self.assertEqual(geometry.lines[0].shape, (6, 2))
        np.testing.assert_allclose(geometry.lines[0][0], np.asarray([0.0, 2.0 / 3.0]))
        np.testing.assert_allclose(geometry.lines[0][1], np.asarray([0.0, 1.0 / 3.0]))


if __name__ == "__main__":
    unittest.main()
