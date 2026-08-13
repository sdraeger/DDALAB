from __future__ import annotations

import argparse

from .commands import (
    _handle_dataset_info,
    _handle_dda_batch,
    _handle_dda_info,
    _handle_dda_raw,
    _handle_dda_run,
    _handle_dda_validate,
    _handle_dda_variants,
    _handle_gui,
    _handle_health,
    _handle_ica_run,
    _handle_waveform_overview,
    _handle_waveform_window,
)
from .constants import (
    _DEFAULT_DDA_DELAYS,
    _DEFAULT_DDA_MODEL_DIMENSION,
    _DEFAULT_DDA_MODEL_TERMS,
    _DEFAULT_DDA_NR_TAU,
    _DEFAULT_DDA_POLYNOMIAL_ORDER,
    _DEFAULT_DDA_WINDOW_LENGTH,
    _DEFAULT_DDA_WINDOW_STEP,
)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ddalab",
        description="DDALAB command-line interface",
    )
    subparsers = parser.add_subparsers(dest="command")

    gui_parser = subparsers.add_parser("gui", help="Launch the desktop GUI")
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
    parser.add_argument(
        "--delays", type=int, nargs="+", default=list(_DEFAULT_DDA_DELAYS)
    )
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
    parser.add_argument(
        "--device",
        default="cpu",
        help="Compute device: cpu, cuda, or cuda:N",
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
