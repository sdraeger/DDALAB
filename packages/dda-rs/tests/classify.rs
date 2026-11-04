// `ddalab classify` on labeled recordings and `ddalab predict` with the model it trains.
use serde_json::Value;
use std::path::Path;

/// A CSV recording at 256 Hz: two channels of a sine of `hz` plus deterministic noise.
fn write_csv(path: &Path, hz: f64, seed: u64) {
    let mut state = seed;
    let mut noise = || {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 33) as f64 / (1u64 << 31) as f64 - 0.5
    };
    let mut text = String::from("time,A,B\n");
    for i in 0..256 * 20 {
        let t = i as f64 / 256.0;
        let s = (2.0 * std::f64::consts::PI * hz * t).sin();
        text += &format!(
            "{t:.6},{:.6},{:.6}\n",
            s + 0.3 * noise(),
            0.5 * s + 0.3 * noise()
        );
    }
    std::fs::write(path, text).unwrap();
}

fn ddalab(args: &[&str]) {
    let output = assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_model_trained_on_labeled_recordings_classifies_a_new_one() {
    let dir = tempfile::tempdir().unwrap();
    let mut table = String::from("file\tlabel\n");
    for subject in 1..=3 {
        for (label, hz) in [("slow", 4.0), ("fast", 18.0)] {
            let file = dir.path().join(format!("sub-{subject}_{label}.csv"));
            write_csv(&file, hz, subject * 100 + hz as u64);
            table += &format!("{}\t{label}\n", file.display());
        }
    }
    let samples = dir.path().join("samples.tsv");
    std::fs::write(&samples, table).unwrap();
    let report = dir.path().join("report.json");
    let search = [
        "--segment",
        "2",
        "--wl",
        "128",
        "--ws",
        "64",
        "--order",
        "2",
        "--terms",
        "2",
        "--delay-range",
        "1",
        "4",
        "--folds",
        "3",
        "--quiet",
    ];
    let mut args = vec![
        "classify",
        "--samples",
        samples.to_str().unwrap(),
        "-o",
        report.to_str().unwrap(),
    ];
    args.extend(search);
    ddalab(&args);
    let report: Value = serde_json::from_str(&std::fs::read_to_string(&report).unwrap()).unwrap();
    assert_eq!(report["classes"], serde_json::json!(["fast", "slow"]));
    assert_eq!(report["groups"], 3, "the subjects are the groups");
    assert!(
        report["nested_score"].as_f64().unwrap() > 0.9,
        "{}",
        report["nested_score"]
    );

    let unseen = dir.path().join("new.csv");
    write_csv(&unseen, 18.0, 999);
    let predictions = dir.path().join("predictions.json");
    ddalab(&[
        "predict",
        "--model",
        dir.path().join("report.json").to_str().unwrap(),
        "--files",
        unseen.to_str().unwrap(),
        "--segment",
        "2",
        "-o",
        predictions.to_str().unwrap(),
    ]);
    let predictions: Value =
        serde_json::from_str(&std::fs::read_to_string(&predictions).unwrap()).unwrap();
    assert_eq!(predictions["files"][0]["class"], "fast");
}

#[test]
fn one_class_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("sub-1_a.csv");
    write_csv(&file, 5.0, 1);
    let samples = dir.path().join("samples.tsv");
    std::fs::write(&samples, format!("file\tlabel\n{}\tonly\n", file.display())).unwrap();
    assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .args([
            "classify",
            "--samples",
            samples.to_str().unwrap(),
            "--segment",
            "2",
            "--quiet",
            "-o",
        ])
        .arg(dir.path().join("r.json"))
        .assert()
        .failure()
        .stderr(predicates::str::contains("two classes"));
}

#[test]
fn annotations_and_the_rest_make_two_classes() {
    let edf = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fixture.edf");
    let dir = tempfile::tempdir().unwrap();
    let output = assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .args([
            "classify",
            "--files",
            edf,
            "--classes",
            "spike",
            "--rest",
            "calm",
            "--segment",
            "2",
            "-o",
        ])
        .arg(dir.path().join("r.json"))
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    // One recording is one group: the segments of both classes were found, and cross-validation has nothing to split.
    assert!(
        stderr.contains("1 segments") || stderr.contains("2 segments"),
        "{stderr}"
    );
    assert!(stderr.contains("two groups"), "{stderr}");
}
