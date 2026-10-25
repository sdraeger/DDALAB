//! BIDS sidecars beside a recording (`domain/bids.py`, `readers/mne.py:_bids_warnings`) and format dispatch.
//!
//! - `<prefix>_channels.tsv`: `status` and `type` by channel `name` (`channels_tsv_sets_status`)
//! - `<prefix>_events.tsv`: `onset`, `duration`, `trial_type` rows become annotations with source `events.tsv`;
//!   clock stamps and rows without a numeric onset are skipped, a missing, empty or `n/a` trial_type is the label
//!   `n/a`, `n/a` duration is 0 (`events_tsv_to_annotations`, `events_without_a_trial_type_are_labeled_na`,
//!   `scan_annotations_appends_events_to_the_file_annotations`)
//! - `<prefix>_<modality>.json`: the two warnings of `_bids_warnings`, with the Python f-string text
//!   (`bids_truncation_warning_text`, `bids_rate_drift_warning_text`, `consistent_or_unreadable_json_adds_no_warning`)
//! - `open_recording` picks the reader by extension (`open_recording_dispatches_by_extension`)
//! - `discover_bids_recordings` (`discover_finds_ieeg_and_eeg_only`)

mod support;

use dda_rs::io::{
    discover_bids_recordings, open_recording, Annotation, ByteSource, FileSet, MemorySource,
};
use std::path::PathBuf;
use std::sync::Arc;
use support::{brainvision_files, edf_bytes, BrainVisionSpec, EdfSpec};

fn file_set(files: Vec<(&str, Vec<u8>)>) -> FileSet {
    FileSet {
        primary: files[0].0.to_string(),
        files: files
            .into_iter()
            .map(|(name, bytes)| {
                (
                    name.to_string(),
                    Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>,
                )
            })
            .collect(),
    }
}

/// Three 256 Hz channels, 4 records of 1 s: 1024 samples, 4 s.
fn edf() -> Vec<u8> {
    edf_bytes(&EdfSpec {
        labels: vec!["Fp1".into(), "Fp2".into(), "Cz".into()],
        units: vec!["uV".into(); 3],
        rates_per_record: vec![256; 3],
        ..EdfSpec::default()
    })
}

const PRIMARY: &str = "sub-01_task-x_eeg.edf";

fn with_sidecar(name: &str, text: &str) -> FileSet {
    file_set(vec![(PRIMARY, edf()), (name, text.as_bytes().to_vec())])
}

fn warnings_with_json(json: &str) -> Vec<String> {
    let files = with_sidecar("sub-01_task-x_eeg.json", json);
    open_recording(&files, None)
        .unwrap()
        .info()
        .warnings
        .clone()
}

#[test]
fn channels_tsv_sets_status() {
    let files = with_sidecar(
        "sub-01_task-x_channels.tsv",
        "name\ttype\tunits\tstatus\nFp1\tEEG\tuV\tgood\nFp2\tECOG\tuV\tbad\nCz\tn/a\tuV\tn/a\nGhost\tEEG\tuV\tbad\n",
    );
    let reader = open_recording(&files, None).unwrap();
    let got: Vec<_> = reader
        .info()
        .channels
        .iter()
        .map(|c| (c.bids_status.as_deref(), c.bids_type.as_deref()))
        .collect();
    assert_eq!(
        got,
        [
            (Some("good"), Some("EEG")),
            (Some("bad"), Some("ECOG")),
            (None, None)
        ]
    );
    assert_eq!(
        reader.info().input_files,
        [PRIMARY, "sub-01_task-x_channels.tsv"]
    );
}

#[test]
fn events_tsv_to_annotations() {
    let files = with_sidecar(
        "sub-01_task-x_events.tsv",
        "onset\tduration\ttrial_type\tvalue\r\n\
         1.5\t0.5\tstim\t1\r\n\
         2.0\tn/a\tresp\t2\r\n\
         2.5\t1\t\t3\r\n\
         x\t1\tbad-onset\t4\r\n\
         4.0\t1\t+60.000000\t5\r\n",
    );
    let reader = open_recording(&files, None).unwrap();
    let want = |onset_s, duration_s, label: &str| Annotation {
        onset_s,
        duration_s,
        label: label.into(),
        source: "events.tsv".into(),
    };
    assert_eq!(
        reader.info().annotations,
        [
            want(1.5, 0.5, "stim"),
            want(2.0, 0.0, "resp"),
            want(2.5, 1.0, "n/a")
        ]
    );
    assert_eq!(
        reader.info().input_files,
        [PRIMARY, "sub-01_task-x_events.tsv"]
    );
}

