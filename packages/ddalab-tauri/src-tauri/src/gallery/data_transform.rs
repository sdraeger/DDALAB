use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::HashMap;

use crate::models::AnalysisResult;

/// Data payload for a single gallery result page.
/// Embedded as JSON in the generated HTML.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryResultData {
    pub id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub tags: Vec<String>,
    pub file_name: String,
    pub variant_name: String,
    pub variant_display_name: String,
    pub channels: Vec<String>,
    pub created_at: String,
    pub parameters: serde_json::Value,
    pub dda_matrix: HashMap<String, Vec<f64>>,
    pub exponents: HashMap<String, f64>,
    pub quality_metrics: HashMap<String, f64>,
    pub color_range: (f64, f64),
    pub window_indices: Vec<f64>,
    pub thumbnail: Vec<Vec<f64>>,
}

/// Decimate a matrix by stride-sampling to at most `max_cols` columns.
pub fn decimate_matrix(
    matrix: &HashMap<String, Vec<f64>>,
    max_cols: usize,
) -> HashMap<String, Vec<f64>> {
    if matrix.is_empty() {
        return HashMap::new();
    }

    let n_cols = matrix.values().next().map(|v| v.len()).unwrap_or(0);
    if n_cols <= max_cols {
        return matrix.clone();
    }

    let stride = (n_cols as f64 / max_cols as f64).ceil() as usize;
    matrix
        .iter()
        .map(|(key, values)| {
            let decimated: Vec<f64> = values.iter().step_by(stride).copied().collect();
            (key.clone(), decimated)
        })
        .collect()
}

/// Create a tiny thumbnail matrix for the gallery index card.
pub fn decimate_thumbnail(
    matrix: &HashMap<String, Vec<f64>>,
    max_cols: usize,
    max_rows: usize,
) -> Vec<Vec<f64>> {
    if matrix.is_empty() {
        return vec![];
    }

    // Sort channel names for deterministic row order
    let mut keys: Vec<&String> = matrix.keys().collect();
    keys.sort();

    // Take at most max_rows channels
    let row_stride = if keys.len() > max_rows {
        (keys.len() as f64 / max_rows as f64).ceil() as usize
    } else {
        1
    };

    let selected_keys: Vec<&&String> = keys.iter().step_by(row_stride).collect();
    let n_cols = matrix.values().next().map(|v| v.len()).unwrap_or(0);
    let col_stride = if n_cols > max_cols {
        (n_cols as f64 / max_cols as f64).ceil() as usize
    } else {
        1
    };

    selected_keys
        .iter()
        .map(|key| matrix[**key].iter().step_by(col_stride).copied().collect())
        .collect()
}

/// Compute the 2nd and 98th percentile of all values for auto-scaling color range.
pub fn compute_color_range(matrix: &HashMap<String, Vec<f64>>) -> (f64, f64) {
    let mut all_values: Vec<f64> = matrix
        .values()
        .flat_map(|v| v.iter())
        .copied()
        .filter(|v| v.is_finite())
        .collect();

    if all_values.is_empty() {
        return (0.0, 1.0);
    }

    all_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let n = all_values.len();
    let p2_idx = (n as f64 * 0.02).floor() as usize;
    let p98_idx = ((n as f64 * 0.98).floor() as usize).min(n - 1);

    let low = all_values[p2_idx];
    let high = all_values[p98_idx];

    if (high - low).abs() < f64::EPSILON {
        (low - 1.0, high + 1.0)
    } else {
        (low, high)
    }
}

/// Decimate window indices with the same stride as the matrix.
fn decimate_window_indices(indices: &[f64], max_cols: usize) -> Vec<f64> {
    if indices.len() <= max_cols {
        return indices.to_vec();
    }
    let stride = (indices.len() as f64 / max_cols as f64).ceil() as usize;
    indices.iter().step_by(stride).copied().collect()
}

