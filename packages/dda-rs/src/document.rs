//! Result documents and `.npy` bundles.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::Serialize;

use crate::blocks::Block;
use crate::engine::dataset::AnalysisBounds;
use crate::engine::model::ModelSpec;
use crate::engine::variant_config::{
    labels_for_channels, labels_for_groups, resolve_ccd_pairs, resolve_cd_pairs, resolve_ct_groups,
    resolve_de_groups, resolve_sy_pairs, resolve_variant_selected_channels, VariantMode,
};
use crate::error::Result;
use crate::io::RecordingInfo;
use crate::types::{
    DDARequest, DDAResult, DEFAULT_DELAYS, DEFAULT_MODEL_DIMENSION, DEFAULT_MODEL_TERMS,
    DEFAULT_NUM_TAU, DEFAULT_POLYNOMIAL_ORDER,
};

const SCHEMA: &str = "ddalab.result/2";

/// A result as JSON: the matrices inline for `build_document`, listed in `arrays` for `build_manifest`.
#[derive(Debug, Clone, Serialize)]
pub struct ResultDocument {
    pub schema: String,
    pub id: String,
    pub file_name: String,
    pub created_at_iso: String,
    pub diagnostics: Vec<String>,
    pub window_centers_seconds: Vec<f64>,
    pub variants: Vec<VariantDocument>,
    pub reproduction: Reproduction,
}

/// One variant. Non-finite matrix values serialize as `null`.
#[derive(Debug, Clone, Serialize)]
pub struct VariantDocument {
    pub id: String,
    pub label: String,
    pub row_labels: Vec<String>,
    /// `[row][window]`.
    pub matrix: Vec<Vec<f64>>,
    /// Over the finite values of `matrix`; `None` when it has none.
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    /// Per row, over its finite values: the mean of `|x|` (0 without any) and the largest `|x|`.
    pub row_mean_absolute: Option<Vec<f64>>,
    pub row_peak_absolute: Option<Vec<f64>>,
    /// `[coefficient][row][window]`, as the engine fills it.
    pub coefficient_matrices: Option<Vec<Vec<Vec<f64>>>>,
    /// `[row][window]`.
    pub fit_error_matrix: Option<Vec<Vec<f64>>>,
    /// The bundle files holding this variant's arrays.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrays: Option<Vec<String>>,
}

/// What was run, enough to run it again. Channel indices count the analysis channels, as in the request.
#[derive(Debug, Clone, Serialize)]
pub struct Reproduction {
    pub expert_mode: bool,
    /// "cpu"; the request does not say. A caller that ran elsewhere sets it.
    pub compute_device: String,
    pub variant_ids: Vec<String>,
    pub selected_channel_indices: Vec<usize>,
    pub selected_channel_names: Vec<String>,
    pub variant_channel_indices: BTreeMap<String, Vec<usize>>,
    pub variant_channel_names: BTreeMap<String, Vec<String>>,
    /// For the variants whose rows are all channel pairs; the names are the row labels.
    pub variant_pair_indices: BTreeMap<String, Vec<[usize; 2]>>,
    pub variant_pair_names: BTreeMap<String, Vec<String>>,
    pub window_length_samples: u32,
    pub window_step_samples: u32,
    pub delays: Vec<i32>,
    pub model_terms: Vec<i32>,
    pub model_dimension: u32,
    pub polynomial_order: u32,
    pub nr_tau: u32,
    pub start_time_seconds: f64,
    /// The request's end sample over the sample rate; the recording's last sample when the request has no end.
    pub end_time_seconds: f64,
    pub ddalab_version: String,
    pub input_sha256: BTreeMap<String, String>,
    pub engine_version: String,
    pub git_commit: Option<String>,
    /// The request as run, which the fields above summarize in the Python keys.
    #[serde(serialize_with = "sorted_keys")]
    pub request: DDARequest,
}

/// Serializes through `serde_json::Value`, whose maps sort their keys (serde_json without `preserve_order`):
/// the request's `variant_configs` HashMap would otherwise follow its random iteration order.
fn sorted_keys<S: serde::Serializer>(
    request: &DDARequest,
    serializer: S,
) -> std::result::Result<S::Ok, S::Error> {
    let value = serde_json::to_value(request).map_err(serde::ser::Error::custom)?;
    value.serialize(serializer)
}

