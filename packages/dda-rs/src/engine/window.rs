use crate::error::{DDAError, Result};
use rayon::prelude::*;

use super::model::ModelSpec;
use super::{NormalizationMode, PureRustOptions, PARALLEL_BATCH_MIN_LEN};

#[derive(Debug, Clone)]
pub(crate) struct PreparedWindow {
    pub(crate) shifted: Vec<Vec<f64>>,
    pub(crate) deriv: Vec<Vec<f64>>,
    pub(crate) max_delay: usize,
}

impl PreparedWindow {
    pub(crate) fn from_raw(
        raw_window: &[Vec<f64>],
        model: &ModelSpec,
        options: &PureRustOptions,
    ) -> Result<Self> {
        if raw_window.is_empty() {
            return Err(DDAError::InvalidParameter(
                "Raw DDA window is empty".to_string(),
            ));
        }
        let mut data = raw_window.to_vec();
        // ±inf would slip past the NaN checks and stall the SVD; treat it as missing
        for value in data.iter_mut().flatten() {
            if value.is_infinite() {
                *value = f64::NAN;
            }
        }
        apply_nan_runs(&mut data, options.nr_exclude);
        let derivative = deriv_all_2d(&data, model.dm, options.derivative_step)?;
        normalize_window(
            &data,
            &derivative,
            model.dm,
            model.max_delay,
            options.normalization_mode,
        )
    }
}

// Column-wise traversal is intentional because samples are stored row-major.
#[allow(clippy::needless_range_loop)]
fn apply_nan_runs(data: &mut [Vec<f64>], nr_exclude: usize) {
    if nr_exclude == 0 || data.is_empty() {
        return;
    }
    let rows = data.len();
    let cols = data[0].len();
    for col in 0..cols {
        let mut runs = Vec::new();
        let mut current_start = None;
        let mut current_len = 1usize;
        for row in 1..rows {
            if data[row - 1][col] == data[row][col] {
                if current_start.is_none() {
                    current_start = Some(row - 1);
                }
                current_len += 1;
                if row == rows - 1 && current_len >= nr_exclude {
                    runs.push((current_start.unwrap_or(row - 1), row + 1));
                }
            } else if current_len >= nr_exclude {
                runs.push((current_start.unwrap_or(row - 1), row));
                current_start = None;
                current_len = 1;
            } else {
                current_start = None;
                current_len = 1;
            }
        }
        for (start, end) in runs {
            for row in &mut data[start..end] {
                row[col] = f64::NAN;
            }
        }
    }
}

fn deriv_all_2d(data: &[Vec<f64>], dm: usize, step: usize) -> Result<Vec<Vec<f64>>> {
    if data.is_empty() {
        return Err(DDAError::InvalidParameter(
            "Cannot derive an empty DDA window".to_string(),
        ));
    }
    let rows = data.len();
    let cols = data[0].len();
    if rows <= 2 * dm {
        return Err(DDAError::InvalidParameter(format!(
            "Need more than 2*dm={} rows for derivative computation, got {}",
            2 * dm,
            rows
        )));
    }
    let step = step.max(1);
    let stencil_count = dm / step;
    if stencil_count == 0 {
        return Err(DDAError::InvalidParameter(format!(
            "Invalid derivative_step={} for dm={}",
            step, dm
        )));
    }

    let effective_rows = rows - 2 * dm;
    let mut derivative = vec![vec![f64::NAN; effective_rows]; cols];
    let fill_column = |(col, deriv_column): (usize, &mut Vec<f64>)| {
        for center in dm..(rows - dm) {
            let mut valid = !data[center][col].is_nan();
            let mut value = 0.0;
            for stencil in 1..=stencil_count {
                let offset = stencil * step;
                let plus = data[center + offset][col];
                let minus = data[center - offset][col];
                if plus.is_nan() || minus.is_nan() {
                    valid = false;
                }
                if valid {
                    value += (plus - minus) / (stencil as f64);
                }
            }
            deriv_column[center - dm] = if valid {
                value / (stencil_count as f64)
            } else {
                f64::NAN
            };
        }
    };
    if cols >= PARALLEL_BATCH_MIN_LEN {
        derivative.par_iter_mut().enumerate().for_each(fill_column);
    } else {
        derivative.iter_mut().enumerate().for_each(fill_column);
    }
    Ok(derivative)
}

fn normalize_window(
    raw: &[Vec<f64>],
    derivative: &[Vec<f64>],
    dm: usize,
    max_delay: usize,
    mode: NormalizationMode,
) -> Result<PreparedWindow> {
    let rows = raw.len();
    let cols = raw[0].len();
    let shifted_rows = rows
        .checked_sub(2 * dm)
        .ok_or_else(|| DDAError::InvalidParameter("Invalid shifted row count".to_string()))?;
    let window_length = shifted_rows.checked_sub(max_delay).ok_or_else(|| {
        DDAError::InvalidParameter("Window length became negative after max(TAU) trim".to_string())
    })?;
    let mut shifted = raw[dm..dm + shifted_rows].to_vec();
    let trimmed = |col: usize| &derivative[col][max_delay..max_delay + window_length];

    // Column statistics accumulate row by row because samples are stored row-major
    let (center, scale) = match mode {
        NormalizationMode::Raw => {
            let deriv = (0..cols).map(|col| trimmed(col).to_vec()).collect();
            return Ok(PreparedWindow {
                shifted,
                deriv,
                max_delay,
            });
        }
        NormalizationMode::MinMax => {
            let mut min_values = vec![f64::INFINITY; cols];
            let mut max_values = vec![f64::NEG_INFINITY; cols];
            for row in &shifted {
                for (col, &value) in row.iter().enumerate() {
                    if !value.is_nan() {
                        min_values[col] = min_values[col].min(value);
                        max_values[col] = max_values[col].max(value);
                    }
                }
            }
            let ranges = max_values
                .iter()
                .zip(&min_values)
                .map(|(max_value, min_value)| max_value - min_value)
                .collect::<Vec<_>>();
            (min_values, ranges)
        }
        NormalizationMode::ZScore => {
            let mut sums = vec![0.0; cols];
            let mut counts = vec![0usize; cols];
            for row in &shifted {
                for (col, &value) in row.iter().enumerate() {
                    if !value.is_nan() {
                        sums[col] += value;
                        counts[col] += 1;
                    }
                }
            }
            let means = sums
                .iter()
                .zip(&counts)
                .map(|(sum, &count)| sum / (count as f64))
                .collect::<Vec<_>>();
            let mut squares = vec![0.0; cols];
            for row in &shifted {
                for (col, &value) in row.iter().enumerate() {
                    if !value.is_nan() {
                        squares[col] += (value - means[col]).powi(2);
                    }
                }
            }
            let deviations = squares
                .iter()
                .zip(&counts)
                .map(|(square, &count)| {
                    if count < 2 {
                        f64::NAN
                    } else {
                        (square / ((count - 1) as f64)).sqrt()
                    }
                })
                .collect::<Vec<_>>();
            (means, deviations)
        }
    };
    let usable = |col: usize| scale[col].is_finite() && scale[col] != 0.0;

    for row in &mut shifted {
        for (col, value) in row.iter_mut().enumerate() {
            if usable(col) {
                *value = (*value - center[col]) / scale[col];
            }
        }
    }
    let deriv = (0..cols)
        .map(|col| {
            if usable(col) {
                trimmed(col)
                    .iter()
                    .map(|value| value / scale[col])
                    .collect()
            } else {
                vec![f64::NAN; window_length]
            }
        })
        .collect();

    Ok(PreparedWindow {
        shifted,
        deriv,
        max_delay,
    })
}
