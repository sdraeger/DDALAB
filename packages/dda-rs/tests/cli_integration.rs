mod support;

use assert_cmd::Command;
use dda_rs::io::{open_recording, FileSet};
use predicates::prelude::*;
use std::io::Write;
use std::path::{Path, PathBuf};
use support::{edf_bytes, EdfSpec};

fn ddalab() -> Command {
    assert_cmd::cargo::cargo_bin_cmd!("ddalab")
}

fn write_ascii_fixture() -> tempfile::NamedTempFile {
    let mut file = tempfile::Builder::new()
        .suffix(".ascii")
        .tempfile()
        .unwrap();
    for t in 0..256 {
        let x = (t as f64 * 0.05).sin();
        let y = 0.6 * x + (t as f64 * 0.07).cos() * 0.1;
        writeln!(file, "{x:.12} {y:.12}").unwrap();
    }
    file
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
    let output = ddalab().arg("variants").arg("--json").assert().success();

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
    let output = ddalab().arg("variants").arg("--json").assert().success();

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
    let output = ddalab().arg("info").arg("--json").assert().success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert!(parsed.is_object());
    assert!(parsed.get("cli_version").is_some());
    assert!(parsed.get("platform").is_some());
    assert!(parsed.get("arch").is_some());
    assert_eq!(
        parsed
            .get("native_binary_enabled")
            .and_then(|value| value.as_bool()),
        Some(false)
    );
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
    let tmp = tempfile::Builder::new().suffix(".xyz").tempfile().unwrap();

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
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

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
    let tmp = tempfile::Builder::new().suffix(".txt").tempfile().unwrap();

    ddalab()
        .arg("validate")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .assert()
        .success();
}

#[test]
fn test_validate_json_output() {
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

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
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

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
fn test_run_ascii_uses_pure_rust_backend() {
    let ascii = write_ascii_fixture();

    let output = ddalab()
        .env_remove("DDA_BINARY_PATH")
        .arg("run")
        .arg("--file")
        .arg(ascii.path().to_str().unwrap())
        .arg("--channels")
        .arg("0")
        .arg("1")
        .arg("--variants")
        .arg("ST")
        .arg("--wl")
        .arg("64")
        .arg("--ws")
        .arg("32")
        .arg("--delays")
        .arg("1")
        .arg("2")
        .assert()
        .success();

    let stderr = String::from_utf8(output.get_output().stderr.clone()).unwrap();
    assert!(stderr.contains("Backend: pure-rust"));

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert!(parsed.get("variant_results").is_some());
}

#[test]
fn test_run_invalid_variant() {
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

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
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

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
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

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
    let tmp = tempfile::Builder::new().suffix(".xyz").tempfile().unwrap();

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

// =============================================================================
// INSPECT AND SAMPLES SUBCOMMANDS
// =============================================================================

/// An EDF+ named like a BIDS recording with a 128 Hz channel between two 256 Hz ones, an annotation
/// and a `channels.tsv` marking `Fp2` bad. The analysis channels are the file's channels 0 and 2.
fn write_bids_edf(dir: &Path) -> PathBuf {
    let edf = edf_bytes(&EdfSpec {
        labels: vec!["Fp1".into(), "Slow".into(), "Fp2".into()],
        units: vec!["uV".into(); 3],
        rates_per_record: vec![256, 128, 256],
        annotations: vec![(0.5, 0.0, "note".into())],
        ..EdfSpec::default()
    });
    let path = dir.join("sub-01_task-x_eeg.edf");
    std::fs::write(&path, edf).unwrap();
    std::fs::write(
        dir.join("sub-01_task-x_channels.tsv"),
        "name\tstatus\nFp2\tbad\n",
    )
    .unwrap();
    path
}

#[test]
fn inspect_json_lists_channels() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_bids_edf(dir.path());
    let output = ddalab()
        .args(["inspect", "--json", "--file"])
        .arg(&path)
        .assert()
        .success();
    let parsed: serde_json::Value = serde_json::from_slice(&output.get_output().stdout).unwrap();
    let labels: Vec<&str> = parsed["channels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["Fp1", "Slow", "Fp2", "EDF Annotations"]);
    assert_eq!(parsed["analysis_channels"], serde_json::json!([0, 2]));
    assert_eq!(parsed["channels"][2]["bids_status"], "bad");
    assert_eq!(parsed["sample_rate_hz"], 256.0);
    // The annotation list is the scanned one; opening alone leaves EDF+ annotations unread.
    assert_eq!(parsed["annotations"][0]["label"], "note");
}

#[test]
fn inspect_prints_a_channel_table() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_bids_edf(dir.path());
    ddalab()
        .args(["inspect", "--file"])
        .arg(&path)
        .assert()
        .success()
        .stdout(predicate::str::contains("EDF+"))
        .stdout(predicate::str::contains("Slow"))
        .stdout(predicate::str::contains("bad"))
        .stdout(predicate::str::contains("annotations: 1"));
}

#[test]
fn inspect_missing_file_fails() {
    ddalab()
        .args(["inspect", "--file", "/nonexistent/sub-01_eeg.edf"])
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Error"));
}

#[test]
fn samples_npy_header_and_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_bids_edf(dir.path());
    let out = dir.path().join("x.npy");
    ddalab()
        .args(["samples", "--channels", "0", "1"])
        .args(["--start-sample", "3", "--count", "5", "--file"])
        .arg(&path)
        .arg("--output")
        .arg(&out)
        .assert()
        .success();

    let bytes = std::fs::read(&out).unwrap();
    assert_eq!(&bytes[..8], b"\x93NUMPY\x01\x00");
    let header_len = u16::from_le_bytes([bytes[8], bytes[9]]) as usize;
    assert_eq!((10 + header_len) % 64, 0);
    let header = std::str::from_utf8(&bytes[10..10 + header_len]).unwrap();
    let dict = "{'descr': '<f8', 'fortran_order': False, 'shape': (5, 2), }";
    assert!(header.starts_with(dict), "{header:?}");
    assert!(header[dict.len()..header.len() - 1]
        .bytes()
        .all(|b| b == b' '));
    assert!(header.ends_with('\n'));

    // Analysis channels 0 and 1 are the file's channels 0 and 2.
    let reader = open_recording(&FileSet::from_path(&path).unwrap(), None).unwrap();
    let want = reader.read_rows(&[0, 2], 3, 5).unwrap();
    let data = &bytes[10 + header_len..];
    assert_eq!(data.len(), 5 * 2 * 8);
    let got: Vec<f64> = data
        .chunks_exact(8)
        .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
        .collect();
    assert_eq!(got, want.concat());
}

#[test]
fn samples_refuses_bad_channels_and_ranges() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_bids_edf(dir.path());
    let out = dir.path().join("x.npy");
    // Two analysis channels (0 and 1); 1024 samples.
    for (channel, start, message) in [
        ("2", "0", "channel 2"),
        ("0", "1020", "exceeds"),
        ("0", "18446744073709551615", "exceeds"),
    ] {
        ddalab()
            .args(["samples", "--channels", channel, "--count", "5"])
            .args(["--start-sample", start, "--file"])
            .arg(&path)
            .arg("--output")
            .arg(&out)
            .assert()
            .failure()
            .code(1)
            .stderr(predicate::str::contains(message));
    }
    assert!(!out.exists());
}
