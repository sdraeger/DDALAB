//! CUDA normal-equations solver using cuBLAS batched FP64 GEMM and persistent device scratch buffers.
//!
//! Each used channel's term vectors and derivative are built once per window in column-major `f64` and uploaded
//! once per batch. One `cublasDgemmStridedBatched` call computes every channel's `(K + 1) x (K + 1)` Gram block
//! `X_c' X_c`, and when CD/SY pairs are present one `cublasDgemmBatched` call computes the cross blocks `X_a' X_b`.
//! The host downloads only those tiny Gram blocks and solves each problem via `normal_equations` (falling back to
//! CPU SVD for ill-conditioned or near-zero-residual problems).

use std::mem::size_of;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

use cudarc::cublas::{sys, CudaBlas};
use cudarc::driver::{
    CudaContext, CudaSlice, CudaStream, DevicePtr, DevicePtrMut, DeviceRepr, ValidAsZeroBits,
};
use rayon::prelude::*;

use crate::error::{DDAError, Result};

use super::model::ModelSpec;
use super::normal_equations::{
    count_problems, encode_window_f64, solve_from_sums, unpack_gram_to_sums, Layout,
};
use super::regression_batch::{solve_window_on_cpu, BasicJobs, WindowSolutions};
use super::window::PreparedWindow;
use super::CudaDeviceInfo;

/// Upper bound on device memory used by one uploaded window batch.
const MAX_CUDA_BATCH_BYTES: usize = 256 << 20;

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

/// Device buffers reused across chunks and `solve_windows` calls, grown lazily when a larger batch arrives.
#[derive(Default)]
struct Scratch {
    vectors: Option<CudaSlice<f64>>,
    own_grams: Option<CudaSlice<f64>>,
    cross_grams: Option<CudaSlice<f64>>,
    a_ptrs: Option<CudaSlice<u64>>,
    b_ptrs: Option<CudaSlice<u64>>,
    c_ptrs: Option<CudaSlice<u64>>,
}

/// A CUDA context, cuBLAS handle, and persistent scratch buffers reused for every batch of one run.
pub(crate) struct CudaSolver {
    stream: Arc<CudaStream>,
    blas: CudaBlas,
    scratch: Scratch,
    pub(super) problems: usize,
    pub(super) cpu_fallbacks: usize,
}

impl CudaSolver {
    pub(super) fn new(device_index: usize) -> Result<Self> {
        catch_cuda_panic(|| {
            let context =
                CudaContext::new(device_index).map_err(|error| cuda_error("device", error))?;
            let stream = context.default_stream();
            let blas =
                CudaBlas::new(stream.clone()).map_err(|error| cuda_error("cuBLAS", error))?;
            Ok(Self {
                stream,
                blas,
                scratch: Scratch::default(),
                problems: 0,
                cpu_fallbacks: 0,
            })
        })
    }

    pub(super) fn solve_windows(
        &mut self,
        windows: &[PreparedWindow],
        jobs: &BasicJobs<'_>,
        model: &ModelSpec,
    ) -> Result<Vec<WindowSolutions>> {
        catch_cuda_panic(|| self.solve_windows_inner(windows, jobs, model))
    }

