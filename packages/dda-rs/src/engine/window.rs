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
    let mut shifted = vec![vec![f64::NAN; cols]; shifted_rows];
    let mut trimmed_deriv = vec![vec![f64::NAN; window_length]; cols];

    for col in 0..cols {
        for (row, shifted_row) in shifted.iter_mut().enumerate() {
            shifted_row[col] = raw[row + dm][col];
        }
        match mode {
            NormalizationMode::Raw => {
                trimmed_deriv[col]
                    .copy_from_slice(&derivative[col][max_delay..max_delay + window_length]);
            }
            NormalizationMode::MinMax | NormalizationMode::ZScore => {
                let (center, scale) = match mode {
                    NormalizationMode::MinMax => {
                        let (min_value, max_value) = shifted
                            .iter()
                            .map(|row| row[col])
                            .filter(|value| !value.is_nan())
                            .fold(
                                (f64::INFINITY, f64::NEG_INFINITY),
                                |(min_value, max_value), value| {
                                    (min_value.min(value), max_value.max(value))
                                },
                            );
                        (min_value, max_value - min_value)
                    }
                    NormalizationMode::ZScore => {
                        let valid_values = shifted
                            .iter()
                            .map(|row| row[col])
                            .filter(|value| !value.is_nan())
                            .collect::<Vec<_>>();
                        if valid_values.len() < 2 {
                            continue;
                        }
                        let mean = valid_values.iter().sum::<f64>() / (valid_values.len() as f64);
                        let variance = valid_values
                            .iter()
                            .map(|value| (value - mean).powi(2))
                            .sum::<f64>()
                            / ((valid_values.len() - 1) as f64);
                        (mean, variance.sqrt())
                    }
                    NormalizationMode::Raw => unreachable!(),
                };
                if !scale.is_finite() || scale == 0.0 {
                    continue;
                }
                for shifted_row in &mut shifted {
                    shifted_row[col] = (shifted_row[col] - center) / scale;
                }
                for (normalized, derivative) in trimmed_deriv[col]
                    .iter_mut()
                    .zip(derivative[col].iter().skip(max_delay).take(window_length))
                {
                    *normalized = *derivative / scale;
                }
            }
        }
    }

    Ok(PreparedWindow {
        shifted,
        deriv: trimmed_deriv,
        max_delay,
    })
}
