//! BIDS sidecars beside a recording `<prefix>_<modality>.<ext>`: `<prefix>_channels.tsv`, `<prefix>_events.tsv` and
//! `<prefix>_<modality>.json`. Ported from `domain/bids.py` and `readers/mne.py:_bids_warnings`.

use super::recording::*;
use super::FileSet;
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;

#[cfg(not(target_arch = "wasm32"))]
use {crate::error::Result, std::path::PathBuf};

/// `_BIDS_DURATION_TOLERANCE` of `mne.py`.
const DURATION_TOLERANCE: f64 = 0.01;

/// Sets `status` and `type` of the channels named in channels.tsv, appends the events of events.tsv to
/// `info.annotations` and the warnings of the modality JSON to `info.warnings`. The sidecars found are
/// appended to `info.input_files`. Sidecars missing from `files` are skipped.
pub fn apply_bids_sidecars(info: &mut RecordingInfo, files: &FileSet) {
    let Some((prefix, modality)) = Path::new(&files.primary)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .and_then(|stem| stem.rsplit_once('_'))
    else {
        return;
    };

    if let Some(text) = read_sidecar(info, files, &format!("{prefix}_channels.tsv")) {
        for row in tsv_rows(&text) {
            let Some(name) = row.get("name") else {
                continue;
            };
            for channel in info.channels.iter_mut().filter(|c| c.label == *name) {
                channel.bids_status = row.get("status").map(|s| s.to_string());
                channel.bids_type = row.get("type").map(|s| s.to_string());
            }
        }
    }

    if let Some(text) = read_sidecar(info, files, &format!("{prefix}_events.tsv")) {
        info.annotations
            .extend(tsv_rows(&text).iter().filter_map(event));
    }

    if let Some(text) = read_sidecar(info, files, &format!("{prefix}_{modality}.json")) {
        let warnings = json_warnings(&text, info.sample_count, info.sample_rate_hz);
        info.warnings.extend(warnings);
    }
}

/// The text of sidecar `name`, noting it in `info.input_files`; `None` when `files` lacks it or reading fails (a warning).
fn read_sidecar(info: &mut RecordingInfo, files: &FileSet, name: &str) -> Option<String> {
    let source = files.source(name)?;
    let mut bytes = vec![0u8; source.len() as usize];
    if let Err(error) = source.read_at(0, &mut bytes) {
        info.warnings
            .push(format!("Could not read the BIDS sidecar {name}: {error}"));
        return None;
    }
    info.input_files.push(name.to_string());
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The rows of tab-separated `text` as column name to cell; empty cells and `n/a` are left out.
fn tsv_rows(text: &str) -> Vec<HashMap<&str, &str>> {
    let mut lines = text
        .trim_start_matches('\u{feff}')
        .lines()
        .filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let columns: Vec<&str> = header.split('\t').map(str::trim).collect();
    lines
        .map(|line| {
            columns
                .iter()
                .copied()
                .zip(line.split('\t').map(str::trim))
                .filter(|(_, cell)| !cell.is_empty() && *cell != "n/a")
                .collect()
        })
        .collect()
}

/// A clock stamp such as "+60.000000", which some files carry as an event label.
fn is_clock_stamp(label: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    label
        .strip_prefix('+')
        .and_then(|rest| rest.split_once('.'))
        .is_some_and(|(whole, fraction)| digits(whole) && digits(fraction))
}

/// The annotation of an events.tsv row; none without a numeric onset or a label, or for a clock stamp.
/// A missing, non-numeric or non-positive duration is 0.
fn event(row: &HashMap<&str, &str>) -> Option<Annotation> {
    let number = |key: &str| {
        row.get(key)
            .and_then(|cell| cell.parse::<f64>().ok())
            .filter(|value| value.is_finite())
    };
    let label = *row.get("trial_type")?;
    (!is_clock_stamp(label)).then_some(Annotation {
        onset_s: number("onset")?,
        duration_s: number("duration").filter(|d| *d > 0.0).unwrap_or(0.0),
        label: label.to_string(),
        source: "events.tsv".to_string(),
    })
}

/// The warnings of `_bids_warnings`: the file holds fewer samples than the sidecar's duration, and the sidecar's rate
/// differs from the header rate. Nothing for a sidecar that is not JSON or lacks a positive rate and a duration.
fn json_warnings(text: &str, sample_count: u64, header_rate: f64) -> Vec<String> {
    let meta: Value = serde_json::from_str(text).unwrap_or_default();
    let number = |key: &str| {
        match meta.get(key)? {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
        .filter(|value| value.is_finite())
    };
    let (Some(duration), Some(sample_rate)) =
        (number("RecordingDuration"), number("SamplingFrequency"))
    else {
        return Vec::new();
    };
    if sample_rate <= 0.0 {
        return Vec::new();
    }
    let samples = sample_count as f64;
    let mut warnings = Vec::new();
    if samples < duration * sample_rate * (1.0 - DURATION_TOLERANCE) {
        warnings.push(format!(
            "The data file holds {sample_count} samples ({:.2} s), but the BIDS sidecar describes {duration:.2} s; the file appears truncated.",
            samples / sample_rate
        ));
    }
    let drift = (samples / header_rate - samples / sample_rate).abs();
    if drift > 0.01 {
        warnings.push(format!(
            "The file header gives {header_rate:.3} Hz and the BIDS sidecar {sample_rate:.3} Hz. DDALAB uses the header rate, so BIDS event times drift by up to {drift:.2} s over the recording."
        ));
    }
    warnings
}

/// The `*_ieeg` and `*_eeg` recordings (`.edf`, `.bdf`, `.vhdr`) under `root`, sorted by path.
#[cfg(not(target_arch = "wasm32"))]
pub fn discover_bids_recordings(root: &Path) -> Result<Vec<PathBuf>> {
    fn walk(dir: &Path, found: &mut Vec<PathBuf>) -> Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            // A symlinked directory is not followed (loops); a symlinked file counts (git-annex).
            if entry.file_type()?.is_dir() {
                walk(&path, found)?;
            } else if is_recording(&path) && path.is_file() {
                found.push(path);
            }
        }
        Ok(())
    }

    let mut found = Vec::new();
    walk(root, &mut found)?;
    found.sort();
    Ok(found)
}

#[cfg(not(target_arch = "wasm32"))]
fn is_recording(path: &Path) -> bool {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    (stem.ends_with("_ieeg") || stem.ends_with("_eeg"))
        && ["edf", "bdf", "vhdr"]
            .iter()
            .any(|e| extension.eq_ignore_ascii_case(e))
}
