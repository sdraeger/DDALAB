//! CLI Argument Definitions
//!
//! This module defines all CLI arguments for the DDA binary.
//! Corresponds to: model/cli.smithy

use serde::{Deserialize, Serialize};

/// Input file type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileType {
    /// EDF/EDF+ format
    EDF,
    /// ASCII plain text (no headers)
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

    /// Detect file type from extension
    pub fn from_extension(ext: &str) -> Option<FileType> {
        let ext = ext.trim_start_matches('.').to_lowercase();
        match ext.as_str() {
            "edf" => Some(FileType::EDF),
            "ascii" | "txt" | "csv" => Some(FileType::ASCII),
            _ => None,
        }
    }
}

/// CLI argument metadata
#[derive(Debug, Clone, Serialize)]
pub struct CLIArgument {
    /// The CLI flag (e.g., "-DATA_FN")
    pub flag: &'static str,
    /// Human-readable name
    pub name: &'static str,
    /// Whether this argument is required
    pub required: bool,
    /// Default value if any
    pub default_value: Option<&'static str>,
    /// Variants that require this argument
    pub required_for: &'static [&'static str],
    /// Documentation
    pub documentation: &'static str,
}

// ============================================================================
// CLI ARGUMENT DEFINITIONS
// ============================================================================

pub const ARG_FILE_TYPE: CLIArgument = CLIArgument {
    flag: "-EDF|-ASCII",
    name: "file_type",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "Input file format. Exactly one of -EDF or -ASCII must be specified.",
};

pub const ARG_DATA_FILE: CLIArgument = CLIArgument {
    flag: "-DATA_FN",
    name: "data_file",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "Path to input data file. Must exist and be readable.",
};

pub const ARG_OUTPUT_FILE: CLIArgument = CLIArgument {
    flag: "-OUT_FN",
    name: "output_file",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "Base path for output files (without extension). Binary appends variant-specific suffixes.",
};

pub const ARG_CHANNEL_LIST: CLIArgument = CLIArgument {
    flag: "-CH_list",
    name: "channel_list",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "List of channel indices (1-based). Format depends on variant.",
};

pub const ARG_SELECT_MASK: CLIArgument = CLIArgument {
    flag: "-SELECT",
    name: "select_mask",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "6-bit mask selecting which variants to run. Format: ST CT CD RESERVED DE SY",
};

pub const ARG_MODEL: CLIArgument = CLIArgument {
    flag: "-MODEL",
    name: "model",
    required: true,
    default_value: Some("1 2 10"),
    required_for: &[],
    documentation: "DDA model encoding parameters (min max num for model range).",
};

pub const ARG_DELAY_VALUES: CLIArgument = CLIArgument {
    flag: "-TAU",
    name: "delay_values",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "Delay values (tau) to analyze in samples. Can be explicit list or generated.",
};

pub const ARG_MODEL_DIMENSION: CLIArgument = CLIArgument {
    flag: "-dm",
    name: "model_dimension",
    required: false,
    default_value: Some("4"),
    required_for: &[],
    documentation: "Model dimension. Typical range: 2-10.",
};

pub const ARG_POLYNOMIAL_ORDER: CLIArgument = CLIArgument {
    flag: "-order",
    name: "polynomial_order",
    required: false,
    default_value: Some("4"),
    required_for: &[],
    documentation: "Polynomial order for modeling. Typical range: 2-6.",
};

pub const ARG_NUM_TAU: CLIArgument = CLIArgument {
    flag: "-nr_tau",
    name: "num_tau",
    required: false,
    default_value: Some("2"),
    required_for: &[],
    documentation: "Number of tau values used in embedding.",
};

pub const ARG_WINDOW_LENGTH: CLIArgument = CLIArgument {
    flag: "-WL",
    name: "window_length",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "Window length in samples. Should be >= max(delay_values) * model_dimension.",
};

pub const ARG_WINDOW_STEP: CLIArgument = CLIArgument {
    flag: "-WS",
    name: "window_step",
    required: true,
    default_value: None,
    required_for: &[],
    documentation: "Window step size in samples. Smaller = more overlap = smoother results.",
};

pub const ARG_CT_WINDOW_LENGTH: CLIArgument = CLIArgument {
    flag: "-WL_CT",
    name: "ct_window_length",
    required: false,
    default_value: Some("2"),
    required_for: &["CT", "CD", "DE"],
    documentation: "CT-specific window length. Required for CT, CD, DE variants.",
};

pub const ARG_CT_WINDOW_STEP: CLIArgument = CLIArgument {
    flag: "-WS_CT",
    name: "ct_window_step",
    required: false,
    default_value: Some("2"),
    required_for: &["CT", "CD", "DE"],
    documentation: "CT-specific window step. Required for CT, CD, DE variants.",
};

