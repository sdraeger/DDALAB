//! DDA Variant Definitions
//!
//! This module defines all DDA analysis variants as compile-time constants.
//! Any typo or invalid value will cause a compilation error.
//!
//! Corresponds to: model/variants.smithy

use serde::{Deserialize, Serialize};

/// Size of the SELECT mask (6 bits)
pub const SELECT_MASK_SIZE: usize = 6;

/// Channel format for variant input
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelFormat {
    /// Individual channels: 1 2 3
    Individual,
    /// Channel pairs: 1 2 (first pair only)
    Pairs,
    /// Directed pairs as flat list: 1 2 1 3 2 3
    DirectedPairs,
}

/// Output column specification for a variant
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputColumns {
    /// Number of coefficient columns
    pub coefficients: u8,
    /// Whether error column is included
    pub has_error: bool,
    /// Description of column contents
    pub description: &'static str,
}

/// Complete variant metadata
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Variant {
    /// Short abbreviation (e.g., "ST", "CT")
    pub abbreviation: &'static str,
    /// Full human-readable name
    pub name: &'static str,
    /// Position in SELECT mask (0-5)
    pub position: u8,
    /// Output file suffix
    pub output_suffix: &'static str,
    /// Column stride in output
    pub stride: u8,
    /// Whether this is a reserved/internal variant
    pub reserved: bool,
    /// Required CLI parameters
    pub required_params: &'static [&'static str],
    /// Channel format for this variant
    pub channel_format: ChannelFormat,
    /// Output column specification
    pub output_columns: OutputColumns,
    /// Documentation string
    pub documentation: &'static str,
}

impl Variant {
    /// Look up variant by abbreviation
    pub fn from_abbreviation(abbrev: &str) -> Option<&'static Variant> {
        VARIANTS.iter().find(|v| v.abbreviation == abbrev)
    }

    /// Look up variant by position in SELECT mask
    pub fn from_position(position: u8) -> Option<&'static Variant> {
        VARIANTS.iter().find(|v| v.position == position)
    }

    /// Look up variant by output suffix
    pub fn from_suffix(suffix: &str) -> Option<&'static Variant> {
        VARIANTS.iter().find(|v| v.output_suffix == suffix)
    }

    /// Get all non-reserved variants
    pub fn active_variants() -> impl Iterator<Item = &'static Variant> {
        VARIANTS.iter().filter(|v| !v.reserved)
    }

    /// Check if this variant requires CT window parameters
    pub fn requires_ct_params(&self) -> bool {
        self.required_params.contains(&"-WL_CT")
    }
}

// ============================================================================
// VARIANT DEFINITIONS - The canonical source of truth
// ============================================================================

/// Single Timeseries (ST) - Position 0
pub const ST: Variant = Variant {
    abbreviation: "ST",
    name: "Single Timeseries",
    position: 0,
    output_suffix: "_ST",
    stride: 4,
    reserved: false,
    required_params: &[],
    channel_format: ChannelFormat::Individual,
    output_columns: OutputColumns {
        coefficients: 3,
        has_error: true,
        description: "4 columns per channel: a_1, a_2, a_3 coefficients + error",
    },
    documentation: "Analyzes individual channels independently. Most basic variant. One result row per channel.",
};

/// Cross-Timeseries (CT) - Position 1
pub const CT: Variant = Variant {
    abbreviation: "CT",
    name: "Cross-Timeseries",
    position: 1,
    output_suffix: "_CT",
    stride: 4,
    reserved: false,
    required_params: &["-WL_CT", "-WS_CT"],
    channel_format: ChannelFormat::Pairs,
    output_columns: OutputColumns {
        coefficients: 3,
        has_error: true,
        description: "4 columns per pair: a_1, a_2, a_3 coefficients + error",
    },
    documentation: "Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1). When enabled with ST, wrapper must run CT pairs separately.",
};

/// Cross-Dynamical (CD) - Position 2
pub const CD: Variant = Variant {
    abbreviation: "CD",
    name: "Cross-Dynamical",
    position: 2,
    output_suffix: "_CD_DDA_ST",
    stride: 2,
    reserved: false,
    required_params: &["-WL_CT", "-WS_CT"],
    channel_format: ChannelFormat::DirectedPairs,
    output_columns: OutputColumns {
        coefficients: 1,
        has_error: true,
        description: "2 columns per directed pair: a_1 coefficient + error",
    },
    documentation: "Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1). CD is independent (no longer requires ST+CT).",
};

/// Reserved - Position 3 (internal use only)
pub const RESERVED: Variant = Variant {
    abbreviation: "RESERVED",
    name: "Reserved",
    position: 3,
    output_suffix: "_RESERVED",
    stride: 1,
    reserved: true,
    required_params: &[],
    channel_format: ChannelFormat::Individual,
    output_columns: OutputColumns {
        coefficients: 0,
        has_error: false,
        description: "Reserved for internal development",
    },
    documentation: "Internal development function. Should always be set to 0 in production.",
};

