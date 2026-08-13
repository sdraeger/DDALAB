from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter_ns
from typing import TYPE_CHECKING, Callable, Dict, List, Optional

from ...app.runtime.perf_logging import perf_logger
from ...domain.models import (
    DdaReproductionConfig,
    DdaResult,
    DdaVariantResult,
    LoadedDataset,
)
from .results import _map_cli_result
from .runtime import (
    _get_dda_sidecar,
    _resolve_rust_dda_support,
    _write_waveform_window_matrix_file,
)

if TYPE_CHECKING:
    from .client import LocalBackendClient

_DDA_CROSS_WINDOW_LENGTH = 2
_DDA_CROSS_WINDOW_STEP = 2


class _DdaInputValidationError(RuntimeError):
    pass


_DIRECT_FILE_RUST_EXTENSIONS = {".ascii", ".txt", ".csv"}


def _validate_sy_selection(channel_indices: List[int]) -> None:
    if len(channel_indices) < 2:
        raise _DdaInputValidationError("SY requires at least two selected channels.")
    if len(channel_indices) % 2 != 0:
        raise _DdaInputValidationError(
            "SY expects an even number of selected channels because it "
            "analyzes adjacent channel pairs."
        )


def _supports_rust_direct_file_execution(file_path: str) -> bool:
    return Path(str(file_path)).suffix.lower() in _DIRECT_FILE_RUST_EXTENSIONS


def _normalize_compute_device(value: str) -> str:
    device = str(value or "cpu").strip().lower()
    if device in {"cpu", "cuda"}:
        return device
    if device.startswith("cuda:") and device.removeprefix("cuda:").isdigit():
        return device
    raise _DdaInputValidationError(
        f"Unsupported compute device '{value}'; expected cpu, cuda, or cuda:N."
    )


@dataclass(frozen=True)
class _SidecarDdaGroupPreview:
    analysis_id: str
    backend_label: str
    diagnostics: List[str]
    selected_indices: List[int]
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]]
    parsed_result: Optional[dict] = None


def _normalize_variant_channel_indices(
    *,
    selected_variants: List[str],
    selected_channel_indices: List[int],
    variant_channel_indices: Optional[Dict[str, List[int]]],
    channel_count: int,
) -> Dict[str, List[int]]:
    def sanitize(indices: Optional[List[int]]) -> List[int]:
        ordered: List[int] = []
        seen: set[int] = set()
        for raw_index in indices or []:
            try:
                index = int(raw_index)
            except (TypeError, ValueError):
                continue
            if index < 0 or index >= channel_count or index in seen:
                continue
            seen.add(index)
            ordered.append(index)
        return ordered

    fallback_indices = sanitize(selected_channel_indices)
    normalized_variant_map: Dict[str, List[int]] = {}
    provided_variant_map = variant_channel_indices or {}
    for variant_id in selected_variants:
        raw_indices = provided_variant_map.get(variant_id)
        normalized_variant_map[variant_id] = sanitize(
            raw_indices if raw_indices is not None else fallback_indices
        )
    return normalized_variant_map


def _normalize_variant_pair_indices(
    *,
    selected_variants: List[str],
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]],
    channel_count: int,
) -> Dict[str, List[tuple[int, int]]]:
    normalized: Dict[str, List[tuple[int, int]]] = {}
    provided_map = variant_pair_indices or {}
    for variant_id in selected_variants:
        if variant_id not in {"CT", "CD", "DE"}:
            continue
        raw_pairs = provided_map.get(variant_id) or []
        cleaned: List[tuple[int, int]] = []
        seen: set[tuple[int, int]] = set()
        for raw_left, raw_right in raw_pairs:
            try:
                left = int(raw_left)
                right = int(raw_right)
            except (TypeError, ValueError):
                continue
            if (
                left < 0
                or right < 0
                or left >= channel_count
                or right >= channel_count
                or left == right
            ):
                continue
            canonical = (
                (min(left, right), max(left, right))
                if variant_id in {"CT", "DE"}
                else (left, right)
            )
            if canonical in seen:
                continue
            seen.add(canonical)
            cleaned.append(canonical)
        if cleaned:
            normalized[variant_id] = cleaned
    return normalized


