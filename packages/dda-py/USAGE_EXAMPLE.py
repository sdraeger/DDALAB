"""
Example usage of the auto-generated DDA Python API

This demonstrates how to use the generated code to run DDA analysis.
"""

from dda_py import DDARequest, DDARunner

# Initialize the runner with path to DDA binary
runner = DDARunner(binary_path="path/to/run_DDA_AsciiEdf")

# Create an analysis request
request = DDARequest(
    file_path="data/patient1.edf",
    channels=[0, 1, 2],  # 0-based channel indices
    variants=["ST", "SY"],  # Which DDA variants to run
    window_length=2048,
    window_step=1024,
    delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],  # Direct delay values for -TAU flag
    model_params=[
        1,
        2,
        10,
    ],  # DDA model encoding for -MODEL flag (default, can be any length)
    # Optional parameters:
    time_range=(0.0, 30.0),  # First 30 seconds
    ct_window_length=2,  # Required for CT/CD/DE variants
    ct_window_step=2,
    embedding_dimension=4,
    polynomial_order=4,
    num_tau=2,
)

# Execute DDA analysis
results = runner.run(request)

# Access results for each variant
for variant_name, variant_results in results.items():
    print(f"\n{variant_name} Results:")
    print(
        f"  Matrix shape: {variant_results['num_channels']} × {variant_results['num_timepoints']}"
    )
    print(f"  Stride: {variant_results['stride']}")

    # Access the actual data matrix
    matrix = variant_results["matrix"]  # [channels × timepoints]
    print(f"  Data: {len(matrix)} channels with {len(matrix[0])} timepoints each")


# Example: Using variant metadata
from dda_py import get_variant_by_abbrev

# Get information about a variant
st_variant = get_variant_by_abbrev("ST")
print(f"\nST Variant Info:")
print(f"  Name: {st_variant.name}")
print(f"  Description: {st_variant.description}")
print(f"  Stride: {st_variant.stride}")
print(f"  Output suffix: {st_variant.output_suffix}")


# Example: Generating SELECT masks
from dda_py import generate_select_mask, parse_select_mask

mask = generate_select_mask(["ST", "CT", "SY"])
print(f"\nSELECT mask for ST+CT+SY: {mask}")

enabled = parse_select_mask(mask)
print(f"Enabled variants: {enabled}")


# Example: Access to CLI constants
from dda_py import BINARY_NAME, Defaults, Flags

print(f"\nBinary name: {BINARY_NAME}")
print(f"Default embedding dimension: {Defaults.EMBEDDING_DIMENSION}")
print(f"Window length flag: {Flags.WINDOW_LENGTH}")
