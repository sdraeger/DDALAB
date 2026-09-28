from __future__ import annotations

import sys
import unittest

# ruff: noqa: E402
from pathlib import Path
from unittest.mock import patch

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
if str(PACKAGE_ROOT) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT))

from ddalab_app.domain.models import (
    ChannelWaveform,
    DdaVariantResult,
    WaveformWindow,
)
from ddalab_app.ui.plot_data import (
    WAVEFORM_LINE_COLOR,
    DdaVariantPlotProvider,
    MatrixTileCache,
    MatrixViewRequest,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
    build_matrix_view,
    build_waveform_geometry_view,
    heatmap_rgba,
    variant_plot_bounds,
)
from ddalab_app.ui.qt_plot_renderer import heatmap_qimage, lineplot_qimage, waveform_qimage


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
        # each of the 5 pixels keeps the largest-magnitude value of its 2 windows
        self.assertEqual(view.sample_indices, (0, 2, 4, 6, 8))
        np.testing.assert_array_equal(
            view.values,
            np.asarray(
                [
                    [1, 3, 5, 7, 9],
                    [11, 13, 15, 17, 19],
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
        self.assertEqual(view.sample_indices, (2, 3, 5, 6))
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
        self.assertEqual(view.sample_indices, (0,))

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
                "ddalab_app.ui.plot_matrix_data.perf_counter_ns",
                side_effect=[0, 20_000_000],
            ),
            patch(
                "ddalab_app.ui.plot_matrix_data.perf_logger",
                create=True,
            ) as perf_logger,
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

    def test_nonfinite_cells_are_transparent_and_keep_the_finite_range(self) -> None:
        variant = _variant([[2.0, float("nan"), 3.0]], min_value=2.0, max_value=3.0)
        low, high = variant_plot_bounds(variant)  # 1st-99th percentile of 2 and 3
        self.assertTrue(2.0 <= low < high <= 3.0)
        view = build_matrix_view(variant, target_columns=3)
        self.assertEqual(heatmap_rgba(view, "inferno")[0, :, 3].tolist(), [255, 0, 255])

    def test_build_matrix_view_samples_rows_without_full_numpy_conversion(self) -> None:
        variant = _variant(
            [
                list(range(10)),
                list(range(10, 20)),
            ],
            min_value=0.0,
            max_value=20.0,
        )

        with patch(
            "ddalab_app.ui.plot_matrix_data.np.asarray",
            wraps=np.asarray,
        ) as asarray:
            build_matrix_view(variant, target_columns=4)
            build_matrix_view(
                variant,
                target_columns=4,
                start_fraction=0.25,
                span_fraction=0.5,
            )

        asarray.assert_not_called()

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

    def test_lineplot_qimage_draws_every_value_of_each_row(self) -> None:
        rows = np.zeros((1, 1000))
        rows[0, 500] = 1.0  # one spike among 1000 windows, drawn 120 px wide

        image = lineplot_qimage(rows, 0.0, 1.0, width=120, height=80)

        self.assertEqual((image.width(), image.height()), (120, 80))
        painted = [
            sum(image.pixelColor(x, y).alpha() > 0 for y in range(80)) for x in range(120)
        ]
        self.assertGreater(painted[60], 40)  # the spike column spans most of the height
        self.assertLess(max(painted[:55] + painted[65:]), 5)

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

    def test_waveform_render_key_matches_a_reload_and_tracks_the_pixel_size(self) -> None:
        def key(**request) -> tuple:
            window = _waveform_window([_channel([float(v) for v in range(1000)])])
            return WaveformWindowPlotProvider(window).render_key(
                WaveformViewRequest(target_width=40, **request)
            )

        self.assertEqual(key(), key())  # separately loaded, same range
        self.assertNotEqual(key(), key(target_height=300))

    def test_waveform_columns_keep_every_spike_step_and_gap(self) -> None:
        samples = np.zeros(360_000, dtype=np.float32)
        spikes = np.random.default_rng(0).choice(np.arange(1_000, 150_000), 40, replace=False)
        samples[spikes] = 4.0
        samples[200_000:] = 1.0
        samples[300_000:330_000] = np.nan
        geometry = build_waveform_geometry_view(
            _waveform_window([_channel(samples, min_value=0.0, max_value=4.0)]),
            target_width=600,
        )

        spans = geometry.lines[0]
        self.assertEqual(geometry.draw_modes, ("columns",))
        self.assertEqual(spans.shape, (600, 2))
        # sample i is drawn in column i * 600 // 360_000; every spike reaches the top
        self.assertTrue(np.all(spans[spikes * 600 // 360_000, 0] == 0.0))
        step = 200_000 * 600 // 360_000
        self.assertEqual((spans[step, 0], spans[step, 1]), (0.75, 1.0))  # joined edge
        self.assertTrue(np.isnan(spans[505:549]).all())  # gap stays empty
        image = waveform_qimage(geometry, width=600, height=100)
        top_row = [image.pixelColor(int(c), 0).alpha() for c in spikes * 600 // 360_000]
        self.assertTrue(all(top_row))

    def test_waveform_columns_interpolate_sparse_samples(self) -> None:
        geometry = build_waveform_geometry_view(
            _waveform_window([_channel([0.0, 5.0, 10.0])]),
            target_width=50,
        )

        spans = geometry.lines[0]
        drawn = np.isfinite(spans[:, 0])
        # sample i sits at x = i * 50 / 3, so the line ends at the last sample
        self.assertTrue(drawn[:34].all() and not drawn[34:].any())
        self.assertTrue(np.all(spans[:33, 0] <= spans[1:34, 1]))  # columns connect

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
                "ddalab_app.ui.plot_waveform_data.perf_counter_ns",
                side_effect=[0, 20_000_000],
            ),
            patch(
                "ddalab_app.ui.plot_waveform_data.perf_logger",
                create=True,
            ) as perf_logger,
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
            targetWidth=50,
            startFraction=0.25,
            spanFraction=0.5,
        )


if __name__ == "__main__":
    unittest.main()
