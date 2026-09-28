from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np

from ..backend.local import _find_cli_command
from ..domain.file_types import resolve_dataset_path
from ..runtime_paths import RuntimePaths
from .constants import _DDA_VARIANT_SPECS
from .runtime import (
    _batch_result_path,
    _dda_engine_info,
    _json_ready,
    _local_backend,
    _normalize_dda_backend_args,
    _print_json,
    _read_result_file,
    _resolve_batch_input_paths,
    _resolve_cli_file_argument,
    _run_dda_for_path,
    _selected_channel_indices,
    _selected_channel_names,
    _write_result_file,
)


def _handle_gui(args: argparse.Namespace) -> int:
    from ..gui_main import main as gui_main

    gui_args: list[str] = []
    if args.smoke_test:
        gui_args.append("--smoke-test")
    return gui_main(gui_args)


def _handle_mcp(_args: argparse.Namespace) -> int:
    from ..mcp_server import serve

    serve()
    return 0


def _handle_health(args: argparse.Namespace) -> int:
    backend, _runtime_paths = _local_backend()
    try:
        health = backend.health()
    finally:
        backend.close()
    if args.json:
        _print_json(health)
        return 0
    print(f"service: {health.service}")
    print(f"status: {health.status}")
    print(f"dda_available: {str(health.dda_available).lower()}")
    print(f"ica_available: {str(health.ica_available).lower()}")
    if health.diagnostics:
        print("diagnostics:")
        for line in health.diagnostics:
            print(f"  - {line}")
    return 0


def _handle_dataset_info(args: argparse.Namespace) -> int:
    backend, _runtime_paths = _local_backend()
    try:
        dataset = backend.load_dataset(args.file)
    finally:
        backend.close()
    _print_json(dataset)
    return 0


def _handle_waveform_window(args: argparse.Namespace) -> int:
    backend, _runtime_paths = _local_backend()
    try:
        dataset = backend.load_dataset(args.file)
        channel_names = _selected_channel_names(
            dataset,
            args.channels,
            all_channels=args.all_channels,
        )
        payload = backend.load_waveform_window(
            dataset.file_path,
            float(args.start),
            float(args.duration),
            channel_names,
        )
    finally:
        backend.close()
    _print_json(payload)
    return 0


def _handle_waveform_overview(args: argparse.Namespace) -> int:
    backend, _runtime_paths = _local_backend()
    try:
        dataset = backend.load_dataset(args.file)
        channel_names = _selected_channel_names(
            dataset,
            args.channels,
            all_channels=args.all_channels,
        )
        payload = backend.load_waveform_overview(
            dataset.file_path,
            channel_names,
            max_buckets=int(args.max_buckets),
        )
    finally:
        backend.close()
    _print_json(payload)
    return 0


def _handle_ica_run(args: argparse.Namespace) -> int:
    backend, _runtime_paths = _local_backend()
    try:
        dataset = backend.load_dataset(args.file)
        selected_indices = _selected_channel_indices(
            dataset,
            args.channels,
            all_channels=args.all_channels,
        )
        result = backend.run_ica(
            dataset=dataset,
            selected_channel_indices=selected_indices,
            start_time_seconds=args.start,
            end_time_seconds=args.end,
            n_components=args.n_components,
            max_iterations=int(args.max_iterations),
            tolerance=float(args.tolerance),
            centering=not bool(args.no_centering),
            whitening=not bool(args.no_whitening),
        )
    finally:
        backend.close()
    _print_json(result)
    return 0


def _handle_dda_info(args: argparse.Namespace) -> int:
    runtime_paths = RuntimePaths.detect()
    info = _dda_engine_info(runtime_paths)
    if args.json:
        _print_json(info)
        return 0
    print(f"ddalab CLI v{info['version']}")
    print(f"Platform: {info['platform']} ({info['architecture']})")
    print("")
    print(f"DDA available: {'yes' if info['ddaAvailable'] else 'no'}")
    print(f"Backend CLI: {info['backendCliPath'] or 'not found'}")
    print("Engine chain: Python CLI -> bundled dda-rs backend")
    print(
        f"Default window/step: {info['defaultWindowLengthSamples']}/{info['defaultWindowStepSamples']} samples"
    )
    print("Default delays: " + " ".join(str(value) for value in info["defaultDelays"]))
    print(
        "Supported variants: "
        + ", ".join(spec["id"] for spec in info["supportedVariants"])
    )
    print(
        "Accepted app variant IDs: "
        + ", ".join(spec["appId"] for spec in info["supportedVariants"])
    )
    return 0


