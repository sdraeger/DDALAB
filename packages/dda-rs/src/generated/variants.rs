// AUTO-GENERATED from DDA_SPEC.yaml
// DO NOT EDIT - Changes will be overwritten
//
// Generated at: 2025-11-17T20:47:03.356623+00:00
// Spec version: 1.0.0
// Generator: dda-codegen v0.1.0

/// DDA Variant Metadata
///
/// Defines properties and behavior for each DDA analysis variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantMetadata {
    /// Variant abbreviation (e.g., "ST", "CT", "CD")
    pub abbreviation: &'static str,

    /// Full variant name
    pub name: &'static str,

    /// Detailed description
    pub description: &'static str,

    /// Output file suffix appended by binary
    pub output_suffix: &'static str,

    /// Column stride for parsing output
    /// - ST/CT/DE: 4 columns per channel/pair
    /// - CD: 2 columns per directed pair
    /// - SY: 1 column per channel
    pub stride: u32,

    /// Whether this variant requires CT window parameters
    pub requires_ct_params: bool,
}

impl VariantMetadata {
    /// Get variant metadata by abbreviation
    pub fn from_abbrev(abbrev: &str) -> Option<&'static Self> {
        VARIANT_REGISTRY.iter().find(|v| v.abbreviation == abbrev)
    }

    /// Get variant metadata by output suffix
    pub fn from_suffix(suffix: &str) -> Option<&'static Self> {
        VARIANT_REGISTRY.iter().find(|v| v.output_suffix == suffix)
    }
}

/// Registry of all DDA variants
///
/// This is the canonical list of all supported DDA analysis variants.
/// Order matches SELECT mask bit positions (skipping RESERVED at position 3).
pub const VARIANT_REGISTRY: &[VariantMetadata] = &[
    VariantMetadata {
        abbreviation: "CD",
        name: "Cross-Dynamical",
        description: "Analyzes directed causal relationships between channels",
        output_suffix: "_CD_DDA_ST",
        stride: 2,
        requires_ct_params: true,
    },
    VariantMetadata {
        abbreviation: "CT",
        name: "Cross-Timeseries",
        description: "Analyzes relationships between channel pairs",
        output_suffix: "_CT",
        stride: 4,
        requires_ct_params: true,
    },
    VariantMetadata {
        abbreviation: "DE",
        name: "Delay Embedding (Dynamical Ergodicity)",
        description: "Analyzes dynamical ergodicity through delay embedding",
        output_suffix: "_DE",
        stride: 1,
        requires_ct_params: true,
    },
    VariantMetadata {
        abbreviation: "ST",
        name: "Single Timeseries",
        description: "Analyzes individual channels independently",
        output_suffix: "_ST",
        stride: 4,
        requires_ct_params: false,
    },
    VariantMetadata {
        abbreviation: "SY",
        name: "Synchronization",
        description: "Analyzes phase synchronization between signals",
        output_suffix: "_SY",
        stride: 1,
        requires_ct_params: false,
    },
];

/// SELECT mask bit positions
///
/// The SELECT mask is a 6-bit array controlling which variants to execute.
/// Format: ST CT CD RESERVED DE SY
pub mod select_mask_positions {
    pub const CD: usize = 2;
    pub const CT: usize = 1;
    pub const DE: usize = 4; // Position 3 is RESERVED
    pub const ST: usize = 0;
    pub const SY: usize = 5;
    pub const RESERVED: usize = 3;
}

/// Generate SELECT mask from enabled variants
///
/// # Arguments
/// * `variants` - List of variant abbreviations to enable (e.g., &["ST", "CT"])
///
/// # Returns
/// 6-element array with 1s for enabled variants, 0s for disabled
///
/// # Example
/// ```
/// use dda_rs::generated::variants::*;
/// let mask = generate_select_mask(&["ST", "SY"]);
/// assert_eq!(mask, [1, 0, 0, 0, 0, 1]); // ST and SY enabled
/// ```
pub fn generate_select_mask(variants: &[&str]) -> [u8; 6] {
    let mut mask = [0; 6];

    for variant in variants {
        match *variant {
            "CD" => mask[select_mask_positions::CD] = 1,
            "CT" => mask[select_mask_positions::CT] = 1,
            "DE" => mask[select_mask_positions::DE] = 1,
            "ST" => mask[select_mask_positions::ST] = 1,
            "SY" => mask[select_mask_positions::SY] = 1,
            _ => log::warn!("Unknown variant: {}", variant),
        }
    }

    mask
}

