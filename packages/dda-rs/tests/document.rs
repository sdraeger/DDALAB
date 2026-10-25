use std::collections::{BTreeMap, BTreeSet};

use dda_rs::blocks::{merge_blocks, plan_blocks, run_block};
use dda_rs::document::{
    build_document, build_manifest, bundle_layout, encode_block, npy_header, window_centers,
    BundleWriter,
};
use dda_rs::io::{ChannelInfo, ChannelKind, RawType, Reader, RecordingInfo};
use dda_rs::{
    run_request_on_matrix, AlgorithmSelection, DDARequest, DDAResult, DelayParameters,
    ModelParameters, PreprocessingOptions, Result, TimeRange, VariantResult, WindowParameters,
};
use serde_json::Value;

const ROWS: usize = 800;
const WINDOW_LENGTH: u32 = 50;
const STEP: u32 = 10;
/// `WINDOW_LENGTH + max(delays) + 2*dm`.
const MARKER: usize = WINDOW_LENGTH as usize + 10 + 2 * 4;

/// Signals A to D at recording indices 0, 2, 3, 4 and a status channel at index 1, so analysis
/// channel `i` is not recording channel `i`.
struct Recording {
    info: RecordingInfo,
    rows: Vec<Vec<f64>>,
}

impl Recording {
    fn new(rate: f64, rows: usize) -> Self {
        let channel = |label: &str, kind| ChannelInfo {
            label: label.into(),
            unit: "V".into(),
            sample_rate_hz: rate,
            gain: 1.0,
            offset: 0.0,
            kind,
            bids_status: None,
            bids_type: None,
        };
        let mut state = 0x5EED_0010_u64;
        let mut noise = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64 - 0.5
        };
        let rows = (0..rows)
            .map(|t| {
                let signal: Vec<f64> = (0..4)
                    .map(|c| (t as f64 * 0.05 * (c + 1) as f64).sin() + 0.3 * noise())
                    .collect();
                vec![signal[0], t as f64, signal[1], signal[2], signal[3]]
            })
            .collect::<Vec<_>>();
        let channels = vec![
            channel("A", ChannelKind::Signal),
            channel("status", ChannelKind::Status),
            channel("B", ChannelKind::Signal),
            channel("C", ChannelKind::Signal),
            channel("D", ChannelKind::Signal),
        ];
        let info = RecordingInfo {
            format: "test".into(),
            channels,
            sample_rate_hz: rate,
            sample_count: rows.len() as u64,
            duration_s: rows.len() as f64 / rate,
            raw_type: RawType::F64,
            annotations: vec![],
            warnings: vec![],
            input_files: vec![],
        };
        Recording { info, rows }
    }

    /// The analysis channels' rows, as the engine receives them.
    fn matrix(&self) -> Vec<Vec<f64>> {
        let channels = self.info.analysis_channels();
        self.read_rows(&channels, 0, self.rows.len()).unwrap()
    }
}

impl Reader for Recording {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        let row0 = row0 as usize;
        Ok(self.rows[row0..row0 + rows]
            .iter()
            .map(|row| channels.iter().map(|&c| row[c]).collect())
            .collect())
    }

    fn read_raw_f32(&self, _: &[usize], _: u64, _: usize, _: &mut [f32]) -> Result<()> {
        unimplemented!()
    }
}

fn request(variants: &[&str]) -> DDARequest {
    DDARequest {
        file_path: "/data/rec.edf".into(),
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
            enabled_variants: variants.iter().map(|v| v.to_string()).collect(),
            select_mask: None,
        },
        window_parameters: WindowParameters {
            window_length: WINDOW_LENGTH,
            window_step: STEP,
            ct_window_length: None,
            ct_window_step: None,
        },
        delay_parameters: DelayParameters {
            delays: vec![7, 10],
        },
        ct_channel_pairs: None,
        cd_channel_pairs: None,
        model_parameters: Some(ModelParameters {
            dm: 4,
            order: 4,
            nr_tau: 2,
        }),
        model_terms: Some(vec![1, 2, 10]),
        variant_configs: None,
        sampling_rate: None,
    }
}

fn windows(request: &DDARequest, rows: usize) -> usize {
    let (wl, step) = (
        request.window_parameters.window_length as usize,
        request.window_parameters.window_step as usize,
    );
    1 + (rows - (wl + 10 + 8 - 1)) / step
}

fn sha() -> BTreeMap<String, String> {
    BTreeMap::from([("rec.edf".to_string(), "00".repeat(32))])
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-12
}