    fn solve_windows_inner(
        &mut self,
        windows: &[PreparedWindow],
        jobs: &BasicJobs<'_>,
        model: &ModelSpec,
    ) -> Result<Vec<WindowSolutions>> {
        let layout = Layout::new(jobs, model.primary_terms.len());
        if layout.pairs.is_empty() {
            return Ok(windows
                .iter()
                .map(|window| solve_window_on_cpu(window, jobs, model))
                .collect());
        }

        let rows = model.window_length;
        let cols = layout.terms + 1;
        let channel_count = layout.channels.len();
        let cross_count = layout.cross_pairs.len();

        let encoded: Vec<Option<Vec<f64>>> = windows
            .par_iter()
            .map(|window| encode_window_f64(window, &layout, model))
            .collect();

        let vec_len_per_window = layout.vectors() * rows;
        let own_len_per_window = channel_count * cols * cols;
        let cross_len_per_window = cross_count * cols * cols;
        let bytes_per_window = (vec_len_per_window + own_len_per_window + cross_len_per_window)
            * size_of::<f64>();
        let batch_limit = (MAX_CUDA_BATCH_BYTES / bytes_per_window.max(1)).max(1);

        let gpu_indices: Vec<usize> = (0..windows.len())
            .filter(|&w| encoded[w].is_some())
            .collect();
        let mut sums: Vec<Option<Vec<f64>>> = vec![None; windows.len()];

        for chunk in gpu_indices.chunks(batch_limit) {
            let mut host_vectors = Vec::with_capacity(chunk.len() * vec_len_per_window);
            for &w in chunk {
                host_vectors.extend_from_slice(encoded[w].as_ref().unwrap());
            }
            let (own_grams, cross_grams) =
                self.compute_grams(rows, cols, chunk.len(), &layout, &host_vectors)?;
            for (local_w, &w) in chunk.iter().enumerate() {
                let own_slice = &own_grams
                    [local_w * own_len_per_window..(local_w + 1) * own_len_per_window];
                let cross_slice = if cross_len_per_window > 0 {
                    &cross_grams
                        [local_w * cross_len_per_window..(local_w + 1) * cross_len_per_window]
                } else {
                    &[]
                };
                sums[w] = Some(unpack_gram_to_sums(own_slice, cross_slice, &layout));
            }
        }

        let solved: Vec<(WindowSolutions, usize, usize)> = windows
            .par_iter()
            .zip(&sums)
            .map(|(window, sums)| match sums {
                Some(sums) => solve_from_sums(window, sums, &layout, jobs, model),
                None => {
                    let solutions = solve_window_on_cpu(window, jobs, model);
                    let problems = count_problems(jobs);
                    (solutions, problems, problems)
                }
            })
            .collect();

        Ok(solved
            .into_iter()
            .map(|(solutions, problems, fallbacks)| {
                self.problems += problems;
                self.cpu_fallbacks += fallbacks;
                solutions
            })
            .collect())
    }

