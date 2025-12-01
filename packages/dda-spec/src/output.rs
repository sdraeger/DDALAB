//! Output Format Definitions
//!
//! This module defines the output file formats for DDA results.
//! Corresponds to: model/output.smithy

use serde::{Deserialize, Serialize};
use crate::variants::Variant;

/// Info file suffix
pub const INFO_FILE_SUFFIX: &str = ".info";

/// Get output file suffix for a variant
pub fn output_suffix_for_variant(abbrev: &str) -> Option<&'static str> {
    Variant::from_abbreviation(abbrev).map(|v| v.output_suffix)
}

/// Get stride for a variant
pub fn stride_for_variant(abbrev: &str) -> Option<u8> {
    Variant::from_abbreviation(abbrev).map(|v| v.stride)
}

/// Parsed DDA output row
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputRow {
    /// Window start sample index
    pub window_start: i64,
    /// Window end sample index
    pub window_end: i64,
    /// Data values (grouped by stride)
    pub data: Vec<f64>,
}

/// Parsed DDA result for a single variant
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VariantResult {
    /// Variant abbreviation
    pub variant: String,
    /// All output rows
    pub rows: Vec<OutputRow>,
    /// Number of entities (channels or pairs)
    pub num_entities: usize,
    /// Number of time windows
    pub num_windows: usize,
}

impl VariantResult {
    /// Extract coefficient matrix [entities × windows]
    pub fn coefficient_matrix(&self) -> Vec<Vec<f64>> {
        let variant = Variant::from_abbreviation(&self.variant)
            .expect("Invalid variant");
        let stride = variant.stride as usize;

        let mut matrix: Vec<Vec<f64>> = vec![vec![]; self.num_entities];

        for row in &self.rows {
            for (entity_idx, chunk) in row.data.chunks(stride).enumerate() {
                if entity_idx < self.num_entities && !chunk.is_empty() {
                    // First value in chunk is the primary coefficient
                    matrix[entity_idx].push(chunk[0]);
                }
            }
        }

        matrix
    }

    /// Extract error values matrix [entities × windows] (if applicable)
    pub fn error_matrix(&self) -> Option<Vec<Vec<f64>>> {
        let variant = Variant::from_abbreviation(&self.variant)?;
        if !variant.output_columns.has_error {
            return None;
        }

        let stride = variant.stride as usize;
        let mut matrix: Vec<Vec<f64>> = vec![vec![]; self.num_entities];

        for row in &self.rows {
            for (entity_idx, chunk) in row.data.chunks(stride).enumerate() {
                if entity_idx < self.num_entities && chunk.len() == stride {
                    // Last value in chunk is the error
                    matrix[entity_idx].push(chunk[stride - 1]);
                }
            }
        }

        Some(matrix)
    }

    /// Get window time bounds
    pub fn window_bounds(&self) -> Vec<(i64, i64)> {
        self.rows.iter().map(|r| (r.window_start, r.window_end)).collect()
    }
}

/// Parser for DDA output files
#[derive(Debug)]
pub struct OutputParser;

impl OutputParser {
    /// Parse a DDA output file
    ///
    /// # Arguments
    /// * `content` - File content as string
    /// * `variant` - Variant abbreviation (e.g., "ST")
    ///
    /// # Returns
    /// Parsed variant result
    pub fn parse(content: &str, variant: &str) -> Result<VariantResult, ParseError> {
        let variant_meta = Variant::from_abbreviation(variant)
            .ok_or_else(|| ParseError::UnknownVariant(variant.to_string()))?;

        let stride = variant_meta.stride as usize;
        let mut rows = Vec::new();

        for (line_num, line) in content.lines().enumerate() {
            let line = line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let values: Result<Vec<f64>, _> = line
                .split_whitespace()
                .map(|s| s.parse::<f64>())
                .collect();

            let values = values.map_err(|e| ParseError::InvalidNumber {
                line: line_num + 1,
                error: e.to_string(),
            })?;

            if values.len() < 2 {
                return Err(ParseError::TooFewColumns {
                    line: line_num + 1,
                    expected: 2,
                    found: values.len(),
                });
            }

            rows.push(OutputRow {
                window_start: values[0] as i64,
                window_end: values[1] as i64,
                data: values[2..].to_vec(),
            });
        }

        if rows.is_empty() {
            return Err(ParseError::EmptyFile);
        }

        // Calculate number of entities from data columns
        let data_cols = rows[0].data.len();
        let num_entities = if stride > 0 { data_cols / stride } else { 0 };
        let num_windows = rows.len();

        Ok(VariantResult {
            variant: variant.to_string(),
            rows,
            num_entities,
            num_windows,
        })
    }
}

