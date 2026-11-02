//! Edited copies of recordings (io/edit.rs): each copy, put together from its parts, opens with the edited labels,
//! units and recording fields, and the same stored samples and annotations as the original.
//!
//! - EDF and BDF: header fields padded in place, data records copied (`edf_copy_*`, `bdf_copy_keeps_its_format`)
//! - BrainVision: channel lines rewritten, the three files renamed together (`brainvision_copy_*`)
//! - EEGLAB: a BrainVision copy of the float32 samples and events (`eeglab_copy_is_brainvision_with_the_same_data`)
//! - CSV: the header line rewritten (`csv_copy_rewrites_its_header`)
//! - BIDS: the `_channels.tsv` follows the renamed channels (`bids_channels_tsv_follows_the_labels`)
//! - refusals: too long, not ASCII, a bad date, empty or repeated labels (`edits_a_format_cannot_hold_are_refused`)

mod support;

use dda_rs::io::edit::{edit, metadata, Metadata, OutFile, Part};
use dda_rs::io::{open_recording, ByteSource, FileSet, MemorySource, Reader};
use std::path::PathBuf;
use std::sync::Arc;
use support::{edf_bytes, EdfSpec};

fn fixture(name: &str) -> FileSet {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    FileSet::from_path(&path).unwrap()
}

fn file_set(files: Vec<(String, Vec<u8>)>) -> FileSet {
    FileSet {
        primary: files[0].0.clone(),
        files: files
            .into_iter()
            .map(|(name, bytes)| (name, Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>))
            .collect(),
    }
}

/// The stored samples of every display channel, row-major.
fn samples(reader: &dyn Reader) -> Vec<f32> {
    let info = reader.info();
    let channels = info.analysis_channels();
    let rows = info.sample_count as usize;
    let mut out = vec![0f32; rows * channels.len()];
    reader.read_raw_f32(&channels, 0, rows, &mut out).unwrap();
    out
}

/// The copy's files as bytes, its first file primary.
fn materialize(files: &FileSet, out: &[OutFile]) -> FileSet {
    let original = open_recording(files, None).unwrap();
    let built = out
        .iter()
        .map(|file| {
            let mut bytes = Vec::new();
            for part in &file.parts {
                match part {
                    Part::Bytes { bytes: b } => bytes.extend_from_slice(b),
                    Part::Slice { file, start, end } => {
                        let mut b = vec![0u8; (end - start) as usize];
                        files.source(file).unwrap().read_at(*start, &mut b).unwrap();
                        bytes.extend_from_slice(&b);
                    }
                    Part::Samples { rows } => {
                        assert_eq!(*rows, original.info().sample_count);
                        bytes.extend(samples(&*original).iter().flat_map(|v| v.to_le_bytes()));
                    }
                }
            }
            (file.name.clone(), bytes)
        })
        .collect();
    file_set(built)
}

fn set(metadata: &mut Metadata, channel: usize, key: &str, value: &str) {
    let c = metadata.columns.iter().position(|f| f.key == key).unwrap();
    metadata.channels[channel].values[c] = value.to_string();
}

fn set_field(metadata: &mut Metadata, key: &str, value: &str) {
    metadata
        .fields
        .iter_mut()
        .find(|f| f.key == key)
        .unwrap()
        .value = value.to_string();
}

fn labels(reader: &dyn Reader) -> Vec<String> {
    reader
        .info()
        .channels
        .iter()
        .map(|c| c.label.clone())
        .collect()
}

