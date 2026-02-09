//! DDA Variant definitions — DDA Specification v1.0.0

use serde::{Deserialize, Serialize};

/// Size of the SELECT mask (6 bits)
pub const SELECT_MASK_SIZE: usize = 6;

/// DDA binary name
pub const BINARY_NAME: &str = "run_DDA_AsciiEdf";

/// Whether shell wrapper is required
pub const REQUIRES_SHELL_WRAPPER: bool = true;

/// Shell command for wrapper
pub const SHELL_COMMAND: &str = "sh";

/// Supported platforms
pub const SUPPORTED_PLATFORMS: &[&str] = &["linux", "macos", "windows"];

/// Channel format for variant input
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelFormat {
    Individual,
    Pairs,
    DirectedPairs,
}

impl ChannelFormat {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "individual" => Some(Self::Individual),
            "pairs" => Some(Self::Pairs),
            "directed_pairs" => Some(Self::DirectedPairs),
            _ => None,
        }
    }
}

/// Output column specification for a variant
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputColumns {
    pub coefficients: u8,
    pub has_error: bool,
}

/// Complete variant metadata
/// Note: Only Serialize is derived since static references can't be deserialized
#[derive(Debug, Clone, Serialize)]
pub struct VariantMetadata {
    pub abbreviation: &'static str,
    pub name: &'static str,
    pub position: u8,
    pub output_suffix: &'static str,
    pub stride: u8,
    pub reserved: bool,
    #[serde(skip)]
    pub required_params: &'static [&'static str],
    pub channel_format: ChannelFormat,
    pub output_columns: OutputColumns,
    pub documentation: &'static str,
}

impl VariantMetadata {
    /// Look up variant by abbreviation
    pub fn from_abbrev(abbrev: &str) -> Option<&'static VariantMetadata> {
        VARIANT_REGISTRY.iter().find(|v| v.abbreviation == abbrev)
    }

    /// Look up variant by output suffix
    pub fn from_suffix(suffix: &str) -> Option<&'static VariantMetadata> {
        VARIANT_REGISTRY.iter().find(|v| v.output_suffix == suffix)
    }

    /// Look up variant by position
    pub fn from_position(pos: u8) -> Option<&'static VariantMetadata> {
        VARIANT_REGISTRY.iter().find(|v| v.position == pos)
    }

    /// Get all non-reserved variants
    pub fn active_variants() -> impl Iterator<Item = &'static VariantMetadata> {
        VARIANT_REGISTRY.iter().filter(|v| !v.reserved)
    }
}

// =============================================================================
// VARIANT DEFINITIONS
// =============================================================================

/// Single Timeseries (ST) - Position 0
///
/// Analyzes individual channels independently. Most basic variant. One result row per channel.
pub const ST: VariantMetadata = VariantMetadata {
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
    },
    documentation: "Analyzes individual channels independently. Most basic variant. One result row per channel.",
};

/// Cross-Timeseries (CT) - Position 1
///
/// Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1). When enabled with ST, wrapper must run CT pairs separately.
pub const CT: VariantMetadata = VariantMetadata {
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
    },
    documentation: "Analyzes relationships between channel pairs. Symmetric: pair (1,2) equals (2,1). When enabled with ST, wrapper must run CT pairs separately.",
};

/// Cross-Dynamical (CD) - Position 2
///
/// Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1). CD is independent (no longer requires ST+CT).
pub const CD: VariantMetadata = VariantMetadata {
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
    },
    documentation: "Analyzes directed causal relationships. Asymmetric: (1->2) differs from (2->1). CD is independent (no longer requires ST+CT).",
};

/// Reserved (RESERVED) - Position 3
///
/// Internal development function. Should always be set to 0 in production.
pub const RESERVED: VariantMetadata = VariantMetadata {
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
    },
    documentation: "Internal development function. Should always be set to 0 in production.",
};

/// Delay Embedding (DE) - Position 4
///
/// Tests for ergodic behavior in dynamical systems. Produces single aggregate measure per time window (not per-channel).
pub const DE: VariantMetadata = VariantMetadata {
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
    },
    documentation: "Tests for ergodic behavior in dynamical systems. Produces single aggregate measure per time window (not per-channel).",
};

