use std::collections::HashMap;

use dda_rs::{
    run_request_on_matrix, AlgorithmSelection, CcdConditioningStrategy, DDARequest,
    DelayParameters, ModelParameters, PreprocessingOptions, TimeRange, VariantChannelConfig,
    WindowParameters,
};

#[derive(Clone, Debug)]
struct ValidationConfig {
    name: &'static str,
    delays: Vec<i32>,
    window_length: u32,
    window_step: u32,
}

fn validation_configs() -> Vec<ValidationConfig> {
    vec![
        ValidationConfig {
            name: "baseline",
            delays: vec![1, 2],
            window_length: 96,
            window_step: 48,
        },
        ValidationConfig {
            name: "wider-window",
            delays: vec![1, 2],
            window_length: 128,
            window_step: 64,
        },
        ValidationConfig {
            name: "longer-delays",
            delays: vec![1, 3],
            window_length: 128,
            window_step: 64,
        },
        ValidationConfig {
            name: "coarser-grid",
            delays: vec![2, 4],
            window_length: 160,
            window_step: 80,
        },
    ]
}

fn mean_finite(values: &[f64]) -> f64 {
    let finite = values
        .iter()
        .copied()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    if finite.is_empty() {
        return f64::NAN;
    }
    finite.iter().sum::<f64>() / (finite.len() as f64)
}

