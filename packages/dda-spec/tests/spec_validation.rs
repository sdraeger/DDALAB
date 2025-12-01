//! Comprehensive spec validation tests
//!
//! These tests validate that the DDA spec implementation is correct and consistent.

use dda_spec::*;

/// Expected variant configurations - canonical source of truth for tests
mod expected {
    pub const VARIANTS: &[(&str, u8, &str, u8, bool)] = &[
        // (abbreviation, position, output_suffix, stride, reserved)
        ("ST", 0, "_ST", 4, false),
        ("CT", 1, "_CT", 4, false),
        ("CD", 2, "_CD_DDA_ST", 2, false),
        ("RESERVED", 3, "_RESERVED", 1, true),
        ("DE", 4, "_DE", 1, false),
        ("SY", 5, "_SY", 1, false),
    ];

    pub const ACTIVE_VARIANTS: &[&str] = &["ST", "CT", "CD", "DE", "SY"];
    pub const CT_REQUIRING_VARIANTS: &[&str] = &["CT", "CD", "DE"];
}

// =============================================================================
// CONSTANT VALIDATION
// =============================================================================

#[test]
fn test_spec_version() {
    assert_eq!(SPEC_VERSION, "1.0.0");
}

#[test]
fn test_binary_name() {
    assert_eq!(BINARY_NAME, "run_DDA_AsciiEdf");
}

#[test]
fn test_shell_wrapper_required() {
    assert!(REQUIRES_SHELL_WRAPPER);
}

#[test]
fn test_shell_command() {
    assert_eq!(SHELL_COMMAND, "sh");
}

#[test]
fn test_supported_platforms() {
    assert!(SUPPORTED_PLATFORMS.contains(&"linux"));
    assert!(SUPPORTED_PLATFORMS.contains(&"macos"));
    assert!(SUPPORTED_PLATFORMS.contains(&"windows"));
    assert_eq!(SUPPORTED_PLATFORMS.len(), 3);
}

#[test]
fn test_select_mask_size() {
    assert_eq!(SELECT_MASK_SIZE, 6);
    assert_eq!(VARIANTS.len(), SELECT_MASK_SIZE);
}

// =============================================================================
// VARIANT METADATA VALIDATION
// =============================================================================

#[test]
fn test_all_variants_present() {
    assert_eq!(VARIANTS.len(), expected::VARIANTS.len());

    for (abbrev, pos, suffix, stride, reserved) in expected::VARIANTS {
        let variant = Variant::from_abbreviation(abbrev)
            .expect(&format!("Variant {} not found", abbrev));

        assert_eq!(variant.position, *pos, "Position mismatch for {}", abbrev);
        assert_eq!(variant.output_suffix, *suffix, "Suffix mismatch for {}", abbrev);
        assert_eq!(variant.stride, *stride, "Stride mismatch for {}", abbrev);
        assert_eq!(variant.reserved, *reserved, "Reserved flag mismatch for {}", abbrev);
    }
}

#[test]
fn test_variant_positions_are_unique() {
    let positions: Vec<u8> = VARIANTS.iter().map(|v| v.position).collect();
    let mut sorted = positions.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(
        positions.len(),
        sorted.len(),
        "Duplicate variant positions found"
    );
}

#[test]
fn test_variant_positions_are_sequential() {
    for (i, variant) in VARIANTS.iter().enumerate() {
        assert_eq!(
            variant.position as usize, i,
            "Variant {} has position {} but expected {}",
            variant.abbreviation, variant.position, i
        );
    }
}

#[test]
fn test_variant_abbreviations_are_unique() {
    let abbrevs: Vec<&str> = VARIANTS.iter().map(|v| v.abbreviation).collect();
    let mut sorted = abbrevs.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(
        abbrevs.len(),
        sorted.len(),
        "Duplicate abbreviations found"
    );
}

#[test]
fn test_variant_output_suffixes_are_unique() {
    let suffixes: Vec<&str> = VARIANTS.iter().map(|v| v.output_suffix).collect();
    let mut sorted = suffixes.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(
        suffixes.len(),
        sorted.len(),
        "Duplicate output suffixes found"
    );
}

