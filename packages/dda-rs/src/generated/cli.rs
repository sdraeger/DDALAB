// AUTO-GENERATED from DDA_SPEC.yaml
// DO NOT EDIT - Changes will be overwritten
//
// Generated at: 2025-11-17T20:47:03.356623+00:00
// Spec version: 1.0.0
// Generator: dda-codegen v0.1.0

/// DDA Binary CLI Constants
///
/// Constants derived from the DDA specification for building command-line invocations.

/// Binary name
pub const BINARY_NAME: &str = "run_DDA_AsciiEdf";

/// Binary requires shell wrapper on Unix
pub const REQUIRES_SHELL_WRAPPER: bool = true;

/// CLI Flags
pub mod flags {
    /// Path to input data file
    pub const DATA_FILE: &str = "-DATA_FN";
    /// Base path for output files (without extension)
    pub const OUTPUT_FILE: &str = "-OUT_FN";
    /// List of channel indices (1-based)
    pub const CHANNEL_LIST: &str = "-CH_list";
    /// 6-bit mask selecting which DDA variants to run
    pub const SELECT_MASK: &str = "-SELECT";
    /// DDA model encoding parameters
    pub const MODEL: &str = "-MODEL";
    /// Delay values (tau) to analyze
    pub const DELAY_VALUES: &str = "-TAU";
    /// Model dimension
    pub const MODEL_DIMENSION: &str = "-dm";
    /// Polynomial order for modeling
    pub const POLYNOMIAL_ORDER: &str = "-order";
    /// Number of tau values used in embedding
    pub const NUM_TAU: &str = "-nr_tau";
    /// Window length in samples
    pub const WINDOW_LENGTH: &str = "-WL";
    /// Window step size in samples
    pub const WINDOW_STEP: &str = "-WS";
    /// CT-specific window length
    pub const CT_WINDOW_LENGTH: &str = "-WL_CT";
    /// CT-specific window step
    pub const CT_WINDOW_STEP: &str = "-WS_CT";
    /// Start and end sample indices
    pub const TIME_BOUNDS: &str = "-StartEnd";
}

/// Default values for CLI parameters
pub mod defaults {}

/// File type flags (mutually exclusive)
pub enum FileType {
    /// EDF/EDF+ format
    EDF,
    /// ASCII text format (numeric only, no headers)
    ASCII,
}

impl FileType {
    /// Get the CLI flag for this file type
    pub fn flag(&self) -> &'static str {
        match self {
            FileType::EDF => "-EDF",
            FileType::ASCII => "-ASCII",
        }
    }

    /// Detect file type from path extension
    pub fn from_path(path: &std::path::Path) -> Self {
        if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            match ext_str.as_str() {
                "edf" | "edf+" => FileType::EDF,
                "ascii" | "txt" => FileType::ASCII,
                _ => FileType::EDF, // Default to EDF
            }
        } else {
            FileType::EDF
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_binary_name() {
        assert_eq!(BINARY_NAME, "run_DDA_AsciiEdf");
    }

    #[test]
    fn test_file_type_flags() {
        assert_eq!(FileType::EDF.flag(), "-EDF");
        assert_eq!(FileType::ASCII.flag(), "-ASCII");
    }

    #[test]
    fn test_file_type_detection() {
        use std::path::Path;

        let edf_path = Path::new("test.edf");
        assert!(matches!(FileType::from_path(edf_path), FileType::EDF));

        let ascii_path = Path::new("test.ascii");
        assert!(matches!(FileType::from_path(ascii_path), FileType::ASCII));

        let txt_path = Path::new("test.txt");
        assert!(matches!(FileType::from_path(txt_path), FileType::ASCII));
    }
}