#[test]
fn events_without_a_trial_type_are_labeled_na() {
    let labels = |tsv: &str| {
        let files = with_sidecar("sub-01_task-x_events.tsv", tsv);
        let reader = open_recording(&files, None).unwrap();
        let annotations = &reader.info().annotations;
        annotations
            .iter()
            .map(|a| (a.onset_s, a.label.clone()))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        labels("onset\tduration\ttrial_type\n1.0\t0\tn/a\n2.0\t0\tstim\n"),
        [(1.0, "n/a".to_string()), (2.0, "stim".to_string())]
    );
    assert_eq!(
        labels("onset\tduration\tvalue\n1.0\t0\t3\n"),
        [(1.0, "n/a".to_string())]
    );
}

#[test]
fn scan_annotations_appends_events_to_the_file_annotations() {
    let edf = edf_bytes(&EdfSpec {
        annotations: vec![(0.5, 0.0, "edf-note".into())],
        ..EdfSpec::default()
    });
    let files = file_set(vec![
        (PRIMARY, edf),
        (
            "sub-01_task-x_events.tsv",
            b"onset\tduration\ttrial_type\n1\t0\tstim\n".to_vec(),
        ),
    ]);
    let reader = open_recording(&files, None).unwrap();
    // The EDF+ TALs are read lazily; open holds only the event.
    assert_eq!(reader.info().annotations.len(), 1);
    let (annotations, warnings) = reader.scan_annotations().unwrap();
    let got: Vec<_> = annotations
        .iter()
        .map(|a| (a.label.as_str(), a.source.as_str()))
        .collect();
    assert_eq!(
        got,
        [("edf-note", "EDF Annotations"), ("stim", "events.tsv")]
    );
    assert!(warnings.is_empty());
}

