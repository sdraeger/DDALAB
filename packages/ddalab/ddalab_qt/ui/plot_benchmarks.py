from __future__ import annotations

import json
import math
from time import perf_counter_ns
from typing import Any

from ..app.perf_logging import perf_logger
from ..domain.models import ChannelWaveform, DdaVariantResult, WaveformWindow
from .plot_data import (
    DdaVariantPlotProvider,
    MatrixTileCache,
    MatrixViewRequest,
    WaveformViewRequest,
    WaveformWindowPlotProvider,
)


def dense_waveform_geometry_contract(
    *,
    channel_count: int = 4,
    sample_count: int = 20_000,
    target_width: int = 800,
) -> dict[str, Any]:
    started_ns = perf_counter_ns()
    window = WaveformWindow(
        dataset_file_path="synthetic-large.edf",
        start_time_seconds=0.0,
        duration_seconds=sample_count / 1000.0,
        channels=[
            _synthetic_channel(index, sample_count)
            for index in range(max(0, int(channel_count)))
        ],
        from_cache=False,
    )
    request = WaveformViewRequest(target_width=max(1, int(target_width)))
    geometry = WaveformWindowPlotProvider(window).geometry_view(request)
    return {
        "surface": "waveform",
        "durationMs": _duration_ms(started_ns),
        "channels": geometry.channel_count,
        "sourceSamplesPerChannel": max(0, int(sample_count)),
        "visibleSamples": geometry.sample_count,
        "targetWidth": request.target_width,
        "lines": len(geometry.lines),
        "vertices": sum(len(line) for line in geometry.lines),
        "drawModes": geometry.draw_modes,
    }


def dense_matrix_tile_contract(
    *,
    row_count: int = 32,
    column_count: int = 20_000,
    target_columns: int = 800,
    max_rows: int = 32,
    start_fraction: float = 0.0,
    span_fraction: float = 1.0,
) -> dict[str, Any]:
    started_ns = perf_counter_ns()
    variant = _synthetic_variant(row_count, column_count)
    cache = MatrixTileCache()
    provider = DdaVariantPlotProvider(variant, tile_cache=cache)
    request = MatrixViewRequest(
        target_columns=max(1, int(target_columns)),
        start_fraction=start_fraction,
        span_fraction=span_fraction,
        max_rows=max(0, int(max_rows)),
    )
    first = provider.matrix_view(request)
    second = provider.matrix_view(request)
    return {
        "surface": "matrix",
        "durationMs": _duration_ms(started_ns),
        "sourceRows": max(0, int(row_count)),
        "sourceColumns": max(0, int(column_count)),
        "sourceColumnStart": first.source_column_start,
        "sourceColumnEnd": first.source_column_end,
        "tileRows": first.source_row_count,
        "tileColumns": first.target_column_count,
        "tileCells": int(first.values.size),
        "cacheReused": first is second,
        "cacheEntries": cache.size,
    }


def run_plot_performance_contracts(*, log: bool = True) -> list[dict[str, Any]]:
    contracts = [
        dense_waveform_geometry_contract(),
        dense_matrix_tile_contract(),
    ]
    if log:
        logger = perf_logger()
        for contract in contracts:
            logger.log("plot.performance_contract", **contract)
    return contracts


def main() -> int:
    print(
        json.dumps(run_plot_performance_contracts(log=True), indent=2, sort_keys=True)
    )
    return 0


def _synthetic_channel(index: int, sample_count: int) -> ChannelWaveform:
    count = max(0, int(sample_count))
    samples = [
        math.sin(position / 32.0 + index) + 0.2 * math.sin(position / 7.0)
        for position in range(count)
    ]
    return ChannelWaveform(
        name=f"C{index + 1}",
        sample_rate_hz=1000.0,
        samples=samples,
        unit="uV",
        min_value=min(samples) if samples else 0.0,
        max_value=max(samples) if samples else 0.0,
        levels=[],
    )


def _synthetic_variant(row_count: int, column_count: int) -> DdaVariantResult:
    rows = max(0, int(row_count))
    cols = max(0, int(column_count))
    matrix = [
        [math.sin(column / 41.0 + row * 0.17) for column in range(cols)]
        for row in range(rows)
    ]
    return DdaVariantResult(
        id="ST",
        label="Synthetic ST",
        row_labels=[f"Row {index + 1}" for index in range(rows)],
        matrix=matrix,
        summary="Synthetic dense DDA result for plot performance contracts",
        min_value=-1.0,
        max_value=1.0,
        column_count=cols,
    )


def _duration_ms(started_ns: int) -> float:
    return max(0.0, (perf_counter_ns() - started_ns) / 1_000_000.0)


if __name__ == "__main__":
    raise SystemExit(main())