/// Synchronization (SY) - Position 5
///
/// Detects synchronized behavior between signals. Produces one value per channel/measure per time window.
pub const SY: VariantMetadata = VariantMetadata {
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
    },
    documentation: "Detects synchronized behavior between signals. Produces one value per channel/measure per time window.",
};

/// All variants in SELECT mask order
pub const VARIANT_REGISTRY: &[VariantMetadata] = &[ST, CT, CD, RESERVED, DE, SY];

/// Variant abbreviations in SELECT mask order
pub const VARIANT_ORDER: &[&str] = &["ST", "CT", "CD", "RESERVED", "DE", "SY"];

// =============================================================================
// SELECT MASK UTILITIES
// =============================================================================

/// Generate a SELECT mask from variant abbreviations
pub fn generate_select_mask(variants: &[&str]) -> [u8; SELECT_MASK_SIZE] {
    let mut mask = [0u8; SELECT_MASK_SIZE];
    for abbrev in variants {
        if let Some(variant) = VariantMetadata::from_abbrev(abbrev) {
            mask[variant.position as usize] = 1;
        }
    }
    mask
}

/// Parse a SELECT mask back to variant abbreviations
pub fn parse_select_mask(mask: &[u8]) -> Vec<&'static str> {
    mask.iter()
        .enumerate()
        .filter(|(_, &bit)| bit == 1)
        .filter_map(|(pos, _)| VariantMetadata::from_position(pos as u8))
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

// =============================================================================
// SELECT MASK POSITION CONSTANTS
// =============================================================================

pub mod select_mask_positions {
    /// Position of ST in SELECT mask
    pub const ST: usize = 0;
    /// Position of CT in SELECT mask
    pub const CT: usize = 1;
    /// Position of CD in SELECT mask
    pub const CD: usize = 2;
    /// Position of RESERVED in SELECT mask
    pub const RESERVED: usize = 3;
    /// Position of DE in SELECT mask
    pub const DE: usize = 4;
    /// Position of SY in SELECT mask
    pub const SY: usize = 5;
}

// =============================================================================
// FILE TYPES
// =============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileType {
    EDF,
    ASCII,
}

impl FileType {
    pub fn flag(&self) -> &'static str {
        match self {
            Self::EDF => "-EDF",
            Self::ASCII => "-ASCII",
        }
    }

    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "edf" => Some(Self::EDF),
            "ascii" => Some(Self::ASCII),
            "txt" => Some(Self::ASCII),
            "csv" => Some(Self::ASCII),
            _ => None,
        }
    }
}

// =============================================================================
// BINARY RESOLUTION
// =============================================================================

/// Environment variable for explicit binary path
pub const BINARY_ENV_VAR: &str = "DDA_BINARY_PATH";

/// Environment variable for DDA home directory
pub const BINARY_HOME_ENV_VAR: &str = "DDA_HOME";

/// Default search paths (in priority order)
pub const DEFAULT_BINARY_PATHS: &[&str] =
    &["~/.local/bin", "~/bin", "/usr/local/bin", "/opt/dda/bin"];

/// Find the DDA binary.
///
/// Resolution order:
/// 1. Explicit path (if provided)
/// 2. $DDA_BINARY_PATH environment variable
/// 3. $DDA_HOME/bin/ directory
/// 4. Default search paths
///
/// # Arguments
/// * `explicit_path` - Optional explicit path to binary
///
/// # Returns
/// Path to binary if found, None otherwise
pub fn find_binary(explicit_path: Option<&str>) -> Option<std::path::PathBuf> {
    use std::path::PathBuf;

    // Helper to expand ~ in paths
    fn expand_path(path: &str) -> PathBuf {
        if path.starts_with("~/") {
            if let Some(home) = std::env::var_os("HOME") {
                return PathBuf::from(home).join(&path[2..]);
            }
        }
        PathBuf::from(path)
    }

    // 1. Explicit path
    if let Some(path) = explicit_path {
        let p = expand_path(path);
        if p.exists() {
            return Some(p);
        }
        return None;
    }

    // 2. Environment variable for full path
    if let Ok(env_path) = std::env::var(BINARY_ENV_VAR) {
        let p = expand_path(&env_path);
        if p.exists() {
            return Some(p);
        }
    }

    // 3. DDA_HOME environment variable
    if let Ok(home_path) = std::env::var(BINARY_HOME_ENV_VAR) {
        let p = expand_path(&home_path).join("bin").join(BINARY_NAME);
        if p.exists() {
            return Some(p);
        }
    }

    // 4. Default search paths
    for search_path in DEFAULT_BINARY_PATHS {
        let p = expand_path(search_path).join(BINARY_NAME);
        if p.exists() {
            return Some(p);
        }
    }

    None
}