#[test]
fn edf_copy_has_the_edited_header_and_the_same_samples() {
    let files = fixture("fixture.edf");
    let original = open_recording(&files, None).unwrap();
    let mut m = metadata(&files).unwrap();
    assert_eq!(m.writes_as, "EDF");
    set(&mut m, 0, "label", "EEG Fp1-Ref");
    set(&mut m, 1, "unit", "mV");
    set(&mut m, 0, "prefilter", "HP:0.1Hz LP:70Hz");
    set_field(&mut m, "patient", "X F 01-JAN-1970 Anon");
    set_field(&mut m, "startdate", "02.03.04");
    let out = edit(&files, &m).unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].name, "fixture-edited.edf");
    let copy = materialize(&files, &out);
    let reader = open_recording(&copy, None).unwrap();
    assert_eq!(labels(&*reader)[0], "EEG Fp1-Ref");
    assert_eq!(labels(&*reader)[1..], labels(&*original)[1..]);
    assert_eq!(samples(&*reader), samples(&*original));
    // mV instead of µV: the same digital values read 1000 times larger.
    let ratio = reader.info().channels[1].gain / original.info().channels[1].gain;
    assert!((ratio - 1000.0).abs() < 1e-9, "{ratio}");
    let again = metadata(&copy).unwrap();
    assert_eq!(again.fields, m.fields);
    assert_eq!(again.channels, m.channels);
    assert_eq!(
        reader.scan_annotations().unwrap().0,
        original.scan_annotations().unwrap().0
    );
}

#[test]
fn bdf_copy_keeps_its_format() {
    let files = fixture("fixture.bdf");
    let mut m = metadata(&files).unwrap();
    assert_eq!(m.writes_as, "BDF");
    set(&mut m, 0, "label", "Renamed");
    let copy = materialize(&files, &edit(&files, &m).unwrap());
    let reader = open_recording(&copy, None).unwrap();
    assert_eq!(
        reader.info().format,
        open_recording(&files, None).unwrap().info().format
    );
    assert_eq!(labels(&*reader)[0], "Renamed");
}

#[test]
fn brainvision_copy_renames_its_files_and_channels() {
    let files = fixture("fixture.vhdr");
    let original = open_recording(&files, None).unwrap();
    let mut m = metadata(&files).unwrap();
    assert_eq!(m.channels[0].values, ["Fp1", "µV"]);
    set(&mut m, 0, "label", "Fp1, left");
    set(&mut m, 1, "unit", "mV");
    let out = edit(&files, &m).unwrap();
    let names: Vec<&str> = out.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "fixture-edited.vhdr",
            "fixture-edited.eeg",
            "fixture-edited.vmrk"
        ]
    );
    let copy = materialize(&files, &out);
    let reader = open_recording(&copy, None).unwrap();
    assert_eq!(labels(&*reader)[0], "Fp1, left");
    assert_eq!(samples(&*reader), samples(&*original));
    let ratio = reader.info().channels[1].gain / original.info().channels[1].gain;
    assert!((ratio - 1000.0).abs() < 1e-9, "{ratio}");
    assert_eq!(reader.info().annotations, original.info().annotations);
    assert!(!reader.info().annotations.is_empty());
}

#[test]
fn eeglab_copy_is_brainvision_with_the_same_data() {
    for name in ["fixture_eeglab.set", "fixture_eeglab_inline.set"] {
        let files = fixture(name);
        let original = open_recording(&files, None).unwrap();
        let mut m = metadata(&files).unwrap();
        assert_eq!(m.writes_as, "BrainVision");
        assert_eq!(m.channels[0].values[1], "µV");
        set(&mut m, 0, "label", "Renamed");
        let out = edit(&files, &m).unwrap();
        assert!(out[0].name.ends_with("-edited.vhdr"), "{}", out[0].name);
        let copy = materialize(&files, &out);
        let reader = open_recording(&copy, None).unwrap();
        assert_eq!(reader.info().format, "BrainVision");
        assert_eq!(labels(&*reader)[0], "Renamed");
        assert_eq!(labels(&*reader)[1..], labels(&*original)[1..]);
        assert_eq!(reader.info().sample_rate_hz, original.info().sample_rate_hz);
        let rows = original.info().sample_count as usize;
        let channels = original.info().analysis_channels();
        let (a, b) = (
            original.read_rows(&channels, 0, rows).unwrap(),
            reader.read_rows(&channels, 0, rows).unwrap(),
        );
        for (x, y) in a.iter().flatten().zip(b.iter().flatten()) {
            assert!((x - y).abs() <= 1e-12 + 1e-9 * x.abs(), "{x} vs {y}");
        }
        let onsets = |r: &dyn Reader| -> Vec<(i64, String)> {
            let rate = r.info().sample_rate_hz;
            r.scan_annotations()
                .unwrap()
                .0
                .iter()
                .map(|a| ((a.onset_s * rate).round() as i64, a.label.clone()))
                .collect()
        };
        assert_eq!(onsets(&*reader), onsets(&*original), "{name}");
    }
}

