use dda_rs::{
    AlgorithmSelection, DDARequest, DDARunner, PreprocessingOptions, ScaleParameters, TimeRange,
    WindowParameters,
};
use std::path::PathBuf;
use std::process::Command;

#[tokio::test]
async fn test_cd_dda_matches_binary_output() {
    // Test parameters
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();

    let binary_path = project_root.join("bin/run_DDA_AsciiEdf");
    let test_data = project_root.join("data/patient1_S05__01_03 (1).edf");

    // Skip test if files don't exist
    if !binary_path.exists() {
        eprintln!("Skipping test: Binary not found at {:?}", binary_path);
        return;
    }
    if !test_data.exists() {
        eprintln!("Skipping test: Test data not found at {:?}", test_data);
        return;
    }

    // CD-DDA parameters: channels 0→1, 0→2, 1→2 (0-based, will be 1→2, 1→3, 2→3 in 1-based)
    let cd_pairs = vec![[0, 1], [0, 2], [1, 2]];
    let window_length = 2048u32;
    let window_step = 1024u32;
    let scale_min = 1.0;
    let scale_max = 10.0;
    let start_time = 0.0;
    let end_time = 30.0;
    let sample_rate = 200.0; // Assume 200 Hz sample rate

    // Create temp directory for outputs
    let temp_dir = std::env::temp_dir();
    let test_id = uuid::Uuid::new_v4().to_string();

    // --- Part 1: Direct binary call ---
    let direct_output = temp_dir.join(format!("cd_test_direct_{}.txt", test_id));

    let mut cmd = Command::new("sh");
    cmd.arg(&binary_path);
    cmd.arg("-EDF")
        .arg("-DATA_FN")
        .arg(&test_data)
        .arg("-OUT_FN")
        .arg(&direct_output)
        .arg("-CH_list")
        .arg("1")
        .arg("2") // 1→2
        .arg("1")
        .arg("3") // 1→3
        .arg("2")
        .arg("3") // 2→3
        .arg("-SELECT")
        .arg("0")
        .arg("0")
        .arg("1")
        .arg("0")
        .arg("0")
        .arg("0") // ST CT CD RESERVED DE SY
        .arg("-MODEL")
        .arg("1")
        .arg("2")
        .arg("10")
        .arg("-TAU");

    // Add delay values from scale range
    for delay in (scale_min as i32)..=(scale_max as i32) {
        cmd.arg(delay.to_string());
    }

    cmd.arg("-dm")
        .arg("4")
        .arg("-order")
        .arg("4")
        .arg("-nr_tau")
        .arg("2")
        .arg("-WL")
        .arg(window_length.to_string())
        .arg("-WS")
        .arg(window_step.to_string())
        .arg("-WL_CT")
        .arg("2")
        .arg("-WS_CT")
        .arg("2")
        .arg("-StartEnd")
        .arg((start_time * sample_rate).to_string())
        .arg((end_time * sample_rate).to_string());

    println!("Executing direct binary command: {:?}", cmd);

    let output = cmd.output().expect("Failed to execute binary");

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        panic!(
            "Binary execution failed:\nstdout: {}\nstderr: {}",
            stdout, stderr
        );
    }

    println!("Direct binary call succeeded");

    // Read the CD output file (should be output_CD_DDA_ST)
    let cd_direct_file = temp_dir.join(format!("cd_test_direct_{}.txt_CD_DDA_ST", test_id));

    if !cd_direct_file.exists() {
        eprintln!("Expected CD output file not found at: {:?}", cd_direct_file);
        eprintln!("Listing temp directory contents:");
        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().contains(&test_id) {
                    eprintln!("  - {:?}", entry.path());
                }
            }
        }
        panic!("CD output file not created by binary");
    }

    let direct_content = tokio::fs::read_to_string(&cd_direct_file)
        .await
        .expect("Failed to read direct binary output");

    println!("Direct output file size: {} bytes", direct_content.len());

    // --- Part 2: dda-rs API call ---
    let runner = DDARunner::new(&binary_path).expect("Failed to create DDA runner");

    let request = DDARequest {
        file_path: test_data.to_string_lossy().to_string(),
        channels: Some(vec![0, 1, 2]), // Include all referenced channels
        time_range: TimeRange {
            start: start_time,
            end: end_time,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["cross_dynamical".to_string()],
            select_mask: Some("0 0 1 0 0 0".to_string()), // ST CT CD RESERVED DE SY
        },
        window_parameters: WindowParameters {
            window_length,
            window_step,
            ct_window_length: Some(2),
            ct_window_step: Some(2),
        },
        scale_parameters: ScaleParameters {
            scale_min,
            scale_max,
            scale_num: ((scale_max - scale_min) as u32) + 1,
            delay_list: None,
        },
        ct_channel_pairs: None,
        cd_channel_pairs: Some(cd_pairs.clone()),
        model_parameters: None,
    };

    // Calculate sample bounds
    let start_sample = (start_time * sample_rate) as u64;
    let end_sample = (end_time * sample_rate) as u64;

    println!("Running dda-rs API call...");

    // List temp directory before API call
    println!("\nTemp directory before API call:");
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains("dda_output")
            {
                println!("  {:?}", path);
            }
        }
    }

    let api_result = runner
        .run(&request, Some(start_sample), Some(end_sample), None)
        .await
        .expect("dda-rs API call failed");

    // List temp directory after API call
    println!("\nTemp directory after API call:");
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .contains("dda_output")
            {
                println!("  {:?}", path);
            }
        }
    }

    println!("\ndda-rs API call succeeded");
    println!(
        "Variant results: {:?}",
        api_result.variant_results.as_ref().map(|v| v.len())
    );

    // --- Part 3: Compare outputs ---

    // Parse direct binary output
    let direct_lines: Vec<&str> = direct_content
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.trim().starts_with('#'))
        .collect();

    println!("Direct output has {} data lines", direct_lines.len());

    if direct_lines.is_empty() {
        panic!("Direct binary output has no data lines");
    }

    // Debug: print all variants
    if let Some(variants) = api_result.variant_results.as_ref() {
        println!("API returned {} variants:", variants.len());
        for variant in variants {
            println!(
                "  - {} ({}): {} channels × {} timepoints",
                variant.variant_id,
                variant.variant_name,
                variant.q_matrix.len(),
                variant.q_matrix.get(0).map(|r| r.len()).unwrap_or(0)
            );
        }
    }

    // Get CD variant from API result
    let cd_variant = api_result
        .variant_results
        .as_ref()
        .and_then(|variants| variants.iter().find(|v| v.variant_id == "CD"))
        .expect("No CD variant in API result");

    let api_q_matrix = &cd_variant.q_matrix;

    println!(
        "API Q matrix dimensions: {} channels × {} timepoints",
        api_q_matrix.len(),
        api_q_matrix[0].len()
    );

    // Parse direct output: skip first 2 columns (window bounds), take every 2nd column
    let mut direct_matrix: Vec<Vec<f64>> = Vec::new();
    for line in direct_lines {
        let values: Vec<f64> = line
            .split_whitespace()
            .filter_map(|s| s.parse::<f64>().ok())
            .collect();

        if values.len() > 2 {
            direct_matrix.push(values);
        }
    }

    // Apply same processing as parser: skip first 2, then take every 2nd column (stride=2 for CD)
    // Each directed pair produces 2 columns, we take the first of each pair
    let mut processed_direct: Vec<Vec<f64>> = Vec::new();
    for row in &direct_matrix {
        let after_skip: Vec<f64> = row.iter().skip(2).copied().collect();
        // For CD, each directed pair produces 2 columns, take every 2nd column (indices 0, 2, 4...)
        let mut extracted = Vec::new();
        for (idx, &val) in after_skip.iter().enumerate() {
            if idx % 2 == 0 {
                extracted.push(val);
            }
        }
        processed_direct.push(extracted);
    }

    // Transpose to [channels × timepoints]
    if processed_direct.is_empty() || processed_direct[0].is_empty() {
        panic!("Direct output processing resulted in empty matrix");
    }

    let _num_timepoints = processed_direct.len();
    let num_channels = processed_direct[0].len();

    let mut transposed_direct: Vec<Vec<f64>> = vec![Vec::new(); num_channels];
    for row in &processed_direct {
        for (col_idx, &value) in row.iter().enumerate() {
            transposed_direct[col_idx].push(value);
        }
    }

    println!(
        "Direct Q matrix dimensions: {} channels × {} timepoints",
        transposed_direct.len(),
        transposed_direct[0].len()
    );

    // Compare matrices
    assert_eq!(
        api_q_matrix.len(),
        transposed_direct.len(),
        "Number of channels mismatch"
    );

    assert_eq!(
        api_q_matrix[0].len(),
        transposed_direct[0].len(),
        "Number of timepoints mismatch"
    );

    // Compare values with tolerance for floating point differences
    let tolerance = 1e-6;
    let mut max_diff = 0.0f64;
    let mut mismatch_count = 0;

    for (ch_idx, (api_channel, direct_channel)) in api_q_matrix
        .iter()
        .zip(transposed_direct.iter())
        .enumerate()
    {
        for (t_idx, (&api_val, &direct_val)) in
            api_channel.iter().zip(direct_channel.iter()).enumerate()
        {
            let diff = (api_val - direct_val).abs();
            max_diff = max_diff.max(diff);

            if diff > tolerance {
                mismatch_count += 1;
                if mismatch_count <= 5 {
                    // Print first 5 mismatches
                    println!(
                        "Mismatch at ch={}, t={}: API={}, Direct={}, diff={}",
                        ch_idx, t_idx, api_val, direct_val, diff
                    );
                }
            }
        }
    }

    println!("Comparison complete:");
    println!("  Max difference: {}", max_diff);
    println!("  Mismatches: {}", mismatch_count);

    // Cleanup
    let _ = tokio::fs::remove_file(&cd_direct_file).await;
    let _ = tokio::fs::remove_file(&direct_output).await;

    // Assert matrices match
    assert!(
        max_diff < tolerance,
        "Matrices differ by more than tolerance. Max diff: {}",
        max_diff
    );

    assert_eq!(
        mismatch_count, 0,
        "Found {} mismatches between API and direct binary output",
        mismatch_count
    );

    println!("✓ CD-DDA test passed: API output matches direct binary output");
}
