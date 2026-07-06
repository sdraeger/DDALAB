use crate::error::{DDAError, Result};
use crate::types::CcdStatistic;
use nalgebra::{DMatrix, DVector};
use rand::{seq::SliceRandom, Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CcdStatConfig {
    pub statistic: CcdStatistic,
    pub epsilon: f64,
    pub rank_tolerance: f64,
    pub constant_tolerance: f64,
}

impl Default for CcdStatConfig {
    fn default() -> Self {
        Self {
            statistic: CcdStatistic::LegacyRmseGain,
            epsilon: 1e-12,
            rank_tolerance: 1e-10,
            constant_tolerance: 1e-12,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CcdRegressionDiagnostics {
    pub n_rows: usize,
    pub n_features_baseline: usize,
    pub n_features_full: usize,
    pub rank_baseline: usize,
    pub rank_full: usize,
    pub sse0: f64,
    pub sse1: f64,
    pub mse0: f64,
    pub mse1: f64,
    pub nesting_ok: bool,
    pub condition_number_baseline: f64,
    pub condition_number_full: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CcdStatResult {
    pub statistic: CcdStatistic,
    pub value: f64,
    pub diagnostics: CcdRegressionDiagnostics,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NullMode {
    None,
    CircularShift,
    BlockPermutation,
    PseudoOnset,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NullConfig {
    pub null_mode: NullMode,
    pub n_null: usize,
    pub rng_seed: u64,
    pub min_shift: usize,
    pub block_length: usize,
    pub epsilon: f64,
}

impl Default for NullConfig {
    fn default() -> Self {
        Self {
            null_mode: NullMode::None,
            n_null: 0,
            rng_seed: 0,
            min_shift: 1,
            block_length: 16,
            epsilon: 1e-12,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NullCalibration {
    pub observed_stat: f64,
    pub null_values: Vec<f64>,
    pub empirical_p: f64,
    pub null_median: f64,
    pub null_mad: f64,
    pub z_mad: f64,
    pub null_percentile_rank: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EndpointConfig {
    pub epsilon: f64,
}

impl Default for EndpointConfig {
    fn default() -> Self {
        Self { epsilon: 1e-12 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EndpointSummary {
    pub legacy_ratio: f64,
    pub log_ratio: f64,
    pub delta_legacy_ratio: f64,
    pub delta_log_ratio: f64,
    pub pseudo_null_median: f64,
    pub pseudo_null_mad: f64,
    pub z_onset: f64,
    pub empirical_p: f64,
}

#[derive(Debug, Clone)]
struct RegressionFit {
    sse: f64,
    mse: f64,
    rank: usize,
    condition_number: f64,
}

pub fn compute_ccd_statistic(
    y: &[f64],
    x0_rows: &[Vec<f64>],
    xj_rows: &[Vec<f64>],
    config: &CcdStatConfig,
) -> Result<CcdStatResult> {
    if y.len() != x0_rows.len() || y.len() != xj_rows.len() {
        return Err(DDAError::InvalidParameter(format!(
            "CCD statistic row mismatch: y={}, x0={}, xj={}",
            y.len(),
            x0_rows.len(),
            xj_rows.len()
        )));
    }
    if y.is_empty() {
        return Err(DDAError::InvalidParameter(
            "CCD statistic requires at least one row".to_string(),
        ));
    }
    let n0 = row_width(x0_rows, "x0")?;
    let nj = row_width(xj_rows, "xj")?;
    let mut y_valid = Vec::new();
    let mut x0_flat = Vec::new();
    let mut xj_flat = Vec::new();
    let mut baseline_valid = Vec::with_capacity(y.len());
    let mut full_valid = Vec::with_capacity(y.len());

    for row in 0..y.len() {
        let b_valid = y[row].is_finite() && x0_rows[row].iter().all(|value| value.is_finite());
        let f_valid = b_valid && xj_rows[row].iter().all(|value| value.is_finite());
        baseline_valid.push(b_valid);
        full_valid.push(f_valid);
        if f_valid {
            y_valid.push(y[row]);
            x0_flat.extend_from_slice(&x0_rows[row]);
            xj_flat.extend_from_slice(&xj_rows[row]);
        }
    }
    if baseline_valid != full_valid {
        return Err(DDAError::InvalidParameter(
            "CCD baseline and full models would use different valid row sets".to_string(),
        ));
    }
    if y_valid.is_empty() {
        return Err(DDAError::InvalidParameter(
            "CCD statistic has no finite valid rows".to_string(),
        ));
    }
    reject_degenerate_columns(
        &xj_flat,
        y_valid.len(),
        nj,
        "source",
        config.constant_tolerance,
    )?;

    let x0 = DMatrix::from_row_slice(y_valid.len(), n0, &x0_flat);
    let xj = DMatrix::from_row_slice(y_valid.len(), nj, &xj_flat);
    compute_ccd_statistic_from_matrices(&y_valid, &x0, &xj, config)
}

pub fn compute_ccd_statistic_from_matrices(
    y: &[f64],
    x0: &DMatrix<f64>,
    xj: &DMatrix<f64>,
    config: &CcdStatConfig,
) -> Result<CcdStatResult> {
    if y.len() != x0.nrows() || y.len() != xj.nrows() {
        return Err(DDAError::InvalidParameter(format!(
            "CCD matrix row mismatch: y={}, x0={}, xj={}",
            y.len(),
            x0.nrows(),
            xj.nrows()
        )));
    }
    if x0.ncols() == 0 || xj.ncols() == 0 {
        return Err(DDAError::InvalidParameter(
            "CCD statistic requires nonempty baseline and source designs".to_string(),
        ));
    }
    let full = concatenate_columns(x0, xj);
    let fit0 = fit_ols(y, x0, config.rank_tolerance);
    let fit1 = fit_ols(y, &full, config.rank_tolerance);
    let (value, residual_fit) = match config.statistic {
        CcdStatistic::LegacyRmseGain => (fit0.mse.sqrt() - fit1.mse.sqrt(), None),
        CcdStatistic::DeltaSse => (fit0.sse - fit1.sse, None),
        CcdStatistic::PartialR2 => (partial_r2(fit0.sse, fit1.sse), None),
        CcdStatistic::LogMseRatio => (log_ratio(fit0.mse, fit1.mse, config.epsilon), None),
        CcdStatistic::ResidualizedDeltaSse
        | CcdStatistic::ResidualizedPartialR2
        | CcdStatistic::ResidualizedLogMseRatio => {
            let residual = residualized_fit(y, x0, xj, config.rank_tolerance)?;
            let residual_value = match config.statistic {
                CcdStatistic::ResidualizedDeltaSse => residual.0.sse - residual.1.sse,
                CcdStatistic::ResidualizedPartialR2 => partial_r2(residual.0.sse, residual.1.sse),
                CcdStatistic::ResidualizedLogMseRatio => {
                    log_ratio(residual.0.mse, residual.1.mse, config.epsilon)
                }
                _ => unreachable!(),
            };
            (residual_value, Some(residual))
        }
    };

    if !value.is_finite() {
        return Err(DDAError::InvalidParameter(format!(
            "CCD statistic {:?} produced a non-finite value",
            config.statistic
        )));
    }

    let diagnostics = if let Some((resid0, resid1)) = residual_fit {
        CcdRegressionDiagnostics {
            n_rows: y.len(),
            n_features_baseline: x0.ncols(),
            n_features_full: x0.ncols() + xj.ncols(),
            rank_baseline: resid0.rank,
            rank_full: resid1.rank,
            sse0: resid0.sse,
            sse1: resid1.sse,
            mse0: resid0.mse,
            mse1: resid1.mse,
            nesting_ok: true,
            condition_number_baseline: resid0.condition_number,
            condition_number_full: resid1.condition_number,
        }
    } else {
        CcdRegressionDiagnostics {
            n_rows: y.len(),
            n_features_baseline: x0.ncols(),
            n_features_full: full.ncols(),
            rank_baseline: fit0.rank,
            rank_full: fit1.rank,
            sse0: fit0.sse,
            sse1: fit1.sse,
            mse0: fit0.mse,
            mse1: fit1.mse,
            nesting_ok: true,
            condition_number_baseline: fit0.condition_number,
            condition_number_full: fit1.condition_number,
        }
    };
    Ok(CcdStatResult {
        statistic: config.statistic,
        value,
        diagnostics,
    })
}

pub fn legacy_rmse_gain_from_rmse(baseline_rmse: f64, full_rmse: f64) -> f64 {
    if baseline_rmse.is_nan() || full_rmse.is_nan() {
        return f64::NAN;
    }
    baseline_rmse - full_rmse
}

pub fn partial_r2_from_rmse(baseline_rmse: f64, full_rmse: f64) -> f64 {
    if !baseline_rmse.is_finite() || !full_rmse.is_finite() || baseline_rmse <= 0.0 {
        return f64::NAN;
    }
    1.0 - full_rmse.powi(2) / baseline_rmse.powi(2)
}

pub fn log_mse_ratio_from_rmse(baseline_rmse: f64, full_rmse: f64, epsilon: f64) -> f64 {
    if !baseline_rmse.is_finite() || !full_rmse.is_finite() || epsilon < 0.0 {
        return f64::NAN;
    }
    ((baseline_rmse.powi(2) + epsilon) / (full_rmse.powi(2) + epsilon)).ln()
}

pub fn empirical_p_value(observed: f64, null_values: &[f64]) -> f64 {
    let finite = null_values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    let ge = finite.iter().filter(|value| **value >= observed).count();
    (1.0 + ge as f64) / (1.0 + finite.len() as f64)
}

pub fn search_aware_null_maxima(null_replicates: &[Vec<f64>]) -> Vec<f64> {
    null_replicates
        .iter()
        .map(|replicate| {
            replicate
                .iter()
                .copied()
                .filter(|value| value.is_finite())
                .fold(f64::NEG_INFINITY, f64::max)
        })
        .collect()
}

pub fn search_aware_empirical_p_value(observed: f64, null_replicates: &[Vec<f64>]) -> f64 {
    empirical_p_value(observed, &search_aware_null_maxima(null_replicates))
}

pub fn calibrate_against_null(observed: f64, null_values: &[f64], epsilon: f64) -> NullCalibration {
    let finite = null_values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    let null_median = median(&finite);
    let null_mad = mad(&finite, null_median);
    let below_or_equal = finite.iter().filter(|value| **value <= observed).count();
    let null_percentile_rank = if finite.is_empty() {
        f64::NAN
    } else {
        below_or_equal as f64 / finite.len() as f64
    };
    NullCalibration {
        observed_stat: observed,
        null_values: finite.clone(),
        empirical_p: empirical_p_value(observed, &finite),
        null_median,
        null_mad,
        z_mad: (observed - null_median) / (null_mad + epsilon),
        null_percentile_rank,
    }
}

pub fn circular_shift_offsets(
    series_len: usize,
    n_null: usize,
    min_shift: usize,
    rng_seed: u64,
) -> Result<Vec<usize>> {
    if series_len <= 1 {
        return Err(DDAError::InvalidParameter(
            "circular-shift null requires at least two samples".to_string(),
        ));
    }
    let min_shift = min_shift.max(1);
    if min_shift >= series_len {
        return Err(DDAError::InvalidParameter(format!(
            "min_shift={} must be smaller than series length {}",
            min_shift, series_len
        )));
    }
    let mut rng = ChaCha8Rng::seed_from_u64(rng_seed);
    Ok((0..n_null)
        .map(|_| rng.gen_range(min_shift..series_len))
        .collect())
}

pub fn circular_shift_series(series: &[f64], shift: usize) -> Vec<f64> {
    if series.is_empty() {
        return Vec::new();
    }
    let shift = shift % series.len();
    let mut shifted = Vec::with_capacity(series.len());
    shifted.extend_from_slice(&series[series.len() - shift..]);
    shifted.extend_from_slice(&series[..series.len() - shift]);
    shifted
}

pub fn block_permute_series(
    series: &[f64],
    block_length: usize,
    rng_seed: u64,
) -> Result<Vec<f64>> {
    if block_length == 0 {
        return Err(DDAError::InvalidParameter(
            "block permutation requires block_length > 0".to_string(),
        ));
    }
    if series.is_empty() {
        return Ok(Vec::new());
    }
    let mut blocks = series
        .chunks(block_length)
        .map(|chunk| chunk.to_vec())
        .collect::<Vec<_>>();
    let mut rng = ChaCha8Rng::seed_from_u64(rng_seed);
    blocks.shuffle(&mut rng);
    Ok(blocks.into_iter().flatten().collect())
}

pub fn endpoint_summary(
    t_pre: f64,
    t_ictal: f64,
    t_null1: f64,
    t_null2: f64,
    pseudo_null: &[f64],
    config: &EndpointConfig,
) -> EndpointSummary {
    let legacy_ratio = t_ictal / t_pre;
    let null_ratio = t_null2 / t_null1;
    let log_ratio = ((t_ictal + config.epsilon) / (t_pre + config.epsilon)).ln();
    let null_log_ratio = ((t_null2 + config.epsilon) / (t_null1 + config.epsilon)).ln();
    let null_median = median(pseudo_null);
    let null_mad = mad(pseudo_null, null_median);
    EndpointSummary {
        legacy_ratio,
        log_ratio,
        delta_legacy_ratio: legacy_ratio - null_ratio,
        delta_log_ratio: log_ratio - null_log_ratio,
        pseudo_null_median: null_median,
        pseudo_null_mad: null_mad,
        z_onset: (t_ictal - null_median) / (null_mad + config.epsilon),
        empirical_p: empirical_p_value(t_ictal, pseudo_null),
    }
}

fn row_width(rows: &[Vec<f64>], name: &str) -> Result<usize> {
    let width = rows
        .first()
        .ok_or_else(|| DDAError::InvalidParameter(format!("{name} has no rows")))?
        .len();
    if width == 0 {
        return Err(DDAError::InvalidParameter(format!(
            "{name} must have at least one column"
        )));
    }
    if rows.iter().any(|row| row.len() != width) {
        return Err(DDAError::InvalidParameter(format!(
            "{name} rows have inconsistent widths"
        )));
    }
    Ok(width)
}

fn reject_degenerate_columns(
    flat: &[f64],
    rows: usize,
    cols: usize,
    label: &str,
    tolerance: f64,
) -> Result<()> {
    for col in 0..cols {
        let mean = (0..rows).map(|row| flat[row * cols + col]).sum::<f64>() / rows as f64;
        let variance = (0..rows)
            .map(|row| {
                let delta = flat[row * cols + col] - mean;
                delta * delta
            })
            .sum::<f64>()
            / rows as f64;
        if variance <= tolerance {
            return Err(DDAError::InvalidParameter(format!(
                "CCD {label} design has degenerate column {col}"
            )));
        }
    }
    Ok(())
}

fn concatenate_columns(left: &DMatrix<f64>, right: &DMatrix<f64>) -> DMatrix<f64> {
    let mut out = DMatrix::<f64>::zeros(left.nrows(), left.ncols() + right.ncols());
    out.view_mut((0, 0), (left.nrows(), left.ncols()))
        .copy_from(left);
    out.view_mut((0, left.ncols()), (right.nrows(), right.ncols()))
        .copy_from(right);
    out
}

fn fit_ols(y: &[f64], x: &DMatrix<f64>, rank_tolerance: f64) -> RegressionFit {
    let y_vec = DVector::from_column_slice(y);
    let svd = x.clone().svd(true, true);
    let singular_values = svd.singular_values.iter().copied().collect::<Vec<_>>();
    let sigma_max = singular_values.iter().copied().fold(0.0_f64, f64::max);
    let tolerance =
        rank_tolerance.max((x.nrows().max(x.ncols()) as f64) * f64::EPSILON * sigma_max.max(1.0));
    let coefficients = svd
        .solve(&y_vec, tolerance)
        .unwrap_or_else(|_| DVector::from_element(x.ncols(), f64::NAN));
    let residual = y_vec - x * coefficients;
    let sse = residual.iter().map(|value| value * value).sum::<f64>();
    let rank = singular_values
        .iter()
        .filter(|value| value.abs() > tolerance)
        .count();
    let min_nonzero = singular_values
        .iter()
        .copied()
        .filter(|value| value.abs() > tolerance)
        .fold(f64::INFINITY, f64::min);
    let condition_number = if min_nonzero.is_finite() && min_nonzero > 0.0 {
        sigma_max / min_nonzero
    } else {
        f64::INFINITY
    };
    RegressionFit {
        sse,
        mse: sse / y.len() as f64,
        rank,
        condition_number,
    }
}

fn residualized_fit(
    y: &[f64],
    x0: &DMatrix<f64>,
    xj: &DMatrix<f64>,
    rank_tolerance: f64,
) -> Result<(RegressionFit, RegressionFit)> {
    let y_vec = DVector::from_column_slice(y);
    let beta_y = solve_ols_coefficients(x0, &y_vec, rank_tolerance);
    let y_resid = y_vec - x0 * beta_y;
    let mut xj_resid = DMatrix::<f64>::zeros(xj.nrows(), xj.ncols());
    for col in 0..xj.ncols() {
        let source_col = xj.column(col).into_owned();
        let beta_x = solve_ols_coefficients(x0, &source_col, rank_tolerance);
        let residual_col = source_col - x0 * beta_x;
        xj_resid.set_column(col, &residual_col);
    }
    let y_resid_vec = y_resid.iter().copied().collect::<Vec<_>>();
    let baseline = RegressionFit {
        sse: y_resid_vec.iter().map(|value| value * value).sum::<f64>(),
        mse: y_resid_vec.iter().map(|value| value * value).sum::<f64>() / y.len() as f64,
        rank: 0,
        condition_number: f64::NAN,
    };
    let full = fit_ols(&y_resid_vec, &xj_resid, rank_tolerance);
    Ok((baseline, full))
}

fn solve_ols_coefficients(x: &DMatrix<f64>, y: &DVector<f64>, rank_tolerance: f64) -> DVector<f64> {
    let svd = x.clone().svd(true, true);
    let sigma_max = svd.singular_values.iter().copied().fold(0.0_f64, f64::max);
    let tolerance =
        rank_tolerance.max((x.nrows().max(x.ncols()) as f64) * f64::EPSILON * sigma_max.max(1.0));
    svd.solve(y, tolerance)
        .unwrap_or_else(|_| DVector::from_element(x.ncols(), f64::NAN))
}

fn partial_r2(sse0: f64, sse1: f64) -> f64 {
    if sse0 <= 0.0 {
        return f64::NAN;
    }
    1.0 - sse1 / sse0
}

fn log_ratio(mse0: f64, mse1: f64, epsilon: f64) -> f64 {
    ((mse0 + epsilon) / (mse1 + epsilon)).ln()
}

fn median(values: &[f64]) -> f64 {
    let mut finite = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    if finite.is_empty() {
        return f64::NAN;
    }
    finite.sort_by(|a, b| a.total_cmp(b));
    let mid = finite.len() / 2;
    if finite.len() % 2 == 0 {
        (finite[mid - 1] + finite[mid]) / 2.0
    } else {
        finite[mid]
    }
}

fn mad(values: &[f64], center: f64) -> f64 {
    if !center.is_finite() {
        return f64::NAN;
    }
    let deviations = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .map(|value| (value - center).abs())
        .collect::<Vec<_>>();
    median(&deviations)
}
