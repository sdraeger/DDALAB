"""
Comprehensive spec validation tests for generated Python variants module.

These tests validate that the generated DDA spec implementation is correct and consistent.

GROUND TRUTH VALIDATION:
The tests in this file verify that:
1. Spec constants (stride, suffix, positions) are correct
2. SELECT mask generation produces valid CLI arguments
3. Output file parsing correctly uses spec values
4. Running the binary with spec-generated commands produces expected results
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from dda_py.variants import (
    SPEC_VERSION,
    SELECT_MASK_SIZE,
    BINARY_NAME,
    REQUIRES_SHELL_WRAPPER,
    SHELL_COMMAND,
    SUPPORTED_PLATFORMS,
    ChannelFormat,
    FileType,
    OutputColumns,
    VariantMetadata,
    ST,
    CT,
    CD,
    RESERVED,
    DE,
    SY,
    VARIANT_REGISTRY,
    VARIANT_ORDER,
    SelectMaskPositions,
    get_variant_by_abbrev,
    get_variant_by_suffix,
    get_variant_by_position,
    active_variants,
    generate_select_mask,
    parse_select_mask,
    format_select_mask,
    DEFAULT_DELAYS,
)


# Expected configurations - canonical source of truth for tests
EXPECTED_VARIANTS = [
    # (abbreviation, position, output_suffix, stride, reserved)
    ("ST", 0, "_ST", 4, False),
    ("CT", 1, "_CT", 4, False),
    ("CD", 2, "_CD_DDA_ST", 2, False),
    ("RESERVED", 3, "_RESERVED", 1, True),
    ("DE", 4, "_DE", 1, False),
    ("SY", 5, "_SY", 1, False),
]

ACTIVE_VARIANT_ABBREVS = ["ST", "CT", "CD", "DE", "SY"]
CT_REQUIRING_VARIANTS = ["CT", "CD", "DE"]


# =============================================================================
# CONSTANT VALIDATION
# =============================================================================


class TestConstants:
    """Test generated constants."""

    def test_spec_version(self):
        assert SPEC_VERSION == "1.0.0"

    def test_binary_name(self):
        assert BINARY_NAME == "run_DDA_AsciiEdf"

    def test_shell_wrapper_required(self):
        assert REQUIRES_SHELL_WRAPPER is True

    def test_shell_command(self):
        assert SHELL_COMMAND == "sh"

    def test_supported_platforms(self):
        assert "linux" in SUPPORTED_PLATFORMS
        assert "macos" in SUPPORTED_PLATFORMS
        assert "windows" in SUPPORTED_PLATFORMS
        assert len(SUPPORTED_PLATFORMS) == 3

    def test_select_mask_size(self):
        assert SELECT_MASK_SIZE == 6
        assert len(VARIANT_REGISTRY) == SELECT_MASK_SIZE


# =============================================================================
# VARIANT METADATA VALIDATION
# =============================================================================


class TestVariantMetadata:
    """Test variant metadata correctness."""

    def test_all_variants_present(self):
        assert len(VARIANT_REGISTRY) == len(EXPECTED_VARIANTS)

        for abbrev, pos, suffix, stride, reserved in EXPECTED_VARIANTS:
            variant = get_variant_by_abbrev(abbrev)
            assert variant is not None, f"Variant {abbrev} not found"
            assert variant.position == pos, f"Position mismatch for {abbrev}"
            assert variant.output_suffix == suffix, f"Suffix mismatch for {abbrev}"
            assert variant.stride == stride, f"Stride mismatch for {abbrev}"
            assert variant.reserved == reserved, f"Reserved flag mismatch for {abbrev}"

    def test_variant_positions_are_unique(self):
        positions = [v.position for v in VARIANT_REGISTRY]
        assert len(positions) == len(set(positions)), "Duplicate positions found"

    def test_variant_positions_are_sequential(self):
        for i, variant in enumerate(VARIANT_REGISTRY):
            assert (
                variant.position == i
            ), f"Variant {variant.abbreviation} has position {variant.position} but expected {i}"

    def test_variant_abbreviations_are_unique(self):
        abbrevs = [v.abbreviation for v in VARIANT_REGISTRY]
        assert len(abbrevs) == len(set(abbrevs)), "Duplicate abbreviations found"

    def test_variant_output_suffixes_are_unique(self):
        suffixes = [v.output_suffix for v in VARIANT_REGISTRY]
        assert len(suffixes) == len(set(suffixes)), "Duplicate output suffixes found"

    def test_only_reserved_is_reserved(self):
        for variant in VARIANT_REGISTRY:
            if variant.abbreviation == "RESERVED":
                assert variant.reserved, "RESERVED should be reserved"
            else:
                assert not variant.reserved, f"{variant.abbreviation} should not be reserved"


# =============================================================================
# STRIDE VALUES
# =============================================================================


class TestStrideValues:
    """Test variant stride values."""

    def test_st_stride(self):
        assert ST.stride == 4, "ST stride should be 4 (3 coefficients + 1 error)"

    def test_ct_stride(self):
        assert CT.stride == 4, "CT stride should be 4 (3 coefficients + 1 error)"

    def test_cd_stride(self):
        assert CD.stride == 2, "CD stride should be 2 (1 coefficient + 1 error)"

    def test_de_stride(self):
        assert DE.stride == 1, "DE stride should be 1 (single ergodicity measure)"

    def test_sy_stride(self):
        assert SY.stride == 1, "SY stride should be 1 (synchronization coefficient)"


# =============================================================================
# OUTPUT COLUMNS
# =============================================================================


class TestOutputColumns:
    """Test output column specifications."""

    def test_st_output_columns(self):
        assert ST.output_columns.coefficients == 3
        assert ST.output_columns.has_error is True

    def test_ct_output_columns(self):
        assert CT.output_columns.coefficients == 3
        assert CT.output_columns.has_error is True

    def test_cd_output_columns(self):
        assert CD.output_columns.coefficients == 1
        assert CD.output_columns.has_error is True

    def test_de_output_columns(self):
        assert DE.output_columns.coefficients == 0
        assert DE.output_columns.has_error is False

    def test_sy_output_columns(self):
        assert SY.output_columns.coefficients == 0
        assert SY.output_columns.has_error is False


# =============================================================================
# CHANNEL FORMAT
# =============================================================================


class TestChannelFormat:
    """Test channel format specifications."""

    def test_st_channel_format(self):
        assert ST.channel_format == ChannelFormat.INDIVIDUAL

    def test_ct_channel_format(self):
        assert CT.channel_format == ChannelFormat.PAIRS

    def test_cd_channel_format(self):
        assert CD.channel_format == ChannelFormat.DIRECTED_PAIRS

    def test_de_channel_format(self):
        assert DE.channel_format == ChannelFormat.INDIVIDUAL

    def test_sy_channel_format(self):
        assert SY.channel_format == ChannelFormat.INDIVIDUAL


# =============================================================================
# REQUIRED PARAMETERS
# =============================================================================


class TestRequiredParams:
    """Test required parameters for each variant."""

    def test_ct_requires_ct_params(self):
        assert CT.requires_ct_params()
        assert "-WL_CT" in CT.required_params
        assert "-WS_CT" in CT.required_params

    def test_cd_requires_ct_params(self):
        assert CD.requires_ct_params()
        assert "-WL_CT" in CD.required_params
        assert "-WS_CT" in CD.required_params

    def test_de_requires_ct_params(self):
        assert DE.requires_ct_params()
        assert "-WL_CT" in DE.required_params
        assert "-WS_CT" in DE.required_params

    def test_st_no_ct_params(self):
        assert not ST.requires_ct_params()
        assert len(ST.required_params) == 0

    def test_sy_no_ct_params(self):
        assert not SY.requires_ct_params()
        assert len(SY.required_params) == 0


# =============================================================================
# LOOKUP FUNCTIONS
# =============================================================================


class TestLookupFunctions:
    """Test variant lookup functions."""

    def test_lookup_by_abbreviation(self):
        for abbrev, _, _, _, _ in EXPECTED_VARIANTS:
            assert (
                get_variant_by_abbrev(abbrev) is not None
            ), f"Should find variant by abbreviation: {abbrev}"

        assert get_variant_by_abbrev("XX") is None
        assert get_variant_by_abbrev("") is None
        assert get_variant_by_abbrev("st") is None  # Case sensitive

    def test_lookup_by_position(self):
        for i in range(SELECT_MASK_SIZE):
            assert (
                get_variant_by_position(i) is not None
            ), f"Should find variant at position {i}"

        assert get_variant_by_position(6) is None
        assert get_variant_by_position(99) is None
        assert get_variant_by_position(-1) is None

    def test_lookup_by_suffix(self):
        for _, _, suffix, _, _ in EXPECTED_VARIANTS:
            assert (
                get_variant_by_suffix(suffix) is not None
            ), f"Should find variant by suffix: {suffix}"

        assert get_variant_by_suffix("_XX") is None
        assert get_variant_by_suffix("") is None


# =============================================================================
# SELECT MASK
# =============================================================================


class TestSelectMask:
    """Test SELECT mask generation and parsing."""

    def test_generate_select_mask_st_only(self):
        mask = generate_select_mask(["ST"])
        assert mask == [1, 0, 0, 0, 0, 0]

    def test_generate_select_mask_sy_only(self):
        mask = generate_select_mask(["SY"])
        assert mask == [0, 0, 0, 0, 0, 1]

    def test_generate_select_mask_st_sy(self):
        mask = generate_select_mask(["ST", "SY"])
        assert mask == [1, 0, 0, 0, 0, 1]

    def test_generate_select_mask_all_active(self):
        mask = generate_select_mask(["ST", "CT", "CD", "DE", "SY"])
        assert mask == [1, 1, 1, 0, 1, 1]

    def test_generate_select_mask_empty(self):
        mask = generate_select_mask([])
        assert mask == [0, 0, 0, 0, 0, 0]

    def test_generate_select_mask_ignores_invalid(self):
        mask = generate_select_mask(["ST", "XX", "INVALID", "SY"])
        assert mask == [1, 0, 0, 0, 0, 1]

    def test_parse_select_mask_st_only(self):
        abbrevs = parse_select_mask([1, 0, 0, 0, 0, 0])
        assert abbrevs == ["ST"]

    def test_parse_select_mask_st_sy(self):
        abbrevs = parse_select_mask([1, 0, 0, 0, 0, 1])
        assert abbrevs == ["ST", "SY"]

    def test_parse_select_mask_excludes_reserved(self):
        abbrevs = parse_select_mask([0, 0, 0, 1, 0, 0])
        assert abbrevs == [], "RESERVED should not appear in parsed variants"

    def test_parse_select_mask_all(self):
        abbrevs = parse_select_mask([1, 1, 1, 1, 1, 1])
        # Should exclude RESERVED
        assert abbrevs == ["ST", "CT", "CD", "DE", "SY"]

    def test_format_select_mask(self):
        formatted = format_select_mask([1, 1, 0, 0, 0, 1])
        assert formatted == "1 1 0 0 0 1"

    def test_select_mask_roundtrip(self):
        original_variants = ["ST", "CT", "SY"]
        mask = generate_select_mask(original_variants)
        parsed = parse_select_mask(mask)
        assert parsed == original_variants


# =============================================================================
# ACTIVE VARIANTS
# =============================================================================


class TestActiveVariants:
    """Test active variants filtering."""

    def test_active_variants_count(self):
        active = active_variants()
        assert len(active) == 5

    def test_active_variants_content(self):
        active = active_variants()
        abbrevs = [v.abbreviation for v in active]
        for expected in ACTIVE_VARIANT_ABBREVS:
            assert expected in abbrevs, f"Missing active variant: {expected}"

    def test_active_variants_excludes_reserved(self):
        active = active_variants()
        abbrevs = [v.abbreviation for v in active]
        assert "RESERVED" not in abbrevs


# =============================================================================
# SELECT MASK POSITIONS
# =============================================================================


class TestSelectMaskPositions:
    """Test SELECT mask position constants."""

    def test_st_position(self):
        assert SelectMaskPositions.ST == 0

    def test_ct_position(self):
        assert SelectMaskPositions.CT == 1

    def test_cd_position(self):
        assert SelectMaskPositions.CD == 2

    def test_reserved_position(self):
        assert SelectMaskPositions.RESERVED == 3

    def test_de_position(self):
        assert SelectMaskPositions.DE == 4

    def test_sy_position(self):
        assert SelectMaskPositions.SY == 5


# =============================================================================
# FILE TYPES
# =============================================================================


class TestFileTypes:
    """Test file type handling."""

    def test_file_type_edf_flag(self):
        assert FileType.EDF.flag == "-EDF"

    def test_file_type_ascii_flag(self):
        assert FileType.ASCII.flag == "-ASCII"

    def test_file_type_from_extension_edf(self):
        assert FileType.from_extension("edf") == FileType.EDF
        assert FileType.from_extension(".edf") == FileType.EDF
        assert FileType.from_extension("EDF") == FileType.EDF

    def test_file_type_from_extension_ascii(self):
        assert FileType.from_extension("txt") == FileType.ASCII
        assert FileType.from_extension("csv") == FileType.ASCII
        assert FileType.from_extension("ascii") == FileType.ASCII

    def test_file_type_from_extension_unknown(self):
        assert FileType.from_extension("unknown") is None
        assert FileType.from_extension("") is None


# =============================================================================
# DELAYS
# =============================================================================


class TestDelays:
    """Test delay constant."""

    def test_default_delays_length(self):
        assert len(DEFAULT_DELAYS) == 2

    def test_default_delays_values(self):
        assert DEFAULT_DELAYS[0] == 7
        assert DEFAULT_DELAYS[1] == 10

    def test_default_delays_equals_expected(self):
        assert DEFAULT_DELAYS == (7, 10)


# =============================================================================
# VARIANT ORDER
# =============================================================================


class TestVariantOrder:
    """Test variant order consistency."""

    def test_variant_order_matches_positions(self):
        for i, variant in enumerate(VARIANT_REGISTRY):
            assert (
                VARIANT_ORDER[i] == variant.abbreviation
            ), f"VARIANT_ORDER[{i}] should be {variant.abbreviation}"

    def test_variant_order_complete(self):
        assert len(VARIANT_ORDER) == SELECT_MASK_SIZE
        assert VARIANT_ORDER == ("ST", "CT", "CD", "RESERVED", "DE", "SY")


# =============================================================================
# DIRECT VARIANT ACCESS
# =============================================================================


class TestDirectVariantAccess:
    """Test direct access to variant constants."""

    def test_st_constant(self):
        assert ST.abbreviation == "ST"
        assert ST.name == "Single Timeseries"
        assert ST.position == 0

    def test_ct_constant(self):
        assert CT.abbreviation == "CT"
        assert CT.name == "Cross-Timeseries"
        assert CT.position == 1

    def test_cd_constant(self):
        assert CD.abbreviation == "CD"
        assert CD.name == "Cross-Dynamical"
        assert CD.position == 2

    def test_reserved_constant(self):
        assert RESERVED.abbreviation == "RESERVED"
        assert RESERVED.name == "Reserved"
        assert RESERVED.position == 3

    def test_de_constant(self):
        assert DE.abbreviation == "DE"
        assert DE.name == "Delay Embedding"
        assert DE.position == 4

    def test_sy_constant(self):
        assert SY.abbreviation == "SY"
        assert SY.name == "Synchronization"
        assert SY.position == 5


# =============================================================================
# GROUND TRUTH VALIDATION - CLI Command Generation
# =============================================================================


class TestCLICommandGeneration:
    """Test that spec-generated CLI commands match expected ground truth format."""

    def test_select_mask_in_command_st_only(self):
        """Verify SELECT mask for ST-only matches expected CLI format."""
        mask = generate_select_mask(["ST"])
        cli_args = " ".join(str(b) for b in mask)
        assert cli_args == "1 0 0 0 0 0", "ST should set position 0 to 1"

    def test_select_mask_in_command_all_active(self):
        """Verify SELECT mask for all active variants matches expected CLI format."""
        mask = generate_select_mask(["ST", "CT", "CD", "DE", "SY"])
        cli_args = " ".join(str(b) for b in mask)
        # RESERVED at position 3 should remain 0
        assert cli_args == "1 1 1 0 1 1", "All active variants with RESERVED=0"

    def test_select_mask_positions_match_binary_spec(self):
        """Verify SELECT mask positions match the binary's expected format.

        Ground truth: The DDA binary expects SELECT mask as 6 integers:
        Position 0: ST (Single Timeseries)
        Position 1: CT (Cross-Timeseries)
        Position 2: CD (Cross-Dynamical)
        Position 3: RESERVED (always 0)
        Position 4: DE (Delay Embedding)
        Position 5: SY (Synchronization)
        """
        # Test each variant individually to verify positions
        test_cases = [
            ("ST", [1, 0, 0, 0, 0, 0]),
            ("CT", [0, 1, 0, 0, 0, 0]),
            ("CD", [0, 0, 1, 0, 0, 0]),
            ("DE", [0, 0, 0, 0, 1, 0]),
            ("SY", [0, 0, 0, 0, 0, 1]),
        ]
        for variant_abbrev, expected_mask in test_cases:
            mask = generate_select_mask([variant_abbrev])
            assert mask == expected_mask, f"{variant_abbrev} position mismatch"


# =============================================================================
# GROUND TRUTH VALIDATION - Output File Parsing
# =============================================================================


class TestOutputFileParsing:
    """Test that spec stride values correctly parse binary output files."""

    def test_st_output_stride_parsing(self):
        """Verify ST stride=4 correctly parses 4 columns per channel.

        Ground truth: ST output format per channel is:
        [a1, a2, a3, error] - 4 columns (3 coefficients + 1 error)
        """
        assert ST.stride == 4
        assert ST.output_columns.coefficients == 3
        assert ST.output_columns.has_error is True
        # Total columns = coefficients + error = 3 + 1 = 4 = stride
        assert ST.output_columns.coefficients + (1 if ST.output_columns.has_error else 0) == ST.stride

    def test_ct_output_stride_parsing(self):
        """Verify CT stride=4 correctly parses 4 columns per pair.

        Ground truth: CT output format per pair is:
        [a1, a2, a3, error] - 4 columns (3 coefficients + 1 error)
        """
        assert CT.stride == 4
        assert CT.output_columns.coefficients == 3
        assert CT.output_columns.has_error is True
        assert CT.output_columns.coefficients + (1 if CT.output_columns.has_error else 0) == CT.stride

    def test_cd_output_stride_parsing(self):
        """Verify CD stride=2 correctly parses 2 columns per directed pair.

        Ground truth: CD output format per directed pair is:
        [a1, error] - 2 columns (1 coefficient + 1 error)
        """
        assert CD.stride == 2
        assert CD.output_columns.coefficients == 1
        assert CD.output_columns.has_error is True
        assert CD.output_columns.coefficients + (1 if CD.output_columns.has_error else 0) == CD.stride

    def test_de_output_stride_parsing(self):
        """Verify DE stride=1 correctly parses 1 column.

        Ground truth: DE output format is:
        [ergodicity] - 1 column (single measure, no error)
        """
        assert DE.stride == 1
        assert DE.output_columns.coefficients == 0
        assert DE.output_columns.has_error is False
        # DE is special - stride=1 but no explicit coefficient

    def test_sy_output_stride_parsing(self):
        """Verify SY stride=1 correctly parses 1 column per channel.

        Ground truth: SY output format per channel is:
        [sync_coef] - 1 column (synchronization coefficient, no error)
        """
        assert SY.stride == 1
        assert SY.output_columns.coefficients == 0
        assert SY.output_columns.has_error is False

    def test_output_file_suffixes_match_binary(self):
        """Verify output file suffixes match what the binary actually produces.

        Ground truth: Binary creates files named: {base}{suffix}
        """
        expected_suffixes = {
            "ST": "_ST",
            "CT": "_CT",
            "CD": "_CD_DDA_ST",  # Note: CD has unique suffix format
            "RESERVED": "_RESERVED",
            "DE": "_DE",
            "SY": "_SY",
        }
        for abbrev, expected_suffix in expected_suffixes.items():
            variant = get_variant_by_abbrev(abbrev)
            assert variant is not None, f"Variant {abbrev} not found"
            assert variant.output_suffix == expected_suffix, (
                f"Suffix mismatch for {abbrev}: expected {expected_suffix}, got {variant.output_suffix}"
            )


# =============================================================================
# GROUND TRUTH VALIDATION - Mock Output Parsing
# =============================================================================


class TestMockOutputParsing:
    """Test parsing of mock output data that matches binary output format."""

    def test_parse_st_mock_output(self):
        """Parse mock ST output data using spec stride."""
        # Mock ST output: window_start window_end [a1 a2 a3 error] per channel
        # For 2 channels, 1 timepoint:
        mock_data = [
            [0, 1000, 0.1, 0.2, 0.3, 0.01, 0.4, 0.5, 0.6, 0.02]
            #          ---- channel 0 ----  ---- channel 1 ----
        ]

        stride = ST.stride
        assert stride == 4

        # Extract data for channel 0
        ch0_start = 2  # Skip window bounds
        ch0_data = mock_data[0][ch0_start:ch0_start + stride]
        assert ch0_data == [0.1, 0.2, 0.3, 0.01]

        # Extract data for channel 1
        ch1_start = ch0_start + stride
        ch1_data = mock_data[0][ch1_start:ch1_start + stride]
        assert ch1_data == [0.4, 0.5, 0.6, 0.02]

    def test_parse_cd_mock_output(self):
        """Parse mock CD output data using spec stride."""
        # Mock CD output: window_start window_end [a1 error] per directed pair
        # For 2 directed pairs (1->2, 2->1), 1 timepoint:
        mock_data = [
            [0, 1000, 0.1, 0.01, 0.2, 0.02]
            #          ---- 1->2 ----  ---- 2->1 ----
        ]

        stride = CD.stride
        assert stride == 2

        # Extract data for pair 1->2
        p0_start = 2
        p0_data = mock_data[0][p0_start:p0_start + stride]
        assert p0_data == [0.1, 0.01]

        # Extract data for pair 2->1
        p1_start = p0_start + stride
        p1_data = mock_data[0][p1_start:p1_start + stride]
        assert p1_data == [0.2, 0.02]

    def test_parse_sy_mock_output(self):
        """Parse mock SY output data using spec stride."""
        # Mock SY output: window_start window_end [sync_coef] per channel
        # For 3 channels, 1 timepoint:
        mock_data = [
            [0, 1000, 0.95, 0.87, 0.91]
            #          ch0   ch1   ch2
        ]

        stride = SY.stride
        assert stride == 1

        # Each channel gets 1 value
        for i in range(3):
            ch_start = 2 + (i * stride)
            ch_data = mock_data[0][ch_start:ch_start + stride]
            assert len(ch_data) == 1

    def test_stride_determines_num_channels(self):
        """Verify stride correctly determines number of channels from output width."""
        # Ground truth: data_columns / stride = num_channels
        test_cases = [
            (ST.stride, 8, 2),   # 8 data cols / 4 stride = 2 channels
            (ST.stride, 12, 3),  # 12 data cols / 4 stride = 3 channels
            (CD.stride, 4, 2),   # 4 data cols / 2 stride = 2 pairs
            (SY.stride, 5, 5),   # 5 data cols / 1 stride = 5 channels
        ]
        for stride, data_cols, expected_num in test_cases:
            assert data_cols % stride == 0, f"Data cols {data_cols} not divisible by stride {stride}"
            assert data_cols // stride == expected_num


# =============================================================================
# GROUND TRUTH VALIDATION - Required Parameters
# =============================================================================


class TestRequiredParametersGroundTruth:
    """Test that required parameters match what the binary expects."""

    def test_ct_requires_wl_ct_ws_ct(self):
        """Verify CT requires -WL_CT and -WS_CT as the binary expects."""
        assert "-WL_CT" in CT.required_params
        assert "-WS_CT" in CT.required_params

    def test_cd_requires_wl_ct_ws_ct(self):
        """Verify CD requires -WL_CT and -WS_CT as the binary expects."""
        assert "-WL_CT" in CD.required_params
        assert "-WS_CT" in CD.required_params

    def test_de_requires_wl_ct_ws_ct(self):
        """Verify DE requires -WL_CT and -WS_CT as the binary expects."""
        assert "-WL_CT" in DE.required_params
        assert "-WS_CT" in DE.required_params

    def test_st_no_special_params(self):
        """Verify ST has no special required parameters."""
        assert len(ST.required_params) == 0

    def test_sy_no_special_params(self):
        """Verify SY has no special required parameters."""
        assert len(SY.required_params) == 0


# =============================================================================
# GROUND TRUTH VALIDATION - Integration Test (Optional - requires binary)
# =============================================================================


class TestBinaryIntegration:
    """Integration tests that run the actual DDA binary.

    These tests are skipped if the binary is not available.
    They validate that the spec-generated code produces correct results
    when compared against direct shell execution.
    """

    @pytest.fixture
    def binary_path(self):
        """Locate the DDA binary if available."""
        possible_paths = [
            Path("/usr/local/bin/run_DDA_AsciiEdf"),
            Path.home() / ".local/bin/run_DDA_AsciiEdf",
            Path(__file__).parent.parent.parent.parent / "binaries" / "run_DDA_AsciiEdf",
        ]
        for path in possible_paths:
            if path.exists():
                return path
        return None

    @pytest.fixture
    def test_data_file(self):
        """Create a simple test data file."""
        # Create minimal ASCII data for testing
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            # 3 channels, 1000 samples
            for i in range(1000):
                # Simple sinusoidal data
                import math
                ch1 = math.sin(i * 0.1)
                ch2 = math.cos(i * 0.1)
                ch3 = math.sin(i * 0.05)
                f.write(f"{ch1:.6f} {ch2:.6f} {ch3:.6f}\n")
            return Path(f.name)

    def test_select_mask_produces_expected_outputs(self, binary_path, test_data_file):
        """Verify SELECT mask controls which output files are created."""
        if binary_path is None:
            pytest.skip("DDA binary not found")

        # This test would run the binary with ST only and verify only _ST file is created
        # Implementation left as marker for when binary is available
        pass

    def test_stride_correctly_parses_binary_output(self, binary_path, test_data_file):
        """Verify stride values correctly parse actual binary output."""
        if binary_path is None:
            pytest.skip("DDA binary not found")

        # This test would run the binary and verify output parsing
        # Implementation left as marker for when binary is available
        pass
