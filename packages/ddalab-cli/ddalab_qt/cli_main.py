from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import platform
import subprocess
import sys
from dataclasses import asdict, is_dataclass
from importlib.metadata import PackageNotFoundError, version as package_version
from pathlib import Path
from typing import Any, Optional, Sequence

from .backend.api import LocalBackendClient, _find_cli_command
from .domain.file_types import resolve_dataset_path, supports_qt_dataset_path
from .domain.models import DdaReproductionConfig, DdaResult
from .runtime_paths import RuntimePaths


_DDA_VARIANT_SPECS = [
    {
        "id": "ST",
        "app_id": "single_timeseries",
        "label": "Single Timeseries",
        "description": "Per-channel delay differential analysis.",
    },
    {
        "id": "CT",
        "app_id": "cross_timeseries",
        "label": "Cross Timeseries",
        "description": "Undirected pairwise coupling metrics.",
    },
    {
        "id": "CD",
        "app_id": "cross_dynamical",
        "label": "Cross Dynamical",
        "description": "Directed pairwise coupling metrics.",
    },
    {
        "id": "DE",
        "app_id": "dynamical_ergodicity",
        "label": "Dynamical Ergodicity",
        "description": "Per-channel ergodicity metrics.",
    },
    {
        "id": "SY",
        "app_id": "synchronization",
        "label": "Synchronization",
        "description": "Per-channel synchronization metrics.",
    },
]
_DDA_VARIANT_ALIAS_MAP = {
    alias: spec["id"]
    for spec in _DDA_VARIANT_SPECS
    for alias in (str(spec["id"]).lower(), str(spec["app_id"]).lower())
}
_DEFAULT_DDA_WINDOW_LENGTH = 64
_DEFAULT_DDA_WINDOW_STEP = 10
_DEFAULT_DDA_DELAYS = [7, 10]
_DEFAULT_DDA_END_SECONDS = 30.0
_DEFAULT_DDA_MODEL_DIMENSION = 4
_DEFAULT_DDA_POLYNOMIAL_ORDER = 4
_DEFAULT_DDA_NR_TAU = 2
_DEFAULT_DDA_MODEL_TERMS = [1, 2, 10]


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 0
    try:
        return int(handler(args) or 0)
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ddalab",
        description="DDALAB command-line interface",
    )
    subparsers = parser.add_subparsers(dest="command")

    gui_parser = subparsers.add_parser("gui", help="Launch the desktop GUI")
    gui_parser.add_argument("--server", default=None)
    gui_parser.add_argument("--smoke-test", action="store_true")
    gui_parser.set_defaults(handler=_handle_gui)

    health_parser = subparsers.add_parser("health", help="Inspect the local backend")
    health_parser.add_argument("--json", action="store_true")
    health_parser.set_defaults(handler=_handle_health)

    dataset_parser = subparsers.add_parser(
        "dataset",
        help="Inspect supported local datasets",
    )
    dataset_subparsers = dataset_parser.add_subparsers(dest="dataset_command")
    dataset_parser.set_defaults(handler=_help_handler(dataset_parser))
    dataset_info = dataset_subparsers.add_parser(
        "info",
        help="Load dataset metadata",
    )
    dataset_info.add_argument("--file", required=True)
    dataset_info.set_defaults(handler=_handle_dataset_info)

    waveform_parser = subparsers.add_parser(
        "waveform",
        help="Load waveform windows or overviews",
    )
    waveform_subparsers = waveform_parser.add_subparsers(dest="waveform_command")
    waveform_parser.set_defaults(handler=_help_handler(waveform_parser))
    waveform_window = waveform_subparsers.add_parser(
        "window",
        help="Load a waveform window",
    )
    waveform_window.add_argument("--file", required=True)
    waveform_window.add_argument("--start", type=float, default=0.0)
    waveform_window.add_argument("--duration", type=float, required=True)
    waveform_window.add_argument("--channels", type=int, nargs="+")
    waveform_window.add_argument("--all-channels", action="store_true")
    waveform_window.set_defaults(handler=_handle_waveform_window)

    waveform_overview = waveform_subparsers.add_parser(
        "overview",
        help="Load a waveform overview",
    )
    waveform_overview.add_argument("--file", required=True)
    waveform_overview.add_argument("--channels", type=int, nargs="+")
    waveform_overview.add_argument("--all-channels", action="store_true")
    waveform_overview.add_argument("--max-buckets", type=int, default=1600)
    waveform_overview.set_defaults(handler=_handle_waveform_overview)

    ica_parser = subparsers.add_parser(
        "ica",
        help="Run local ICA analysis through the Python backend",
    )
    ica_subparsers = ica_parser.add_subparsers(dest="ica_command")
    ica_parser.set_defaults(handler=_help_handler(ica_parser))
    ica_run = ica_subparsers.add_parser("run", help="Run ICA")
    ica_run.add_argument("--file", required=True)
    ica_run.add_argument("--channels", type=int, nargs="+")
    ica_run.add_argument("--all-channels", action="store_true")
    ica_run.add_argument("--start", type=float)
    ica_run.add_argument("--end", type=float)
    ica_run.add_argument("--n-components", type=int)
    ica_run.add_argument("--max-iterations", type=int, default=400)
    ica_run.add_argument("--tolerance", type=float, default=1e-4)
    ica_run.add_argument(
        "--no-centering",
        action="store_true",
        help="Disable mean-centering before ICA",
    )
    ica_run.add_argument(
        "--no-whitening",
        action="store_true",
        help="Disable whitening before ICA",
    )
    ica_run.set_defaults(handler=_handle_ica_run)

    dda_parser = subparsers.add_parser(
        "dda",
        help="Run DDA through DDALAB's local Python orchestration layer",
    )
    dda_subparsers = dda_parser.add_subparsers(dest="dda_command")
    dda_parser.set_defaults(handler=_help_handler(dda_parser))

    dda_info = dda_subparsers.add_parser(
        "info",
        help="Show bundled DDA engine information",
    )
    dda_info.add_argument("--json", action="store_true")
    dda_info.set_defaults(handler=_handle_dda_info)

    dda_variants = dda_subparsers.add_parser(
        "variants",
        help="List supported DDA variants",
    )
    dda_variants.add_argument("--json", action="store_true")
    dda_variants.set_defaults(handler=_handle_dda_variants)

    dda_validate = dda_subparsers.add_parser(
        "validate",
        help="Validate that a dataset can be opened and is DDA-ready",
    )
    dda_validate.add_argument("file_arg", nargs="?")
    dda_validate.add_argument("--file")
    dda_validate.add_argument("--json", action="store_true")
    dda_validate.set_defaults(handler=_handle_dda_validate)

    dda_run = dda_subparsers.add_parser(
        "run",
        help="Run DDA on a supported dataset",
    )
    _add_dda_dataset_config_arguments(dda_run, allow_positional_file=True)
    dda_run.add_argument(
        "--output",
        help="Write the JSON result to a file instead of stdout",
    )
    dda_run.add_argument(
        "--compact",
        action="store_true",
        help="Emit compact JSON output",
    )
    dda_run.set_defaults(handler=_handle_dda_run)

    dda_batch = dda_subparsers.add_parser(
        "batch",
        help="Run DDA across multiple datasets",
    )
    batch_input = dda_batch.add_mutually_exclusive_group(required=True)
    batch_input.add_argument("--glob", help="Glob pattern to match input files")
    batch_input.add_argument("--files", nargs="+", help="Explicit list of input files")
    batch_input.add_argument(
        "--bids-dir",
        help="BIDS directory to scan for openable datasets",
    )
    _add_dda_analysis_arguments(dda_batch)
    dda_batch.add_argument(
        "--output-dir",
        help="Directory to write per-file JSON result payloads",
    )
    dda_batch.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Continue processing remaining files after a failure",
    )
    dda_batch.add_argument(
        "--dry-run",
        action="store_true",
        help="List resolved input datasets without running DDA",
    )
    dda_batch.add_argument(
        "--compact",
        action="store_true",
        help="Emit compact JSON output",
    )
    dda_batch.set_defaults(handler=_handle_dda_batch)

    dda_raw = dda_subparsers.add_parser(
        "raw",
        help="Internal debugging passthrough to the bundled Rust backend",
    )
    dda_raw.add_argument(
        "backend_args",
        nargs=argparse.REMAINDER,
        help=argparse.SUPPRESS,
    )
    dda_raw.set_defaults(handler=_handle_dda_raw)

    return parser