#[test]
fn test_only_reserved_is_reserved() {
    for variant in VARIANTS.iter() {
        if variant.abbreviation == "RESERVED" {
            assert!(variant.reserved, "RESERVED should be reserved");
        } else {
            assert!(!variant.reserved, "{} should not be reserved", variant.abbreviation);
        }
    }
}

// =============================================================================
// STRIDE VALUES
// =============================================================================

#[test]
fn test_st_stride() {
    let st = Variant::from_abbreviation("ST").unwrap();
    assert_eq!(st.stride, 4, "ST stride should be 4 (3 coefficients + 1 error)");
}

#[test]
fn test_ct_stride() {
    let ct = Variant::from_abbreviation("CT").unwrap();
    assert_eq!(ct.stride, 4, "CT stride should be 4 (3 coefficients + 1 error)");
}

#[test]
fn test_cd_stride() {
    let cd = Variant::from_abbreviation("CD").unwrap();
    assert_eq!(cd.stride, 2, "CD stride should be 2 (1 coefficient + 1 error)");
}

#[test]
fn test_de_stride() {
    let de = Variant::from_abbreviation("DE").unwrap();
    assert_eq!(de.stride, 1, "DE stride should be 1 (single ergodicity measure)");
}

#[test]
fn test_sy_stride() {
    let sy = Variant::from_abbreviation("SY").unwrap();
    assert_eq!(sy.stride, 1, "SY stride should be 1 (synchronization coefficient)");
}

// =============================================================================
// OUTPUT COLUMNS
// =============================================================================

#[test]
fn test_st_output_columns() {
    let st = Variant::from_abbreviation("ST").unwrap();
    assert_eq!(st.output_columns.coefficients, 3);
    assert!(st.output_columns.has_error);
}

#[test]
fn test_ct_output_columns() {
    let ct = Variant::from_abbreviation("CT").unwrap();
    assert_eq!(ct.output_columns.coefficients, 3);
    assert!(ct.output_columns.has_error);
}

#[test]
fn test_cd_output_columns() {
    let cd = Variant::from_abbreviation("CD").unwrap();
    assert_eq!(cd.output_columns.coefficients, 1);
    assert!(cd.output_columns.has_error);
}

#[test]
fn test_de_output_columns() {
    let de = Variant::from_abbreviation("DE").unwrap();
    assert_eq!(de.output_columns.coefficients, 0);
    assert!(!de.output_columns.has_error);
}

#[test]
fn test_sy_output_columns() {
    let sy = Variant::from_abbreviation("SY").unwrap();
    assert_eq!(sy.output_columns.coefficients, 0);
    assert!(!sy.output_columns.has_error);
}

#[test]
fn test_stride_matches_output_columns() {
    for variant in VARIANTS.iter() {
        let expected_stride = variant.output_columns.coefficients as u8
            + if variant.output_columns.has_error { 1 } else { 0 };

        // DE and SY have stride 1 even with 0 coefficients and no error
        // This is because they output a single value per entity
        if variant.abbreviation == "DE" || variant.abbreviation == "SY" {
            assert_eq!(variant.stride, 1,
                "{} should have stride 1 for single output value", variant.abbreviation);
        } else if variant.abbreviation != "RESERVED" {
            assert_eq!(variant.stride, expected_stride,
                "{} stride should match output columns", variant.abbreviation);
        }
    }
}

// =============================================================================
// CHANNEL FORMAT
// =============================================================================

#[test]
fn test_st_channel_format() {
    let st = Variant::from_abbreviation("ST").unwrap();
    assert_eq!(st.channel_format, ChannelFormat::Individual);
}

#[test]
fn test_ct_channel_format() {
    let ct = Variant::from_abbreviation("CT").unwrap();
    assert_eq!(ct.channel_format, ChannelFormat::Pairs);
}

#[test]
fn test_cd_channel_format() {
    let cd = Variant::from_abbreviation("CD").unwrap();
    assert_eq!(cd.channel_format, ChannelFormat::DirectedPairs);
}

