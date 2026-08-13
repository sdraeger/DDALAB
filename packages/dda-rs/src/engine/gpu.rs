use std::collections::BTreeMap;
use std::mem::size_of;
use std::panic::{catch_unwind, AssertUnwindSafe};

use cudarc::cublas::{sys, CudaBlas};
use cudarc::driver::{CudaContext, DevicePtr, DevicePtrMut};

use crate::error::{DDAError, Result};

use super::solver::{solve_regression_window, RegressionWindow, SolvedBlock};
use super::{CudaDeviceInfo, SvdBackend};

const CUDA_BATCH_SIZE: usize = 512;

pub(super) fn available_devices() -> Vec<CudaDeviceInfo> {
    catch_unwind(AssertUnwindSafe(|| {
        let count = CudaContext::device_count().unwrap_or(0).max(0) as usize;
        (0..count)
            .filter_map(|index| {
                let context = CudaContext::new(index).ok()?;
                Some(CudaDeviceInfo {
                    index,
                    name: context
                        .name()
                        .unwrap_or_else(|_| format!("CUDA device {index}")),
                })
            })
            .collect()
    }))
    .unwrap_or_default()
}

pub(super) fn solve_regression_windows(
    windows: &[RegressionWindow],
    device_index: usize,
    svd_backend: SvdBackend,
) -> Result<Vec<SolvedBlock>> {
    catch_unwind(AssertUnwindSafe(|| {
        solve_regression_windows_inner(windows, device_index, svd_backend)
    }))
    .map_err(|panic| {
        DDAError::ExecutionFailed(format!(
            "CUDA runtime is unavailable: {}",
            panic_message(panic)
        ))
    })?
}

fn solve_regression_windows_inner(
    windows: &[RegressionWindow],
    device_index: usize,
    svd_backend: SvdBackend,
) -> Result<Vec<SolvedBlock>> {
    let context = CudaContext::new(device_index).map_err(|error| cuda_error("device", error))?;
    let stream = context.default_stream();
    let blas = CudaBlas::new(stream.clone()).map_err(|error| cuda_error("cuBLAS", error))?;
    let mut solutions = windows
        .iter()
        .map(|window| SolvedBlock::nan(window.cols))
        .collect::<Vec<_>>();
    let mut groups = BTreeMap::<(usize, usize), Vec<usize>>::new();

    for (index, window) in windows.iter().enumerate() {
        if window.rows == 0 || window.cols == 0 || window.rows < window.cols {
            solutions[index] = solve_regression_window(window, svd_backend);
        } else {
            groups
                .entry((window.rows, window.cols))
                .or_default()
                .push(index);
        }
    }

    for ((rows, cols), indices) in groups {
        for batch in indices.chunks(CUDA_BATCH_SIZE) {
            solve_batch(
                &mut solutions,
                windows,
                batch,
                rows,
                cols,
                &stream,
                &blas,
                svd_backend,
            )?;
        }
    }
    Ok(solutions)
}