/// Parse SELECT mask to list of enabled variants
///
/// # Arguments
/// * `mask` - 6-element SELECT mask array
///
/// # Returns
/// Vector of enabled variant abbreviations
///
/// # Example
/// ```
/// use dda_rs::generated::variants::*;
/// let mask = [1, 0, 0, 0, 0, 1];
/// let enabled = parse_select_mask(&mask);
/// assert_eq!(enabled, vec!["ST", "SY"]);
/// ```
pub fn parse_select_mask(mask: &[u8]) -> Vec<&'static str> {
    let mut enabled = Vec::new();

    if mask.len() < 6 {
        log::error!("Invalid SELECT mask: expected 6 bits, got {}", mask.len());
        return enabled;
    }
    if mask[select_mask_positions::CD] == 1 {
        enabled.push("CD");
    }
    if mask[select_mask_positions::CT] == 1 {
        enabled.push("CT");
    }
    if mask[select_mask_positions::DE] == 1 {
        enabled.push("DE");
    }
    if mask[select_mask_positions::ST] == 1 {
        enabled.push("ST");
    }
    if mask[select_mask_positions::SY] == 1 {
        enabled.push("SY");
    }

    enabled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_variant_registry_size() {
        // Should have all variants except RESERVED
        assert_eq!(VARIANT_REGISTRY.len(), 5);
    }

    #[test]
    fn test_variant_lookup_by_abbrev() {
        let variant = VariantMetadata::from_abbrev("CD");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().name, "Cross-Dynamical");
        assert_eq!(variant.unwrap().stride, 2);
        let variant = VariantMetadata::from_abbrev("CT");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().name, "Cross-Timeseries");
        assert_eq!(variant.unwrap().stride, 4);
        let variant = VariantMetadata::from_abbrev("DE");
        assert!(variant.is_some());
        assert_eq!(
            variant.unwrap().name,
            "Delay Embedding (Dynamical Ergodicity)"
        );
        assert_eq!(variant.unwrap().stride, 1);
        let variant = VariantMetadata::from_abbrev("ST");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().name, "Single Timeseries");
        assert_eq!(variant.unwrap().stride, 4);
        let variant = VariantMetadata::from_abbrev("SY");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().name, "Synchronization");
        assert_eq!(variant.unwrap().stride, 1);
    }

    #[test]
    fn test_variant_lookup_by_suffix() {
        let variant = VariantMetadata::from_suffix("_CD_DDA_ST");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().abbreviation, "CD");
        let variant = VariantMetadata::from_suffix("_CT");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().abbreviation, "CT");
        let variant = VariantMetadata::from_suffix("_DE");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().abbreviation, "DE");
        let variant = VariantMetadata::from_suffix("_ST");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().abbreviation, "ST");
        let variant = VariantMetadata::from_suffix("_SY");
        assert!(variant.is_some());
        assert_eq!(variant.unwrap().abbreviation, "SY");
    }

    #[test]
    fn test_select_mask_generation() {
        let mask = generate_select_mask(&["ST", "SY"]);
        assert_eq!(mask[select_mask_positions::ST], 1);
        assert_eq!(mask[select_mask_positions::CT], 0);
        assert_eq!(mask[select_mask_positions::CD], 0);
        assert_eq!(mask[select_mask_positions::RESERVED], 0);
        assert_eq!(mask[select_mask_positions::DE], 0);
        assert_eq!(mask[select_mask_positions::SY], 1);
    }

    #[test]
    fn test_select_mask_parsing() {
        let mask = [1, 0, 0, 0, 0, 1];
        let enabled = parse_select_mask(&mask);
        assert_eq!(enabled, vec!["ST", "SY"]);
    }

    #[test]
    fn test_cd_only_mask() {
        // CD now works independently
        let mask = generate_select_mask(&["CD"]);
        assert_eq!(mask[select_mask_positions::CD], 1);
        assert_eq!(mask[select_mask_positions::ST], 0);
        assert_eq!(mask[select_mask_positions::CT], 0);
    }
}
