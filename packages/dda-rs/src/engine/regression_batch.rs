use crate::error::Result;

use super::{
    model::ModelSpec,
    solver::{
        build_directed_regression_window, build_group_regression_window, solve_regression_windows,
        RegressionWindow, SolvedBlock,
    },
    window::PreparedWindow,
    ComputeDevice, SvdBackend,
};

const MAX_PROBLEMS_PER_BATCH: usize = 2048;
const MAX_WINDOWS_PER_BATCH: usize = 32;

#[derive(Clone)]
pub(crate) struct WindowSolutions {
    pub(crate) st: Vec<Option<SolvedBlock>>,
    pub(crate) ct: Vec<SolvedBlock>,
    pub(crate) de: Vec<SolvedBlock>,
    pub(crate) cd: Vec<SolvedBlock>,
    pub(crate) sy_forward: Vec<SolvedBlock>,
    pub(crate) sy_reverse: Vec<SolvedBlock>,
}

struct WindowReferences {
    st: Vec<Option<usize>>,
    ct: Vec<usize>,
    de: Vec<usize>,
    cd: Vec<usize>,
    sy_forward: Vec<usize>,
    sy_reverse: Vec<usize>,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn solve_basic_windows(
    prepared_windows: &[PreparedWindow],
    channel_count: usize,
    analysis_channels: &[usize],
    ct_groups: &[Vec<usize>],
    de_groups: &[Vec<usize>],
    cd_pairs: &[[usize; 2]],
    sy_pairs: &[[usize; 2]],
    model: &ModelSpec,
    solve_st: bool,
    solve_ct: bool,
    solve_de: bool,
    solve_cd: bool,
    solve_sy: bool,
    svd_backend: SvdBackend,
    compute_device: ComputeDevice,
) -> Result<Vec<WindowSolutions>> {
    let jobs_per_window = usize::from(solve_st) * analysis_channels.len()
        + usize::from(solve_ct) * ct_groups.len()
        + usize::from(solve_de) * de_groups.len()
        + usize::from(solve_cd) * cd_pairs.len()
        + usize::from(solve_sy) * 2 * sy_pairs.len();
    let windows_per_batch =
        (MAX_PROBLEMS_PER_BATCH / jobs_per_window.max(1)).clamp(1, MAX_WINDOWS_PER_BATCH);
    let mut output = Vec::with_capacity(prepared_windows.len());

    for window_batch in prepared_windows.chunks(windows_per_batch) {
        let mut problems = Vec::with_capacity(window_batch.len() * jobs_per_window);
        let references = window_batch
            .iter()
            .map(|prepared| {
                build_window_references(
                    &mut problems,
                    prepared,
                    channel_count,
                    analysis_channels,
                    ct_groups,
                    de_groups,
                    cd_pairs,
                    sy_pairs,
                    model,
                    solve_st,
                    solve_ct,
                    solve_de,
                    solve_cd,
                    solve_sy,
                )
            })
            .collect::<Vec<_>>();
        let solutions = solve_regression_windows(&problems, svd_backend, compute_device)?;
        output.extend(
            references
                .iter()
                .map(|refs| resolve_window_solutions(refs, &solutions)),
        );
    }

    Ok(output)
}

#[allow(clippy::too_many_arguments)]
fn build_window_references(
    problems: &mut Vec<RegressionWindow>,
    prepared: &PreparedWindow,
    channel_count: usize,
    analysis_channels: &[usize],
    ct_groups: &[Vec<usize>],
    de_groups: &[Vec<usize>],
    cd_pairs: &[[usize; 2]],
    sy_pairs: &[[usize; 2]],
    model: &ModelSpec,
    solve_st: bool,
    solve_ct: bool,
    solve_de: bool,
    solve_cd: bool,
    solve_sy: bool,
) -> WindowReferences {
    let mut st = vec![None; channel_count];
    if solve_st {
        for &channel in analysis_channels {
            st[channel] = Some(push_problem(
                problems,
                build_group_regression_window(prepared, &[channel], model),
            ));
        }
    }
    let ct = if solve_ct {
        push_group_problems(problems, prepared, ct_groups, model)
    } else {
        Vec::new()
    };
    let de = if solve_de {
        push_group_problems(problems, prepared, de_groups, model)
    } else {
        Vec::new()
    };
    let cd = if solve_cd {
        push_pair_problems(problems, prepared, cd_pairs, model, false)
    } else {
        Vec::new()
    };
    let sy_forward = if solve_sy {
        push_pair_problems(problems, prepared, sy_pairs, model, true)
    } else {
        Vec::new()
    };
    let sy_reverse = if solve_sy {
        sy_pairs
            .iter()
            .map(|[left, right]| {
                push_problem(
                    problems,
                    build_directed_regression_window(prepared, *right, *left, *left, model),
                )
            })
            .collect()
    } else {
        Vec::new()
    };
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
    groups
        .iter()
        .map(|group| {
            push_problem(
                problems,
                build_group_regression_window(prepared, group, model),
            )
        })
        .collect()
}

fn push_pair_problems(
    problems: &mut Vec<RegressionWindow>,
    prepared: &PreparedWindow,
    pairs: &[[usize; 2]],
    model: &ModelSpec,
    response_is_source: bool,
) -> Vec<usize> {
    pairs
        .iter()
        .map(|[target, source]| {
            let response = if response_is_source { *source } else { *target };
            push_problem(
                problems,
                build_directed_regression_window(prepared, *target, *source, response, model),
            )
        })
        .collect()
}

fn push_problem(problems: &mut Vec<RegressionWindow>, problem: RegressionWindow) -> usize {
    let index = problems.len();
    problems.push(problem);
    index
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