/// A variant the engine returns for a request, in the engine's order.
struct Plan {
    id: &'static str,
    name: &'static str,
    /// The analysis channels of each row: one for ST, a group for CT and DE, `[target, source]` for the rest.
    rows: Vec<Vec<usize>>,
    joiner: &'static str,
}

impl Plan {
    fn row_labels(&self, labels: &[String]) -> Vec<String> {
        labels_for_groups(labels, &self.rows, self.joiner)
    }
}

fn analysis_labels(info: &RecordingInfo) -> Vec<String> {
    let channels = info.analysis_channels();
    channels
        .iter()
        .map(|&c| info.channels[c].label.clone())
        .collect()
}

/// The variants the engine returns for `request` on `info`'s analysis channels.
fn plan(request: &DDARequest, info: &RecordingInfo) -> Vec<Plan> {
    let n = info.analysis_channels().len();
    let mode = VariantMode::from_request(request);
    let rows = |pairs: Vec<[usize; 2]>| -> Vec<Vec<usize>> {
        pairs.iter().map(|pair| pair.to_vec()).collect()
    };
    let st = resolve_variant_selected_channels(request, n, &["ST", "st", "single_timeseries"]);
    let de = resolve_variant_selected_channels(request, n, &["DE", "de", "dynamical_ergodicity"]);
    let sy = resolve_variant_selected_channels(request, n, &["SY", "sy", "synchronization"]);
    let sy = resolve_sy_pairs(&sy);
    let (sy_rows, sy_joiner) = if mode.sy_mode == 2 {
        let both = sy.iter().flat_map(|&[a, b]| [[a, b], [b, a]]);
        (rows(both.collect()), " -> ")
    } else {
        (rows(sy), " <-> ")
    };
    let ccd = rows(resolve_ccd_pairs(request, n));
    let ccd_family = [
        (
            mode.ccd_enabled,
            "CCD",
            "Conditional Cross-Dynamical legacy RMSE gain (CCD)",
        ),
        (
            mode.ccdlog_enabled,
            "CCDLOG",
            "Conditional Cross-Dynamical log-MSE ratio (CCDLOG)",
        ),
        (
            mode.ccdpr2_enabled,
            "CCDPR2",
            "Conditional Cross-Dynamical partial R2 (CCDPR2)",
        ),
        (
            mode.ccdsig_enabled,
            "CCDSIG",
            "Conditional Cross-Dynamical Significance (CCDSIG)",
        ),
        (
            mode.ccdstab_enabled,
            "CCDSTAB",
            "Conditional Cross-Dynamical Stability (CCDSTAB)",
        ),
        (
            mode.trccd_enabled,
            "TRCCD",
            "Temporally Regularized Conditional Cross-Dynamical (TRCCD)",
        ),
        (
            mode.mvccd_enabled,
            "MVCCD",
            "Sparse Multivariate Conditional Cross-Dynamical (MVCCD)",
        ),
    ]
    .map(|(on, id, name)| (on && !ccd.is_empty(), id, name, ccd.clone(), " <- "));
    let before = [
        (
            mode.st_enabled,
            "ST",
            "Single Timeseries (ST)",
            st.iter().map(|&c| vec![c]).collect(),
            "",
        ),
        (
            mode.ct_enabled,
            "CT",
            "Cross-Timeseries (CT)",
            resolve_ct_groups(request, n),
            " & ",
        ),
        (
            mode.cd_enabled,
            "CD",
            "Cross-Dynamical (CD)",
            rows(resolve_cd_pairs(request, n)),
            " <- ",
        ),
    ];
    let after = [
        (
            mode.de_enabled,
            "DE",
            "Dynamical Ergodicity (DE)",
            resolve_de_groups(request, n, &de),
            " & ",
        ),
        (
            mode.sy_mode > 0 && !sy_rows.is_empty(),
            "SY",
            "Synchronization (SY)",
            sy_rows,
            sy_joiner,
        ),
    ];
    before
        .into_iter()
        .chain(ccd_family)
        .chain(after)
        .filter(|entry| entry.0)
        .map(|(_, id, name, rows, joiner)| Plan {
            id,
            name,
            rows,
            joiner,
        })
        .collect()
}

/// (dm, order, nr_tau) of the request's model.
fn model_shape(request: &DDARequest) -> (u32, u32, u32) {
    request.model_parameters.as_ref().map_or(
        (
            DEFAULT_MODEL_DIMENSION,
            DEFAULT_POLYNOMIAL_ORDER,
            DEFAULT_NUM_TAU,
        ),
        |m| (m.dm, m.order, m.nr_tau),
    )
}

