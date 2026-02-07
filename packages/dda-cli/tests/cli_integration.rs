use assert_cmd::Command;
use predicates::prelude::*;

fn ddalab() -> Command {
    Command::cargo_bin("ddalab").unwrap()
}

// =============================================================================
// GENERAL
// =============================================================================

#[test]
fn test_no_args_shows_help() {
    ddalab()
        .assert()
        .failure()
        .stderr(predicate::str::contains("Usage:"));
}

#[test]
fn test_version_flag() {
    ddalab()
        .arg("--version")
        .assert()
        .success()
        .stdout(predicate::str::contains("ddalab"));
}

#[test]
fn test_help_flag() {
    ddalab()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("DDA analysis"));
}

// =============================================================================
// VARIANTS SUBCOMMAND
// =============================================================================

#[test]
fn test_variants_subcommand() {
    ddalab()
        .arg("variants")
        .assert()
        .success()
        .stdout(predicate::str::contains("ST"))
        .stdout(predicate::str::contains("CT"))
        .stdout(predicate::str::contains("CD"))
        .stdout(predicate::str::contains("DE"))
        .stdout(predicate::str::contains("SY"));
}

#[test]
fn test_variants_table_excludes_reserved_row() {
    // The table rows should not contain RESERVED as a variant,
    // though the footer may mention it in the SELECT mask format.
    let output = ddalab()
        .arg("variants")
        .arg("--json")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    let arr = parsed.as_array().unwrap();
    let abbrevs: Vec<&str> = arr
        .iter()
        .map(|v| v.get("abbreviation").unwrap().as_str().unwrap())
        .collect();
    assert!(!abbrevs.contains(&"RESERVED"));
}

#[test]
fn test_variants_json() {
    let output = ddalab()
        .arg("variants")
        .arg("--json")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert!(parsed.is_array());
    let arr = parsed.as_array().unwrap();
    assert_eq!(arr.len(), 5); // 5 active variants (no RESERVED)
}

// =============================================================================
// INFO SUBCOMMAND
// =============================================================================

#[test]
fn test_info_subcommand() {
    ddalab()
        .arg("info")
        .assert()
        .success()
        .stdout(predicate::str::contains("ddalab CLI v"))
        .stdout(predicate::str::contains("Platform:"));
}

#[test]
fn test_info_json() {
    let output = ddalab()
        .arg("info")
        .arg("--json")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert!(parsed.is_object());
    assert!(parsed.get("cli_version").is_some());
    assert!(parsed.get("platform").is_some());
    assert!(parsed.get("arch").is_some());
    assert!(parsed.get("binary_found").is_some());
}

// =============================================================================
// VALIDATE SUBCOMMAND
// =============================================================================

#[test]
fn test_validate_nonexistent_file() {
    ddalab()
        .arg("validate")
        .arg("--file")
        .arg("/nonexistent/file.edf")
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("not found"));
}

#[test]
fn test_validate_unsupported_extension() {
    let tmp = tempfile::Builder::new()
        .suffix(".xyz")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("validate")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Unsupported"));
}

#[test]
fn test_validate_valid_edf_file() {
    let tmp = tempfile::Builder::new()
        .suffix(".edf")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("validate")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .assert()
        .success()
        .stdout(predicate::str::contains("valid"));
}

#[test]
fn test_validate_valid_ascii_file() {
    let tmp = tempfile::Builder::new()
        .suffix(".txt")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("validate")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .assert()
        .success();
}

#[test]
fn test_validate_json_output() {
    let tmp = tempfile::Builder::new()
        .suffix(".edf")
        .tempfile()
        .unwrap();

    let output = ddalab()
        .arg("validate")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .arg("--json")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(parsed.get("exists").unwrap(), true);
    assert_eq!(parsed.get("supported").unwrap(), true);
}

// =============================================================================
// RUN SUBCOMMAND — ARGUMENT VALIDATION
// =============================================================================

#[test]
fn test_run_missing_file_arg() {
    ddalab()
        .arg("run")
        .arg("--channels")
        .arg("0")
        .assert()
        .failure()
        .stderr(predicate::str::contains("--file"));
}

#[test]
fn test_run_missing_channels_arg() {
    let tmp = tempfile::Builder::new()
        .suffix(".edf")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .assert()
        .failure()
        .stderr(predicate::str::contains("channel"));
}

#[test]
fn test_run_nonexistent_file() {
    ddalab()
        .arg("run")
        .arg("--file")
        .arg("/nonexistent/file.edf")
        .arg("--channels")
        .arg("0")
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("not found"));
}

#[test]
fn test_run_invalid_variant() {
    let tmp = tempfile::Builder::new()
        .suffix(".edf")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("--variants")
        .arg("INVALID")
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Unknown variant"));
}

#[test]
fn test_run_ct_without_pairs() {
    let tmp = tempfile::Builder::new()
        .suffix(".edf")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("--variants")
        .arg("CT")
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("--ct-pairs"));
}

#[test]
fn test_run_cd_without_pairs() {
    let tmp = tempfile::Builder::new()
        .suffix(".edf")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("--variants")
        .arg("CD")
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("--cd-pairs"));
}

#[test]
fn test_run_unsupported_file_extension() {
    let tmp = tempfile::Builder::new()
        .suffix(".xyz")
        .tempfile()
        .unwrap();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Unsupported"));
}
