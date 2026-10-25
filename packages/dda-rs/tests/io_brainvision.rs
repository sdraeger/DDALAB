mod support;

use dda_rs::io::{
    open_brainvision, Annotation, ByteSource, ChannelKind, FileSet, MemorySource, RawType, Reader,
};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use support::{brainvision_files, brainvision_stored, BrainVisionSpec, CountingSource};

fn file_set(files: Vec<(String, Vec<u8>)>) -> FileSet {
    FileSet {
        primary: files.first().map(|f| f.0.clone()).unwrap_or_default(),
        files: files
            .into_iter()
            .map(|(name, bytes)| (name, Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>))
            .collect(),
    }
}

fn vhdr(spec: &BrainVisionSpec) -> String {
    format!("{}.vhdr", spec.stem)
}

fn open(spec: &BrainVisionSpec) -> Box<dyn Reader> {
    open_brainvision(&file_set(brainvision_files(spec)), &vhdr(spec)).unwrap()
}

fn open_error(files: Vec<(String, Vec<u8>)>, vhdr_name: &str) -> String {
    open_brainvision(&file_set(files), vhdr_name)
        .err()
        .expect("open should fail")
        .to_string()
}

fn names(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|s| s.to_string()).collect()
}

/// `files` with `name` replaced by the result of `edit` on its bytes.
fn edited(
    mut files: Vec<(String, Vec<u8>)>,
    name: &str,
    edit: impl Fn(&str) -> String,
) -> Vec<(String, Vec<u8>)> {
    let file = files.iter_mut().find(|f| f.0 == name).unwrap();
    file.1 = edit(&String::from_utf8(file.1.clone()).unwrap()).into_bytes();
    files
}

#[test]
fn multiplexed_int16_scaling() {
    let spec = BrainVisionSpec::default();
    let reader = open(&spec);
    let info = reader.info();
    assert_eq!(info.format, "BrainVision");
    assert_eq!(info.raw_type, RawType::I16);
    assert_eq!(info.sample_rate_hz, 500.0);
    assert_eq!(info.sample_count, 600);
    assert_eq!(info.duration_s, 1.2);
    let labels: Vec<&str> = info.channels.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["Fp1", "Fp2", "Cz"]);
    assert!(info.channels.iter().all(|c| c.kind == ChannelKind::Signal
        && c.unit == "V"
        && c.sample_rate_hz == 500.0
        && c.offset == 0.0));
    assert_eq!(info.analysis_channels(), [0, 1, 2]);
    assert_eq!(
        info.input_files,
        ["sub-01_ieeg.vhdr", "sub-01_ieeg.eeg", "sub-01_ieeg.vmrk"]
    );
    assert!(info.warnings.is_empty());

    let rows = reader.read_rows(&[2, 0], 5, 4).unwrap();
    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row[0], brainvision_stored(&spec, 2, 5 + i) * 1e-7);
        assert_eq!(row[1], brainvision_stored(&spec, 0, 5 + i) * 1e-7);
    }
}

#[test]
fn vectorized_float32_read() {
    let spec = BrainVisionSpec {
        binary_format: "IEEE_FLOAT_32",
        vectorized: true,
        resolution: "0.5".into(),
        ..BrainVisionSpec::default()
    };
    let reader = open(&spec);
    assert_eq!(reader.info().raw_type, RawType::F32);
    let rows = reader.read_rows(&[2], 10, 10).unwrap();
    assert_eq!(rows.len(), 10);
    for (i, row) in rows.iter().enumerate() {
        let want = brainvision_stored(&spec, 2, 10 + i) * 0.5 * 1e-6;
        assert!(
            (row[0] - want).abs() <= want.abs() * f64::EPSILON,
            "{} vs {want}",
            row[0]
        );
    }
}

#[test]
fn every_binary_format_reads_raw_samples() {
    for binary_format in ["INT_16", "UINT_16", "INT_32", "IEEE_FLOAT_32"] {
        for vectorized in [false, true] {
            let spec = BrainVisionSpec {
                binary_format,
                vectorized,
                ..BrainVisionSpec::default()
            };
            let reader = open(&spec);
            let raw_type = match binary_format {
                "INT_16" => RawType::I16,
                "IEEE_FLOAT_32" => RawType::F32,
                _ => RawType::I32,
            };
            assert_eq!(reader.info().raw_type, raw_type);
            assert_eq!(reader.info().sample_count, 600);
            let mut out = vec![0f32; 3 * 2];
            reader.read_raw_f32(&[1, 2], 597, 3, &mut out).unwrap();
            for (i, value) in out.iter().enumerate() {
                let want = brainvision_stored(&spec, 1 + i % 2, 597 + i / 2) as f32;
                assert_eq!(*value, want, "{binary_format} vectorized={vectorized}");
            }
        }
    }
}

