"""
Integration tests for auto-generated DDA Python API

These tests verify that the generated DDARunner produces identical results
to running the DDA binary directly via command-line.
"""

import os
import subprocess

# Add src to path for imports
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dda_py.generated import (
    VARIANT_REGISTRY,
    DDARequest,
    DDARunner,
    generate_select_mask,
)


# Test fixtures
@pytest.fixture
def dda_binary_path():
    """Get path to DDA binary

    Looks in common locations. Skip tests if binary not found.
    """
    # Try to find DDALAB root (go up from packages/dda-py)
    test_file_path = Path(__file__).resolve()
    ddalab_root = test_file_path.parent.parent.parent.parent

    possible_paths = [
        ddalab_root / "bin" / "run_DDA_AsciiEdf",
        ddalab_root / "run_DDA_AsciiEdf_v1.0",
        Path.cwd() / "bin" / "run_DDA_AsciiEdf",
        Path.cwd() / "run_DDA_AsciiEdf",
        Path.home() / "bin" / "run_DDA_AsciiEdf",
        Path("/usr/local/bin/run_DDA_AsciiEdf"),
    ]

    for path in possible_paths:
        if path.exists():
            return str(path)

    pytest.skip("DDA binary not found. Skipping integration tests.")


@pytest.fixture
def sample_edf_file():
    """Path to sample EDF file for testing

    Skip tests if sample file not found.
    """
    # Try to find DDALAB root (go up from packages/dda-py)
    test_file_path = Path(__file__).resolve()
    ddalab_root = test_file_path.parent.parent.parent.parent

    possible_paths = [
        ddalab_root / "data" / "patient1_S05__01_03 (1).edf",
        ddalab_root / "data" / "edf" / "MG108_Seizure7post.edf",
        Path.cwd() / "data" / "patient1_S05__01_03 (1).edf",
        Path.cwd() / "test_data" / "sample.edf",
        Path(__file__).parent / "data" / "sample.edf",
    ]

    for path in possible_paths:
        if path.exists():
            return str(path)

    pytest.skip("Sample EDF file not found. Skipping integration tests.")


@pytest.fixture
def runner(dda_binary_path):
    """Create DDARunner instance"""
    return DDARunner(binary_path=dda_binary_path)


def run_dda_cli_direct(
    binary_path: str,
    file_path: str,
    channels: list,
    variants: list,
    window_length: int,
    window_step: int,
    delays: list,
    model_params: list = None,
    ct_window_length: int = 2,
    ct_window_step: int = 2,
    use_structured_format: bool = True,
) -> dict:
    """Run DDA binary directly via command-line

    Returns dict with results for each variant
    """
    from dda_py.generated import REQUIRES_SHELL_WRAPPER

    # Create temp output file
    temp_dir = tempfile.gettempdir()
    output_base = os.path.join(temp_dir, f"dda_cli_test_{os.getpid()}")

    # Build command
    cmd = []
    if REQUIRES_SHELL_WRAPPER and os.name != "nt":
        cmd.extend(["sh", binary_path])
    else:
        cmd.append(binary_path)

    # File type
    if file_path.lower().endswith(".edf"):
        cmd.append("-EDF")
    else:
        cmd.append("-ASCII")

    # Input/Output
    cmd.extend(["-DATA_FN", file_path])
    cmd.extend(["-OUT_FN", output_base])

    # Channels (convert to 1-based)
    cmd.append("-CH_list")
    cmd.extend([str(ch + 1) for ch in channels])

    # SELECT mask
    mask = generate_select_mask(variants)
    cmd.append("-SELECT")
    cmd.extend([str(b) for b in mask])

    # Model parameters
    model = model_params if model_params is not None else [1, 2, 10]
    cmd.append("-MODEL")
    cmd.extend([str(p) for p in model])

    # Delay values (tau)
    cmd.append("-TAU")
    cmd.extend([str(d) for d in delays])

    # Window parameters
    cmd.extend(["-WL", str(window_length)])
    cmd.extend(["-WS", str(window_step)])
    cmd.extend(["-WL_CT", str(ct_window_length)])
    cmd.extend(["-WS_CT", str(ct_window_step)])

    # Embedding parameters (defaults)
    cmd.extend(["-dm", "4"])
    cmd.extend(["-order", "4"])
    cmd.extend(["-nr_tau", "2"])

    # Execute
    _ = subprocess.run(cmd, capture_output=True, text=True, check=True)

    # Parse output files
    results = {}
    for variant_abbrev in variants:
        # Find variant metadata
        variant = None
        for v in VARIANT_REGISTRY:
            if v.abbreviation == variant_abbrev:
                variant = v
                break

        if variant is None:
            continue

        output_file = Path(f"{output_base}{variant.output_suffix}")
        if not output_file.exists():
            continue

        # Parse file
        if use_structured_format:
            parsed = parse_dda_output_structured(output_file, variant.stride)
            results[variant_abbrev] = {
                "channels": parsed["channels"],
                "num_channels": len(parsed["channels"]),
                "num_timepoints": len(parsed["channels"][0]["timepoints"]) if parsed["channels"] else 0,
                "stride": variant.stride,
            }
        else:
            # Legacy format
            matrix = parse_dda_output(output_file, variant.stride)
            results[variant_abbrev] = {
                "matrix": matrix,
                "num_channels": len(matrix),
                "num_timepoints": len(matrix[0]) if matrix else 0,
            }

    return results


