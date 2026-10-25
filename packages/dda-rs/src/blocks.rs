//! Window blocks: a request's windows split into runs over row blocks, so a recording of any size
//! runs in bounded memory. Merged block results equal one whole run bit for bit.

use crate::engine::dataset::AnalysisBounds;
use crate::engine::model::ModelSpec;
use crate::engine::variant_config::{resolve_ccd_conditioning_strategy, VariantMode};
use crate::engine::{analysis_window_count, run_request_on_matrix_with_progress, PureRustProgress};
use crate::error::{DDAError, Result};
use crate::io::Reader;
use crate::types::{CcdConditioningStrategy, DDARequest, DDAResult, TimeRange};

/// Windows `w0..w1` of a request and the recording rows `row0..row1` they read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub w0: usize,
    pub w1: usize,
    pub row0: u64,
    pub row1: u64,
}

/// The request's windows on a recording of `rows_total` rows, as the engine lays them out.
struct Grid {
    start: usize,
    step: usize,
    marker: usize,
    windows: usize,
    rows_total: u64,
}

impl Grid {
    fn new(request: &DDARequest, rows_total: u64) -> Result<Self> {
        let rows = usize::try_from(rows_total).map_err(|_| {
            DDAError::InvalidParameter(format!("{rows_total} rows exceed this platform's usize"))
        })?;
        let model = ModelSpec::from_request(request)?;
        let bounds = AnalysisBounds::from_request(request, rows)?;
        Ok(Self {
            start: bounds.start,
            step: model.window_step,
            marker: model.window_length + model.max_delay + 2 * model.dm,
            windows: analysis_window_count(&bounds, &model)?,
            rows_total,
        })
    }

    fn first_row(&self, w0: usize) -> u64 {
        (self.start + w0 * self.step) as u64
    }

    /// One past the last row windows `..w1` read; the engine pads a last window that passes EOF.
    fn row_end(&self, w1: usize) -> u64 {
        ((self.start + (w1 - 1) * self.step + self.marker) as u64).min(self.rows_total)
    }
}

/// Refuses requests with a variant that reads every window at once.
pub fn check_block_support(request: &DDARequest) -> Result<()> {
    let mode = VariantMode::from_request(request);
    let ccd = mode.ccd_enabled
        || mode.ccdlog_enabled
        || mode.ccdpr2_enabled
        || mode.ccdsig_enabled
        || mode.mvccd_enabled;
    let auto_conditioning =
        ccd && resolve_ccd_conditioning_strategy(request) != CcdConditioningStrategy::AllSelected;
    let refused = [
        (mode.trccd_enabled, "TRCCD"),
        (mode.ccdstab_enabled, "CCDSTAB"),
        (auto_conditioning, "Automatic CCD conditioning"),
    ]
    .into_iter()
    .find_map(|(enabled, name)| enabled.then_some(name));
    match refused {
        Some(name) => Err(DDAError::InvalidParameter(format!(
            "{name} reads every window at once; run this request whole with the CLI"
        ))),
        None => Ok(()),
    }
}

/// Consecutive blocks of the request's windows, each as many windows as `budget_bytes` holds at
/// `(row1 - row0) * channels * 8` bytes and at least one.
pub fn plan_blocks(
    request: &DDARequest,
    rows_total: u64,
    channels: usize,
    budget_bytes: usize,
) -> Result<Vec<Block>> {
    check_block_support(request)?;
    let grid = Grid::new(request, rows_total)?;
    let budget_rows = budget_bytes / (channels.max(1) * 8);
    let per_block = 1 + budget_rows.saturating_sub(grid.marker) / grid.step;
    Ok((0..grid.windows)
        .step_by(per_block)
        .map(|w0| {
            let w1 = (w0 + per_block).min(grid.windows);
            Block {
                w0,
                w1,
                row0: grid.first_row(w0),
                row1: grid.row_end(w1),
            }
        })
        .collect())
}

