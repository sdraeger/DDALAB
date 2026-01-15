use crate::error::{DDAError, Result};

/// Parsed DDA output containing Q matrix and error values
#[derive(Debug, Clone)]
pub struct ParsedDDAOutput {
    /// Q matrix in [channels × timepoints] format
    pub q_matrix: Vec<Vec<f64>>,
    /// Error/rho values per window (from column 1 of raw output)
    pub error_values: Vec<f64>,
}

/// Parse DDA binary output and return Q matrix and error values
///
/// Based on dda-py _process_output: skip first 2 columns, take every Nth column, then transpose
/// The first 2 columns contain: [0] = window index, [1] = error/rho value
///
/// # Arguments
/// * `content` - Raw text output from run_DDA_AsciiEdf binary
/// * `column_stride` - Optional stride for column extraction (default 4 for ST/CT/DE, use 2 for CD, use 1 for SY)
///
/// # Returns
/// ParsedDDAOutput containing Q matrix and error values
pub fn parse_dda_output_with_error(
    content: &str,
    column_stride: Option<usize>,
) -> Result<ParsedDDAOutput> {
    let (q_matrix, error_values) = parse_dda_output_internal(content, column_stride)?;
    Ok(ParsedDDAOutput {
        q_matrix,
        error_values,
    })
}

/// Parse DDA binary output and return as 2D matrix [channels × timepoints]
/// (Legacy function for backward compatibility)
///
/// Based on dda-py _process_output: skip first 2 columns, take every Nth column, then transpose
///
/// # Arguments
/// * `content` - Raw text output from run_DDA_AsciiEdf binary
/// * `column_stride` - Optional stride for column extraction (default 4 for ST/CT/DE, use 2 for CD, use 1 for SY)
///
/// # Returns
/// Processed matrix in [channels/scales × timepoints] format
pub fn parse_dda_output(content: &str, column_stride: Option<usize>) -> Result<Vec<Vec<f64>>> {
    let (q_matrix, _) = parse_dda_output_internal(content, column_stride)?;
    Ok(q_matrix)
}

