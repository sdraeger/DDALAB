mod dataset;
mod model;
mod solver;
mod variant_config;
mod window;

#[cfg(test)]
mod tests;

use crate::error::{DDAError, Result};
use crate::types::{CcdConditioningStrategy, DDARequest, DDAResult, VariantResult};
use dataset::{AnalysisBounds, MatrixDataset};
use model::ModelSpec;
use serde::{Deserialize, Serialize};
use solver::{
    bic_like_score, build_channel_regression_window_with_inputs, causal_improvement,
    circular_shift_series, compute_de_value, conditional_causal_improvement,
    empirical_significance_confidence, greedy_sparse_unique_improvements,
    solve_channel_with_inputs, solve_channel_with_surrogate_inputs, solve_channels_parallel,
    solve_directed_pair, solve_group_block, solve_temporally_regularized_windows,
    synchronization_value, SolvedBlock,
};
use std::time::{Duration, Instant};
use uuid::Uuid;
use variant_config::{
    collect_analysis_channels, flip_pairs, labels_for_channels, labels_for_groups,
    labels_for_pairs, labels_for_sy, resolve_ccd_candidate_channels,
    resolve_ccd_conditioning_strategy, resolve_ccd_max_active_sources, resolve_ccd_pairs,
    resolve_ccd_surrogate_shifts, resolve_ccd_temporal_lambda, resolve_cd_pairs, resolve_ct_groups,
    resolve_de_groups, resolve_sy_pairs, resolve_variant_selected_channels, VariantMode,
};
use window::PreparedWindow;