#[test]
fn csv_copy_rewrites_its_header() {
    let files = fixture("fixture.csv");
    let original = open_recording(&files, None).unwrap();
    let mut m = metadata(&files).unwrap();
    assert_eq!(m.channels.len(), 3);
    set(&mut m, 2, "label", "Oz");
    let copy = materialize(&files, &edit(&files, &m).unwrap());
    let reader = open_recording(&copy, None).unwrap();
    assert_eq!(labels(&*reader), ["C3", "C4", "Oz"]);
    assert_eq!(reader.info().sample_rate_hz, original.info().sample_rate_hz);
    assert_eq!(samples(&*reader), samples(&*original));
}

#[test]
fn csv_without_a_header_gets_one() {
    let files = file_set(vec![("rows.csv".into(), b"1,2\n3,4\n5,6\n".to_vec())]);
    let mut m = metadata(&files).unwrap();
    set(&mut m, 0, "label", "A");
    set(&mut m, 1, "label", "B");
    let copy = materialize(&files, &edit(&files, &m).unwrap());
    let reader = open_recording(&copy, Some(1.0)).unwrap();
    assert_eq!(labels(&*reader), ["A", "B"]);
    assert_eq!(reader.info().sample_count, 3);
}

fn bids_edf() -> Vec<u8> {
    edf_bytes(&EdfSpec {
        labels: vec!["Fp1".into(), "Fp2".into()],
        units: vec!["uV".into(), "uV".into()],
        rates_per_record: vec![8, 8],
        record_duration_s: 1.0,
        records: 2,
        digital: (-32768, 32767),
        physical: (-100.0, 100.0),
        seed: 1,
        ..EdfSpec::default()
    })
}

#[test]
fn bids_channels_tsv_follows_the_labels() {
    let tsv = "name\ttype\tunits\tstatus\nFp1\tEEG\tuV\tgood\nFp2\tEEG\tuV\tbad\n";
    let files = file_set(vec![
        ("sub-01_task-rest_eeg.edf".into(), bids_edf()),
        (
            "sub-01_task-rest_channels.tsv".into(),
            tsv.as_bytes().to_vec(),
        ),
    ]);
    let mut m = metadata(&files).unwrap();
    set(&mut m, 1, "label", "Fp2-A1");
    let out = edit(&files, &m).unwrap();
    let names: Vec<&str> = out.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "sub-01_task-rest_eeg-edited.edf",
            "sub-01_task-rest_channels.tsv"
        ]
    );
    let copy = materialize(&files, &out);
    let reader = open_recording(&copy, None).unwrap();
    let fp2 = &reader.info().channels[1];
    assert_eq!(
        (fp2.label.as_str(), fp2.bids_status.as_deref()),
        ("Fp2-A1", Some("bad"))
    );
    // Nothing changed: no sidecar in the copy.
    let unchanged = edit(&files, &metadata(&files).unwrap()).unwrap();
    assert_eq!(unchanged.len(), 1);
}

#[test]
fn edits_a_format_cannot_hold_are_refused() {
    let files = fixture("fixture.edf");
    let m = metadata(&files).unwrap();
    let refused = |change: &dyn Fn(&mut Metadata), want: &str| {
        let mut edited = m.clone();
        change(&mut edited);
        let error = edit(&files, &edited).unwrap_err().to_string();
        assert!(error.contains(want), "{error} lacks {want}");
    };
    refused(
        &|m| set(m, 0, "label", "a label of seventeen"),
        "longer than 16",
    );
    refused(&|m| set(m, 0, "label", "Fp1–Ref"), "outside ASCII");
    refused(&|m| set(m, 0, "label", ""), "no label");
    refused(
        &|m| set(m, 1, "label", &m.channels[0].values[0].clone()),
        "used twice",
    );
    refused(&|m| set_field(m, "startdate", "31.13.99"), "not dd.mm.yy");
    refused(&|m| set_field(m, "starttime", "24.00.00"), "not hh.mm.ss");
    refused(
        &|m| m.channels.pop().map(drop).unwrap_or(()),
        "does not match",
    );
}