/// Parse errors
#[derive(Debug, Clone, thiserror::Error)]
pub enum ParseError {
    #[error("Unknown variant: {0}")]
    UnknownVariant(String),

    #[error("Line {line}: invalid number - {error}")]
    InvalidNumber { line: usize, error: String },

    #[error("Line {line}: expected at least {expected} columns, found {found}")]
    TooFewColumns { line: usize, expected: usize, found: usize },

    #[error("Empty file - no data rows found")]
    EmptyFile,

    #[error("File not found: {0}")]
    FileNotFound(String),
}

/// Result dimensions specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultDimensions {
    /// Row dimension description
    pub rows: &'static str,
    /// Column dimension description
    pub cols: &'static str,
}

/// Get result dimensions for a variant
pub fn result_dimensions(variant: &str) -> Option<ResultDimensions> {
    match variant {
        "ST" => Some(ResultDimensions {
            rows: "Number of channels",
            cols: "Number of time windows",
        }),
        "CT" => Some(ResultDimensions {
            rows: "Number of channel pairs",
            cols: "Number of time windows",
        }),
        "CD" => Some(ResultDimensions {
            rows: "Number of directed pairs",
            cols: "Number of time windows",
        }),
        "DE" => Some(ResultDimensions {
            rows: "1 (single aggregate measure)",
            cols: "Number of time windows",
        }),
        "SY" => Some(ResultDimensions {
            rows: "Number of channels or pairs",
            cols: "Number of time windows",
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_output_suffixes() {
        assert_eq!(output_suffix_for_variant("ST"), Some("_ST"));
        assert_eq!(output_suffix_for_variant("CD"), Some("_CD_DDA_ST"));
        assert_eq!(output_suffix_for_variant("XX"), None);
    }

    #[test]
    fn test_stride_lookup() {
        assert_eq!(stride_for_variant("ST"), Some(4));
        assert_eq!(stride_for_variant("CD"), Some(2));
        assert_eq!(stride_for_variant("DE"), Some(1));
    }

    #[test]
    fn test_parse_st_output() {
        let content = r#"
0 100 1.0 2.0 3.0 0.1 4.0 5.0 6.0 0.2
100 200 1.1 2.1 3.1 0.11 4.1 5.1 6.1 0.21
"#;
        let result = OutputParser::parse(content, "ST").unwrap();
        assert_eq!(result.num_windows, 2);
        assert_eq!(result.num_entities, 2); // 8 values / stride 4 = 2 channels
    }

    #[test]
    fn test_parse_empty_file() {
        let content = "# comment only";
        let result = OutputParser::parse(content, "ST");
        assert!(matches!(result, Err(ParseError::EmptyFile)));
    }

    #[test]
    fn test_coefficient_matrix() {
        let content = "0 100 1.0 2.0 3.0 0.1 4.0 5.0 6.0 0.2";
        let result = OutputParser::parse(content, "ST").unwrap();
        let matrix = result.coefficient_matrix();
        assert_eq!(matrix.len(), 2); // 2 channels
        assert_eq!(matrix[0][0], 1.0); // First coefficient of channel 0
        assert_eq!(matrix[1][0], 4.0); // First coefficient of channel 1
    }
}
