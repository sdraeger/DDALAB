from __future__ import annotations

import argparse
import glob
import hashlib
import json
import platform
import sys
from dataclasses import asdict, is_dataclass
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as package_version
from pathlib import Path
from typing import Any, Optional, Sequence

from ..backend.local import LocalBackendClient, _find_cli_command
from ..domain.file_types import resolve_dataset_path, supports_qt_dataset_path
from ..domain.models import DdaReproductionConfig, DdaResult
from ..runtime_paths import RuntimePaths
from .constants import (
    _DDA_VARIANT_ALIAS_MAP,
    _DDA_VARIANT_SPECS,
    _DEFAULT_DDA_DELAYS,
    _DEFAULT_DDA_MODEL_DIMENSION,
    _DEFAULT_DDA_MODEL_TERMS,
    _DEFAULT_DDA_NR_TAU,
    _DEFAULT_DDA_POLYNOMIAL_ORDER,
    _DEFAULT_DDA_WINDOW_LENGTH,
    _DEFAULT_DDA_WINDOW_STEP,
)


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
    polynomial_order = int(getattr(args, "order", _DEFAULT_DDA_POLYNOMIAL_ORDER))
    nr_tau = int(getattr(args, "nr_tau", _DEFAULT_DDA_NR_TAU))
    compute_device = str(getattr(args, "device", "cpu")).strip().lower()
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
        compute_device=compute_device,
        start_time_seconds=start_time_seconds,
        end_time_seconds=end_time_seconds,
        variant_channel_indices=variant_channel_indices or None,
        variant_pair_indices=variant_pair_indices or None,
    )
    result.reproduction = DdaReproductionConfig(
        expert_mode=expert_mode,
        compute_device=compute_device,
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
        raise RuntimeError(
            "Use either --full-duration or an explicit end bound, not both."
        )

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


def _parse_variant_channel_args(
    values: Optional[Sequence[str]],
) -> dict[str, list[int]]:
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