    /// Computes all per-channel `(cols x cols)` own Gram blocks and (when present) cross-channel blocks on CUDA
    /// for `window_count` windows whose column-major vectors are packed in `host_vectors`.
    fn compute_grams(
        &mut self,
        rows: usize,
        cols: usize,
        window_count: usize,
        layout: &Layout,
        host_vectors: &[f64],
    ) -> Result<(Vec<f64>, Vec<f64>)> {
        let channel_count = layout.channels.len();
        let cross_count = layout.cross_pairs.len();
        let channel_stride = rows * cols;
        let gram_stride = cols * cols;
        let own_batch = window_count * channel_count;
        let own_len = own_batch * gram_stride;
        let cross_batch = window_count * cross_count;
        let cross_len = cross_batch * gram_stride;

        ensure_buffer(&self.stream, &mut self.scratch.vectors, host_vectors.len(), "vector allocation")?;
        ensure_buffer(&self.stream, &mut self.scratch.own_grams, own_len, "own Gram allocation")?;
        if cross_batch > 0 {
            ensure_buffer(&self.stream, &mut self.scratch.cross_grams, cross_len, "cross Gram allocation")?;
            ensure_buffer(&self.stream, &mut self.scratch.a_ptrs, cross_batch, "pointer A allocation")?;
            ensure_buffer(&self.stream, &mut self.scratch.b_ptrs, cross_batch, "pointer B allocation")?;
            ensure_buffer(&self.stream, &mut self.scratch.c_ptrs, cross_batch, "pointer C allocation")?;
        }

        let vec_buf = self.scratch.vectors.as_mut().unwrap();
        let mut vec_view = vec_buf.slice_mut(..host_vectors.len());
        self.stream
            .memcpy_htod(host_vectors, &mut vec_view)
            .map_err(|error| cuda_error("vector upload", error))?;

        let rows_i32 = as_i32(rows, "row count")?;
        let cols_i32 = as_i32(cols, "column count")?;
        let own_batch_i32 = as_i32(own_batch, "own Gram batch size")?;
        let one = 1.0_f64;
        let zero = 0.0_f64;
        let handle = *self.blas.handle();

        {
            let vec_buf = self.scratch.vectors.as_ref().unwrap();
            let own_buf = self.scratch.own_grams.as_mut().unwrap();
            let (vec_ptr, _vec_guard) = vec_buf.device_ptr(&self.stream);
            let (own_ptr, _own_guard) = own_buf.device_ptr_mut(&self.stream);

            // One strided batched GEMM computes X_c' X_c for every window and channel simultaneously.
            unsafe {
                sys::cublasDgemmStridedBatched(
                    handle,
                    sys::cublasOperation_t::CUBLAS_OP_T,
                    sys::cublasOperation_t::CUBLAS_OP_N,
                    cols_i32,
                    cols_i32,
                    rows_i32,
                    &one,
                    vec_ptr as usize as *const f64,
                    rows_i32,
                    channel_stride as i64,
                    vec_ptr as usize as *const f64,
                    rows_i32,
                    channel_stride as i64,
                    &zero,
                    own_ptr as usize as *mut f64,
                    cols_i32,
                    gram_stride as i64,
                    own_batch_i32,
                )
                .result()
                .map_err(|error| cuda_error("batched own Gram GEMM", error))?;
            }
        }

        if cross_batch > 0 {
            let cross_batch_i32 = as_i32(cross_batch, "cross Gram batch size")?;
            let mut host_a = Vec::with_capacity(cross_batch);
            let mut host_b = Vec::with_capacity(cross_batch);
            let mut host_c = Vec::with_capacity(cross_batch);
            {
                let vec_buf = self.scratch.vectors.as_ref().unwrap();
                let cross_buf = self.scratch.cross_grams.as_ref().unwrap();
                let (vec_ptr, _vec_guard) = vec_buf.device_ptr(&self.stream);
                let (cross_ptr, _cross_guard) = cross_buf.device_ptr(&self.stream);
                for w in 0..window_count {
                    for (p, &(a, b)) in layout.cross_pairs.iter().enumerate() {
                        host_a.push(byte_offset::<f64>(
                            vec_ptr,
                            (w * channel_count + a) * channel_stride,
                        ));
                        host_b.push(byte_offset::<f64>(
                            vec_ptr,
                            (w * channel_count + b) * channel_stride,
                        ));
                        host_c.push(byte_offset::<f64>(
                            cross_ptr,
                            (w * cross_count + p) * gram_stride,
                        ));
                    }
                }
            }
            {
                let a_buf = self.scratch.a_ptrs.as_mut().unwrap();
                let mut a_view = a_buf.slice_mut(..cross_batch);
                self.stream
                    .memcpy_htod(&host_a, &mut a_view)
                    .map_err(|error| cuda_error("pointer A upload", error))?;
            }
            {
                let b_buf = self.scratch.b_ptrs.as_mut().unwrap();
                let mut b_view = b_buf.slice_mut(..cross_batch);
                self.stream
                    .memcpy_htod(&host_b, &mut b_view)
                    .map_err(|error| cuda_error("pointer B upload", error))?;
            }
            {
                let c_buf = self.scratch.c_ptrs.as_mut().unwrap();
                let mut c_view = c_buf.slice_mut(..cross_batch);
                self.stream
                    .memcpy_htod(&host_c, &mut c_view)
                    .map_err(|error| cuda_error("pointer C upload", error))?;
            }
            let vec_buf = self.scratch.vectors.as_ref().unwrap();
            let cross_buf = self.scratch.cross_grams.as_mut().unwrap();
            let a_buf = self.scratch.a_ptrs.as_ref().unwrap();
            let b_buf = self.scratch.b_ptrs.as_ref().unwrap();
            let c_buf = self.scratch.c_ptrs.as_ref().unwrap();
            let (_vec_ptr, _vec_guard) = vec_buf.device_ptr(&self.stream);
            let (_cross_ptr, _cross_guard) = cross_buf.device_ptr_mut(&self.stream);
            let (a_arr_ptr, _a_guard) = a_buf.device_ptr(&self.stream);
            let (b_arr_ptr, _b_guard) = b_buf.device_ptr(&self.stream);
            let (c_arr_ptr, _c_guard) = c_buf.device_ptr(&self.stream);
            unsafe {
                sys::cublasDgemmBatched(
                    handle,
                    sys::cublasOperation_t::CUBLAS_OP_T,
                    sys::cublasOperation_t::CUBLAS_OP_N,
                    cols_i32,
                    cols_i32,
                    rows_i32,
                    &one,
                    a_arr_ptr as usize as *const *const f64,
                    rows_i32,
                    b_arr_ptr as usize as *const *const f64,
                    rows_i32,
                    &zero,
                    c_arr_ptr as usize as *const *mut f64,
                    cols_i32,
                    cross_batch_i32,
                )
                .result()
                .map_err(|error| cuda_error("batched cross Gram GEMM", error))?;
            }
        }

        let mut host_own = vec![0.0_f64; own_len];
        {
            let own_buf = self.scratch.own_grams.as_ref().unwrap();
            let own_view = own_buf.slice(..own_len);
            self.stream
                .memcpy_dtoh(&own_view, &mut host_own)
                .map_err(|error| cuda_error("own Gram download", error))?;
        }

        let mut host_cross = vec![0.0_f64; cross_len];
        if cross_len > 0 {
            let cross_buf = self.scratch.cross_grams.as_ref().unwrap();
            let cross_view = cross_buf.slice(..cross_len);
            self.stream
                .memcpy_dtoh(&cross_view, &mut host_cross)
                .map_err(|error| cuda_error("cross Gram download", error))?;
        }

        Ok((host_own, host_cross))
    }
}