#[test]
fn uint16_raw_type_is_i32() {
    let spec = BrainVisionSpec {
        binary_format: "UINT_16",
        ..BrainVisionSpec::default()
    };
    let mut files = brainvision_files(&spec);
    // Sample 3 of channel 1 sits at frame 3, slot 1 of 3 channels, 2 bytes each.
    files[1].1[(3 * 3 + 1) * 2..][..2].copy_from_slice(&60000u16.to_le_bytes());
    let reader = open_brainvision(&file_set(files), &vhdr(&spec)).unwrap();
    assert_eq!(reader.info().raw_type, RawType::I32);
    let mut out = [0f32];
    reader.read_raw_f32(&[1], 3, 1, &mut out).unwrap();
    assert_eq!(out, [60000.0]);
    assert_eq!(reader.read_rows(&[1], 3, 1).unwrap()[0][0], 60000.0 * 1e-7);
}

#[test]
fn latin1_micro_unit() {
    let spec = BrainVisionSpec {
        unit: vec![0xB5, b'V'],
        resolution: "1".into(),
        ..BrainVisionSpec::default()
    };
    let files = brainvision_files(&spec);
    assert!(std::str::from_utf8(&files[0].1).is_err());
    let reader = open_brainvision(&file_set(files), &vhdr(&spec)).unwrap();
    assert!(reader
        .info()
        .channels
        .iter()
        .all(|c| c.unit == "V" && c.gain == 1e-6));
}

#[test]
fn unit_factors() {
    // (header unit, SI unit, factor); an empty unit means microvolts, an unknown one is kept.
    for (unit, si, factor) in [
        ("", "V", 1e-6),
        ("uV", "V", 1e-6),
        ("\u{3bc}V", "V", 1e-6),
        ("nV", "V", 1e-9),
        ("mV", "V", 1e-3),
        ("V", "V", 1.0),
        ("C", "C", 1.0),
    ] {
        let spec = BrainVisionSpec {
            unit: unit.as_bytes().to_vec(),
            resolution: "1".into(),
            ..BrainVisionSpec::default()
        };
        let channel = open(&spec).info().channels[0].clone();
        assert_eq!(
            (channel.unit.as_str(), channel.gain),
            (si, factor),
            "unit {unit:?}"
        );
    }
}

#[test]
fn crlf_header() {
    let spec = BrainVisionSpec {
        markers: vec!["Stimulus,S  1,501,1,0".into()],
        ..BrainVisionSpec::default()
    };
    let lf = open(&spec);
    let crlf = open(&BrainVisionSpec { crlf: true, ..spec });
    let labels = |r: &dyn Reader| -> Vec<String> {
        r.info().channels.iter().map(|c| c.label.clone()).collect()
    };
    assert_eq!(labels(&*crlf), names(&["Fp1", "Fp2", "Cz"]));
    assert_eq!(labels(&*crlf), labels(&*lf));
    // A trailing \r would land on the last field of a Ch line, the unit.
    let units = |r: &dyn Reader| -> Vec<(String, f64)> {
        r.info()
            .channels
            .iter()
            .map(|c| (c.unit.clone(), c.gain))
            .collect()
    };
    assert_eq!(units(&*crlf), units(&*lf));
    assert_eq!(crlf.info().annotations, lf.info().annotations);
    assert_eq!(crlf.info().annotations.len(), 2);
    assert_eq!(crlf.info().sample_count, 600);
}

#[test]
fn markers_to_annotations() {
    let spec = BrainVisionSpec {
        markers: vec!["Stimulus,S  1,501,1,0".into(), "Comment,,1001,50,0".into()],
        ..BrainVisionSpec::default()
    };
    let reader = open(&spec);
    let annotation = |onset_s, duration_s, label: &str| Annotation {
        onset_s,
        duration_s,
        label: label.to_string(),
        source: "vmrk".to_string(),
    };
    let want = [
        annotation(0.0, 0.002, "New Segment"),
        annotation(1.0, 0.002, "S  1"),
        annotation(2.0, 0.1, "Comment"),
    ];
    assert_eq!(reader.info().annotations, want);
    assert!(reader.info().warnings.is_empty());
    assert_eq!(reader.scan_annotations().unwrap(), (want.to_vec(), vec![]));
}

