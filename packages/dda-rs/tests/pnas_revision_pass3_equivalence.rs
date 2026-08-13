use std::collections::HashMap;

use dda_rs::{
    run_request_on_matrix, AlgorithmSelection, CcdConditioningStrategy, DDARequest,
    DelayParameters, ModelParameters, PreprocessingOptions, TimeRange, VariantChannelConfig,
    WindowParameters,
};

fn synthetic_common_driver(n: usize) -> Vec<Vec<f64>> {
    let mut z = 0.2_f64;
    let mut x = -0.1_f64;
    let mut y = 0.3_f64;
    let mut rows = Vec::with_capacity(n);
    for t in 0..n {
        let tt = t as f64;
        z = 0.84 * z + 0.17 * (0.031 * tt).sin();
        x = 0.72 * x + 0.23 * z + 0.03 * (0.071 * tt).cos();
        y = 0.70 * y + 0.22 * z + 0.02 * (0.053 * tt).sin();
        rows.push(vec![x, y, z]);
    }
    rows
}

fn request(samples_len: usize, enabled_variants: Vec<String>) -> DDARequest {
    let channels = vec![0, 1, 2];
    let pairs = vec![[1, 0], [1, 2], [0, 1], [0, 2]];
    let mut variant_configs = HashMap::new();
    variant_configs.insert(
        "conditional_cross_dynamical".to_string(),
        VariantChannelConfig {
            selected_channels: Some(channels.clone()),
            ct_channel_pairs: None,
            cd_channel_pairs: Some(pairs.clone()),
            conditioning_channels: None,
            conditioning_strategy: Some(CcdConditioningStrategy::AllSelected),
            surrogate_shifts: Some(vec![7]),
            temporal_lambda: None,
            max_active_sources: None,
        },
    );
    DDARequest {
        file_path: "<matrix>".to_string(),
        channels: Some(channels),
        time_range: TimeRange {
            start: 0.0,
            end: samples_len.saturating_sub(1) as f64,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants,
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

fn variant_matrix(result: &dda_rs::DDAResult, variant_id: &str) -> Vec<Vec<f64>> {
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
fn optimized_all_selected_ccdlog_matches_legacy_pairwise_path() {
    let samples = synthetic_common_driver(900);
    let labels = vec!["X".to_string(), "Y".to_string(), "Z".to_string()];
    std::env::set_var("DDA_RS_OPTIMIZE_ALLSELECTED_CCD", "1");
    let optimized = run_request_on_matrix(
        &request(
            samples.len(),
            vec!["CCDLOG".to_string(), "CCDPR2".to_string()],
        ),
        &samples,
        Some(&labels),
    )
    .expect("optimized CCDLOG run");
    std::env::remove_var("DDA_RS_OPTIMIZE_ALLSELECTED_CCD");
    let legacy = run_request_on_matrix(
        &request(
            samples.len(),
            vec![
                "CCDLOG".to_string(),
                "CCDPR2".to_string(),
                "CCDSIG".to_string(),
            ],
        ),
        &samples,
        Some(&labels),
    )
    .expect("legacy CCDLOG run");

    for variant_id in ["CCDLOG", "CCDPR2"] {
        let optimized_matrix = variant_matrix(&optimized, variant_id);
        let legacy_matrix = variant_matrix(&legacy, variant_id);
        assert_eq!(optimized_matrix.len(), legacy_matrix.len());
        for (row_idx, (left, right)) in optimized_matrix
            .iter()
            .zip(legacy_matrix.iter())
            .enumerate()
        {
            assert_eq!(left.len(), right.len());
            for (col_idx, (a, b)) in left.iter().zip(right.iter()).enumerate() {
                let diff = (a - b).abs();
                assert!(
                    diff <= 1e-10 || (!a.is_finite() && !b.is_finite()),
                    "{variant_id} differs at row {row_idx}, col {col_idx}: optimized={a}, legacy={b}, diff={diff}"
                );
            }
        }
    }
}
