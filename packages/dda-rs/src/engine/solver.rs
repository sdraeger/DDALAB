use nalgebra::{DMatrix, DVector};
use rayon::prelude::*;

use super::{window::PreparedWindow, SvdBackend, PARALLEL_BATCH_MIN_LEN};

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

pub(crate) fn solve_group_block(
    prepared: &PreparedWindow,
    channels: &[usize],
    model_terms: &[Vec<usize>],
    window_length: usize,
    svd_backend: SvdBackend,
) -> SolvedBlock {
    let total_points = channels.len() * window_length;
    if total_points == 0 {
        return SolvedBlock::nan(model_terms.len());
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
        return SolvedBlock::nan(feature_count);
    }

    solve_least_squares_from_flat(
        &flat_design,
        valid_rows,
        feature_count,
        &target,
        &target,
        svd_backend,
    )
}

fn build_channel_regression_window(
    prepared: &PreparedWindow,
    target_channel: usize,
    input_sources: &[InputSource<'_>],
    primary_terms: &[Vec<usize>],
    secondary_terms: &[Vec<usize>],
    window_length: usize,
) -> RegressionWindow {
    let feature_count = primary_terms.len() + input_sources.len() * secondary_terms.len();
    let mut flat_design = Vec::with_capacity(window_length * feature_count);
    let mut fit_target = Vec::with_capacity(window_length);
    let mut residual_target = Vec::with_capacity(window_length);
    let mut valid_rows = 0usize;

    for sample in 0..window_length {
        let target_value = prepared.deriv[target_channel][sample];
        if target_value.is_nan() {
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
                target_channel,
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
            fit_target.push(target_value);
            residual_target.push(target_value);
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

pub(crate) fn solve_directed_pair(
    prepared: &PreparedWindow,
    primary_channel: usize,
    secondary_channel: usize,
    response_channel: usize,
    primary_terms: &[Vec<usize>],
    secondary_terms: &[Vec<usize>],
    window_length: usize,
    svd_backend: SvdBackend,
) -> SolvedBlock {
    let feature_count = primary_terms.len() + secondary_terms.len();
    let mut flat_design = Vec::with_capacity(window_length * feature_count);
    let mut fit_target = Vec::with_capacity(window_length);
    let mut residual_target = Vec::with_capacity(window_length);
    let mut valid_rows = 0usize;

    for sample in 0..window_length {
        let fit_value = prepared.deriv[primary_channel][sample];
        if fit_value.is_nan() {
            continue;
        }
        let row_start = flat_design.len();
        let mut valid = true;
        for term in secondary_terms {
            let value = evaluate_term(
                &prepared.shifted,
                secondary_channel,
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
            flat_design.truncate(row_start);
            continue;
        }
        for term in primary_terms {
            let value = evaluate_term(
                &prepared.shifted,
                primary_channel,
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
        return SolvedBlock::nan(feature_count);
    }

    solve_least_squares_from_flat(
        &flat_design,
        valid_rows,
        feature_count,
        &fit_target,
        &residual_target,
        svd_backend,
    )
}

pub(crate) fn solve_channel_with_inputs(
    prepared: &PreparedWindow,
    target_channel: usize,
    input_channels: &[usize],
    primary_terms: &[Vec<usize>],
    secondary_terms: &[Vec<usize>],
    window_length: usize,
    svd_backend: SvdBackend,
) -> SolvedBlock {
    let input_sources = input_channels
        .iter()
        .copied()
        .map(InputSource::Channel)
        .collect::<Vec<_>>();
    let window = build_channel_regression_window(
        prepared,
        target_channel,
        &input_sources,
        primary_terms,
        secondary_terms,
        window_length,
    );
    solve_regression_window(&window, svd_backend)
}

pub(crate) fn solve_channel_with_surrogate_inputs(
    prepared: &PreparedWindow,
    target_channel: usize,
    surrogate_inputs: &[Vec<f64>],
    primary_terms: &[Vec<usize>],
    secondary_terms: &[Vec<usize>],
    window_length: usize,
    svd_backend: SvdBackend,
) -> SolvedBlock {
    let input_sources = surrogate_inputs
        .iter()
        .map(|series| InputSource::Series(series.as_slice()))
        .collect::<Vec<_>>();
    let window = build_channel_regression_window(
        prepared,
        target_channel,
        &input_sources,
        primary_terms,
        secondary_terms,
        window_length,
    );
    solve_regression_window(&window, svd_backend)
}

pub(crate) fn build_channel_regression_window_with_inputs(
    prepared: &PreparedWindow,
    target_channel: usize,
    input_channels: &[usize],
    primary_terms: &[Vec<usize>],
    secondary_terms: &[Vec<usize>],
    window_length: usize,
) -> RegressionWindow {
    let input_sources = input_channels
        .iter()
        .copied()
        .map(InputSource::Channel)
        .collect::<Vec<_>>();
    build_channel_regression_window(
        prepared,
        target_channel,
        &input_sources,
        primary_terms,
        secondary_terms,
        window_length,
    )
}

pub(crate) fn solve_regression_window(
    window: &RegressionWindow,
    svd_backend: SvdBackend,
) -> SolvedBlock {
    solve_least_squares_from_flat(
        &window.flat_design,
        window.rows,
        window.cols,
        &window.fit_target,
        &window.residual_target,
        svd_backend,
    )
}

pub(crate) fn solve_temporally_regularized_windows(
    windows: &[RegressionWindow],
    lambda: f64,
    svd_backend: SvdBackend,
) -> Vec<SolvedBlock> {
    if windows.is_empty() {
        return Vec::new();
    }
    let cols = windows[0].cols;
    if cols == 0 {
        return vec![SolvedBlock::nan(cols); windows.len()];
    }

    let count = windows.len();
    let total_cols = count * cols;
    let mut normal = DMatrix::<f64>::zeros(total_cols, total_cols);
    let mut rhs = DVector::<f64>::zeros(total_cols);

    for (window_idx, window) in windows.iter().enumerate() {
        if window.rows > 0 {
            let a = DMatrix::from_row_slice(window.rows, cols, &window.flat_design);
            let y = DVector::from_column_slice(&window.fit_target);
            let xtx = a.transpose() * &a;
            let xty = a.transpose() * &y;
            for row in 0..cols {
                rhs[window_idx * cols + row] += xty[row];
                for col in 0..cols {
                    normal[(window_idx * cols + row, window_idx * cols + col)] += xtx[(row, col)];
                }
            }
        }
        if lambda > 0.0 && window_idx + 1 < count {
            for diag in 0..cols {
                let current = window_idx * cols + diag;
                let next = (window_idx + 1) * cols + diag;
                normal[(current, current)] += lambda;
                normal[(next, next)] += lambda;
                normal[(current, next)] -= lambda;
                normal[(next, current)] -= lambda;
            }
        }
    }

    let coefficients = solve_matrix_with_backend(&normal, &rhs, svd_backend);

    windows
        .iter()
        .enumerate()
        .map(|(window_idx, window)| {
            if window.rows == 0 {
                return SolvedBlock::nan(cols);
            }
            let coeff_slice = coefficients.rows(window_idx * cols, cols).clone_owned();
            let a = DMatrix::from_row_slice(window.rows, cols, &window.flat_design);
            let prediction = &a * &coeff_slice;
            let residual_sum = window
                .residual_target
                .iter()
                .enumerate()
                .map(|(row_idx, value)| {
                    let delta = value - prediction[row_idx];
                    delta * delta
                })
                .sum::<f64>();
            let rmse = (residual_sum / (window.rows as f64)).sqrt();
            SolvedBlock {
                coefficients: coeff_slice.iter().copied().collect(),
                rmse,
            }
        })
        .collect()
}

fn solve_least_squares_from_flat(
    flat_design: &[f64],
    rows: usize,
    cols: usize,
    fit_target: &[f64],
    residual_target: &[f64],
    svd_backend: SvdBackend,
) -> SolvedBlock {
    if rows == 0 || cols == 0 {
        return SolvedBlock::nan(cols);
    }
    let a = DMatrix::from_row_slice(rows, cols, flat_design);
    let y = DVector::from_column_slice(fit_target);
    let coefficients = solve_matrix_with_backend(&a, &y, svd_backend);
    let prediction = &a * &coefficients;
    let residual_sum = residual_target
        .iter()
        .enumerate()
        .map(|(row_idx, value)| {
            let delta = value - prediction[row_idx];
            delta * delta
        })
        .sum::<f64>();
    let rmse = (residual_sum / (rows as f64)).sqrt();
    SolvedBlock {
        coefficients: coefficients.iter().copied().collect(),
        rmse,
    }
}

fn solve_matrix_with_backend(
    matrix: &DMatrix<f64>,
    rhs: &DVector<f64>,
    svd_backend: SvdBackend,
) -> DVector<f64> {
    match svd_backend {
        SvdBackend::RobustSvd => solve_matrix_with_robust_svd(matrix, rhs),
        SvdBackend::NativeCompatSvd => solve_matrix_with_native_compat_svd(matrix, rhs),
    }
}

fn solve_matrix_with_robust_svd(matrix: &DMatrix<f64>, rhs: &DVector<f64>) -> DVector<f64> {
    let svd = matrix.clone().svd(true, true);
    let sigma_max = svd.singular_values.iter().copied().fold(0.0_f64, f64::max);
    let tolerance = (matrix.nrows().max(matrix.ncols()) as f64) * f64::EPSILON * sigma_max.max(1.0);
    svd.solve(rhs, tolerance)
        .unwrap_or_else(|_| DVector::from_element(matrix.ncols(), f64::NAN))
}

fn solve_matrix_with_native_compat_svd(
    matrix: &DMatrix<f64>,
    rhs: &DVector<f64>,
) -> DVector<f64> {
    if matrix.nrows() == 0 || matrix.ncols() == 0 || rhs.len() != matrix.nrows() {
        return DVector::from_element(matrix.ncols(), f64::NAN);
    }

    let rows = matrix.nrows();
    let cols = matrix.ncols();
    let mut compact_x = vec![vec![0.0; rows]; cols];
    for row in 0..rows {
        for col in 0..cols {
            compact_x[col][row] = matrix[(row, col)];
        }
    }
    let compact_y = rhs.iter().copied().collect::<Vec<_>>();
    let coefficients = solve_compact_with_native_compat_svd(&compact_x, &compact_y);
    DVector::from_column_slice(&coefficients)
}

fn solve_compact_with_native_compat_svd(compact_x: &[Vec<f64>], compact_y: &[f64]) -> Vec<f64> {
    let feature_count = compact_x.len();
    let valid_count = compact_y.len();
    if feature_count == 0 || valid_count == 0 {
        return vec![f64::NAN; feature_count];
    }

    let (u, w, mut v) = dsvdcmp_native_compat(compact_x, valid_count, feature_count);
    let mut projected_rhs = vec![0.0; feature_count];
    for sample in 0..valid_count {
        for feature in 0..feature_count {
            projected_rhs[feature] += compact_y[sample] * u[feature][sample];
        }
    }
    for col in 0..feature_count {
        for row in 0..feature_count {
            v[row][col] *= projected_rhs[row] / w[row];
        }
    }
    let mut coefficients = vec![0.0; feature_count];
    for col in 0..feature_count {
        for row in 0..feature_count {
            coefficients[col] += v[row][col];
        }
    }
    coefficients
}

fn dpythag_native_compat(a: f64, b: f64) -> f64 {
    let absa = a.abs();
    let absb = b.abs();
    if absa > absb {
        absa * (1.0 + (absb / absa).powi(2)).sqrt()
    } else if absb == 0.0 {
        0.0
    } else {
        absb * (1.0 + (absa / absb).powi(2)).sqrt()
    }
}

fn dsvdcmp_native_compat(
    a_in: &[Vec<f64>],
    m: usize,
    n: usize,
) -> (Vec<Vec<f64>>, Vec<f64>, Vec<Vec<f64>>) {
    let mut u = a_in.to_vec();
    let mut w = vec![0.0; n];
    let mut v = vec![vec![0.0; n]; n];
    let mut rv1 = vec![0.0; n];
    let mut anorm = 0.0_f64;
    let mut g = 0.0_f64;
    let mut scale = 0.0_f64;

    for i in 0..n {
        let l = i + 1;
        rv1[i] = scale * g;
        g = 0.0;
        let mut s = 0.0;
        scale = 0.0;
        if i < m {
            for k in i..m {
                scale += u[i][k].abs();
            }
            if scale != 0.0 {
                for k in i..m {
                    u[i][k] /= scale;
                    s += u[i][k] * u[i][k];
                }
                let f = u[i][i];
                g = if f < 0.0 {
                    s.sqrt().abs()
                } else {
                    -s.sqrt().abs()
                };
                let h = f * g - s;
                u[i][i] = f - g;
                for j in l..n {
                    s = 0.0;
                    for k in i..m {
                        s += u[j][k] * u[i][k];
                    }
                    let f = s / h;
                    for k in i..m {
                        u[j][k] += f * u[i][k];
                    }
                }
                for k in i..m {
                    u[i][k] *= scale;
                }
            }
        }
        w[i] = scale * g;
        g = 0.0;
        s = 0.0;
        scale = 0.0;
        if i < m && i + 1 != n {
            for k in l..n {
                scale += u[k][i].abs();
            }
            if scale != 0.0 {
                for k in l..n {
                    u[k][i] /= scale;
                    s += u[k][i] * u[k][i];
                }
                let f = u[l][i];
                g = if f < 0.0 {
                    s.sqrt().abs()
                } else {
                    -s.sqrt().abs()
                };
                let h = f * g - s;
                u[l][i] = f - g;
                for k in l..n {
                    rv1[k] = u[k][i] / h;
                }
                for j in l..m {
                    s = 0.0;
                    for k in l..n {
                        s += u[k][i] * u[k][j];
                    }
                    for k in l..n {
                        u[k][j] += rv1[k] * s;
                    }
                }
                for k in l..n {
                    u[k][i] *= scale;
                }
            }
        }
        anorm = anorm.max(rv1[i].abs() + w[i].abs());
    }

    for i_rev in (0..n).rev() {
        let l = i_rev + 1;
        if i_rev < n - 1 {
            if g != 0.0 {
                for j in l..n {
                    v[i_rev][j] = (u[j][i_rev] / u[l][i_rev]) / g;
                }
                for j in l..n {
                    let mut s = 0.0;
                    for k in l..n {
                        s += v[j][k] * u[k][i_rev];
                    }
                    for k in l..n {
                        v[j][k] += v[i_rev][k] * s;
                    }
                }
            }
            for j in l..n {
                v[i_rev][j] = 0.0;
                v[j][i_rev] = 0.0;
            }
        }
        v[i_rev][i_rev] = 1.0;
        g = rv1[i_rev];
    }

    let min_dim = m.min(n);
    for i_rev in (0..min_dim).rev() {
        let l = i_rev + 1;
        let g_here = w[i_rev];
        for j in l..n {
            u[j][i_rev] = 0.0;
        }
        if g_here == 0.0 {
            for j in i_rev..m {
                u[i_rev][j] = 0.0;
            }
        } else {
            let inv_g = 1.0 / g_here;
            for j in l..n {
                let mut s = 0.0;
                for k in l..m {
                    s += u[j][k] * u[i_rev][k];
                }
                let f = (s / u[i_rev][i_rev]) * inv_g;
                for k in i_rev..m {
                    u[j][k] += f * u[i_rev][k];
                }
            }
            for j in i_rev..m {
                u[i_rev][j] *= inv_g;
            }
        }
        u[i_rev][i_rev] += 1.0;
    }

    let mut k = n;
    while k > 0 {
        let k_idx = k - 1;
        for its in 0..30 {
            let mut flag = true;
            let mut l = 0usize;
            for l_rev in (0..=k_idx).rev() {
                l = l_rev;
                if rv1[l].abs() + anorm == anorm {
                    flag = false;
                    break;
                }
                if l == 0 || w[l - 1].abs() + anorm == anorm {
                    break;
                }
            }
            if flag {
                let mut c = 0.0;
                let mut s = 1.0;
                for i in l..=k_idx {
                    let f = s * rv1[i];
                    rv1[i] *= c;
                    if f.abs() + anorm == anorm {
                        break;
                    }
                    let g_local = w[i];
                    let h = dpythag_native_compat(f, g_local);
                    w[i] = h;
                    let inv_h = 1.0 / h;
                    c = g_local * inv_h;
                    s = -f * inv_h;
                    if i > 0 {
                        for j in 0..m {
                            let y = u[l - 1][j];
                            let z = u[i][j];
                            u[l - 1][j] = z * s + y * c;
                            u[i][j] = z * c - y * s;
                        }
                    }
                }
            }

            let z = w[k_idx];
            if l == k_idx {
                if z < 0.0 {
                    w[k_idx] = -z;
                    for j in 0..n {
                        v[k_idx][j] = -v[k_idx][j];
                    }
                }
                break;
            }
            if its == 29 {
                log::warn!("native-compatible SVD did not converge in 30 iterations");
            }
            let mut x = w[l];
            let nm = k_idx - 1;
            let y = w[nm];
            let g_local = rv1[nm];
            let h = rv1[k_idx];
            let mut f =
                ((y - z) * (y + z) + (g_local - h) * (g_local + h)) / ((h + h) * y);
            let mut g2 = dpythag_native_compat(f, 1.0);
            if f < 0.0 {
                g2 = -g2.abs();
            } else {
                g2 = g2.abs();
            }
            f = ((x - z) * (x + z) + h * (y / (f + g2) - h)) / x;
            let mut c = 1.0;
            let mut s = 1.0;
            for j in l..=nm {
                let i = j + 1;
                let mut g_local = rv1[i];
                let y = w[i];
                let mut h = s * g_local;
                g_local *= c;
                let mut z = dpythag_native_compat(f, h);
                rv1[j] = z;
                c = f / z;
                s = h / z;
                f = x * c + g_local * s;
                g_local = g_local * c - x * s;
                h = y * s;
                let y2 = y * c;
                for jj in 0..n {
                    let x_v = v[j][jj];
                    let z_v = v[i][jj];
                    v[j][jj] = z_v * s + x_v * c;
                    v[i][jj] = z_v * c - x_v * s;
                }
                z = dpythag_native_compat(f, h);
                w[j] = z;
                if z != 0.0 {
                    c = f / z;
                    s = h / z;
                }
                f = c * g_local + s * y2;
                x = c * y2 - s * g_local;
                for jj in 0..m {
                    let y_u = u[j][jj];
                    let z_u = u[i][jj];
                    u[j][jj] = z_u * s + y_u * c;
                    u[i][jj] = z_u * c - y_u * s;
                }
            }
            rv1[l] = 0.0;
            rv1[k_idx] = f;
            w[k_idx] = x;
        }
        k -= 1;
    }

    (u, w, v)
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

pub(crate) fn causal_improvement(baseline_rmse: f64, causal_rmse: f64) -> f64 {
    if baseline_rmse.is_nan() || causal_rmse.is_nan() {
        return f64::NAN;
    }
    baseline_rmse - causal_rmse
}

pub(crate) fn conditional_causal_improvement(baseline_rmse: f64, conditioned_rmse: f64) -> f64 {
    if baseline_rmse.is_nan() || conditioned_rmse.is_nan() {
        return f64::NAN;
    }
    baseline_rmse - conditioned_rmse
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
    primary_terms: &[Vec<usize>],
    secondary_terms: &[Vec<usize>],
    window_length: usize,
    max_active_sources: usize,
    svd_backend: SvdBackend,
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
    let mut current_block = solve_channel_with_inputs(
        prepared,
        target_channel,
        &active_inputs,
        primary_terms,
        secondary_terms,
        window_length,
        svd_backend,
    );
    let mut current_bic = bic_like_score(
        current_block.rmse,
        window_length,
        primary_terms.len() + active_inputs.len() * secondary_terms.len(),
    );

    for _ in 0..max_active_sources.min(candidates.len()) {
        let mut best_choice = None;
        for &source in &remaining {
            let mut trial_inputs = active_inputs.clone();
            trial_inputs.push(source);
            let trial_block = solve_channel_with_inputs(
                prepared,
                target_channel,
                &trial_inputs,
                primary_terms,
                secondary_terms,
                window_length,
                svd_backend,
            );
            let trial_bic = bic_like_score(
                trial_block.rmse,
                window_length,
                primary_terms.len() + trial_inputs.len() * secondary_terms.len(),
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
            let without_block = solve_channel_with_inputs(
                prepared,
                target_channel,
                &without_source,
                primary_terms,
                secondary_terms,
                window_length,
                svd_backend,
            );
            (
                source,
                conditional_causal_improvement(without_block.rmse, full_rmse),
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
    n * (rmse * rmse).ln() + k * n.ln()
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
