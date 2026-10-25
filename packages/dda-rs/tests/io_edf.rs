mod support;

use dda_rs::io::{open_edf, Annotation, ChannelKind, RawType, Reader};
use support::{counting_file_set, digital_value, edf_bytes, memory_file_set, EdfSpec};

fn open_bytes(bytes: Vec<u8>) -> Box<dyn Reader> {
    open_edf(&memory_file_set("rec.edf", bytes), "rec.edf").unwrap()
}

fn open(spec: &EdfSpec) -> Box<dyn Reader> {
    open_bytes(edf_bytes(spec))
}

fn open_error(bytes: Vec<u8>) -> String {
    open_edf(&memory_file_set("rec.edf", bytes), "rec.edf")
        .err()
        .expect("open should fail")
        .to_string()
}

fn names(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|s| s.to_string()).collect()
}

/// Replaces the first occurrence of `from` in `bytes` with `to`, which has the same length.
fn patch(bytes: &mut [u8], from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len());
    let at = bytes.windows(from.len()).position(|w| w == from).unwrap();
    bytes[at..at + to.len()].copy_from_slice(to);
}

/// Header offset of the "number of data records" field.
const RECORDS_FIELD: usize = 236;

#[test]
fn edf_header_fields() {
    let spec = EdfSpec {
        labels: names(&["Fp1", "Fp2", "Cz"]),
        units: names(&["uV", "uV", "uV"]),
        rates_per_record: vec![512; 3],
        record_duration_s: 2.0,
        records: 3,
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    let info = reader.info();
    assert_eq!(info.format, "EDF");
    assert_eq!(info.raw_type, RawType::I16);
    let labels: Vec<&str> = info.channels.iter().map(|c| c.label.as_str()).collect();
    assert_eq!(labels, ["Fp1", "Fp2", "Cz"]);
    assert!(info
        .channels
        .iter()
        .all(|c| c.kind == ChannelKind::Signal && c.unit == "V" && c.sample_rate_hz == 256.0));
    assert_eq!(info.sample_rate_hz, 256.0);
    assert_eq!(info.sample_count, 3 * 512);
    assert_eq!(info.duration_s, 6.0);
    assert!(info.annotations.is_empty() && info.warnings.is_empty());
    assert_eq!(info.input_files, ["rec.edf"]);
    assert_eq!(info.analysis_channels(), [0, 1, 2]);
}

#[test]
fn edf_physical_scaling_matches_formula() {
    let spec = EdfSpec {
        digital: (-2048, 2047),
        physical: (-500.0, 523.75),
        ..EdfSpec::default()
    };
    let (dmin, dmax, pmin, pmax) = (-2048.0, 2047.0, -500.0, 523.75);
    let d = digital_value(&spec, 1, 17) as f64;
    let want = ((d - dmin) * (pmax - pmin) / (dmax - dmin) + pmin) * 1e-6;
    let got = open(&spec).read_rows(&[1], 17, 1).unwrap()[0][0];
    assert!(
        (got - want).abs() <= want.abs() * f64::EPSILON,
        "{got} vs {want}"
    );
}

#[test]
fn edf_unit_prefixes_scale_to_volts() {
    // physical == digital makes the scale 1; the gain is the unit factor.
    let spec = EdfSpec {
        labels: names(&["a", "b", "c", "d", "e"]),
        units: names(&["uV", "mV", "nV", "V", "degC"]),
        rates_per_record: vec![4; 5],
        digital: (-2048, 2047),
        physical: (-2048.0, 2047.0),
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    let channels = &reader.info().channels;
    let units: Vec<&str> = channels.iter().map(|c| c.unit.as_str()).collect();
    assert_eq!(units, ["V", "V", "V", "V", "degC"]);
    let gains: Vec<f64> = channels.iter().map(|c| c.gain).collect();
    assert_eq!(gains, [1e-6, 1e-3, 1e-9, 1.0, 1.0]);
    assert!(channels.iter().all(|c| c.offset == 0.0));
}

#[test]
fn edf_micro_sign_units() {
    let spec = EdfSpec::default();
    let mut bytes = edf_bytes(&spec);
    // The dimension cells of the two signals follow the fixed header, the labels and the transducers.
    let dimensions = 256 + 2 * 16 + 2 * 80;
    bytes[dimensions..dimensions + 8].copy_from_slice(b"\xB5V      "); // Latin-1
    bytes[dimensions + 8..dimensions + 16].copy_from_slice(b"\xCE\xBCV     "); // UTF-8 Greek mu
    let reader = open_bytes(bytes);
    for channel in &reader.info().channels {
        // The 0.1 uV per count of the default spec.
        assert_eq!(channel.unit, "V");
        assert!((channel.gain - 1e-7).abs() < 1e-19, "{}", channel.gain);
    }
}

#[test]
fn bdf_24bit_negative_values() {
    let spec = EdfSpec {
        bdf: true,
        rates_per_record: vec![8, 8],
        records: 2,
        digital: (-8388608, 8388607),
        physical: (-8388608.0, 8388607.0),
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    assert_eq!(reader.info().format, "BDF");
    assert_eq!(reader.info().raw_type, RawType::I24);
    let mut raw = [0f32; 4];
    reader.read_raw_f32(&[0, 1], 0, 2, &mut raw).unwrap();
    assert_eq!(raw, [-8388608.0, -8388608.0, 8388607.0, 8388607.0]);
    let rows = reader.read_rows(&[0, 1], 0, 16).unwrap();
    for (row, values) in rows.iter().enumerate() {
        for (c, value) in values.iter().enumerate() {
            let digital = digital_value(&spec, c, row as u64);
            assert_eq!(*value, digital as f64 * 1e-6, "channel {c} row {row}");
        }
    }
}

#[test]
fn edf_plus_annotations_parsed() {
    let spec = EdfSpec {
        rates_per_record: vec![64, 64],
        record_duration_s: 4.0,
        records: 2,
        annotations: vec![(1.5, 2.0, "spike".into()), (3.0, 0.0, "marker".into())],
        ..EdfSpec::default()
    };
    let bytes = edf_bytes(&spec);
    let tals = b"+0\x14\x14\x00+1.5\x152\x14spike\x14\x00+3\x14marker\x14\x00";
    assert!(bytes.windows(tals.len()).any(|w| w == tals));

    let reader = open_bytes(bytes);
    let info = reader.info();
    assert_eq!(info.format, "EDF+");
    assert!(info.annotations.is_empty());
    let annotation = |onset_s, duration_s, label: &str| Annotation {
        onset_s,
        duration_s,
        label: label.into(),
        source: "EDF Annotations".into(),
    };
    let (annotations, warnings) = reader.scan_annotations().unwrap();
    assert_eq!(
        annotations,
        [
            annotation(1.5, 2.0, "spike"),
            annotation(3.0, 0.0, "marker")
        ]
    );
    assert!(warnings.is_empty());
    assert_eq!(info.channels.len(), 3);
    assert_eq!(info.channels[2].kind, ChannelKind::Annotation);
    assert_eq!(info.sample_rate_hz, 16.0);
}

#[test]
fn annotation_onsets_relative_to_first_record() {
    let spec = EdfSpec {
        annotations: vec![(1.0, 0.0, "marker".into())],
        first_onset_s: 0.25,
        ..EdfSpec::default()
    };
    let (annotations, warnings) = open(&spec).scan_annotations().unwrap();
    assert!(warnings.is_empty());
    assert_eq!(annotations.len(), 1);
    assert_eq!(annotations[0].onset_s, 0.75);
}

#[test]
fn annotation_only_edf_refused() {
    let spec = EdfSpec {
        labels: vec![],
        units: vec![],
        rates_per_record: vec![],
        record_duration_s: 0.0,
        annotations: vec![(0.0, 30.0, "Sleep stage W".into())],
        ..EdfSpec::default()
    };
    assert_eq!(
        open_error(edf_bytes(&spec)),
        "Unsupported file type: annotation-only EDF+ files (no signal channels) are not supported yet"
    );
}

#[test]
fn scan_counts_malformed_entries() {
    let spec = EdfSpec {
        rates_per_record: vec![64, 64],
        record_duration_s: 4.0,
        records: 2,
        annotations: vec![(1.5, 2.0, "spike".into()), (3.0, 0.0, "marker".into())],
        ..EdfSpec::default()
    };
    let mut bytes = edf_bytes(&spec);
    // Record 0: an onset that is not a number. Record 1: text where the timekeeping TAL belongs.
    patch(&mut bytes, b"+1.5\x15", b"+z.5\x15");
    patch(&mut bytes, b"+4\x14\x14\x00", b"+4\x14z\x14");
    let (annotations, warnings) = open_bytes(bytes).scan_annotations().unwrap();
    let labels: Vec<&str> = annotations.iter().map(|a| a.label.as_str()).collect();
    assert_eq!(labels, ["marker", "z"]);
    assert_eq!(
        warnings,
        ["2 malformed annotation entries, first in record 0"]
    );
}

#[test]
fn bdf_plus_annotations_parsed() {
    let spec = EdfSpec {
        bdf: true,
        annotations: vec![(2.5, 0.5, "blink".into())],
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    assert_eq!(reader.info().format, "BDF+");
    assert_eq!(reader.info().channels[2].label, "BDF Annotations");
    let (annotations, warnings) = reader.scan_annotations().unwrap();
    assert!(warnings.is_empty());
    assert_eq!(annotations.len(), 1);
    assert_eq!(
        (
            annotations[0].onset_s,
            annotations[0].duration_s,
            annotations[0].label.as_str()
        ),
        (2.5, 0.5, "blink")
    );
}

#[test]
fn edf_read_spans_records() {
    let spec = EdfSpec {
        records: 3,
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    let rows = reader.read_rows(&[0, 1], 250, 20).unwrap();
    let mut raw = vec![0f32; 40];
    reader.read_raw_f32(&[0, 1], 250, 20, &mut raw).unwrap();
    assert_eq!(rows.len(), 20);
    for (row, values) in rows.iter().enumerate() {
        for (c, value) in values.iter().enumerate() {
            let digital = digital_value(&spec, c, 250 + row as u64);
            assert_eq!(raw[row * 2 + c], digital as f32);
            let want = (digital as f64 + 32768.0) * (3276.7 + 3276.8) / 65535.0 - 3276.8;
            assert!((value - want * 1e-6).abs() < 1e-15, "channel {c} row {row}");
        }
    }
    let err = reader.read_rows(&[0], 700, 69).unwrap_err().to_string();
    assert!(err.contains("768"), "{err}");
    assert!(reader.read_rows(&[0], 700, 68).is_ok());
}

#[test]
fn edf_truncated_last_record_warns() {
    let spec = EdfSpec::default();
    let header = 256 * 3;
    let record_bytes = 2 * 512;
    let mut bytes = edf_bytes(&spec);
    bytes.truncate(header + 3 * record_bytes + 100);
    let reader = open_bytes(bytes);
    assert_eq!(
        reader.info().warnings,
        ["The header declares 4 data records, but the file holds 3 complete records and 100 extra bytes."]
    );
    assert_eq!(reader.info().sample_count, 3 * 256);
    assert_eq!(reader.info().duration_s, 3.0);
    assert!(reader.read_rows(&[0], 767, 1).is_ok());
    assert!(reader.read_rows(&[0], 768, 1).is_err());
}

#[test]
fn edf_unknown_record_count_warns() {
    let mut bytes = edf_bytes(&EdfSpec::default());
    bytes[RECORDS_FIELD..RECORDS_FIELD + 8].copy_from_slice(b"-1      ");
    let reader = open_bytes(bytes);
    assert_eq!(
        reader.info().warnings,
        ["The header declares -1 data records, but the file holds 4 complete records and 0 extra bytes."]
    );
    assert_eq!(reader.info().sample_count, 4 * 256);
}

#[test]
fn edf_plus_d_gap_refused() {
    let spec = EdfSpec {
        plus_d: true,
        ..EdfSpec::default()
    };
    let bytes = edf_bytes(&spec);
    assert_eq!(open_bytes(bytes.clone()).info().format, "EDF+");
    // Records 2 and 3 start at 4 s and 5 s instead of 2 s and 3 s: a 2 s gap after record 1.
    let mut gapped = bytes;
    patch(&mut gapped, b"+2\x14\x14\x00", b"+4\x14\x14\x00");
    patch(&mut gapped, b"+3\x14\x14\x00", b"+5\x14\x14\x00");
    assert_eq!(
        open_error(gapped),
        "Unsupported file type: discontinuous EDF+D recording: gap of 2 s after record 1"
    );
}

#[test]
fn mixed_rate_read_refused() {
    let spec = EdfSpec {
        labels: names(&["A", "B", "C"]),
        units: names(&["uV", "uV", "uV"]),
        rates_per_record: vec![256, 256, 128],
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    assert_eq!(reader.info().sample_rate_hz, 256.0);
    assert_eq!(reader.info().channels[2].sample_rate_hz, 128.0);
    let message = "channels A, C use 256 Hz and B use 128 Hz; choose channels of one rate";
    let err = reader.read_rows(&[0, 2, 1], 0, 4).unwrap_err().to_string();
    assert!(err.contains("128 Hz") && err.contains("256 Hz"), "{err}");
    let spec = EdfSpec {
        rates_per_record: vec![256, 128, 256],
        ..spec
    };
    let reader = open(&spec);
    assert!(reader
        .read_rows(&[0, 1, 2], 0, 4)
        .unwrap_err()
        .to_string()
        .ends_with(message));
    assert!(reader.read_raw_f32(&[0, 1], 0, 1, &mut [0.0; 2]).is_err());
    assert_eq!(reader.read_rows(&[1], 0, 128 * 4).unwrap().len(), 512);
}

#[test]
fn status_channel_kind() {
    let spec = EdfSpec {
        bdf: true,
        labels: names(&["Fp1", "Status"]),
        units: names(&["uV", ""]),
        digital: (-8388608, 8388607),
        physical: (-262144.0, 262143.0),
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    let channels = &reader.info().channels;
    assert_eq!(
        (channels[0].kind, channels[1].kind),
        (ChannelKind::Signal, ChannelKind::Status)
    );
    assert_eq!((channels[1].gain, channels[1].offset), (1.0, 0.0));
    assert!(reader.read_rows(&[1], 0, 1).is_err());
    assert_eq!(reader.info().analysis_channels(), [0]);
}

#[test]
fn analysis_channels_skip_annotation_and_other_rate() {
    let spec = EdfSpec {
        labels: names(&["A", "B", "C", "D"]),
        units: names(&["uV"; 4]),
        rates_per_record: vec![256, 256, 128, 256],
        annotations: vec![(0.5, 0.0, "x".into())],
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    assert_eq!(reader.info().channels.len(), 5);
    assert_eq!(reader.info().analysis_channels(), [0, 1, 3]);
}

#[test]
fn dominant_rate_prefers_the_higher_rate_on_a_tie() {
    let spec = EdfSpec {
        rates_per_record: vec![128, 256],
        ..EdfSpec::default()
    };
    assert_eq!(open(&spec).info().sample_rate_hz, 256.0);
}

#[test]
fn read_raw_f32_is_digital() {
    let spec = EdfSpec::default();
    let reader = open(&spec);
    let mut out = vec![0f32; 20];
    reader.read_raw_f32(&[1, 0], 5, 10, &mut out).unwrap();
    for row in 0..10 {
        assert_eq!(out[row * 2], digital_value(&spec, 1, 5 + row as u64) as f32);
        assert_eq!(
            out[row * 2 + 1],
            digital_value(&spec, 0, 5 + row as u64) as f32
        );
    }
    assert!(reader.read_raw_f32(&[0], 0, 10, &mut [0.0; 9]).is_err());
}

#[test]
fn malformed_headers_are_named() {
    let bytes = edf_bytes(&EdfSpec::default());
    let mut bad = bytes.clone();
    bad[252..256].copy_from_slice(b"two ");
    assert!(open_error(bad).contains("number of signals"));
    let mut bad = bytes.clone();
    bad[256 + 16 * 2 + 80 * 2 + 8 * 2..][..8].copy_from_slice(b"lots    ");
    assert!(open_error(bad).contains("signal 0 (Fp1) physical minimum"));
    assert!(open_error(vec![b'x'; 1000]).contains("version"));
    assert!(open_error(bytes[..100].to_vec()).contains("256-byte"));
}

#[test]
fn edf_read_spans_read_chunks() {
    // 10 records of 1 MiB: a read of more than 8 MiB takes two reads, split at record 8.
    let samples = 1 << 19;
    let spec = EdfSpec {
        labels: names(&["Fp1"]),
        units: names(&["uV"]),
        rates_per_record: vec![samples],
        records: 10,
        ..EdfSpec::default()
    };
    let reader = open(&spec);
    let row0 = 5;
    let rows = 9 * samples + 100;
    let mut out = vec![0f32; rows];
    reader.read_raw_f32(&[0], row0, rows, &mut out).unwrap();
    for row in [
        0,
        1,
        8 * samples - 6,
        8 * samples - 5,
        8 * samples + 17,
        rows - 1,
    ] {
        assert_eq!(
            out[row],
            digital_value(&spec, 0, row0 + row as u64) as f32,
            "row {row}"
        );
    }
    let want: f64 = (0..rows as u64)
        .map(|row| digital_value(&spec, 0, row0 + row) as f64)
        .sum();
    assert_eq!(out.iter().map(|&v| v as f64).sum::<f64>(), want);
}

#[test]
fn open_reads_do_not_grow_with_records() {
    let reads = |records, plus_d| {
        let spec = EdfSpec {
            records,
            plus_d,
            annotations: vec![(0.5, 0.0, "x".into())],
            ..EdfSpec::default()
        };
        let (files, reads) = counting_file_set("rec.edf", edf_bytes(&spec));
        open_edf(&files, "rec.edf").unwrap();
        reads.load(std::sync::atomic::Ordering::SeqCst)
    };
    for plus_d in [false, true] {
        assert_eq!(reads(10, plus_d), reads(1000, plus_d));
    }
}
