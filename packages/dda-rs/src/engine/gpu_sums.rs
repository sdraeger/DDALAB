//! DDA on any graphics card through wgpu: Vulkan (AMD, NVIDIA, Intel), Metal (Apple) and DX12.
//!
//! Each used channel's term vectors and derivative are uploaded once per window, `gpu_sums.wgsl` computes the normal
//! equations' dot products exactly in 47-bit fixed-point integers, and the host assembles and solves each problem in
//! `f64` (via `normal_equations`). Apple GPUs have no `f64`, consumer cards run it slowly, and Metal compiles with
//! fast math, which erases the rounding errors emulated `f64` keeps; integers have no rounding to erase.

use std::sync::mpsc;

use rayon::prelude::*;
use wgpu::util::DeviceExt;

use crate::error::{DDAError, Result};

use super::model::ModelSpec;
use super::normal_equations::{
    count_problems, encode_window_fixed, solve_from_sums, sum_of, Layout,
};
use super::regression_batch::{solve_window_on_cpu, BasicJobs, WindowSolutions};
use super::window::PreparedWindow;
use super::GpuDeviceInfo;

/// The largest buffer one batch binds; the adapter's own limit when that is lower.
const MAX_BINDING: u64 = 256 << 20;

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
    ) -> Result<Vec<WindowSolutions>> {
        let terms = &model.primary_terms;
        let layout = Layout::new(jobs, terms.len());
        // Only CCD-family variants: no basic problem, so nothing for the GPU (empty buffers would fail validation).
        if layout.pairs.is_empty() {
            return Ok(windows
                .iter()
                .map(|window| solve_window_on_cpu(window, jobs, model))
                .collect());
        }
        let rows = model.window_length;
        // Per window, the scaled vectors of every used channel and their scales; `None` when a used channel misses
        // a sample, which the CPU handles.
        let vectors: Vec<Option<Scaled>> = windows
            .par_iter()
            .map(|window| encode_window_fixed(window, &layout, model))
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

fn gpu_error(context: &str, error: impl std::fmt::Display) -> DDAError {
    DDAError::ExecutionFailed(format!("GPU {context} failed: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::normal_equations::fixed;
    use crate::engine::solver::SolvedBlock;

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
        };
        let rows = model.span();
        let raw: Vec<Vec<f64>> = (0..rows)
            .map(|t| vec![(t as f64 * 0.3).sin(), (t as f64 * 0.7).cos()])
            .collect();
        let window = PreparedWindow::from_raw(&raw, &model).unwrap();
        let jobs = BasicJobs {
            channel_count: 2,
            st_channels: &[],
            ct_groups: &[],
            de_groups: &[],
            cd_pairs: &[],
            sy_pairs: &[],
        };
        let solved = solver.solve_windows(&[window], &jobs, &model).unwrap();
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
        let gpu = solver.solve_windows(&windows, &jobs, &model).unwrap();
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
        assert!(
            solver.cpu_fallbacks * 10 < solver.problems,
            "{} of {} problems fell back to the CPU",
            solver.cpu_fallbacks,
            solver.problems
        );
    }
}