#[test]
fn test_de_channel_format() {
    let de = Variant::from_abbreviation("DE").unwrap();
    assert_eq!(de.channel_format, ChannelFormat::Individual);
}

#[test]
fn test_sy_channel_format() {
    let sy = Variant::from_abbreviation("SY").unwrap();
    assert_eq!(sy.channel_format, ChannelFormat::Individual);
}

// =============================================================================
// REQUIRED PARAMETERS
// =============================================================================

#[test]
fn test_ct_requires_ct_params() {
    let ct = Variant::from_abbreviation("CT").unwrap();
    assert!(ct.requires_ct_params());
    assert!(ct.required_params.contains(&"-WL_CT"));
    assert!(ct.required_params.contains(&"-WS_CT"));
}

#[test]
fn test_cd_requires_ct_params() {
    let cd = Variant::from_abbreviation("CD").unwrap();
    assert!(cd.requires_ct_params());
    assert!(cd.required_params.contains(&"-WL_CT"));
    assert!(cd.required_params.contains(&"-WS_CT"));
}

#[test]
fn test_de_requires_ct_params() {
    let de = Variant::from_abbreviation("DE").unwrap();
    assert!(de.requires_ct_params());
    assert!(de.required_params.contains(&"-WL_CT"));
    assert!(de.required_params.contains(&"-WS_CT"));
}

#[test]
fn test_st_no_ct_params() {
    let st = Variant::from_abbreviation("ST").unwrap();
    assert!(!st.requires_ct_params());
    assert!(st.required_params.is_empty());
}

#[test]
fn test_sy_no_ct_params() {
    let sy = Variant::from_abbreviation("SY").unwrap();
    assert!(!sy.requires_ct_params());
    assert!(sy.required_params.is_empty());
}

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

#[test]
fn test_lookup_by_abbreviation() {
    for (abbrev, _, _, _, _) in expected::VARIANTS {
        assert!(
            Variant::from_abbreviation(abbrev).is_some(),
            "Should find variant by abbreviation: {}", abbrev
        );
    }

    assert!(Variant::from_abbreviation("XX").is_none());
    assert!(Variant::from_abbreviation("").is_none());
    assert!(Variant::from_abbreviation("st").is_none()); // Case sensitive
}

#[test]
fn test_lookup_by_position() {
    for i in 0..SELECT_MASK_SIZE {
        assert!(
            Variant::from_position(i as u8).is_some(),
            "Should find variant at position {}", i
        );
    }

    assert!(Variant::from_position(6).is_none());
    assert!(Variant::from_position(99).is_none());
    assert!(Variant::from_position(255).is_none());
}

#[test]
fn test_lookup_by_suffix() {
    for (_, _, suffix, _, _) in expected::VARIANTS {
        assert!(
            Variant::from_suffix(suffix).is_some(),
            "Should find variant by suffix: {}", suffix
        );
    }

    assert!(Variant::from_suffix("_XX").is_none());
    assert!(Variant::from_suffix("").is_none());
}

// =============================================================================
// SELECT MASK
// =============================================================================

#[test]
fn test_generate_select_mask_st_only() {
    let mask = generate_select_mask(&["ST"]);
    assert_eq!(mask, [1, 0, 0, 0, 0, 0]);
}

#[test]
fn test_generate_select_mask_sy_only() {
    let mask = generate_select_mask(&["SY"]);
    assert_eq!(mask, [0, 0, 0, 0, 0, 1]);
}

#[test]
fn test_generate_select_mask_st_sy() {
    let mask = generate_select_mask(&["ST", "SY"]);
    assert_eq!(mask, [1, 0, 0, 0, 0, 1]);
}

#[test]
fn test_generate_select_mask_all_active() {
    let mask = generate_select_mask(&["ST", "CT", "CD", "DE", "SY"]);
    assert_eq!(mask, [1, 1, 1, 0, 1, 1]);
}

#[test]
fn test_generate_select_mask_empty() {
    let mask = generate_select_mask(&[]);
    assert_eq!(mask, [0, 0, 0, 0, 0, 0]);
}