pub const ARG_TIME_BOUNDS: CLIArgument = CLIArgument {
    flag: "-StartEnd",
    name: "time_bounds",
    required: false,
    default_value: None,
    required_for: &[],
    documentation: "Start and end sample indices. If omitted, processes entire file.",
};

/// All CLI arguments in order
pub const CLI_ARGUMENTS: &[CLIArgument] = &[
    ARG_FILE_TYPE,
    ARG_DATA_FILE,
    ARG_OUTPUT_FILE,
    ARG_CHANNEL_LIST,
    ARG_SELECT_MASK,
    ARG_MODEL,
    ARG_DELAY_VALUES,
    ARG_MODEL_DIMENSION,
    ARG_POLYNOMIAL_ORDER,
    ARG_NUM_TAU,
    ARG_WINDOW_LENGTH,
    ARG_WINDOW_STEP,
    ARG_CT_WINDOW_LENGTH,
    ARG_CT_WINDOW_STEP,
    ARG_TIME_BOUNDS,
];

// ============================================================================
// SCALE PARAMETERS
// ============================================================================

/// Parameters for generating delay values from scale range
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScaleParameters {
    /// Minimum scale value
    pub scale_min: f64,
    /// Maximum scale value
    pub scale_max: f64,
    /// Number of scale values
    pub scale_num: usize,
}

impl ScaleParameters {
    /// Generate delay values from scale parameters
    ///
    /// Formula:
    /// ```text
    /// if scale_num == 1:
    ///     delays = [scale_min]
    /// else:
    ///     delays = [scale_min + (scale_max - scale_min) * i / (scale_num - 1)
    ///               for i in range(scale_num)]
    /// ```
    pub fn generate_delays(&self) -> Vec<i32> {
        if self.scale_num == 1 {
            vec![self.scale_min.round() as i32]
        } else {
            (0..self.scale_num)
                .map(|i| {
                    let value = self.scale_min
                        + (self.scale_max - self.scale_min) * (i as f64)
                            / (self.scale_num - 1) as f64;
                    value.round() as i32
                })
                .collect()
        }
    }
}

impl Default for ScaleParameters {
    fn default() -> Self {
        Self {
            scale_min: 1.0,
            scale_max: 20.0,
            scale_num: 20,
        }
    }
}

// ============================================================================
// VALIDATION
// ============================================================================

/// Validation error types
#[derive(Debug, Clone, thiserror::Error)]
pub enum ValidationError {
    #[error("Window length ({0}) must be >= max(delay_values) * model_dimension")]
    WindowLengthTooSmall(usize),

    #[error("Window step ({0}) must be <= window length ({1})")]
    WindowStepTooLarge(usize, usize),

    #[error("Time bounds start ({0}) must be < end ({1})")]
    InvalidTimeBounds(usize, usize),

    #[error("Channel index {0} is out of bounds (max: {1})")]
    ChannelOutOfBounds(usize, usize),

    #[error("Missing required argument: {0}")]
    MissingArgument(String),
}

/// Validate window parameters
pub fn validate_window_params(
    window_length: usize,
    window_step: usize,
    max_delay: i32,
    model_dimension: usize,
) -> Result<(), ValidationError> {
    let min_window = (max_delay as usize) * model_dimension;
    if window_length < min_window {
        return Err(ValidationError::WindowLengthTooSmall(window_length));
    }

    if window_step > window_length {
        return Err(ValidationError::WindowStepTooLarge(window_step, window_length));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_type_flags() {
        assert_eq!(FileType::EDF.flag(), "-EDF");
        assert_eq!(FileType::ASCII.flag(), "-ASCII");
    }

    #[test]
    fn test_file_type_detection() {
        assert_eq!(FileType::from_extension("edf"), Some(FileType::EDF));
        assert_eq!(FileType::from_extension("EDF"), Some(FileType::EDF));
        assert_eq!(FileType::from_extension("txt"), Some(FileType::ASCII));
        assert_eq!(FileType::from_extension("unknown"), None);
    }

    #[test]
    fn test_scale_parameters_single() {
        let params = ScaleParameters {
            scale_min: 5.0,
            scale_max: 5.0,
            scale_num: 1,
        };
        assert_eq!(params.generate_delays(), vec![5]);
    }

    #[test]
    fn test_scale_parameters_range() {
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

    #[test]
    fn test_validation_window_length() {
        assert!(validate_window_params(100, 50, 10, 4).is_ok());
        assert!(validate_window_params(30, 20, 10, 4).is_err());
    }

    #[test]
    fn test_validation_window_step() {
        assert!(validate_window_params(100, 50, 5, 4).is_ok());
        assert!(validate_window_params(100, 150, 5, 4).is_err());
    }
}
