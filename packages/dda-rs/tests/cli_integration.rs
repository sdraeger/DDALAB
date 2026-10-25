mod support;

use assert_cmd::Command;
use dda_rs::document::{bundle_layout, npy_header};
use dda_rs::io::{open_recording, FileSet};
use dda_rs::{
    AlgorithmSelection, DDARequest, DelayParameters, ModelParameters, PreprocessingOptions,
    TimeRange, WindowParameters,
};
use predicates::prelude::*;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use support::{brainvision_files, edf_bytes, BrainVisionSpec, EdfSpec};

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
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());

    ddalab()
        .arg("validate")
        .arg("--file")
        .arg(&path)
        .assert()
        .success()
        .stdout(predicate::str::contains("valid (EDF,"));
}

#[test]
fn test_validate_valid_ascii_file() {
    let ascii = write_ascii_fixture();

    ddalab()
        .arg("validate")
        .arg("--file")
        .arg(ascii.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("valid (ASCII,"));
}

#[test]
fn test_validate_json_output() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());

    let output = ddalab()
        .arg("validate")
        .arg("--file")
        .arg(&path)
        .arg("--json")
        .assert()
        .success();

    let stdout = String::from_utf8(output.get_output().stdout.clone()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&stdout).unwrap();
    assert_eq!(parsed.get("exists").unwrap(), true);
    assert_eq!(parsed.get("readable").unwrap(), true);
    assert_eq!(parsed.get("supported").unwrap(), true);
    assert_eq!(parsed.get("file_type").unwrap(), "EDF");
    assert_eq!(
        parsed.get("size_bytes").unwrap().as_u64(),
        Some(std::fs::metadata(&path).unwrap().len())
    );
    assert!(parsed.get("error").unwrap().is_null());
}

#[test]
fn test_validate_opens_every_format_run_reads() {
    let dir = tempfile::tempdir().unwrap();
    let bdf = dir.path().join("rec.bdf");
    std::fs::write(
        &bdf,
        edf_bytes(&EdfSpec {
            bdf: true,
            ..EdfSpec::default()
        }),
    )
    .unwrap();
    for (name, bytes) in brainvision_files(&BrainVisionSpec::default()) {
        std::fs::write(dir.path().join(name), bytes).unwrap();
    }
    for (path, format) in [
        (bdf, "BDF"),
        (dir.path().join("sub-01_ieeg.vhdr"), "BrainVision"),
    ] {
        let output = ddalab()
            .args(["validate", "--json", "--file"])
            .arg(&path)
            .assert()
            .success();
        let parsed: Value = serde_json::from_slice(&output.get_output().stdout).unwrap();
        assert_eq!(parsed["supported"], true);
        assert_eq!(parsed["file_type"], format);
    }
}

#[test]
fn test_validate_refuses_a_file_that_does_not_open() {
    // Empty files have a supported extension and no header.
    for suffix in [".edf", ".vhdr", ".txt"] {
        let tmp = tempfile::Builder::new().suffix(suffix).tempfile().unwrap();
        let output = ddalab()
            .args(["validate", "--json", "--file"])
            .arg(tmp.path())
            .assert()
            .failure()
            .code(1);
        let parsed: Value = serde_json::from_slice(&output.get_output().stdout).unwrap();
        assert_eq!(parsed["supported"], true, "{suffix}");
        assert!(parsed["file_type"].is_null(), "{suffix}");
        let error = parsed["error"].as_str().unwrap();
        assert!(error.starts_with("Could not open"), "{suffix}: {error}");
    }
}

