//! DDA on any graphics card through wgpu: Vulkan (AMD, NVIDIA, Intel), Metal (Apple) and DX12.
//!
//! Every basic flavor fits least squares on designs built from one window's channels: ST on one channel's model
//! terms T_c and derivative d_c, CT and DE on the rows of a group's channels stacked, CD and SY on [T_s, T_f] against
//! d_f. Their normal equations are therefore sums of a few dot products per window: each used channel's own (T_c'T_c,
//! T_c'd_c, d_c'd_c) and, for the pairs CD and SY fit, the cross products (T_a'T_b, T_a'd_b, T_b'd_a). The host
//! uploads each used channel's term vectors and derivative once per window, the GPU computes those dot products
//! exactly in integers (gpu_sums.wgsl), and the host assembles and solves each problem's small system in f64. Apple
//! GPUs have no f64, consumer cards run it slowly, and Metal compiles with fast math, which erases the rounding
//! errors emulated f64 keeps; integers have no rounding to erase.
//!
//! A window with a missing sample in a used channel runs on the CPU, and so does a problem whose sums cannot give the
//! CPU's solution to about 1e-9: an ill-conditioned system, a near-perfect fit, or one whose singular values the CPU's
//! SVD would truncate.

use std::collections::HashMap;
use std::sync::mpsc;

use nalgebra::{DMatrix, DVector};
use rayon::prelude::*;
use wgpu::util::DeviceExt;

use crate::error::{DDAError, Result};

use super::model::ModelSpec;
use super::regression_batch::{solve_window_on_cpu, BasicJobs, WindowSolutions};
use super::solver::{
    build_directed_regression_window, build_group_regression_window, solve_regression_window,
    SolvedBlock,
};
use super::window::PreparedWindow;
use super::{GpuDeviceInfo, SvdBackend};

/// The largest buffer one batch binds; the adapter's own limit when that is lower.
const MAX_BINDING: u64 = 256 << 20;
/// Rounding the inputs to 2^-46 of each vector's largest value leaves the sums a relative error near 1e-13
/// (`sums_match_f64`), which a system's condition multiplies into its coefficients and a fit's cancellation into its
/// error: past these bounds the 1e-9 is lost and the CPU solves.
const MAX_CONDITION: f64 = 1e4;
const MIN_RESIDUAL_SHARE: f64 = 1e-4;
const FRACTION_BITS: i32 = 46;

/// The graphics cards wgpu reaches, discrete before integrated; software rasterizers are left out.
fn adapters() -> Vec<wgpu::Adapter> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());
    let mut seen = Vec::new();
    let mut adapters: Vec<wgpu::Adapter> =
        pollster::block_on(instance.enumerate_adapters(wgpu::Backends::PRIMARY))
            .into_iter()
            .filter(|adapter| {
                let info = adapter.get_info();
                // One card reached through two backends (Vulkan and DX12 on Windows) counts once.
                let key = (info.vendor, info.device, info.name.clone());
                info.device_type != wgpu::DeviceType::Cpu && !seen.contains(&key) && {
                    seen.push(key);
                    true
                }
            })
            .collect();
    adapters.sort_by_key(|adapter| match adapter.get_info().device_type {
        wgpu::DeviceType::DiscreteGpu => 0,
        wgpu::DeviceType::IntegratedGpu => 1,
        _ => 2,
    });
    adapters
}

pub(super) fn available_devices() -> Vec<GpuDeviceInfo> {
    adapters()
        .iter()
        .enumerate()
        .map(|(index, adapter)| {
            let info = adapter.get_info();
            GpuDeviceInfo {
                index,
                name: info.name,
                backend: info.backend.to_string(),
            }
        })
        .collect()
}

/// The power of two that brings the largest magnitude of `values` into [1, 2), where 47 bits hold them to 2^-46;
/// scaling by it is exact.
fn scale_of(values: &[f64]) -> f64 {
    let largest = values.iter().fold(0.0_f64, |max, v| max.max(v.abs()));
    if largest > 0.0 {
        2.0_f64.powi(-(largest.log2().floor() as i32))
    } else {
        1.0
    }
}

/// `x` (below 2 in magnitude) rounded to a multiple of 2^-46, as the shader reads it: limbs 0 and 1 of its magnitude
/// in the first word, limb 2 and the sign (bit 31) in the second.
fn fixed(x: f64) -> [u32; 2] {
    let q = (x * 2.0_f64.powi(FRACTION_BITS)).round() as i64;
    let m = q.unsigned_abs();
    [
        (m & 0xffff_ffff) as u32,
        (m >> 32) as u32 | (u32::from(q < 0) << 31),
    ]
}

