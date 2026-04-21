use crate::error::{DDAError, Result};
use crate::types::DDARequest;

#[derive(Debug, Clone)]
pub(crate) struct MatrixDataset<'a> {
    pub(crate) samples: &'a [Vec<f64>],
    pub(crate) rows: usize,
    pub(crate) cols: usize,
    pub(crate) channel_labels: Vec<String>,
}

impl<'a> MatrixDataset<'a> {
    pub(crate) fn new(samples: &'a [Vec<f64>], channel_labels: Option<&[String]>) -> Result<Self> {
        if samples.is_empty() {
            return Err(DDAError::InvalidParameter(
                "Pure Rust DDA engine requires at least one sample row".to_string(),
            ));
        }
        let cols = samples[0].len();
        if cols == 0 {
            return Err(DDAError::InvalidParameter(
                "Pure Rust DDA engine requires at least one channel".to_string(),
            ));
        }
        for (row_idx, row) in samples.iter().enumerate() {
            if row.len() != cols {
                return Err(DDAError::InvalidParameter(format!(
                    "Sample row {} has {} columns but row 0 has {}",
                    row_idx,
                    row.len(),
                    cols
                )));
            }
        }
        let labels = channel_labels
            .map(|labels| labels.to_vec())
            .filter(|labels| labels.len() == cols)
            .unwrap_or_else(|| (0..cols).map(|index| format!("Ch {}", index)).collect());

        Ok(Self {
            samples,
            rows: samples.len(),
            cols,
            channel_labels: labels,
        })
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AnalysisBounds {
    pub(crate) start: usize,
    pub(crate) len: usize,
}

impl AnalysisBounds {
    pub(crate) fn from_request(request: &DDARequest, row_count: usize) -> Result<Self> {
        if row_count == 0 {
            return Err(DDAError::InvalidParameter(
                "Input sample matrix is empty".to_string(),
            ));
        }
        let start = request.time_range.start.max(0.0).floor() as usize;
        let end = if request.time_range.end.is_finite() {
            request.time_range.end.max(0.0).floor() as usize
        } else {
            row_count.saturating_sub(1)
        };
        let clamped_start = start.min(row_count.saturating_sub(1));
        let clamped_end = end.min(row_count.saturating_sub(1)).max(clamped_start);
        Ok(Self {
            start: clamped_start,
            len: clamped_end - clamped_start + 1,
        })
    }
}