fn ensure_buffer<T: DeviceRepr + ValidAsZeroBits>(
    stream: &Arc<CudaStream>,
    slot: &mut Option<CudaSlice<T>>,
    min_len: usize,
    context: &str,
) -> Result<()> {
    if slot.as_ref().is_none_or(|buf| buf.len() < min_len) {
        *slot = Some(
            stream
                .alloc_zeros::<T>(min_len)
                .map_err(|error| cuda_error(context, error))?,
        );
    }
    Ok(())
}

fn catch_cuda_panic<T>(run: impl FnOnce() -> Result<T>) -> Result<T> {
    catch_unwind(AssertUnwindSafe(run)).map_err(|panic| {
        DDAError::ExecutionFailed(format!(
            "CUDA runtime is unavailable: {}",
            panic_message(panic)
        ))
    })?
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
    use crate::engine::solver::SolvedBlock;

    #[test]
    fn cuda_matches_cpu_for_all_basic_flavors_when_available() {
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
        let samples: Vec<Vec<f64>> = (0..raw_rows * 3)
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
        let windows: Vec<PreparedWindow> = (0..3)
            .map(|w| {
                PreparedWindow::from_raw(&samples[w * raw_rows..(w + 1) * raw_rows], &model)
                    .unwrap()
            })
            .collect();
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

        let actual = match CudaSolver::new(0)
            .and_then(|mut solver| solver.solve_windows(&windows, &jobs, &model))
        {
            Ok(actual) => actual,
            Err(error) if std::env::var_os("DDA_RS_REQUIRE_CUDA_TEST").is_none() => {
                eprintln!("CUDA device not available; skipping runtime parity check: {error}");
                return;
            }
            Err(error) => panic!("CUDA runtime parity test failed: {error}"),
        };

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
        for (window, gpu) in windows.iter().zip(&actual) {
            let cpu = solve_window_on_cpu(window, &jobs, &model);
            for (c, g) in cpu.st.iter().flatten().zip(gpu.st.iter().flatten()) {
                close(c, g);
            }
            for (c, g) in [
                (&cpu.ct, &gpu.ct),
                (&cpu.de, &gpu.de),
                (&cpu.cd, &gpu.cd),
                (&cpu.sy_forward, &gpu.sy_forward),
                (&cpu.sy_reverse, &gpu.sy_reverse),
            ] {
                assert_eq!(c.len(), g.len());
                c.iter().zip(g).for_each(|(c, g)| close(c, g));
            }
        }
    }
}