/// Parse DDA binary output from byte slice (e.g. mmap)
///
/// This is a zero-copy optimized version of `parse_dda_output_with_error`.
pub fn parse_dda_output_from_bytes(
    content: &[u8],
    column_stride: Option<usize>,
) -> Result<ParsedDDAOutput> {
    let stride = column_stride.unwrap_or(4);

    // We'll collect data into a flat vector first, then reshape/transpose
    // This avoids creating intermediate Vec<Vec<f64>> for rows
    let mut all_values = Vec::new();
    let mut row_count = 0;
    let mut col_count = 0;

    // Helper to parse float from bytes
    // fast_float is faster, but for now standard parse is safer/easier
    fn parse_f64(bytes: &[u8]) -> Option<f64> {
        // Unsafe from_utf8_unchecked is acceptable here as DDA output is strictly ASCII numbers
        // But for safety we use from_utf8 first
        std::str::from_utf8(bytes).ok()?.parse::<f64>().ok()
    }

    let mut start = 0;
    let mut current_row_values = Vec::with_capacity(64); // Pre-allocate for typical row size

    for (i, &byte) in content.iter().enumerate() {
        if byte == b'\n' {
            let line = &content[start..i];
            start = i + 1;

            // Skip comments and empty lines
            if line.is_empty() || line[0] == b'#' || (line.iter().all(|b| b.is_ascii_whitespace()))
            {
                continue;
            }

            // Parse line
            current_row_values.clear();
            let mut val_start = 0;
            let mut in_val = false;

            for (j, &b) in line.iter().enumerate() {
                if b.is_ascii_whitespace() {
                    if in_val {
                        if let Some(val) = parse_f64(&line[val_start..j]) {
                            if val.is_finite() {
                                current_row_values.push(val);
                            }
                        }
                        in_val = false;
                    }
                } else if !in_val {
                    val_start = j;
                    in_val = true;
                }
            }
            // Handle last value in line
            if in_val {
                if let Some(val) = parse_f64(&line[val_start..]) {
                    if val.is_finite() {
                        current_row_values.push(val);
                    }
                }
            }

            if !current_row_values.is_empty() {
                if row_count == 0 {
                    col_count = current_row_values.len();
                } else if current_row_values.len() != col_count {
                    log::warn!(
                        "Row {} has inconsistent column count ({} vs {}), skipping",
                        row_count,
                        current_row_values.len(),
                        col_count
                    );
                    continue;
                }

                all_values.extend_from_slice(&current_row_values);
                row_count += 1;
            }
        }
    }

    // Handle last line if no trailing newline
    if start < content.len() {
        let line = &content[start..];
        if !line.is_empty() && line[0] != b'#' && !line.iter().all(|b| b.is_ascii_whitespace()) {
            current_row_values.clear();
            let mut val_start = 0;
            let mut in_val = false;

            for (j, &b) in line.iter().enumerate() {
                if b.is_ascii_whitespace() {
                    if in_val {
                        if let Some(val) = parse_f64(&line[val_start..j]) {
                            if val.is_finite() {
                                current_row_values.push(val);
                            }
                        }
                        in_val = false;
                    }
                } else if !in_val {
                    val_start = j;
                    in_val = true;
                }
            }
            if in_val {
                if let Some(val) = parse_f64(&line[val_start..]) {
                    if val.is_finite() {
                        current_row_values.push(val);
                    }
                }
            }
            if !current_row_values.is_empty() {
                if row_count == 0 {
                    col_count = current_row_values.len();
                }
                if current_row_values.len() == col_count {
                    all_values.extend_from_slice(&current_row_values);
                    row_count += 1;
                }
            }
        }
    }

    if row_count == 0 {
        return Err(DDAError::ParseError(
            "No valid data found in DDA output".to_string(),
        ));
    }

    // Extract error values (Column 1)
    // Structure of all_values is [row0_col0, row0_col1, ..., row1_col0, ...]
    let error_values: Vec<f64> = (0..row_count)
        .filter_map(|r| {
            let idx = r * col_count + 1; // Column 1
            if idx < all_values.len() {
                Some(all_values[idx])
            } else {
                None
            }
        })
        .collect();

    // Transpose and stride logic
    // Skip first 2 cols, then stride
    let mut q_matrix = Vec::new();

    // Indices relative to the *skipped* portion (cols 2..)
    // Original indices: 2, 2+stride, 2+2*stride...
    let mut start_col = 2;
    while start_col < col_count {
        let mut channel_data = Vec::with_capacity(row_count);
        for r in 0..row_count {
            let idx = r * col_count + start_col;
            if idx < all_values.len() {
                channel_data.push(all_values[idx]);
            }
        }
        q_matrix.push(channel_data);
        start_col += stride;
    }

    Ok(ParsedDDAOutput {
        q_matrix,
        error_values,
    })
}