#[allow(clippy::too_many_arguments)]
fn solve_batch(
    solutions: &mut [SolvedBlock],
    windows: &[RegressionWindow],
    indices: &[usize],
    rows: usize,
    cols: usize,
    stream: &std::sync::Arc<cudarc::driver::CudaStream>,
    blas: &CudaBlas,
    svd_backend: SvdBackend,
) -> Result<()> {
    let batch_size = indices.len();
    let matrix_stride = rows * cols;
    let mut designs = Vec::with_capacity(matrix_stride * batch_size);
    let mut fit_targets = Vec::with_capacity(rows * batch_size);
    let mut residual_targets = Vec::with_capacity(rows * batch_size);

    for &index in indices {
        let window = &windows[index];
        for col in 0..cols {
            for row in 0..rows {
                designs.push(window.flat_design[row * cols + col]);
            }
        }
        fit_targets.extend_from_slice(&window.fit_target);
        residual_targets.extend_from_slice(&window.residual_target);
    }

    let original_designs = stream
        .clone_htod(&designs)
        .map_err(|error| cuda_error("design upload", error))?;
    let mut solve_designs = stream
        .clone_htod(&designs)
        .map_err(|error| cuda_error("design upload", error))?;
    let mut solve_targets = stream
        .clone_htod(&fit_targets)
        .map_err(|error| cuda_error("target upload", error))?;
    let mut residuals = stream
        .clone_htod(&residual_targets)
        .map_err(|error| cuda_error("residual upload", error))?;
    let mut predictions = stream
        .alloc_zeros::<f64>(rows * batch_size)
        .map_err(|error| cuda_error("prediction allocation", error))?;
    let mut device_info = stream
        .alloc_zeros::<i32>(batch_size)
        .map_err(|error| cuda_error("status allocation", error))?;
    let mut device_norms = stream
        .alloc_zeros::<f64>(batch_size)
        .map_err(|error| cuda_error("norm allocation", error))?;

    let (solve_design_ptr, solve_design_guard) = solve_designs.device_ptr_mut(stream);
    let (solve_target_ptr, solve_target_guard) = solve_targets.device_ptr_mut(stream);
    let matrix_pointers = (0..batch_size)
        .map(|index| byte_offset::<f64>(solve_design_ptr, index * matrix_stride))
        .collect::<Vec<_>>();
    let target_pointers = (0..batch_size)
        .map(|index| byte_offset::<f64>(solve_target_ptr, index * rows))
        .collect::<Vec<_>>();
    let device_matrix_pointers = stream
        .clone_htod(&matrix_pointers)
        .map_err(|error| cuda_error("matrix pointer upload", error))?;
    let device_target_pointers = stream
        .clone_htod(&target_pointers)
        .map_err(|error| cuda_error("target pointer upload", error))?;
    let (matrix_array_ptr, matrix_array_guard) = device_matrix_pointers.device_ptr(stream);
    let (target_array_ptr, target_array_guard) = device_target_pointers.device_ptr(stream);
    let (device_info_ptr, device_info_guard) = device_info.device_ptr_mut(stream);
    let (original_design_ptr, original_design_guard) = original_designs.device_ptr(stream);
    let (prediction_ptr, prediction_guard) = predictions.device_ptr_mut(stream);
    let (residual_ptr, residual_guard) = residuals.device_ptr_mut(stream);
    let (norm_ptr, norm_guard) = device_norms.device_ptr_mut(stream);

    let rows_i32 = as_i32(rows, "row count")?;
    let cols_i32 = as_i32(cols, "feature count")?;
    let batch_i32 = as_i32(batch_size, "batch size")?;
    let total_values_i32 = as_i32(rows * batch_size, "batch row count")?;
    let mut parameter_info = 0_i32;
    let one = 1.0_f64;
    let zero = 0.0_f64;
    let minus_one = -1.0_f64;
    let handle = *blas.handle();

    // All pointers refer to non-overlapping CUDA allocations with the dimensions
    // passed below. The guards keep those allocations synchronized for the calls.
    unsafe {
        sys::cublasDgelsBatched(
            handle,
            sys::cublasOperation_t::CUBLAS_OP_N,
            rows_i32,
            cols_i32,
            1,
            matrix_array_ptr as usize as *const *mut f64,
            rows_i32,
            target_array_ptr as usize as *const *mut f64,
            rows_i32,
            &mut parameter_info,
            device_info_ptr as usize as *mut i32,
            batch_i32,
        )
        .result()
        .map_err(|error| cuda_error("batched least-squares solve", error))?;
        if parameter_info != 0 {
            return Err(DDAError::ExecutionFailed(format!(
                "CUDA batched least-squares rejected parameter {}",
                -parameter_info
            )));
        }
        sys::cublasDgemmStridedBatched(
            handle,
            sys::cublasOperation_t::CUBLAS_OP_N,
            sys::cublasOperation_t::CUBLAS_OP_N,
            rows_i32,
            1,
            cols_i32,
            &one,
            original_design_ptr as usize as *const f64,
            rows_i32,
            matrix_stride as i64,
            solve_target_ptr as usize as *const f64,
            cols_i32,
            rows as i64,
            &zero,
            prediction_ptr as usize as *mut f64,
            rows_i32,
            rows as i64,
            batch_i32,
        )
        .result()
        .map_err(|error| cuda_error("batched prediction", error))?;
        sys::cublasDaxpy_v2(
            handle,
            total_values_i32,
            &minus_one,
            prediction_ptr as usize as *const f64,
            1,
            residual_ptr as usize as *mut f64,
            1,
        )
        .result()
        .map_err(|error| cuda_error("residual computation", error))?;
    }

    blas.set_pointer_mode(sys::cublasPointerMode_t::CUBLAS_POINTER_MODE_DEVICE)
        .map_err(|error| cuda_error("cuBLAS pointer mode", error))?;
    for batch_index in 0..batch_size {
        unsafe {
            sys::cublasDnrm2_v2(
                handle,
                rows_i32,
                byte_offset::<f64>(residual_ptr, batch_index * rows) as usize as *const f64,
                1,
                byte_offset::<f64>(norm_ptr, batch_index) as usize as *mut f64,
            )
            .result()
            .map_err(|error| cuda_error("residual norm", error))?;
        }
    }
    blas.set_pointer_mode(sys::cublasPointerMode_t::CUBLAS_POINTER_MODE_HOST)
        .map_err(|error| cuda_error("cuBLAS pointer mode", error))?;

    drop(norm_guard);
    drop(residual_guard);
    drop(prediction_guard);
    drop(original_design_guard);
    drop(device_info_guard);
    drop(target_array_guard);
    drop(matrix_array_guard);
    drop(solve_target_guard);
    drop(solve_design_guard);

    let host_targets = stream
        .clone_dtoh(&solve_targets)
        .map_err(|error| cuda_error("coefficient download", error))?;
    let host_info = stream
        .clone_dtoh(&device_info)
        .map_err(|error| cuda_error("status download", error))?;
    let host_norms = stream
        .clone_dtoh(&device_norms)
        .map_err(|error| cuda_error("norm download", error))?;

    for (batch_index, &window_index) in indices.iter().enumerate() {
        let coefficients = host_targets[batch_index * rows..batch_index * rows + cols].to_vec();
        let rmse = host_norms[batch_index] / (rows as f64).sqrt();
        solutions[window_index] = if host_info[batch_index] == 0
            && coefficients.iter().all(|value| value.is_finite())
            && rmse.is_finite()
        {
            SolvedBlock { coefficients, rmse }
        } else {
            solve_regression_window(&windows[window_index], svd_backend)
        };
    }
    Ok(())
}

