use rayon::prelude::*;

use crate::error::{DDAError, Result};

use super::{
    model::ModelSpec,
    solver::{
        build_directed_regression_window, build_group_regression_window, solve_channels_parallel,
        solve_directed_pair, solve_group_block, solve_regression_window, RegressionWindow,
        SolvedBlock,
    },
    window::PreparedWindow,
    ComputeDevice, SvdBackend,
};

const MAX_PROBLEMS_PER_BATCH: usize = 2048;
pub(crate) const MAX_WINDOWS_PER_BATCH: usize = 32;

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

/// Solves the basic regressions; CUDA state is created once per run.
pub(crate) enum BasicSolver {
    Cpu,
    #[cfg(feature = "cuda")]
    Cuda(super::gpu::CudaSolver),
}

impl BasicSolver {
    pub(crate) fn new(device: ComputeDevice, svd_backend: SvdBackend) -> Result<Self> {
        let ComputeDevice::Cuda(device_index) = device else {
            return Ok(Self::Cpu);
        };
        if svd_backend != SvdBackend::RobustSvd {
            return Err(DDAError::InvalidParameter(
                "CUDA acceleration requires SvdBackend::RobustSvd".to_string(),
            ));
        }
        #[cfg(feature = "cuda")]
        {
            super::gpu::CudaSolver::new(device_index).map(Self::Cuda)
        }
        #[cfg(not(feature = "cuda"))]
        {
            let _ = device_index;
            Err(DDAError::ExecutionFailed(
                "CUDA support is not compiled in; rebuild dda-rs with --features cuda".to_string(),
            ))
        }
    }

    /// How many of the regressions sent to CUDA were solved on the CPU instead, and the total.
    pub(crate) fn cpu_fallbacks(&self) -> (usize, usize) {
        match self {
            Self::Cpu => (0, 0),
            #[cfg(feature = "cuda")]
            Self::Cuda(solver) => (solver.cpu_fallbacks, solver.problems),
        }
    }

    fn solve(
        &mut self,
        problems: &[RegressionWindow],
        svd_backend: SvdBackend,
    ) -> Result<Vec<SolvedBlock>> {
        match self {
            Self::Cpu => Ok(solve_channels_parallel(problems, |problem| {
                solve_regression_window(problem, svd_backend)
            })),
            #[cfg(feature = "cuda")]
            Self::Cuda(solver) => solver.solve(problems, svd_backend),
        }
    }
}

struct WindowReferences {
    st: Vec<Option<usize>>,
    ct: Vec<usize>,
    de: Vec<usize>,
    cd: Vec<usize>,
    sy_forward: Vec<usize>,
    sy_reverse: Vec<usize>,
}

pub(crate) fn solve_basic_windows(
    prepared_windows: &[PreparedWindow],
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
    svd_backend: SvdBackend,
    solver: &mut BasicSolver,
) -> Result<Vec<WindowSolutions>> {
    if matches!(solver, BasicSolver::Cpu) {
        // Solving each problem as it is built keeps one design matrix per thread in memory
        return Ok(prepared_windows
            .par_iter()
            .map(|prepared| solve_window_on_cpu(prepared, jobs, model, svd_backend))
            .collect());
    }

    let jobs_per_window = jobs.st_channels.len()
        + jobs.ct_groups.len()
        + jobs.de_groups.len()
        + jobs.cd_pairs.len()
        + 2 * jobs.sy_pairs.len();
    let windows_per_batch =
        (MAX_PROBLEMS_PER_BATCH / jobs_per_window.max(1)).clamp(1, MAX_WINDOWS_PER_BATCH);
    let mut output = Vec::with_capacity(prepared_windows.len());

    for window_batch in prepared_windows.chunks(windows_per_batch) {
        let mut problems = Vec::with_capacity(window_batch.len() * jobs_per_window);
        let references = window_batch
            .iter()
            .map(|prepared| build_window_references(&mut problems, prepared, jobs, model))
            .collect::<Vec<_>>();
        let solutions = solver.solve(&problems, svd_backend)?;
        output.extend(
            references
                .iter()
                .map(|refs| resolve_window_solutions(refs, &solutions)),
        );
    }

    Ok(output)
}

