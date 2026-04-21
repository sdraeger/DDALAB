from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from typing import Optional

from ..domain.models import DdaReproductionConfig, DdaResult, DdaVariantResult

_DDA_SINGLE_CHANNEL_VARIANTS = {"ST", "SY", "DE"}
_DDA_PAIR_VARIANTS = {"CT", "CD"}
_DEFAULT_DDA_MODEL_TERMS = [1, 2, 10]
_DEFAULT_DDA_MODEL_DIMENSION = 4
_DEFAULT_DDA_POLYNOMIAL_ORDER = 4
_DEFAULT_DDA_NR_TAU = 2


def _materialized_result(result: DdaResult) -> DdaResult:
    return result.materialize()


def default_result_base_name(result: DdaResult) -> str:
    result = _materialized_result(result)
    stem = Path(result.file_name).stem.strip()
    return stem or f"dda-{result.id[:8]}"


def find_variant(
    result: DdaResult, variant_id: Optional[str] = None
) -> Optional[DdaVariantResult]:
    result = _materialized_result(result)
    if not result.variants:
        return None
    if variant_id:
        for variant in result.variants:
            if variant.id == variant_id:
                return variant
    return result.variants[0]


def export_result_json(result: DdaResult) -> str:
    result = _materialized_result(result)
    return json.dumps(asdict(result), indent=2)


def export_variant_csv(result: DdaResult, variant_id: Optional[str] = None) -> str:
    result = _materialized_result(result)
    variant = find_variant(result, variant_id)
    if variant is None:
        return ""
    lines = []
    column_count = max((len(row) for row in variant.matrix), default=0)
    header_labels = list(variant.row_labels[:column_count])
    while len(header_labels) < column_count:
        header_labels.append(f"Value {len(header_labels) + 1}")
    lines.append(",".join(_csv_escape(item) for item in ["Row", *header_labels]))
    for row_index, row in enumerate(variant.matrix):
        row_label = (
            variant.row_labels[row_index]
            if row_index < len(variant.row_labels)
            else f"Row {row_index + 1}"
        )
        values = [row_label, *[f"{float(value):.12g}" for value in row]]
        lines.append(",".join(_csv_escape(item) for item in values))
    return "\n".join(lines) + ("\n" if lines else "")


def export_all_variants_csv(result: DdaResult) -> str:
    result = _materialized_result(result)
    sections: list[str] = []
    for variant in result.variants:
        sections.append(f"# Variant {variant.id} — {variant.label}")
        sections.append(export_variant_csv(result, variant.id).rstrip())
        sections.append("")
    return (
        "\n".join(section for section in sections if section is not None).rstrip()
        + "\n"
    )


def generate_python_script(result: DdaResult, variant_id: Optional[str] = None) -> str:
    result = _materialized_result(result)
    repro = _subset_reproduction(result, variant_id)
    cli_args = _build_reproduction_cli_args(result, repro)
    output_name = _default_output_name(result, repro)
    return f'''#!/usr/bin/env python3
"""
DDALAB reproduction script for {result.file_name}

Requirements:
    - ddalab must be installed and available as `ddalab` or via $DDALAB_CLI
"""

import json
import os
from pathlib import Path
import shlex
import subprocess

DDALAB_CLI = os.environ.get("DDALAB_CLI", "ddalab")
OUTPUT_PATH = Path(os.environ.get("DDALAB_OUTPUT", {json.dumps(output_name)})).expanduser()
CLI_ARGS = {json.dumps(cli_args, indent=2)}


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    cmd = [DDALAB_CLI, *CLI_ARGS, "--output", str(OUTPUT_PATH)]
    print("Running:", shlex.join(cmd))
    subprocess.run(cmd, check=True, env=os.environ.copy())
    payload = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    variant_ids = ", ".join(
        str(item.get("id", "?")) for item in payload.get("variants", [])
    ) or "unknown"
    print(f"Saved results to {{OUTPUT_PATH}}")
    print(f"Variants: {{variant_ids}}")


if __name__ == "__main__":
    main()
'''