#[test]
fn test_generate_select_mask_ignores_invalid() {
    let mask = generate_select_mask(&["ST", "XX", "INVALID", "SY"]);
    assert_eq!(mask, [1, 0, 0, 0, 0, 1]);
}

#[test]
fn test_parse_select_mask_st_only() {
    let abbrevs = parse_select_mask(&[1, 0, 0, 0, 0, 0]);
    assert_eq!(abbrevs, vec!["ST"]);
}

#[test]
fn test_parse_select_mask_st_sy() {
    let abbrevs = parse_select_mask(&[1, 0, 0, 0, 0, 1]);
    assert_eq!(abbrevs, vec!["ST", "SY"]);
}

#[test]
fn test_parse_select_mask_excludes_reserved() {
    let abbrevs = parse_select_mask(&[0, 0, 0, 1, 0, 0]);
    assert!(abbrevs.is_empty(), "RESERVED should not appear in parsed variants");
}

#[test]
fn test_parse_select_mask_all() {
    let abbrevs = parse_select_mask(&[1, 1, 1, 1, 1, 1]);
    // Should exclude RESERVED
    assert_eq!(abbrevs, vec!["ST", "CT", "CD", "DE", "SY"]);
}

#[test]
fn test_format_select_mask() {
    let formatted = format_select_mask(&[1, 1, 0, 0, 0, 1]);
    assert_eq!(formatted, "1 1 0 0 0 1");
}

#[test]
fn test_select_mask_roundtrip() {
    let original_variants = vec!["ST", "CT", "SY"];
    let mask = generate_select_mask(&original_variants);
    let parsed = parse_select_mask(&mask);
    assert_eq!(parsed, original_variants);
}

// =============================================================================
// ACTIVE VARIANTS
// =============================================================================

#[test]
fn test_active_variants() {
    let active: Vec<_> = Variant::active_variants().collect();

    // Should have exactly 5 active variants
    assert_eq!(active.len(), 5);

    // Should include all non-reserved
    let abbrevs: Vec<&str> = active.iter().map(|v| v.abbreviation).collect();
    for expected_abbrev in expected::ACTIVE_VARIANTS {
        assert!(abbrevs.contains(expected_abbrev), "Missing active variant: {}", expected_abbrev);
    }

    // Should not include RESERVED
    assert!(!abbrevs.contains(&"RESERVED"));
}

#[test]
fn test_ct_requiring_variants() {
    for abbrev in expected::CT_REQUIRING_VARIANTS {
        let variant = Variant::from_abbreviation(abbrev).unwrap();
        assert!(
            variant.requires_ct_params(),
            "{} should require CT params", abbrev
        );
    }
}

// =============================================================================
// FILE TYPES
// =============================================================================

#[test]
fn test_file_type_edf() {
    assert_eq!(FileType::EDF.flag(), "-EDF");
}

#[test]
fn test_file_type_ascii() {
    assert_eq!(FileType::ASCII.flag(), "-ASCII");
}

#[test]
fn test_file_type_from_extension() {
    assert_eq!(FileType::from_extension("edf"), Some(FileType::EDF));
    assert_eq!(FileType::from_extension(".edf"), Some(FileType::EDF));
    assert_eq!(FileType::from_extension("EDF"), Some(FileType::EDF));

    assert_eq!(FileType::from_extension("txt"), Some(FileType::ASCII));
    assert_eq!(FileType::from_extension("csv"), Some(FileType::ASCII));
    assert_eq!(FileType::from_extension("ascii"), Some(FileType::ASCII));

    assert_eq!(FileType::from_extension("unknown"), None);
    assert_eq!(FileType::from_extension(""), None);
}

// =============================================================================
// SCALE PARAMETERS
// =============================================================================

#[test]
fn test_scale_parameters_default() {
    let params = ScaleParameters::default();
    assert_eq!(params.scale_min, 1.0);
    assert_eq!(params.scale_max, 20.0);
    assert_eq!(params.scale_num, 20);
}

#[test]
fn test_generate_delays_default() {
    let params = ScaleParameters::default();
    let delays = params.generate_delays();

    assert_eq!(delays.len(), 20);
    assert_eq!(delays[0], 1);
    assert_eq!(delays[19], 20);
}