def _handle_dda_variants(args: argparse.Namespace) -> int:
    payload = {
        "variants": [
            {
                "id": spec["id"],
                "appId": spec["app_id"],
                "label": spec["label"],
                "description": spec["description"],
            }
            for spec in _DDA_VARIANT_SPECS
        ]
    }
    if args.json:
        _print_json(payload)
        return 0
    for spec in payload["variants"]:
        print(
            f"{spec['id']}: {spec['label']} ({spec['appId']})\n  {spec['description']}"
        )
    return 0


def _handle_dda_validate(args: argparse.Namespace) -> int:
    requested_path = _resolve_cli_file_argument(
        flag_value=args.file,
        positional_value=args.file_arg,
        command_name="ddalab dda validate",
    )
    backend, runtime_paths = _local_backend()
    try:
        dataset = backend.load_dataset(requested_path)
        info = _dda_engine_info(runtime_paths)
    finally:
        backend.close()
    payload = {
        "inputPath": requested_path,
        "resolvedInputPath": resolve_dataset_path(
            requested_path, Path(requested_path).expanduser().is_dir()
        ),
        "datasetFilePath": dataset.file_path,
        "datasetFileName": dataset.file_name,
        "format": dataset.format_label,
        "channelCount": len(dataset.channels),
        "durationSeconds": dataset.duration_seconds,
        "dominantSampleRateHz": dataset.dominant_sample_rate_hz,
        "ddaAvailable": bool(info["ddaAvailable"]),
        "valid": bool(info["ddaAvailable"]) and len(dataset.channels) > 0,
        "engine": "Python CLI -> bundled dda-rs backend",
    }
    if args.json:
        _print_json(payload)
    else:
        print(f"Input path: {payload['inputPath']}")
        print(f"Resolved dataset: {payload['datasetFilePath']}")
        print(f"Format: {payload['format']}")
        print(f"Channels: {payload['channelCount']}")
        print(f"Duration: {payload['durationSeconds']:.3f}s")
        print(f"Dominant sample rate: {payload['dominantSampleRateHz']:.3f} Hz")
        print(f"DDA available: {'yes' if payload['ddaAvailable'] else 'no'}")
        print(f"Valid: {'yes' if payload['valid'] else 'no'}")
    return 0 if payload["valid"] else 1


def _handle_dda_run(args: argparse.Namespace) -> int:
    requested_path = _resolve_cli_file_argument(
        flag_value=args.file,
        positional_value=getattr(args, "file_arg", None),
        command_name="ddalab dda run",
    )
    backend, _runtime_paths = _local_backend()
    try:
        result = _run_dda_for_path(backend, requested_path, args)
        result = result.materialize()
    finally:
        backend.close()
    for warning in _result_warnings(result):
        print(f"warning: {warning}", file=sys.stderr)
    if args.output:
        _write_result_file(Path(args.output), result, compact=bool(args.compact))
        return 0
    _print_json(result, compact=bool(args.compact))
    return 0