def generate_matlab_script(result: DdaResult, variant_id: Optional[str] = None) -> str:
    result = _materialized_result(result)
    repro = _subset_reproduction(result, variant_id)
    cli_args = _build_reproduction_cli_args(result, repro)
    cli_args_literal = "\n".join(f"    '{_matlab_escape(arg)}';" for arg in cli_args)
    output_name = _default_output_name(result, repro)
    return f"""%% DDALAB reproduction script for {result.file_name}
%
% Requirements:
%   - ddalab must be installed and available as `ddalab` or via DDALAB_CLI

function main()
    ddalab_cli = getenv_default('DDALAB_CLI', 'ddalab');
    output_path = getenv_default('DDALAB_OUTPUT', '{_matlab_escape(output_name)}');
    cli_args = {{
{cli_args_literal}
    }};

    output_dir = fileparts(output_path);
    if ~isempty(output_dir) && ~exist(output_dir, 'dir')
        mkdir(output_dir);
    end

    command_parts = [{{ddalab_cli}}; cli_args; {{'--output'}}; {{output_path}}];
    quoted_parts = cellfun(@shell_quote, command_parts, 'UniformOutput', false);
    command = strjoin(quoted_parts, ' ');
    fprintf('Running: %s\\n', command);
    status = system(command);
    if status ~= 0
        error('ddalab exited with status %d', status);
    end

    fprintf('Saved results to %s\\n', output_path);
end

function value = getenv_default(name, fallback)
    value = getenv(name);
    if isempty(value)
        value = fallback;
    end
end

function quoted = shell_quote(value)
    text = char(string(value));
    quoted = ['\"' strrep(text, '\"', '\\\"') '\"'];
end

main();
"""


def generate_julia_script(result: DdaResult, variant_id: Optional[str] = None) -> str:
    result = _materialized_result(result)
    repro = _subset_reproduction(result, variant_id)
    cli_args = _build_reproduction_cli_args(result, repro)
    cli_args_literal = ",\n    ".join(json.dumps(arg) for arg in cli_args)
    output_name = _default_output_name(result, repro)
    return f"""#!/usr/bin/env julia
\"\"\"
DDALAB reproduction script for {result.file_name}

Requirements:
    - ddalab must be installed and available as `ddalab` or via ENV[\"DDALAB_CLI\"]
\"\"\"

using JSON3

ddalab_cli = get(ENV, "DDALAB_CLI", "ddalab")
output_path = abspath(get(ENV, "DDALAB_OUTPUT", {json.dumps(output_name)}))
cli_args = [
    {cli_args_literal}
]

mkpath(dirname(output_path))
cmd = Cmd(vcat([ddalab_cli], cli_args, ["--output", output_path]))
println("Running: ", cmd)
run(cmd)

payload = JSON3.read(read(output_path, String))
variant_ids = hasproperty(payload, :variants) ? join([String(item.id) for item in payload.variants], ", ") : "unknown"
println("Saved results to ", output_path)
println("Variants: ", variant_ids)
"""


def generate_rust_source(result: DdaResult, variant_id: Optional[str] = None) -> str:
    result = _materialized_result(result)
    repro = _subset_reproduction(result, variant_id)
    cli_args = _build_reproduction_cli_args(result, repro)
    rust_args = ",\n        ".join(json.dumps(arg) for arg in cli_args)
    output_name = _default_output_name(result, repro)
    return f"""// DDALAB reproduction script for {result.file_name}
//
// Requirements:
//   - ddalab must be installed and available as `ddalab` or via DDALAB_CLI

use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() -> Result<(), Box<dyn std::error::Error>> {{
    let ddalab_cli = env::var("DDALAB_CLI").unwrap_or_else(|_| "ddalab".to_string());
    let output_path = env::var("DDALAB_OUTPUT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from({json.dumps(output_name)}));
    if let Some(parent) = output_path.parent() {{
        if !parent.as_os_str().is_empty() {{
            fs::create_dir_all(parent)?;
        }}
    }}

    let cli_args = vec![
        {rust_args}
    ];

    let status = Command::new(&ddalab_cli)
        .args(&cli_args)
        .arg("--output")
        .arg(&output_path)
        .status()?;

    if !status.success() {{
        return Err(format!("ddalab exited with status {{status}}").into());
    }}

    println!("Saved results to {{}}", output_path.display());
    Ok(())
}}
"""