fn solve_window_on_cpu(
    prepared: &PreparedWindow,
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
    svd_backend: SvdBackend,
) -> WindowSolutions {
    let solve_groups = |groups: &[Vec<usize>]| {
        solve_channels_parallel(groups, |group| {
            solve_group_block(prepared, group, model, svd_backend)
        })
    };
    let solve_pairs = |pairs: &[[usize; 2]], response_is_source: bool| {
        solve_channels_parallel(pairs, |&[target, source]| {
            let response = if response_is_source { source } else { target };
            solve_directed_pair(prepared, target, source, response, model, svd_backend)
        })
    };
    let mut st = vec![None; jobs.channel_count];
    let st_blocks = solve_channels_parallel(jobs.st_channels, |&channel| {
        solve_group_block(prepared, &[channel], model, svd_backend)
    });
    for (&channel, block) in jobs.st_channels.iter().zip(st_blocks) {
        st[channel] = Some(block);
    }
    let reversed_sy_pairs = jobs
        .sy_pairs
        .iter()
        .map(|&[left, right]| [right, left])
        .collect::<Vec<_>>();
    WindowSolutions {
        st,
        ct: solve_groups(jobs.ct_groups),
        de: solve_groups(jobs.de_groups),
        cd: solve_pairs(jobs.cd_pairs, false),
        sy_forward: solve_pairs(jobs.sy_pairs, true),
        sy_reverse: solve_pairs(&reversed_sy_pairs, true),
    }
}

fn build_window_references(
    problems: &mut Vec<RegressionWindow>,
    prepared: &PreparedWindow,
    jobs: &BasicJobs<'_>,
    model: &ModelSpec,
) -> WindowReferences {
    let mut st = vec![None; jobs.channel_count];
    let built = jobs
        .st_channels
        .par_iter()
        .map(|&channel| build_group_regression_window(prepared, &[channel], model))
        .collect();
    for (&channel, index) in jobs.st_channels.iter().zip(push_all(problems, built)) {
        st[channel] = Some(index);
    }
    let ct = push_group_problems(problems, prepared, jobs.ct_groups, model);
    let de = push_group_problems(problems, prepared, jobs.de_groups, model);
    let cd = push_pair_problems(problems, prepared, jobs.cd_pairs, model, false);
    let sy_forward = push_pair_problems(problems, prepared, jobs.sy_pairs, model, true);
    let built = jobs
        .sy_pairs
        .par_iter()
        .map(|[left, right]| {
            build_directed_regression_window(prepared, *right, *left, *left, model)
        })
        .collect();
    let sy_reverse = push_all(problems, built);
    WindowReferences {
        st,
        ct,
        de,
        cd,
        sy_forward,
        sy_reverse,
    }
}

fn push_group_problems(
    problems: &mut Vec<RegressionWindow>,
    prepared: &PreparedWindow,
    groups: &[Vec<usize>],
    model: &ModelSpec,
) -> Vec<usize> {
    let built = groups
        .par_iter()
        .map(|group| build_group_regression_window(prepared, group, model))
        .collect();
    push_all(problems, built)
}

fn push_pair_problems(
    problems: &mut Vec<RegressionWindow>,
    prepared: &PreparedWindow,
    pairs: &[[usize; 2]],
    model: &ModelSpec,
    response_is_source: bool,
) -> Vec<usize> {
    let built = pairs
        .par_iter()
        .map(|[target, source]| {
            let response = if response_is_source { *source } else { *target };
            build_directed_regression_window(prepared, *target, *source, response, model)
        })
        .collect();
    push_all(problems, built)
}

/// Appends problems built in parallel and returns their indices; the CUDA path
/// builds every design matrix on the host, which dominated its run time serially.
fn push_all(problems: &mut Vec<RegressionWindow>, built: Vec<RegressionWindow>) -> Vec<usize> {
    let start = problems.len();
    problems.extend(built);
    (start..problems.len()).collect()
}

fn resolve_window_solutions(
    references: &WindowReferences,
    solutions: &[SolvedBlock],
) -> WindowSolutions {
    let blocks = |indices: &[usize]| {
        indices
            .iter()
            .map(|&index| solutions[index].clone())
            .collect()
    };
    WindowSolutions {
        st: references
            .st
            .iter()
            .map(|index| index.map(|index| solutions[index].clone()))
            .collect(),
        ct: blocks(&references.ct),
        de: blocks(&references.de),
        cd: blocks(&references.cd),
        sy_forward: blocks(&references.sy_forward),
        sy_reverse: blocks(&references.sy_reverse),
    }
}
