//! DDA Specification Library
//!
//! This is the canonical, compile-time verified specification for Delay Differential Analysis.
//! All variant metadata, CLI arguments, and output formats are defined here as Rust types.
//!
//! The Smithy models in `model/` define the schema, and this library provides the
//! runtime representation that is used for code generation to other languages.

pub mod variants;
pub mod cli;
pub mod output;

pub use variants::*;
pub use cli::*;
pub use output::*;

/// Specification version
pub const SPEC_VERSION: &str = "1.0.0";

/// Binary metadata
pub const BINARY_NAME: &str = "run_DDA_AsciiEdf";
pub const REQUIRES_SHELL_WRAPPER: bool = true;
pub const SHELL_COMMAND: &str = "sh";

/// Supported platforms
pub const SUPPORTED_PLATFORMS: &[&str] = &["linux", "macos", "windows"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_variants_have_unique_positions() {
        let positions: Vec<u8> = VARIANTS.iter().map(|v| v.position).collect();
        let mut sorted = positions.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(positions.len(), sorted.len(), "Duplicate variant positions found");
    }

    #[test]
    fn test_all_variants_have_unique_abbreviations() {
        let abbrevs: Vec<&str> = VARIANTS.iter().map(|v| v.abbreviation).collect();
        let mut sorted = abbrevs.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(abbrevs.len(), sorted.len(), "Duplicate abbreviations found");
    }

    #[test]
    fn test_select_mask_size() {
        assert_eq!(SELECT_MASK_SIZE, 6);
        assert_eq!(VARIANTS.len(), SELECT_MASK_SIZE);
    }

    #[test]
    fn test_variant_lookup() {
        assert!(Variant::from_abbreviation("ST").is_some());
        assert!(Variant::from_abbreviation("XX").is_none());
        assert!(Variant::from_position(0).is_some());
        assert!(Variant::from_position(99).is_none());
    }
}
