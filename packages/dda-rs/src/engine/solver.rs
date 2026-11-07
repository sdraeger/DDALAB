use nalgebra::{DMatrix, DVector};
use rayon::prelude::*;

use super::{model::ModelSpec, window::PreparedWindow, PARALLEL_BATCH_MIN_LEN};

#[derive(Debug, Clone)]
pub(crate) struct SolvedBlock {
    pub(crate) coefficients: Vec<f64>,
    pub(crate) rmse: f64,
}

impl SolvedBlock {
    pub(crate) fn nan(feature_count: usize) -> Self {
        Self {
            coefficients: vec![f64::NAN; feature_count],
            rmse: f64::NAN,
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RegressionWindow {
    pub(crate) rows: usize,
    pub(crate) cols: usize,
    pub(crate) flat_design: Vec<f64>,
    pub(crate) fit_target: Vec<f64>,
    pub(crate) residual_target: Vec<f64>,
}

impl RegressionWindow {
    pub(crate) fn invalid(feature_count: usize) -> Self {
        Self {
            rows: 0,
            cols: feature_count,
            flat_design: Vec::new(),
            fit_target: Vec::new(),
            residual_target: Vec::new(),
        }
    }
}

#[derive(Clone, Copy)]
enum InputSource<'a> {
    Channel(usize),
    Series(&'a [f64]),
}

fn channel_input_sources(channels: &[usize]) -> Vec<InputSource<'_>> {
    channels.iter().copied().map(InputSource::Channel).collect()
}

pub(crate) fn solve_channels_parallel<T, R, F>(items: &[T], solve: F) -> Vec<R>
where
    T: Sync,
    R: Send,
    F: Fn(&T) -> R + Sync + Send,
{
    if items.len() >= PARALLEL_BATCH_MIN_LEN {
        items.par_iter().map(solve).collect()
    } else {
        items.iter().map(solve).collect()
    }
}

pub(crate) fn solve_zipped_parallel<A, B, R, F>(left: &[A], right: &[B], solve: F) -> Vec<R>
where
    A: Sync,
    B: Sync,
    R: Send,
    F: Fn((&A, &B)) -> R + Sync + Send,
{
    if left.len().min(right.len()) >= PARALLEL_BATCH_MIN_LEN {
        left.par_iter().zip(right.par_iter()).map(solve).collect()
    } else {
        left.iter().zip(right.iter()).map(solve).collect()
    }
}

pub(crate) fn solve_group_block(
    prepared: &PreparedWindow,
    channels: &[usize],
    model: &ModelSpec,
) -> SolvedBlock {
    let window = build_group_regression_window(prepared, channels, model);
    solve_regression_window(&window)
}

pub(crate) fn build_group_regression_window(
    prepared: &PreparedWindow,
    channels: &[usize],
    model: &ModelSpec,
) -> RegressionWindow {
    let model_terms = &model.primary_terms;
    let window_length = model.window_length;
    let total_points = channels.len() * window_length;
    if total_points == 0 {
        return RegressionWindow::invalid(model_terms.len());
    }

    let feature_count = model_terms.len();
    let mut flat_design = Vec::with_capacity(total_points * feature_count);
    let mut target = Vec::with_capacity(total_points);
    let mut valid_rows = 0usize;
    for &channel in channels {
        for sample in 0..window_length {
            let target_value = prepared.deriv[channel][sample];
            if target_value.is_nan() {
                continue;
            }
            let row_start = flat_design.len();
            let mut valid = true;
            for term in model_terms {
                let value =
                    evaluate_term(&prepared.shifted, channel, sample, prepared.max_delay, term);
                if value.is_nan() {
                    valid = false;
                    break;
                }
                flat_design.push(value);
            }
            if valid {
                target.push(target_value);
                valid_rows += 1;
            } else {
                flat_design.truncate(row_start);
            }
        }
    }

    if (valid_rows as f64) / (total_points as f64) * 100.0 < 60.0 {
        return RegressionWindow::invalid(feature_count);
    }

    RegressionWindow {
        rows: valid_rows,
        cols: feature_count,
        flat_design,
        fit_target: target.clone(),
        residual_target: target,
    }
}

fn build_channel_regression_window(
    prepared: &PreparedWindow,
    fit_channel: usize,
    response_channel: usize,
    input_sources: &[InputSource<'_>],
    model: &ModelSpec,
) -> RegressionWindow {
    let primary_terms = &model.primary_terms;
    let secondary_terms = &model.primary_terms;
    let window_length = model.window_length;
    let feature_count = primary_terms.len() + input_sources.len() * secondary_terms.len();
    let mut flat_design = Vec::with_capacity(window_length * feature_count);
    let mut fit_target = Vec::with_capacity(window_length);
    let mut residual_target = Vec::with_capacity(window_length);
    let mut valid_rows = 0usize;

    for sample in 0..window_length {
        let fit_value = prepared.deriv[fit_channel][sample];
        if fit_value.is_nan() {
            continue;
        }
        let row_start = flat_design.len();
        let mut valid = true;
        for source in input_sources {
            for term in secondary_terms {
                let value = evaluate_input_term(
                    &prepared.shifted,
                    source,
                    sample,
                    prepared.max_delay,
                    term,
                );
                if value.is_nan() {
                    valid = false;
                    break;
                }
                flat_design.push(value);
            }
            if !valid {
                break;
            }
        }
        if !valid {
            flat_design.truncate(row_start);
            continue;
        }
        for term in primary_terms {
            let value = evaluate_term(
                &prepared.shifted,
                fit_channel,
                sample,
                prepared.max_delay,
                term,
            );
            if value.is_nan() {
                valid = false;
                break;
            }
            flat_design.push(value);
        }
        if valid {
            fit_target.push(fit_value);
            residual_target.push(prepared.deriv[response_channel][sample]);
            valid_rows += 1;
        } else {
            flat_design.truncate(row_start);
        }
    }

    if (valid_rows as f64) / (window_length as f64) * 100.0 < 60.0 {
        return RegressionWindow::invalid(feature_count);
    }

    RegressionWindow {
        rows: valid_rows,
        cols: feature_count,
        flat_design,
        fit_target,
        residual_target,
    }
}

pub(crate) fn build_directed_regression_window(
    prepared: &PreparedWindow,
    primary_channel: usize,
    secondary_channel: usize,
    response_channel: usize,
    model: &ModelSpec,
) -> RegressionWindow {
    let input_sources = [InputSource::Channel(secondary_channel)];
    build_channel_regression_window(
        prepared,
        primary_channel,
        response_channel,
        &input_sources,
        model,
    )
}

pub(crate) fn solve_directed_pair(
    prepared: &PreparedWindow,
    primary_channel: usize,
    secondary_channel: usize,
    response_channel: usize,
    model: &ModelSpec,
) -> SolvedBlock {
    let window = build_directed_regression_window(
        prepared,
        primary_channel,
        secondary_channel,
        response_channel,
        model,
    );
    solve_regression_window(&window)
}

pub(crate) fn solve_channel_with_inputs(
    prepared: &PreparedWindow,
    target_channel: usize,
    input_channels: &[usize],
    model: &ModelSpec,
) -> SolvedBlock {
    let input_sources = channel_input_sources(input_channels);
    let window = build_channel_regression_window(
        prepared,
        target_channel,
        target_channel,
        &input_sources,
        model,
    );
    solve_regression_window(&window)
}

/// `target_channel`'s fit with the `confounds` channels and a surrogate `source` series as inputs, in that order.
pub(crate) fn solve_channel_with_surrogate_inputs(
    prepared: &PreparedWindow,
    target_channel: usize,
    confounds: &[usize],
    source: &[f64],
    model: &ModelSpec,
) -> SolvedBlock {
    let input_sources = confounds
        .iter()
        .map(|&channel| InputSource::Channel(channel))
        .chain([InputSource::Series(source)])
        .collect::<Vec<_>>();
    let window = build_channel_regression_window(
        prepared,
        target_channel,
        target_channel,
        &input_sources,
        model,
    );
    solve_regression_window(&window)
}

pub(crate) fn build_channel_regression_window_with_inputs(
    prepared: &PreparedWindow,
    target_channel: usize,
    input_channels: &[usize],
    model: &ModelSpec,
) -> RegressionWindow {
    let input_sources = channel_input_sources(input_channels);
    build_channel_regression_window(
        prepared,
        target_channel,
        target_channel,
        &input_sources,
        model,
    )
}

pub(crate) fn solve_regression_window(window: &RegressionWindow) -> SolvedBlock {
    solve_least_squares_from_flat(
        &window.flat_design,
        window.rows,
        window.cols,
        &window.fit_target,
        &window.residual_target,
    )
}

/// Least squares over consecutive windows with a penalty `lambda` on the change of every coefficient between
/// neighbours: minimizes sum_w |y_w - X_w b_w|^2 + lambda sum_w |b_{w+1} - b_w|^2. Its normal equations are block
/// tridiagonal (blocks X_w'X_w plus lambda times each window's neighbour count, coupled by -lambda I), solved by
/// block Cholesky in O(W p^3) time and O(W p^2) memory; a system that is not positive definite (a coefficient no
/// window determines) falls back to the SVD of the assembled matrix, which gives the minimum-norm solution.
pub(crate) fn solve_temporally_regularized_windows(
    windows: &[RegressionWindow],
    lambda: f64,
) -> Vec<SolvedBlock> {
    if windows.is_empty() {
        return Vec::new();
    }
    let cols = windows[0].cols;
    if cols == 0 {
        return vec![SolvedBlock::nan(cols); windows.len()];
    }
    let count = windows.len();
    let (mut diagonal, rhs): (Vec<DMatrix<f64>>, Vec<DVector<f64>>) = windows
        .iter()
        .map(|window| {
            if window.rows == 0 {
                return (DMatrix::zeros(cols, cols), DVector::zeros(cols));
            }
            let a = DMatrix::from_row_slice(window.rows, cols, &window.flat_design);
            let y = DVector::from_column_slice(&window.fit_target);
            (a.transpose() * &a, a.transpose() * &y)
        })
        .unzip();
    if lambda > 0.0 {
        for (window_idx, block) in diagonal.iter_mut().enumerate() {
            let neighbours = usize::from(window_idx > 0) + usize::from(window_idx + 1 < count);
            for d in 0..cols {
                block[(d, d)] += lambda * neighbours as f64;
            }
        }
    }
    let coefficients = block_tridiagonal_solve(&diagonal, &rhs, lambda)
        .unwrap_or_else(|| dense_regularized_solve(&diagonal, &rhs, lambda));

    windows
        .iter()
        .zip(coefficients)
        .map(|(window, coefficients)| {
            if window.rows == 0 {
                return SolvedBlock::nan(cols);
            }
            let a = DMatrix::from_row_slice(window.rows, cols, &window.flat_design);
            let prediction = &a * &coefficients;
            SolvedBlock {
                coefficients: coefficients.iter().copied().collect(),
                rmse: residual_rmse(&window.residual_target, &prediction),
            }
        })
        .collect()
}

/// The solution of the block tridiagonal system with diagonal blocks `diagonal` and off-diagonal blocks -lambda I,
/// by block Cholesky: S_0 = D_0, S_w = D_w - lambda^2 S_{w-1}^-1, forward r_w = b_w + lambda S_{w-1}^-1 r_{w-1}, back
/// x_w = S_w^-1 (r_w + lambda x_{w+1}). `None` when a Schur complement S_w is not positive definite.
fn block_tridiagonal_solve(
    diagonal: &[DMatrix<f64>],
    rhs: &[DVector<f64>],
    lambda: f64,
) -> Option<Vec<DVector<f64>>> {
    let mut factors: Vec<nalgebra::Cholesky<f64, nalgebra::Dyn>> =
        Vec::with_capacity(diagonal.len());
    let mut reduced: Vec<DVector<f64>> = Vec::with_capacity(diagonal.len());
    for (block, b) in diagonal.iter().zip(rhs) {
        let (schur, r) = match factors.last() {
            None => (block.clone(), b.clone()),
            Some(previous) => {
                let inverse = previous.inverse();
                let carried = previous.solve(reduced.last()?);
                (block - &inverse * (lambda * lambda), b + carried * lambda)
            }
        };
        let factor = schur.cholesky()?;
        // A near-singular block (a coefficient no window pins down) passes Cholesky with huge, meaningless values;
        // the spread of L's diagonal squared bounds its condition, and past 1e12 the SVD's minimum-norm answer is
        // the one to give.
        let (low, high) = factor
            .l_dirty()
            .diagonal()
            .iter()
            .fold((f64::INFINITY, 0.0_f64), |(lo, hi), &v| {
                (lo.min(v), hi.max(v))
            });
        if low.is_nan() || low <= 0.0 || (high / low).powi(2) > 1e12 {
            return None;
        }
        factors.push(factor);
        reduced.push(r);
    }
    let mut solution: Vec<DVector<f64>> = vec![DVector::zeros(0); diagonal.len()];
    for w in (0..diagonal.len()).rev() {
        let r = match solution.get(w + 1) {
            Some(next) if w + 1 < diagonal.len() => &reduced[w] + next * lambda,
            _ => reduced[w].clone(),
        };
        solution[w] = factors[w].solve(&r);
    }
    solution
        .iter()
        .flatten()
        .all(|v| v.is_finite())
        .then_some(solution)
}

/// The same system assembled whole and solved by SVD: the fallback for a singular one.
fn dense_regularized_solve(
    diagonal: &[DMatrix<f64>],
    rhs: &[DVector<f64>],
    lambda: f64,
) -> Vec<DVector<f64>> {
    let cols = rhs[0].len();
    let total = diagonal.len() * cols;
    let mut normal = DMatrix::<f64>::zeros(total, total);
    let mut stacked = DVector::<f64>::zeros(total);
    for (w, (block, b)) in diagonal.iter().zip(rhs).enumerate() {
        normal
            .view_mut((w * cols, w * cols), (cols, cols))
            .copy_from(block);
        stacked.rows_mut(w * cols, cols).copy_from(b);
        if w + 1 < diagonal.len() {
            for d in 0..cols {
                normal[(w * cols + d, (w + 1) * cols + d)] = -lambda;
                normal[((w + 1) * cols + d, w * cols + d)] = -lambda;
            }
        }
    }
    let solution = svd_solve(&normal, &stacked);
    (0..diagonal.len())
        .map(|w| solution.rows(w * cols, cols).clone_owned())
        .collect()
}

fn solve_least_squares_from_flat(
    flat_design: &[f64],
    rows: usize,
    cols: usize,
    fit_target: &[f64],
    residual_target: &[f64],
) -> SolvedBlock {
    if rows == 0 || cols == 0 {
        return SolvedBlock::nan(cols);
    }
    let a = DMatrix::from_row_slice(rows, cols, flat_design);
    let y = DVector::from_column_slice(fit_target);
    let coefficients = svd_solve(&a, &y);
    let prediction = &a * &coefficients;
    SolvedBlock {
        coefficients: coefficients.iter().copied().collect(),
        rmse: residual_rmse(residual_target, &prediction),
    }
}

fn residual_rmse(target: &[f64], prediction: &DVector<f64>) -> f64 {
    let residual_sum = target
        .iter()
        .zip(prediction.iter())
        .map(|(target, prediction)| {
            let delta = target - prediction;
            delta * delta
        })
        .sum::<f64>();
    (residual_sum / target.len() as f64).sqrt()
}

fn svd_solve(matrix: &DMatrix<f64>, rhs: &DVector<f64>) -> DVector<f64> {
    // svd() iterates without limit; same tolerance (5 eps) but a window that doesn't
    // converge becomes NaN
    let Some(svd) = matrix
        .clone()
        .try_svd(true, true, 5.0 * f64::EPSILON, 10_000)
    else {
        return DVector::from_element(matrix.ncols(), f64::NAN);
    };
    let sigma_max = svd.singular_values.iter().copied().fold(0.0_f64, f64::max);
    let tolerance = (matrix.nrows().max(matrix.ncols()) as f64) * f64::EPSILON * sigma_max.max(1.0);
    svd.solve(rhs, tolerance)
        .unwrap_or_else(|_| DVector::from_element(matrix.ncols(), f64::NAN))
}

fn evaluate_term(
    shifted: &[Vec<f64>],
    channel: usize,
    sample: usize,
    max_delay: usize,
    delays: &[usize],
) -> f64 {
    let mut product = 1.0;
    for &delay in delays {
        let shifted_row = sample + max_delay.saturating_sub(delay);
        let value = shifted[shifted_row][channel];
        if value.is_nan() {
            return f64::NAN;
        }
        product *= value;
    }
    product
}

fn evaluate_input_term(
    shifted: &[Vec<f64>],
    input: &InputSource<'_>,
    sample: usize,
    max_delay: usize,
    delays: &[usize],
) -> f64 {
    match input {
        InputSource::Channel(channel) => {
            evaluate_term(shifted, *channel, sample, max_delay, delays)
        }
        InputSource::Series(series) => {
            let mut product = 1.0;
            for &delay in delays {
                let shifted_row = sample + max_delay.saturating_sub(delay);
                let value = series[shifted_row];
                if value.is_nan() {
                    return f64::NAN;
                }
                product *= value;
            }
            product
        }
    }
}

pub(crate) fn compute_de_value(
    channels: &[usize],
    st_blocks: &[Option<SolvedBlock>],
    ct_rmse: f64,
) -> f64 {
    if channels.is_empty() || ct_rmse.is_nan() || ct_rmse == 0.0 {
        return f64::NAN;
    }
    let mut baseline = 0.0;
    for &channel in channels {
        baseline += st_blocks
            .get(channel)
            .and_then(Option::as_ref)
            .map(|block| block.rmse)
            .unwrap_or(f64::NAN);
    }
    baseline /= channels.len() as f64;
    if baseline.is_nan() {
        return f64::NAN;
    }
    (baseline / ct_rmse - 1.0).abs()
}

pub(crate) fn empirical_significance_confidence(observed: f64, null_scores: &[f64]) -> f64 {
    if observed.is_nan() {
        return f64::NAN;
    }
    let finite_nulls = null_scores
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    if finite_nulls.is_empty() {
        return f64::NAN;
    }
    let exceedances = finite_nulls
        .iter()
        .filter(|value| **value >= observed)
        .count();
    1.0 - ((exceedances + 1) as f64 / (finite_nulls.len() + 1) as f64)
}

pub(crate) fn circular_shift_series(series: &[f64], shift: usize) -> Vec<f64> {
    if series.is_empty() {
        return Vec::new();
    }
    let actual_shift = shift % series.len();
    if actual_shift == 0 {
        return series.to_vec();
    }
    let mut shifted = Vec::with_capacity(series.len());
    shifted.extend_from_slice(&series[actual_shift..]);
    shifted.extend_from_slice(&series[..actual_shift]);
    shifted
}

pub(crate) fn greedy_sparse_unique_improvements(
    prepared: &PreparedWindow,
    target_channel: usize,
    candidate_sources: &[usize],
    fixed_inputs: &[usize],
    model: &ModelSpec,
    max_active_sources: usize,
) -> Vec<(usize, f64)> {
    let fixed_inputs = fixed_inputs
        .iter()
        .copied()
        .filter(|channel| *channel != target_channel)
        .collect::<Vec<_>>();
    let mut candidates = candidate_sources
        .iter()
        .copied()
        .filter(|channel| *channel != target_channel && !fixed_inputs.contains(channel))
        .collect::<Vec<_>>();
    candidates.sort_unstable();
    candidates.dedup();

    if candidates.is_empty() {
        return Vec::new();
    }

    let mut active_inputs = fixed_inputs.clone();
    let mut selected_sources = Vec::new();
    let mut remaining = candidates.clone();
    let mut current_block =
        solve_channel_with_inputs(prepared, target_channel, &active_inputs, model);
    let mut current_bic = bic_like_score(
        current_block.rmse,
        model.window_length,
        model.primary_terms.len() + active_inputs.len() * model.primary_terms.len(),
    );

    for _ in 0..max_active_sources.min(candidates.len()) {
        let mut best_choice = None;
        for &source in &remaining {
            let mut trial_inputs = active_inputs.clone();
            trial_inputs.push(source);
            let trial_block =
                solve_channel_with_inputs(prepared, target_channel, &trial_inputs, model);
            let trial_bic = bic_like_score(
                trial_block.rmse,
                model.window_length,
                model.primary_terms.len() + trial_inputs.len() * model.primary_terms.len(),
            );
            if trial_bic + 1e-12 < current_bic {
                match best_choice {
                    Some((_, best_bic, _)) if trial_bic >= best_bic => {}
                    _ => best_choice = Some((source, trial_bic, trial_block)),
                }
            }
        }

        if let Some((source, best_bic, best_block)) = best_choice {
            active_inputs.push(source);
            selected_sources.push(source);
            remaining.retain(|candidate| *candidate != source);
            current_block = best_block;
            current_bic = best_bic;
        } else {
            break;
        }
    }

    let full_rmse = current_block.rmse;
    candidates
        .into_iter()
        .map(|source| {
            if !selected_sources.contains(&source) {
                return (source, 0.0);
            }
            let without_source = active_inputs
                .iter()
                .copied()
                .filter(|channel| *channel != source)
                .collect::<Vec<_>>();
            let without_block =
                solve_channel_with_inputs(prepared, target_channel, &without_source, model);
            (
                source,
                crate::ccd_stats::legacy_rmse_gain_from_rmse(without_block.rmse, full_rmse),
            )
        })
        .collect()
}

pub(crate) fn bic_like_score(rmse: f64, sample_count: usize, parameter_count: usize) -> f64 {
    if !rmse.is_finite() || rmse <= 0.0 || sample_count == 0 {
        return f64::INFINITY;
    }
    let n = sample_count as f64;
    let k = parameter_count as f64;
    n * libm::log(rmse * rmse) + k * libm::log(n)
}

pub(crate) fn synchronization_value(mode: u8, forward_rmse: f64, reverse_rmse: f64) -> f64 {
    if forward_rmse.is_nan() || reverse_rmse.is_nan() {
        return f64::NAN;
    }
    match mode {
        2 => forward_rmse,
        1 => {
            if forward_rmse == 0.0 || reverse_rmse == 0.0 {
                f64::NAN
            } else {
                reverse_rmse / forward_rmse - forward_rmse / reverse_rmse
            }
        }
        _ => f64::NAN,
    }
}

#[cfg(test)]
mod temporal_tests {
    use super::*;

    fn system(
        cols: usize,
        lambda: f64,
        column: impl Fn(usize, usize, usize) -> f64,
    ) -> (Vec<DMatrix<f64>>, Vec<DVector<f64>>) {
        let diagonal = (0..40)
            .map(|w| {
                let a = DMatrix::from_fn(50, cols, |r, c| column(r, c, w));
                let mut block = a.transpose() * &a;
                let neighbours = usize::from(w > 0) + usize::from(w + 1 < 40);
                for d in 0..cols {
                    block[(d, d)] += lambda * neighbours as f64;
                }
                block
            })
            .collect();
        let rhs = (0..40)
            .map(|w| DVector::from_fn(cols, |r, _| ((r + w) as f64 * 0.91).cos()))
            .collect();
        (diagonal, rhs)
    }

    fn assert_close(left: &[DVector<f64>], right: &[DVector<f64>]) {
        for (x, y) in left.iter().zip(right) {
            assert!((x - y).norm() <= 1e-9 * y.norm().max(1.0), "{x} vs {y}");
        }
    }

    /// The block solver and the dense SVD agree on a well-posed system of 40 windows.
    #[test]
    fn block_tridiagonal_solve_equals_the_dense_solution() {
        let lambda = 2.5;
        let (diagonal, rhs) = system(3, lambda, |r, c, w| {
            ((r * (c + 2) + w) as f64 * 0.37 * (c + 1) as f64).sin()
        });
        let block = block_tridiagonal_solve(&diagonal, &rhs, lambda).expect("well conditioned");
        assert_close(&block, &dense_regularized_solve(&diagonal, &rhs, lambda));
    }

    /// Three columns in a two-dimensional span leave a direction no window determines: the block solver declines
    /// and the minimum-norm SVD answers.
    #[test]
    fn a_singular_system_falls_back_to_the_svd() {
        let lambda = 2.5;
        let (diagonal, rhs) = system(3, lambda, |r, c, w| {
            ((r * 7 + c * 13 + w * 3) as f64 * 0.37).sin()
        });
        assert!(block_tridiagonal_solve(&diagonal, &rhs, lambda).is_none());
    }
}