pub(crate) const PARALLEL_BATCH_MIN_LEN: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NormalizationMode {
    ZScore,
    Raw,
    MinMax,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SvdBackend {
    RobustSvd,
    NativeCompatSvd,
}

#[derive(Debug, Clone)]
pub struct PureRustOptions {
    pub nr_exclude: usize,
    pub normalization_mode: NormalizationMode,
    pub derivative_step: usize,
    pub svd_backend: SvdBackend,
}

impl Default for PureRustOptions {
    fn default() -> Self {
        Self {
            nr_exclude: 10,
            normalization_mode: NormalizationMode::ZScore,
            derivative_step: 1,
            svd_backend: SvdBackend::RobustSvd,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PureRustProgress {
    pub stage_id: String,
    pub stage_label: String,
    pub step_index: usize,
    pub total_steps: usize,
    pub window_index: usize,
    pub total_windows: usize,
    pub item_index: usize,
    pub total_items: usize,
    pub item_kind: String,
    pub item_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CcdConditioningInspection {
    pub pairs: Vec<[usize; 2]>,
    pub conditioning_sets: Vec<Vec<usize>>,
    pub candidate_channels: Vec<usize>,
    pub strategy: CcdConditioningStrategy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CcdConditioningSubsetScore {
    pub pair: [usize; 2],
    pub confounds: Vec<usize>,
    pub bic_like_score: f64,
    pub mean_rmse: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CcdConditioningSubsetProfile {
    pub pair: [usize; 2],
    pub confounds: Vec<usize>,
    pub bic_like_score: f64,
    pub mean_rmse: f64,
    pub window_bic_scores: Vec<f64>,
    pub window_rmses: Vec<f64>,
}

#[derive(Debug, Clone)]
pub struct PureRustRunner {
    options: PureRustOptions,
}

impl Default for PureRustRunner {
    fn default() -> Self {
        Self::new(PureRustOptions::default())
    }
}

impl PureRustRunner {
    pub fn new(options: PureRustOptions) -> Self {
        Self { options }
    }

    pub fn run_on_matrix(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
    ) -> Result<DDAResult> {
        self.run_on_matrix_internal(request, samples, channel_labels, None)
    }

    pub fn run_on_matrix_with_progress<F>(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
        on_progress: F,
    ) -> Result<DDAResult>
    where
        F: FnMut(&PureRustProgress),
    {
        let mut callback = on_progress;
        self.run_on_matrix_internal(request, samples, channel_labels, Some(&mut callback))
    }

    pub fn inspect_ccd_conditioning_sets_on_matrix(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
    ) -> Result<CcdConditioningInspection> {
        let dataset = MatrixDataset::new(samples, channel_labels)?;
        let model = ModelSpec::from_request(request)?;
        let bounds = AnalysisBounds::from_request(request, dataset.rows)?;
        let ccd_pairs = resolve_ccd_pairs(request, dataset.cols);
        let strategy = resolve_ccd_conditioning_strategy(request);
        let candidate_channels = resolve_ccd_candidate_channels(request, dataset.cols);
        let needs_prepared_windows = !matches!(strategy, CcdConditioningStrategy::AllSelected);

        let conditioning_sets = if needs_prepared_windows {
            let native_window_marker = model.window_length + model.max_delay + 2 * model.dm;
            let required_rows = native_window_marker.saturating_sub(1);
            if bounds.len < required_rows {
                return Err(DDAError::InvalidParameter(format!(
                    "Selected range has {} samples but the current DDA contract needs at least {} samples (WL + 2*dm + max(TAU) - 1)",
                    bounds.len, required_rows
                )));
            }
            if model.window_step == 0 {
                return Err(DDAError::InvalidParameter(
                    "window_step must be greater than zero".to_string(),
                ));
            }
            let num_windows = 1 + (bounds.len - required_rows) / model.window_step;
            let windows = (0..num_windows)
                .map(|window_idx| {
                    prepare_window_for_analysis(
                        &dataset,
                        &bounds,
                        &model,
                        window_idx,
                        &self.options,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
            compute_ccd_pair_conditioning_sets(
                Some(&windows),
                &ccd_pairs,
                &candidate_channels,
                strategy,
                &model,
                resolve_ccd_max_active_sources(request).unwrap_or(3),
                self.options.svd_backend,
            )
        } else {
            compute_ccd_pair_conditioning_sets(
                None,
                &ccd_pairs,
                &candidate_channels,
                strategy,
                &model,
                resolve_ccd_max_active_sources(request).unwrap_or(3),
                self.options.svd_backend,
            )
        };

        Ok(CcdConditioningInspection {
            pairs: ccd_pairs,
            conditioning_sets,
            candidate_channels,
            strategy,
        })
    }

    pub fn score_ccd_conditioning_subsets_on_matrix(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
        pair: [usize; 2],
        confound_sets: &[Vec<usize>],
    ) -> Result<Vec<CcdConditioningSubsetScore>> {
        let dataset = MatrixDataset::new(samples, channel_labels)?;
        let model = ModelSpec::from_request(request)?;
        let bounds = AnalysisBounds::from_request(request, dataset.rows)?;
        let native_window_marker = model.window_length + model.max_delay + 2 * model.dm;
        let required_rows = native_window_marker.saturating_sub(1);
        if bounds.len < required_rows {
            return Err(DDAError::InvalidParameter(format!(
                "Selected range has {} samples but the current DDA contract needs at least {} samples (WL + 2*dm + max(TAU) - 1)",
                bounds.len, required_rows
            )));
        }
        if model.window_step == 0 {
            return Err(DDAError::InvalidParameter(
                "window_step must be greater than zero".to_string(),
            ));
        }
        let num_windows = 1 + (bounds.len - required_rows) / model.window_step;
        let windows = (0..num_windows)
            .map(|window_idx| {
                prepare_window_for_analysis(&dataset, &bounds, &model, window_idx, &self.options)
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(confound_sets
            .iter()
            .map(|confounds| CcdConditioningSubsetScore {
                pair,
                confounds: confounds.clone(),
                bic_like_score: average_conditioned_baseline_score(
                    &windows,
                    pair[0],
                    confounds,
                    &model,
                    self.options.svd_backend,
                ),
                mean_rmse: average_conditioned_baseline_rmse(
                    &windows,
                    pair[0],
                    confounds,
                    &model,
                    self.options.svd_backend,
                ),
            })
            .collect())
    }

    pub fn profile_ccd_conditioning_subsets_on_matrix(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
        pair: [usize; 2],
        confound_sets: &[Vec<usize>],
    ) -> Result<Vec<CcdConditioningSubsetProfile>> {
        let dataset = MatrixDataset::new(samples, channel_labels)?;
        let model = ModelSpec::from_request(request)?;
        let bounds = AnalysisBounds::from_request(request, dataset.rows)?;
        let native_window_marker = model.window_length + model.max_delay + 2 * model.dm;
        let required_rows = native_window_marker.saturating_sub(1);
        if bounds.len < required_rows {
            return Err(DDAError::InvalidParameter(format!(
                "Selected range has {} samples but the current DDA contract needs at least {} samples (WL + 2*dm + max(TAU) - 1)",
                bounds.len, required_rows
            )));
        }
        if model.window_step == 0 {
            return Err(DDAError::InvalidParameter(
                "window_step must be greater than zero".to_string(),
            ));
        }
        let num_windows = 1 + (bounds.len - required_rows) / model.window_step;
        let windows = (0..num_windows)
            .map(|window_idx| {
                prepare_window_for_analysis(&dataset, &bounds, &model, window_idx, &self.options)
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(confound_sets
            .iter()
            .map(|confounds| {
                let (window_bic_scores, window_rmses) = conditioned_baseline_window_metrics(
                    &windows,
                    pair[0],
                    confounds,
                    &model,
                    self.options.svd_backend,
                );
                let bic_like_score = finite_mean(&window_bic_scores).unwrap_or(f64::INFINITY);
                let mean_rmse = finite_mean(&window_rmses).unwrap_or(f64::INFINITY);
                CcdConditioningSubsetProfile {
                    pair,
                    confounds: confounds.clone(),
                    bic_like_score,
                    mean_rmse,
                    window_bic_scores,
                    window_rmses,
                }
            })
            .collect())
    }

    fn run_on_matrix_internal(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
        mut on_progress: Option<&mut dyn FnMut(&PureRustProgress)>,
    ) -> Result<DDAResult> {
        let dataset = MatrixDataset::new(samples, channel_labels)?;
        let variant_mode = VariantMode::from_request(request);
        let model = ModelSpec::from_request(request)?;
        let bounds = AnalysisBounds::from_request(request, dataset.rows)?;
        let st_channels = resolve_variant_selected_channels(
            request,
            dataset.cols,
            &["ST", "st", "single_timeseries"],
        );
        let de_channels = resolve_variant_selected_channels(
            request,
            dataset.cols,
            &["DE", "de", "dynamical_ergodicity"],
        );
        let sy_channels = resolve_variant_selected_channels(
            request,
            dataset.cols,
            &["SY", "sy", "synchronization"],
        );
        let ct_groups = resolve_ct_groups(request, dataset.cols);
        let de_groups = resolve_de_groups(request, dataset.cols, &de_channels);
        let cd_pairs = resolve_cd_pairs(request, dataset.cols);
        let ccd_pairs = resolve_ccd_pairs(request, dataset.cols);
        let ccd_conditioning_strategy = resolve_ccd_conditioning_strategy(request);
        let ccd_candidate_channels = resolve_ccd_candidate_channels(request, dataset.cols);
        let ccd_surrogate_shifts = resolve_ccd_surrogate_shifts(request);
        let ccd_temporal_lambda = resolve_ccd_temporal_lambda(request).unwrap_or(0.25);
        let ccd_max_active_sources = resolve_ccd_max_active_sources(request).unwrap_or(3);
        let sy_pairs = resolve_sy_pairs(&sy_channels);
        let analysis_channels = collect_analysis_channels(
            &st_channels,
            &ct_groups,
            &de_groups,
            &cd_pairs,
            &ccd_pairs,
            &ccd_candidate_channels,
        );

        let enabled_st = variant_mode.st_enabled;
        let enabled_ct = variant_mode.ct_enabled;
        let enabled_cd = variant_mode.cd_enabled;
        let enabled_ccd_core = (variant_mode.ccd_enabled
            || variant_mode.ccdsig_enabled
            || variant_mode.ccdstab_enabled
            || variant_mode.trccd_enabled
            || variant_mode.mvccd_enabled)
            && !ccd_pairs.is_empty();
        let enabled_ccd = variant_mode.ccd_enabled && !ccd_pairs.is_empty();
        let enabled_ccdsig = variant_mode.ccdsig_enabled && !ccd_pairs.is_empty();
        let enabled_ccdstab = variant_mode.ccdstab_enabled && !ccd_pairs.is_empty();
        let enabled_trccd = variant_mode.trccd_enabled && !ccd_pairs.is_empty();
        let enabled_mvccd = variant_mode.mvccd_enabled && !ccd_pairs.is_empty();
        let enabled_de = variant_mode.de_enabled;
        let enabled_sy = variant_mode.sy_mode > 0 && !sy_pairs.is_empty();

        if !enabled_st
            && !enabled_ct
            && !enabled_cd
            && !enabled_ccd_core
            && !enabled_de
            && !enabled_sy
        {
            return Err(DDAError::InvalidParameter(
                "No DDA variants enabled for pure Rust engine".to_string(),
            ));
        }

        let native_window_marker = model.window_length + model.max_delay + 2 * model.dm;
        let required_rows = native_window_marker.saturating_sub(1);
        if bounds.len < required_rows {
            return Err(DDAError::InvalidParameter(format!(
                "Selected range has {} samples but the current DDA contract needs at least {} samples (WL + 2*dm + max(TAU) - 1)",
                bounds.len, required_rows
            )));
        }
        if model.window_step == 0 {
            return Err(DDAError::InvalidParameter(
                "window_step must be greater than zero".to_string(),
            ));
        }

        let num_windows = 1 + (bounds.len - required_rows) / model.window_step;
        let needs_prepared_windows = enabled_trccd
            || !matches!(
                ccd_conditioning_strategy,
                CcdConditioningStrategy::AllSelected
            );
        let mut prepared_windows = None;
        let progress_enabled = on_progress.is_some();
        let analysis_channel_labels = progress_enabled
            .then(|| labels_for_channels(&dataset.channel_labels, &analysis_channels));
        let ct_group_labels =
            progress_enabled.then(|| labels_for_groups(&dataset.channel_labels, &ct_groups, " & "));
        let de_group_labels =
            progress_enabled.then(|| labels_for_groups(&dataset.channel_labels, &de_groups, " & "));
        let cd_pair_labels =
            progress_enabled.then(|| labels_for_pairs(&dataset.channel_labels, &cd_pairs, " <- "));
        let ccd_pair_labels =
            progress_enabled.then(|| labels_for_pairs(&dataset.channel_labels, &ccd_pairs, " <- "));
        let sy_forward_labels =
            progress_enabled.then(|| labels_for_pairs(&dataset.channel_labels, &sy_pairs, " -> "));
        let sy_reverse_labels = progress_enabled.then(|| {
            let sy_reverse_pairs = flip_pairs(&sy_pairs);
            labels_for_pairs(&dataset.channel_labels, &sy_reverse_pairs, " -> ")
        });
        let shared_block_steps = if enabled_st || enabled_cd || enabled_de {
            analysis_channels.len()
        } else {
            0
        };
        let steps_per_window = 1
            + shared_block_steps
            + if enabled_ct { ct_groups.len() } else { 0 }
            + if enabled_de { de_groups.len() } else { 0 }
            + if enabled_cd { cd_pairs.len() } else { 0 }
            + if enabled_ccd_core { ccd_pairs.len() } else { 0 }
            + if enabled_ccdsig { ccd_pairs.len() } else { 0 }
            + if enabled_mvccd { ccd_pairs.len() } else { 0 }
            + if enabled_sy { sy_pairs.len() * 2 } else { 0 };
        let total_steps = num_windows * steps_per_window
            + if enabled_trccd { ccd_pairs.len() } else { 0 }
            + if enabled_ccdstab { ccd_pairs.len() } else { 0 };
        let mut emitted_steps = 0usize;
        let mut last_progress_emit = Instant::now() - Duration::from_secs(1);
        let mut report = |stage_id: &str,
                          stage_label: &str,
                          window_number: usize,
                          item_index: usize,
                          total_items: usize,
                          item_kind: &str,
                          item_label: Option<&str>| {
            emitted_steps += 1;
            let should_emit = emitted_steps <= 1
                || emitted_steps >= total_steps
                || last_progress_emit.elapsed() >= Duration::from_millis(125);
            if !should_emit {
                return;
            }
            last_progress_emit = Instant::now();
            if let Some(callback) = on_progress.as_deref_mut() {
                callback(&PureRustProgress {
                    stage_id: stage_id.to_string(),
                    stage_label: stage_label.to_string(),
                    step_index: emitted_steps,
                    total_steps,
                    window_index: window_number,
                    total_windows: num_windows,
                    item_index,
                    total_items,
                    item_kind: item_kind.to_string(),
                    item_label: item_label.unwrap_or("").to_string(),
                });
            }
        };

        let native_window_markers: Vec<f64> = (0..num_windows)
            .map(|window_idx| {
                (bounds.start + window_idx * model.window_step + native_window_marker) as f64
            })
            .collect();

        if needs_prepared_windows {
            let mut windows = Vec::with_capacity(num_windows);
            for window_idx in 0..num_windows {
                report(
                    "prepare-window",
                    "Preparing analysis window",
                    window_idx + 1,
                    window_idx + 1,
                    num_windows,
                    "window",
                    None,
                );
                windows.push(prepare_window_for_analysis(
                    &dataset,
                    &bounds,
                    &model,
                    window_idx,
                    &self.options,
                )?);
            }
            prepared_windows = Some(windows);
        }

        let ccd_pair_conditioning_sets = if enabled_ccd_core {
            compute_ccd_pair_conditioning_sets(
                prepared_windows.as_deref(),
                &ccd_pairs,
                &ccd_candidate_channels,
                ccd_conditioning_strategy,
                &model,
                ccd_max_active_sources,
                self.options.svd_backend,
            )
        } else {
            Vec::new()
        };
        let ccd_target_conditioning_sets =
            build_target_conditioning_sets(&ccd_pairs, &ccd_pair_conditioning_sets);

        let mut st_matrix =
            enabled_st.then(|| vec![vec![f64::NAN; num_windows]; st_channels.len()]);
        let mut ct_matrix = enabled_ct.then(|| vec![vec![f64::NAN; num_windows]; ct_groups.len()]);
        let mut cd_matrix = enabled_cd.then(|| vec![vec![f64::NAN; num_windows]; cd_pairs.len()]);
        let mut ccd_matrix =
            enabled_ccd_core.then(|| vec![vec![f64::NAN; num_windows]; ccd_pairs.len()]);
        let mut ccdsig_matrix =
            enabled_ccdsig.then(|| vec![vec![f64::NAN; num_windows]; ccd_pairs.len()]);
        let mut mvccd_matrix =
            enabled_mvccd.then(|| vec![vec![f64::NAN; num_windows]; ccd_pairs.len()]);
        let mut trccd_matrix =
            enabled_trccd.then(|| vec![vec![f64::NAN; num_windows]; ccd_pairs.len()]);
        let mut ccdstab_matrix =
            enabled_ccdstab.then(|| vec![vec![f64::NAN; num_windows]; ccd_pairs.len()]);
        let mut de_matrix = enabled_de.then(|| vec![vec![f64::NAN; num_windows]; de_groups.len()]);
        let mut sy_matrix = enabled_sy.then(|| {
            let rows = if variant_mode.sy_mode == 2 {
                sy_pairs.len() * 2
            } else {
                sy_pairs.len()
            };
            vec![vec![f64::NAN; num_windows]; rows]
        });

        for window_idx in 0..num_windows {
            let prepared_storage;
            let prepared = if let Some(windows) = prepared_windows.as_ref() {
                &windows[window_idx]
            } else {
                report(
                    "prepare-window",
                    "Preparing analysis window",
                    window_idx + 1,
                    window_idx + 1,
                    num_windows,
                    "window",
                    None,
                );
                prepared_storage = prepare_window_for_analysis(
                    &dataset,
                    &bounds,
                    &model,
                    window_idx,
                    &self.options,
                )?;
                &prepared_storage
            };

            let mut st_blocks: Vec<Option<SolvedBlock>> = vec![None; dataset.cols];
            if enabled_st || enabled_cd || enabled_de {
                let computed_st_blocks = solve_channels_parallel(&analysis_channels, |&channel| {
                    (
                        channel,
                        solve_group_block(
                            &prepared,
                            &[channel],
                            &model.primary_terms,
                            model.window_length,
                            self.options.svd_backend,
                        ),
                    )
                });
                for (channel_idx, (channel, block)) in computed_st_blocks.into_iter().enumerate() {
                    report(
                        "st-blocks",
                        "Solving baseline channel dynamics",
                        window_idx + 1,
                        channel_idx + 1,
                        analysis_channels.len(),
                        "channel",
                        analysis_channel_labels
                            .as_ref()
                            .and_then(|labels| labels.get(channel_idx).map(String::as_str)),
                    );
                    if channel < st_blocks.len() {
                        st_blocks[channel] = Some(block);
                    }
                }
            }

            if let Some(matrix) = st_matrix.as_mut() {
                for (row_idx, &channel) in st_channels.iter().enumerate() {
                    if let Some(block) = st_blocks.get(channel).and_then(Option::as_ref) {
                        matrix[row_idx][window_idx] =
                            block.coefficients.first().copied().unwrap_or(f64::NAN);
                    }
                }
            }

            let mut ct_blocks = Vec::new();
            if enabled_ct {
                ct_blocks = solve_channels_parallel(&ct_groups, |group| {
                    solve_group_block(
                        &prepared,
                        group,
                        &model.primary_terms,
                        model.window_length,
                        self.options.svd_backend,
                    )
                });
                for (group_idx, _) in ct_groups.iter().enumerate() {
                    report(
                        "ct",
                        "Computing cross-timeseries groups",
                        window_idx + 1,
                        group_idx + 1,
                        ct_groups.len(),
                        "group",
                        ct_group_labels
                            .as_ref()
                            .and_then(|labels| labels.get(group_idx).map(String::as_str)),
                    );
                }
            }

            if let Some(matrix) = ct_matrix.as_mut() {
                for (row_idx, block) in ct_blocks.iter().enumerate() {
                    matrix[row_idx][window_idx] =
                        block.coefficients.first().copied().unwrap_or(f64::NAN);
                }
            }

            let mut de_blocks = Vec::new();
            if enabled_de {
                de_blocks = solve_channels_parallel(&de_groups, |group| {
                    solve_group_block(
                        &prepared,
                        group,
                        &model.primary_terms,
                        model.window_length,
                        self.options.svd_backend,
                    )
                });
                for (group_idx, _) in de_groups.iter().enumerate() {
                    report(
                        "de",
                        "Computing dynamical ergodicity groups",
                        window_idx + 1,
                        group_idx + 1,
                        de_groups.len(),
                        "group",
                        de_group_labels
                            .as_ref()
                            .and_then(|labels| labels.get(group_idx).map(String::as_str)),
                    );
                }
            }

            if let Some(matrix) = de_matrix.as_mut() {
                for (row_idx, group) in de_groups.iter().enumerate() {
                    let ct_rmse = de_blocks
                        .get(row_idx)
                        .map(|block| block.rmse)
                        .unwrap_or(f64::NAN);
                    let de_value = compute_de_value(group, &st_blocks, ct_rmse);
                    matrix[row_idx][window_idx] = de_value;
                }
            }

            if enabled_cd {
                let cd_values = solve_channels_parallel(&cd_pairs, |pair| {
                    let forward = solve_directed_pair(
                        &prepared,
                        pair[0],
                        pair[1],
                        pair[0],
                        &model.primary_terms,
                        &model.secondary_terms,
                        model.window_length,
                        self.options.svd_backend,
                    );
                    let baseline = st_blocks
                        .get(pair[0])
                        .and_then(Option::as_ref)
                        .map(|block| block.rmse)
                        .unwrap_or(f64::NAN);
                    causal_improvement(baseline, forward.rmse)
                });
                for (pair_idx, _) in cd_pairs.iter().enumerate() {
                    report(
                        "cd",
                        "Computing directed causal pairs",
                        window_idx + 1,
                        pair_idx + 1,
                        cd_pairs.len(),
                        "pair",
                        cd_pair_labels
                            .as_ref()
                            .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                    );
                }
                if let Some(matrix) = cd_matrix.as_mut() {
                    for (pair_idx, value) in cd_values.into_iter().enumerate() {
                        matrix[pair_idx][window_idx] = value;
                    }
                }
            }

            if enabled_ccd_core {
                let ccd_values = solve_channels_parallel(
                    &ccd_pairs
                        .iter()
                        .zip(ccd_pair_conditioning_sets.iter())
                        .collect::<Vec<_>>(),
                    |(pair, confounds)| {
                        let baseline = solve_channel_with_inputs(
                            prepared,
                            pair[0],
                            confounds,
                            &model.primary_terms,
                            &model.secondary_terms,
                            model.window_length,
                            self.options.svd_backend,
                        );
                        let mut conditioned_inputs = (*confounds).clone();
                        conditioned_inputs.push(pair[1]);
                        let conditioned = solve_channel_with_inputs(
                            prepared,
                            pair[0],
                            &conditioned_inputs,
                            &model.primary_terms,
                            &model.secondary_terms,
                            model.window_length,
                            self.options.svd_backend,
                        );
                        let observed =
                            conditional_causal_improvement(baseline.rmse, conditioned.rmse);

                        let significance = if enabled_ccdsig {
                            let surrogate_shifts =
                                ccd_surrogate_shifts.clone().unwrap_or_else(|| {
                                    default_surrogate_shifts(prepared.shifted.len())
                                });
                            let surrogate_inputs = confounds
                                .iter()
                                .map(|channel| extract_shifted_channel_series(prepared, *channel))
                                .collect::<Vec<_>>();
                            let source_series = extract_shifted_channel_series(prepared, pair[1]);
                            let null_scores = surrogate_shifts
                                .into_iter()
                                .filter(|shift| *shift > 0)
                                .map(|shift| {
                                    let shifted_source =
                                        circular_shift_series(&source_series, shift);
                                    let mut conditioned_surrogates = surrogate_inputs.clone();
                                    conditioned_surrogates.push(shifted_source);
                                    let surrogate_block = solve_channel_with_surrogate_inputs(
                                        prepared,
                                        pair[0],
                                        &conditioned_surrogates,
                                        &model.primary_terms,
                                        &model.secondary_terms,
                                        model.window_length,
                                        self.options.svd_backend,
                                    );
                                    conditional_causal_improvement(
                                        baseline.rmse,
                                        surrogate_block.rmse,
                                    )
                                })
                                .collect::<Vec<_>>();
                            empirical_significance_confidence(observed, &null_scores)
                        } else {
                            f64::NAN
                        };

                        (observed, significance)
                    },
                );
                for (pair_idx, _) in ccd_pairs.iter().enumerate() {
                    report(
                        "ccd",
                        "Computing conditional directed causal pairs",
                        window_idx + 1,
                        pair_idx + 1,
                        ccd_pairs.len(),
                        "pair",
                        ccd_pair_labels
                            .as_ref()
                            .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                    );
                }
                if let Some(matrix) = ccd_matrix.as_mut() {
                    for (pair_idx, value) in ccd_values.iter().enumerate() {
                        matrix[pair_idx][window_idx] = value.0;
                    }
                }
                if let Some(matrix) = ccdsig_matrix.as_mut() {
                    for (pair_idx, value) in ccd_values.into_iter().enumerate() {
                        matrix[pair_idx][window_idx] = value.1;
                    }
                }
            }

            if enabled_mvccd {
                let mvccd_values = compute_mvccd_window_scores(
                    prepared,
                    &ccd_pairs,
                    &ccd_target_conditioning_sets,
                    &model,
                    ccd_max_active_sources,
                    self.options.svd_backend,
                );
                for (pair_idx, _) in ccd_pairs.iter().enumerate() {
                    report(
                        "mvccd",
                        "Computing sparse multivariate conditional pairs",
                        window_idx + 1,
                        pair_idx + 1,
                        ccd_pairs.len(),
                        "pair",
                        ccd_pair_labels
                            .as_ref()
                            .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                    );
                }
                if let Some(matrix) = mvccd_matrix.as_mut() {
                    for (pair_idx, value) in mvccd_values.into_iter().enumerate() {
                        matrix[pair_idx][window_idx] = value;
                    }
                }
            }

            if let Some(matrix) = sy_matrix.as_mut() {
                let sy_values = solve_channels_parallel(&sy_pairs, |pair| {
                    let forward = solve_directed_pair(
                        &prepared,
                        pair[0],
                        pair[1],
                        pair[1],
                        &model.primary_terms,
                        &model.secondary_terms,
                        model.window_length,
                        self.options.svd_backend,
                    );
                    let reverse = solve_directed_pair(
                        &prepared,
                        pair[1],
                        pair[0],
                        pair[0],
                        &model.primary_terms,
                        &model.secondary_terms,
                        model.window_length,
                        self.options.svd_backend,
                    );
                    (forward.rmse, reverse.rmse)
                });
                for (pair_idx, _) in sy_pairs.iter().enumerate() {
                    report(
                        "sy",
                        "Computing synchronization directions",
                        window_idx + 1,
                        pair_idx * 2 + 1,
                        sy_pairs.len() * 2,
                        "direction",
                        sy_forward_labels
                            .as_ref()
                            .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                    );
                    report(
                        "sy",
                        "Computing synchronization directions",
                        window_idx + 1,
                        pair_idx * 2 + 2,
                        sy_pairs.len() * 2,
                        "direction",
                        sy_reverse_labels
                            .as_ref()
                            .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                    );
                }
                for (pair_idx, (forward_rmse, reverse_rmse)) in sy_values.into_iter().enumerate() {
                    if variant_mode.sy_mode == 2 {
                        let row_base = pair_idx * 2;
                        matrix[row_base][window_idx] = forward_rmse;
                        matrix[row_base + 1][window_idx] = reverse_rmse;
                    } else {
                        matrix[pair_idx][window_idx] =
                            synchronization_value(1, forward_rmse, reverse_rmse);
                    }
                }
            }
        }

        if enabled_trccd {
            if let Some(matrix) = trccd_matrix.as_mut() {
                let windows = prepared_windows.as_deref().unwrap_or(&[]);
                let regularized = compute_trccd_matrix(
                    windows,
                    &ccd_pairs,
                    &ccd_pair_conditioning_sets,
                    &model,
                    ccd_temporal_lambda,
                    self.options.svd_backend,
                );
                for (pair_idx, row) in regularized.into_iter().enumerate() {
                    report(
                        "trccd",
                        "Computing temporally regularized conditional pairs",
                        num_windows,
                        pair_idx + 1,
                        ccd_pairs.len(),
                        "pair",
                        ccd_pair_labels
                            .as_ref()
                            .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                    );
                    matrix[pair_idx] = row;
                }
            }
        }

        if enabled_ccdstab {
            if let Some(base_ccd) = ccd_matrix.as_ref() {
                let stability = self.compute_ccd_stability_matrix(
                    request,
                    samples,
                    channel_labels,
                    &native_window_markers,
                    &ccd_pairs,
                    base_ccd,
                )?;
                if let Some(matrix) = ccdstab_matrix.as_mut() {
                    for (pair_idx, row) in stability.into_iter().enumerate() {
                        report(
                            "ccdstab",
                            "Computing conditional-pair stability",
                            num_windows,
                            pair_idx + 1,
                            ccd_pairs.len(),
                            "pair",
                            ccd_pair_labels
                                .as_ref()
                                .and_then(|labels| labels.get(pair_idx).map(String::as_str)),
                        );
                        matrix[pair_idx] = row;
                    }
                }
            }
        }

        let mut variant_results = Vec::new();
        if let Some(q_matrix) = st_matrix {
            variant_results.push(VariantResult {
                variant_id: "ST".to_string(),
                variant_name: "Single Timeseries (ST)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_channels(&dataset.channel_labels, &st_channels)),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = ct_matrix {
            variant_results.push(VariantResult {
                variant_id: "CT".to_string(),
                variant_name: "Cross-Timeseries (CT)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_groups(&dataset.channel_labels, &ct_groups, "&")),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = cd_matrix {
            variant_results.push(VariantResult {
                variant_id: "CD".to_string(),
                variant_name: "Cross-Dynamical (CD)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_pairs(&dataset.channel_labels, &cd_pairs, " <- ")),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if enabled_ccd {
            if let Some(q_matrix) = ccd_matrix.clone() {
                variant_results.push(VariantResult {
                    variant_id: "CCD".to_string(),
                    variant_name: "Conditional Cross-Dynamical (CCD)".to_string(),
                    q_matrix,
                    channel_labels: Some(labels_for_pairs(
                        &dataset.channel_labels,
                        &ccd_pairs,
                        " <- ",
                    )),
                    error_values: Some(native_window_markers.clone()),
                });
            }
        }
        if let Some(q_matrix) = ccdsig_matrix {
            variant_results.push(VariantResult {
                variant_id: "CCDSIG".to_string(),
                variant_name: "Conditional Cross-Dynamical Significance (CCDSIG)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_pairs(
                    &dataset.channel_labels,
                    &ccd_pairs,
                    " <- ",
                )),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = ccdstab_matrix {
            variant_results.push(VariantResult {
                variant_id: "CCDSTAB".to_string(),
                variant_name: "Conditional Cross-Dynamical Stability (CCDSTAB)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_pairs(
                    &dataset.channel_labels,
                    &ccd_pairs,
                    " <- ",
                )),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = trccd_matrix {
            variant_results.push(VariantResult {
                variant_id: "TRCCD".to_string(),
                variant_name: "Temporally Regularized Conditional Cross-Dynamical (TRCCD)"
                    .to_string(),
                q_matrix,
                channel_labels: Some(labels_for_pairs(
                    &dataset.channel_labels,
                    &ccd_pairs,
                    " <- ",
                )),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = mvccd_matrix {
            variant_results.push(VariantResult {
                variant_id: "MVCCD".to_string(),
                variant_name: "Sparse Multivariate Conditional Cross-Dynamical (MVCCD)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_pairs(
                    &dataset.channel_labels,
                    &ccd_pairs,
                    " <- ",
                )),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = de_matrix {
            variant_results.push(VariantResult {
                variant_id: "DE".to_string(),
                variant_name: "Dynamical Ergodicity (DE)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_groups(&dataset.channel_labels, &de_groups, "&")),
                error_values: Some(native_window_markers.clone()),
            });
        }
        if let Some(q_matrix) = sy_matrix {
            variant_results.push(VariantResult {
                variant_id: "SY".to_string(),
                variant_name: "Synchronization (SY)".to_string(),
                q_matrix,
                channel_labels: Some(labels_for_sy(
                    &dataset.channel_labels,
                    &sy_pairs,
                    variant_mode.sy_mode,
                )),
                error_values: Some(native_window_markers.clone()),
            });
        }

        let primary_q = variant_results
            .first()
            .map(|variant| variant.q_matrix.clone())
            .unwrap_or_default();

        Ok(DDAResult {
            id: Uuid::new_v4().to_string(),
            file_path: request.file_path.clone(),
            channels: dataset.channel_labels.clone(),
            q_matrix: primary_q,
            variant_results: Some(variant_results),
            raw_output: None,
            window_parameters: request.window_parameters.clone(),
            delay_parameters: request.delay_parameters.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            error_values: Some(native_window_markers),
        })
    }

    fn compute_ccd_stability_matrix(
        &self,
        request: &DDARequest,
        samples: &[Vec<f64>],
        channel_labels: Option<&[String]>,
        base_markers: &[f64],
        ccd_pairs: &[[usize; 2]],
        base_ccd: &[Vec<f64>],
    ) -> Result<Vec<Vec<f64>>> {
        let perturbed_requests = build_ccd_stability_requests(request);
        let mut runs = Vec::new();
        for perturbed in perturbed_requests {
            if let Ok(result) =
                self.run_on_matrix_internal(&perturbed, samples, channel_labels, None)
            {
                if let Some(variant) = result.variant_results.as_ref().and_then(|variants| {
                    variants.iter().find(|variant| variant.variant_id == "CCD")
                }) {
                    let markers = variant
                        .error_values
                        .clone()
                        .or_else(|| result.error_values.clone())
                        .unwrap_or_default();
                    runs.push((markers, variant.q_matrix.clone()));
                }
            }
        }

        let mut stability = vec![vec![f64::NAN; base_markers.len()]; ccd_pairs.len()];
        if runs.is_empty() {
            return Ok(stability);
        }

        for pair_idx in 0..ccd_pairs.len() {
            for (window_idx, marker) in base_markers.iter().enumerate() {
                let reference = base_ccd
                    .get(pair_idx)
                    .and_then(|row| row.get(window_idx))
                    .copied()
                    .unwrap_or(f64::NAN);
                if !reference.is_finite() {
                    continue;
                }
                let threshold = reference.abs().max(1e-9) * 0.5;
                let mut valid = 0usize;
                let mut support = 0usize;
                for (markers, matrix) in &runs {
                    let aligned = nearest_aligned_value(markers, matrix, pair_idx, *marker);
                    if let Some(value) = aligned.filter(|value| value.is_finite()) {
                        valid += 1;
                        if same_sign(reference, value) && value.abs() >= threshold {
                            support += 1;
                        }
                    }
                }
                if valid > 0 {
                    stability[pair_idx][window_idx] = support as f64 / valid as f64;
                }
            }
        }

        Ok(stability)
    }
}

fn extract_shifted_channel_series(prepared: &PreparedWindow, channel: usize) -> Vec<f64> {
    prepared
        .shifted
        .iter()
        .map(|row| row[channel])
        .collect::<Vec<_>>()
}

fn prepare_window_for_analysis(
    dataset: &MatrixDataset<'_>,
    bounds: &AnalysisBounds,
    model: &ModelSpec,
    window_idx: usize,
    options: &PureRustOptions,
) -> Result<PreparedWindow> {
    let native_window_marker = model.window_length + model.max_delay + 2 * model.dm;
    let slice_start = bounds.start + window_idx * model.window_step;
    let slice_end = slice_start + native_window_marker;
    let padded_window = if slice_end <= dataset.rows {
        None
    } else {
        let available = dataset.samples[slice_start..dataset.rows].to_vec();
        let filler = available
            .last()
            .and_then(|row| row.last())
            .copied()
            .unwrap_or(f64::NAN);
        let mut padded = available;
        while padded.len() < native_window_marker {
            padded.push(vec![filler; dataset.cols]);
        }
        Some(padded)
    };
    let raw_window = padded_window
        .as_deref()
        .unwrap_or(&dataset.samples[slice_start..slice_end.min(dataset.rows)]);
    PreparedWindow::from_raw(raw_window, model, options)
}

fn compute_ccd_pair_conditioning_sets(
    prepared_windows: Option<&[PreparedWindow]>,
    ccd_pairs: &[[usize; 2]],
    candidate_channels: &[usize],
    strategy: CcdConditioningStrategy,
    model: &ModelSpec,
    auto_cap: usize,
    svd_backend: SvdBackend,
) -> Vec<Vec<usize>> {
    match strategy {
        CcdConditioningStrategy::AllSelected => ccd_pairs
            .iter()
            .map(|pair| {
                candidate_channels
                    .iter()
                    .copied()
                    .filter(|channel| *channel != pair[0] && *channel != pair[1])
                    .collect::<Vec<_>>()
            })
            .collect(),
        CcdConditioningStrategy::AutoTargetSparse
        | CcdConditioningStrategy::AutoSharedParents
        | CcdConditioningStrategy::AutoGroupOmp => {
            let Some(windows) = prepared_windows else {
                return ccd_pairs
                    .iter()
                    .map(|pair| {
                        candidate_channels
                            .iter()
                            .copied()
                            .filter(|channel| *channel != pair[0] && *channel != pair[1])
                            .collect::<Vec<_>>()
                    })
                    .collect();
            };
            ccd_pairs
                .iter()
                .map(|pair| {
                    auto_select_conditioning_channels_for_pair(
                        windows,
                        pair[0],
                        pair[1],
                        candidate_channels,
                        strategy,
                        model,
                        auto_cap,
                        svd_backend,
                    )
                })
                .collect()
        }
    }
}

fn auto_select_conditioning_channels_for_pair(
    prepared_windows: &[PreparedWindow],
    target: usize,
    source: usize,
    candidate_channels: &[usize],
    strategy: CcdConditioningStrategy,
    model: &ModelSpec,
    auto_cap: usize,
    svd_backend: SvdBackend,
) -> Vec<usize> {
    let usable_candidates = candidate_channels
        .iter()
        .copied()
        .filter(|channel| *channel != target && *channel != source)
        .filter(|channel| channel_is_usable(prepared_windows, *channel))
        .collect::<Vec<_>>();
    if usable_candidates.is_empty() {
        return Vec::new();
    }

    if matches!(strategy, CcdConditioningStrategy::AutoGroupOmp) {
        return omp_select_conditioning_subset(
            prepared_windows,
            target,
            &usable_candidates,
            model,
            auto_cap.max(1),
            svd_backend,
        );
    }

    let target_scores = aggregate_parent_support_scores(
        prepared_windows,
        target,
        &usable_candidates,
        model,
        auto_cap,
        svd_backend,
    );
    let ranked = match strategy {
        CcdConditioningStrategy::AutoTargetSparse => rank_channels_by_scores(&target_scores),
        CcdConditioningStrategy::AutoSharedParents => {
            let source_scores = aggregate_parent_support_scores(
                prepared_windows,
                source,
                &usable_candidates,
                model,
                auto_cap,
                svd_backend,
            );
            let mut shared = target_scores
                .iter()
                .map(|(channel, score)| {
                    (
                        *channel,
                        score.min(source_scores.get(channel).copied().unwrap_or(0.0)),
                    )
                })
                .filter(|(_, score)| score.is_finite() && *score > 0.0)
                .collect::<Vec<_>>();
            shared.sort_by(|left, right| {
                right
                    .1
                    .partial_cmp(&left.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| left.0.cmp(&right.0))
            });
            shared.into_iter().map(|(channel, _)| channel).collect()
        }
        CcdConditioningStrategy::AutoGroupOmp => usable_candidates,
        CcdConditioningStrategy::AllSelected => usable_candidates,
    };

    greedy_select_conditioning_subset(
        prepared_windows,
        target,
        &ranked,
        model,
        auto_cap.max(1),
        svd_backend,
    )
}

fn channel_is_usable(prepared_windows: &[PreparedWindow], channel: usize) -> bool {
    prepared_windows.iter().any(|prepared| {
        prepared
            .shifted
            .iter()
            .any(|row| row.get(channel).copied().unwrap_or(f64::NAN).is_finite())
            && prepared
                .deriv
                .get(channel)
                .map(|values| values.iter().any(|value| value.is_finite()))
                .unwrap_or(false)
    })
}

fn aggregate_parent_support_scores(
    prepared_windows: &[PreparedWindow],
    target: usize,
    candidate_channels: &[usize],
    model: &ModelSpec,
    auto_cap: usize,
    svd_backend: SvdBackend,
) -> std::collections::BTreeMap<usize, f64> {
    let mut sums = std::collections::BTreeMap::<usize, f64>::new();
    let mut counts = std::collections::BTreeMap::<usize, usize>::new();
    for prepared in prepared_windows {
        for (channel, improvement) in greedy_sparse_unique_improvements(
            prepared,
            target,
            candidate_channels,
            &[],
            &model.primary_terms,
            &model.secondary_terms,
            model.window_length,
            auto_cap.max(1),
            svd_backend,
        ) {
            if improvement.is_finite() && improvement > 0.0 {
                *sums.entry(channel).or_insert(0.0) += improvement;
                *counts.entry(channel).or_insert(0) += 1;
            }
        }
    }
    candidate_channels
        .iter()
        .copied()
        .map(|channel| {
            let score = match (sums.get(&channel), counts.get(&channel)) {
                (Some(sum), Some(count)) if *count > 0 => *sum / (*count as f64),
                _ => 0.0,
            };
            (channel, score)
        })
        .collect()
}

fn rank_channels_by_scores(scores: &std::collections::BTreeMap<usize, f64>) -> Vec<usize> {
    let mut ranked = scores
        .iter()
        .filter(|(_, score)| score.is_finite() && **score > 0.0)
        .map(|(channel, score)| (*channel, *score))
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
    ranked.into_iter().map(|(channel, _)| channel).collect()
}

fn greedy_select_conditioning_subset(
    prepared_windows: &[PreparedWindow],
    target: usize,
    ranked_candidates: &[usize],
    model: &ModelSpec,
    auto_cap: usize,
    svd_backend: SvdBackend,
) -> Vec<usize> {
    let mut selected = Vec::new();
    let mut current_score = average_conditioned_baseline_score(
        prepared_windows,
        target,
        &selected,
        model,
        svd_backend,
    );
    for &candidate in ranked_candidates.iter().take(auto_cap) {
        let mut trial = selected.clone();
        trial.push(candidate);
        let trial_score = average_conditioned_baseline_score(
            prepared_windows,
            target,
            &trial,
            model,
            svd_backend,
        );
        if trial_score + 1e-9 < current_score {
            selected = trial;
            current_score = trial_score;
        }
    }
    selected
}

fn omp_select_conditioning_subset(
    prepared_windows: &[PreparedWindow],
    target: usize,
    candidate_channels: &[usize],
    model: &ModelSpec,
    auto_cap: usize,
    svd_backend: SvdBackend,
) -> Vec<usize> {
    let mut selected = Vec::<usize>::new();
    let mut remaining = candidate_channels.to_vec();
    let mut current_score = average_conditioned_baseline_score(
        prepared_windows,
        target,
        &selected,
        model,
        svd_backend,
    );

    for _ in 0..auto_cap.min(remaining.len()) {
        let mut best_candidate = None::<(usize, f64, f64)>;
        for &candidate in &remaining {
            let mut trial = selected.clone();
            trial.push(candidate);
            let trial_rmse = average_conditioned_baseline_rmse(
                prepared_windows,
                target,
                &trial,
                model,
                svd_backend,
            );
            let trial_score = average_conditioned_baseline_score(
                prepared_windows,
                target,
                &trial,
                model,
                svd_backend,
            );
            let required_gain = 1e-4 * current_score.abs().max(1.0);
            if current_score - trial_score <= required_gain {
                continue;
            }
            let take = match best_candidate {
                None => true,
                Some((best_channel, best_rmse, best_score)) => {
                    trial_rmse < best_rmse - 1e-12
                        || ((trial_rmse - best_rmse).abs() <= 1e-12
                            && (trial_score < best_score - 1e-12
                                || ((trial_score - best_score).abs() <= 1e-12
                                    && candidate < best_channel)))
                }
            };
            if take {
                best_candidate = Some((candidate, trial_rmse, trial_score));
            }
        }

        let Some((candidate, _trial_rmse, trial_score)) = best_candidate else {
            break;
        };
        selected.push(candidate);
        remaining.retain(|channel| *channel != candidate);
        current_score = trial_score;
    }

    selected.sort_unstable();
    selected
}

fn average_conditioned_baseline_score(
    prepared_windows: &[PreparedWindow],
    target: usize,
    confounds: &[usize],
    model: &ModelSpec,
    svd_backend: SvdBackend,
) -> f64 {
    let (window_scores, _) = conditioned_baseline_window_metrics(
        prepared_windows,
        target,
        confounds,
        model,
        svd_backend,
    );
    finite_mean(&window_scores).unwrap_or(f64::INFINITY)
}

fn average_conditioned_baseline_rmse(
    prepared_windows: &[PreparedWindow],
    target: usize,
    confounds: &[usize],
    model: &ModelSpec,
    svd_backend: SvdBackend,
) -> f64 {
    let (_, window_rmses) = conditioned_baseline_window_metrics(
        prepared_windows,
        target,
        confounds,
        model,
        svd_backend,
    );
    finite_mean(&window_rmses).unwrap_or(f64::INFINITY)
}

fn conditioned_baseline_window_metrics(
    prepared_windows: &[PreparedWindow],
    target: usize,
    confounds: &[usize],
    model: &ModelSpec,
    svd_backend: SvdBackend,
) -> (Vec<f64>, Vec<f64>) {
    let parameter_count = model.primary_terms.len() + confounds.len() * model.secondary_terms.len();
    let mut window_scores = Vec::with_capacity(prepared_windows.len());
    let mut window_rmses = Vec::with_capacity(prepared_windows.len());
    for prepared in prepared_windows {
        let block = solve_channel_with_inputs(
            prepared,
            target,
            confounds,
            &model.primary_terms,
            &model.secondary_terms,
            model.window_length,
            svd_backend,
        );
        let rmse = block.rmse;
        let score = bic_like_score(rmse, model.window_length, parameter_count);
        window_scores.push(score);
        window_rmses.push(rmse);
    }
    (window_scores, window_rmses)
}

fn finite_mean(values: &[f64]) -> Option<f64> {
    let mut total = 0.0;
    let mut count = 0usize;
    for value in values {
        if value.is_finite() {
            total += *value;
            count += 1;
        }
    }
    (count > 0).then_some(total / (count as f64))
}

fn build_target_conditioning_sets(
    ccd_pairs: &[[usize; 2]],
    pair_conditioning_sets: &[Vec<usize>],
) -> std::collections::BTreeMap<usize, Vec<usize>> {
    use std::collections::{BTreeMap, BTreeSet};

    let mut grouped = BTreeMap::<usize, BTreeSet<usize>>::new();
    for (pair, confounds) in ccd_pairs.iter().zip(pair_conditioning_sets.iter()) {
        let entry = grouped.entry(pair[0]).or_default();
        for &channel in confounds {
            entry.insert(channel);
        }
    }
    grouped
        .into_iter()
        .map(|(target, channels)| (target, channels.into_iter().collect()))
        .collect()
}

fn default_surrogate_shifts(series_len: usize) -> Vec<usize> {
    if series_len < 8 {
        return Vec::new();
    }
    let mut shifts = vec![
        series_len / 6,
        series_len / 4,
        series_len / 3,
        series_len / 2,
        (2 * series_len) / 3,
    ];
    shifts.retain(|shift| *shift > 0 && *shift < series_len);
    shifts.sort_unstable();
    shifts.dedup();
    shifts
}

fn compute_mvccd_window_scores(
    prepared: &PreparedWindow,
    ccd_pairs: &[[usize; 2]],
    target_conditioning_sets: &std::collections::BTreeMap<usize, Vec<usize>>,
    model: &ModelSpec,
    max_active_sources: usize,
    svd_backend: SvdBackend,
) -> Vec<f64> {
    use std::collections::{BTreeMap, BTreeSet};

    let mut pairs_by_target: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (pair_idx, pair) in ccd_pairs.iter().enumerate() {
        pairs_by_target.entry(pair[0]).or_default().push(pair_idx);
    }

    let mut values = vec![0.0; ccd_pairs.len()];
    for (target, pair_indices) in pairs_by_target {
        let candidate_sources = pair_indices
            .iter()
            .map(|pair_idx| ccd_pairs[*pair_idx][1])
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let fixed_inputs = target_conditioning_sets
            .get(&target)
            .into_iter()
            .flat_map(|channels| channels.iter().copied())
            .filter(|channel| *channel != target && !candidate_sources.contains(channel))
            .collect::<Vec<_>>();
        let improvements = greedy_sparse_unique_improvements(
            prepared,
            target,
            &candidate_sources,
            &fixed_inputs,
            &model.primary_terms,
            &model.secondary_terms,
            model.window_length,
            max_active_sources,
            svd_backend,
        );
        for pair_idx in pair_indices {
            let source = ccd_pairs[pair_idx][1];
            values[pair_idx] = improvements
                .iter()
                .find(|(candidate, _)| *candidate == source)
                .map(|(_, value)| *value)
                .unwrap_or(0.0);
        }
    }
    values
}

fn compute_trccd_matrix(
    prepared_windows: &[PreparedWindow],
    ccd_pairs: &[[usize; 2]],
    pair_conditioning_sets: &[Vec<usize>],
    model: &ModelSpec,
    lambda: f64,
    svd_backend: SvdBackend,
) -> Vec<Vec<f64>> {
    solve_channels_parallel(
        &ccd_pairs
            .iter()
            .zip(pair_conditioning_sets.iter())
            .collect::<Vec<_>>(),
        |(pair, confounds)| {
            let conditioned_inputs = {
                let mut inputs = (*confounds).clone();
                inputs.push(pair[1]);
                inputs
            };
            let baseline_windows = prepared_windows
                .iter()
                .map(|prepared| {
                    build_channel_regression_window_with_inputs(
                        prepared,
                        pair[0],
                        &confounds,
                        &model.primary_terms,
                        &model.secondary_terms,
                        model.window_length,
                    )
                })
                .collect::<Vec<_>>();
            let conditioned_windows = prepared_windows
                .iter()
                .map(|prepared| {
                    build_channel_regression_window_with_inputs(
                        prepared,
                        pair[0],
                        &conditioned_inputs,
                        &model.primary_terms,
                        &model.secondary_terms,
                        model.window_length,
                    )
                })
                .collect::<Vec<_>>();
            let baseline_blocks =
                solve_temporally_regularized_windows(&baseline_windows, lambda, svd_backend);
            let conditioned_blocks = solve_temporally_regularized_windows(
                &conditioned_windows,
                lambda,
                svd_backend,
            );
            baseline_blocks
                .iter()
                .zip(conditioned_blocks.iter())
                .map(|(baseline, conditioned)| {
                    conditional_causal_improvement(baseline.rmse, conditioned.rmse)
                })
                .collect::<Vec<_>>()
        },
    )
}

fn build_ccd_stability_requests(request: &DDARequest) -> Vec<DDARequest> {
    let mut requests = Vec::new();
    let mut base = request.clone();
    base.algorithm_selection.enabled_variants = vec!["CCD".to_string()];
    base.algorithm_selection.select_mask = None;

    let base_wl = base.window_parameters.window_length.max(32);
    let base_ws = base.window_parameters.window_step.max(1);
    let mut delays = base.delay_parameters.delays.clone();
    if delays.is_empty() {
        delays = crate::types::DEFAULT_DELAYS.to_vec();
    }

    let mut shorter = base.clone();
    shorter.window_parameters.window_length = (base_wl.saturating_mul(4) / 5).max(32);
    shorter.window_parameters.window_step = (base_ws.saturating_mul(4) / 5).max(1);
    requests.push(shorter);

    let mut longer = base.clone();
    longer.window_parameters.window_length = (base_wl.saturating_mul(6) / 5).max(base_wl + 1);
    longer.window_parameters.window_step = (base_ws.saturating_mul(6) / 5).max(base_ws + 1);
    requests.push(longer);

    if delays.iter().all(|delay| *delay > 0) {
        let mut lower_delays = base.clone();
        lower_delays.delay_parameters.delays = delays.iter().map(|delay| delay - 1).collect();
        requests.push(lower_delays);
    }

    let mut mixed = base;
    mixed.window_parameters.window_length = (base_wl.saturating_mul(4) / 5).max(32);
    mixed.window_parameters.window_step = (base_ws.saturating_mul(4) / 5).max(1);
    if delays.iter().all(|delay| *delay > 0) {
        mixed.delay_parameters.delays = delays.iter().map(|delay| delay - 1).collect();
    }
    requests.push(mixed);

    dedup_stability_requests(requests)
}

fn dedup_stability_requests(requests: Vec<DDARequest>) -> Vec<DDARequest> {
    use std::collections::BTreeSet;

    let mut seen = BTreeSet::new();
    let mut deduped = Vec::new();
    for request in requests {
        let key = (
            request.window_parameters.window_length,
            request.window_parameters.window_step,
            request.delay_parameters.delays.clone(),
        );
        if seen.insert(key) {
            deduped.push(request);
        }
    }
    deduped
}

fn nearest_aligned_value(
    markers: &[f64],
    matrix: &[Vec<f64>],
    row_idx: usize,
    target_marker: f64,
) -> Option<f64> {
    let row = matrix.get(row_idx)?;
    let nearest_index = markers
        .iter()
        .enumerate()
        .min_by(|(_, left), (_, right)| {
            (*left - target_marker)
                .abs()
                .partial_cmp(&(*right - target_marker).abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)?;
    row.get(nearest_index).copied()
}

fn same_sign(left: f64, right: f64) -> bool {
    (left > 0.0 && right > 0.0) || (left < 0.0 && right < 0.0)
}

pub fn run_request_on_matrix(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
) -> Result<DDAResult> {
    PureRustRunner::default().run_on_matrix(request, samples, channel_labels)
}

pub fn inspect_ccd_conditioning_sets_on_matrix(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
) -> Result<CcdConditioningInspection> {
    PureRustRunner::default().inspect_ccd_conditioning_sets_on_matrix(
        request,
        samples,
        channel_labels,
    )
}

pub fn score_ccd_conditioning_subsets_on_matrix(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
    pair: [usize; 2],
    confound_sets: &[Vec<usize>],
) -> Result<Vec<CcdConditioningSubsetScore>> {
    PureRustRunner::default().score_ccd_conditioning_subsets_on_matrix(
        request,
        samples,
        channel_labels,
        pair,
        confound_sets,
    )
}

pub fn profile_ccd_conditioning_subsets_on_matrix(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
    pair: [usize; 2],
    confound_sets: &[Vec<usize>],
) -> Result<Vec<CcdConditioningSubsetProfile>> {
    PureRustRunner::default().profile_ccd_conditioning_subsets_on_matrix(
        request,
        samples,
        channel_labels,
        pair,
        confound_sets,
    )
}

pub fn run_request_on_matrix_with_progress<F>(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
    on_progress: F,
) -> Result<DDAResult>
where
    F: FnMut(&PureRustProgress),
{
    PureRustRunner::default().run_on_matrix_with_progress(
        request,
        samples,
        channel_labels,
        on_progress,
    )
}
