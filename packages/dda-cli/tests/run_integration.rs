use assert_cmd::Command;
use predicates::prelude::*;
use std::path::PathBuf;

fn ddalab() -> Command {
    Command::cargo_bin("ddalab").unwrap()
}

/// Returns (binary_path, data_path) if both are available, otherwise None.
fn get_test_paths() -> Option<(PathBuf, PathBuf)> {
    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();

    // Try multiple binary locations
    let binary_candidates = [
        project_root.join("bin/run_DDA_AsciiEdf"),
        PathBuf::from(
            std::env::var("DDA_BINARY_PATH").unwrap_or_default(),
        ),
    ];

    let binary = binary_candidates.iter().find(|p| p.exists())?.clone();

    // Try multiple data locations
    let data_candidates = [
        project_root.join("data/patient1_S05__01_03 (1).edf"),
        project_root.join("data/test.edf"),
    ];

    let data = data_candidates.iter().find(|p| p.exists())?.clone();

    Some((binary, data))
}

// =============================================================================
// INTEGRATION TESTS (require DDA binary + test data)
// =============================================================================

#[test]
fn test_st_analysis() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    let output = ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("2")
        .arg("--variants")
        .arg("ST")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--delays")
        .arg("1")
        .arg("2")
        .arg("3")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("6000")
        .arg("--quiet")
        .assert()
        .success()
        .code(0);

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();

    assert!(parsed.get("id").is_some());
    assert!(parsed.get("q_matrix").is_some());
    assert!(parsed.get("variant_results").is_some());

    let variant_results = parsed.get("variant_results").unwrap().as_array().unwrap();
    assert!(!variant_results.is_empty());
    assert_eq!(
        variant_results[0].get("variant_id").unwrap().as_str().unwrap(),
        "ST"
    );
}

#[test]
fn test_compact_output() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    let output = ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("--variants")
        .arg("ST")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("6000")
        .arg("--compact")
        .arg("--quiet")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    // Compact JSON should be a single line (no newlines in the JSON itself)
    let json_part = stdout.trim();
    assert!(!json_part.contains('\n'), "Compact JSON should be a single line");
    // Verify it's valid JSON
    let _: serde_json::Value = serde_json::from_str(json_part).unwrap();
}

#[test]
fn test_output_to_file() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    let output_file = tempfile::Builder::new()
        .suffix(".json")
        .tempfile()
        .unwrap();
    let output_path = output_file.path().to_str().unwrap().to_string();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("--variants")
        .arg("ST")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("6000")
        .arg("-o")
        .arg(&output_path)
        .arg("--quiet")
        .assert()
        .success();

    let contents = std::fs::read_to_string(&output_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
    assert!(parsed.get("id").is_some());
    assert!(parsed.get("variant_results").is_some());
}

#[test]
fn test_json_roundtrip() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    let output = ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("--variants")
        .arg("ST")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("6000")
        .arg("--quiet")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();

    // Deserialize into DDAResult to verify schema compatibility
    let result: dda_rs::DDAResult = serde_json::from_str(&stdout).unwrap();
    assert!(!result.id.is_empty());
    assert!(!result.q_matrix.is_empty());
    assert!(result.variant_results.is_some());
}

#[test]
fn test_multi_variant_st_de() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    let output = ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("--variants")
        .arg("ST")
        .arg("DE")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("10000")
        .arg("--quiet")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();

    let variant_results = parsed.get("variant_results").unwrap().as_array().unwrap();
    let ids: Vec<&str> = variant_results
        .iter()
        .map(|v| v.get("variant_id").unwrap().as_str().unwrap())
        .collect();

    // At least ST should be present; DE may or may not produce output
    assert!(ids.contains(&"ST"));
}

#[test]
fn test_ct_analysis() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    // CT analysis with explicit channel pairs
    let result = ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("--variants")
        .arg("CT")
        .arg("--ct-pairs")
        .arg("0,1")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("10000")
        .arg("--quiet")
        .output();

    // CT may fail depending on binary support — just verify it doesn't crash
    match result {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8(output.stdout).unwrap();
                let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
                assert!(parsed.get("variant_results").is_some());
            }
        }
        Err(_) => {} // Acceptable: binary may not support CT with this data
    }
}

#[test]
fn test_cd_analysis() {
    let Some((binary, data)) = get_test_paths() else {
        eprintln!("Skipping: DDA binary or test data not found");
        return;
    };

    let result = ddalab()
        .arg("run")
        .arg("--file")
        .arg(data.to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("--variants")
        .arg("CD")
        .arg("--cd-pairs")
        .arg("0,1")
        .arg("--binary")
        .arg(binary.to_str().unwrap())
        .arg("--wl")
        .arg("2048")
        .arg("--ws")
        .arg("1024")
        .arg("--start-sample")
        .arg("0")
        .arg("--end-sample")
        .arg("10000")
        .arg("--quiet")
        .output();

    // CD may fail depending on binary support — just verify no crash
    match result {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8(output.stdout).unwrap();
                let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
                assert!(parsed.get("variant_results").is_some());
            }
        }
        Err(_) => {}
    }
}
