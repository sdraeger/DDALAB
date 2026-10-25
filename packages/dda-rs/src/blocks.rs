//! Window blocks: a request's windows split into runs over row blocks. A recording of any size
//! runs in bounded memory. Merged block results equal one whole run bit for bit.

use crate::engine::dataset::AnalysisBounds;
use crate::engine::model::ModelSpec;
use crate::engine::variant_config::{resolve_ccd_conditioning_strategy, VariantMode};
use crate::engine::{analysis_window_count, run_request_on_matrix_with_progress, PureRustProgress};
use crate::error::{DDAError, Result};
use crate::io::Reader;
use crate::types::{CcdConditioningStrategy, DDARequest, DDAResult, TimeRange};
use serde::Serialize;
use std::collections::BTreeSet;

/// Windows `w0..w1` of a request and the recording rows `row0..row1` they read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Block {
    pub w0: usize,
    pub w1: usize,
    pub row0: u64,
    pub row1: u64,
}

/// The request's windows on a recording of `rows_total` rows, as the engine lays them out, in recording rows.
struct Grid {
    start: u64,
    step: u64,
    marker: u64,
    windows: usize,
    rows_total: u64,
}

impl Grid {
    fn new(request: &DDARequest, rows_total: u64) -> Result<Self> {
        let model = ModelSpec::from_request(request)?;
        let (start, bounds) = selection(request, rows_total)?;
        Ok(Self {
            start,
            step: model.window_step as u64,
            marker: (model.window_length + model.max_delay + 2 * model.dm) as u64,
            windows: analysis_window_count(&bounds, &model)?,
            rows_total,
        })
    }

    fn first_row(&self, w0: usize) -> u64 {
        self.start + w0 as u64 * self.step
    }

    /// One past the last row windows `..w1` read; the engine pads a last window that passes EOF.
    fn row_end(&self, w1: usize) -> u64 {
        (self.first_row(w1 - 1) + self.marker).min(self.rows_total)
    }

    fn block(&self, w0: usize, w1: usize) -> Block {
        Block {
            w0,
            w1,
            row0: self.first_row(w0),
            row1: self.row_end(w1),
        }
    }
}

/// The first row of the request's selection on `rows_total` rows, as the engine clamps it, and the engine's
/// `AnalysisBounds` of the selection counted from that row. The bounds see only the rows up to
/// `min(rows_total, end + 2)`: a selection fits wasm32's usize on a recording of any length.
pub(crate) fn selection(request: &DDARequest, rows_total: u64) -> Result<(u64, AnalysisBounds)> {
    let range = &request.time_range;
    let first = (range.start.max(0.0).floor() as u64).min(rows_total.saturating_sub(1));
    let end = match range.end.is_finite() {
        true => (range.end.max(0.0).floor() as u64).saturating_add(2),
        false => u64::MAX,
    };
    let rows = rows_total.min(end.max(first + 1)) - first;
    let rows = usize::try_from(rows).map_err(|_| {
        DDAError::InvalidParameter(format!(
            "a selection of {rows} rows exceeds this platform's usize"
        ))
    })?;
    let mut local = request.clone();
    local.time_range = TimeRange {
        start: range.start - first as f64,
        end: range.end - first as f64,
    };
    Ok((first, AnalysisBounds::from_request(&local, rows)?))
}

/// Refuses highpass or lowpass preprocessing, and a channel index (in `channels`, the CT and CD pairs or a variant
/// config) outside the `analysis_channels` analysis channels, which the engine would index out of bounds.
pub fn validate_request(request: &DDARequest, analysis_channels: usize) -> Result<()> {
    let options = &request.preprocessing_options;
    if options.highpass.is_some() || options.lowpass.is_some() {
        return Err(DDAError::InvalidParameter(
            "pure Rust DDA does not yet implement highpass/lowpass preprocessing".to_string(),
        ));
    }
    let mut copy = request.clone();
    let channels = channel_indices(&mut copy);
    match channels.into_iter().find(|c| **c >= analysis_channels) {
        Some(c) => Err(DDAError::InvalidParameter(format!(
            "channel {c} is out of range for {analysis_channels} analysis channels"
        ))),
        None => Ok(()),
    }
}