/// The first analyzed row, as the engine clamps it.
fn analysis_start(request: &DDARequest, info: &RecordingInfo) -> usize {
    let rows = usize::try_from(info.sample_count).unwrap_or(usize::MAX);
    AnalysisBounds::from_request(request, rows).map_or(0, |b| b.start)
}

/// The time in seconds at the middle of each window's fitted samples, which follow `dm + max(delay)` lead-in samples:
/// `start + (dm + max(delay) + window_length / 2) / sample_rate + i * window_step / sample_rate`.
pub fn window_centers(info: &RecordingInfo, request: &DDARequest, windows: usize) -> Vec<f64> {
    let rate = info.sample_rate_hz;
    let max_delay = request
        .delay_parameters
        .delays
        .iter()
        .max()
        .map_or(0, |&d| d.max(0));
    let lead_in = f64::from(model_shape(request).0) + f64::from(max_delay);
    let offset = (lead_in + f64::from(request.window_parameters.window_length) / 2.0) / rate;
    let step = f64::from(request.window_parameters.window_step) / rate;
    let start = analysis_start(request, info) as f64 / rate;
    (0..windows)
        .map(|i| start + offset + i as f64 * step)
        .collect()
}

fn reproduction(
    request: &DDARequest,
    info: &RecordingInfo,
    plan: &[Plan],
    input_sha256: BTreeMap<String, String>,
) -> Reproduction {
    let labels = analysis_labels(info);
    let unique = |channels: Vec<usize>| {
        let mut seen = BTreeSet::new();
        channels
            .into_iter()
            .filter(|c| seen.insert(*c))
            .collect::<Vec<_>>()
    };
    let names = |channels: &[usize]| labels_for_channels(&labels, channels);
    let channels: Vec<_> = plan
        .iter()
        .map(|p| unique(p.rows.iter().flatten().copied().collect()))
        .collect();
    let selected = unique(channels.iter().flatten().copied().collect());
    let pairs = || {
        plan.iter()
            .filter(|p| !p.rows.is_empty() && p.rows.iter().all(|row| row.len() == 2))
    };
    let (dm, order, nr_tau) = model_shape(request);
    let model_terms = request
        .model_terms
        .clone()
        .unwrap_or_else(|| DEFAULT_MODEL_TERMS.to_vec());
    let delays = &request.delay_parameters.delays;
    let rate = info.sample_rate_hz;
    let range = &request.time_range;
    let end = if range.end.is_finite() {
        range.end
    } else {
        info.sample_count.saturating_sub(1) as f64
    };
    Reproduction {
        expert_mode: *delays != DEFAULT_DELAYS
            || model_terms != DEFAULT_MODEL_TERMS
            || (dm, order, nr_tau)
                != (
                    DEFAULT_MODEL_DIMENSION,
                    DEFAULT_POLYNOMIAL_ORDER,
                    DEFAULT_NUM_TAU,
                ),
        compute_device: "cpu".to_string(),
        variant_ids: plan.iter().map(|p| p.id.to_string()).collect(),
        selected_channel_names: names(&selected),
        selected_channel_indices: selected,
        variant_channel_names: plan
            .iter()
            .zip(&channels)
            .map(|(p, c)| (p.id.to_string(), names(c)))
            .collect(),
        variant_channel_indices: plan
            .iter()
            .zip(channels)
            .map(|(p, c)| (p.id.to_string(), c))
            .collect(),
        variant_pair_indices: pairs()
            .map(|p| {
                let rows = p.rows.iter().map(|row| [row[0], row[1]]);
                (p.id.to_string(), rows.collect())
            })
            .collect(),
        variant_pair_names: pairs()
            .map(|p| (p.id.to_string(), p.row_labels(&labels)))
            .collect(),
        window_length_samples: request.window_parameters.window_length,
        window_step_samples: request.window_parameters.window_step,
        delays: delays.clone(),
        model_terms,
        model_dimension: dm,
        polynomial_order: order,
        nr_tau,
        start_time_seconds: range.start / rate,
        end_time_seconds: end / rate,
        ddalab_version: env!("CARGO_PKG_VERSION").to_string(),
        input_sha256,
        engine_version: env!("CARGO_PKG_VERSION").to_string(),
        git_commit: option_env!("DDALAB_GIT_COMMIT").map(str::to_string),
        request: request.clone(),
    }
}