def _pair_channel_indices(
    pair_indices: List[tuple[int, int]],
) -> List[int]:
    ordered: List[int] = []
    seen: set[int] = set()
    for left_index, right_index in pair_indices:
        for index in (left_index, right_index):
            if index in seen:
                continue
            seen.add(index)
            ordered.append(index)
    return ordered


def _union_channel_indices(
    variant_channel_indices: Dict[str, List[int]],
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
) -> List[int]:
    ordered: List[int] = []
    seen: set[int] = set()
    for indices in variant_channel_indices.values():
        for index in indices:
            if index in seen:
                continue
            seen.add(index)
            ordered.append(index)
    for pairs in (variant_pair_indices or {}).values():
        for left_index, right_index in pairs:
            for index in (left_index, right_index):
                if index in seen:
                    continue
                seen.add(index)
                ordered.append(index)
    return ordered


def _run_local_dda(
    client: LocalBackendClient,
    *,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    start_time_seconds: float,
    end_time_seconds: Optional[float],
    variant_channel_indices: Optional[Dict[str, List[int]]] = None,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    compute_device: str = "cpu",
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> DdaResult:
    normalized_compute_device = _normalize_compute_device(compute_device)
    normalized_variants = [
        str(variant).upper() for variant in selected_variants if str(variant).strip()
    ]
    if not normalized_variants:
        raise RuntimeError("Select at least one DDA variant.")
    normalized_variant_channel_indices = _normalize_variant_channel_indices(
        selected_variants=normalized_variants,
        selected_channel_indices=selected_channel_indices,
        variant_channel_indices=variant_channel_indices,
        channel_count=len(dataset.channel_names),
    )
    normalized_variant_pair_indices = _normalize_variant_pair_indices(
        selected_variants=normalized_variants,
        variant_pair_indices=variant_pair_indices,
        channel_count=len(dataset.channel_names),
    )
    normalized_selected_channel_indices = _union_channel_indices(
        normalized_variant_channel_indices,
        normalized_variant_pair_indices,
    )
    if not normalized_selected_channel_indices:
        raise RuntimeError("Select at least one channel before running DDA.")

    cli_command = _resolve_rust_dda_support(client.runtime_paths, client.repo_root)
    if cli_command is None:
        raise RuntimeError(
            "Local DDALAB Rust backend was not found in this desktop build. "
            "Build or bundle the local dda-rs backend before running DDA."
        )

    try:
        return _run_rust_default_dda(
            client,
            dataset=dataset,
            selected_channel_indices=normalized_selected_channel_indices,
            selected_variants=normalized_variants,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            start_time_seconds=start_time_seconds,
            end_time_seconds=end_time_seconds,
            cli_command=cli_command,
            variant_channel_indices=normalized_variant_channel_indices,
            variant_pair_indices=normalized_variant_pair_indices,
            model_terms=model_terms,
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            compute_device=normalized_compute_device,
            progress_callback=progress_callback,
        )
    except _DdaInputValidationError:
        raise
    except Exception as rust_error:
        raise RuntimeError(
            "Pure Rust DDA backend failed.\n\n"
            f"Rust backend error: {rust_error}\n\n"
            "DDALAB uses the bundled dda-rs backend for local analysis."
        ) from rust_error


def _run_rust_default_dda(
    client: LocalBackendClient,
    *,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    start_time_seconds: float,
    end_time_seconds: Optional[float],
    cli_command: List[str],
    variant_channel_indices: Optional[Dict[str, List[int]]] = None,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    compute_device: str = "cpu",
    progress_callback: Optional[Callable[[dict], None]] = None,
) -> DdaResult:
    run_started_ns = perf_counter_ns()
    variant_channel_index_map = variant_channel_indices or {
        variant_id: list(selected_channel_indices) for variant_id in selected_variants
    }
    variant_pair_index_map = variant_pair_indices or {}
    selected_channel_names = [
        dataset.channel_names[index]
        for index in selected_channel_indices
        if 0 <= index < len(dataset.channel_names)
    ]
    if not selected_channel_names:
        raise _DdaInputValidationError("Selected channels could not be resolved.")

    requested_start_seconds = max(float(start_time_seconds), 0.0)
    requested_end_seconds = max(
        float(
            end_time_seconds
            if end_time_seconds is not None
            else dataset.duration_seconds
        ),
        requested_start_seconds,
    )
    if (
        end_time_seconds is not None
        and requested_end_seconds <= requested_start_seconds
    ):
        raise _DdaInputValidationError("End time must be greater than start time.")

    direct_file_mode = _supports_rust_direct_file_execution(dataset.file_path)
    source_mode = "direct-file" if direct_file_mode else "matrix-file"
    perf_logger().log(
        "dda.run.start",
        file=dataset.file_path,
        mode=source_mode,
        variants=",".join(selected_variants),
        channelCount=len(selected_channel_names),
        wl=window_length_samples,
        ws=window_step_samples,
        device=compute_device,
        startSeconds=requested_start_seconds,
        endSeconds=requested_end_seconds,
    )

    if progress_callback is not None:
        progress_callback(
            {
                "group_label": "Input Prep",
                "stage_id": "input-prep",
                "stage_label": (
                    "Preparing direct file-backed analysis request"
                    if direct_file_mode
                    else "Preparing in-memory analysis slice"
                ),
                "step_index": 0,
                "total_steps": 0,
                "window_index": 0,
                "total_windows": 0,
                "item_index": 0,
                "total_items": 0,
                "item_kind": "phase",
                "item_label": (
                    "analysis request" if direct_file_mode else "analysis matrix"
                ),
            }
        )

    sample_rate = max(dataset.dominant_sample_rate_hz, 1.0)
    matrix_path: Optional[Path] = None
    total_channels = len(selected_channel_names)
    total_samples = 0
    if direct_file_mode:
        requested_start_sample = max(
            int(math.floor(requested_start_seconds * sample_rate)),
            0,
        )
        requested_end_sample = (
            int(math.ceil(requested_end_seconds * sample_rate))
            if requested_end_seconds > requested_start_seconds
            else requested_start_sample + 1
        )
        dataset_total_samples = max(int(dataset.total_sample_count), 0)
        if dataset_total_samples > 0:
            safe_end_sample = min(
                max(requested_end_sample, requested_start_sample + 1),
                dataset_total_samples,
            )
        else:
            safe_end_sample = max(requested_end_sample, requested_start_sample + 1)
        available_samples = max(safe_end_sample - requested_start_sample, 0)
        total_samples = available_samples
        request_channel_indices = list(selected_channel_indices)
        index_lookup = {index: index for index in selected_channel_indices}
        base_diagnostics = [
            f"Requested variants: {', '.join(selected_variants)}",
            f"Selected channels: {', '.join(selected_channel_names)}",
            f"Window: {window_length_samples}/{window_step_samples} samples",
            f"Bounds: {requested_start_sample}-{safe_end_sample} samples @ {sample_rate:.3f} Hz",
            "Default backend: Rust DDA on the source ASCII/CSV input file.",
            f"Accelerator: {compute_device.upper()}.",
            "All analysis runs through the bundled dda-rs backend.",
        ]
    else:
        analysis_duration_seconds = max(
            requested_end_seconds - requested_start_seconds,
            1.0 / sample_rate,
        )
        waveform_fetch_started_ns = perf_counter_ns()
        analysis_window = client.load_waveform_window(
            dataset.file_path,
            requested_start_seconds,
            analysis_duration_seconds,
            selected_channel_names,
        )
        perf_logger().log_duration(
            "dda.input.window.fetch",
            waveform_fetch_started_ns,
            file=dataset.file_path,
            mode=source_mode,
            channelCount=len(selected_channel_names),
            startSeconds=requested_start_seconds,
            durationSeconds=analysis_duration_seconds,
        )
        matrix_stage_started_ns = perf_counter_ns()
        (
            matrix_path,
            _matrix_channel_labels,
            sample_rate,
            total_samples,
            total_channels,
        ) = _write_waveform_window_matrix_file(analysis_window)
        perf_logger().log_duration(
            "dda.input.matrix.stage",
            matrix_stage_started_ns,
            file=dataset.file_path,
            mode=source_mode,
            rows=total_samples,
            cols=total_channels,
            approxBytes=int(total_samples * total_channels * 8),
        )
        requested_start_sample = 0
        safe_end_sample = max(total_samples, requested_start_sample + 1)
        available_samples = max(safe_end_sample - requested_start_sample, 0)
        request_channel_indices = list(range(len(selected_channel_names)))
        index_lookup = {
            dataset_index: matrix_index
            for matrix_index, dataset_index in enumerate(selected_channel_indices)
        }
        base_diagnostics = [
            f"Requested variants: {', '.join(selected_variants)}",
            f"Selected channels: {', '.join(selected_channel_names)}",
            f"Window: {window_length_samples}/{window_step_samples} samples",
            f"Bounds: {requested_start_sample}-{safe_end_sample} samples @ {sample_rate:.3f} Hz",
            "Default backend: Rust DDA on an in-memory analysis matrix.",
            f"Accelerator: {compute_device.upper()}.",
            "All analysis runs through the bundled dda-rs backend.",
        ]

    if total_samples <= 0:
        raise _DdaInputValidationError("Analysis slice contains no samples.")
    if available_samples < int(window_length_samples):
        raise _DdaInputValidationError(
            "Insufficient data for analysis. "
            f"{available_samples} samples available, but window length is {window_length_samples}."
        )

    def _localize_channels(indices: List[int]) -> List[int]:
        return [index_lookup[index] for index in indices if index in index_lookup]

    def _localize_pairs(pairs: List[tuple[int, int]]) -> List[tuple[int, int]]:
        return [
            (index_lookup[left], index_lookup[right])
            for left, right in pairs
            if left in index_lookup and right in index_lookup
        ]

    full_local_indices = list(request_channel_indices)
    variant_configs_payload: dict[str, dict[str, object]] = {}

    if "SY" in selected_variants:
        sy_indices = variant_channel_index_map.get("SY", [])
        _validate_sy_selection(sy_indices)

    def _set_variant_channels(canonical_key: str, dataset_indices: List[int]) -> None:
        localized = _localize_channels(dataset_indices)
        if localized and localized != full_local_indices:
            variant_configs_payload.setdefault(canonical_key, {})[
                "selected_channels"
            ] = localized

    if "ST" in selected_variants:
        st_indices = variant_channel_index_map.get("ST", [])
        if not st_indices:
            raise _DdaInputValidationError("ST requires at least one selected channel.")
        _set_variant_channels("single_timeseries", st_indices)

    if "DE" in selected_variants:
        de_indices = variant_channel_index_map.get("DE", [])
        if not de_indices:
            raise _DdaInputValidationError("DE requires at least one selected channel.")
        _set_variant_channels("dynamical_ergodicity", de_indices)

    if "SY" in selected_variants:
        _set_variant_channels(
            "synchronization", variant_channel_index_map.get("SY", [])
        )

    localized_ct_pairs: Optional[List[tuple[int, int]]] = None
    if "CT" in selected_variants:
        ct_pairs_dataset = variant_pair_index_map.get("CT", [])
        ct_indices = (
            _pair_channel_indices(ct_pairs_dataset)
            if ct_pairs_dataset
            else variant_channel_index_map.get("CT", [])
        )
        if ct_pairs_dataset:
            if not ct_indices:
                raise _DdaInputValidationError(
                    "CT requires at least one selected pair."
                )
            localized_ct_pairs = _localize_pairs(ct_pairs_dataset)
            if not localized_ct_pairs:
                raise _DdaInputValidationError(
                    "CT pairs could not be resolved for DDA."
                )
            variant_configs_payload.setdefault("cross_timeseries", {})[
                "ct_channel_pairs"
            ] = [[left, right] for left, right in localized_ct_pairs]
        elif len(ct_indices) < 2:
            raise _DdaInputValidationError(
                "CT requires at least two selected channels."
            )
        else:
            _set_variant_channels("cross_timeseries", ct_indices)

    localized_de_pairs: Optional[List[tuple[int, int]]] = None
    if "DE" in selected_variants:
        de_pairs_dataset = variant_pair_index_map.get("DE", [])
        if de_pairs_dataset:
            localized_de_pairs = _localize_pairs(de_pairs_dataset)
            if not localized_de_pairs:
                raise _DdaInputValidationError(
                    "DE pairs could not be resolved for DDA."
                )

    localized_cd_pairs: Optional[List[tuple[int, int]]] = None
    if "CD" in selected_variants:
        cd_pairs_dataset = variant_pair_index_map.get("CD", [])
        cd_indices = (
            _pair_channel_indices(cd_pairs_dataset)
            if cd_pairs_dataset
            else variant_channel_index_map.get("CD", [])
        )
        if cd_pairs_dataset:
            if not cd_indices:
                raise _DdaInputValidationError(
                    "CD requires at least one selected directed pair."
                )
            localized_cd_pairs = _localize_pairs(cd_pairs_dataset)
            if not localized_cd_pairs:
                raise _DdaInputValidationError(
                    "CD pairs could not be resolved for DDA."
                )
            variant_configs_payload.setdefault("cross_dynamical", {})[
                "cd_channel_pairs"
            ] = [[left, right] for left, right in localized_cd_pairs]
        elif len(cd_indices) < 2:
            raise _DdaInputValidationError(
                "CD requires at least two selected channels."
            )
        else:
            _set_variant_channels("cross_dynamical", cd_indices)

    ct_window_length = (
        _DDA_CROSS_WINDOW_LENGTH
        if any(variant in selected_variants for variant in ("DE", "CT", "CD"))
        else None
    )
    ct_window_step = _DDA_CROSS_WINDOW_STEP if ct_window_length is not None else None

    try:
        preview = _execute_sidecar_dda_group(
            client=client,
            cli_command=cli_command,
            repo_root=client.repo_root,
            dataset=dataset,
            selected_channel_indices=selected_channel_indices,
            cli_selected_indices=(
                list(selected_channel_indices) if direct_file_mode else None
            ),
            input_path=Path(dataset.file_path) if direct_file_mode else None,
            variants=selected_variants,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            requested_start_sample=requested_start_sample,
            safe_end_sample=safe_end_sample,
            sample_rate=sample_rate,
            base_diagnostics=base_diagnostics,
            requested_start_seconds=requested_start_seconds,
            group_label="Combined",
            variant_pair_indices=variant_pair_index_map or None,
            model_terms=model_terms,
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            compute_device=compute_device,
            ct_pairs=localized_ct_pairs or localized_de_pairs,
            cd_pairs=localized_cd_pairs,
            ct_window_length=ct_window_length,
            ct_window_step=ct_window_step,
            progress_callback=progress_callback,
            input_matrix_path=matrix_path,
            input_matrix_rows=total_samples if matrix_path is not None else None,
            input_matrix_cols=total_channels if matrix_path is not None else None,
            input_channel_labels=selected_channel_names,
            variant_configs=variant_configs_payload or None,
        )
        materialized = _materialize_sidecar_dda_result(
            client=client,
            dataset=dataset,
            selected_variants=selected_variants,
            grouped_previews=[preview],
            result_id=uuid.uuid4().hex,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            requested_start_seconds=requested_start_seconds,
            engine_label=f"DDA ({compute_device.upper()})",
        )
        materialized.reproduction = _reproduction_config(
            dataset=dataset,
            selected_channel_indices=selected_channel_indices,
            selected_variants=selected_variants,
            variant_channel_indices=variant_channel_index_map,
            variant_pair_indices=variant_pair_index_map,
            window_length_samples=window_length_samples,
            window_step_samples=window_step_samples,
            delays=delays,
            model_terms=model_terms,
            model_dimension=model_dimension,
            polynomial_order=polynomial_order,
            nr_tau=nr_tau,
            compute_device=compute_device,
            start_time_seconds=requested_start_seconds,
            end_time_seconds=requested_end_seconds,
        )
        perf_logger().log_duration(
            "dda.run.complete",
            run_started_ns,
            file=dataset.file_path,
            mode=source_mode,
            variants=",".join(selected_variants),
            channelCount=len(selected_channel_names),
            sampleCount=total_samples,
            sampleRateHz=sample_rate,
            device=compute_device,
        )
        return materialized
    except Exception as exc:
        perf_logger().log_duration(
            "dda.run.error",
            run_started_ns,
            file=dataset.file_path,
            mode=source_mode,
            variants=",".join(selected_variants),
            channelCount=len(selected_channel_names),
            error=str(exc),
        )
        raise
    finally:
        if matrix_path is not None:
            try:
                matrix_path.unlink(missing_ok=True)
            except Exception:
                pass


def _reproduction_config(
    *,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    selected_variants: List[str],
    variant_channel_indices: Dict[str, List[int]],
    variant_pair_indices: Dict[str, List[tuple[int, int]]],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    model_terms: Optional[List[int]],
    model_dimension: Optional[int],
    polynomial_order: Optional[int],
    nr_tau: Optional[int],
    compute_device: str,
    start_time_seconds: float,
    end_time_seconds: float,
):
    def names(indices: List[int]) -> List[str]:
        return [
            dataset.channel_names[index]
            for index in indices
            if 0 <= index < len(dataset.channel_names)
        ]

    return DdaReproductionConfig(
        expert_mode=True,
        variant_ids=list(selected_variants),
        selected_channel_indices=list(selected_channel_indices),
        selected_channel_names=names(selected_channel_indices),
        variant_channel_indices={
            key: list(indices) for key, indices in variant_channel_indices.items()
        },
        variant_channel_names={
            key: names(indices) for key, indices in variant_channel_indices.items()
        },
        variant_pair_indices={
            key: list(pairs) for key, pairs in variant_pair_indices.items()
        },
        variant_pair_names={
            key: [
                (dataset.channel_names[left], dataset.channel_names[right])
                for left, right in pairs
            ]
            for key, pairs in variant_pair_indices.items()
        },
        window_length_samples=int(window_length_samples),
        window_step_samples=int(window_step_samples),
        delays=[int(delay) for delay in delays],
        model_terms=[int(term) for term in model_terms or []],
        model_dimension=int(model_dimension or 0),
        polynomial_order=int(polynomial_order or 0),
        nr_tau=int(nr_tau or 0),
        compute_device=compute_device,
        start_time_seconds=float(start_time_seconds),
        end_time_seconds=float(end_time_seconds),
    )


def _execute_sidecar_dda_group(
    *,
    client: LocalBackendClient,
    cli_command: List[str],
    repo_root: Path,
    dataset: LoadedDataset,
    selected_channel_indices: List[int],
    cli_selected_indices: Optional[List[int]],
    input_path: Optional[Path],
    variants: List[str],
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    requested_start_sample: int,
    safe_end_sample: int,
    sample_rate: float,
    base_diagnostics: List[str],
    requested_start_seconds: float,
    group_label: str,
    variant_pair_indices: Optional[Dict[str, List[tuple[int, int]]]] = None,
    model_terms: Optional[List[int]] = None,
    model_dimension: Optional[int] = None,
    polynomial_order: Optional[int] = None,
    nr_tau: Optional[int] = None,
    compute_device: str = "cpu",
    ct_pairs: Optional[List[tuple[int, int]]] = None,
    cd_pairs: Optional[List[tuple[int, int]]] = None,
    ct_window_length: Optional[int] = None,
    ct_window_step: Optional[int] = None,
    progress_callback: Optional[Callable[[dict], None]] = None,
    input_matrix_path: Optional[Path] = None,
    input_matrix_rows: Optional[int] = None,
    input_matrix_cols: Optional[int] = None,
    input_channel_labels: Optional[List[str]] = None,
    variant_configs: Optional[dict] = None,
) -> _SidecarDdaGroupPreview:
    diagnostics = list(base_diagnostics)
    diagnostics.append(f"Execution group: {group_label}")
    diagnostics.append(
        "Group channels: "
        + ", ".join(
            dataset.channel_names[index]
            for index in selected_channel_indices
            if 0 <= index < len(dataset.channel_names)
        )
    )
    if ct_window_length is not None or ct_window_step is not None:
        diagnostics.append(
            "CT window override: "
            f"{ct_window_length if ct_window_length is not None else window_length_samples}/"
            f"{ct_window_step if ct_window_step is not None else window_step_samples}"
            " samples"
        )
    sidecar_mode = "matrix-file" if input_matrix_path is not None else "direct-file"
    sidecar = _get_dda_sidecar(
        client=client,
        cli_command=cli_command,
        repo_root=repo_root,
    )

    if input_matrix_path is not None:
        channel_labels = list(input_channel_labels or [])
        request_payload = {
            "file": dataset.file_path,
            "matrix_path": str(input_matrix_path),
            "rows": int(input_matrix_rows or 0),
            "cols": int(input_matrix_cols or len(channel_labels)),
            "channel_labels": channel_labels,
            "channels": list(range(len(channel_labels))),
            "variants": list(variants),
            "wl": int(window_length_samples),
            "ws": int(window_step_samples),
            "delays": [int(delay) for delay in delays],
            "sr": float(sample_rate) if sample_rate > 1000.0 else None,
            "ct_pairs": (
                [[int(left), int(right)] for left, right in ct_pairs]
                if ct_pairs
                else None
            ),
            "cd_pairs": (
                [[int(left), int(right)] for left, right in cd_pairs]
                if cd_pairs
                else None
            ),
            "ct_wl": int(ct_window_length) if ct_window_length is not None else None,
            "ct_ws": int(ct_window_step) if ct_window_step is not None else None,
        }
    else:
        if input_path is None or cli_selected_indices is None:
            raise RuntimeError(
                "Sidecar DDA execution requires either an input matrix file or an input path."
            )
        request_payload = {
            "file": str(input_path),
            "channels": [int(index) for index in cli_selected_indices],
            "variants": list(variants),
            "wl": int(window_length_samples),
            "ws": int(window_step_samples),
            "delays": [int(delay) for delay in delays],
            "start_sample": int(requested_start_sample),
            "end_sample": int(safe_end_sample),
            "sr": float(sample_rate) if sample_rate > 1000.0 else None,
            "ct_pairs": (
                [[int(left), int(right)] for left, right in ct_pairs]
                if ct_pairs
                else None
            ),
            "cd_pairs": (
                [[int(left), int(right)] for left, right in cd_pairs]
                if cd_pairs
                else None
            ),
            "ct_wl": int(ct_window_length) if ct_window_length is not None else None,
            "ct_ws": int(ct_window_step) if ct_window_step is not None else None,
        }

    if variant_configs:
        request_payload["variant_configs"] = variant_configs
    request_payload["device"] = compute_device
    if model_terms:
        request_payload["model_terms"] = [int(term) for term in model_terms]
    if model_dimension is not None:
        request_payload["dm"] = int(model_dimension)
    if polynomial_order is not None:
        request_payload["order"] = int(polynomial_order)
    if nr_tau is not None:
        request_payload["nr_tau"] = int(nr_tau)

    request_started_ns = perf_counter_ns()
    progress_events = 0
    last_stage_signature: Optional[tuple[str, str]] = None
    perf_logger().log(
        "dda.sidecar.request.start",
        file=dataset.file_path,
        mode=sidecar_mode,
        group=group_label,
        variants=",".join(variants),
        channelCount=(
            len(input_channel_labels or [])
            if input_matrix_path is not None
            else len(cli_selected_indices or selected_channel_indices)
        ),
        wl=window_length_samples,
        ws=window_step_samples,
        device=compute_device,
    )

    def _handle_progress(payload: dict[str, object]) -> None:
        nonlocal progress_events
        nonlocal last_stage_signature
        progress_events += 1
        stage_signature = (
            str(payload.get("stage_id") or ""),
            str(payload.get("stage_label") or ""),
        )
        if stage_signature != last_stage_signature:
            last_stage_signature = stage_signature
            perf_logger().log(
                "dda.sidecar.progress.stage",
                file=dataset.file_path,
                mode=sidecar_mode,
                group=group_label,
                stageId=stage_signature[0] or "unknown",
                stageLabel=stage_signature[1] or "unknown",
                stepIndex=payload.get("step_index"),
                totalSteps=payload.get("total_steps"),
                itemKind=payload.get("item_kind"),
                itemLabel=payload.get("item_label"),
            )
        if progress_callback is None:
            return
        enriched = dict(payload)
        enriched.setdefault("group_label", group_label)
        progress_callback(enriched)

    try:
        if input_matrix_path is not None:
            parsed = sidecar.run_group_matrix_file(
                request_payload,
                on_progress=_handle_progress,
            )
        else:
            parsed = sidecar.run_group(request_payload, on_progress=_handle_progress)
    except Exception as exc:
        perf_logger().log_duration(
            "dda.sidecar.request.error",
            request_started_ns,
            file=dataset.file_path,
            mode=sidecar_mode,
            group=group_label,
            progressEvents=progress_events,
            error=str(exc),
        )
        raise
    backend_id = str(parsed.get("backend") or "").lower()
    perf_logger().log_duration(
        "dda.sidecar.request.complete",
        request_started_ns,
        file=dataset.file_path,
        mode=sidecar_mode,
        group=group_label,
        progressEvents=progress_events,
        backend=backend_id or "pure-rust",
        rows=input_matrix_rows if input_matrix_rows is not None else None,
        cols=input_matrix_cols if input_matrix_cols is not None else None,
    )
    return _SidecarDdaGroupPreview(
        analysis_id=str(parsed.get("id") or uuid.uuid4().hex),
        backend_label=(
            "Rust DDA"
            if backend_id in ("", "pure-rust")
            else f"Unexpected backend: {backend_id}"
        ),
        diagnostics=diagnostics,
        selected_indices=list(selected_channel_indices),
        variant_pair_indices=variant_pair_indices,
        parsed_result=(
            parsed.get("result") if isinstance(parsed.get("result"), dict) else None
        ),
    )


def _materialize_sidecar_dda_result(
    *,
    client: LocalBackendClient,
    dataset: LoadedDataset,
    selected_variants: List[str],
    grouped_previews: List[_SidecarDdaGroupPreview],
    result_id: str,
    window_length_samples: int,
    window_step_samples: int,
    delays: List[int],
    requested_start_seconds: float,
    engine_label: str,
) -> DdaResult:
    grouped_results: List[DdaResult] = []
    for preview in grouped_previews:
        parsed = preview.parsed_result
        if not isinstance(parsed, dict):
            raise RuntimeError("DDA backend did not return an inline result payload.")
        grouped_results.append(
            _map_cli_result(
                dataset=dataset,
                selected_indices=preview.selected_indices,
                variant_pair_indices=preview.variant_pair_indices,
                parsed=parsed,
                diagnostics=list(preview.diagnostics)
                + [f"Engine: {preview.backend_label}"],
                start_time_seconds=requested_start_seconds,
                window_length_samples=window_length_samples,
                window_step_samples=window_step_samples,
                delays=delays,
            )
        )
    return _merge_sidecar_dda_results(
        dataset=dataset,
        selected_variants=selected_variants,
        grouped_results=grouped_results,
        result_id=result_id,
        engine_label=engine_label,
    )


def _merge_sidecar_dda_results(
    *,
    dataset: LoadedDataset,
    selected_variants: List[str],
    grouped_results: List[DdaResult],
    result_id: Optional[str] = None,
    engine_label: str = "Rust CLI",
) -> DdaResult:
    ordered_variant_ids: List[str] = []
    for variant_id in selected_variants:
        normalized = str(variant_id).upper()
        if normalized not in ordered_variant_ids:
            ordered_variant_ids.append(normalized)

    variants_by_id: dict[str, DdaVariantResult] = {}
    diagnostics: List[str] = []
    window_centers_seconds: List[float] = []
    created_at_iso = datetime.now(timezone.utc).isoformat()

    for result in grouped_results:
        if result.created_at_iso and not window_centers_seconds:
            created_at_iso = result.created_at_iso
        if len(result.window_centers_seconds) > len(window_centers_seconds):
            window_centers_seconds = list(result.window_centers_seconds)
        for line in result.diagnostics:
            if line not in diagnostics:
                diagnostics.append(line)
        for variant in result.variants:
            variants_by_id[variant.id.upper()] = variant

    merged_variants = [
        variants_by_id[variant_id]
        for variant_id in ordered_variant_ids
        if variant_id in variants_by_id
    ]
    if not merged_variants:
        raise RuntimeError("DDA backend returned no variant matrices.")

    return DdaResult(
        id=result_id or uuid.uuid4().hex,
        file_path=dataset.file_path,
        file_name=dataset.file_name,
        created_at_iso=created_at_iso,
        engine_label=engine_label,
        diagnostics=diagnostics,
        window_centers_seconds=window_centers_seconds,
        variants=merged_variants,
        is_fallback=False,
    )