#[test]
fn test_generate_delays_single() {
    let params = ScaleParameters {
        scale_min: 5.0,
        scale_max: 5.0,
        scale_num: 1,
    };
    let delays = params.generate_delays();

    assert_eq!(delays, vec![5]);
}

#[test]
fn test_generate_delays_custom() {
    let params = ScaleParameters {
        scale_min: 1.0,
        scale_max: 10.0,
        scale_num: 10,
    };
    let delays = params.generate_delays();

    assert_eq!(delays.len(), 10);
    assert_eq!(delays[0], 1);
    assert_eq!(delays[9], 10);
}

// =============================================================================
// VARIANT ORDER
// =============================================================================

#[test]
fn test_variant_order_matches_positions() {
    for (i, variant) in VARIANTS.iter().enumerate() {
        assert_eq!(
            VARIANT_ORDER[i], variant.abbreviation,
            "VARIANT_ORDER[{}] should be {}", i, variant.abbreviation
        );
    }
}

#[test]
fn test_variant_order_complete() {
    assert_eq!(VARIANT_ORDER.len(), SELECT_MASK_SIZE);
    assert_eq!(VARIANT_ORDER, &["ST", "CT", "CD", "RESERVED", "DE", "SY"]);
}

// =============================================================================
// GROUND TRUTH VALIDATION - CLI Command Generation
// =============================================================================

#[test]
fn test_select_mask_cli_format_st_only() {
    /// Verify SELECT mask for ST-only matches expected CLI format.
    let mask = generate_select_mask(&["ST"]);
    let cli_args = format_select_mask(&mask);
    assert_eq!(cli_args, "1 0 0 0 0 0", "ST should set position 0 to 1");
}

#[test]
fn test_select_mask_cli_format_all_active() {
    /// Verify SELECT mask for all active variants matches expected CLI format.
    let mask = generate_select_mask(&["ST", "CT", "CD", "DE", "SY"]);
    let cli_args = format_select_mask(&mask);
    // RESERVED at position 3 should remain 0
    assert_eq!(cli_args, "1 1 1 0 1 1", "All active variants with RESERVED=0");
}

#[test]
fn test_select_mask_positions_match_binary_spec() {
    /// Ground truth: The DDA binary expects SELECT mask as 6 integers:
    /// Position 0: ST (Single Timeseries)
    /// Position 1: CT (Cross-Timeseries)
    /// Position 2: CD (Cross-Dynamical)
    /// Position 3: RESERVED (always 0)
    /// Position 4: DE (Delay Embedding)
    /// Position 5: SY (Synchronization)
    let test_cases: [(&str, [u8; 6]); 5] = [
        ("ST", [1, 0, 0, 0, 0, 0]),
        ("CT", [0, 1, 0, 0, 0, 0]),
        ("CD", [0, 0, 1, 0, 0, 0]),
        ("DE", [0, 0, 0, 0, 1, 0]),
        ("SY", [0, 0, 0, 0, 0, 1]),
    ];

    for (variant_abbrev, expected_mask) in test_cases {
        let mask = generate_select_mask(&[variant_abbrev]);
        assert_eq!(mask, expected_mask, "{} position mismatch", variant_abbrev);
    }
}

// =============================================================================
// GROUND TRUTH VALIDATION - Output File Parsing
// =============================================================================

#[test]
fn test_st_output_stride_matches_ground_truth() {
    /// Ground truth: ST output format per channel is:
    /// [a1, a2, a3, error] - 4 columns (3 coefficients + 1 error)
    let st = Variant::from_abbreviation("ST").unwrap();
    assert_eq!(st.stride, 4);
    assert_eq!(st.output_columns.coefficients, 3);
    assert!(st.output_columns.has_error);
    // Total columns = coefficients + error = 3 + 1 = 4 = stride
    let expected_stride = st.output_columns.coefficients + if st.output_columns.has_error { 1 } else { 0 };
    assert_eq!(expected_stride, st.stride);
}

