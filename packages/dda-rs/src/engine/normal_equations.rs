//! Normal-equations assembly and solver shared by native CUDA (`gpu.rs`), native wgpu (`gpu_sums.rs`), and browser
//! WebGPU (`blocks.rs`).
//!
//! Every basic DDA flavor fits ordinary least squares on designs built from each window's channels: ST on one
//! channel's model terms T_c and derivative d_c, CT and DE on the stacked rows of a group's channels, and CD and SY
//! on [T_s, T_f] against d_f or d_s. All of their normal equations assemble from per-channel Gram blocks
//! (T_c'T_c, T_c'd_c, d_c'd_c) and, for CD/SY pairs, cross blocks (T_a'T_b, T_a'd_b, T_b'd_a). Each channel's term
//! vectors and derivative are built once per window instead of duplicated per pair or group, and ill-conditioned or
//! near-zero-residual problems fall back to the CPU SVD solver.

use std::collections::HashMap;

use nalgebra::{DMatrix, DVector};

use super::model::ModelSpec;
use super::regression_batch::{BasicJobs, WindowSolutions};
use super::solver::{
    build_directed_regression_window, build_group_regression_window, solve_regression_window,
    SolvedBlock,
};
use super::window::PreparedWindow;

/// Rounding the inputs to 2^-46 of each vector's largest value leaves integer sums a relative error near 1e-13
/// (`sums_match_f64`), which a system's condition multiplies into its coefficients and a fit's cancellation into its
/// error: past these bounds the CPU SVD solves instead.
pub(crate) const MAX_CONDITION: f64 = 1e4;
pub(crate) const MIN_RESIDUAL_SHARE: f64 = 1e-4;
pub(crate) const FRACTION_BITS: i32 = 46;

/// The power of two that brings the largest magnitude of `values` into [1, 2), where 47 bits hold them to 2^-46;
/// scaling by it is exact.
pub(crate) fn scale_of(values: &[f64]) -> f64 {
    let largest = values.iter().fold(0.0_f64, |max, v| max.max(v.abs()));
    if largest > 0.0 {
        2.0_f64.powi(-(largest.log2().floor() as i32))
    } else {
        1.0
    }
}

/// `x` (below 2 in magnitude) rounded to a multiple of 2^-46, as `gpu_sums.wgsl` reads it: limbs 0 and 1 of its
/// magnitude in the first word, limb 2 and the sign (bit 31) in the second.
pub(crate) fn fixed(x: f64) -> [u32; 2] {
    let q = (x * 2.0_f64.powi(FRACTION_BITS)).round() as i64;
    let m = q.unsigned_abs();
    [
        (m & 0xffff_ffff) as u32,
        (m >> 32) as u32 | (u32::from(q < 0) << 31),
    ]
}

/// A sum from `gpu_sums.wgsl`'s 20 words: positive minus negative products, each the five limb positions' low words
/// and carries at weights 2^(16 k), in units of 2^-92.
pub(crate) fn sum_of(words: &[u32]) -> f64 {
    let side = |words: &[u32]| -> i128 {
        (0..5)
            .map(|k| ((words[2 * k + 1] as i128) << 32 | words[2 * k] as i128) << (16 * k))
            .sum()
    };
    (side(&words[..10]) - side(&words[10..])) as f64 * 2.0_f64.powi(-2 * FRACTION_BITS)
}

/// Which dot products one window needs and where each lands. Slot i holds a used channel: vectors i (K + 1) + k are
/// its K model terms and vector i (K + 1) + K its derivative. Per slot come its own sums: the upper triangle of
/// T'T by rows, T'd, d'd; per crossed pair (a < b) T_a'T_b by rows, T_a'd_b, T_b'd_a.
#[derive(Debug, Clone)]
pub(crate) struct Layout {
    pub(crate) terms: usize,
    pub(crate) channels: Vec<usize>,
    /// Slot of each channel, by channel index.
    pub(crate) slot: Vec<usize>,
    pub(crate) own: Vec<usize>,
    pub(crate) cross: HashMap<(usize, usize), usize>,
    /// Unique cross-channel slot pairs `(a, b)` with `a < b`, in deterministic order matching `cross`.
    pub(crate) cross_pairs: Vec<(usize, usize)>,
    pub(crate) pairs: Vec<[u32; 2]>,
}