#[test]
fn bids_truncation_warning_text() {
    // 1024 samples at 256 Hz are 4.00 s; the strings are the `_bids_warnings` f-strings evaluated in Python.
    for (duration, described) in [("10.0", "10.00"), ("10.005", "10.01")] {
        let json = format!(r#"{{"RecordingDuration": {duration}, "SamplingFrequency": 256.0}}"#);
        assert_eq!(
            warnings_with_json(&json),
            [format!(
                "The data file holds 1024 samples (4.00 s), but the BIDS sidecar describes {described} s; the file appears truncated."
            )]
        );
    }
}

#[test]
fn bids_rate_drift_warning_text() {
    // drift = |1024 / 256 - 1024 / 250| = 0.096 s; the duration is long enough for no truncation warning.
    assert_eq!(
        warnings_with_json(r#"{"RecordingDuration": 4.0, "SamplingFrequency": 250}"#),
        ["The file header gives 256.000 Hz and the BIDS sidecar 250.000 Hz. DDALAB uses the header rate, so BIDS event times drift by up to 0.10 s over the recording."]
    );
}

#[test]
fn consistent_or_unreadable_json_adds_no_warning() {
    for json in [
        r#"{"RecordingDuration": 4.0, "SamplingFrequency": 256.0}"#,
        r#"{"RecordingDuration": "4.0", "SamplingFrequency": "256"}"#,
        r#"{"RecordingDuration": 10.0}"#,
        r#"{"RecordingDuration": 10.0, "SamplingFrequency": 0}"#,
        r#"{"RecordingDuration": "long", "SamplingFrequency": 256.0}"#,
        "[1, 2]",
        "not json",
    ] {
        assert_eq!(warnings_with_json(json), Vec::<String>::new(), "{json}");
    }
}

#[test]
fn open_recording_dispatches_by_extension() {
    let reader = open_recording(&file_set(vec![("REC.EDF", edf())]), None).unwrap();
    assert_eq!(reader.info().format, "EDF");

    let spec = BrainVisionSpec::default();
    let files = brainvision_files(&spec);
    let named: Vec<(&str, Vec<u8>)> = files.iter().map(|f| (f.0.as_str(), f.1.clone())).collect();
    let reader = open_recording(&file_set(named), None).unwrap();
    assert_eq!(reader.info().format, "BrainVision");
    assert_eq!(reader.info().channels.len(), 3);

    for name in ["a.txt", "a.csv", "a.tsv", "a.ascii", "a.dat"] {
        let reader = open_recording(
            &file_set(vec![(name, b"1 2\n3 4\n5 6\n".to_vec())]),
            Some(100.0),
        )
        .unwrap();
        assert_eq!(
            (reader.info().sample_rate_hz, reader.info().sample_count),
            (100.0, 3),
            "{name}"
        );
    }

    let error = open_recording(&file_set(vec![("a.xyz", vec![])]), None)
        .err()
        .expect("unknown extension should fail")
        .to_string();
    assert!(error.contains("Unsupported file type: a.xyz"), "{error}");
}

#[test]
fn sidecars_next_to_a_file_on_disk_are_applied() {
    let dir = tempfile::tempdir().unwrap();
    for (name, bytes) in [
        (PRIMARY, edf()),
        (
            "sub-01_task-x_channels.tsv",
            b"name\tstatus\nFp2\tbad\n".to_vec(),
        ),
        (
            "sub-01_task-x_events.tsv",
            b"onset\tduration\ttrial_type\n1\t0\tstim\n".to_vec(),
        ),
        (
            "sub-01_task-x_eeg.json",
            br#"{"RecordingDuration": 10, "SamplingFrequency": 256}"#.to_vec(),
        ),
    ] {
        std::fs::write(dir.path().join(name), bytes).unwrap();
    }
    let files = FileSet::from_path(&dir.path().join(PRIMARY)).unwrap();
    let reader = open_recording(&files, None).unwrap();
    let info = reader.info();
    assert_eq!(info.channels[1].bids_status.as_deref(), Some("bad"));
    assert_eq!(info.annotations.len(), 1);
    assert_eq!(info.warnings.len(), 1);
    assert_eq!(info.input_files.len(), 4);
}

#[test]
fn discover_finds_ieeg_and_eeg_only() {
    let dir = tempfile::tempdir().unwrap();
    let found = [
        "sub-01/ses-1/ieeg/sub-01_ses-1_task-a_ieeg.edf",
        "sub-01/eeg/sub-01_task-b_eeg.vhdr",
        "sub-02/eeg/sub-02_task-b_eeg.bdf",
        "sub-02/eeg/sub-02_task-c_eeg.EDF",
    ];
    let skipped = [
        "sub-02/meg/sub-02_task-b_meg.fif",
        "sub-02/eeg/sub-02_task-b_eeg.json",
        "sub-02/eeg/sub-02_task-b_eeg.eeg",
        "sub-02/eeg/sub-02_task-b_eeg.vmrk",
        "sub-02/eeg/sub-02_task-b_channels.tsv",
        "sub-03/emg/sub-03_task-c_emg.edf",
        "sub-03/eeg/sub-03_task-c_eeg.fif",
        "sub-03/eeg/noeeg.edf",
        "sub-03/eeg/task_ieeg.edf.bak",
    ];
    for name in found.iter().chain(&skipped) {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    let mut want: Vec<PathBuf> = found.iter().map(|name| dir.path().join(name)).collect();
    want.sort();
    assert_eq!(discover_bids_recordings(dir.path()).unwrap(), want);
    assert!(discover_bids_recordings(&dir.path().join("absent")).is_err());
}

#[cfg(unix)]
#[test]
fn discover_skips_hidden_deep_and_unreadable_entries() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let kept = "a/b/c/d/e/f/sub-01_task-a_eeg.edf"; // six directories below the root
    let too_deep = "a/b/c/d/e/f/g/sub-01_task-b_eeg.edf";
    let hidden = [
        ".git/sub-01_task-c_eeg.edf",
        "sub-01/.sub-01_task-d_eeg.edf",
    ];
    let unreadable = "locked/sub-01_task-e_eeg.edf";
    for name in [kept, too_deep, unreadable].iter().chain(&hidden) {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    let locked = dir.path().join("locked");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let found = discover_bids_recordings(dir.path());
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(found.unwrap(), [dir.path().join(kept)]);
}

#[test]
fn discover_skips_code_derivatives_and_sourcedata_at_any_depth() {
    let dir = tempfile::tempdir().unwrap();
    let found = [
        "sub-01/eeg/sub-01_task-a_eeg.edf",
        "sub-02/eeg/sub-02_task-a_eeg.edf",
        // Only a whole name is skipped.
        "sub-03/eeg/derivatives-notes_eeg.edf",
    ];
    let skipped = [
        "code/sub-01_task-a_eeg.edf",
        "derivatives/pipe/sub-01/eeg/sub-01_task-a_eeg.edf",
        "sourcedata/sub-01/eeg/sub-01_task-a_eeg.edf",
        "sub-02/ses-1/derivatives/eeg/sub-02_task-a_eeg.edf",
        "sub-02/code/eeg/sub-02_task-b_eeg.vhdr",
    ];
    for name in found.iter().chain(&skipped) {
        let path = dir.path().join(name);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "x").unwrap();
    }
    let want: Vec<PathBuf> = found.iter().map(|name| dir.path().join(name)).collect();
    assert_eq!(discover_bids_recordings(dir.path()).unwrap(), want);
}