def _subset_reproduction(
    result: DdaResult,
    variant_id: Optional[str],
) -> DdaReproductionConfig:
    repro = result.reproduction
    if repro is None:
        raise RuntimeError(
            "This DDA result does not include reproduction metadata. "
            "Rerun the analysis, then export the script again."
        )

    available_variant_ids = [variant.id for variant in result.variants]
    variant_ids = [variant_id] if variant_id else list(repro.variant_ids or available_variant_ids)
    if not variant_ids:
        raise RuntimeError("No DDA variants are available to reproduce.")

    variant_channel_indices = {
        current_variant: list(repro.variant_channel_indices.get(current_variant, []))
        for current_variant in variant_ids
        if repro.variant_channel_indices.get(current_variant)
    }
    variant_channel_names = {
        current_variant: list(repro.variant_channel_names.get(current_variant, []))
        for current_variant in variant_ids
        if repro.variant_channel_names.get(current_variant)
    }
    variant_pair_indices = {
        current_variant: list(repro.variant_pair_indices.get(current_variant, []))
        for current_variant in variant_ids
        if repro.variant_pair_indices.get(current_variant)
    }
    variant_pair_names = {
        current_variant: list(repro.variant_pair_names.get(current_variant, []))
        for current_variant in variant_ids
        if repro.variant_pair_names.get(current_variant)
    }

    selected_channel_indices: list[int] = []
    for current_variant in variant_ids:
        for index in variant_channel_indices.get(current_variant, []):
            if index not in selected_channel_indices:
                selected_channel_indices.append(index)
        for left, right in variant_pair_indices.get(current_variant, []):
            for index in (left, right):
                if index not in selected_channel_indices:
                    selected_channel_indices.append(index)
    if not selected_channel_indices:
        selected_channel_indices = list(repro.selected_channel_indices)

    selected_channel_names = list(repro.selected_channel_names)
    if selected_channel_names and len(selected_channel_names) != len(selected_channel_indices):
        selected_channel_names = []

    return DdaReproductionConfig(
        expert_mode=repro.expert_mode,
        variant_ids=variant_ids,
        selected_channel_indices=selected_channel_indices,
        selected_channel_names=selected_channel_names,
        variant_channel_indices=variant_channel_indices,
        variant_channel_names=variant_channel_names,
        variant_pair_indices=variant_pair_indices,
        variant_pair_names=variant_pair_names,
        window_length_samples=repro.window_length_samples,
        window_step_samples=repro.window_step_samples,
        delays=list(repro.delays),
        model_terms=list(repro.model_terms),
        model_dimension=repro.model_dimension,
        polynomial_order=repro.polynomial_order,
        nr_tau=repro.nr_tau,
        start_time_seconds=repro.start_time_seconds,
        end_time_seconds=repro.end_time_seconds,
    )


def _build_reproduction_cli_args(
    result: DdaResult,
    reproduction: DdaReproductionConfig,
) -> list[str]:
    model_terms = list(reproduction.model_terms or _DEFAULT_DDA_MODEL_TERMS)
    model_dimension = int(
        reproduction.model_dimension or _DEFAULT_DDA_MODEL_DIMENSION
    )
    polynomial_order = int(
        reproduction.polynomial_order or _DEFAULT_DDA_POLYNOMIAL_ORDER
    )
    nr_tau = int(reproduction.nr_tau or _DEFAULT_DDA_NR_TAU)
    args: list[str] = [
        "dda",
        "run",
        "--file",
        str(result.file_path),
        "--variants",
        *[str(variant_id) for variant_id in reproduction.variant_ids],
        "--wl",
        str(int(reproduction.window_length_samples)),
        "--ws",
        str(int(reproduction.window_step_samples)),
        "--delays",
        *[str(int(delay)) for delay in reproduction.delays],
        "--model",
        *[str(int(term)) for term in model_terms],
        "--dm",
        str(model_dimension),
        "--order",
        str(polynomial_order),
        "--nr-tau",
        str(nr_tau),
        "--start",
        _format_float(reproduction.start_time_seconds),
    ]
    if reproduction.end_time_seconds is None:
        args.append("--full-duration")
    else:
        args.extend(["--end", _format_float(reproduction.end_time_seconds)])
    if reproduction.selected_channel_indices:
        args.extend(
            ["--channels", *[str(int(index)) for index in reproduction.selected_channel_indices]]
        )
    for variant_id in reproduction.variant_ids:
        channel_indices = reproduction.variant_channel_indices.get(variant_id, [])
        if channel_indices:
            args.extend(
                [
                    "--variant-channels",
                    f"{variant_id}:{','.join(str(int(index)) for index in channel_indices)}",
                ]
            )
        pair_indices = reproduction.variant_pair_indices.get(variant_id, [])
        if pair_indices:
            separator = ">" if variant_id == "CD" else "-"
            args.extend(
                [
                    "--variant-pairs",
                    f"{variant_id}:{','.join(f'{int(left)}{separator}{int(right)}' for left, right in pair_indices)}",
                ]
            )
    return args


def _default_output_name(
    result: DdaResult,
    reproduction: DdaReproductionConfig,
) -> str:
    suffix = "-".join(variant_id.lower() for variant_id in reproduction.variant_ids)
    return f"{default_result_base_name(result)}-{suffix or 'dda'}-result.json"


def _format_float(value: float) -> str:
    return f"{float(value):.12g}"


def _matlab_escape(value: str) -> str:
    return value.replace("'", "''")


def _csv_escape(value: str) -> str:
    if any(token in value for token in [",", "\"", "\n"]):
        return '"' + value.replace('"', '""') + '"'
    return value