impl Layout {
    pub(crate) fn new(jobs: &BasicJobs<'_>, terms: usize) -> Self {
        let mut channels: Vec<usize> = jobs
            .st_channels
            .iter()
            .chain(jobs.ct_groups.iter().flatten())
            .chain(jobs.de_groups.iter().flatten())
            .chain(jobs.cd_pairs.iter().flatten())
            .chain(jobs.sy_pairs.iter().flatten())
            .copied()
            .collect();
        channels.sort_unstable();
        channels.dedup();
        let mut slot = vec![usize::MAX; channels.last().map_or(0, |&c| c + 1)];
        for (i, &c) in channels.iter().enumerate() {
            slot[c] = i;
        }
        let vector = |slot: usize, k: usize| (slot * (terms + 1) + k) as u32;
        let mut pairs = Vec::new();
        let mut own = Vec::new();
        for i in 0..channels.len() {
            own.push(pairs.len());
            for k in 0..terms {
                for l in k..terms {
                    pairs.push([vector(i, k), vector(i, l)]);
                }
            }
            pairs.extend((0..terms).map(|k| [vector(i, k), vector(i, terms)]));
            pairs.push([vector(i, terms), vector(i, terms)]);
        }
        let mut cross = HashMap::new();
        let mut cross_pairs = Vec::new();
        for &[x, y] in jobs.cd_pairs.iter().chain(jobs.sy_pairs) {
            let (a, b) = (slot[x.min(y)], slot[x.max(y)]);
            if a == b || cross.contains_key(&(a, b)) {
                continue;
            }
            cross.insert((a, b), pairs.len());
            cross_pairs.push((a, b));
            for k in 0..terms {
                pairs.extend((0..terms).map(|l| [vector(a, k), vector(b, l)]));
            }
            pairs.extend((0..terms).map(|k| [vector(a, k), vector(b, terms)]));
            pairs.extend((0..terms).map(|k| [vector(b, k), vector(a, terms)]));
        }
        Self {
            terms,
            channels,
            slot,
            own,
            cross,
            cross_pairs,
            pairs,
        }
    }

    pub(crate) fn vectors(&self) -> usize {
        self.channels.len() * (self.terms + 1)
    }

    /// T_c[k]'T_c[l].
    fn tt(&self, s: &[f64], c: usize, k: usize, l: usize) -> f64 {
        let (k, l) = (k.min(l), k.max(l));
        let n = self.terms;
        s[self.own[c] + k * n - k * (k + 1) / 2 + l]
    }

    /// T_c[k]'d_c.
    fn td(&self, s: &[f64], c: usize, k: usize) -> f64 {
        let n = self.terms;
        s[self.own[c] + n * (n + 1) / 2 + k]
    }

    fn dd(&self, s: &[f64], c: usize) -> f64 {
        let n = self.terms;
        s[self.own[c] + n * (n + 1) / 2 + n]
    }

    /// Where the cross sums of slots a != b start, and whether (a, b) is the stored pair reversed.
    fn cross_of(&self, a: usize, b: usize) -> (usize, bool) {
        if a < b {
            (self.cross[&(a, b)], false)
        } else {
            (self.cross[&(b, a)], true)
        }
    }

    /// T_a[k]'T_b[l] for the pair `cross_of(a, b)`.
    fn cross_tt(&self, s: &[f64], (base, flipped): (usize, bool), k: usize, l: usize) -> f64 {
        let n = self.terms;
        if flipped {
            s[base + l * n + k]
        } else {
            s[base + k * n + l]
        }
    }

    /// T_a[k]'d_b for the pair `cross_of(a, b)`.
    fn cross_td(&self, s: &[f64], (base, flipped): (usize, bool), k: usize) -> f64 {
        let n = self.terms;
        if flipped {
            s[base + n * n + n + k]
        } else {
            s[base + n * n + k]
        }
    }

