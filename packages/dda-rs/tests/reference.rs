// `--reference`: the derived channels replace the analysis channels in inspect, run and the result's provenance.
use serde_json::Value;

const EDF: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/fixture.edf");

fn ddalab(args: &[&str]) -> Value {
    let output = assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn labels(info: &Value) -> Vec<String> {
    let channels = info["channels"].as_array().unwrap();
    info["analysis_channels"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| {
            channels[i.as_u64().unwrap() as usize]["label"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect()
}

#[test]
fn inspect_shows_the_derived_channels() {
    let info = ddalab(&["inspect", "--file", EDF, "--reference", "bipolar", "--json"]);
    assert_eq!(labels(&info), ["Fp1-Fp2"]);
}

#[test]
fn a_run_records_its_reference() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("run.json");
    let out = out.to_str().unwrap();
    assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .args([
            "run",
            "--quiet",
            "--file",
            EDF,
            "--reference",
            "average",
            "--wl",
            "256",
            "--ws",
            "256",
            "-o",
            out,
        ])
        .assert()
        .success();
    let document: Value = serde_json::from_str(&std::fs::read_to_string(out).unwrap()).unwrap();
    let reproduction = &document["reproduction"];
    assert_eq!(
        reproduction["selected_channel_names"],
        serde_json::json!(["Fp1-avg", "Fp2-avg"])
    );
    assert_eq!(reproduction["reference"]["reference"]["kind"], "average");
    assert_eq!(
        reproduction["reference"]["channels"][0]["terms"][1]["source"],
        "Fp2"
    );
}

#[test]
fn electrodes_without_laplacian_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let electrodes = dir.path().join("e.tsv");
    std::fs::write(&electrodes, "name\tx\ty\tz\n").unwrap();
    assert_cmd::cargo::cargo_bin_cmd!("ddalab")
        .args([
            "inspect",
            "--file",
            EDF,
            "--reference",
            "average",
            "--electrodes",
            electrodes.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicates::str::contains("--reference laplacian"));
}
