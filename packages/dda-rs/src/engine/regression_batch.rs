use rayon::prelude::*;

use crate::error::Result;

use super::{
    model::ModelSpec,
    solver::{
        solve_channels_parallel, solve_directed_pair, solve_group_block, SolvedBlock,
    },
    window::PreparedWindow,
    ComputeDevice,
};

/// Minimum prepared-window chunk size fed to GPU solvers (`wgpu` and CUDA sub-batch internally by VRAM limit).
pub(crate) const MAX_WINDOWS_PER_BATCH: usize = 128;

#[derive(Clone)]
pub(crate) struct WindowSolutions {
    pub(crate) st: Vec<Option<SolvedBlock>>,
    pub(crate) ct: Vec<SolvedBlock>,
    pub(crate) de: Vec<SolvedBlock>,
    pub(crate) cd: Vec<SolvedBlock>,
    pub(crate) sy_forward: Vec<SolvedBlock>,
    pub(crate) sy_reverse: Vec<SolvedBlock>,
}

/// The ST/CT/DE/CD/SY regressions solved in every window; disabled variants are empty.
pub(crate) struct BasicJobs<'a> {
    pub(crate) channel_count: usize,
    pub(crate) st_channels: &'a [usize],
    pub(crate) ct_groups: &'a [Vec<usize>],
    pub(crate) de_groups: &'a [Vec<usize>],
    pub(crate) cd_pairs: &'a [[usize; 2]],
    pub(crate) sy_pairs: &'a [[usize; 2]],
}

impl BasicJobs<'_> {
    /// DE on CT's channel groups: the same regressions, so CT's solutions serve DE.
    fn de_shares_ct(&self) -> bool {
        self.de_groups == self.ct_groups
    }
}

/// Solves the basic regressions; GPU state is created once per run.
pub(crate) enum BasicSolver {
    Cpu,
    #[cfg(all(feature = "cuda", target_os = "linux"))]
    Cuda(super::gpu::CudaSolver),
    #[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
    Gpu(super::gpu_sums::GpuSumsSolver),
    /// Window solutions already computed externally (e.g. browser WebGPU via `blocks::GpuBlockJob`).
    Precomputed {
        solutions: Vec<WindowSolutions>,
        cursor: usize,
        problems: usize,
        cpu_fallbacks: usize,
    },
}

impl BasicSolver {
    pub(crate) fn new(device: ComputeDevice) -> Result<Self> {
        if device == ComputeDevice::Cpu {
            return Ok(Self::Cpu);
        }
        if let ComputeDevice::Gpu(device_index) = device {
            #[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
            return super::gpu_sums::GpuSumsSolver::new(device_index).map(Self::Gpu);
            #[cfg(not(all(feature = "gpu", not(target_arch = "wasm32"))))]
            return Err(crate::error::DDAError::ExecutionFailed(format!(
                "GPU support is not compiled in: build with --features gpu (gpu:{device_index})"
            )));
        }
        let ComputeDevice::Cuda(device_index) = device else {
            unreachable!("cpu and gpu returned above");
        };
        #[cfg(all(feature = "cuda", target_os = "linux"))]
        {
            super::gpu::CudaSolver::new(device_index).map(Self::Cuda)
        }
        #[cfg(not(all(feature = "cuda", target_os = "linux")))]
        {
            let _ = device_index;
            Err(crate::error::DDAError::ExecutionFailed(
                "CUDA support is not compiled in: CUDA runs in Linux builds with --features cuda"
                    .to_string(),
            ))
        }
    }

    /// How many of the regressions sent to the GPU were solved on the CPU instead, and the total.
    pub(crate) fn cpu_fallbacks(&self) -> (usize, usize) {
        match self {
            Self::Cpu => (0, 0),
            #[cfg(all(feature = "cuda", target_os = "linux"))]
            Self::Cuda(solver) => (solver.cpu_fallbacks, solver.problems),
            #[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
            Self::Gpu(solver) => (solver.cpu_fallbacks, solver.problems),
            Self::Precomputed {
                problems,
                cpu_fallbacks,
                ..
            } => (*cpu_fallbacks, *problems),
        }
    }
}

pub(crate) fn solve_basic_windows(
    prepared_windows: &[PreparedWindow],
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
    solver: &mut BasicSolver,
) -> Result<Vec<WindowSolutions>> {
    match solver {
        BasicSolver::Cpu => {
            // Solving each problem as it is built keeps one design matrix per thread in memory
            Ok(prepared_windows
                .par_iter()
                .map(|prepared| solve_window_on_cpu(prepared, jobs, model))
                .collect())
        }
        #[cfg(all(feature = "cuda", target_os = "linux"))]
        BasicSolver::Cuda(solver) => solver.solve_windows(prepared_windows, jobs, model),
        #[cfg(all(feature = "gpu", not(target_arch = "wasm32")))]
        BasicSolver::Gpu(solver) => solver.solve_windows(prepared_windows, jobs, model),
        BasicSolver::Precomputed {
            solutions, cursor, ..
        } => {
            let len = prepared_windows.len();
            let end = (*cursor + len).min(solutions.len());
            let slice = solutions[*cursor..end].to_vec();
            *cursor = end;
            Ok(slice)
        }
    }
}

pub(crate) fn solve_window_on_cpu(
    prepared: &PreparedWindow,
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
) -> WindowSolutions {
    let solve_groups = |groups: &[Vec<usize>]| {
        solve_channels_parallel(groups, |group| solve_group_block(prepared, group, model))
    };
    let solve_pairs = |pairs: &[[usize; 2]], response_is_source: bool| {
        solve_channels_parallel(pairs, |&[target, source]| {
            let response = if response_is_source { source } else { target };
            solve_directed_pair(prepared, target, source, response, model)
        })
    };
    let mut st = vec![None; jobs.channel_count];
    let st_blocks = solve_channels_parallel(jobs.st_channels, |&channel| {
        solve_group_block(prepared, &[channel], model)
    });
    for (&channel, block) in jobs.st_channels.iter().zip(st_blocks) {
        st[channel] = Some(block);
    }
    let reversed_sy_pairs = jobs
        .sy_pairs
        .iter()
        .map(|&[left, right]| [right, left])
        .collect::<Vec<_>>();
    let ct = solve_groups(jobs.ct_groups);
    let de = if jobs.de_shares_ct() {
        ct.clone()
    } else {
        solve_groups(jobs.de_groups)
    };
    WindowSolutions {
        st,
        ct,
        de,
        cd: solve_pairs(jobs.cd_pairs, false),
        sy_forward: solve_pairs(jobs.sy_pairs, true),
        sy_reverse: solve_pairs(&reversed_sy_pairs, true),
    }
}