    /// The normal equations of a group's stacked rows: X'X, X'y, X'r, r'r and the row count.
    pub(crate) fn group(&self, s: &[f64], channels: &[usize], rows: usize) -> Normal {
        let n = self.terms;
        let mut normal = Normal::zeros(n, rows * channels.len());
        for &channel in channels {
            let c = self.slot[channel];
            for k in 0..n {
                for l in 0..n {
                    normal.gram[(k, l)] += self.tt(s, c, k, l);
                }
                normal.xy[k] += self.td(s, c, k);
            }
            normal.rr += self.dd(s, c);
        }
        normal.xr = normal.xy.clone();
        normal
    }

    /// The normal equations of the fit of `fit`'s derivative on [T_source, T_fit] and its residual on `response`'s
    /// derivative, `build_directed_regression_window`'s columns.
    pub(crate) fn directed(
        &self,
        s: &[f64],
        fit: usize,
        source: usize,
        response: usize,
        rows: usize,
    ) -> Normal {
        let n = self.terms;
        let (f, src, r) = (self.slot[fit], self.slot[source], self.slot[response]);
        // One lookup per problem: (source, fit) for T_s'T_f and T_s'd_f, reversed for T_f'd_s.
        let pair = self.cross_of(src, f);
        let reversed = (pair.0, !pair.1);
        let mut normal = Normal::zeros(2 * n, rows);
        for k in 0..n {
            for l in 0..n {
                normal.gram[(k, l)] = self.tt(s, src, k, l);
                normal.gram[(n + k, n + l)] = self.tt(s, f, k, l);
                normal.gram[(k, n + l)] = self.cross_tt(s, pair, k, l);
                normal.gram[(n + l, k)] = normal.gram[(k, n + l)];
            }
            normal.xy[k] = self.cross_td(s, pair, k);
            normal.xy[n + k] = self.td(s, f, k);
            normal.xr[k] = if r == src {
                self.td(s, src, k)
            } else {
                normal.xy[k]
            };
            normal.xr[n + k] = if r == f {
                normal.xy[n + k]
            } else {
                self.cross_td(s, reversed, k)
            };
        }
        normal.rr = self.dd(s, r);
        normal
    }
}

/// X'X, X'y, X'r and r'r of one least-squares problem with `rows` rows: y the fit target, r the residual target.
pub(crate) struct Normal {
    pub(crate) gram: DMatrix<f64>,
    pub(crate) xy: DVector<f64>,
    pub(crate) xr: DVector<f64>,
    pub(crate) rr: f64,
    pub(crate) rows: usize,
}

impl Normal {
    pub(crate) fn zeros(cols: usize, rows: usize) -> Self {
        Self {
            gram: DMatrix::zeros(cols, cols),
            xy: DVector::zeros(cols),
            xr: DVector::zeros(cols),
            rr: 0.0,
            rows,
        }
    }

    /// The coefficients and fit error, `None` when the sums cannot give the CPU's reliably.
    #[allow(dead_code)]
    pub(crate) fn solve(&self) -> Option<SolvedBlock> {
        self.solve_with_bounds(MAX_CONDITION, MIN_RESIDUAL_SHARE)
    }