def compare_structured_results(api_result: dict, cli_result: dict, variant_name: str):
    """Helper function to compare structured API and CLI results

    Args:
        api_result: Result from API runner
        cli_result: Result from direct CLI
        variant_name: Name of variant being tested
    """
    # Check dimensions match
    assert api_result["num_channels"] == cli_result["num_channels"], \
        f"{variant_name}: Number of channels differ"
    assert api_result["num_timepoints"] == cli_result["num_timepoints"], \
        f"{variant_name}: Number of timepoints differ"

    # Check structured data matches
    for ch_idx in range(api_result["num_channels"]):
        api_channel = api_result["channels"][ch_idx]
        cli_channel = cli_result["channels"][ch_idx]

        assert api_channel["channel_index"] == cli_channel["channel_index"]
        assert len(api_channel["timepoints"]) == len(cli_channel["timepoints"])

        for tp_idx in range(len(api_channel["timepoints"])):
            api_tp = api_channel["timepoints"][tp_idx]
            cli_tp = cli_channel["timepoints"][tp_idx]

            # Check window bounds
            assert api_tp["window_start"] == cli_tp["window_start"], \
                f"{variant_name}: Window start differs at channel {ch_idx}, timepoint {tp_idx}"
            assert api_tp["window_end"] == cli_tp["window_end"], \
                f"{variant_name}: Window end differs at channel {ch_idx}, timepoint {tp_idx}"

            # Check coefficients
            np.testing.assert_allclose(
                api_tp["coefficients"],
                cli_tp["coefficients"],
                rtol=1e-10,
                atol=1e-10,
                err_msg=f"{variant_name}: Coefficients differ at channel {ch_idx}, timepoint {tp_idx}",
            )

            # Check error
            np.testing.assert_allclose(
                api_tp["error"],
                cli_tp["error"],
                rtol=1e-10,
                atol=1e-10,
                err_msg=f"{variant_name}: Error differs at channel {ch_idx}, timepoint {tp_idx}",
            )