/// Internal parser that returns both Q matrix and error values
fn parse_dda_output_internal(
    content: &str,
    column_stride: Option<usize>,
) -> Result<(Vec<Vec<f64>>, Vec<f64>)> {
    let stride = column_stride.unwrap_or(4);
    let mut matrix: Vec<Vec<f64>> = Vec::new();

    // Parse the file into a matrix (rows = time windows, columns = various outputs)
    for line in content.lines() {
        // Skip comments and empty lines
        if line.trim().is_empty() || line.trim().starts_with('#') {
            continue;
        }

        // Parse all values in the line
        let values: Vec<f64> = line
            .split_whitespace()
            .filter_map(|s| s.parse::<f64>().ok())
            .filter(|v| v.is_finite())
            .collect();

        if !values.is_empty() {
            matrix.push(values);
        }
    }

    if matrix.is_empty() {
        return Err(DDAError::ParseError(
            "No valid data found in DDA output".to_string(),
        ));
    }

    log::info!(
        "Loaded DDA output shape: {} rows × {} columns",
        matrix.len(),
        matrix[0].len()
    );

    // Log first row for debugging
    if !matrix.is_empty() && matrix[0].len() >= 10 {
        log::debug!(
            "First row sample (first 10 values): {:?}",
            &matrix[0][0..10]
        );
    }

    // Extract error/rho values from column 1 (index 1) before skipping
    // Column 0 = window index, Column 1 = error/rho value
    let error_values: Vec<f64> = matrix
        .iter()
        .filter_map(|row| row.get(1).copied())
        .collect();

    log::info!("Extracted {} error/rho values", error_values.len());

    // Process according to DDA format: skip first 2 columns, then take every 4th column
    // Python does: Q[:, 2:] then Q[:, 1::4]
    // This means: skip first 2, then from remaining take indices 1, 5, 9... = original columns 3, 7, 11...
    if matrix[0].len() > 2 {
        // First, skip first 2 columns to match Python's Q[:, 2:]
        let mut after_skip: Vec<Vec<f64>> = Vec::new();
        for row in &matrix {
            let skipped: Vec<f64> = row.iter().skip(2).copied().collect();
            after_skip.push(skipped);
        }

        log::debug!(
            "After skipping first 2 columns: {} rows × {} columns",
            after_skip.len(),
            after_skip[0].len()
        );

        // Log some values from after_skip to see what we have
        if !after_skip.is_empty() && after_skip[0].len() >= 10 {
            log::debug!(
                "After skip, first row (first 10 values): {:?}",
                &after_skip[0][0..10]
            );
        }

        // Now take every Nth column starting from index 0 (0-indexed from the skipped array)
        // stride=4 for ST/CT: [:, 0::4] which takes indices 0, 4, 8, 12...
        // stride=2 for CD: [:, 0::2] which takes indices 0, 2, 4, 6...
        let mut extracted: Vec<Vec<f64>> = Vec::new();

        for row in &after_skip {
            let mut row_values = Vec::new();
            let mut col_idx = 0; // Start at column index 0 of the already-skipped array
            while col_idx < row.len() {
                row_values.push(row[col_idx]);
                col_idx += stride;
            }
            extracted.push(row_values);
        }

        // Log extracted sample
        if !extracted.is_empty() && extracted[0].len() >= 5 {
            log::debug!(
                "First extracted row sample (first 5 values): {:?}",
                &extracted[0][0..5]
            );
        }

        if extracted.is_empty() || extracted[0].is_empty() {
            return Err(DDAError::ParseError(
                "No data after column extraction".to_string(),
            ));
        }

        let num_rows = extracted.len();
        let num_cols = extracted[0].len();

        log::info!(
            "Extracted matrix shape: {} rows × {} columns (time windows × delays/scales)",
            num_rows,
            num_cols
        );

        // Transpose: convert from [time_windows × scales] to [scales × time_windows]
        // This gives us [channel/scale][timepoint] format expected by frontend
        let mut transposed: Vec<Vec<f64>> = vec![Vec::new(); num_cols];

        for (row_idx, row) in extracted.iter().enumerate() {
            if row.len() != num_cols {
                log::warn!(
                    "Row {} has {} columns, expected {}. Skipping this row.",
                    row_idx,
                    row.len(),
                    num_cols
                );
                continue;
            }
            for (col_idx, &value) in row.iter().enumerate() {
                transposed[col_idx].push(value);
            }
        }

        if transposed.is_empty() || transposed[0].is_empty() {
            return Err(DDAError::ParseError(
                "Transpose resulted in empty data".to_string(),
            ));
        }

        log::info!(
            "Transposed to: {} channels × {} timepoints",
            transposed.len(),
            transposed[0].len()
        );

        Ok((transposed, error_values))
    } else {
        // If we have <= 2 columns, return as single channel
        Ok((vec![matrix.into_iter().flatten().collect()], error_values))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_dda_output_basic() {
        let content = "# Comment line\n\
                       1.0 2.0 3.0 4.0 5.0 6.0\n\
                       7.0 8.0 9.0 10.0 11.0 12.0\n";

        let result = parse_dda_output(content, None).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_parse_empty_content() {
        let content = "# Only comments\n# More comments\n";
        let result = parse_dda_output(content, None);
        assert!(result.is_err());
    }
}