    pub(crate) fn solve_with_bounds(
        &self,
        max_condition: f64,
        min_residual_share: f64,
    ) -> Option<SolvedBlock> {
        let cols = self.xy.len();
        // Columns equilibrated to unit norm: X_s = X D with D = diag(1 / |x_j|).
        let norms: Vec<f64> = (0..cols).map(|j| self.gram[(j, j)].sqrt()).collect();
        if norms.iter().any(|&v| !(v.is_finite() && v > 0.0)) {
            return None;
        }
        let scaled = DMatrix::from_fn(cols, cols, |i, j| self.gram[(i, j)] / (norms[i] * norms[j]));
        let eigenvalues = scaled.clone().symmetric_eigen().eigenvalues;
        let (low, high) = eigenvalues
            .iter()
            .fold((f64::INFINITY, 0.0_f64), |(lo, hi), &v| {
                (lo.min(v), hi.max(v))
            });
        if low.is_nan() || low <= 0.0 || high / low > max_condition {
            return None;
        }
        // The CPU's SVD drops singular values of X below max(rows, cols) eps max(sigma_max, 1) (solver.rs), an
        // absolute floor that small-amplitude columns fall under. With X = X_s D^-1, X's singular values lie within
        // those of X_s times the column norms' extremes; a problem the CPU might truncate is left to it.
        let (n_min, n_max) = norms.iter().fold((f64::INFINITY, 0.0_f64), |(lo, hi), &v| {
            (lo.min(v), hi.max(v))
        });
        let truncation = self.rows.max(cols) as f64 * f64::EPSILON * (high.sqrt() * n_max).max(1.0);
        if low.sqrt() * n_min <= 2.0 * truncation {
            return None;
        }
        let rhs = DVector::from_fn(cols, |i, _| self.xy[i] / norms[i]);
        let beta_s = scaled.cholesky()?.solve(&rhs);
        let beta = DVector::from_fn(cols, |i, _| beta_s[i] / norms[i]);
        let rss = self.rr - 2.0 * beta.dot(&self.xr) + beta.dot(&(&self.gram * &beta));
        if rss < min_residual_share * self.rr {
            return None;
        }
        let rmse = (rss / self.rows as f64).sqrt();
        let coefficients: Vec<f64> = beta.iter().copied().collect();
        (coefficients.iter().all(|v| v.is_finite()) && rmse.is_finite())
            .then_some(SolvedBlock { coefficients, rmse })
    }
}

/// One window's vectors scaled and quantized for `gpu_sums.wgsl`, plus the power-of-two scale of each vector;
/// `None` when any used channel has a non-finite sample (left to the CPU).
pub(crate) fn encode_window_fixed(
    window: &PreparedWindow,
    layout: &Layout,
    model: &ModelSpec,
) -> Option<(Vec<[u32; 2]>, Vec<f64>)> {
    let rows = model.window_length;
    let terms = &model.primary_terms;
    let mut data = Vec::with_capacity(layout.vectors() * rows);
    let mut scales = Vec::with_capacity(layout.vectors());
    let mut column = vec![0.0_f64; rows];
    for &channel in &layout.channels {
        let derivative = window.deriv[channel].get(..rows)?;
        for term in terms {
            for (sample, slot) in column.iter_mut().enumerate() {
                let value = term
                    .iter()
                    .map(|&delay| window.shifted[sample + window.max_delay - delay][channel])
                    .product::<f64>();
                if !value.is_finite() {
                    return None;
                }
                *slot = value;
            }
            let scale = scale_of(&column);
            data.extend(column.iter().map(|&v| fixed(v * scale)));
            scales.push(scale);
        }
        if derivative.iter().any(|v| !v.is_finite()) {
            return None;
        }
        let scale = scale_of(derivative);
        data.extend(derivative.iter().map(|&v| fixed(v * scale)));
        scales.push(scale);
    }
    Some((data, scales))
}

/// One window's vectors in native `f64`, column-major per channel slot (`rows * (terms + 1)` per channel);
/// `None` when any used channel has a non-finite sample (left to the CPU).
#[allow(dead_code)]
pub(crate) fn encode_window_f64(
    window: &PreparedWindow,
    layout: &Layout,
    model: &ModelSpec,
) -> Option<Vec<f64>> {
    let rows = model.window_length;
    let terms = &model.primary_terms;
    let mut data = Vec::with_capacity(layout.vectors() * rows);
    for &channel in &layout.channels {
        let derivative = window.deriv[channel].get(..rows)?;
        for term in terms {
            for sample in 0..rows {
                let value = term
                    .iter()
                    .map(|&delay| window.shifted[sample + window.max_delay - delay][channel])
                    .product::<f64>();
                if !value.is_finite() {
                    return None;
                }
                data.push(value);
            }
        }
        if derivative.iter().any(|v| !v.is_finite()) {
            return None;
        }
        data.extend_from_slice(derivative);
    }
    Some(data)
}

