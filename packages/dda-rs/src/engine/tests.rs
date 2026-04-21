use std::collections::HashMap;

use tempfile::NamedTempFile;

use super::model::{monomial_list, nr_multicombinations, select_model_terms};
use super::*;
use crate::input_io::load_f64_matrix_from_path;
use crate::types::{
    AlgorithmSelection, CcdConditioningStrategy, DDARequest, DelayParameters, ModelParameters,
    PreprocessingOptions, TimeRange, VariantChannelConfig, WindowParameters,
};

fn synthetic_samples() -> Vec<Vec<f64>> {
    let mut x0 = vec![0.0; 1800];
    let mut x1 = vec![0.0; 1800];
    let mut x2 = vec![0.0; 1800];
    for t in 4..1800 {
        let drive = (0.017 * (t as f64)).sin() + 0.3 * (0.041 * (t as f64)).cos();
        x0[t] = 0.82 * x0[t - 1] - 0.12 * x0[t - 2] + drive;
        x1[t] = 0.55 * x1[t - 1] + 0.27 * x0[t - 2] - 0.08 * x0[t - 1] * x0[t - 1] + 0.1 * drive;
        x2[t] = 0.48 * x2[t - 1] + 0.22 * x1[t - 1] + 0.18 * x0[t - 3];
    }
    (0..1800).map(|t| vec![x0[t], x1[t], x2[t]]).collect()
}

fn common_drive_samples() -> Vec<Vec<f64>> {
    let n = 1600usize;
    let mut x = vec![0.0; n];
    let mut y = vec![0.0; n];
    let mut z = vec![0.0; n];
    for t in 4..n {
        let drive = (0.013 * t as f64).sin() + 0.4 * (0.029 * t as f64).cos();
        z[t] = 0.86 * z[t - 1] - 0.18 * z[t - 2] + drive;
        x[t] = 0.62 * x[t - 1] + 0.31 * z[t - 1] - 0.07 * z[t - 2] + 0.03 * drive;
        y[t] = 0.58 * y[t - 1] + 0.28 * z[t - 1] + 0.05 * z[t - 2] - 0.02 * drive;
    }
    (0..n).map(|t| vec![x[t], y[t], z[t]]).collect()
}

fn common_drive_with_nuisance_samples() -> Vec<Vec<f64>> {
    let n = 1600usize;
    let mut x = vec![0.0; n];
    let mut y = vec![0.0; n];
    let mut z = vec![0.0; n];
    let mut u = vec![0.0; n];
    for t in 4..n {
        let drive = (0.013 * t as f64).sin() + 0.4 * (0.029 * t as f64).cos();
        let nuisance = 0.5 * (0.021 * t as f64).cos() - 0.3 * (0.037 * t as f64).sin();
        z[t] = 0.86 * z[t - 1] - 0.18 * z[t - 2] + drive;
        u[t] = 0.81 * u[t - 1] - 0.16 * u[t - 2] + nuisance;
        x[t] = 0.62 * x[t - 1] + 0.31 * z[t - 1] - 0.07 * z[t - 2] + 0.01 * u[t - 1];
        y[t] = 0.58 * y[t - 1] + 0.28 * z[t - 1] + 0.05 * z[t - 2] - 0.01 * u[t - 1];
    }
    (0..n).map(|t| vec![x[t], y[t], z[t], u[t]]).collect()
}

fn planted_single_confound_samples() -> Vec<Vec<f64>> {
    let n = 1800usize;
    let mut x = vec![0.0; n];
    let mut y = vec![0.0; n];
    let mut z = vec![0.0; n];
    let mut u = vec![0.0; n];
    for t in 4..n {
        let drive_z = (0.011 * t as f64).sin() + 0.37 * (0.031 * t as f64).cos();
        let drive_u = 0.41 * (0.019 * t as f64).cos() - 0.22 * (0.043 * t as f64).sin();
        z[t] = 0.88 * z[t - 1] - 0.21 * z[t - 2] + drive_z;
        u[t] = 0.84 * u[t - 1] - 0.18 * u[t - 2] + drive_u;
        x[t] = 0.59 * x[t - 1] + 0.36 * z[t - 1] - 0.09 * z[t - 2];
        y[t] = 0.63 * y[t - 1] + 0.34 * z[t - 1] + 0.06 * z[t - 2];
    }
    (0..n).map(|t| vec![x[t], y[t], z[t], u[t]]).collect()
}