#[test]
fn test_validate_reports_support_by_extension() {
    for (file, supported) in [
        ("/nonexistent/rec.vhdr", true),
        ("/nonexistent/rec.xyz", false),
    ] {
        let output = ddalab()
            .args(["validate", "--json", "--file", file])
            .assert()
            .failure()
            .code(1);
        let parsed: Value = serde_json::from_slice(&output.get_output().stdout).unwrap();
        assert_eq!(parsed["exists"], false);
        assert_eq!(parsed["supported"], supported, "{file}");
    }
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
fn test_run_empty_file_is_refused() {
    let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();

    ddalab()
        .arg("run")
        .arg("--file")
        .arg(tmp.path().to_str().unwrap())
        .assert()
        .failure()
        .code(1)
        .stderr(predicate::str::contains("Error"));
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
    assert_eq!(parsed["schema"], "ddalab.result/2");
    assert_eq!(parsed["variants"][0]["id"], "ST");
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

// =============================================================================
// RUN AND BATCH OVER READERS, BLOCKS AND OUTPUTS
// =============================================================================

/// Window 64, step 32, delays 1 and 2: a window marker of `64 + 2 + 2 * 4` samples.
const FAST: [&str; 7] = ["--wl", "64", "--ws", "32", "--delays", "1", "2"];

fn windows(rows: usize) -> usize {
    1 + (rows - 73) / 32
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

/// `rec.edf` of the default `EdfSpec`: Fp1 and Fp2 at 256 Hz, 1024 samples.
fn write_edf(dir: &Path) -> PathBuf {
    let path = dir.join("rec.edf");
    std::fs::write(&path, edf_bytes(&EdfSpec::default())).unwrap();
    path
}

/// A request like the CLI builds for `FAST` settings and the default selection.
fn fast_request() -> DDARequest {
    DDARequest {
        file_path: String::new(),
        channels: None,
        time_range: TimeRange {
            start: 0.0,
            end: f64::INFINITY,
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: vec!["ST".to_string()],
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: 64,
            window_step: 32,
            ct_window_length: None,
            ct_window_step: None,
        },
        delay_parameters: DelayParameters { delays: vec![1, 2] },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: Some(ModelParameters {
            dm: 4,
            order: 4,
            nr_tau: 2,
        }),
        model_terms: None,
        variant_configs: None,
        sampling_rate: None,
    }
}

/// The values of a `.npy` file of f64 after its `header_len` header bytes.
fn npy_values(path: &Path, header_len: usize) -> Vec<f64> {
    std::fs::read(path).unwrap()[header_len..]
        .chunks_exact(8)
        .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
        .collect()
}

#[test]
fn run_edf_fixture_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());
    let out = dir.path().join("out.json");
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .arg("--output")
        .arg(&out)
        .assert()
        .success();

    let doc = read_json(&out);
    assert_eq!(doc["schema"], "ddalab.result/2");
    assert_eq!(doc["file_name"], "rec.edf");
    assert_eq!(doc["variants"][0]["id"], "ST");
    assert_eq!(
        doc["variants"][0]["row_labels"],
        serde_json::json!(["Fp1", "Fp2"])
    );
    let w = windows(1024);
    assert_eq!(doc["window_centers_seconds"].as_array().unwrap().len(), w);
    assert_eq!(doc["variants"][0]["matrix"][1].as_array().unwrap().len(), w);
    assert_eq!(doc["reproduction"]["compute_device"], "cpu");
    let hash = doc["reproduction"]["input_sha256"]["rec.edf"]
        .as_str()
        .unwrap();
    assert_eq!(hash.len(), 64);
}

#[test]
fn run_brainvision_bundle() {
    let dir = tempfile::tempdir().unwrap();
    let spec = BrainVisionSpec::default(); // Fp1, Fp2, Cz; 600 samples at 500 Hz
    for (name, bytes) in brainvision_files(&spec) {
        std::fs::write(dir.path().join(name), bytes).unwrap();
    }
    let vhdr = dir.path().join("sub-01_ieeg.vhdr");
    let bundle = dir.path().join("bundle");
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&vhdr)
        .args(FAST)
        .arg("--bundle")
        .arg(&bundle)
        .assert()
        .success();

    let manifest = read_json(&bundle.join("manifest.json"));
    let w = windows(600);
    assert_eq!(
        manifest["window_centers_seconds"].as_array().unwrap().len(),
        w
    );
    assert_eq!(
        manifest["variants"][0]["row_labels"],
        serde_json::json!(["Fp1", "Fp2", "Cz"])
    );
    let recording = open_recording(&FileSet::from_path(&vhdr).unwrap(), None).unwrap();
    let layout = bundle_layout(&fast_request(), recording.info(), w).unwrap();
    assert_eq!(layout.arrays.len(), 3);
    assert_eq!(layout.arrays[0].header, npy_header(&[w, 3]));
    for array in &layout.arrays {
        let bytes = std::fs::read(bundle.join(&array.path)).unwrap();
        let (header, values) = bytes.split_at(array.header.len());
        assert_eq!(header, &array.header[..], "{}", array.path);
        assert_eq!(
            values.len(),
            array.shape.iter().product::<usize>() * 8,
            "{}",
            array.path
        );
        assert!(manifest["variants"][0]["arrays"]
            .as_array()
            .unwrap()
            .contains(&Value::from(array.path.clone())));
    }
}