def _help_handler(parser: argparse.ArgumentParser):
    def handler(_args: argparse.Namespace) -> int:
        parser.print_help()
        return 0

    return handler


def _add_dda_dataset_config_arguments(
    parser: argparse.ArgumentParser,
    *,
    allow_positional_file: bool,
) -> None:
    if allow_positional_file:
        parser.add_argument(
            "file_arg",
            nargs="?",
            help="Dataset path; equivalent to --file when provided positionally",
        )
    parser.add_argument("--file", help="Dataset path")
    _add_dda_analysis_arguments(parser)


def _add_dda_analysis_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--channels", type=int, nargs="+")
    parser.add_argument("--all-channels", action="store_true")
    parser.add_argument(
        "--variant-channels",
        action="append",
        default=[],
        metavar="VARIANT:IDX,IDX",
        help="Override channels for a specific variant; may be repeated.",
    )
    parser.add_argument(
        "--variant-pairs",
        action="append",
        default=[],
        metavar="VARIANT:LEFT-RIGHT,LEFT>RIGHT",
        help="Override CT/CD pairs for a specific variant; may be repeated.",
    )
    parser.add_argument(
        "--variants",
        nargs="+",
        default=["ST"],
        help="Variant IDs or app IDs (ST, CT, CD, DE, SY or app-style IDs)",
    )
    parser.add_argument("--wl", type=int, default=_DEFAULT_DDA_WINDOW_LENGTH)
    parser.add_argument("--ws", type=int, default=_DEFAULT_DDA_WINDOW_STEP)
    parser.add_argument("--delays", type=int, nargs="+", default=list(_DEFAULT_DDA_DELAYS))
    parser.add_argument(
        "--model",
        type=int,
        nargs="+",
        default=list(_DEFAULT_DDA_MODEL_TERMS),
        help="Selected MODEL term indices (for example: --model 1 2 10)",
    )
    parser.add_argument("--dm", type=int, default=_DEFAULT_DDA_MODEL_DIMENSION)
    parser.add_argument(
        "--order",
        type=int,
        default=_DEFAULT_DDA_POLYNOMIAL_ORDER,
        help="Polynomial order for the DDA MODEL space",
    )
    parser.add_argument(
        "--nr-tau",
        dest="nr_tau",
        type=int,
        default=_DEFAULT_DDA_NR_TAU,
        help="Number of delay slots used when generating MODEL terms",
    )
    parser.add_argument("--start", type=float)
    parser.add_argument("--end", type=float)
    parser.add_argument("--start-sample", type=int)
    parser.add_argument("--end-sample", type=int)
    parser.add_argument(
        "--full-duration",
        action="store_true",
        help="Use the dataset end instead of DDALAB's 30-second default window",
    )