fn byte_offset<T>(pointer: u64, elements: usize) -> u64 {
    pointer + (elements * size_of::<T>()) as u64
}

fn as_i32(value: usize, name: &str) -> Result<i32> {
    i32::try_from(value).map_err(|_| {
        DDAError::InvalidParameter(format!("CUDA {name} exceeds the supported i32 range"))
    })
}

fn cuda_error(context: &str, error: impl std::fmt::Display) -> DDAError {
    DDAError::ExecutionFailed(format!("CUDA {context} failed: {error}"))
}

fn panic_message(panic: Box<dyn std::any::Any + Send>) -> String {
    panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .unwrap_or("failed to load the NVIDIA CUDA libraries")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cuda_matches_cpu_for_full_rank_regressions_when_available() {
        let windows = (0..6)
            .map(|window_index| {
                let mut design = Vec::new();
                let mut target = Vec::new();
                for row in 0..96 {
                    let x = row as f64 / 17.0;
                    let values = [1.0, x.sin(), (0.7 * x).cos()];
                    design.extend_from_slice(&values);
                    target.push(
                        0.5 * values[0] - 1.2 * values[1]
                            + (0.8 + window_index as f64 * 0.01) * values[2],
                    );
                }
                RegressionWindow {
                    rows: 96,
                    cols: 3,
                    flat_design: design,
                    fit_target: target.clone(),
                    residual_target: target,
                }
            })
            .collect::<Vec<_>>();
        let expected = windows
            .iter()
            .map(|window| solve_regression_window(window, SvdBackend::RobustSvd))
            .collect::<Vec<_>>();
        let actual = match solve_regression_windows(&windows, 0, SvdBackend::RobustSvd) {
            Ok(actual) => actual,
            Err(error) if std::env::var_os("DDA_RS_REQUIRE_CUDA_TEST").is_none() => {
                eprintln!("CUDA device not available; skipping runtime parity check: {error}");
                return;
            }
            Err(error) => panic!("CUDA runtime parity test failed: {error}"),
        };

        for (cpu, gpu) in expected.iter().zip(actual.iter()) {
            for (left, right) in cpu.coefficients.iter().zip(&gpu.coefficients) {
                assert!((left - right).abs() <= 1e-8);
            }
            assert!((cpu.rmse - gpu.rmse).abs() <= 1e-10);
        }
    }
}