#[test]
fn comma_escape_in_names() {
    let spec = BrainVisionSpec {
        labels: names(&["F\\1p1"]),
        markers: vec!["Comment,a\\1b,11,1,0".into()],
        ..BrainVisionSpec::default()
    };
    let reader = open(&spec);
    assert_eq!(reader.info().channels[0].label, "F,p1");
    assert_eq!(reader.info().annotations[1].label, "a,b");
}

#[test]
fn malformed_and_missing_markers_warn() {
    let spec = BrainVisionSpec {
        markers: vec![
            "Stimulus,S  1,soon,1,0".into(),
            "Stimulus,S  2,501,1,0".into(),
        ],
        ..BrainVisionSpec::default()
    };
    let info = open(&spec).info().clone();
    assert_eq!(info.annotations.len(), 2);
    assert_eq!(info.warnings, ["1 malformed marker entries, first Mk2"]);

    let files: Vec<_> = brainvision_files(&spec)
        .into_iter()
        .filter(|f| f.0 != "sub-01_ieeg.vmrk")
        .collect();
    let info = open_brainvision(&file_set(files), "sub-01_ieeg.vhdr")
        .unwrap()
        .info()
        .clone();
    assert!(info.annotations.is_empty());
    assert_eq!(info.input_files, ["sub-01_ieeg.vhdr", "sub-01_ieeg.eeg"]);
    assert_eq!(
        info.warnings,
        ["sub-01_ieeg.vhdr names sub-01_ieeg.vmrk, which is not among the opened files; its markers are not loaded."]
    );
}

#[test]
fn incomplete_frame_warning_text() {
    let spec = BrainVisionSpec {
        labels: names(&["a", "b", "c", "d"]),
        binary_format: "IEEE_FLOAT_32",
        tail_bytes: 3,
        ..BrainVisionSpec::default()
    };
    let info = open(&spec).info().clone();
    assert_eq!(info.sample_count, 600);
    assert_eq!(
        info.warnings,
        ["The data file sub-01_ieeg.eeg ends with 3 bytes of an incomplete sample frame of 16 bytes."]
    );
}

#[test]
fn datapoints_warning_text() {
    let spec = BrainVisionSpec {
        data_points: Some(1000),
        ..BrainVisionSpec::default()
    };
    assert_eq!(
        open(&spec).info().warnings,
        ["The header declares 1000 samples, but the data file sub-01_ieeg.eeg holds 600."]
    );
    // A declared count the file meets is not a warning.
    let spec = BrainVisionSpec {
        data_points: Some(600),
        ..BrainVisionSpec::default()
    };
    assert!(open(&spec).info().warnings.is_empty());
}

#[test]
fn truncated_vectorized_refused() {
    // 600 samples of 3 channels at 2 bytes each hold 3600 bytes.
    let vectorized = |tail_bytes, data_points| BrainVisionSpec {
        vectorized: true,
        tail_bytes,
        data_points,
        ..BrainVisionSpec::default()
    };
    let refused = |spec: BrainVisionSpec, bytes: usize| {
        let error = open_error(brainvision_files(&spec), &vhdr(&spec));
        assert!(
            error.contains(&format!(
                "truncated VECTORIZED BrainVision data: {bytes} bytes do not hold 3 complete channel blocks"
            )),
            "{error}"
        );
    };
    // Without DataPoints the size must divide into whole frames.
    refused(vectorized(3, None), 3603);
    // With DataPoints the size must be exactly channels * points * bytes, short or long.
    refused(vectorized(0, Some(1000)), 3600);
    refused(vectorized(0, Some(500)), 3600);
    let exact = open(&vectorized(0, Some(600)));
    assert_eq!(exact.info().sample_count, 600);
    assert!(exact.info().warnings.is_empty());
    // MULTIPLEXED keeps opening with the incomplete-frame warning.
    let multiplexed = BrainVisionSpec {
        tail_bytes: 3,
        ..BrainVisionSpec::default()
    };
    assert_eq!(open(&multiplexed).info().warnings.len(), 1);
}

#[test]
fn ascii_dataformat_refused() {
    let spec = BrainVisionSpec {
        ascii: true,
        ..BrainVisionSpec::default()
    };
    let error = open_error(brainvision_files(&spec), &vhdr(&spec));
    assert!(
        error.contains("BrainVision ASCII data is not supported yet"),
        "{error}"
    );
}