#[test]
fn test_ct_output_stride_matches_ground_truth() {
    /// Ground truth: CT output format per pair is:
    /// [a1, a2, a3, error] - 4 columns (3 coefficients + 1 error)
    let ct = Variant::from_abbreviation("CT").unwrap();
    assert_eq!(ct.stride, 4);
    assert_eq!(ct.output_columns.coefficients, 3);
    assert!(ct.output_columns.has_error);
    let expected_stride = ct.output_columns.coefficients + if ct.output_columns.has_error { 1 } else { 0 };
    assert_eq!(expected_stride, ct.stride);
}

#[test]
fn test_cd_output_stride_matches_ground_truth() {
    /// Ground truth: CD output format per directed pair is:
    /// [a1, error] - 2 columns (1 coefficient + 1 error)
    let cd = Variant::from_abbreviation("CD").unwrap();
    assert_eq!(cd.stride, 2);
    assert_eq!(cd.output_columns.coefficients, 1);
    assert!(cd.output_columns.has_error);
    let expected_stride = cd.output_columns.coefficients + if cd.output_columns.has_error { 1 } else { 0 };
    assert_eq!(expected_stride, cd.stride);
}

#[test]
fn test_de_output_stride_matches_ground_truth() {
    /// Ground truth: DE output format is:
    /// [ergodicity] - 1 column (single measure, no error)
    let de = Variant::from_abbreviation("DE").unwrap();
    assert_eq!(de.stride, 1);
    assert_eq!(de.output_columns.coefficients, 0);
    assert!(!de.output_columns.has_error);
}

#[test]
fn test_sy_output_stride_matches_ground_truth() {
    /// Ground truth: SY output format per channel is:
    /// [sync_coef] - 1 column (synchronization coefficient, no error)
    let sy = Variant::from_abbreviation("SY").unwrap();
    assert_eq!(sy.stride, 1);
    assert_eq!(sy.output_columns.coefficients, 0);
    assert!(!sy.output_columns.has_error);
}

#[test]
fn test_output_file_suffixes_match_binary() {
    /// Ground truth: Binary creates files named: {base}{suffix}
    /// These suffixes have been verified against actual binary output.
    let expected_suffixes: [(&str, &str); 6] = [
        ("ST", "_ST"),
        ("CT", "_CT"),
        ("CD", "_CD_DDA_ST"),  // Note: CD has unique suffix format
        ("RESERVED", "_RESERVED"),
        ("DE", "_DE"),
        ("SY", "_SY"),
    ];

    for (abbrev, expected_suffix) in expected_suffixes {
        let variant = Variant::from_abbreviation(abbrev).expect(&format!("Variant {} not found", abbrev));
        assert_eq!(
            variant.output_suffix, expected_suffix,
            "Suffix mismatch for {}: expected {}, got {}",
            abbrev, expected_suffix, variant.output_suffix
        );
    }
}

// =============================================================================
// GROUND TRUTH VALIDATION - Mock Output Parsing
// =============================================================================

#[test]
fn test_parse_st_mock_output() {
    /// Parse mock ST output data using spec stride.
    /// Mock ST output: window_start window_end [a1 a2 a3 error] per channel
    /// For 2 channels, 1 timepoint:
    let mock_data: [f64; 10] = [0.0, 1000.0, 0.1, 0.2, 0.3, 0.01, 0.4, 0.5, 0.6, 0.02];
    //                                      ---- channel 0 ----  ---- channel 1 ----

    let stride = ST.stride as usize;
    assert_eq!(stride, 4);

    // Extract data for channel 0
    let ch0_start = 2; // Skip window bounds
    let ch0_data: Vec<f64> = mock_data[ch0_start..ch0_start + stride].to_vec();
    assert_eq!(ch0_data, vec![0.1, 0.2, 0.3, 0.01]);

    // Extract data for channel 1
    let ch1_start = ch0_start + stride;
    let ch1_data: Vec<f64> = mock_data[ch1_start..ch1_start + stride].to_vec();
    assert_eq!(ch1_data, vec![0.4, 0.5, 0.6, 0.02]);
}

