use dda_rs::{
    block_permute_series, calibrate_against_null, circular_shift_offsets, circular_shift_series,
    compute_ccd_statistic, empirical_p_value, log_mse_ratio_from_rmse, partial_r2_from_rmse,
    search_aware_empirical_p_value, search_aware_null_maxima, CcdStatConfig, CcdStatistic,
};

fn rows(values: &[[f64; 2]]) -> Vec<Vec<f64>> {
    values.iter().map(|row| row.to_vec()).collect()
}

#[test]
fn nested_ols_sse_is_nonnegative() {
    let y = vec![1.0, 2.0, 3.0, 4.0, 5.0];
    let x0 = rows(&[[1.0, 0.0], [1.0, 1.0], [1.0, 2.0], [1.0, 3.0], [1.0, 4.0]]);
    let xj = vec![vec![0.0], vec![1.0], vec![4.0], vec![9.0], vec![16.0]];
    let config = CcdStatConfig {
        statistic: CcdStatistic::DeltaSse,
        ..Default::default()
    };
    let result = compute_ccd_statistic(&y, &x0, &xj, &config).expect("CCD statistic");
    assert!(result.value >= -1e-10, "{result:?}");
    assert!(result.diagnostics.sse1 <= result.diagnostics.sse0 + 1e-10);
}

#[test]
fn zero_new_span_has_near_zero_increment() {
    let y = vec![1.0, 2.3, 2.7, 4.4, 4.8];
    let x0 = rows(&[[1.0, 0.0], [1.0, 1.0], [1.0, 2.0], [1.0, 3.0], [1.0, 4.0]]);
    let xj = vec![vec![0.0], vec![1.0], vec![2.0], vec![3.0], vec![4.0]];
    let config = CcdStatConfig {
        statistic: CcdStatistic::PartialR2,
        ..Default::default()
    };
    let result = compute_ccd_statistic(&y, &x0, &xj, &config).expect("CCD statistic");
    assert!(result.value.abs() < 1e-8, "{result:?}");
}

#[test]
fn orthogonal_source_component_is_detected() {
    let y = vec![1.0, 3.0, 5.0, 7.0, 11.0, 13.0];
    let x0 = rows(&[
        [1.0, -2.0],
        [1.0, -1.0],
        [1.0, 0.0],
        [1.0, 1.0],
        [1.0, 2.0],
        [1.0, 3.0],
    ]);
    let xj = vec![
        vec![1.0],
        vec![-1.0],
        vec![1.0],
        vec![-1.0],
        vec![1.0],
        vec![-1.0],
    ];
    let config = CcdStatConfig {
        statistic: CcdStatistic::ResidualizedPartialR2,
        ..Default::default()
    };
    let result = compute_ccd_statistic(&y, &x0, &xj, &config).expect("CCD statistic");
    assert!(result.value > 0.05, "{result:?}");
}

#[test]
fn normalized_rmse_helpers_match_nested_mse_formulas() {
    let baseline = 4.0_f64;
    let full = 2.0_f64;
    let partial = partial_r2_from_rmse(baseline, full);
    let log_ratio = log_mse_ratio_from_rmse(baseline, full, 0.0);
    assert!((partial - 0.75).abs() < 1e-12);
    assert!((log_ratio - 4.0_f64.ln()).abs() < 1e-12);
}

#[test]
fn row_set_change_is_rejected() {
    let y = vec![1.0, 2.0, 3.0, 4.0];
    let x0 = rows(&[[1.0, 0.0], [1.0, 1.0], [1.0, 2.0], [1.0, 3.0]]);
    let xj = vec![vec![0.0], vec![1.0], vec![f64::NAN], vec![3.0]];
    let err = compute_ccd_statistic(&y, &x0, &xj, &CcdStatConfig::default()).unwrap_err();
    assert!(
        err.to_string().contains("different valid row sets"),
        "{err}"
    );
}

#[test]
fn degenerate_source_channel_is_rejected() {
    let y = vec![1.0, 2.0, 3.0, 4.0];
    let x0 = rows(&[[1.0, 0.0], [1.0, 1.0], [1.0, 2.0], [1.0, 3.0]]);
    let xj = vec![vec![2.0], vec![2.0], vec![2.0], vec![2.0]];
    let err = compute_ccd_statistic(&y, &x0, &xj, &CcdStatConfig::default()).unwrap_err();
    assert!(err.to_string().contains("degenerate column"), "{err}");
}

#[test]
fn empirical_p_value_uses_plus_one_formula() {
    let p = empirical_p_value(3.0, &[0.0, 1.0, 3.0, 4.0]);
    assert!((p - 0.6).abs() < 1e-12);
}

#[test]
fn circular_shift_null_is_seeded_and_obeys_min_shift() {
    let a = circular_shift_offsets(100, 8, 10, 123).expect("offsets");
    let b = circular_shift_offsets(100, 8, 10, 123).expect("offsets");
    assert_eq!(a, b);
    assert!(a.iter().all(|shift| *shift >= 10 && *shift < 100));
    let shifted = circular_shift_series(&[1.0, 2.0, 3.0, 4.0], 1);
    assert_eq!(shifted, vec![4.0, 1.0, 2.0, 3.0]);
}

#[test]
fn block_permutation_is_seeded() {
    let series = (0..12).map(|v| v as f64).collect::<Vec<_>>();
    let a = block_permute_series(&series, 3, 456).expect("permute");
    let b = block_permute_series(&series, 3, 456).expect("permute");
    assert_eq!(a, b);
    assert_eq!(a.len(), series.len());
}

#[test]
fn null_calibration_reports_mad_z_score() {
    let calibration = calibrate_against_null(5.0, &[1.0, 2.0, 3.0, 4.0], 1e-12);
    assert_eq!(calibration.empirical_p, 0.2);
    assert!(calibration.z_mad.is_finite());
    assert_eq!(calibration.null_percentile_rank, 1.0);
}

#[test]
fn search_aware_null_uses_maximum_over_full_selection() {
    let null_replicates = vec![
        vec![0.1, 0.9, 0.2],
        vec![0.8, 0.1, 0.1],
        vec![0.2, 0.3, 0.7],
    ];
    assert_eq!(
        search_aware_null_maxima(&null_replicates),
        vec![0.9, 0.8, 0.7]
    );
    let p = search_aware_empirical_p_value(0.75, &null_replicates);
    assert!((p - 0.75).abs() < 1e-12);
}