/// The recording's warnings as diagnostics.
fn warnings(info: &RecordingInfo) -> Vec<String> {
    info.warnings
        .iter()
        .map(|w| format!("Warning: {w}"))
        .collect()
}

/// The document without variants; its diagnostics are the recording's warnings.
fn skeleton(
    request: &DDARequest,
    info: &RecordingInfo,
    plan: &[Plan],
    windows: usize,
    input_sha256: BTreeMap<String, String>,
    id: String,
    created_at_iso: String,
) -> ResultDocument {
    let path = Path::new(&request.file_path);
    ResultDocument {
        schema: SCHEMA.to_string(),
        id,
        file_name: path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into_owned(),
        created_at_iso,
        diagnostics: warnings(info),
        window_centers_seconds: window_centers(info, request, windows),
        variants: Vec::new(),
        reproduction: reproduction(request, info, plan, input_sha256),
    }
}

/// (min, max, per-row mean of |x|, per-row peak |x|) over the finite values of `matrix`.
fn summarize(matrix: &[Vec<f64>]) -> (Option<f64>, Option<f64>, Vec<f64>, Vec<f64>) {
    let finite = |row: &[f64]| row.iter().copied().filter(|v| v.is_finite()).collect();
    let rows: Vec<Vec<f64>> = matrix.iter().map(|row| finite(row)).collect();
    let all = || rows.iter().flatten().copied();
    let mean = |row: &Vec<f64>| match row.len() {
        0 => 0.0,
        n => row.iter().fold(0.0, |sum, v| sum + v.abs()) / n as f64,
    };
    let peak = |row: &Vec<f64>| row.iter().fold(0.0_f64, |peak, v| peak.max(v.abs()));
    (
        all().reduce(f64::min),
        all().reduce(f64::max),
        rows.iter().map(mean).collect(),
        rows.iter().map(peak).collect(),
    )
}

/// The document of a finished run, with the matrices and their summaries inline. Its diagnostics are the
/// recording's warnings, then the engine's notes.
pub fn build_document(
    result: &DDAResult,
    info: &RecordingInfo,
    request: &DDARequest,
    input_sha256: BTreeMap<String, String>,
    id: String,
    created_at_iso: String,
) -> ResultDocument {
    let plan = plan(request, info);
    let labels = analysis_labels(info);
    let variants: Vec<VariantDocument> = result
        .variant_results
        .iter()
        .flatten()
        .map(|variant| {
            let (min_value, max_value, row_mean_absolute, row_peak_absolute) =
                summarize(&variant.q_matrix);
            let row_labels = match plan.iter().find(|p| p.id == variant.variant_id) {
                Some(p) => p.row_labels(&labels),
                None => variant.channel_labels.clone().unwrap_or_default(),
            };
            VariantDocument {
                id: variant.variant_id.clone(),
                label: variant.variant_name.clone(),
                row_labels,
                matrix: variant.q_matrix.clone(),
                min_value,
                max_value,
                row_mean_absolute: Some(row_mean_absolute),
                row_peak_absolute: Some(row_peak_absolute),
                coefficient_matrices: variant.coefficient_matrices.clone(),
                fit_error_matrix: variant.fit_error_matrix.clone(),
                arrays: None,
            }
        })
        .collect();
    let windows = variants
        .iter()
        .flat_map(|v| v.matrix.iter().map(Vec::len))
        .max()
        .unwrap_or(0);
    let mut diagnostics = warnings(info);
    diagnostics.extend(result.engine_notes.iter().cloned());
    ResultDocument {
        diagnostics,
        variants,
        ..skeleton(
            request,
            info,
            &plan,
            windows,
            input_sha256,
            id,
            created_at_iso,
        )
    }
}