#[test]
fn test_parse_cd_mock_output() {
    /// Parse mock CD output data using spec stride.
    /// Mock CD output: window_start window_end [a1 error] per directed pair
    /// For 2 directed pairs (1->2, 2->1), 1 timepoint:
    let mock_data: [f64; 6] = [0.0, 1000.0, 0.1, 0.01, 0.2, 0.02];
    //                                     ---- 1->2 ----  ---- 2->1 ----

    let stride = CD.stride as usize;
    assert_eq!(stride, 2);

    // Extract data for pair 1->2
    let p0_start = 2;
    let p0_data: Vec<f64> = mock_data[p0_start..p0_start + stride].to_vec();
    assert_eq!(p0_data, vec![0.1, 0.01]);

    // Extract data for pair 2->1
    let p1_start = p0_start + stride;
    let p1_data: Vec<f64> = mock_data[p1_start..p1_start + stride].to_vec();
    assert_eq!(p1_data, vec![0.2, 0.02]);
}

#[test]
fn test_parse_sy_mock_output() {
    /// Parse mock SY output data using spec stride.
    /// Mock SY output: window_start window_end [sync_coef] per channel
    /// For 3 channels, 1 timepoint:
    let mock_data: [f64; 5] = [0.0, 1000.0, 0.95, 0.87, 0.91];
    //                                     ch0   ch1   ch2

    let stride = SY.stride as usize;
    assert_eq!(stride, 1);

    // Each channel gets 1 value
    for i in 0..3 {
        let ch_start = 2 + (i * stride);
        let ch_data = &mock_data[ch_start..ch_start + stride];
        assert_eq!(ch_data.len(), 1);
    }
}

#[test]
fn test_stride_determines_num_channels() {
    /// Verify stride correctly determines number of channels from output width.
    /// Ground truth: data_columns / stride = num_channels
    let test_cases: [(u8, usize, usize); 4] = [
        (ST.stride, 8, 2),   // 8 data cols / 4 stride = 2 channels
        (ST.stride, 12, 3),  // 12 data cols / 4 stride = 3 channels
        (CD.stride, 4, 2),   // 4 data cols / 2 stride = 2 pairs
        (SY.stride, 5, 5),   // 5 data cols / 1 stride = 5 channels
    ];

    for (stride, data_cols, expected_num) in test_cases {
        let stride_usize = stride as usize;
        assert_eq!(data_cols % stride_usize, 0, "Data cols {} not divisible by stride {}", data_cols, stride);
        assert_eq!(data_cols / stride_usize, expected_num);
    }
}

// =============================================================================
// GROUND TRUTH VALIDATION - Required Parameters
// =============================================================================

#[test]
fn test_ct_requires_wl_ct_ws_ct() {
    /// Verify CT requires -WL_CT and -WS_CT as the binary expects.
    let ct = Variant::from_abbreviation("CT").unwrap();
    assert!(ct.required_params.contains(&"-WL_CT"));
    assert!(ct.required_params.contains(&"-WS_CT"));
}

#[test]
fn test_cd_requires_wl_ct_ws_ct() {
    /// Verify CD requires -WL_CT and -WS_CT as the binary expects.
    let cd = Variant::from_abbreviation("CD").unwrap();
    assert!(cd.required_params.contains(&"-WL_CT"));
    assert!(cd.required_params.contains(&"-WS_CT"));
}

#[test]
fn test_de_requires_wl_ct_ws_ct() {
    /// Verify DE requires -WL_CT and -WS_CT as the binary expects.
    let de = Variant::from_abbreviation("DE").unwrap();
    assert!(de.required_params.contains(&"-WL_CT"));
    assert!(de.required_params.contains(&"-WS_CT"));
}

#[test]
fn test_st_no_special_params() {
    /// Verify ST has no special required parameters.
    let st = Variant::from_abbreviation("ST").unwrap();
    assert!(st.required_params.is_empty());
}

#[test]
fn test_sy_no_special_params() {
    /// Verify SY has no special required parameters.
    let sy = Variant::from_abbreviation("SY").unwrap();
    assert!(sy.required_params.is_empty());
}