#[test]
fn window_centers_formula() {
    let mut request = request(&["ST"]);
    request.time_range = TimeRange {
        start: 30_000.0,
        end: 150_000.0,
    };
    request.window_parameters = WindowParameters {
        window_length: 1000,
        window_step: 200,
        ct_window_length: None,
        ct_window_step: None,
    };
    let info = Recording::new(1000.0, 200_000).info;
    let centers = window_centers(&info, &request, 3);
    for (i, center) in centers.iter().enumerate() {
        let expected = 30.0 + (4.0 + 10.0 + 500.0) / 1000.0 + i as f64 * 0.2;
        assert!(
            close(*center, expected),
            "window {i}: {center} vs {expected}"
        );
    }
    assert_eq!(centers.len(), 3);
}

#[test]
fn row_labels_for_pairs() {
    let recording = Recording::new(100.0, ROWS);
    let mut request = request(&["ST", "CT", "CD"]);
    request.ct_channel_pairs = Some(vec![[0, 2]]);
    request.cd_channel_pairs = Some(vec![[2, 0]]);
    let w = windows(&request, ROWS);
    let layout = bundle_layout(&request, &recording.info, w).unwrap();
    let manifest = build_manifest(
        &recording.info,
        &request,
        &layout,
        w,
        sha(),
        "id".into(),
        "t".into(),
    );
    let labels: Vec<(&str, Vec<&str>)> = manifest
        .variants
        .iter()
        .map(|v| {
            (
                v.id.as_str(),
                v.row_labels.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(
        labels,
        [
            ("ST", vec!["A", "B", "C", "D"]),
            ("CT", vec!["A & C"]),
            ("CD", vec!["C <- A"]),
        ]
    );
    let reproduction = &manifest.reproduction;
    assert_eq!(reproduction.variant_pair_indices["CT"], [[0, 2]]);
    assert_eq!(reproduction.variant_pair_indices["CD"], [[2, 0]]);
    assert_eq!(reproduction.variant_pair_names["CD"], ["C <- A"]);
    assert_eq!(
        reproduction.variant_channel_names["ST"],
        ["A", "B", "C", "D"]
    );
}

/// The key paths of `value`; arrays contribute their elements' paths under `[]`, and the maps
/// whose keys are data (variant ids, file names) are leaves.
fn key_paths(value: &Value, path: &str, out: &mut BTreeSet<String>) {
    const DATA_KEYED: [&str; 5] = [
        "variant_channel_indices",
        "variant_channel_names",
        "variant_pair_indices",
        "variant_pair_names",
        "input_sha256",
    ];
    match value {
        Value::Object(map) if !DATA_KEYED.iter().any(|key| path.ends_with(key)) => {
            for (key, value) in map {
                let path = format!("{path}.{key}");
                out.insert(path.clone());
                key_paths(value, &path, out);
            }
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| key_paths(item, &format!("{path}[]"), out)),
        _ => {}
    }
}

#[test]
fn document_matches_reference_keys() {
    let reference: Value =
        serde_json::from_str(include_str!("fixtures/result_reference.json")).unwrap();
    let mut expected = BTreeSet::new();
    key_paths(&reference, "", &mut expected);
    for removed in [
        ".file_path",
        ".engine_label",
        ".is_fallback",
        ".variants[].summary",
        ".variants[].network_motifs",
        ".variants[].column_count",
    ] {
        assert!(
            expected.remove(removed),
            "{removed} is not in the reference"
        );
    }
    expected.extend(
        [
            ".schema",
            ".reproduction.engine_version",
            ".reproduction.git_commit",
        ]
        .map(String::from),
    );

    let recording = Recording::new(100.0, ROWS);
    let request = request(&["ST"]);
    let result = run_request_on_matrix(&request, &recording.matrix(), None).unwrap();
    let document = build_document(
        &result,
        &recording.info,
        &request,
        sha(),
        "id".into(),
        "2026-10-24T00:00:00+00:00".into(),
    );
    let mut actual = BTreeSet::new();
    key_paths(&serde_json::to_value(&document).unwrap(), "", &mut actual);
    assert_eq!(actual, expected);
    assert_eq!(document.schema, "ddalab.result/2");
    assert_eq!(
        document.reproduction.ddalab_version,
        document.reproduction.engine_version
    );
    assert_eq!(document.file_name, "rec.edf");
}

#[test]
fn summaries_use_finite_values_only() {
    let recording = Recording::new(100.0, ROWS);
    let mut request = request(&["ST"]);
    request.channels = Some(vec![0, 1]);
    let (nan, inf) = (f64::NAN, f64::INFINITY);
    let mut result = DDAResult::new(
        "id".into(),
        "f".into(),
        vec![],
        vec![],
        request.window_parameters.clone(),
        DelayParameters {
            delays: vec![7, 10],
        },
    );
    result.variant_results = Some(vec![VariantResult {
        variant_id: "ST".into(),
        variant_name: "Single Timeseries (ST)".into(),
        q_matrix: vec![vec![1.0, nan, -3.0, inf], vec![nan, nan, nan, nan]],
        coefficient_matrices: None,
        fit_error_matrix: None,
        channel_labels: None,
        error_values: None,
    }]);
    let document = build_document(
        &result,
        &recording.info,
        &request,
        sha(),
        "id".into(),
        "t".into(),
    );
    let variant = &document.variants[0];
    assert_eq!(variant.row_labels, ["A", "B"]);
    assert_eq!(
        (variant.min_value, variant.max_value),
        (Some(-3.0), Some(1.0))
    );
    assert_eq!(variant.row_mean_absolute, Some(vec![2.0, 0.0]));
    assert_eq!(variant.row_peak_absolute, Some(vec![3.0, 0.0]));
    assert_eq!(document.window_centers_seconds.len(), 4);
}

#[test]
fn layout_matches_engine_variants() {
    // Short, so the slow CCD variants stay quick in debug builds.
    let rows = 300;
    let recording = Recording::new(100.0, rows);
    let matrix = recording.matrix();
    let mut ct = request(&["CT"]);
    ct.ct_channel_pairs = Some(vec![[0, 1], [2, 3]]);
    let mut cd = request(&["CD"]);
    cd.cd_channel_pairs = Some(vec![[1, 0], [3, 2]]);
    let mut sy_directed = request(&["SY"]);
    sy_directed.algorithm_selection.select_mask = Some("0 0 0 0 0 2".into());
    let cases = [
        request(&["ST"]),
        ct,
        cd,
        request(&["DE"]),
        request(&["SY"]),
        sy_directed,
        request(&["ST", "CD", "DE", "SY"]),
        request(&[
            "CCD", "CCDLOG", "CCDPR2", "CCDSIG", "CCDSTAB", "TRCCD", "MVCCD",
        ]),
    ];
    for request in cases {
        let result = run_request_on_matrix(&request, &matrix, None).unwrap();
        let w = windows(&request, rows);
        let layout = bundle_layout(&request, &recording.info, w).unwrap();
        let manifest = build_manifest(
            &recording.info,
            &request,
            &layout,
            w,
            sha(),
            "id".into(),
            "t".into(),
        );
        let engine: Vec<_> = result.variant_results.iter().flatten().collect();
        let name = format!("{:?}", request.algorithm_selection.enabled_variants);
        assert_eq!(manifest.variants.len(), engine.len(), "{name}");
        for (document, variant) in manifest.variants.iter().zip(engine) {
            assert_eq!(document.id, variant.variant_id, "{name}");
            assert_eq!(document.label, variant.variant_name, "{name}");
            assert_eq!(document.row_labels.len(), variant.q_matrix.len(), "{name}");
            let shape = |file: &str| {
                let path = format!("{}/{file}", variant.variant_id);
                layout
                    .arrays
                    .iter()
                    .find(|a| a.path == path)
                    .map(|a| a.shape.clone())
            };
            let rows = variant.q_matrix.len();
            assert_eq!(shape("q.npy"), Some(vec![w, rows]), "{name}");
            let coefficients = variant.coefficient_matrices.as_ref();
            assert_eq!(
                shape("coefficients.npy"),
                coefficients.map(|c| vec![w, rows, c.len()]),
                "{name}"
            );
            assert_eq!(
                shape("fit_error.npy"),
                variant.fit_error_matrix.as_ref().map(|_| vec![w, rows]),
                "{name}"
            );
        }
    }
}

fn read_f64s(path: &std::path::Path, header: &[u8]) -> Vec<f64> {
    let bytes = std::fs::read(path).unwrap();
    assert_eq!(&bytes[..header.len()], header, "{path:?} header");
    bytes[header.len()..]
        .chunks_exact(8)
        .map(|b| f64::from_le_bytes(b.try_into().unwrap()))
        .collect()
}

fn assert_bits(what: &str, actual: &[f64], expected: &[f64]) {
    assert_eq!(actual.len(), expected.len(), "{what} length");
    if let Some(i) = (0..actual.len()).find(|&i| actual[i].to_bits() != expected[i].to_bits()) {
        panic!(
            "{what}: first difference at {i}: {} vs {}",
            actual[i], expected[i]
        );
    }
}

#[test]
fn bundle_bytes_equal_merged_result() {
    let recording = Recording::new(100.0, ROWS);
    let mut request = request(&["ST", "CT", "CD"]);
    request.ct_channel_pairs = Some(vec![[0, 1], [2, 3]]);
    request.cd_channel_pairs = Some(vec![[1, 0], [3, 2], [2, 0]]);
    let w = windows(&request, ROWS);
    let per_block = w.div_ceil(3);
    let budget = ((per_block - 1) * STEP as usize + MARKER) * 4 * 8;
    let blocks = plan_blocks(&request, ROWS as u64, 4, budget).unwrap();
    assert_eq!(blocks.len(), 3);

    let layout = bundle_layout(&request, &recording.info, w).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut writer = BundleWriter::create(dir.path(), &layout).unwrap();
    let mut parts = Vec::new();
    for block in &blocks {
        let part = run_block(&recording, &request, block, None).unwrap();
        writer.write(encode_block(&layout, block, &part)).unwrap();
        parts.push(part);
    }
    let manifest = build_manifest(
        &recording.info,
        &request,
        &layout,
        w,
        sha(),
        "id".into(),
        "t".into(),
    );
    writer.finish(&manifest).unwrap();
    let merged = merge_blocks(parts).unwrap();

    let mut checked = 0;
    for variant in merged.variant_results.as_ref().unwrap() {
        let read = |file: &str| {
            let path = format!("{}/{file}", variant.variant_id);
            let spec = layout.arrays.iter().find(|a| a.path == path).unwrap();
            read_f64s(&dir.path().join(&path), &spec.header)
        };
        // (W, R) from [row][window].
        let window_major = |matrix: &Vec<Vec<f64>>| -> Vec<f64> {
            (0..w)
                .flat_map(|t| matrix.iter().map(move |row| row[t]))
                .collect()
        };
        assert_bits(
            &format!("{} q", variant.variant_id),
            &read("q.npy"),
            &window_major(&variant.q_matrix),
        );
        checked += 1;
        if let Some(coefficients) = &variant.coefficient_matrices {
            // (W, R, K) from [coefficient][row][window].
            let expected: Vec<f64> = (0..w)
                .flat_map(|t| {
                    (0..variant.q_matrix.len())
                        .flat_map(move |r| coefficients.iter().map(move |c| c[r][t]))
                })
                .collect();
            assert_bits(
                &format!("{} coefficients", variant.variant_id),
                &read("coefficients.npy"),
                &expected,
            );
            let errors = variant.fit_error_matrix.as_ref().unwrap();
            assert_bits(
                &format!("{} fit_error", variant.variant_id),
                &read("fit_error.npy"),
                &window_major(errors),
            );
            checked += 2;
        }
    }
    assert_eq!(checked, layout.arrays.len());

    let written: Value =
        serde_json::from_slice(&std::fs::read(dir.path().join("manifest.json")).unwrap()).unwrap();
    assert_eq!(written["schema"], "ddalab.result/2");
    assert_eq!(
        written["variants"][0]["arrays"],
        serde_json::json!(["ST/q.npy", "ST/coefficients.npy", "ST/fit_error.npy"])
    );
    assert_eq!(written["variants"][0]["matrix"], serde_json::json!([]));
    assert_eq!(
        written["window_centers_seconds"].as_array().unwrap().len(),
        w
    );
}

#[test]
fn writer_refuses_chunks_outside_the_array() {
    let recording = Recording::new(100.0, ROWS);
    let request = request(&["ST"]);
    let layout = bundle_layout(&request, &recording.info, 2).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut writer = BundleWriter::create(dir.path(), &layout).unwrap();
    let end = (layout.arrays[0].header.len() + 2 * 4 * 8) as u64;
    assert!(writer.write(vec![(0, end - 8, vec![0; 8])]).is_ok());
    assert!(writer.write(vec![(0, end - 7, vec![0; 8])]).is_err());
    assert!(writer
        .write(vec![(layout.arrays.len(), 0, vec![0; 8])])
        .is_err());
}

#[test]
fn npy_header_alignment() {
    for shape in [
        &[][..],
        &[1],
        &[3, 5],
        &[595, 84, 3],
        &[10_000_000, 1_000, 5],
    ] {
        let header = npy_header(shape);
        assert_eq!(header.len() % 64, 0, "{shape:?}");
        assert_eq!(header.last(), Some(&b'\n'), "{shape:?}");
        assert_eq!(&header[..8], b"\x93NUMPY\x01\x00");
    }
}