#[test]
fn missing_data_file_error() {
    let spec = BrainVisionSpec::default();
    let files = brainvision_files(&spec)
        .into_iter()
        .filter(|f| f.0 != "sub-01_ieeg.eeg")
        .collect();
    let error = open_error(files, &vhdr(&spec));
    assert!(
        error.contains(
            "sub-01_ieeg.vhdr names sub-01_ieeg.eeg, which is not among the opened files"
        ),
        "{error}"
    );
}

#[test]
fn header_errors_name_the_problem() {
    let files = brainvision_files(&BrainVisionSpec::default());
    let without = |key: &'static str| {
        edited(files.clone(), "sub-01_ieeg.vhdr", move |text| {
            text.lines()
                .filter(|line| !line.starts_with(key))
                .collect::<Vec<_>>()
                .join("\n")
        })
    };
    for key in [
        "DataOrientation",
        "NumberOfChannels",
        "SamplingInterval",
        "BinaryFormat",
        "Ch2",
    ] {
        let error = open_error(without(key), "sub-01_ieeg.vhdr");
        assert!(error.contains(&format!("has no {key}")), "{key}: {error}");
    }
    let vectorized_typo = edited(files.clone(), "sub-01_ieeg.vhdr", |t| {
        t.replace("MULTIPLEXED", "SIDEWAYS")
    });
    assert!(open_error(vectorized_typo, "sub-01_ieeg.vhdr").contains("DataOrientation 'SIDEWAYS'"));
    let bad_format = edited(files.clone(), "sub-01_ieeg.vhdr", |t| {
        t.replace("INT_16", "INT_8")
    });
    assert!(open_error(bad_format, "sub-01_ieeg.vhdr").contains("BinaryFormat 'INT_8'"));
    let zero_interval = edited(files, "sub-01_ieeg.vhdr", |t| {
        t.replace("SamplingInterval=2000", "SamplingInterval=0")
    });
    assert!(open_error(zero_interval, "sub-01_ieeg.vhdr").contains("'SamplingInterval'"));
    assert!(open_error(vec![], "absent.vhdr").contains("absent.vhdr"));
}

#[test]
fn invalid_reads_refused() {
    let reader = open(&BrainVisionSpec::default());
    let error = |r: dda_rs::Result<Vec<Vec<f64>>>| r.expect_err("read should fail").to_string();
    assert!(error(reader.read_rows(&[], 0, 1)).contains("no channels"));
    assert!(error(reader.read_rows(&[3], 0, 1)).contains("channel 3 is out of range"));
    assert!(error(reader.read_rows(&[0], 599, 2)).contains("pass the 600 rows"));
    assert!(error(reader.read_rows(&[0], 0, usize::MAX)).contains("pass the 600 rows"));
    assert!(reader.read_rows(&[0], 600, 0).unwrap().is_empty());
    let mut out = [0f32; 3];
    assert!(reader.read_raw_f32(&[0, 1], 0, 2, &mut out).is_err());
}

#[test]
fn read_spans_the_read_size_limit() {
    // 16-byte frames, so one 8 MiB read holds 524288 rows; the request straddles that row.
    for vectorized in [false, true] {
        let spec = BrainVisionSpec {
            labels: names(&["a", "b", "c", "d"]),
            binary_format: "INT_32",
            vectorized,
            samples: 530_000,
            ..BrainVisionSpec::default()
        };
        let rows = open(&spec).read_rows(&[3, 1], 524_280, 20).unwrap();
        for (i, row) in rows.iter().enumerate() {
            let (a, b) = (
                brainvision_stored(&spec, 3, 524_280 + i),
                brainvision_stored(&spec, 1, 524_280 + i),
            );
            assert_eq!(
                row[..],
                [a * 1e-7, b * 1e-7],
                "row {i} vectorized={vectorized}"
            );
        }
    }
}

#[test]
fn open_reads_no_samples() {
    let spec = BrainVisionSpec::default();
    let reads = Arc::new(AtomicUsize::new(0));
    let mut files = BTreeMap::new();
    for (name, bytes) in brainvision_files(&spec) {
        let source: Arc<dyn ByteSource> = if name.ends_with(".eeg") {
            Arc::new(CountingSource(MemorySource(bytes), reads.clone()))
        } else {
            Arc::new(MemorySource(bytes))
        };
        files.insert(name, source);
    }
    let set = FileSet {
        primary: vhdr(&spec),
        files,
    };
    let reader = open_brainvision(&set, &vhdr(&spec)).unwrap();
    assert_eq!(reads.load(Ordering::SeqCst), 0);
    reader.read_rows(&[0], 0, 1).unwrap();
    assert_eq!(reads.load(Ordering::SeqCst), 1);
}