/// Unpacks one window's column-major `(K + 1) x (K + 1)` own Gram blocks (`X_c'X_c`) and cross blocks
/// (`X_a'X_b` for each `(a, b)` in `layout.cross_pairs`) into the flat `sums` vector indexed by `layout`.
#[allow(dead_code)]
pub(crate) fn unpack_gram_to_sums(
    own_grams: &[f64],
    cross_grams: &[f64],
    layout: &Layout,
) -> Vec<f64> {
    let n = layout.terms;
    let cols = n + 1;
    let block_stride = cols * cols;
    let mut sums = Vec::with_capacity(layout.pairs.len());
    for c in 0..layout.channels.len() {
        let gram = &own_grams[c * block_stride..(c + 1) * block_stride];
        for k in 0..n {
            for l in k..n {
                sums.push(gram[k + l * cols]);
            }
        }
        for k in 0..n {
            sums.push(gram[k + n * cols]);
        }
        sums.push(gram[n + n * cols]);
    }
    for p in 0..layout.cross_pairs.len() {
        let gram = &cross_grams[p * block_stride..(p + 1) * block_stride];
        for k in 0..n {
            for l in 0..n {
                sums.push(gram[k + l * cols]);
            }
        }
        for k in 0..n {
            sums.push(gram[k + n * cols]);
        }
        for l in 0..n {
            sums.push(gram[n + l * cols]);
        }
    }
    debug_assert_eq!(sums.len(), layout.pairs.len());
    sums
}

/// Unscales one window's `gpu_sums.wgsl` output (20 `u32` words per pair in `layout.pairs`) into `f64` dot products.
pub(crate) fn unscale_fixed_sums(raw_words: &[u32], layout: &Layout, scales: &[f64]) -> Vec<f64> {
    layout
        .pairs
        .iter()
        .zip(raw_words.chunks_exact(20))
        .map(|(&[p, q], words)| sum_of(words) / (scales[p as usize] * scales[q as usize]))
        .collect()
}

/// CPU reference implementation of `gpu_sums.wgsl`: computes the exact 20-word integer accumulators for each
/// window and pair in `pairs`.
pub(crate) fn reference_fixed_sums(
    rows: usize,
    vectors: usize,
    windows: usize,
    pairs: &[[u32; 2]],
    data: &[[u32; 2]],
) -> Vec<u32> {
    let limbs = |v: [u32; 2]| [v[0] & 0xffff, v[0] >> 16, v[1] & 0xffff];
    let merge = |a: [u32; 2], b: [u32; 2]| -> [u32; 2] {
        let (low, carry) = a[0].overflowing_add(b[0]);
        [low, a[1] + b[1] + u32::from(carry)]
    };
    let mut out = vec![0u32; windows * pairs.len() * 20];
    for w in 0..windows {
        for (s, &[p, q]) in pairs.iter().enumerate() {
            let first = (w * vectors + p as usize) * rows;
            let second = (w * vectors + q as usize) * rows;
            let mut acc = [[0u32; 2]; 10];
            for row in 0..rows {
                let a = data[first + row];
                let b = data[second + row];
                let base = if ((a[1] ^ b[1]) >> 31) == 1 { 5 } else { 0 };
                let x = limbs(a);
                let y = limbs(b);
                for i in 0..3 {
                    for j in 0..3 {
                        let k = base + i + j;
                        acc[k] = merge(acc[k], [x[i] * y[j], 0]);
                    }
                }
            }
            let out_base = (w * pairs.len() + s) * 20;
            for k in 0..10 {
                out[out_base + 2 * k] = acc[k][0];
                out[out_base + 2 * k + 1] = acc[k][1];
            }
        }
    }
    out
}

pub(crate) fn count_problems(jobs: &BasicJobs<'_>) -> usize {
    jobs.st_channels.len()
        + jobs.ct_groups.len()
        + if jobs.de_groups == jobs.ct_groups {
            0
        } else {
            jobs.de_groups.len()
        }
        + jobs.cd_pairs.len()
        + 2 * jobs.sy_pairs.len()
}