def _handle_dda_batch(args: argparse.Namespace) -> int:
    input_paths = _resolve_batch_input_paths(args)
    if args.dry_run:
        payload = {
            "matchedFiles": len(input_paths),
            "files": input_paths,
        }
        _print_json(payload, compact=bool(args.compact))
        return 0

    output_dir = Path(args.output_dir).expanduser() if args.output_dir else None
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)

    backend, _runtime_paths = _local_backend()
    results: list[dict[str, Any]] = []
    failure_count = 0
    try:
        for input_path in input_paths:
            warnings: list[str] = []
            try:
                dda_result = _run_dda_for_path(backend, input_path, args)
                dda_result = dda_result.materialize()
                warnings = _result_warnings(dda_result)
                if warnings and args.strict:
                    raise RuntimeError(" ".join(warnings))
                output_path = (
                    _batch_result_path(output_dir, dda_result.file_path).with_suffix(
                        f".{args.output_format}"
                    )
                    if output_dir is not None
                    else None
                )
                if output_path is not None:
                    _write_result_file(
                        output_path, dda_result, compact=bool(args.compact)
                    )
                results.append(
                    {
                        "inputPath": input_path,
                        "resolvedDatasetPath": dda_result.file_path,
                        "status": "ok",
                        "warnings": warnings,
                        "outputPath": str(output_path)
                        if output_path is not None
                        else None,
                        # with --output-dir the result is in the file; keep stdout small
                        "result": _json_ready(dda_result)
                        if output_path is None
                        else {
                            "rows": {
                                v.id: len(v.row_labels) for v in dda_result.variants
                            },
                            "windows": len(dda_result.window_centers_seconds),
                        },
                    }
                )
            except Exception as exc:
                failure_count += 1
                results.append(
                    {
                        "inputPath": input_path,
                        "resolvedDatasetPath": resolve_dataset_path(
                            input_path, Path(input_path).expanduser().is_dir()
                        ),
                        "status": "error",
                        "warnings": warnings,
                        "error": str(exc),
                    }
                )
                if not args.continue_on_error:
                    break
    finally:
        backend.close()

    payload = {
        "matchedFiles": len(input_paths),
        "processedFiles": len(results),
        "succeeded": sum(1 for item in results if item["status"] == "ok"),
        "failed": failure_count,
        "withWarnings": sum(1 for item in results if item.get("warnings")),
        "results": results,
    }
    _print_json(payload, compact=bool(args.compact))
    return 0 if failure_count == 0 else 1


def circular_shift_test(values: np.ndarray, post: np.ndarray) -> tuple[float, float]:
    """Post-minus-pre mean and its two-sided p over all circular shifts of values.

    Shifting keeps the autocorrelation of overlapping windows, which a shuffle destroys.
    """

    def delta(series: np.ndarray) -> float:
        return float(np.nanmean(series[post]) - np.nanmean(series[~post]))

    observed = delta(values)
    null = np.array([delta(np.roll(values, shift)) for shift in range(1, len(values))])
    p_value = (1 + np.sum(np.abs(null) >= abs(observed) - 1e-12)) / len(values)
    return observed, float(p_value)


def _handle_dda_null(args: argparse.Namespace) -> int:
    payload = _read_result_file(Path(args.result).expanduser())
    variant = next(
        (item for item in payload["variants"] if item["id"] == args.variant), None
    )
    if variant is None:
        raise RuntimeError(f"The result contains no {args.variant} variant.")
    magnitude = np.nanmean(np.abs(np.asarray(variant["matrix"], dtype=float)), axis=0)
    post = np.asarray(payload["window_centers_seconds"], dtype=float) >= args.time
    if post.all() or not post.any():
        raise RuntimeError("--time must fall between the first and last window.")
    delta, p_value = circular_shift_test(magnitude, post)
    _print_json(
        {
            "variant": args.variant,
            "timeSeconds": args.time,
            "windowsBefore": int((~post).sum()),
            "windowsAfter": int(post.sum()),
            "statistic": "post minus pre mean of |value| across rows",
            "delta": delta,
            "pTwoSided": p_value,
            "rotations": len(magnitude) - 1,
            "lag1Autocorrelation": float(
                np.corrcoef(magnitude[:-1], magnitude[1:])[0, 1]
            ),
        },
        compact=bool(args.compact),
    )
    return 0


def _result_warnings(result) -> list[str]:
    prefix = "Warning: "
    return [
        line.removeprefix(prefix)
        for line in result.diagnostics
        if line.startswith(prefix)
    ]


def _handle_dda_raw(args: argparse.Namespace) -> int:
    runtime_paths = RuntimePaths.detect()
    repo_root = runtime_paths.source_repo_root or runtime_paths.browser_fallback_root()
    cli_command = _find_cli_command(runtime_paths, repo_root)
    if cli_command is None:
        raise RuntimeError("DDALAB backend CLI is unavailable in this install.")

    env = dict(os.environ)

    backend_args = list(args.backend_args or [])
    if backend_args and backend_args[0] == "--":
        backend_args = backend_args[1:]
    if not backend_args:
        backend_args = ["--help"]
    backend_args = _normalize_dda_backend_args(backend_args)

    process = subprocess.run(
        [*cli_command, *backend_args],
        cwd=str(repo_root),
        env=env,
        check=False,
    )
    return int(process.returncode)
