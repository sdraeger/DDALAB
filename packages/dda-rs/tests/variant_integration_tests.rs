use dda_rs::{
    AlgorithmSelection, DDARequest, DDARunner, PreprocessingOptions, ScaleParameters, TimeRange,
    WindowParameters,
};
use std::path::PathBuf;

/// Helper function to get test file paths
fn get_test_paths() -> (PathBuf, PathBuf) {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();

    let binary_path = project_root.join("bin/run_DDA_AsciiEdf");
    let test_data = project_root.join("data/patient1_S05__01_03 (1).edf");

    (binary_path, test_data)
}

/// Test ST (Single Timeseries) variant
#[tokio::test]
async fn test_st_variant() {
    let (binary_path, test_data) = get_test_paths();

    if !binary_path.exists() || !test_data.exists() {
        eprintln!(
            "Skipping test: Binary or test data not found ({:?}, {:?})",
            binary_path, test_data
        );
        return;
    }

    let runner = DDARunner::new(&binary_path).expect("Failed to create DDA runner");

    let request = DDARequest {
        file_path: test_data.to_string_lossy().to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 30.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["single_timeseries".to_string()],
            select_mask: Some("1 0 0 0 0 0".to_string()), // ST only
        },
        window_parameters: WindowParameters {
            window_length: 2048,
            window_step: 1024,
            ct_window_length: None,
            ct_window_step: None,
        },
        scale_parameters: ScaleParameters {
            scale_min: 1.0,
            scale_max: 10.0,
            scale_num: 10,
            delay_list: None,
        },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: None,
    };

    let result = runner
        .run(&request, Some(0), Some(6000), None)
        .await
        .expect("ST DDA failed");

    // Should have ST variant
    assert!(result.variant_results.is_some());
    let variants = result.variant_results.unwrap();
    assert!(variants.iter().any(|v| v.variant_id == "ST"));

    println!("✓ ST variant test passed");
}

/// Test CT (Cross-Timeseries) variant
#[tokio::test]
async fn test_ct_variant() {
    let (binary_path, test_data) = get_test_paths();

    if !binary_path.exists() || !test_data.exists() {
        eprintln!("Skipping test: Binary or test data not found");
        return;
    }

    let runner = DDARunner::new(&binary_path).expect("Failed to create DDA runner");

    let ct_pairs = vec![[0, 1], [0, 2], [1, 2]];

    let request = DDARequest {
        file_path: test_data.to_string_lossy().to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 30.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["cross_timeseries".to_string()],
            select_mask: Some("0 1 0 0 0 0".to_string()), // CT only
        },
        window_parameters: WindowParameters {
            window_length: 2048,
            window_step: 1024,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        scale_parameters: ScaleParameters {
            scale_min: 1.0,
            scale_max: 10.0,
            scale_num: 10,
            delay_list: None,
        },
        ct_channel_pairs: Some(ct_pairs.clone()),
        cd_channel_pairs: None,
        model_parameters: None,
    };

    let result = runner
        .run(&request, Some(0), Some(6000), None)
        .await
        .expect("CT DDA failed");

    // Should have CT variant
    assert!(result.variant_results.is_some());
    let variants = result.variant_results.unwrap();
    assert!(variants.iter().any(|v| v.variant_id == "CT"));

    println!("✓ CT variant test passed");
}

/// Test DE (Delay Embedding) variant
#[tokio::test]
async fn test_de_variant() {
    let (binary_path, test_data) = get_test_paths();

    if !binary_path.exists() || !test_data.exists() {
        eprintln!("Skipping test: Binary or test data not found");
        return;
    }

    let runner = DDARunner::new(&binary_path).expect("Failed to create DDA runner");

    let request = DDARequest {
        file_path: test_data.to_string_lossy().to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 30.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["dynamical_ergodicity".to_string()],
            select_mask: Some("0 0 0 0 1 0".to_string()), // DE only
        },
        window_parameters: WindowParameters {
            window_length: 2048,
            window_step: 1024,
            ct_window_length: Some(2), // Required for DE
            ct_window_step: Some(2),   // Required for DE
        },
        scale_parameters: ScaleParameters {
            scale_min: 1.0,
            scale_max: 10.0,
            scale_num: 10,
            delay_list: None,
        },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: None,
    };

    let result = runner
        .run(&request, Some(0), Some(6000), None)
        .await
        .expect("DE DDA failed");

    // Should have DE variant
    assert!(result.variant_results.is_some());
    let variants = result.variant_results.unwrap();
    assert!(variants.iter().any(|v| v.variant_id == "DE"));

    println!("✓ DE variant test passed");
}

/// Test SY (Synchronization) variant
#[tokio::test]
async fn test_sy_variant() {
    let (binary_path, test_data) = get_test_paths();

    if !binary_path.exists() || !test_data.exists() {
        eprintln!("Skipping test: Binary or test data not found");
        return;
    }

    let runner = DDARunner::new(&binary_path).expect("Failed to create DDA runner");

    let request = DDARequest {
        file_path: test_data.to_string_lossy().to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 30.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["synchronization".to_string()],
            select_mask: Some("0 0 0 0 0 1".to_string()), // SY only
        },
        window_parameters: WindowParameters {
            window_length: 2048,
            window_step: 1024,
            ct_window_length: None,
            ct_window_step: None,
        },
        scale_parameters: ScaleParameters {
            scale_min: 1.0,
            scale_max: 10.0,
            scale_num: 10,
            delay_list: None,
        },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: None,
    };

    let result = runner
        .run(&request, Some(0), Some(6000), None)
        .await
        .expect("SY DDA failed");

    // Should have SY variant
    assert!(result.variant_results.is_some());
    let variants = result.variant_results.unwrap();
    assert!(variants.iter().any(|v| v.variant_id == "SY"));

    println!("✓ SY variant test passed");
}

/// Test multiple variants together
#[tokio::test]
async fn test_multiple_variants() {
    let (binary_path, test_data) = get_test_paths();

    if !binary_path.exists() || !test_data.exists() {
        eprintln!("Skipping test: Binary or test data not found");
        return;
    }

    let runner = DDARunner::new(&binary_path).expect("Failed to create DDA runner");

    let ct_pairs = vec![[0, 1], [0, 2]];

    let request = DDARequest {
        file_path: test_data.to_string_lossy().to_string(),
        channels: Some(vec![0, 1, 2]),
        time_range: TimeRange {
            start: 0.0,
            end: 30.0,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec![
                "single_timeseries".to_string(),
                "cross_timeseries".to_string(),
            ],
            select_mask: Some("1 1 0 0 0 0".to_string()), // ST + CT
        },
        window_parameters: WindowParameters {
            window_length: 2048,
            window_step: 1024,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        scale_parameters: ScaleParameters {
            scale_min: 1.0,
            scale_max: 10.0,
            scale_num: 10,
            delay_list: None,
        },
        ct_channel_pairs: Some(ct_pairs),
        cd_channel_pairs: None,
        model_parameters: None,
    };

    let result = runner
        .run(&request, Some(0), Some(6000), None)
        .await
        .expect("Multiple variant DDA failed");

    // Should have both ST and CT variants
    assert!(result.variant_results.is_some());
    let variants = result.variant_results.unwrap();
    assert!(variants.iter().any(|v| v.variant_id == "ST"));
    assert!(variants.iter().any(|v| v.variant_id == "CT"));
    assert_eq!(variants.len(), 2);

    println!("✓ Multiple variants test passed");
}