#[test]
fn run_bundle_equals_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());
    let json = dir.path().join("out.json");
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .arg("--output")
        .arg(&json)
        .assert()
        .success();
    // A budget of 0 MiB makes every window its own block.
    for (name, block_mb) in [("whole", "512"), ("blocks", "0")] {
        ddalab()
            .arg("run")
            .arg("--file")
            .arg(&path)
            .args(FAST)
            .args(["--block-mb", block_mb, "--bundle"])
            .arg(dir.path().join(name))
            .assert()
            .success();
    }

    // Blocks and one run write the same bytes.
    for file in ["q.npy", "coefficients.npy", "fit_error.npy"] {
        let bytes =
            |name: &str| std::fs::read(dir.path().join(name).join("ST").join(file)).unwrap();
        assert_eq!(bytes("whole"), bytes("blocks"), "{file}");
    }

    // The document holds the same values; parsing its decimals is not exact to the last bit.
    let doc = read_json(&json);
    let variant = &doc["variants"][0];
    let bundle = dir.path().join("blocks/ST");
    let w = windows(1024);
    let close = |a: f64, b: f64| (a - b).abs() <= 1e-12 * b.abs().max(1.0);
    let header = npy_header(&[w, 2]).len();
    for (file, matrix) in [("q.npy", "matrix"), ("fit_error.npy", "fit_error_matrix")] {
        let values = npy_values(&bundle.join(file), header);
        for t in 0..w {
            for r in 0..2 {
                let want = variant[matrix][r][t].as_f64().unwrap();
                assert!(close(values[t * 2 + r], want), "{file} [{t}][{r}]");
            }
        }
    }
    let header = npy_header(&[w, 2, 3]).len();
    let values = npy_values(&bundle.join("coefficients.npy"), header);
    for t in 0..w {
        for r in 0..2 {
            for k in 0..3 {
                let want = variant["coefficient_matrices"][k][r][t].as_f64().unwrap();
                assert!(close(values[(t * 2 + r) * 3 + k], want), "[{t}][{r}][{k}]");
            }
        }
    }
}

#[test]
fn run_progress_counts_the_windows_of_the_whole_run() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());
    let w = windows(1024);
    // Every window is its own block, so a block-local count would end at 1/1.
    let run = |extra: &[&str]| {
        let output = ddalab()
            .arg("run")
            .arg("--file")
            .arg(&path)
            .args(FAST)
            .args(["--block-mb", "0", "--output"])
            .arg(dir.path().join("out.json"))
            .args(extra)
            .assert()
            .success();
        String::from_utf8(output.get_output().stderr.clone()).unwrap()
    };
    assert!(run(&[]).contains(&format!("window {w}/{w}")));
    assert!(!run(&["--quiet"]).contains("window"));
}