/// A sum from the shader's 20 words: positive minus negative products, each the five limb positions' low words and
/// carries at weights 2^(16 k), in units of 2^-92.
fn sum_of(words: &[u32]) -> f64 {
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
struct Layout {
    terms: usize,
    channels: Vec<usize>,
    slot: HashMap<usize, usize>,
    own: Vec<usize>,
    cross: HashMap<(usize, usize), usize>,
    pairs: Vec<[u32; 2]>,
}

impl Layout {
    fn new(jobs: &BasicJobs<'_>, terms: usize) -> Self {
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
        let slot: HashMap<usize, usize> =
            channels.iter().enumerate().map(|(i, &c)| (c, i)).collect();
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
        for &[x, y] in jobs.cd_pairs.iter().chain(jobs.sy_pairs) {
            let (a, b) = (slot[&x.min(y)], slot[&x.max(y)]);
            if a == b || cross.contains_key(&(a, b)) {
                continue;
            }
            cross.insert((a, b), pairs.len());
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
            pairs,
        }
    }

    fn vectors(&self) -> usize {
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

    /// T_a[k]'T_b[l] for slots a != b.
    fn cross_tt(&self, s: &[f64], a: usize, b: usize, k: usize, l: usize) -> f64 {
        let n = self.terms;
        if a < b {
            s[self.cross[&(a, b)] + k * n + l]
        } else {
            s[self.cross[&(b, a)] + l * n + k]
        }
    }

    /// T_a[k]'d_b for slots a != b.
    fn cross_td(&self, s: &[f64], a: usize, b: usize, k: usize) -> f64 {
        let n = self.terms;
        if a < b {
            s[self.cross[&(a, b)] + n * n + k]
        } else {
            s[self.cross[&(b, a)] + n * n + n + k]
        }
    }

    /// The normal equations of a group's stacked rows: X'X, X'y, X'r, r'r and the row count.
    fn group(&self, s: &[f64], channels: &[usize], rows: usize) -> Normal {
        let n = self.terms;
        let mut normal = Normal::zeros(n, rows * channels.len());
        for &channel in channels {
            let c = self.slot[&channel];
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
    fn directed(
        &self,
        s: &[f64],
        fit: usize,
        source: usize,
        response: usize,
        rows: usize,
    ) -> Normal {
        let n = self.terms;
        let (f, src, r) = (self.slot[&fit], self.slot[&source], self.slot[&response]);
        let mut normal = Normal::zeros(2 * n, rows);
        for k in 0..n {
            for l in 0..n {
                normal.gram[(k, l)] = self.tt(s, src, k, l);
                normal.gram[(n + k, n + l)] = self.tt(s, f, k, l);
                normal.gram[(k, n + l)] = self.cross_tt(s, src, f, k, l);
                normal.gram[(n + l, k)] = normal.gram[(k, n + l)];
            }
            normal.xy[k] = self.cross_td(s, src, f, k);
            normal.xy[n + k] = self.td(s, f, k);
            normal.xr[k] = if r == src {
                self.td(s, src, k)
            } else {
                normal.xy[k]
            };
            normal.xr[n + k] = if r == f {
                normal.xy[n + k]
            } else {
                self.cross_td(s, f, r, k)
            };
        }
        normal.rr = self.dd(s, r);
        normal
    }
}

/// X'X, X'y, X'r and r'r of one least-squares problem with `rows` rows: y the fit target, r the residual target.
struct Normal {
    gram: DMatrix<f64>,
    xy: DVector<f64>,
    xr: DVector<f64>,
    rr: f64,
    rows: usize,
}

impl Normal {
    fn zeros(cols: usize, rows: usize) -> Self {
        Self {
            gram: DMatrix::zeros(cols, cols),
            xy: DVector::zeros(cols),
            xr: DVector::zeros(cols),
            rr: 0.0,
            rows,
        }
    }

    /// The coefficients and fit error, `None` when the sums cannot give the CPU's to about 1e-9.
    fn solve(&self) -> Option<SolvedBlock> {
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
        if low.is_nan() || low <= 0.0 || high / low > MAX_CONDITION {
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
        if rss < MIN_RESIDUAL_SHARE * self.rr {
            return None;
        }
        let rmse = (rss / self.rows as f64).sqrt();
        let coefficients: Vec<f64> = beta.iter().copied().collect();
        (coefficients.iter().all(|v| v.is_finite()) && rmse.is_finite())
            .then_some(SolvedBlock { coefficients, rmse })
    }
}

/// One window's vectors as the shader reads them, and the power of two each was scaled by.
type Scaled = (Vec<[u32; 2]>, Vec<f64>);

/// A device and the sums pipeline, reused for every batch of one run.
pub(crate) struct GpuSumsSolver {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    max_binding: u64,
    max_groups: u64,
    pub(super) problems: usize,
    pub(super) cpu_fallbacks: usize,
}

impl GpuSumsSolver {
    pub(super) fn new(device_index: usize) -> Result<Self> {
        let mut adapters = adapters();
        let count = adapters.len();
        if device_index >= count {
            return Err(DDAError::ExecutionFailed(format!(
                "graphics card {device_index} requested; wgpu found {count}"
            )));
        }
        let adapter = adapters.swap_remove(device_index);
        let limits = adapter.limits();
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("dda sums"),
            required_limits: limits.clone(),
            ..Default::default()
        }))
        .map_err(|error| gpu_error("device", error))?;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("dda sums"),
            source: wgpu::ShaderSource::Wgsl(include_str!("gpu_sums.wgsl").into()),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("dda sums"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        Ok(Self {
            device,
            queue,
            pipeline,
            max_binding: MAX_BINDING
                .min(limits.max_storage_buffer_binding_size)
                .min(limits.max_buffer_size),
            max_groups: limits.max_compute_workgroups_per_dimension as u64,
            problems: 0,
            cpu_fallbacks: 0,
        })
    }

    /// The basic flavors' solutions of `windows`, as `solve_window_on_cpu` gives them.
    pub(super) fn solve_windows(
        &mut self,
        windows: &[PreparedWindow],
        jobs: &BasicJobs<'_>,
        model: &ModelSpec,
        svd_backend: SvdBackend,
    ) -> Result<Vec<WindowSolutions>> {
        let terms = &model.primary_terms;
        let layout = Layout::new(jobs, terms.len());
        // Only CCD-family variants: no basic problem, so nothing for the GPU (empty buffers would fail validation).
        if layout.pairs.is_empty() {
            return Ok(windows
                .iter()
                .map(|window| solve_window_on_cpu(window, jobs, model, svd_backend))
                .collect());
        }
        let rows = model.window_length;
        // Per window, the scaled vectors of every used channel and their scales; `None` when a used channel misses
        // a sample, which the CPU handles.
        let vectors: Vec<Option<Scaled>> = windows
            .par_iter()
            .map(|window| {
                let mut data = Vec::with_capacity(layout.vectors() * rows);
                let mut scales = Vec::with_capacity(layout.vectors());
                for &channel in &layout.channels {
                    let derivative = window.deriv[channel].get(..rows)?;
                    let columns = terms.iter().map(|term| {
                        (0..rows)
                            .map(|sample| {
                                term.iter()
                                    .map(|&delay| {
                                        window.shifted[sample + window.max_delay - delay][channel]
                                    })
                                    .product::<f64>()
                            })
                            .collect::<Vec<f64>>()
                    });
                    for column in columns.chain([derivative.to_vec()]) {
                        if column.iter().any(|v| !v.is_finite()) {
                            return None;
                        }
                        let scale = scale_of(&column);
                        data.extend(column.iter().map(|&v| fixed(v * scale)));
                        scales.push(scale);
                    }
                }
                Some((data, scales))
            })
            .collect();
        // Each window binds its vectors and receives 80 bytes per sum: the larger bounds the batch.
        let per_window = (layout.vectors() * rows * 8).max(layout.pairs.len() * 80) as u64;
        let batch = (self.max_binding / per_window).max(1) as usize;
        let gpu: Vec<usize> = (0..windows.len())
            .filter(|&w| vectors[w].is_some())
            .collect();
        let mut sums: Vec<Option<Vec<f64>>> = vec![None; windows.len()];
        for chunk in gpu.chunks(batch) {
            let data: Vec<[u32; 2]> = chunk
                .iter()
                .flat_map(|&w| vectors[w].as_ref().unwrap().0.iter().copied())
                .collect();
            let raw = self.run(rows, layout.vectors(), chunk.len(), &layout.pairs, &data)?;
            for (&w, raw) in chunk.iter().zip(raw.chunks(layout.pairs.len())) {
                let scales = &vectors[w].as_ref().unwrap().1;
                let unscaled = layout
                    .pairs
                    .iter()
                    .zip(raw)
                    .map(|(&[p, q], &v)| v / (scales[p as usize] * scales[q as usize]))
                    .collect();
                sums[w] = Some(unscaled);
            }
        }
        let solved: Vec<(WindowSolutions, usize, usize)> = windows
            .par_iter()
            .zip(&sums)
            .map(|(window, sums)| match sums {
                Some(sums) => solve_from_sums(window, sums, &layout, jobs, model, svd_backend),
                None => {
                    let solutions = solve_window_on_cpu(window, jobs, model, svd_backend);
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

    /// The dot products `pairs` names of each of `windows` windows of `vectors` vectors of `rows` rows in `data`.
    fn run(
        &self,
        rows: usize,
        vectors: usize,
        windows: usize,
        pairs: &[[u32; 2]],
        data: &[[u32; 2]],
    ) -> Result<Vec<f64>> {
        let device = &self.device;
        let storage = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        let words = |values: &[[u32; 2]]| -> Vec<u8> {
            values
                .iter()
                .flatten()
                .flat_map(|v| v.to_le_bytes())
                .collect()
        };
        let params: Vec<u8> = [rows, vectors, windows, pairs.len()]
            .iter()
            .flat_map(|&v| (v as u32).to_le_bytes())
            .collect();
        let params = storage("params", &params, wgpu::BufferUsages::UNIFORM);
        let data = storage("data", &words(data), wgpu::BufferUsages::STORAGE);
        let pairs_buffer = storage("pairs", &words(pairs), wgpu::BufferUsages::STORAGE);
        let count = windows * pairs.len();
        let size = (count * 20 * 4) as u64;
        let sums = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sums"),
            size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("dda sums"),
            layout: &self.pipeline.get_bind_group_layout(0),
            entries: &[(0, &params), (1, &data), (2, &pairs_buffer), (3, &sums)].map(
                |(binding, buffer)| wgpu::BindGroupEntry {
                    binding,
                    resource: buffer.as_entire_binding(),
                },
            ),
        });
        // One workgroup per sum (gpu_sums.wgsl).
        let groups = count as u64;
        let x = groups.min(self.max_groups);
        let y = groups.div_ceil(x);
        if y > self.max_groups {
            return Err(DDAError::ExecutionFailed(format!(
                "GPU batch of {count} sums exceeds the dispatch limit"
            )));
        }
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&Default::default());
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(x as u32, y as u32, 1);
        }
        encoder.copy_buffer_to_buffer(&sums, 0, &readback, 0, size);
        self.queue.submit([encoder.finish()]);
        let slice = readback.slice(..);
        let (sender, receiver) = mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |result| {
            let _ = sender.send(result);
        });
        device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .map_err(|error| gpu_error("wait", error))?;
        receiver
            .recv()
            .map_err(|error| gpu_error("readback", error))?
            .map_err(|error| gpu_error("readback", error))?;
        let values = slice
            .get_mapped_range()
            .map_err(|error| gpu_error("readback", error))?
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b))
            .collect::<Vec<u32>>()
            .as_chunks::<20>()
            .0
            .iter()
            .map(|words| sum_of(words))
            .collect();
        readback.unmap();
        Ok(values)
    }
}