/// Runs the request's windows `block.w0..block.w1` on the analysis channels' rows `block.row0..block.row1`;
/// `error_values` hold recording rows, as in a whole run.
/// The progress callback numbers windows within the block.
pub fn run_block(
    reader: &dyn Reader,
    request: &DDARequest,
    block: &Block,
    progress: Option<&mut dyn FnMut(&PureRustProgress)>,
) -> Result<DDAResult> {
    let info = reader.info();
    check_block_support(request)?;
    let grid = Grid::new(request, info.sample_count)?;
    let fits = block.w0 < block.w1
        && block.w1 <= grid.windows
        && block.row0 <= grid.first_row(block.w0)
        && block.row1 >= grid.row_end(block.w1);
    if !fits {
        return Err(DDAError::InvalidParameter(format!(
            "{block:?} is not a block of this request's {} windows",
            grid.windows
        )));
    }
    let channels = info.analysis_channels();
    let labels: Vec<String> = channels
        .iter()
        .map(|&c| info.channels[c].label.clone())
        .collect();
    let rows = reader.read_rows(&channels, block.row0, (block.row1 - block.row0) as usize)?;
    let start = (grid.first_row(block.w0) - block.row0) as f64;
    let mut local = request.clone();
    local.time_range = TimeRange {
        start,
        end: start + ((block.w1 - block.w0 - 1) * grid.step + grid.marker - 2) as f64,
    };
    let mut progress = progress;
    let mut result = run_request_on_matrix_with_progress(&local, &rows, Some(&labels), |p| {
        if let Some(callback) = progress.as_deref_mut() {
            callback(p);
        }
    })?;
    let shift = |values: &mut Option<Vec<f64>>| {
        values
            .iter_mut()
            .flatten()
            .for_each(|v| *v += block.row0 as f64);
    };
    shift(&mut result.error_values);
    for variant in result.variant_results.iter_mut().flatten() {
        shift(&mut variant.error_values);
    }
    Ok(result)
}

/// Concatenates the block results of one request, in window order, along the window axis.
pub fn merge_blocks(parts: Vec<DDAResult>) -> Result<DDAResult> {
    let mut parts = parts.into_iter();
    let mut merged = parts.next().ok_or_else(|| {
        DDAError::InvalidParameter("merge_blocks needs at least one block result".to_string())
    })?;
    for part in parts {
        let mismatch =
            || DDAError::InvalidParameter("block results come from different requests".to_string());
        let variants = merged.variant_results.as_deref_mut().unwrap_or_default();
        let more = part.variant_results.unwrap_or_default();
        if variants.len() != more.len() {
            return Err(mismatch());
        }
        for (variant, more) in variants.iter_mut().zip(more) {
            if variant.variant_id != more.variant_id
                || variant.q_matrix.len() != more.q_matrix.len()
            {
                return Err(mismatch());
            }
            append(&mut variant.q_matrix, more.q_matrix);
            for (matrix, more) in variant
                .coefficient_matrices
                .iter_mut()
                .flatten()
                .zip(more.coefficient_matrices.into_iter().flatten())
            {
                append(matrix, more);
            }
            if let (Some(errors), Some(more)) =
                (&mut variant.fit_error_matrix, more.fit_error_matrix)
            {
                append(errors, more);
            }
            if let (Some(values), Some(more)) = (&mut variant.error_values, more.error_values) {
                values.extend(more);
            }
        }
        append(&mut merged.q_matrix, part.q_matrix);
        if let (Some(values), Some(more)) = (&mut merged.error_values, part.error_values) {
            values.extend(more);
        }
        for note in part.engine_notes {
            if !merged.engine_notes.contains(&note) {
                merged.engine_notes.push(note);
            }
        }
    }
    Ok(merged)
}

fn append(rows: &mut [Vec<f64>], more: Vec<Vec<f64>>) {
    for (row, more) in rows.iter_mut().zip(more) {
        row.extend(more);
    }
}