#[test]
fn run_without_channels_skips_bad() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_bids_edf(dir.path()); // Fp2 is bad in channels.tsv
    let out = dir.path().join("out.json");
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .arg("--output")
        .arg(&out)
        .assert()
        .success();
    let doc = read_json(&out);
    assert_eq!(doc["variants"][0]["row_labels"], serde_json::json!(["Fp1"]));
    assert_eq!(
        doc["reproduction"]["selected_channel_names"],
        serde_json::json!(["Fp1"])
    );

    // Naming the bad channel selects it.
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .args(["--channels", "0", "1", "--output"])
        .arg(&out)
        .assert()
        .success();
    assert_eq!(
        read_json(&out)["variants"][0]["row_labels"],
        serde_json::json!(["Fp1", "Fp2"])
    );
}

#[test]
fn run_start_and_end_seconds_map_to_samples() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());
    let out = dir.path().join("out.json");
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .args(["--start", "1", "--end", "3", "--output"])
        .arg(&out)
        .assert()
        .success();
    let doc = read_json(&out);
    // Samples 256 to 768 inclusive.
    assert_eq!(doc["reproduction"]["start_time_seconds"], 1.0);
    assert_eq!(doc["reproduction"]["end_time_seconds"], 3.0);
    assert_eq!(
        doc["window_centers_seconds"].as_array().unwrap().len(),
        windows(513)
    );
}

#[test]
fn run_refuses_channels_and_bounds_outside_the_recording() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());
    for (args, message) in [
        (vec!["--channels", "2"], "channel 2"),
        (vec!["--start-sample", "1024"], "start"),
        (
            vec!["--start-sample", "500", "--end-sample", "400"],
            "is before",
        ),
    ] {
        ddalab()
            .arg("run")
            .arg("--file")
            .arg(&path)
            .args(FAST)
            .args(args)
            .assert()
            .failure()
            .code(1)
            .stderr(predicate::str::contains(message));
    }
}