/// Find the DDA binary or return an error.
///
/// Same as `find_binary()` but returns an error if not found.
pub fn require_binary(explicit_path: Option<&str>) -> Result<std::path::PathBuf, String> {
    find_binary(explicit_path).ok_or_else(|| {
        format!(
            "DDA binary '{}' not found. Set ${} or ${}, or install to one of: {:?}",
            BINARY_NAME, BINARY_ENV_VAR, BINARY_HOME_ENV_VAR, DEFAULT_BINARY_PATHS
        )
    })
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_variant_registry_size() {
        assert_eq!(VARIANT_REGISTRY.len(), 6);
    }

    #[test]
    fn test_variant_lookup_by_abbrev() {
        assert!(VariantMetadata::from_abbrev("ST").is_some());
        assert!(VariantMetadata::from_abbrev("CT").is_some());
        assert!(VariantMetadata::from_abbrev("CD").is_some());
        assert!(VariantMetadata::from_abbrev("DE").is_some());
        assert!(VariantMetadata::from_abbrev("SY").is_some());
        assert!(VariantMetadata::from_abbrev("INVALID").is_none());
    }

    #[test]
    fn test_variant_lookup_by_suffix() {
        assert!(VariantMetadata::from_suffix("_ST").is_some());
        assert!(VariantMetadata::from_suffix("_CT").is_some());
        assert!(VariantMetadata::from_suffix("_CD_DDA_ST").is_some());
        assert!(VariantMetadata::from_suffix("_DE").is_some());
        assert!(VariantMetadata::from_suffix("_SY").is_some());
    }

    #[test]
    fn test_select_mask_generation() {
        let mask = generate_select_mask(&["ST", "SY"]);
        assert_eq!(mask[select_mask_positions::ST], 1);
        assert_eq!(mask[select_mask_positions::SY], 1);
        assert_eq!(mask[select_mask_positions::CT], 0);
    }

    #[test]
    fn test_select_mask_parsing() {
        let mask = [1, 1, 0, 0, 1, 0];
        let variants = parse_select_mask(&mask);
        assert!(variants.contains(&"ST"));
        assert!(variants.contains(&"CT"));
        assert!(variants.contains(&"DE"));
        assert!(!variants.contains(&"CD"));
    }

    #[test]
    fn test_file_type_flags() {
        assert_eq!(FileType::EDF.flag(), "-EDF");
        assert_eq!(FileType::ASCII.flag(), "-ASCII");
    }

    #[test]
    fn test_file_type_detection() {
        assert_eq!(FileType::from_extension("edf"), Some(FileType::EDF));
        assert_eq!(FileType::from_extension("ascii"), Some(FileType::ASCII));
        assert_eq!(FileType::from_extension("txt"), Some(FileType::ASCII));
        assert_eq!(FileType::from_extension("csv"), Some(FileType::ASCII));
        assert!(FileType::from_extension("unknown").is_none());
    }

    #[test]
    fn test_binary_name() {
        assert_eq!(BINARY_NAME, "run_DDA_AsciiEdf");
    }

    #[test]
    fn test_stride_values() {
        assert_eq!(ST.stride, 4);
        assert_eq!(CT.stride, 4);
        assert_eq!(CD.stride, 2);
        assert_eq!(DE.stride, 1);
        assert_eq!(SY.stride, 1);
    }
}