fn planted_two_confound_samples() -> Vec<Vec<f64>> {
    let n = 1800usize;
    let mut x = vec![0.0; n];
    let mut y = vec![0.0; n];
    let mut z = vec![0.0; n];
    let mut w = vec![0.0; n];
    let mut u = vec![0.0; n];
    for t in 4..n {
        let drive_z = (0.012 * t as f64).sin() + 0.33 * (0.028 * t as f64).cos();
        let drive_w = 0.46 * (0.017 * t as f64).cos() - 0.27 * (0.039 * t as f64).sin();
        let drive_u = 0.38 * (0.023 * t as f64).sin() + 0.19 * (0.047 * t as f64).cos();
        z[t] = 0.87 * z[t - 1] - 0.19 * z[t - 2] + drive_z;
        w[t] = 0.82 * w[t - 1] - 0.16 * w[t - 2] + drive_w;
        u[t] = 0.79 * u[t - 1] - 0.14 * u[t - 2] + drive_u;
        x[t] = 0.44 * x[t - 1] + 0.31 * z[t - 1] - 0.09 * z[t - 2] + 0.37 * w[t - 1];
        y[t] = 0.47 * y[t - 1] + 0.29 * z[t - 1] + 0.06 * z[t - 2] + 0.35 * w[t - 1];
    }
    (0..n).map(|t| vec![x[t], y[t], z[t], w[t], u[t]]).collect()
}

fn write_raw_f64_matrix(samples: &[Vec<f64>]) -> NamedTempFile {
    use std::io::Write;
    let mut file = NamedTempFile::new().expect("temp raw matrix file");
    for row in samples {
        for value in row {
            file.write_all(&value.to_le_bytes())
                .expect("write raw matrix scalar");
        }
    }
    file
}

fn ccd_auto_request(file_path: String, strategy: CcdConditioningStrategy) -> DDARequest {
    let mut variant_configs = HashMap::new();
    variant_configs.insert(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(vec![0, 1, 2]),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(vec![[1, 0]]),
            conditioning_channels: None,
            conditioning_strategy: Some(strategy),
            surrogate_shifts: None,
            temporal_lambda: None,
            max_active_sources: Some(3),
        },
    );
    DDARequest {
        file_path,
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 1599.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["CCD".to_string()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: 96,
            window_step: 48,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        delay_parameters: DelayParameters { delays: vec![1, 2] },
        ct_channel_pairs: None,
        cd_channel_pairs: Some(vec![[1, 0]]),
        model_parameters: Some(ModelParameters {
            dm: 4,
            order: 4,
            nr_tau: 2,
        }),
        model_terms: Some(vec![1, 2, 10]),
        variant_configs: Some(variant_configs),
        sampling_rate: None,
    }
}