/// Extract DDA result data from an AnalysisResult's plot_data JSON.
///
/// The plot_data JSON has the structure:
/// ```json
/// {
///   "window_indices": [...],
///   "variants": [{
///     "variant_id": "...",
///     "variant_name": "...",
///     "dda_matrix": { "channel": [...] },
///     "exponents": { "channel": 1.23 },
///     "quality_metrics": { "channel": 0.95 }
///   }],
///   "channels": ["ch1", "ch2"]
/// }
/// ```
pub fn serialize_for_gallery(
    analysis: &AnalysisResult,
    title: &str,
    description: &str,
    author: &str,
    tags: &[String],
    max_cols: usize,
) -> Result<GalleryResultData> {
    let plot_data = analysis
        .plot_data
        .as_ref()
        .context("Analysis has no plot_data")?;

    // Extract channels list
    let channels: Vec<String> = plot_data
        .get("channels")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Extract window_indices
    let window_indices: Vec<f64> = plot_data
        .get("window_indices")
        .or_else(|| plot_data.get("scales"))
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // Get the first variant's data (or legacy top-level fields)
    let (dda_matrix, exponents, quality_metrics) = if let Some(variants) = plot_data.get("variants")
    {
        let first = variants.get(0).context("No variants in plot_data")?;
        let matrix: HashMap<String, Vec<f64>> = first
            .get("dda_matrix")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let exps: HashMap<String, f64> = first
            .get("exponents")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let qm: HashMap<String, f64> = first
            .get("quality_metrics")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        (matrix, exps, qm)
    } else {
        // Legacy format: top-level fields
        let matrix: HashMap<String, Vec<f64>> = plot_data
            .get("dda_matrix")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let exps: HashMap<String, f64> = plot_data
            .get("exponents")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let qm: HashMap<String, f64> = plot_data
            .get("quality_metrics")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        (matrix, exps, qm)
    };

    let color_range = compute_color_range(&dda_matrix);
    let decimated_matrix = decimate_matrix(&dda_matrix, max_cols);
    let decimated_indices = decimate_window_indices(&window_indices, max_cols);
    let thumbnail = decimate_thumbnail(&dda_matrix, 50, 10);

    // Extract just the filename from the path
    let file_name = std::path::Path::new(&analysis.file_path)
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(&analysis.file_path)
        .to_string();

    Ok(GalleryResultData {
        id: analysis.id.clone(),
        title: title.to_string(),
        description: description.to_string(),
        author: author.to_string(),
        tags: tags.to_vec(),
        file_name,
        variant_name: analysis.variant_name.clone(),
        variant_display_name: analysis.variant_display_name.clone(),
        channels,
        created_at: analysis.timestamp.clone(),
        parameters: analysis.parameters.clone(),
        dda_matrix: decimated_matrix,
        exponents,
        quality_metrics,
        color_range,
        window_indices: decimated_indices,
        thumbnail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decimate_matrix() {
        let mut matrix = HashMap::new();
        matrix.insert("ch1".to_string(), (0..1000).map(|i| i as f64).collect());
        matrix.insert(
            "ch2".to_string(),
            (0..1000).map(|i| i as f64 * 2.0).collect(),
        );

        let decimated = decimate_matrix(&matrix, 100);
        assert!(decimated["ch1"].len() <= 100);
        assert!(decimated["ch2"].len() <= 100);
        assert_eq!(decimated["ch1"][0], 0.0);
    }

    #[test]
    fn test_decimate_matrix_small() {
        let mut matrix = HashMap::new();
        matrix.insert("ch1".to_string(), vec![1.0, 2.0, 3.0]);

        let decimated = decimate_matrix(&matrix, 100);
        assert_eq!(decimated["ch1"].len(), 3);
    }

    #[test]
    fn test_compute_color_range() {
        let mut matrix = HashMap::new();
        matrix.insert("ch1".to_string(), (0..100).map(|i| i as f64).collect());

        let (low, high) = compute_color_range(&matrix);
        assert!(low >= 0.0);
        assert!(high <= 99.0);
        assert!(low < high);
    }

    #[test]
    fn test_compute_color_range_empty() {
        let matrix: HashMap<String, Vec<f64>> = HashMap::new();
        let (low, high) = compute_color_range(&matrix);
        assert_eq!(low, 0.0);
        assert_eq!(high, 1.0);
    }

    #[test]
    fn test_decimate_thumbnail() {
        let mut matrix = HashMap::new();
        for i in 0..20 {
            matrix.insert(format!("ch{}", i), (0..500).map(|j| j as f64).collect());
        }

        let thumb = decimate_thumbnail(&matrix, 50, 10);
        assert!(thumb.len() <= 10);
        assert!(thumb[0].len() <= 50);
    }
}