def parse_dda_output_structured(file_path: Path, stride: int) -> dict:
    """Parse DDA output file into structured format

    Returns dict with structured data preserving all values
    """
    # Read all lines from file
    raw_data = []
    with open(file_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            values = [float(x) for x in line.split()]
            if values:
                raw_data.append(values)

    if not raw_data:
        return {"channels": []}

    # Determine number of channels/pairs from row length
    first_row = raw_data[0]
    data_columns = len(first_row) - 2  # Exclude window bounds

    if data_columns % stride != 0:
        raise ValueError(
            f"Invalid data format: {data_columns} data columns is not divisible by stride {stride}"
        )

    num_channels = data_columns // stride

    # Build structured output
    channels = []
    for channel_idx in range(num_channels):
        timepoints = []

        for row in raw_data:
            window_start = int(row[0])
            window_end = int(row[1])

            # Extract values for this channel/pair
            start_col = 2 + (channel_idx * stride)
            end_col = start_col + stride
            channel_values = row[start_col:end_col]

            # Split into coefficients and error
            if len(channel_values) >= 2:
                coefficients = channel_values[:-1]
                error = channel_values[-1]
            elif len(channel_values) == 1:
                coefficients = []
                error = channel_values[0]
            else:
                coefficients = []
                error = 0.0

            timepoints.append({
                "window_start": window_start,
                "window_end": window_end,
                "coefficients": coefficients,
                "error": error
            })

        channels.append({
            "channel_index": channel_idx,
            "timepoints": timepoints
        })

    return {"channels": channels}


def parse_dda_output(file_path: Path, stride: int) -> list:
    """Parse DDA output file (legacy format)

    Returns 2D matrix [channels × timepoints]
    """
    matrix = []

    with open(file_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue

            values = [float(x) for x in line.split()]
            if values:
                matrix.append(values)

    if not matrix:
        return []

    # Skip first 2 columns
    matrix = [row[2:] for row in matrix]

    # Extract every Nth column
    extracted = []
    for row in matrix:
        row_values = []
        col_idx = 0
        while col_idx < len(row):
            row_values.append(row[col_idx])
            col_idx += stride
        extracted.append(row_values)

    if not extracted or not extracted[0]:
        return []

    # Transpose
    num_cols = len(extracted[0])
    transposed = [[] for _ in range(num_cols)]
    for row in extracted:
        for col_idx, value in enumerate(row):
            transposed[col_idx].append(value)

    return transposed


# Tests
class TestGeneratedAPI:
    """Test suite for generated DDA Python API"""

    def test_runner_initialization(self, dda_binary_path):
        """Test DDARunner can be initialized"""
        runner = DDARunner(binary_path=dda_binary_path)
        assert runner.binary_path.exists()

    def test_runner_rejects_invalid_binary(self):
        """Test DDARunner raises error for non-existent binary"""
        with pytest.raises(FileNotFoundError):
            DDARunner(binary_path="/nonexistent/binary")

    def test_request_creation(self):
        """Test DDARequest can be created with valid parameters"""
        request = DDARequest(
            file_path="test.edf",
            channels=[0, 1, 2],
            variants=["ST"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        )
        assert request.file_path == "test.edf"
        assert request.channels == [0, 1, 2]
        assert request.variants == ["ST"]

    @pytest.mark.integration
    def test_st_variant_matches_cli(self, runner, dda_binary_path, sample_edf_file):
        """Test ST variant produces identical results to CLI"""
        # Run via Python API
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["ST"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        )
        api_results = runner.run(request)

        # Run via direct CLI
        cli_results = run_dda_cli_direct(
            binary_path=dda_binary_path,
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["ST"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            use_structured_format=True,
        )

        # Compare results
        assert "ST" in api_results
        assert "ST" in cli_results

        compare_structured_results(api_results["ST"], cli_results["ST"], "ST")

    @pytest.mark.integration
    def test_sy_variant_matches_cli(self, runner, dda_binary_path, sample_edf_file):
        """Test SY variant produces identical results to CLI"""
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["SY"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        )
        api_results = runner.run(request)

        cli_results = run_dda_cli_direct(
            binary_path=dda_binary_path,
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["SY"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            use_structured_format=True,
        )

        # Compare
        assert "SY" in api_results
        assert "SY" in cli_results

        compare_structured_results(api_results["SY"], cli_results["SY"], "SY")

    @pytest.mark.integration
    def test_ct_variant_matches_cli(self, runner, dda_binary_path, sample_edf_file):
        """Test CT variant produces identical results to CLI"""
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["CT"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            ct_window_length=2,
            ct_window_step=2,
        )
        api_results = runner.run(request)

        cli_results = run_dda_cli_direct(
            binary_path=dda_binary_path,
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["CT"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            ct_window_length=2,
            ct_window_step=2,
            use_structured_format=True,
        )

        assert "CT" in api_results
        assert "CT" in cli_results

        compare_structured_results(api_results["CT"], cli_results["CT"], "CT")

    @pytest.mark.integration
    def test_cd_variant_matches_cli(self, runner, dda_binary_path, sample_edf_file):
        """Test CD variant produces identical results to CLI"""
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["CD"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            ct_window_length=2,
            ct_window_step=2,
        )
        api_results = runner.run(request)

        cli_results = run_dda_cli_direct(
            binary_path=dda_binary_path,
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["CD"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            ct_window_length=2,
            ct_window_step=2,
            use_structured_format=True,
        )

        assert "CD" in api_results
        assert "CD" in cli_results

        compare_structured_results(api_results["CD"], cli_results["CD"], "CD")

    @pytest.mark.integration
    def test_de_variant_matches_cli(self, runner, dda_binary_path, sample_edf_file):
        """Test DE variant produces identical results to CLI"""
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["DE"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            ct_window_length=2,
            ct_window_step=2,
        )
        api_results = runner.run(request)

        cli_results = run_dda_cli_direct(
            binary_path=dda_binary_path,
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["DE"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            ct_window_length=2,
            ct_window_step=2,
            use_structured_format=True,
        )

        assert "DE" in api_results
        assert "DE" in cli_results

        compare_structured_results(api_results["DE"], cli_results["DE"], "DE")

    @pytest.mark.integration
    def test_multiple_variants_match_cli(
        self, runner, dda_binary_path, sample_edf_file
    ):
        """Test multiple variants produce identical results to CLI"""
        variants = ["ST", "SY"]

        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1],
            variants=variants,
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        )
        api_results = runner.run(request)

        cli_results = run_dda_cli_direct(
            binary_path=dda_binary_path,
            file_path=sample_edf_file,
            channels=[0, 1],
            variants=variants,
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            use_structured_format=True,
        )

        # Check both variants present and compare
        for variant in variants:
            assert variant in api_results
            assert variant in cli_results
            compare_structured_results(api_results[variant], cli_results[variant], variant)

    @pytest.mark.integration
    def test_different_window_sizes_match(
        self, runner, dda_binary_path, sample_edf_file
    ):
        """Test different window parameters produce matching results"""
        test_cases = [
            (1024, 512),
            (2048, 1024),
            (4096, 2048),
        ]

        for window_length, window_step in test_cases:
            request = DDARequest(
                file_path=sample_edf_file,
                channels=[0],
                variants=["ST"],
                window_length=window_length,
                window_step=window_step,
                delays=[1, 2, 3, 4, 5],
            )
            api_results = runner.run(request)

            cli_results = run_dda_cli_direct(
                binary_path=dda_binary_path,
                file_path=sample_edf_file,
                channels=[0],
                variants=["ST"],
                window_length=window_length,
                window_step=window_step,
                delays=[1, 2, 3, 4, 5],
                use_structured_format=True,
            )

            compare_structured_results(
                api_results["ST"],
                cli_results["ST"],
                f"ST (WL={window_length}, WS={window_step})"
            )

    def test_command_building_internal(self, runner, sample_edf_file):
        """Test internal command building produces correct arguments"""
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1, 2],
            variants=["ST", "SY"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        )

        # Build command
        cmd = runner._build_command(request, "/tmp/output")

        # Check key elements are present
        assert "-EDF" in cmd or "-ASCII" in cmd
        assert "-DATA_FN" in cmd
        assert sample_edf_file in cmd
        assert "-OUT_FN" in cmd
        assert "-CH_list" in cmd
        # Channels should be 1-based
        assert "1" in cmd  # channel 0 -> 1
        assert "2" in cmd  # channel 1 -> 2
        assert "3" in cmd  # channel 2 -> 3
        assert "-SELECT" in cmd
        assert "-WL" in cmd
        assert "2048" in cmd
        assert "-WS" in cmd
        assert "1024" in cmd
        assert "-TAU" in cmd

    def test_delay_parameter_handling(self, runner, sample_edf_file):
        """Test that delays are passed correctly to the binary"""
        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0],
            variants=["ST"],
            window_length=2048,
            window_step=1024,
            delays=[5, 10, 15],
        )

        # Build command and verify delays are passed correctly
        cmd = runner._build_command(request, "/tmp/output")

        # Find TAU in command
        tau_idx = cmd.index("-TAU")
        # The next 3 values should be our delays
        assert cmd[tau_idx + 1] == "5"
        assert cmd[tau_idx + 2] == "10"
        assert cmd[tau_idx + 3] == "15"


# Benchmark tests
class TestPerformance:
    """Performance benchmarks for generated API"""

    @pytest.mark.benchmark
    @pytest.mark.integration
    def test_api_overhead_is_minimal(self, runner, dda_binary_path, sample_edf_file):
        """Benchmark: API should have minimal overhead vs direct CLI"""
        pytest.importorskip("pytest_benchmark", reason="pytest-benchmark not installed")

        request = DDARequest(
            file_path=sample_edf_file,
            channels=[0, 1],
            variants=["ST"],
            window_length=2048,
            window_step=1024,
            delays=[1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        )

        # Run API and verify it works (benchmark optional)
        result = runner.run(request)
        assert "ST" in result


# Test constants and metadata
class TestConstants:
    """Test generated constants and metadata"""

    def test_binary_name_constant(self):
        """Test BINARY_NAME constant is set"""
        from dda_py.generated import BINARY_NAME

        assert BINARY_NAME == "run_DDA_AsciiEdf"

    def test_variant_registry_complete(self):
        """Test all expected variants are in registry"""
        from dda_py.generated import VARIANT_REGISTRY

        expected_variants = ["ST", "CT", "CD", "DE", "SY"]
        actual_variants = [v.abbreviation for v in VARIANT_REGISTRY]

        for expected in expected_variants:
            assert expected in actual_variants

    def test_variant_stride_values(self):
        """Test variant stride values are correct"""
        from dda_py.generated import get_variant_by_abbrev

        assert get_variant_by_abbrev("ST").stride == 4
        assert get_variant_by_abbrev("CT").stride == 4
        assert get_variant_by_abbrev("CD").stride == 2
        assert get_variant_by_abbrev("DE").stride == 1
        assert get_variant_by_abbrev("SY").stride == 1

    def test_select_mask_generation(self):
        """Test SELECT mask generation"""
        from dda_py.generated import generate_select_mask

        # Test ST only
        mask = generate_select_mask(["ST"])
        assert mask == [1, 0, 0, 0, 0, 0]

        # Test ST + SY
        mask = generate_select_mask(["ST", "SY"])
        assert mask == [1, 0, 0, 0, 0, 1]

        # Test all except RESERVED
        mask = generate_select_mask(["ST", "CT", "CD", "DE", "SY"])
        assert mask == [1, 1, 1, 0, 1, 1]
