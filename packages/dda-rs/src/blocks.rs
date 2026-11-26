//! Window blocks: a request's windows split into runs over row blocks. A recording of any size
//! runs in bounded memory. Merged block results equal one whole run bit for bit.

use crate::document::bundle_layout;
use crate::engine::dataset::{AnalysisBounds, MatrixDataset};
use crate::engine::model::ModelSpec;
use crate::engine::normal_equations::{
    count_problems, encode_window_fixed, reference_fixed_sums, solve_from_sums, unscale_fixed_sums,
    Layout,
};
use crate::engine::regression_batch::{solve_window_on_cpu, WindowSolutions};
use crate::engine::variant_config::{resolve_ccd_conditioning_strategy, VariantMode};
use crate::engine::window::PreparedWindow;
use crate::engine::{
    analysis_window_count, prepare_analysis_windows, resolve_basic_plan, run_request_on_device,
    run_request_with_precomputed_basic, ComputeDevice, ExternalGpuBasic, PureRustProgress,
    ResolvedBasicPlan,
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

/// Parameters for `gpu_sums.wgsl` on one block's GPU-eligible windows (ST, CT, DE, CD, SY).
#[derive(Debug, Clone, Serialize)]
pub struct GpuBlockPlan {
    pub rows: u32,
    pub vectors: u32,
    pub windows: u32,
    /// Flat `[p0, q0, p1, q1, ...]` vector index pairs for `gpu_sums.wgsl`.
    pub pairs: Vec<u32>,
}

/// Prepared state for a single block whose basic-flavor normal-equation dot products run externally
/// on `gpu_sums.wgsl` (e.g. browser WebGPU), then finish into a `DDAResult` in `f64` with CPU SVD fallback.
pub struct GpuBlockJob {
    local: DDARequest,
    block: Block,
    labels: Vec<String>,
    used_labels: Vec<String>,
    rows: Vec<Vec<f64>>,
    model: ModelSpec,
    basic_plan: ResolvedBasicPlan,
    layout: Layout,
    prepared_windows: Vec<PreparedWindow>,
    gpu_windows: Vec<usize>,
    scales: Vec<Vec<f64>>,
}

impl GpuBlockJob {
    /// Prepares `block` for `gpu_sums.wgsl`, returning `(job, plan, data_words)` where `data_words`
    /// packs each `[u32; 2]` fixed-point sample as two consecutive `u32` words. Returns `Ok(None)` when
    /// the block has no basic-flavor work for the GPU (e.g. CCD-only or every window contains missing samples).
    pub fn prepare(
        reader: &dyn Reader,
        request: &DDARequest,
        block: &Block,
    ) -> Result<Option<(Self, GpuBlockPlan, Vec<u32>)>> {
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

        let model = ModelSpec::from_request(&local)?;
        let dataset = MatrixDataset::new(&rows, Some(&used_labels))?;
        let bounds = AnalysisBounds::from_request(&local, dataset.rows)?;
        let basic_plan = resolve_basic_plan(&local, dataset.cols);
        let jobs = basic_plan.as_jobs();
        let layout = Layout::new(&jobs, model.primary_terms.len());
        if layout.pairs.is_empty() {
            return Ok(None);
        }

        let prepared_windows = prepare_analysis_windows(&dataset, &bounds, &model)?;
        let mut gpu_windows = Vec::with_capacity(prepared_windows.len());
        let mut scales = Vec::with_capacity(prepared_windows.len());
        let mut data_words = Vec::new();
        for (w, window) in prepared_windows.iter().enumerate() {
            if let Some((encoded, window_scales)) = encode_window_fixed(window, &layout, &model) {
                gpu_windows.push(w);
                scales.push(window_scales);
                data_words.reserve(encoded.len() * 2);
                for [lo, hi] in encoded {
                    data_words.push(lo);
                    data_words.push(hi);
                }
            }
        }
        if gpu_windows.is_empty() {
            return Ok(None);
        }

        let pairs = layout.pairs.iter().flat_map(|&[p, q]| [p, q]).collect();
        let plan = GpuBlockPlan {
            rows: model.window_length as u32,
            vectors: layout.vectors() as u32,
            windows: gpu_windows.len() as u32,
            pairs,
        };
        let job = Self {
            local,
            block: block.clone(),
            labels,
            used_labels,
            rows,
            model,
            basic_plan,
            layout,
            prepared_windows,
            gpu_windows,
            scales,
        };
        Ok(Some((job, plan, data_words)))
    }

    /// Consumes the `gpu_sums.wgsl` output (`20` `u32` words per window-pair) and returns the block's
    /// `DDAResult` in `f64`, falling back to CPU SVD for non-finite or ill-conditioned windows.
    pub fn finish(self, raw_words: &[u32]) -> Result<DDAResult> {
        let pair_count = self.layout.pairs.len();
        let expected = self.gpu_windows.len() * pair_count * 20;
        if raw_words.len() != expected {
            return Err(DDAError::InvalidParameter(format!(
                "expected {expected} u32 words from GPU sums ({} windows x {pair_count} pairs x 20), got {}",
                self.gpu_windows.len(),
                raw_words.len()
            )));
        }

        let mut unscaled: Vec<Option<Vec<f64>>> = vec![None; self.prepared_windows.len()];
        let window_words = pair_count * 20;
        for (gpu_idx, &w) in self.gpu_windows.iter().enumerate() {
            let slice = &raw_words[gpu_idx * window_words..(gpu_idx + 1) * window_words];
            unscaled[w] = Some(unscale_fixed_sums(slice, &self.layout, &self.scales[gpu_idx]));
        }

        let jobs = self.basic_plan.as_jobs();
        let mut solutions: Vec<WindowSolutions> = Vec::with_capacity(self.prepared_windows.len());
        let mut total_problems = 0usize;
        let mut total_fallbacks = 0usize;
        for (window, sums) in self.prepared_windows.iter().zip(&unscaled) {
            let (solved, problems, fallbacks) = match sums {
                Some(sums) => solve_from_sums(window, sums, &self.layout, &jobs, &self.model),
                None => {
                    let solved = solve_window_on_cpu(window, &jobs, &self.model);
                    let problems = count_problems(&jobs);
                    (solved, problems, problems)
                }
            };
            solutions.push(solved);
            total_problems += problems;
            total_fallbacks += fallbacks;
        }

        let precomputed = ExternalGpuBasic {
            solutions,
            problems: total_problems,
            cpu_fallbacks: total_fallbacks,
        };
        let mut result = run_request_with_precomputed_basic(
            &self.local,
            &self.rows,
            Some(&self.used_labels),
            precomputed,
        )?;
        result.channels = self.labels;
        let shift = |values: &mut Option<Vec<f64>>| {
            values
                .iter_mut()
                .flatten()
                .for_each(|v| *v += self.block.row0 as f64);
        };
        shift(&mut result.error_values);
        for variant in result.variant_results.iter_mut().flatten() {
            shift(&mut variant.error_values);
        }
        Ok(result)
    }

    pub fn block(&self) -> &Block {
        &self.block
    }
}

/// CPU reference of `gpu_sums.wgsl` on `(plan, data_words)`: returns the exact 20 `u32` words per window-pair.
pub fn gpu_sums_reference(plan: &GpuBlockPlan, data_words: &[u32]) -> Vec<u32> {
    let pairs: Vec<[u32; 2]> = plan
        .pairs
        .chunks_exact(2)
        .map(|chunk| [chunk[0], chunk[1]])
        .collect();
    let data: Vec<[u32; 2]> = data_words
        .chunks_exact(2)
        .map(|chunk| [chunk[0], chunk[1]])
        .collect();
    reference_fixed_sums(
        plan.rows as usize,
        plan.vectors as usize,
        plan.windows as usize,
        &pairs,
        &data,
    )
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

    fn request(variants: &[&str]) -> DDARequest {
        serde_json::from_value(serde_json::json!({
            "file_path": "", "channels": [0, 1], "time_range": {"start": 0.0, "end": 4000.0},
            "preprocessing_options": {"highpass": null, "lowpass": null},
            "algorithm_selection": {"enabled_variants": variants},
            "window_parameters": {"window_length": 200, "window_step": 100},
            "delay_parameters": {"delays": [7, 10]},
            "ct_channel_pairs": [[0, 1]],
            "cd_channel_pairs": [[0, 1], [1, 0]]
        }))
        .unwrap()
    }

    #[test]
    fn sums_solved_in_f64_match_the_cpu() {
        agrees(recording(4096), request(&["ST"]));
    }

    #[test]
    fn all_basic_flavors_match_the_cpu() {
        agrees(recording(4096), request(&["ST", "CT", "DE", "CD", "SY"]));
    }

    #[test]
    fn a_dc_offset_costs_no_precision() {
        agrees(offset_recording(4096, 0.03, 1e-5), request(&["ST", "CT"]));
    }

    #[test]
    fn an_empty_channel_list_is_every_channel() {
        let mut request = request(&["ST", "SY"]);
        request.channels = Some(Vec::new());
        agrees(recording(4096), request);
    }

    /// The GPU path's result across all enabled basic variants equals the CPU's to 1e-6, NaNs and markers included.
    fn agrees(reader: Box<dyn Reader>, request: DDARequest) {
        let block = plan_blocks(&request, reader.info(), usize::MAX)
            .unwrap()
            .remove(0);
        let cpu = run_block(&*reader, &request, &block, None).unwrap();
        let (job, plan, data) = GpuBlockJob::prepare(&*reader, &request, &block)
            .unwrap()
            .expect("a basic-variant block with finite windows");
        let gpu = job.finish(&gpu_sums_reference(&plan, &data)).unwrap();
        let cpu_variants = cpu.variant_results.unwrap();
        let gpu_variants = gpu.variant_results.unwrap();
        assert_eq!(cpu_variants.len(), gpu_variants.len());
        let compare = |a: &Vec<Vec<f64>>, b: &Vec<Vec<f64>>, what: &str| {
            for (ra, rb) in a.iter().zip(b) {
                for (w, (x, y)) in ra.iter().zip(rb).enumerate() {
                    assert!(x.is_nan() == y.is_nan(), "{what} window {w}: {x} vs {y}");
                    if x.is_finite() {
                        assert!(
                            (x - y).abs() <= 1e-6 * x.abs().max(1e-3),
                            "{what} window {w}: {x} vs {y}"
                        );
                    }
                }
            }
        };
        for (cv, gv) in cpu_variants.iter().zip(&gpu_variants) {
            assert_eq!(cv.variant_id, gv.variant_id);
            assert_eq!(cv.error_values, gv.error_values, "{} markers", cv.variant_id);
            compare(&cv.q_matrix, &gv.q_matrix, &format!("{} q", cv.variant_id));
            if let (Some(ce), Some(ge)) = (&cv.fit_error_matrix, &gv.fit_error_matrix) {
                compare(ce, ge, &format!("{} rmse", cv.variant_id));
            }
        }
    }

    #[test]
    fn ccd_only_stays_on_the_cpu() {
        let reader = recording(4096);
        let req = request(&["CCD"]);
        let block = plan_blocks(&req, reader.info(), usize::MAX)
            .unwrap()
            .remove(0);
        assert!(GpuBlockJob::prepare(&*reader, &req, &block).unwrap().is_none());
    }
}
