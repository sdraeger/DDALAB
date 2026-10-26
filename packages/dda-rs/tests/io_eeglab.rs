//! The EEGLAB reader against datasets SciPy wrote (tests/fixtures/make_eeglab.py): one variable EEG with its samples
//! in an .fdt, and EEG's fields at the top level, compressed, with the samples inline.

use dda_rs::io::{open_recording, Annotation, ByteSource, FileSet, MemorySource, RawType};
use std::path::Path;
use std::sync::Arc;

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");

fn file_set(primary: &str, names: &[&str]) -> FileSet {
    FileSet {
        primary: primary.to_string(),
        files: names
            .iter()
            .map(|name| {
                let bytes = std::fs::read(Path::new(FIXTURES).join(name)).unwrap();
                (
                    name.to_string(),
                    Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>,
                )
            })
            .collect(),
    }
}

/// The fixtures' sample of channel `c` at row `t`, in microvolts.
fn expected(c: usize, t: usize) -> f64 {
    (100 * (c + 1) + t % 64) as f64 - 32.0
}

fn check(files: &FileSet, input_files: &[&str]) {
    let reader = open_recording(files, None).unwrap();
    let info = reader.info();
    assert_eq!(info.format, "EEGLAB");
    assert_eq!(
        info.channels
            .iter()
            .map(|c| c.label.as_str())
            .collect::<Vec<_>>(),
        ["Fp1", "Fp2", "Cz", "Pz"]
    );
    assert_eq!(info.sample_rate_hz, 256.0);
    assert_eq!(info.sample_count, 512);
    assert_eq!(info.raw_type, RawType::F32);
    assert_eq!(info.input_files, input_files);
    assert!(info.warnings.is_empty(), "{:?}", info.warnings);
    // Latencies count samples from 1; a numeric type prints as its number.
    assert_eq!(
        info.annotations,
        [
            Annotation {
                onset_s: 0.5,
                duration_s: 0.0,
                label: "stim".into(),
                source: "set".into()
            },
            Annotation {
                onset_s: 256.5 / 256.0,
                duration_s: 0.25,
                label: "7".into(),
                source: "set".into()
            },
        ]
    );
    let rows = reader.read_rows(&[3, 0], 100, 40).unwrap();
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row[0], expected(3, 100 + i) * 1e-6);
        assert_eq!(row[1], expected(0, 100 + i) * 1e-6);
    }
    let mut raw = vec![0f32; 2 * 512];
    reader.read_raw_f32(&[1, 2], 0, 512, &mut raw).unwrap();
    for t in 0..512 {
        assert_eq!(raw[2 * t] as f64, expected(1, t));
        assert_eq!(raw[2 * t + 1] as f64, expected(2, t));
    }
}

#[test]
fn a_struct_with_its_samples_in_an_fdt_reads() {
    let names = ["fixture_eeglab.set", "fixture_eeglab.fdt"];
    check(&file_set(names[0], &names), &names);
}

#[test]
fn compressed_top_level_fields_with_inline_samples_read() {
    let name = "fixture_eeglab_inline.set";
    check(&file_set(name, &[name]), &[name]);
}

#[test]
fn a_missing_fdt_is_named() {
    let files = file_set("fixture_eeglab.set", &["fixture_eeglab.set"]);
    let error = open_recording(&files, None).err().unwrap().to_string();
    assert!(
        error.contains("names fixture_eeglab.fdt, which is not among the opened files"),
        "{error}"
    );
}

#[test]
fn the_fdt_beside_a_set_joins_its_file_set() {
    let files = FileSet::from_path(&Path::new(FIXTURES).join("fixture_eeglab.set")).unwrap();
    assert!(files.source("fixture_eeglab.fdt").is_some());
}

/// Why the .fdt fixture's set does not open with the double `from` after the field names, the first after `field`,
/// rewritten as `to`.
fn refusal_with(field: &str, from: f64, to: f64) -> String {
    let mut bytes = std::fs::read(Path::new(FIXTURES).join("fixture_eeglab.set")).unwrap();
    let name = bytes
        .windows(field.len())
        .position(|w| w == field.as_bytes())
        .unwrap();
    let at = name
        + bytes[name..]
            .windows(8)
            .position(|w| w == from.to_le_bytes())
            .unwrap();
    bytes[at..at + 8].copy_from_slice(&to.to_le_bytes());
    let files = FileSet {
        primary: "x.set".to_string(),
        files: [(
            "x.set".to_string(),
            Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>,
        )]
        .into(),
    };
    open_recording(&files, None).err().unwrap().to_string()
}

#[test]
fn an_epoched_dataset_is_refused() {
    let error = refusal_with("trials", 1.0, 2.0);
    assert!(
        error.contains("epoched EEGLAB dataset of 2 trials"),
        "{error}"
    );
}

#[test]
fn an_impossible_channel_count_is_refused() {
    let error = refusal_with("nbchan", 4.0, 1e9);
    assert!(
        error.contains("claims 1000000000 channels; DDALAB reads at most 65536"),
        "{error}"
    );
}