/// One window's solutions from its sums, the problems it held and how many of them the CPU solved.
pub(crate) fn solve_from_sums(
    window: &PreparedWindow,
    sums: &[f64],
    layout: &Layout,
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
) -> (WindowSolutions, usize, usize) {
    solve_from_sums_with_bounds(
        window,
        sums,
        layout,
        jobs,
        model,
        MAX_CONDITION,
        MIN_RESIDUAL_SHARE,
    )
}

pub(crate) fn solve_from_sums_with_bounds(
    window: &PreparedWindow,
    sums: &[f64],
    layout: &Layout,
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
    max_condition: f64,
    min_residual_share: f64,
) -> (WindowSolutions, usize, usize) {
    let rows = model.window_length;
    let fallbacks = std::cell::Cell::new(0);
    let or_cpu = |normal: Normal, build: &dyn Fn() -> super::solver::RegressionWindow| {
        normal
            .solve_with_bounds(max_condition, min_residual_share)
            .unwrap_or_else(|| {
                fallbacks.set(fallbacks.get() + 1);
                solve_regression_window(&build())
            })
    };
    let group = |channels: &[usize]| {
        or_cpu(layout.group(sums, channels, rows), &|| {
            build_group_regression_window(window, channels, model)
        })
    };
    let directed = |fit: usize, source: usize, response: usize| {
        if fit == source {
            fallbacks.set(fallbacks.get() + 1);
            let problem = build_directed_regression_window(window, fit, source, response, model);
            return solve_regression_window(&problem);
        }
        or_cpu(layout.directed(sums, fit, source, response, rows), &|| {
            build_directed_regression_window(window, fit, source, response, model)
        })
    };
    let mut st = vec![None; jobs.channel_count];
    for &channel in jobs.st_channels {
        st[channel] = Some(group(&[channel]));
    }
    let ct: Vec<SolvedBlock> = jobs.ct_groups.iter().map(|g| group(g)).collect();
    let de = if jobs.de_groups == jobs.ct_groups {
        ct.clone()
    } else {
        jobs.de_groups.iter().map(|g| group(g)).collect()
    };
    let solutions = WindowSolutions {
        st,
        ct,
        de,
        cd: jobs
            .cd_pairs
            .iter()
            .map(|&[target, source]| directed(target, source, target))
            .collect(),
        sy_forward: jobs
            .sy_pairs
            .iter()
            .map(|&[target, source]| directed(target, source, source))
            .collect(),
        sy_reverse: jobs
            .sy_pairs
            .iter()
            .map(|&[left, right]| directed(right, left, left))
            .collect(),
    };
    (solutions, count_problems(jobs), fallbacks.get())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::regression_batch::solve_window_on_cpu;

    /// Verifies that `encode_window_f64` + column-major GEMM Gram blocks (`X_c'X_c` and `X_a'X_b`) +
    /// `unpack_gram_to_sums` + `solve_from_sums` reproduces CPU SVD solutions across ST, CT, DE, CD, and SY.
    #[test]
    fn f64_gram_unpack_and_solve_matches_cpu() {
        let model = ModelSpec {
            dm: 4,
            window_length: 1500,
            window_step: 500,
            max_delay: 10,
            primary_terms: vec![vec![7], vec![10], vec![7, 7, 7, 7]],
        };
        let raw_rows = model.span();
        let channels = 5;
        let mut state = [0.31, 0.47, 0.62, 0.15, 0.83];
        let samples: Vec<Vec<f64>> = (0..raw_rows)
            .map(|t| {
                let previous = state;
                for c in 0..channels {
                    let drive = 0.2 * previous[(c + 1) % channels];
                    state[c] = 3.8 * previous[c] * (1.0 - previous[c]) * 0.8 + drive * 0.25;
                }
                (0..channels)
                    .map(|c| state[c] + 0.01 * ((t * (c + 3)) as f64).sin())
                    .collect()
            })
            .collect();
        let window = PreparedWindow::from_raw(&samples, &model).unwrap();
        let st = [0, 1, 2, 3, 4];
        let ct = [vec![0, 1], vec![2, 3, 4]];
        let cd = [[0, 1], [1, 0], [3, 2]];
        let sy = [[1, 4], [2, 0]];
        let jobs = BasicJobs {
            channel_count: channels,
            st_channels: &st,
            ct_groups: &ct,
            de_groups: &ct,
            cd_pairs: &cd,
            sy_pairs: &sy,
        };
        let layout = Layout::new(&jobs, model.primary_terms.len());
        let vectors = encode_window_f64(&window, &layout, &model).unwrap();
        let rows = model.window_length;
        let cols = layout.terms + 1;

        let dot = |a_slot: usize, b_slot: usize| -> Vec<f64> {
            let a_base = a_slot * cols * rows;
            let b_base = b_slot * cols * rows;
            let mut out = vec![0.0_f64; cols * cols];
            for j in 0..cols {
                for i in 0..cols {
                    let mut s = 0.0;
                    for r in 0..rows {
                        s += vectors[a_base + i * rows + r] * vectors[b_base + j * rows + r];
                    }
                    out[i + j * cols] = s;
                }
            }
            out
        };
        let own_grams: Vec<f64> = (0..layout.channels.len())
            .flat_map(|c| dot(c, c))
            .collect();
        let cross_grams: Vec<f64> = layout
            .cross_pairs
            .iter()
            .flat_map(|&(a, b)| dot(a, b))
            .collect();
        let sums = unpack_gram_to_sums(&own_grams, &cross_grams, &layout);
        let (solved, problems, fallbacks) = solve_from_sums(&window, &sums, &layout, &jobs, &model);
        assert!(fallbacks * 10 < problems, "{fallbacks} of {problems} fell back");

        let cpu = solve_window_on_cpu(&window, &jobs, &model);
        let close = |cpu: &SolvedBlock, gpu: &SolvedBlock| {
            let largest = cpu.coefficients.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
            for (c, g) in cpu.coefficients.iter().zip(&gpu.coefficients) {
                assert!((c - g).abs() <= 1e-12 * largest.max(1.0), "{c} vs {g}");
            }
            assert!(
                (cpu.rmse - gpu.rmse).abs() <= 1e-12 * cpu.rmse.max(1.0),
                "{} vs {}",
                cpu.rmse,
                gpu.rmse
            );
        };
        for (c, g) in cpu.st.iter().flatten().zip(solved.st.iter().flatten()) {
            close(c, g);
        }
        for (c, g) in [
            (&cpu.ct, &solved.ct),
            (&cpu.de, &solved.de),
            (&cpu.cd, &solved.cd),
            (&cpu.sy_forward, &solved.sy_forward),
            (&cpu.sy_reverse, &solved.sy_reverse),
        ] {
            assert_eq!(c.len(), g.len());
            c.iter().zip(g).for_each(|(c, g)| close(c, g));
        }
    }

    /// Verifies `reference_fixed_sums` matches exact f64 dot products to 1e-12.
    #[test]
    fn reference_fixed_sums_matches_f64() {
        let (rows, vectors, windows) = (512, 4, 2);
        let value = |w: usize, v: usize, r: usize| {
            ((w * 7 + v * 13 + r) as f64 * 0.37).sin() * (1.0 + v as f64) / 4.0
        };
        let data: Vec<[u32; 2]> = (0..windows)
            .flat_map(|w| {
                (0..vectors).flat_map(move |v| (0..rows).map(move |r| fixed(value(w, v, r))))
            })
            .collect();
        let pairs: Vec<[u32; 2]> = (0..vectors as u32)
            .flat_map(|p| (p..vectors as u32).map(move |q| [p, q]))
            .collect();
        let words = reference_fixed_sums(rows, vectors, windows, &pairs, &data);
        for w in 0..windows {
            for (s, &[p, q]) in pairs.iter().enumerate() {
                let exact: f64 = (0..rows)
                    .map(|r| value(w, p as usize, r) * value(w, q as usize, r))
                    .sum();
                let base = (w * pairs.len() + s) * 20;
                let got = sum_of(&words[base..base + 20]);
                assert!((got - exact).abs() / exact.abs() < 1e-12);
            }
        }
    }
}