/// The document of a bundle: no matrices or summaries, and the bundle files of each variant in `arrays`. Its
/// diagnostics are the recording's warnings.
pub fn build_manifest(
    info: &RecordingInfo,
    request: &DDARequest,
    layout: &BundleLayout,
    windows: usize,
    input_sha256: BTreeMap<String, String>,
    id: String,
    created_at_iso: String,
) -> ResultDocument {
    let plan = plan(request, info);
    let labels = analysis_labels(info);
    let variants = plan
        .iter()
        .map(|p| {
            let prefix = format!("{}/", p.id);
            let arrays = layout.arrays.iter().filter(|a| a.path.starts_with(&prefix));
            VariantDocument {
                id: p.id.to_string(),
                label: p.name.to_string(),
                row_labels: p.row_labels(&labels),
                matrix: Vec::new(),
                min_value: None,
                max_value: None,
                row_mean_absolute: None,
                row_peak_absolute: None,
                coefficient_matrices: None,
                fit_error_matrix: None,
                arrays: Some(arrays.map(|a| a.path.clone()).collect()),
            }
        })
        .collect();
    ResultDocument {
        variants,
        ..skeleton(
            request,
            info,
            &plan,
            windows,
            input_sha256,
            id,
            created_at_iso,
        )
    }
}