/// Delay Embedding / Dynamical Ergodicity (DE) - Position 4
pub const DE: Variant = Variant {
    abbreviation: "DE",
    name: "Delay Embedding",
    position: 4,
    output_suffix: "_DE",
    stride: 1,
    reserved: false,
    required_params: &["-WL_CT", "-WS_CT"],
    channel_format: ChannelFormat::Individual,
    output_columns: OutputColumns {
        coefficients: 0,
        has_error: false,
        description: "1 column: single ergodicity measure per time window",
    },
    documentation: "Tests for ergodic behavior in dynamical systems. Produces single aggregate measure per time window (not per-channel).",
};

/// Synchronization (SY) - Position 5
pub const SY: Variant = Variant {
    abbreviation: "SY",
    name: "Synchronization",
    position: 5,
    output_suffix: "_SY",
    stride: 1,
    reserved: false,
    required_params: &[],
    channel_format: ChannelFormat::Individual,
    output_columns: OutputColumns {
        coefficients: 0,
        has_error: false,
        description: "1 column per channel/measure: synchronization coefficient",
    },
    documentation: "Detects synchronized behavior between signals. Produces one value per channel/measure per time window.",
};

/// All variants in SELECT mask order
pub const VARIANTS: &[Variant] = &[ST, CT, CD, RESERVED, DE, SY];

/// Variant abbreviations in SELECT mask order
pub const VARIANT_ORDER: &[&str] = &["ST", "CT", "CD", "RESERVED", "DE", "SY"];

// ============================================================================
// SELECT MASK UTILITIES
// ============================================================================

/// Generate a SELECT mask from variant abbreviations
///
/// # Example
/// ```
/// use dda_spec::generate_select_mask;
/// let mask = generate_select_mask(&["ST", "SY"]);
/// assert_eq!(mask, [1, 0, 0, 0, 0, 1]);
/// ```
pub fn generate_select_mask(variants: &[&str]) -> [u8; SELECT_MASK_SIZE] {
    let mut mask = [0u8; SELECT_MASK_SIZE];
    for abbrev in variants {
        if let Some(variant) = Variant::from_abbreviation(abbrev) {
            mask[variant.position as usize] = 1;
        }
    }
    mask
}

/// Parse a SELECT mask back to variant abbreviations
///
/// # Example
/// ```
/// use dda_spec::parse_select_mask;
/// let variants = parse_select_mask(&[1, 0, 0, 0, 0, 1]);
/// assert_eq!(variants, vec!["ST", "SY"]);
/// ```
pub fn parse_select_mask(mask: &[u8]) -> Vec<&'static str> {
    mask.iter()
        .enumerate()
        .filter(|(_, &bit)| bit == 1)
        .filter_map(|(pos, _)| Variant::from_position(pos as u8))
        .filter(|v| !v.reserved)
        .map(|v| v.abbreviation)
        .collect()
}

/// Format SELECT mask as space-separated string for CLI
pub fn format_select_mask(mask: &[u8; SELECT_MASK_SIZE]) -> String {
    mask.iter()
        .map(|b| b.to_string())
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_variant_positions_are_sequential() {
        for (i, variant) in VARIANTS.iter().enumerate() {
            assert_eq!(variant.position as usize, i,
                "Variant {} has wrong position", variant.abbreviation);
        }
    }

    #[test]
    fn test_generate_select_mask_st_only() {
        let mask = generate_select_mask(&["ST"]);
        assert_eq!(mask, [1, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn test_generate_select_mask_multiple() {
        let mask = generate_select_mask(&["ST", "CT", "CD"]);
        assert_eq!(mask, [1, 1, 1, 0, 0, 0]);
    }

    #[test]
    fn test_parse_select_mask() {
        let variants = parse_select_mask(&[1, 1, 0, 0, 1, 0]);
        assert_eq!(variants, vec!["ST", "CT", "DE"]);
    }

    #[test]
    fn test_reserved_excluded_from_parse() {
        // Even if RESERVED bit is set, it should not appear in parse output
        let variants = parse_select_mask(&[0, 0, 0, 1, 0, 0]);
        assert!(variants.is_empty());
    }

    #[test]
    fn test_stride_values() {
        assert_eq!(ST.stride, 4);
        assert_eq!(CT.stride, 4);
        assert_eq!(CD.stride, 2);
        assert_eq!(DE.stride, 1);
        assert_eq!(SY.stride, 1);
    }

    #[test]
    fn test_requires_ct_params() {
        assert!(!ST.requires_ct_params());
        assert!(CT.requires_ct_params());
        assert!(CD.requires_ct_params());
        assert!(DE.requires_ct_params());
        assert!(!SY.requires_ct_params());
    }
}