#[test]
fn run_whole_request_for_variants_blocks_refuse() {
    let dir = tempfile::tempdir().unwrap();
    let path = write_edf(dir.path());
    let out = dir.path().join("out.json");
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .args(["--variants", "TRCCD", "--cd-pairs", "1,0", "--output"])
        .arg(&out)
        .assert()
        .success();
    // TRCCD comes with the CCD it regularizes.
    let doc = read_json(&out);
    let trccd = doc["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["id"] == "TRCCD")
        .unwrap();
    assert_eq!(trccd["row_labels"], serde_json::json!(["Fp2 <- Fp1"]));
    assert_eq!(trccd["matrix"][0].as_array().unwrap().len(), windows(1024));

    // A late start leaves out the leading samples.
    ddalab()
        .arg("run")
        .arg("--file")
        .arg(&path)
        .args(FAST)
        .args(["--variants", "TRCCD", "--cd-pairs", "1,0"])
        .args(["--start-sample", "100", "--output"])
        .arg(&out)
        .assert()
        .success();
    assert_eq!(
        read_json(&out)["window_centers_seconds"]
            .as_array()
            .unwrap()
            .len(),
        windows(1024 - 100)
    );
}

/// A BIDS recording `<root>/<subject>/eeg/<subject>_task-a_eeg.edf` of the default `EdfSpec`
/// whose modality JSON describes `seconds` seconds at 256 Hz.
fn write_bids_recording(root: &Path, subject: &str, seconds: u32) {
    let dir = root.join(subject).join("eeg");
    std::fs::create_dir_all(&dir).unwrap();
    let stem = format!("{subject}_task-a_eeg");
    std::fs::write(
        dir.join(format!("{stem}.edf")),
        edf_bytes(&EdfSpec::default()),
    )
    .unwrap();
    std::fs::write(
        dir.join(format!("{stem}.json")),
        format!(r#"{{"SamplingFrequency": 256, "RecordingDuration": {seconds}}}"#),
    )
    .unwrap();
}

#[test]
fn batch_bids_manifest_schema() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("bids");
    write_bids_recording(&root, "sub-01", 4);
    write_bids_recording(&root, "sub-02", 100); // 1024 samples are 4 s of the 100 s described
    let out_dir = dir.path().join("out");
    let output = ddalab()
        .args(["batch", "--bids-dir"])
        .arg(&root)
        .arg("--output-dir")
        .arg(&out_dir)
        .args(FAST)
        .assert()
        .success();
    let manifest: Value = serde_json::from_slice(&output.get_output().stdout).unwrap();

    let mut keys: Vec<&str> = manifest
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    assert_eq!(
        keys,
        [
            "failed",
            "matchedFiles",
            "processedFiles",
            "results",
            "succeeded",
            "withWarnings"
        ]
    );
    assert_eq!(manifest["matchedFiles"], 2);
    assert_eq!(manifest["processedFiles"], 2);
    assert_eq!(manifest["succeeded"], 2);
    assert_eq!(manifest["failed"], 0);
    assert_eq!(manifest["withWarnings"], 1);

    let results = manifest["results"].as_array().unwrap();
    for (result, subject) in results.iter().zip(["sub-01", "sub-02"]) {
        let relative = format!("{subject}/eeg/{subject}_task-a_eeg.edf");
        assert_eq!(result["inputPath"], relative.as_str());
        assert_eq!(result["resolvedDatasetPath"], relative.as_str());
        assert_eq!(result["status"], "ok");
        assert_eq!(result["result"]["rows"], serde_json::json!({"ST": 2}));
        assert_eq!(result["result"]["windows"], windows(1024));
        let written = PathBuf::from(result["outputPath"].as_str().unwrap());
        assert_eq!(written.parent().unwrap(), out_dir);
        let name = written.file_name().unwrap().to_str().unwrap();
        let rest = name
            .strip_prefix(&format!("{subject}_task-a_eeg."))
            .unwrap();
        let digest = rest.strip_suffix(".dda.json").unwrap();
        assert!(
            digest.len() == 8 && digest.bytes().all(|b| b.is_ascii_hexdigit()),
            "{name}"
        );
        assert_eq!(read_json(&written)["schema"], "ddalab.result/2");
    }
    assert_eq!(results[0]["warnings"], serde_json::json!([]));
    assert_eq!(
        results[1]["warnings"],
        serde_json::json!(["The data file holds 1024 samples (4.00 s), but the BIDS sidecar describes 100.00 s; the file appears truncated."])
    );
}

#[test]
fn batch_skips_code_derivatives_and_sourcedata() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("bids");
    write_bids_recording(&root, "sub-01", 4);
    for skipped in ["code", "derivatives", "sourcedata"] {
        write_bids_recording(&root.join(skipped), "sub-01", 4);
    }
    // The same at depth, as the Python batch skips them at any depth.
    write_bids_recording(&root.join("sub-02/derivatives"), "sub-02", 4);
    let output = ddalab()
        .args(["batch", "--compact", "--bids-dir"])
        .arg(&root)
        .args(FAST)
        .assert()
        .success();
    let manifest: Value = serde_json::from_slice(&output.get_output().stdout).unwrap();
    assert_eq!(manifest["matchedFiles"], 1);
    assert_eq!(
        manifest["results"][0]["inputPath"],
        "sub-01/eeg/sub-01_task-a_eeg.edf"
    );
}

#[test]
fn batch_reports_failures_and_exits_partial() {
    let dir = tempfile::tempdir().unwrap();
    let good = write_edf(dir.path());
    let bad = dir.path().join("short.edf");
    std::fs::write(
        &bad,
        edf_bytes(&EdfSpec {
            rates_per_record: vec![32, 32],
            records: 1,
            ..EdfSpec::default()
        }),
    )
    .unwrap();
    let output = ddalab()
        .args(["batch", "--continue-on-error", "--compact", "--files"])
        .arg(&bad)
        .arg(&good)
        .args(FAST)
        .assert()
        .code(4);
    let manifest: Value = serde_json::from_slice(&output.get_output().stdout).unwrap();
    assert_eq!(manifest["succeeded"], 1);
    assert_eq!(manifest["failed"], 1);
    assert_eq!(manifest["results"][0]["status"], "error");
    assert!(manifest["results"][0]["error"].is_string());
    // Without --output-dir the document itself is in the manifest.
    assert_eq!(
        manifest["results"][1]["result"]["schema"],
        "ddalab.result/2"
    );
}