/// The `.npy` files of a bundle.
#[derive(Debug, Clone, Serialize)]
pub struct BundleLayout {
    pub arrays: Vec<ArraySpec>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArraySpec {
    /// Relative to the bundle directory.
    pub path: String,
    pub shape: Vec<usize>,
    pub header: Vec<u8>,
}

/// The arrays of a request's `windows` windows: per variant `<id>/q.npy` of shape (W, R) and, for the
/// variants that fit models (ST, CT), `<id>/coefficients.npy` (W, R, K) and `<id>/fit_error.npy` (W, R).
/// R is the variant's row count and K the number of model terms; all hold window-major `f64`.
pub fn bundle_layout(
    request: &DDARequest,
    info: &RecordingInfo,
    windows: usize,
) -> Result<BundleLayout> {
    let terms = ModelSpec::from_request(request)?.primary_terms.len();
    let mut arrays = Vec::new();
    for p in plan(request, info) {
        let rows = p.rows.len();
        let mut add = |file: &str, shape: Vec<usize>| {
            arrays.push(ArraySpec {
                path: format!("{}/{file}", p.id),
                header: npy_header(&shape),
                shape,
            });
        };
        add("q.npy", vec![windows, rows]);
        if matches!(p.id, "ST" | "CT") {
            add("coefficients.npy", vec![windows, rows, terms]);
            add("fit_error.npy", vec![windows, rows]);
        }
    }
    Ok(BundleLayout { arrays })
}

/// The bytes of a block's windows for each array of `layout` that `result` fills, as
/// (array index, file offset, little-endian `f64` values). The block's windows are one run of the
/// window-major file. The engine's `[row][window]` matrices become (W, R) and its
/// `[coefficient][row][window]` coefficients (W, R, K).
pub fn encode_block(
    layout: &BundleLayout,
    block: &Block,
    result: &DDAResult,
) -> Vec<(usize, u64, Vec<u8>)> {
    let windows = block.w1 - block.w0;
    let window_major = |matrix: &Vec<Vec<f64>>| -> Vec<f64> {
        (0..windows)
            .flat_map(|t| matrix.iter().map(move |row| row[t]))
            .collect()
    };
    let mut chunks = Vec::new();
    for variant in result.variant_results.iter().flatten() {
        let rows = variant.q_matrix.len();
        let coefficients = variant.coefficient_matrices.as_ref().map(|coefficients| {
            (0..windows)
                .flat_map(|t| {
                    (0..rows).flat_map(move |r| coefficients.iter().map(move |c| c[r][t]))
                })
                .collect::<Vec<_>>()
        });
        for (file, values) in [
            ("q.npy", Some(window_major(&variant.q_matrix))),
            ("coefficients.npy", coefficients),
            (
                "fit_error.npy",
                variant.fit_error_matrix.as_ref().map(window_major),
            ),
        ] {
            let path = format!("{}/{file}", variant.variant_id);
            let index = layout.arrays.iter().position(|a| a.path == path);
            let (Some(index), Some(values)) = (index, values) else {
                continue;
            };
            let spec = &layout.arrays[index];
            // In u64: wasm32's usize wraps once an array passes 4 GiB.
            let per_window: u64 = spec.shape[1..].iter().map(|&n| n as u64).product();
            let offset = spec.header.len() as u64 + block.w0 as u64 * per_window * 8;
            let bytes = values.into_iter().flat_map(f64::to_le_bytes).collect();
            chunks.push((index, offset, bytes));
        }
    }
    chunks
}

/// Writes a bundle directory: the `.npy` files at their full size, then `manifest.json` last. A
/// directory with a manifest is complete. `create` removes the manifest of an earlier bundle and
/// `finish` renames a finished `manifest.json.tmp` into place: a manifest is complete or absent.
#[cfg(not(target_arch = "wasm32"))]
pub struct BundleWriter {
    dir: std::path::PathBuf,
    /// Each file and its length.
    files: Vec<(std::fs::File, u64)>,
}

#[cfg(not(target_arch = "wasm32"))]
impl BundleWriter {
    pub fn create(dir: &Path, layout: &BundleLayout) -> Result<Self> {
        use std::io::{ErrorKind, Write};
        match std::fs::remove_file(dir.join("manifest.json")) {
            Err(e) if e.kind() != ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
        let files = layout
            .arrays
            .iter()
            .map(|array| {
                let path = dir.join(&array.path);
                std::fs::create_dir_all(path.parent().unwrap_or(dir))?;
                let mut file = std::fs::File::create(path)?;
                file.write_all(&array.header)?;
                let len = (array.header.len() + array.shape.iter().product::<usize>() * 8) as u64;
                file.set_len(len)?;
                Ok((file, len))
            })
            .collect::<Result<_>>()?;
        Ok(Self {
            dir: dir.to_path_buf(),
            files,
        })
    }

    /// Writes `encode_block` chunks; a chunk that is not inside its array is an error.
    pub fn write(&mut self, chunks: Vec<(usize, u64, Vec<u8>)>) -> Result<()> {
        use crate::error::DDAError;
        use std::io::{Seek, SeekFrom, Write};
        for (index, offset, bytes) in chunks {
            let (file, len) = self.files.get_mut(index).ok_or_else(|| {
                DDAError::InvalidParameter(format!("array {index} is not in the bundle"))
            })?;
            if offset.saturating_add(bytes.len() as u64) > *len {
                return Err(DDAError::InvalidParameter(format!(
                    "{} bytes at {offset} pass the end of array {index} ({len} bytes)",
                    bytes.len()
                )));
            }
            file.seek(SeekFrom::Start(offset))?;
            file.write_all(&bytes)?;
        }
        Ok(())
    }

    pub fn finish(self, manifest: &ResultDocument) -> Result<()> {
        use std::io::Write;
        let tmp = self.dir.join("manifest.json.tmp");
        let mut out = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        serde_json::to_writer(&mut out, manifest).map_err(std::io::Error::from)?;
        out.flush()?;
        out.get_ref().sync_all()?;
        std::fs::rename(tmp, self.dir.join("manifest.json"))?;
        Ok(())
    }
}

/// The header of a version 1.0 `.npy` file holding C-order little-endian f64 values of `shape`:
/// magic, version, header length and the padded dict, ending in a newline at a multiple of 64 bytes.
pub fn npy_header(shape: &[usize]) -> Vec<u8> {
    let dims = match shape {
        [n] => format!("({n},)"),
        _ => format!(
            "({})",
            shape
                .iter()
                .map(usize::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ),
    };
    let mut dict = format!("{{'descr': '<f8', 'fortran_order': False, 'shape': {dims}, }}");
    // The 10 bytes before the dict, and the newline after it.
    let padding = (64 - (10 + dict.len() + 1) % 64) % 64;
    dict.push_str(&" ".repeat(padding));
    dict.push('\n');

    let mut header = b"\x93NUMPY\x01\x00".to_vec();
    header.extend((dict.len() as u16).to_le_bytes());
    header.extend(dict.bytes());
    header
}

#[cfg(test)]
mod tests {
    use super::npy_header;

    #[test]
    fn npy_header_shapes_and_padding() {
        for (shape, dims) in [(&[5, 2][..], "(5, 2)"), (&[7], "(7,)"), (&[], "()")] {
            let header = npy_header(shape);
            assert_eq!(header.len() % 64, 0);
            let text = std::str::from_utf8(&header[10..]).unwrap();
            assert!(text.starts_with(&format!(
                "{{'descr': '<f8', 'fortran_order': False, 'shape': {dims}, }}"
            )));
            assert!(text.ends_with('\n'));
            assert_eq!(
                u16::from_le_bytes([header[8], header[9]]) as usize,
                text.len()
            );
        }
        // numpy's own header for a (5, 2) f8 array is 128 bytes.
        assert_eq!(npy_header(&[5, 2]).len(), 128);
    }
}