fn ccd_auto_request_with_channels(
    file_path: String,
    strategy: CcdConditioningStrategy,
    channels: Vec<usize>,
) -> DDARequest {
    let mut variant_configs = HashMap::new();
    variant_configs.insert(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(channels.clone()),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(vec![[1, 0]]),
            conditioning_channels: None,
            conditioning_strategy: Some(strategy),
            surrogate_shifts: None,
            temporal_lambda: None,
            max_active_sources: Some(3),
        },
    );
    DDARequest {
        file_path,
        channels: Some(channels),
        time_range: TimeRange {
            start: 0.0,
            end: 1599.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["CCD".to_string()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: 96,
            window_step: 48,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        delay_parameters: DelayParameters { delays: vec![1, 2] },
        ct_channel_pairs: None,
        cd_channel_pairs: Some(vec![[1, 0]]),
        model_parameters: Some(ModelParameters {
            dm: 4,
            order: 4,
            nr_tau: 2,
        }),
        model_terms: Some(vec![1, 2, 10]),
        variant_configs: Some(variant_configs),
        sampling_rate: None,
    }
}

fn ccd_group_omp_request_with_channels(file_path: String, channels: Vec<usize>) -> DDARequest {
    let mut variant_configs = HashMap::new();
    variant_configs.insert(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(channels.clone()),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(vec![[1, 0]]),
            conditioning_channels: None,
            conditioning_strategy: Some(CcdConditioningStrategy::AutoGroupOmp),
            surrogate_shifts: None,
            temporal_lambda: None,
            max_active_sources: Some(4),
        },
    );
    DDARequest {
        file_path,
        channels: Some(channels),
        time_range: TimeRange {
            start: 0.0,
            end: 1799.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["CCD".to_string()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: 128,
            window_step: 64,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        delay_parameters: DelayParameters { delays: vec![1] },
        ct_channel_pairs: None,
        cd_channel_pairs: Some(vec![[1, 0]]),
        model_parameters: Some(ModelParameters {
            dm: 2,
            order: 1,
            nr_tau: 1,
        }),
        model_terms: Some(vec![1]),
        variant_configs: Some(variant_configs),
        sampling_rate: None,
    }
}

#[test]
fn raw_f64_matrix_loader_roundtrips() {
    let samples = synthetic_samples();
    let raw = write_raw_f64_matrix(&samples);
    let restored = load_f64_matrix_from_path(raw.path(), samples.len(), samples[0].len()).unwrap();
    assert_eq!(restored.len(), samples.len());
    assert_eq!(restored[0].len(), samples[0].len());
    assert!((restored[42][1] - samples[42][1]).abs() < 1e-12);
    assert!((restored[777][2] - samples[777][2]).abs() < 1e-12);
}

#[test]
fn monomial_count_matches_reference_formula() {
    assert_eq!(nr_multicombinations(2, 4), 14);
    assert_eq!(nr_multicombinations(3, 3), 19);
}

#[test]
fn model_selection_resolves_actual_delays() {
    let monomials = monomial_list(2, 4);
    let selected =
        select_model_terms(&monomials, &[1, 2, 10], &[7, 10]).expect("select model terms");
    assert_eq!(selected[0], vec![7]);
    assert_eq!(selected[1], vec![10]);
    assert_eq!(selected[2], vec![7, 7, 7, 7]);
}

#[test]
fn temporal_regularization_smooths_and_recovers_slowly_varying_coefficients() {
    use super::solver::{
        solve_regression_window, solve_temporally_regularized_windows, RegressionWindow,
    };

    let window_count = 12usize;
    let rows = 64usize;
    let cols = 2usize;

    let true_coefficients = (0..window_count)
        .map(|window_idx| {
            let t = window_idx as f64;
            vec![1.0 + 0.03 * t, -0.55 + 0.015 * t]
        })
        .collect::<Vec<_>>();

    let windows = true_coefficients
        .iter()
        .enumerate()
        .map(|(window_idx, beta)| {
            let mut flat_design = Vec::with_capacity(rows * cols);
            let mut target = Vec::with_capacity(rows);
            for sample_idx in 0..rows {
                let s = sample_idx as f64;
                let x0 = ((s + 1.0) / 7.0).sin() + 0.35 * ((s + 3.0) / 5.0).cos();
                let x1 = ((s + 2.0) / 9.0).cos() - 0.30 * ((s + 5.0) / 4.0).sin();
                flat_design.push(x0);
                flat_design.push(x1);
                let deterministic_noise = 0.08
                    * (((window_idx as f64) * 0.9 + s * 0.21).sin()
                        + 0.5 * ((window_idx as f64) * 0.4 + s * 0.37).cos());
                target.push(beta[0] * x0 + beta[1] * x1 + deterministic_noise);
            }
            RegressionWindow {
                rows,
                cols,
                flat_design,
                fit_target: target.clone(),
                residual_target: target,
            }
        })
        .collect::<Vec<_>>();

    let independent = windows
        .iter()
        .map(|window| solve_regression_window(window, SvdBackend::RobustSvd))
        .collect::<Vec<_>>();
    let regularized =
        solve_temporally_regularized_windows(&windows, 6.0, SvdBackend::RobustSvd);

    let coefficient_tv = |blocks: &[super::solver::SolvedBlock]| -> f64 {
        blocks
            .windows(2)
            .map(|pair| {
                pair[0]
                    .coefficients
                    .iter()
                    .zip(pair[1].coefficients.iter())
                    .map(|(left, right)| (right - left).abs())
                    .sum::<f64>()
            })
            .sum::<f64>()
    };
    let coefficient_mse = |blocks: &[super::solver::SolvedBlock]| -> f64 {
        blocks
            .iter()
            .zip(true_coefficients.iter())
            .map(|(block, truth)| {
                block
                    .coefficients
                    .iter()
                    .zip(truth.iter())
                    .map(|(estimate, truth)| (estimate - truth).powi(2))
                    .sum::<f64>()
                    / (truth.len() as f64)
            })
            .sum::<f64>()
            / (blocks.len() as f64)
    };

    let independent_tv = coefficient_tv(&independent);
    let regularized_tv = coefficient_tv(&regularized);
    let independent_mse = coefficient_mse(&independent);
    let regularized_mse = coefficient_mse(&regularized);

    assert!(
        regularized_tv < independent_tv,
        "temporal regularization should reduce coefficient total variation (independent={}, regularized={})",
        independent_tv,
        regularized_tv
    );
    assert!(
        regularized_mse < independent_mse,
        "temporal regularization should improve recovery of the smooth ground-truth coefficient path (independent={}, regularized={})",
        independent_mse,
        regularized_mse
    );
}

#[test]
fn auto_shared_parents_selects_the_common_driver_channel() {
    let samples = common_drive_samples();
    let request = ccd_auto_request(
        "common_drive".to_string(),
        CcdConditioningStrategy::AutoSharedParents,
    );
    let dataset = super::dataset::MatrixDataset::new(&samples, None).expect("dataset");
    let model = super::model::ModelSpec::from_request(&request).expect("model");
    let bounds =
        super::dataset::AnalysisBounds::from_request(&request, dataset.rows).expect("bounds");
    let num_windows = 1
        + (bounds.len - (model.window_length + model.max_delay + 2 * model.dm - 1))
            / model.window_step;
    let windows = (0..num_windows)
        .map(|window_idx| {
            super::prepare_window_for_analysis(
                &dataset,
                &bounds,
                &model,
                window_idx,
                &PureRustOptions::default(),
            )
            .expect("prepared window")
        })
        .collect::<Vec<_>>();
    let selected = super::compute_ccd_pair_conditioning_sets(
        Some(&windows),
        &[[1, 0]],
        &[0, 1, 2],
        CcdConditioningStrategy::AutoSharedParents,
        &model,
        3,
        SvdBackend::RobustSvd,
    );
    assert_eq!(selected, vec![vec![2]]);
}

#[test]
fn auto_target_sparse_keeps_the_common_driver_even_with_a_nuisance_channel() {
    let samples = common_drive_with_nuisance_samples();
    let request = ccd_auto_request_with_channels(
        "common_drive_with_nuisance".to_string(),
        CcdConditioningStrategy::AutoTargetSparse,
        vec![0, 1, 2, 3],
    );
    let dataset = super::dataset::MatrixDataset::new(&samples, None).expect("dataset");
    let model = super::model::ModelSpec::from_request(&request).expect("model");
    let bounds =
        super::dataset::AnalysisBounds::from_request(&request, dataset.rows).expect("bounds");
    let num_windows = 1
        + (bounds.len - (model.window_length + model.max_delay + 2 * model.dm - 1))
            / model.window_step;
    let windows = (0..num_windows)
        .map(|window_idx| {
            super::prepare_window_for_analysis(
                &dataset,
                &bounds,
                &model,
                window_idx,
                &PureRustOptions::default(),
            )
            .expect("prepared window")
        })
        .collect::<Vec<_>>();
    let selected = super::compute_ccd_pair_conditioning_sets(
        Some(&windows),
        &[[1, 0]],
        &[0, 1, 2, 3],
        CcdConditioningStrategy::AutoTargetSparse,
        &model,
        3,
        SvdBackend::RobustSvd,
    );
    assert!(
        selected.len() == 1 && selected[0].contains(&2),
        "auto_target_sparse should keep the true common driver in the conditioning set (selected={selected:?})"
    );
}

#[test]
fn auto_group_omp_recovers_single_planted_confound_exactly() {
    let samples = planted_single_confound_samples();
    let request = ccd_group_omp_request_with_channels(
        "planted_single_confound".to_string(),
        vec![0, 1, 2, 3],
    );
    let dataset = super::dataset::MatrixDataset::new(&samples, None).expect("dataset");
    let model = super::model::ModelSpec::from_request(&request).expect("model");
    let bounds =
        super::dataset::AnalysisBounds::from_request(&request, dataset.rows).expect("bounds");
    let num_windows = 1
        + (bounds.len - (model.window_length + model.max_delay + 2 * model.dm - 1))
            / model.window_step;
    let windows = (0..num_windows)
        .map(|window_idx| {
            super::prepare_window_for_analysis(
                &dataset,
                &bounds,
                &model,
                window_idx,
                &PureRustOptions::default(),
            )
            .expect("prepared window")
        })
        .collect::<Vec<_>>();
    let selected = super::compute_ccd_pair_conditioning_sets(
        Some(&windows),
        &[[1, 0]],
        &[0, 1, 2, 3],
        CcdConditioningStrategy::AutoGroupOmp,
        &model,
        1,
        SvdBackend::RobustSvd,
    );
    assert_eq!(
        selected,
        vec![vec![2]],
        "auto_group_omp should exactly recover the planted observed confound support in the easy single-confound case"
    );
}

#[test]
fn auto_group_omp_overbudget_stays_within_one_membership_error() {
    let samples = planted_two_confound_samples();
    let request = ccd_group_omp_request_with_channels(
        "planted_two_confound".to_string(),
        vec![0, 1, 2, 3, 4],
    );
    let dataset = super::dataset::MatrixDataset::new(&samples, None).expect("dataset");
    let model = super::model::ModelSpec::from_request(&request).expect("model");
    let bounds =
        super::dataset::AnalysisBounds::from_request(&request, dataset.rows).expect("bounds");
    let num_windows = 1
        + (bounds.len - (model.window_length + model.max_delay + 2 * model.dm - 1))
            / model.window_step;
    let windows = (0..num_windows)
        .map(|window_idx| {
            super::prepare_window_for_analysis(
                &dataset,
                &bounds,
                &model,
                window_idx,
                &PureRustOptions::default(),
            )
            .expect("prepared window")
        })
        .collect::<Vec<_>>();
    let selected = super::compute_ccd_pair_conditioning_sets(
        Some(&windows),
        &[[1, 0]],
        &[0, 1, 2, 3, 4],
        CcdConditioningStrategy::AutoGroupOmp,
        &model,
        4,
        SvdBackend::RobustSvd,
    );
    let chosen = selected[0]
        .iter()
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let truth = [2usize, 3usize]
        .into_iter()
        .collect::<std::collections::BTreeSet<_>>();
    let membership_errors = chosen.symmetric_difference(&truth).count();
    assert!(
        chosen.contains(&2) && chosen.contains(&3),
        "auto_group_omp should keep the true planted confounds even when given extra budget (selected={selected:?})"
    );
    assert!(
        membership_errors <= 1,
        "auto_group_omp should stay within one membership error on the planted two-confound case when over-budgeted (selected={selected:?}, errors={membership_errors})"
    );
}