/// Every channel index of `request`: `channels`, the CT and CD pairs, and each variant config's selected,
/// conditioning, CT and CD channels.
fn channel_indices(request: &mut DDARequest) -> Vec<&mut usize> {
    fn pairs(pairs: &mut Option<Vec<[usize; 2]>>) -> impl Iterator<Item = &mut usize> {
        pairs.iter_mut().flatten().flatten()
    }
    let mut indices: Vec<&mut usize> = request.channels.iter_mut().flatten().collect();
    indices.extend(pairs(&mut request.ct_channel_pairs));
    indices.extend(pairs(&mut request.cd_channel_pairs));
    for config in request
        .variant_configs
        .iter_mut()
        .flat_map(|c| c.values_mut())
    {
        indices.extend(config.selected_channels.iter_mut().flatten());
        indices.extend(config.conditioning_channels.iter_mut().flatten());
        indices.extend(pairs(&mut config.ct_channel_pairs));
        indices.extend(pairs(&mut config.cd_channel_pairs));
    }
    indices
}

/// The analysis channels `request` reads, ascending, and the request with its channel indices counting in that
/// list. A request without `channels` reads them all, as the engine then falls back to every channel.
fn localize(request: &DDARequest, analysis_channels: usize) -> (Vec<usize>, DDARequest) {
    let mut local = request.clone();
    if request.channels.as_ref().is_none_or(Vec::is_empty) {
        return ((0..analysis_channels).collect(), local);
    }
    let mut indices = channel_indices(&mut local);
    let used: BTreeSet<usize> = indices.iter().map(|c| **c).collect();
    let used: Vec<usize> = used.into_iter().collect();
    for c in &mut indices {
        **c = used.partition_point(|&u| u < **c);
    }
    (used, local)
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
    let budget_rows = budget_bytes as u64 / (channels.max(1) as u64 * 8);
    let per_block = 1 + budget_rows.saturating_sub(grid.marker) / grid.step;
    let per_block = usize::try_from(per_block).unwrap_or(usize::MAX);
    Ok((0..grid.windows)
        .step_by(per_block)
        .map(|w0| grid.block(w0, (w0 + per_block).min(grid.windows)))
        .collect())
}

/// The block of windows `w0..w1`, whatever the budget, with the rows `plan_blocks` gives it.
pub fn block_of(request: &DDARequest, rows_total: u64, w0: usize, w1: usize) -> Result<Block> {
    check_block_support(request)?;
    let grid = Grid::new(request, rows_total)?;
    if w0 >= w1 || w1 > grid.windows {
        return Err(DDAError::InvalidParameter(format!(
            "windows {w0}..{w1} are not a block of this request's {} windows",
            grid.windows
        )));
    }
    Ok(grid.block(w0, w1))
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
    let analysis = info.analysis_channels();
    validate_request(request, analysis.len())?;
    let labels: Vec<String> = analysis
        .iter()
        .map(|&c| info.channels[c].label.clone())
        .collect();
    let (used, mut local) = localize(request, analysis.len());
    let columns: Vec<usize> = used.iter().map(|&i| analysis[i]).collect();
    let used_labels: Vec<String> = used.iter().map(|&i| labels[i].clone()).collect();
    let rows = reader.read_rows(&columns, block.row0, (block.row1 - block.row0) as usize)?;
    let start = (grid.first_row(block.w0) - block.row0) as f64;
    local.time_range = TimeRange {
        start,
        end: start + ((block.w1 - block.w0 - 1) as u64 * grid.step + grid.marker - 2) as f64,
    };
    let mut progress = progress;
    let mut result = run_request_on_matrix_with_progress(&local, &rows, Some(&used_labels), |p| {
        if let Some(callback) = progress.as_deref_mut() {
            callback(p);
        }
    })?;
    result.channels = labels;
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
