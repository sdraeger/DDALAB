//! Window blocks: a request's windows split into runs over row blocks. A recording of any size
//! runs in bounded memory. Merged block results equal one whole run bit for bit.

use crate::document::bundle_layout;
use crate::engine::dataset::AnalysisBounds;
use crate::engine::model::ModelSpec;
use crate::engine::variant_config::{resolve_ccd_conditioning_strategy, VariantMode};
use crate::engine::{
    analysis_window_count, run_request_on_device, ComputeDevice, PureRustProgress,
};
use crate::error::{DDAError, Result};
use crate::io::{Reader, RecordingInfo};
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
            marker: (model.span()) as u64,
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

/// Consecutive blocks of the request's windows on `info`'s recording, each as many windows as `budget_bytes` holds
/// and at least one. A block of n windows holds `((n - 1) * step + marker) * channels * 8` bytes of rows of the
/// channels it reads and `n * 3 * window_bytes` of results.
pub fn plan_blocks(
    request: &DDARequest,
    info: &RecordingInfo,
    budget_bytes: usize,
) -> Result<Vec<Block>> {
    check_block_support(request)?;
    let grid = Grid::new(request, info.sample_count)?;
    let (used, _) = localize(request, info.analysis_channels().len());
    let row = used.len().max(1) as u64 * 8;
    // A window's results sit in the engine's matrices, their encoded copy and the ABI frame at once.
    let result = 3 * bundle_layout(request, info, 0)?.window_bytes();
    let first = grid.marker * row + result;
    let more = grid.step * row + result;
    let per_block = 1 + (budget_bytes as u64).saturating_sub(first) / more;
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
    let mut result = run_request_on_device(
        &local,
        &rows,
        Some(&used_labels),
        ComputeDevice::Cpu,
        progress,
    )?;
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

/// What a GPU sums for an ST block (`st_from_sums` solves it): each window's raw rows, masked, differentiated and
/// z-scored as `engine::window` prepares them, give per channel the sums of its least-squares problem.
#[derive(Debug, Clone, Serialize)]
pub struct StGpuPlan {
    /// Columns of the rows: the channels the block reads.
    pub channels: usize,
    pub rows: usize,
    /// The first row of each window's raw stretch of `raw_len` rows.
    pub window_starts: Vec<u32>,
    pub raw_len: u32,
    pub dm: u32,
    pub max_delay: u32,
    pub window_length: u32,
    /// The delays of each model term, `factors` per term, padded with `u32::MAX`.
    pub terms: Vec<u32>,
    pub factors: u32,
    /// Runs of this many equal samples are missing (`NR_EXCLUDE`).
    pub nr_exclude: u32,
}

/// Values per window and channel the sums hold: the valid row count n, the upper triangle of X'X by rows, X'y and
/// y'y, for `terms` model terms.
pub fn st_sum_width(terms: usize) -> usize {
    1 + terms * (terms + 1) / 2 + terms + 1
}

/// The GPU's inputs for `block` and its rows (row-major f32), or `None` when the block runs on the CPU: a variant
/// besides ST, a sample that is not finite, or a last window that passes the end of the recording.
pub fn st_gpu_inputs(
    reader: &dyn Reader,
    request: &DDARequest,
    block: &Block,
) -> Result<Option<(StGpuPlan, Vec<f32>)>> {
    let mode = VariantMode::from_request(request);
    let only_st = mode.st_enabled
        && !(mode.ct_enabled || mode.cd_enabled || mode.de_enabled || mode.sy_mode != 0)
        && request
            .variant_configs
            .as_ref()
            .is_none_or(|c| c.is_empty());
    if !only_st {
        return Ok(None);
    }
    let info = reader.info();
    let grid = Grid::new(request, info.sample_count)?;
    let model = ModelSpec::from_request(request)?;
    let raw_len = model.span();
    let analysis = info.analysis_channels();
    let (used, _) = localize(request, analysis.len());
    let columns: Vec<usize> = used.iter().map(|&i| analysis[i]).collect();
    let rows = (block.row1 - block.row0) as usize;
    let window_starts: Vec<u32> = (block.w0..block.w1)
        .map(|w| (grid.first_row(w) - block.row0) as u32)
        .collect();
    if window_starts.iter().any(|&s| s as usize + raw_len > rows) {
        return Ok(None);
    }
    let data = reader.read_rows(&columns, block.row0, rows)?;
    if data.iter().flatten().any(|v| !v.is_finite()) {
        return Ok(None);
    }
    let factors = model.primary_terms.iter().map(Vec::len).max().unwrap_or(1);
    let terms = model
        .primary_terms
        .iter()
        .flat_map(|t| (0..factors).map(|f| t.get(f).map_or(u32::MAX, |&d| d as u32)))
        .collect();
    let plan = StGpuPlan {
        channels: columns.len(),
        rows,
        window_starts,
        raw_len: raw_len as u32,
        dm: model.dm as u32,
        max_delay: model.max_delay as u32,
        window_length: model.window_length as u32,
        terms,
        factors: factors as u32,
        nr_exclude: crate::engine::NR_EXCLUDE as u32,
    };
    // Each channel less its block mean, in f64: f32 then keeps the signal of a DC-coupled recording (microvolts on
    // tens of millivolts). The z-scores and derivatives of the windows are the same; equal samples stay equal.
    let width = columns.len();
    let means: Vec<f64> = (0..width)
        .map(|c| data.iter().map(|row| row[c]).sum::<f64>() / rows as f64)
        .collect();
    let centered = data
        .iter()
        .flat_map(|row| row.iter().zip(&means).map(|(&v, m)| (v - m) as f32))
        .collect();
    Ok(Some((plan, centered)))
}

/// The coefficients and fit error of one window and channel from its sums: NaN with fewer than 60% valid rows, as
/// the CPU leaves such a window; `None` when X'X is too ill-conditioned for sums kept in f32 to solve it.
fn solve_sums(sums: &[f64], terms: usize, window_length: usize) -> Option<(Vec<f64>, f64)> {
    let n = sums[0];
    if n / window_length as f64 * 100.0 < 60.0 {
        return Some((vec![f64::NAN; terms], f64::NAN));
    }
    let mut at = 1;
    let mut a = nalgebra::DMatrix::<f64>::zeros(terms, terms);
    for i in 0..terms {
        for j in i..terms {
            a[(i, j)] = sums[at];
            a[(j, i)] = sums[at];
            at += 1;
        }
    }
    let b = nalgebra::DVector::from_column_slice(&sums[at..at + terms]);
    let yy = sums[at + terms];
    let cholesky = a.clone().cholesky()?;
    // The pivots of L: their spread squared estimates the condition of X'X. Sums kept in f32 (relative error about
    // 1e-7) then give coefficients to about 1e-3 at worst; a worse-conditioned window runs on the CPU.
    let pivots: Vec<f64> = (0..terms).map(|i| cholesky.l_dirty()[(i, i)]).collect();
    let (lo, hi) = pivots
        .iter()
        .fold((f64::INFINITY, 0f64), |(lo, hi), &p| (lo.min(p), hi.max(p)));
    if lo.is_nan() || lo <= 0.0 || (hi / lo).powi(2) > 1e4 {
        return None;
    }
    let coefficients = cholesky.solve(&b);
    let rss = yy - 2.0 * coefficients.dot(&b) + coefficients.dot(&(&a * &coefficients));
    Some((
        coefficients.iter().copied().collect(),
        (rss.max(0.0) / n).sqrt(),
    ))
}

/// The ST result of `block` from the GPU's `sums` (`st_sum_width` values per window and channel, windows outer): each
/// system solved in f64, and a window the sums cannot solve, with the first window of the block, run on the CPU.
pub fn st_from_sums(
    reader: &dyn Reader,
    request: &DDARequest,
    block: &Block,
    sums: &[f32],
) -> Result<DDAResult> {
    let info = reader.info();
    let model = ModelSpec::from_request(request)?;
    let terms = model.primary_terms.len();
    let width = st_sum_width(terms);
    let analysis = info.analysis_channels();
    let (used, local) = localize(request, analysis.len());
    let windows = block.w1 - block.w0;
    if sums.len() != windows * used.len() * width {
        return Err(DDAError::InvalidParameter(format!(
            "{} sums for {windows} windows of {} channels",
            sums.len(),
            used.len()
        )));
    }
    let cpu = |w: usize| {
        run_block(
            reader,
            request,
            &block_of(request, info.sample_count, w, w + 1)?,
            None,
        )
    };
    // The CPU's first window: the result's labels and markers, and its own values.
    let mut result = cpu(block.w0)?;
    let step = model.window_step as f64;
    // No channels, or an empty list, is every channel, as `localize` reads it.
    let st_rows: Vec<usize> = local
        .channels
        .clone()
        .filter(|c| !c.is_empty())
        .unwrap_or_else(|| (0..used.len()).collect());
    for variant in result.variant_results.iter_mut().flatten() {
        let marker = variant
            .error_values
            .as_ref()
            .and_then(|v| v.first().copied())
            .unwrap_or(f64::NAN);
        variant.error_values = Some((0..windows).map(|w| marker + w as f64 * step).collect());
        for row in &mut variant.q_matrix {
            row.resize(windows, f64::NAN);
        }
        for matrix in variant.coefficient_matrices.iter_mut().flatten() {
            for row in matrix.iter_mut() {
                row.resize(windows, f64::NAN);
            }
        }
        for row in variant.fit_error_matrix.iter_mut().flatten() {
            row.resize(windows, f64::NAN);
        }
    }
    let marker = result
        .error_values
        .as_ref()
        .and_then(|v| v.first().copied())
        .unwrap_or(f64::NAN);
    result.error_values = Some((0..windows).map(|w| marker + w as f64 * step).collect());
    for row in &mut result.q_matrix {
        row.resize(windows, f64::NAN);
    }

    let mut fallbacks = 0usize;
    for w in 1..windows {
        let solved: Option<Vec<(Vec<f64>, f64)>> = st_rows
            .iter()
            .map(|&c| {
                let at = (w * used.len() + c) * width;
                let window: Vec<f64> = sums[at..at + width].iter().map(|&v| v as f64).collect();
                solve_sums(&window, terms, model.window_length)
            })
            .collect();
        let solved = match solved {
            Some(solved) => solved,
            None => {
                fallbacks += 1;
                let exact = cpu(block.w0 + w)?;
                let st = exact
                    .variant_results
                    .iter()
                    .flatten()
                    .find(|v| v.variant_id == "ST");
                st.map(|v| {
                    (0..st_rows.len())
                        .map(|r| {
                            let coefficients = v
                                .coefficient_matrices
                                .iter()
                                .flatten()
                                .map(|m| m[r][0])
                                .collect();
                            (
                                coefficients,
                                v.fit_error_matrix.as_ref().map_or(f64::NAN, |e| e[r][0]),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default()
            }
        };
        for variant in result
            .variant_results
            .iter_mut()
            .flatten()
            .filter(|v| v.variant_id == "ST")
        {
            for (r, (coefficients, rmse)) in solved.iter().enumerate() {
                variant.q_matrix[r][w] = coefficients.first().copied().unwrap_or(f64::NAN);
                for (k, matrix) in variant
                    .coefficient_matrices
                    .iter_mut()
                    .flatten()
                    .enumerate()
                {
                    matrix[r][w] = coefficients.get(k).copied().unwrap_or(f64::NAN);
                }
                if let Some(errors) = variant.fit_error_matrix.as_mut() {
                    errors[r][w] = *rmse;
                }
            }
        }
    }
    if let Some(st) = result
        .variant_results
        .iter()
        .flatten()
        .find(|v| v.variant_id == "ST")
    {
        result.q_matrix = st.q_matrix.clone();
    }
    result.engine_notes.push(format!(
        "ST sums on the GPU in f32, solved in f64; {fallbacks} of {windows} windows in this block ran on the CPU"
    ));
    Ok(result)
}

/// The sums of `plan` on `rows` as the GPU computes them, in f32 with Kahan compensation: the reference the shader
/// (packages/ddalab-web/src/core/webgpu.ts) transliterates, one window and channel per invocation.
pub fn st_sums_reference(plan: &StGpuPlan, rows: &[f32]) -> Vec<f32> {
    let terms = plan.terms.len() / plan.factors as usize;
    let width = st_sum_width(terms);
    let mut out = vec![0f32; plan.window_starts.len() * plan.channels * width];
    for (w, &start) in plan.window_starts.iter().enumerate() {
        for c in 0..plan.channels {
            let sums = st_window_sums(plan, rows, start as usize, c, terms);
            let at = (w * plan.channels + c) * width;
            out[at..at + width].copy_from_slice(&sums);
        }
    }
    out
}

fn st_window_sums(
    plan: &StGpuPlan,
    rows: &[f32],
    start: usize,
    c: usize,
    terms: usize,
) -> Vec<f32> {
    let (dm, max_delay, wl, raw_len) = (
        plan.dm as usize,
        plan.max_delay as usize,
        plan.window_length as usize,
        plan.raw_len as usize,
    );
    let x = |r: usize| rows[(start + r) * plan.channels + c];
    // A sample in a run of nr_exclude or more equal samples of the window is missing.
    let missing = |r: usize| {
        let limit = plan.nr_exclude as usize;
        let mut run = 1;
        let mut i = r;
        while i > 0 && run < limit && x(i - 1) == x(r) {
            run += 1;
            i -= 1;
        }
        let mut i = r;
        while i + 1 < raw_len && run < limit && x(i + 1) == x(r) {
            run += 1;
            i += 1;
        }
        run >= limit
    };
    // z-score over the shifted rows dm..dm + wl + max_delay, the sample deviation.
    let shifted = wl + max_delay;
    let (mut sum, mut count) = (0f32, 0f32);
    for r in dm..dm + shifted {
        if !missing(r) {
            sum += x(r);
            count += 1.0;
        }
    }
    let mean = sum / count;
    let mut square = 0f32;
    for r in dm..dm + shifted {
        if !missing(r) {
            square += (x(r) - mean) * (x(r) - mean);
        }
    }
    let width = st_sum_width(terms);
    let mut acc = vec![0f32; width];
    let mut carry = vec![0f32; width];
    let deviation = (square / (count - 1.0)).sqrt();
    if count < 2.0 || !deviation.is_finite() || deviation == 0.0 {
        return acc; // n = 0: the window is invalid, as the CPU's NaN derivative makes it
    }
    let mut add = |k: usize, value: f32| {
        // Kahan: carry holds what the last addition lost.
        let y = value - carry[k];
        let t = acc[k] + y;
        carry[k] = (t - acc[k]) - y;
        acc[k] = t;
    };
    let mut row = vec![0f32; terms];
    'samples: for i in 0..wl {
        // The derivative at raw row dm + max_delay + i, from the 2 dm samples around it.
        let center = dm + max_delay + i;
        if missing(center) {
            continue;
        }
        let mut derivative = 0f32;
        for s in 1..=dm {
            if missing(center + s) || missing(center - s) {
                continue 'samples;
            }
            derivative += (x(center + s) - x(center - s)) / s as f32;
        }
        let y = derivative / dm as f32 / deviation;
        for (k, value) in row.iter_mut().enumerate() {
            let mut product = 1f32;
            for f in 0..plan.factors as usize {
                let delay = plan.terms[k * plan.factors as usize + f];
                if delay == u32::MAX {
                    break;
                }
                let r = dm + i + max_delay - delay as usize;
                if missing(r) {
                    continue 'samples;
                }
                product *= (x(r) - mean) / deviation;
            }
            *value = product;
        }
        add(0, 1.0);
        let mut at = 1;
        for a in 0..terms {
            for b in a..terms {
                add(at, row[a] * row[b]);
                at += 1;
            }
        }
        for (a, &value) in row.iter().enumerate() {
            add(at + a, value * y);
        }
        add(at + terms, y * y);
    }
    acc
}

#[cfg(test)]
mod gpu_tests {
    use super::*;
    use crate::io::open_matrix;

    /// Two noisy oscillations at 256 Hz, `rows` long, with a flat stretch of 20 samples (a run the engine masks).
    fn recording(rows: usize) -> Box<dyn Reader> {
        offset_recording(rows, 0.0, 1.0)
    }

    /// `recording` scaled by `scale` on a DC offset: a DC-coupled amplifier's microvolts on tens of millivolts.
    fn offset_recording(rows: usize, offset: f64, scale: f64) -> Box<dyn Reader> {
        let data: Vec<f64> = (0..rows)
            .flat_map(|i| {
                let t = i as f64 / 256.0;
                let flat = (300..320).contains(&i);
                let a = if flat {
                    1.0
                } else {
                    (2.0 * std::f64::consts::PI * 9.0 * t).sin() + 0.2 * (i as f64 * 1.3).sin()
                };
                [
                    a,
                    (2.0 * std::f64::consts::PI * 4.0 * t).cos() + 0.1 * (i as f64 * 0.7).cos(),
                ]
            })
            .map(|v| offset + scale * v)
            .collect();
        open_matrix(vec!["A".into(), "B".into()], 256.0, data).unwrap()
    }

    fn request() -> DDARequest {
        serde_json::from_value(serde_json::json!({
            "file_path": "", "channels": [0, 1], "time_range": {"start": 0.0, "end": 4000.0},
            "preprocessing_options": {"highpass": null, "lowpass": null},
            "algorithm_selection": {"enabled_variants": ["ST"]},
            "window_parameters": {"window_length": 200, "window_step": 100},
            "delay_parameters": {"delays": [7, 10]}
        }))
        .unwrap()
    }

    #[test]
    fn sums_solved_in_f64_match_the_cpu() {
        agrees(recording(4096), request());
    }

    #[test]
    fn a_dc_offset_costs_no_precision() {
        agrees(offset_recording(4096, 0.03, 1e-5), request());
    }

    #[test]
    fn an_empty_channel_list_is_every_channel() {
        let mut request = request();
        request.channels = Some(Vec::new());
        agrees(recording(4096), request);
    }

    /// The GPU path's ST result of the first block equals the CPU's to 1e-4, NaNs and markers included.
    fn agrees(reader: Box<dyn Reader>, request: DDARequest) {
        let block = plan_blocks(&request, reader.info(), usize::MAX)
            .unwrap()
            .remove(0);
        let cpu = run_block(&*reader, &request, &block, None).unwrap();
        let (plan, rows) = st_gpu_inputs(&*reader, &request, &block)
            .unwrap()
            .expect("an ST block on finite samples");
        let gpu =
            st_from_sums(&*reader, &request, &block, &st_sums_reference(&plan, &rows)).unwrap();
        let (cpu, gpu) = (
            &cpu.variant_results.unwrap()[0],
            &gpu.variant_results.unwrap()[0],
        );
        assert_eq!(cpu.error_values, gpu.error_values, "the window markers");
        let compare = |a: &Vec<Vec<f64>>, b: &Vec<Vec<f64>>, what: &str| {
            for (ra, rb) in a.iter().zip(b) {
                for (w, (x, y)) in ra.iter().zip(rb).enumerate() {
                    assert!(x.is_nan() == y.is_nan(), "{what} window {w}: {x} vs {y}");
                    if x.is_finite() {
                        assert!(
                            (x - y).abs() <= 1e-4 * x.abs().max(1e-3),
                            "{what} window {w}: {x} vs {y}"
                        );
                    }
                }
            }
        };
        compare(&cpu.q_matrix, &gpu.q_matrix, "q");
        compare(
            cpu.fit_error_matrix.as_ref().unwrap(),
            gpu.fit_error_matrix.as_ref().unwrap(),
            "rmse",
        );
    }

    #[test]
    fn other_variants_stay_on_the_cpu() {
        let reader = recording(4096);
        let mut request = request();
        request.algorithm_selection.enabled_variants = vec!["ST".into(), "CT".into()];
        request.ct_channel_pairs = Some(vec![[0, 1]]);
        let block = plan_blocks(&request, reader.info(), usize::MAX)
            .unwrap()
            .remove(0);
        assert!(st_gpu_inputs(&*reader, &request, &block).unwrap().is_none());
    }
}
