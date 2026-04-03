from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from typing import Optional

from ..domain.models import DdaResult, DdaVariantResult


def default_result_base_name(result: DdaResult) -> str:
    stem = Path(result.file_name).stem.strip()
    return stem or f"dda-{result.id[:8]}"


def find_variant(
    result: DdaResult, variant_id: Optional[str] = None
) -> Optional[DdaVariantResult]:
    if not result.variants:
        return None
    if variant_id:
        for variant in result.variants:
            if variant.id == variant_id:
                return variant
    return result.variants[0]


def export_result_json(result: DdaResult) -> str:
    return json.dumps(asdict(result), indent=2)


def export_variant_csv(result: DdaResult, variant_id: Optional[str] = None) -> str:
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
    sections: list[str] = []
    for variant in result.variants:
        sections.append(f"# Variant {variant.id} — {variant.label}")
        sections.append(export_variant_csv(result, variant.id).rstrip())
        sections.append("")
    return "\n".join(section for section in sections if section is not None).rstrip() + "\n"


def generate_python_script(result: DdaResult, variant_id: Optional[str] = None) -> str:
    selected_variant = find_variant(result, variant_id)
    payload_json = json.dumps(asdict(result), indent=2)
    chosen_variant = selected_variant.id if selected_variant is not None else ""
    return f'''import json
import numpy as np
import matplotlib.pyplot as plt

RESULT = json.loads(r"""{payload_json}""")
VARIANT_ID = "{chosen_variant}"

variant = next((item for item in RESULT["variants"] if item["id"] == VARIANT_ID), RESULT["variants"][0])
matrix = np.array(variant["matrix"], dtype=float)
times = np.array(RESULT["window_centers_seconds"], dtype=float)

fig, axes = plt.subplots(2, 1, figsize=(12, 8), constrained_layout=True)
axes[0].set_title(f"DDALAB {{variant['id']}} heatmap")
im = axes[0].imshow(matrix, aspect="auto", origin="lower", cmap="viridis")
axes[0].set_ylabel("Rows")
axes[0].set_yticks(np.arange(len(variant["row_labels"])))
axes[0].set_yticklabels(variant["row_labels"])
fig.colorbar(im, ax=axes[0], shrink=0.85)

axes[1].set_title("Row traces")
for idx, row in enumerate(matrix):
    label = variant["row_labels"][idx] if idx < len(variant["row_labels"]) and idx < 8 else None
    x = times[: len(row)] if len(times) >= len(row) else np.arange(len(row))
    axes[1].plot(x, row, linewidth=1.2, alpha=0.85, label=label)
axes[1].set_xlabel("Window center (s)")
axes[1].set_ylabel("Value")
if matrix.shape[0] <= 8:
    axes[1].legend(loc="upper right")

plt.show()
'''


def generate_matlab_script(result: DdaResult, variant_id: Optional[str] = None) -> str:
    variant = find_variant(result, variant_id)
    if variant is None:
        return "% No DDA result available\n"
    matrix_rows = ";\n".join(
        "  " + " ".join(f"{float(value):.12g}" for value in row) for row in variant.matrix
    )
    row_labels = "; ".join(f"'{label}'" for label in variant.row_labels)
    times = " ".join(f"{float(value):.12g}" for value in result.window_centers_seconds)
    return f"""% DDALAB DDA export
variant_id = '{variant.id}';
row_labels = {{{row_labels}}};
window_centers = [{times}];
matrix = [
{matrix_rows}
];

figure('Name', ['DDALAB ' variant_id], 'Color', [1 1 1]);
tiledlayout(2, 1);

nexttile;
imagesc(matrix);
colormap(viridis);
colorbar;
title(['DDALAB ' variant_id ' heatmap']);
ylabel('Rows');
set(gca, 'YTick', 1:numel(row_labels), 'YTickLabel', row_labels);

nexttile;
plot(window_centers(1:size(matrix, 2)), matrix', 'LineWidth', 1.1);
title('Row traces');
xlabel('Window center (s)');
ylabel('Value');
if size(matrix, 1) <= 8
    legend(row_labels, 'Location', 'bestoutside');
end
"""


def generate_julia_script(result: DdaResult, variant_id: Optional[str] = None) -> str:
    payload_json = json.dumps(asdict(result), indent=2)
    chosen_variant = find_variant(result, variant_id)
    chosen_variant_id = chosen_variant.id if chosen_variant is not None else ""
    return f"""using JSON3
using CairoMakie

result = JSON3.read(raw\"\"\"{payload_json}\"\"\")
variant_id = "{chosen_variant_id}"
variant = something(findfirst(v -> String(v.id) == variant_id, result.variants), 1)
selected = result.variants[variant]
matrix = reduce(vcat, [permutedims(Float64.(row)) for row in selected.matrix])
times = Float64.(result.window_centers_seconds)
labels = String.(selected.row_labels)

f = Figure(size = (1000, 760))
ax1 = Axis(f[1, 1], title = "DDALAB $(selected.id) heatmap", ylabel = "Rows")
hm = heatmap!(ax1, matrix, colormap = :viridis)
Colorbar(f[1, 2], hm)
ax1.yticks = (1:length(labels), labels)

ax2 = Axis(f[2, 1], title = "Row traces", xlabel = "Window center (s)", ylabel = "Value")
for row_idx in 1:size(matrix, 1)
    xs = length(times) >= size(matrix, 2) ? times[1:size(matrix, 2)] : collect(0:size(matrix, 2)-1)
    lines!(ax2, xs, matrix[row_idx, :], label = row_idx <= 8 ? labels[row_idx] : nothing)
end
if size(matrix, 1) <= 8
    axislegend(ax2)
end

display(f)
"""


def generate_rust_source(result: DdaResult, variant_id: Optional[str] = None) -> str:
    payload_json = json.dumps(asdict(result), indent=2)
    chosen_variant = find_variant(result, variant_id)
    chosen_variant_id = chosen_variant.id if chosen_variant is not None else ""
    return f"""// DDALAB DDA export
// This example embeds the selected DDA result as JSON and prints a short summary.

const RESULT_JSON: &str = r###"{payload_json}"###;
const SELECTED_VARIANT_ID: &str = "{chosen_variant_id}";

fn main() {{
    println!("DDALAB result loaded ({{}} bytes)", RESULT_JSON.len());
    println!("Selected variant: {{}}", SELECTED_VARIANT_ID);
    println!("Embedded JSON preview:");
    println!("{{}}", &RESULT_JSON[..RESULT_JSON.len().min(400)]);
}}
"""


def _csv_escape(value: str) -> str:
    if any(token in value for token in [",", "\"", "\n"]):
        return '"' + value.replace('"', '""') + '"'
    return value