fn request_for_cd_and_ccd(
    samples_len: usize,
    channels: Vec<usize>,
    pairs: Vec<[usize; 2]>,
    conditioning_channels: Option<Vec<usize>>,
    conditioning_strategy: Option<CcdConditioningStrategy>,
    delays: Vec<i32>,
    window_length: u32,
    window_step: u32,
) -> DDARequest {
    let mut variant_configs = HashMap::new();
    variant_configs.insert(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(channels.clone()),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(pairs.clone()),
            conditioning_channels,
            conditioning_strategy,
            surrogate_shifts: None,
            temporal_lambda: None,
            max_active_sources: None,
        },
    );

    DDARequest {
        file_path: "<matrix>".to_string(),
        channels: Some(channels),
        time_range: TimeRange {
            start: 0.0,
            end: (samples_len.saturating_sub(1)) as f64,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["CD".to_string(), "CCD".to_string()],
            select_mask: Some("0 0 1 0 0 0".to_string()),
        },
        window_parameters: WindowParameters {
            window_length,
            window_step,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        delay_parameters: DelayParameters { delays },
        ct_channel_pairs: None,
        cd_channel_pairs: Some(pairs),
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

fn simulate_common_drive_system(steps: usize) -> Vec<Vec<f64>> {
    let dt = 0.02_f64;
    let mut x = 0.15_f64;
    let mut y = -0.08_f64;
    let mut z = 0.05_f64;
    let mut samples = Vec::with_capacity(steps);
    for step in 0..steps {
        let t = step as f64 * dt;
        let forcing = 0.9 * (0.7 * t).sin() + 0.35 * (1.3 * t).cos();
        let dz = -0.65 * z + forcing;
        let dx = -0.55 * x + 0.95 * z + 0.12 * (1.1 * t).sin();
        let dy = -0.48 * y + 0.88 * z + 0.08 * (0.9 * t).cos();
        z += dt * dz;
        x += dt * dx;
        y += dt * dy;
        samples.push(vec![x, y, z]);
    }
    samples
}

fn simulate_noisy_common_drive_system(steps: usize) -> Vec<Vec<f64>> {
    let dt = 0.02_f64;
    let mut x = 0.15_f64;
    let mut y = -0.08_f64;
    let mut z = 0.05_f64;
    let mut samples = Vec::with_capacity(steps);
    for step in 0..steps {
        let t = step as f64 * dt;
        let forcing = 0.9 * (0.7 * t).sin() + 0.35 * (1.3 * t).cos();
        let dx_noise = 0.015 * (2.3 * t).sin() + 0.006 * (5.1 * t).cos();
        let dy_noise = 0.013 * (1.7 * t).cos() + 0.005 * (4.7 * t).sin();
        let dz_noise = 0.012 * (2.0 * t).sin() + 0.004 * (6.1 * t).cos();
        let dz = -0.65 * z + forcing + dz_noise;
        let dx = -0.55 * x + 0.95 * z + 0.12 * (1.1 * t).sin() + dx_noise;
        let dy = -0.48 * y + 0.88 * z + 0.08 * (0.9 * t).cos() + dy_noise;
        z += dt * dz;
        x += dt * dx;
        y += dt * dy;
        samples.push(vec![x, y, z]);
    }
    samples
}

fn simulate_direct_drive_system(steps: usize) -> Vec<Vec<f64>> {
    let dt = 0.02_f64;
    let mut x = 0.12_f64;
    let mut y = -0.11_f64;
    let mut z = 0.07_f64;
    let mut samples = Vec::with_capacity(steps);
    for step in 0..steps {
        let t = step as f64 * dt;
        let forcing = 0.8 * (0.6 * t).sin() + 0.25 * (1.5 * t).cos();
        let dz = -0.62 * z + forcing;
        let dx = -0.58 * x + 0.92 * z + 0.10 * (0.8 * t).sin();
        let dy = -0.44 * y + 1.15 * x + 0.04 * (1.1 * t).cos();
        z += dt * dz;
        x += dt * dx;
        y += dt * dy;
        samples.push(vec![x, y, z]);
    }
    samples
}

fn simulate_common_drive_with_nuisance_system(steps: usize) -> Vec<Vec<f64>> {
    let dt = 0.02_f64;
    let mut x = 0.15_f64;
    let mut y = -0.08_f64;
    let mut z = 0.05_f64;
    let mut u = -0.02_f64;
    let mut samples = Vec::with_capacity(steps);
    for step in 0..steps {
        let t = step as f64 * dt;
        let shared = 0.9 * (0.7 * t).sin() + 0.35 * (1.3 * t).cos();
        let nuisance = 0.5 * (0.33 * t).cos() - 0.2 * (1.9 * t).sin();
        let dz = -0.65 * z + shared;
        let du = -0.57 * u + nuisance;
        let dx = -0.55 * x + 0.95 * z + 0.12 * (1.1 * t).sin() + 0.02 * u;
        let dy = -0.48 * y + 0.88 * z + 0.08 * (0.9 * t).cos() - 0.02 * u;
        z += dt * dz;
        u += dt * du;
        x += dt * dx;
        y += dt * dy;
        samples.push(vec![x, y, z, u]);
    }
    samples
}

fn extract_variant_means(result: &dda_rs::DDAResult, variant_id: &str) -> Vec<f64> {
    result
        .variant_results
        .as_ref()
        .and_then(|variants| {
            variants
                .iter()
                .find(|variant| variant.variant_id == variant_id)
        })
        .map(|variant| {
            variant
                .q_matrix
                .iter()
                .map(|row| mean_finite(row))
                .collect()
        })
        .unwrap_or_default()
}

fn evaluate_cd_and_ccd(samples: &[Vec<f64>], config: &ValidationConfig) -> (Vec<f64>, Vec<f64>) {
    let request = request_for_cd_and_ccd(
        samples.len(),
        vec![0, 1, 2],
        vec![[1, 0], [0, 1]],
        Some(vec![2]),
        None,
        config.delays.clone(),
        config.window_length,
        config.window_step,
    );
    let labels = vec!["X".to_string(), "Y".to_string(), "Z".to_string()];
    let result = run_request_on_matrix(&request, samples, Some(&labels)).expect("run DDA");
    (
        extract_variant_means(&result, "CD"),
        extract_variant_means(&result, "CCD"),
    )
}

fn request_for_advanced_ccd(samples_len: usize) -> DDARequest {
    let mut variant_configs = HashMap::new();
    variant_configs.insert(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(vec![0, 1, 2]),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(vec![[1, 0], [1, 2]]),
            conditioning_channels: Some(vec![]),
            conditioning_strategy: None,
            surrogate_shifts: Some(vec![160, 320, 480]),
            temporal_lambda: Some(0.5),
            max_active_sources: Some(2),
        },
    );

    DDARequest {
        file_path: "<matrix>".to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: (samples_len.saturating_sub(1)) as f64,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec![
                "CCD".to_string(),
                "CCDSIG".to_string(),
                "CCDSTAB".to_string(),
                "TRCCD".to_string(),
                "MVCCD".to_string(),
            ],
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
        cd_channel_pairs: Some(vec![[1, 0], [1, 2]]),
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

fn extract_variant_rows(result: &dda_rs::DDAResult, variant_id: &str) -> Vec<Vec<f64>> {
    result
        .variant_results
        .as_ref()
        .and_then(|variants| {
            variants
                .iter()
                .find(|variant| variant.variant_id == variant_id)
        })
        .map(|variant| variant.q_matrix.clone())
        .unwrap_or_default()
}

#[test]
fn conditional_cd_suppresses_common_drive_false_positive() {
    let samples = simulate_common_drive_system(2400);
    let config = &validation_configs()[0];
    let (cd, ccd) = evaluate_cd_and_ccd(&samples, config);

    assert_eq!(cd.len(), 2);
    assert_eq!(ccd.len(), 2);

    println!("common-drive CD means: {:?}", cd);
    println!("common-drive CCD means: {:?}", ccd);

    assert!(cd[0].is_finite() && ccd[0].is_finite());
    assert!(
        ccd[0].abs() < cd[0].abs() * 0.01,
        "conditioning should collapse the spurious Y<-X score by at least two orders of magnitude (CD={}, CCD={})",
        cd[0],
        ccd[0]
    );
}

#[test]
fn auto_conditioning_strategies_suppress_common_drive_with_nuisance_channel() {
    let samples = simulate_common_drive_with_nuisance_system(2600);
    let labels = vec![
        "X".to_string(),
        "Y".to_string(),
        "Z".to_string(),
        "U".to_string(),
    ];
    let pair = vec![[1usize, 0usize]];

    let manual_request = request_for_cd_and_ccd(
        samples.len(),
        vec![0, 1, 2, 3],
        pair.clone(),
        Some(vec![2]),
        None,
        vec![1, 2],
        96,
        48,
    );
    let manual_result =
        run_request_on_matrix(&manual_request, &samples, Some(&labels)).expect("manual CCD");
    let manual_ccd = extract_variant_means(&manual_result, "CCD")[0];

    let auto_target_request = request_for_cd_and_ccd(
        samples.len(),
        vec![0, 1, 2, 3],
        pair.clone(),
        None,
        Some(CcdConditioningStrategy::AutoTargetSparse),
        vec![1, 2],
        96,
        48,
    );
    let auto_target_result = run_request_on_matrix(&auto_target_request, &samples, Some(&labels))
        .expect("auto-target CCD");
    let auto_target_ccd = extract_variant_means(&auto_target_result, "CCD")[0];

    let auto_shared_request = request_for_cd_and_ccd(
        samples.len(),
        vec![0, 1, 2, 3],
        pair,
        None,
        Some(CcdConditioningStrategy::AutoSharedParents),
        vec![1, 2],
        96,
        48,
    );
    let auto_shared_result = run_request_on_matrix(&auto_shared_request, &samples, Some(&labels))
        .expect("auto-shared CCD");
    let auto_shared_ccd = extract_variant_means(&auto_shared_result, "CCD")[0];

    println!(
        "auto conditioning CCD means: manual={}, auto_target={}, auto_shared={}",
        manual_ccd, auto_target_ccd, auto_shared_ccd
    );

    assert!(
        auto_target_ccd.abs() < 1e-5,
        "auto_target_sparse should suppress the spurious Y<-X score despite the nuisance channel (CCD={})",
        auto_target_ccd
    );
    assert!(
        auto_shared_ccd.abs() < 1e-5,
        "auto_shared_parents should suppress the spurious Y<-X score despite the nuisance channel (CCD={})",
        auto_shared_ccd
    );
    assert!(
        (auto_target_ccd - manual_ccd).abs() < 5e-6,
        "auto_target_sparse should stay close to the manual known-confound CCD score (manual={}, auto={})",
        manual_ccd,
        auto_target_ccd
    );
    assert!(
        (auto_shared_ccd - manual_ccd).abs() < 5e-6,
        "auto_shared_parents should stay close to the manual known-confound CCD score (manual={}, auto={})",
        manual_ccd,
        auto_shared_ccd
    );
}

#[test]
fn conditional_cd_preserves_unique_direct_drive() {
    let samples = simulate_direct_drive_system(2400);
    let config = &validation_configs()[0];
    let (_, ccd) = evaluate_cd_and_ccd(&samples, config);

    assert_eq!(ccd.len(), 2);
    println!("direct-drive CCD means: {:?}", ccd);

    assert!(ccd[0].is_finite() && ccd[1].is_finite());
    assert!(
        ccd[0] > ccd[1] * 1.5,
        "conditioning should retain materially stronger Y<-X than X<-Y under direct drive (forward={}, reverse={})",
        ccd[0],
        ccd[1]
    );
    assert!(
        ccd[0] > 1e-6,
        "conditioning should retain a measurable unique Y<-X signal under direct drive (forward={})",
        ccd[0]
    );
}

#[test]
fn conditional_cd_common_drive_suppression_holds_across_parameter_grid() {
    let samples = simulate_noisy_common_drive_system(2800);
    let configs = validation_configs();
    let mut passing = 0usize;

    for config in &configs {
        let (cd, ccd) = evaluate_cd_and_ccd(&samples, config);
        assert!(cd[0].is_finite() && ccd[0].is_finite());
        let suppression_ratio = ccd[0].abs() / cd[0].abs().max(1e-12);
        println!(
            "{} common-drive suppression ratio: {:.6} (CD={}, CCD={})",
            config.name, suppression_ratio, cd[0], ccd[0]
        );
        if suppression_ratio < 0.10 {
            passing += 1;
        }
    }

    assert!(
        passing >= configs.len() - 1,
        "common-drive suppression should hold for nearly all tested parameter settings ({}/{})",
        passing,
        configs.len()
    );
}

#[test]
fn advanced_ccd_variants_produce_expected_shapes_and_orderings() {
    let samples = simulate_noisy_common_drive_system(2800);
    let request = request_for_advanced_ccd(samples.len());
    let labels = vec!["X".to_string(), "Y".to_string(), "Z".to_string()];
    let result = run_request_on_matrix(&request, &samples, Some(&labels)).expect("run DDA");

    let ccd = extract_variant_rows(&result, "CCD");
    let ccdsig = extract_variant_rows(&result, "CCDSIG");
    let ccdstab = extract_variant_rows(&result, "CCDSTAB");
    let trccd = extract_variant_rows(&result, "TRCCD");
    let mvccd = extract_variant_rows(&result, "MVCCD");

    assert_eq!(ccd.len(), 2);
    assert_eq!(ccdsig.len(), 2);
    assert_eq!(ccdstab.len(), 2);
    assert_eq!(trccd.len(), 2);
    assert_eq!(mvccd.len(), 2);

    assert!(ccdsig
        .iter()
        .flatten()
        .all(|value| value.is_nan() || (*value >= 0.0 && *value <= 1.0)));
    assert!(ccdstab
        .iter()
        .flatten()
        .all(|value| value.is_nan() || (*value >= 0.0 && *value <= 1.0)));

    let trccd_means = trccd.iter().map(|row| mean_finite(row)).collect::<Vec<_>>();
    assert!(
        trccd_means[1] > trccd_means[0],
        "TRCCD should retain the stronger Y<-Z than Y<-X ordering on the common-drive system (Y<-X={}, Y<-Z={})",
        trccd_means[0],
        trccd_means[1]
    );

    let mvccd_means = mvccd.iter().map(|row| mean_finite(row)).collect::<Vec<_>>();
    assert!(
        mvccd_means[1] > mvccd_means[0],
        "MVCCD should favor the true common driver Z over spurious X for Y (Y<-X={}, Y<-Z={})",
        mvccd_means[0],
        mvccd_means[1]
    );
}
