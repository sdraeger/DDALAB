use crate::error::{DDAError, Result};

/// Parse DDA binary output and return as 2D matrix [channels × timepoints]
///
/// Based on dda-py _process_output: skip first 2 columns, take every 4th column, then transpose
///
/// # Arguments
/// * `content` - Raw text output from run_DDA_AsciiEdf binary
///
/// # Returns
/// Processed matrix in [channels/scales × timepoints] format
pub fn parse_dda_output(content: &str) -> Result<Vec<Vec<f64>>> {
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

        // Now take every 4th column starting from index 0 (0-indexed from the skipped array)
        // Try index 0 first: [:, 0::4] which takes indices 0, 4, 8, 12...
        let mut extracted: Vec<Vec<f64>> = Vec::new();

        for row in &after_skip {
            let mut row_values = Vec::new();
            let mut col_idx = 0; // Start at column index 0 of the already-skipped array
            while col_idx < row.len() {
                row_values.push(row[col_idx]);
                col_idx += 4;
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

        Ok(transposed)
    } else {
        // If we have <= 2 columns, return as single channel
        Ok(vec![matrix.into_iter().flatten().collect()])
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

        let result = parse_dda_output(content).unwrap();
        assert!(!result.is_empty());
    }

    #[test]
    fn test_parse_empty_content() {
        let content = "# Only comments\n# More comments\n";
        let result = parse_dda_output(content);
        assert!(result.is_err());
    }
}