fn count_problems(jobs: &BasicJobs<'_>) -> usize {
    jobs.st_channels.len()
        + jobs.ct_groups.len()
        + jobs.de_groups.len()
        + jobs.cd_pairs.len()
        + 2 * jobs.sy_pairs.len()
}

/// One window's solutions from its sums, the problems it held and how many of them the CPU solved.
fn solve_from_sums(
    window: &PreparedWindow,
    sums: &[f64],
    layout: &Layout,
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
    svd_backend: SvdBackend,
) -> (WindowSolutions, usize, usize) {
    let rows = model.window_length;
    let fallbacks = std::cell::Cell::new(0);
    let or_cpu = |normal: Normal, build: &dyn Fn() -> super::solver::RegressionWindow| {
        normal.solve().unwrap_or_else(|| {
            fallbacks.set(fallbacks.get() + 1);
            solve_regression_window(&build(), svd_backend)
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
            return solve_regression_window(&problem, svd_backend);
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

fn gpu_error(context: &str, error: impl std::fmt::Display) -> DDAError {
    DDAError::ExecutionFailed(format!("GPU {context} failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::PureRustOptions;

    fn solver() -> Option<GpuSumsSolver> {
        match GpuSumsSolver::new(0) {
            Ok(solver) => Some(solver),
            Err(error) if std::env::var_os("DDA_RS_REQUIRE_GPU_TEST").is_none() => {
                eprintln!("no graphics card; skipping: {error}");
                None
            }
            Err(error) => panic!("GPU test failed: {error}"),
        }
    }

    /// The GPU's dot products equal f64 ones to 1e-12: only rounding the inputs to 2^-46 separates them.
    #[test]
    fn sums_match_f64() {
        let Some(solver) = solver() else { return };
        let (rows, vectors, windows) = (3000, 4, 3);
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
        let sums = solver.run(rows, vectors, windows, &pairs, &data).unwrap();
        for w in 0..windows {
            for (s, &[p, q]) in pairs.iter().enumerate() {
                let exact: f64 = (0..rows)
                    .map(|r| value(w, p as usize, r) * value(w, q as usize, r))
                    .sum();
                let gpu = sums[w * pairs.len() + s];
                let error = (gpu - exact).abs() / exact.abs();
                assert!(
                    error < 1e-12,
                    "window {w} sum {s}: {gpu} vs {exact} ({error:e})"
                );
            }
        }
    }

    /// A run with only CCD-family variants leaves the basic jobs empty: no GPU work, and no panic.
    #[test]
    fn empty_jobs_solve_without_gpu_work() {
        let Some(mut solver) = solver() else { return };
        let model = ModelSpec {
            dm: 4,
            window_length: 200,
            window_step: 100,
            max_delay: 10,
            primary_terms: vec![vec![7], vec![10]],
            secondary_terms: vec![vec![7], vec![10]],
        };
        let rows = model.window_length + model.max_delay + 2 * model.dm;
        let raw: Vec<Vec<f64>> = (0..rows)
            .map(|t| vec![(t as f64 * 0.3).sin(), (t as f64 * 0.7).cos()])
            .collect();
        let window = PreparedWindow::from_raw(&raw, &model, &PureRustOptions::default()).unwrap();
        let jobs = BasicJobs {
            channel_count: 2,
            st_channels: &[],
            ct_groups: &[],
            de_groups: &[],
            cd_pairs: &[],
            sy_pairs: &[],
        };
        let solved = solver
            .solve_windows(&[window], &jobs, &model, SvdBackend::RobustSvd)
            .unwrap();
        assert_eq!(solved.len(), 1);
    }

    /// Every basic flavor's solutions from the GPU equal the CPU's (`solve_window_on_cpu`) to 1e-6, the accuracy of
    /// the CPU's SVD on such windows (its truncation aside): each coefficient's error relative to the largest of its
    /// problem, and the fit error relative; and most problems run on the GPU.
    #[test]
    fn windows_match_cpu() {
        let Some(mut solver) = solver() else { return };
        let model = ModelSpec {
            dm: 4,
            window_length: 1500,
            window_step: 500,
            max_delay: 10,
            primary_terms: vec![vec![7], vec![10], vec![7, 7, 7, 7]],
            secondary_terms: vec![vec![7], vec![10], vec![7, 7, 7, 7]],
        };
        let raw_rows = model.window_length + model.max_delay + 2 * model.dm;
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
        let options = PureRustOptions::default();
        let windows: Vec<PreparedWindow> = (0..3)
            .map(|w| {
                PreparedWindow::from_raw(
                    &samples[w * raw_rows..(w + 1) * raw_rows],
                    &model,
                    &options,
                )
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
        let gpu = solver
            .solve_windows(&windows, &jobs, &model, SvdBackend::RobustSvd)
            .unwrap();
        let close = |cpu: &SolvedBlock, gpu: &SolvedBlock| {
            let largest = cpu.coefficients.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
            for (c, g) in cpu.coefficients.iter().zip(&gpu.coefficients) {
                assert!((c - g).abs() <= 1e-6 * largest, "{c} vs {g}");
            }
            assert!(
                (cpu.rmse - gpu.rmse).abs() <= 1e-6 * cpu.rmse,
                "{} vs {}",
                cpu.rmse,
                gpu.rmse
            );
        };
        for (window, gpu) in windows.iter().zip(&gpu) {
            let cpu = solve_window_on_cpu(window, &jobs, &model, SvdBackend::RobustSvd);
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
        assert!(
            solver.cpu_fallbacks * 10 < solver.problems,
            "{} of {} problems fell back to the CPU",
            solver.cpu_fallbacks,
            solver.problems
        );
    }
}