def _handle_gui(args: argparse.Namespace) -> int:
    from .gui_main import main as gui_main

    gui_args: list[str] = []
    if args.server:
        gui_args.extend(["--server", str(args.server)])
    if args.smoke_test:
        gui_args.append("--smoke-test")
    return gui_main(gui_args)


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
    print(f"Native DDA binary: {info['ddaBinaryPath'] or 'not required'}")
    print("Engine chain: Python CLI -> bundled dda-rs backend")
    print(f"Default window/step: {info['defaultWindowLengthSamples']}/{info['defaultWindowStepSamples']} samples")
    print(
        "Default delays: "
        + " ".join(str(value) for value in info["defaultDelays"])
    )
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
            f"{spec['id']}: {spec['label']} ({spec['appId']})\n"
            f"  {spec['description']}"
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
    if args.output:
        _write_json_file(Path(args.output), result, compact=bool(args.compact))
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
            try:
                dda_result = _run_dda_for_path(backend, input_path, args)
                dda_result = dda_result.materialize()
                output_path = (
                    _batch_result_path(output_dir, dda_result.file_path)
                    if output_dir is not None
                    else None
                )
                if output_path is not None:
                    _write_json_file(output_path, dda_result, compact=bool(args.compact))
                results.append(
                    {
                        "inputPath": input_path,
                        "resolvedDatasetPath": dda_result.file_path,
                        "status": "ok",
                        "outputPath": str(output_path) if output_path is not None else None,
                        "result": _json_ready(dda_result),
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
        "results": results,
    }
    _print_json(payload, compact=bool(args.compact))
    return 0 if failure_count == 0 else 1


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


def _normalize_dda_backend_args(
    backend_args: Sequence[str],
) -> list[str]:
    normalized = list(backend_args)
    if not normalized:
        return normalized

    subcommand = normalized[0]
    if subcommand == "run":
        normalized = _normalize_dda_run_args(normalized)

    return normalized


def _normalize_dda_run_args(backend_args: Sequence[str]) -> list[str]:
    normalized = list(backend_args)
    run_args = normalized[1:]
    if _has_cli_flag(run_args, "--file"):
        return normalized
    if run_args and not str(run_args[0]).startswith("-"):
        return ["run", "--file", str(run_args[0]), *run_args[1:]]
    return normalized


def _has_cli_flag(values: Sequence[str], flag: str) -> bool:
    return any(value == flag or str(value).startswith(f"{flag}=") for value in values)


def _local_backend() -> tuple[LocalBackendClient, RuntimePaths]:
    runtime_paths = RuntimePaths.detect()
    return LocalBackendClient(runtime_paths), runtime_paths


def _run_dda_for_path(
    backend: LocalBackendClient,
    path: str,
    args: argparse.Namespace,
):
    dataset = backend.load_dataset(path)
    variants = _normalize_variant_ids(getattr(args, "variants", None))
    variant_channel_indices = _parse_variant_channel_args(
        getattr(args, "variant_channels", None),
    )
    variant_pair_indices = _parse_variant_pair_args(
        getattr(args, "variant_pairs", None),
    )
    selected_indices = _selected_channel_indices(
        dataset,
        getattr(args, "channels", None),
        all_channels=bool(getattr(args, "all_channels", False)),
        default_first_n=not (variant_channel_indices or variant_pair_indices),
    )
    selected_indices = _merge_selected_channel_indices(
        selected_indices,
        variant_channel_indices,
        variant_pair_indices,
    )
    if not selected_indices:
        raise RuntimeError("No valid channels were selected for DDA.")
    start_time_seconds, end_time_seconds = _resolve_dda_time_bounds(dataset, args)
    delays = [int(value) for value in getattr(args, "delays", _DEFAULT_DDA_DELAYS)]
    model_terms = [
        int(value) for value in getattr(args, "model", _DEFAULT_DDA_MODEL_TERMS)
    ]
    model_dimension = int(getattr(args, "dm", _DEFAULT_DDA_MODEL_DIMENSION))
    polynomial_order = int(
        getattr(args, "order", _DEFAULT_DDA_POLYNOMIAL_ORDER)
    )
    nr_tau = int(getattr(args, "nr_tau", _DEFAULT_DDA_NR_TAU))
    expert_mode = bool(
        delays != list(_DEFAULT_DDA_DELAYS)
        or model_terms != list(_DEFAULT_DDA_MODEL_TERMS)
        or model_dimension != _DEFAULT_DDA_MODEL_DIMENSION
        or polynomial_order != _DEFAULT_DDA_POLYNOMIAL_ORDER
        or nr_tau != _DEFAULT_DDA_NR_TAU
    )
    result = backend.run_dda(
        dataset=dataset,
        selected_channel_indices=selected_indices,
        selected_variants=variants,
        window_length_samples=int(getattr(args, "wl", _DEFAULT_DDA_WINDOW_LENGTH)),
        window_step_samples=int(getattr(args, "ws", _DEFAULT_DDA_WINDOW_STEP)),
        delays=delays,
        model_terms=model_terms,
        model_dimension=model_dimension,
        polynomial_order=polynomial_order,
        nr_tau=nr_tau,
        start_time_seconds=start_time_seconds,
        end_time_seconds=end_time_seconds,
        variant_channel_indices=variant_channel_indices or None,
        variant_pair_indices=variant_pair_indices or None,
    )
    result.reproduction = DdaReproductionConfig(
        expert_mode=expert_mode,
        variant_ids=list(variants),
        selected_channel_indices=list(selected_indices),
        selected_channel_names=[
            dataset.channel_names[index]
            for index in selected_indices
            if 0 <= index < len(dataset.channel_names)
        ],
        variant_channel_indices={
            variant_id: list(indices)
            for variant_id, indices in variant_channel_indices.items()
        },
        variant_channel_names={
            variant_id: [
                dataset.channel_names[index]
                for index in indices
                if 0 <= index < len(dataset.channel_names)
            ]
            for variant_id, indices in variant_channel_indices.items()
        },
        variant_pair_indices={
            variant_id: list(pairs)
            for variant_id, pairs in variant_pair_indices.items()
        },
        variant_pair_names={
            variant_id: [
                (
                    dataset.channel_names[left]
                    if 0 <= left < len(dataset.channel_names)
                    else str(left),
                    dataset.channel_names[right]
                    if 0 <= right < len(dataset.channel_names)
                    else str(right),
                )
                for left, right in pairs
            ]
            for variant_id, pairs in variant_pair_indices.items()
        },
        window_length_samples=int(getattr(args, "wl", _DEFAULT_DDA_WINDOW_LENGTH)),
        window_step_samples=int(getattr(args, "ws", _DEFAULT_DDA_WINDOW_STEP)),
        delays=delays,
        model_terms=model_terms,
        model_dimension=model_dimension,
        polynomial_order=polynomial_order,
        nr_tau=nr_tau,
        start_time_seconds=start_time_seconds,
        end_time_seconds=end_time_seconds,
    )
    return result


def _resolve_cli_file_argument(
    *,
    flag_value: Optional[str],
    positional_value: Optional[str],
    command_name: str,
) -> str:
    if flag_value and positional_value and Path(flag_value) != Path(positional_value):
        raise RuntimeError(
            f"{command_name} received both a positional file and --file with different values."
        )
    value = flag_value or positional_value
    if not value:
        raise RuntimeError(f"{command_name} requires a dataset path.")
    return value


def _resolve_dda_time_bounds(
    dataset: Any,
    args: argparse.Namespace,
) -> tuple[float, Optional[float]]:
    start_seconds = args.start
    end_seconds = args.end
    start_sample = args.start_sample
    end_sample = args.end_sample
    full_duration = bool(args.full_duration)
    sample_rate = max(float(dataset.dominant_sample_rate_hz), 1.0)

    if start_seconds is not None and start_sample is not None:
        raise RuntimeError("Use either --start or --start-sample, not both.")
    if end_seconds is not None and end_sample is not None:
        raise RuntimeError("Use either --end or --end-sample, not both.")
    if full_duration and (end_seconds is not None or end_sample is not None):
        raise RuntimeError("Use either --full-duration or an explicit end bound, not both.")

    resolved_start = (
        float(start_seconds)
        if start_seconds is not None
        else (float(start_sample) / sample_rate if start_sample is not None else 0.0)
    )
    if resolved_start < 0.0:
        raise RuntimeError("Start bound cannot be negative.")

    if full_duration:
        resolved_end: Optional[float] = None
    elif end_seconds is not None:
        resolved_end = float(end_seconds)
    elif end_sample is not None:
        resolved_end = float(end_sample) / sample_rate
    else:
        resolved_end = float(dataset.duration_seconds)
    return resolved_start, resolved_end


def _normalize_variant_ids(values: Optional[Sequence[str]]) -> list[str]:
    if not values:
        return ["ST"]
    normalized: list[str] = []
    for raw_value in values:
        for token in str(raw_value).split(","):
            cleaned = token.strip()
            if not cleaned:
                continue
            variant_id = _DDA_VARIANT_ALIAS_MAP.get(cleaned.lower())
            if variant_id is None:
                supported = ", ".join(spec["id"] for spec in _DDA_VARIANT_SPECS)
                raise RuntimeError(
                    f"Unsupported DDA variant '{cleaned}'. Supported variants: {supported}."
                )
            if variant_id not in normalized:
                normalized.append(variant_id)
    if not normalized:
        raise RuntimeError("At least one DDA variant is required.")
    return normalized


def _resolve_batch_input_paths(args: argparse.Namespace) -> list[str]:
    candidates: list[str] = []
    if args.glob:
        candidates.extend(
            match
            for match in glob.glob(str(args.glob), recursive=True)
            if Path(match).exists()
        )
    elif args.files:
        candidates.extend(str(value) for value in args.files)
    elif args.bids_dir:
        root = Path(args.bids_dir).expanduser()
        if not root.exists():
            raise RuntimeError(f"BIDS directory does not exist: {root}")
        candidates.extend(str(path) for path in root.rglob("*"))

    resolved: list[str] = []
    seen: set[str] = set()
    for raw_path in sorted(candidates, key=lambda value: str(value).lower()):
        target = Path(raw_path).expanduser()
        if not target.exists():
            continue
        if not supports_qt_dataset_path(str(target), target.is_dir()):
            continue
        canonical = resolve_dataset_path(str(target), target.is_dir())
        canonical_path = str(Path(canonical).expanduser().resolve())
        if canonical_path in seen:
            continue
        seen.add(canonical_path)
        resolved.append(canonical_path)
    if not resolved:
        raise RuntimeError("No openable datasets matched the requested batch inputs.")
    return resolved


def _batch_result_path(output_dir: Path, dataset_file_path: str) -> Path:
    source = Path(dataset_file_path)
    digest = hashlib.sha1(str(source).encode("utf-8")).hexdigest()[:8]
    safe_stem = "".join(
        char if char.isalnum() or char in {"-", "_", "."} else "_"
        for char in source.stem
    ).strip("._")
    if not safe_stem:
        safe_stem = "dataset"
    return output_dir / f"{safe_stem}.{digest}.dda.json"


def _dda_engine_info(runtime_paths: RuntimePaths) -> dict[str, Any]:
    repo_root = runtime_paths.source_repo_root or runtime_paths.browser_fallback_root()
    backend_cli = _find_cli_command(runtime_paths, repo_root)
    return {
        "service": "ddalab",
        "version": _installed_package_version(),
        "platform": _normalized_platform_name(),
        "architecture": platform.machine().lower() or "unknown",
        "ddaAvailable": bool(backend_cli),
        "backendCliPath": backend_cli[0] if backend_cli else None,
        "ddaBinaryPath": None,
        "defaultWindowLengthSamples": _DEFAULT_DDA_WINDOW_LENGTH,
        "defaultWindowStepSamples": _DEFAULT_DDA_WINDOW_STEP,
        "defaultDelays": list(_DEFAULT_DDA_DELAYS),
        "supportedVariants": [
            {
                "id": spec["id"],
                "appId": spec["app_id"],
                "label": spec["label"],
                "description": spec["description"],
            }
            for spec in _DDA_VARIANT_SPECS
        ],
    }


def _installed_package_version() -> str:
    try:
        return package_version("ddalab")
    except PackageNotFoundError:
        return "0.0.0-dev"


def _normalized_platform_name() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform.startswith("win"):
        return "windows"
    return sys.platform


def _selected_channel_names(
    dataset: Any,
    requested_indices: Optional[Sequence[int]],
    *,
    all_channels: bool,
) -> list[str]:
    if all_channels:
        return list(dataset.channel_names)
    if requested_indices:
        return [
            dataset.channel_names[index]
            for index in requested_indices
            if 0 <= index < len(dataset.channel_names)
        ]
    return list(dataset.channel_names[: min(8, len(dataset.channel_names))])


def _selected_channel_indices(
    dataset: Any,
    requested_indices: Optional[Sequence[int]],
    *,
    all_channels: bool,
    default_first_n: bool = True,
) -> list[int]:
    if all_channels:
        return list(range(len(dataset.channel_names)))
    if requested_indices:
        return [
            int(index)
            for index in requested_indices
            if 0 <= int(index) < len(dataset.channel_names)
        ]
    if not default_first_n:
        return []
    return list(range(min(8, len(dataset.channel_names))))


def _merge_selected_channel_indices(
    selected_indices: Sequence[int],
    variant_channel_indices: dict[str, list[int]],
    variant_pair_indices: dict[str, list[tuple[int, int]]],
) -> list[int]:
    merged: list[int] = []
    seen: set[int] = set()
    for index in selected_indices:
        if index not in seen:
            merged.append(index)
            seen.add(index)
    for indices in variant_channel_indices.values():
        for index in indices:
            if index not in seen:
                merged.append(index)
                seen.add(index)
    for pairs in variant_pair_indices.values():
        for left, right in pairs:
            for index in (left, right):
                if index not in seen:
                    merged.append(index)
                    seen.add(index)
    return merged


def _parse_variant_channel_args(values: Optional[Sequence[str]]) -> dict[str, list[int]]:
    parsed: dict[str, list[int]] = {}
    for raw_value in values or []:
        if ":" not in str(raw_value):
            raise RuntimeError(
                f"Invalid --variant-channels value '{raw_value}'. Expected VARIANT:IDX,IDX."
            )
        variant_token, indices_token = str(raw_value).split(":", 1)
        variant_id = _normalize_variant_ids([variant_token])[0]
        items = [
            token.strip()
            for token in indices_token.replace(";", ",").split(",")
            if token.strip()
        ]
        indices: list[int] = []
        for item in items:
            try:
                index = int(item)
            except ValueError as exc:
                raise RuntimeError(
                    f"Invalid channel index '{item}' in --variant-channels {raw_value}."
                ) from exc
            if index not in indices:
                indices.append(index)
        parsed[variant_id] = indices
    return parsed


def _parse_variant_pair_args(
    values: Optional[Sequence[str]],
) -> dict[str, list[tuple[int, int]]]:
    parsed: dict[str, list[tuple[int, int]]] = {}
    for raw_value in values or []:
        if ":" not in str(raw_value):
            raise RuntimeError(
                f"Invalid --variant-pairs value '{raw_value}'. Expected VARIANT:LEFT-RIGHT."
            )
        variant_token, pairs_token = str(raw_value).split(":", 1)
        variant_id = _normalize_variant_ids([variant_token])[0]
        items = [
            token.strip()
            for token in pairs_token.replace(";", ",").split(",")
            if token.strip()
        ]
        pairs: list[tuple[int, int]] = []
        for item in items:
            if ">" in item:
                left_token, right_token = item.split(">", 1)
            elif "-" in item:
                left_token, right_token = item.split("-", 1)
            else:
                raise RuntimeError(
                    f"Invalid pair '{item}' in --variant-pairs {raw_value}. Use LEFT-RIGHT or LEFT>RIGHT."
                )
            try:
                pair = (int(left_token.strip()), int(right_token.strip()))
            except ValueError as exc:
                raise RuntimeError(
                    f"Invalid pair '{item}' in --variant-pairs {raw_value}."
                ) from exc
            if pair not in pairs:
                pairs.append(pair)
        parsed[variant_id] = pairs
    return parsed


def _write_json_file(path: Path, payload: Any, *, compact: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        data = json.dumps(_json_ready(payload), separators=(",", ":"))
    else:
        data = json.dumps(_json_ready(payload), indent=2)
    path.write_text(data + ("\n" if not compact else ""), encoding="utf-8")


def _print_json(payload: Any, *, compact: bool = False) -> None:
    if compact:
        print(json.dumps(_json_ready(payload), separators=(",", ":")))
        return
    print(json.dumps(_json_ready(payload), indent=2))


def _json_ready(value: Any) -> Any:
    if isinstance(value, DdaResult):
        return asdict(value.materialize())
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, list):
        return [_json_ready(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_ready(item) for key, item in value.items()}
    return value
