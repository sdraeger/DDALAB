//! ASCII and delimited text reader (CSV, TSV, semicolon or whitespace separated): one sample per line, an optional
//! header row of labels and an optional leading time column. Ported from `readers/delimited.py`.

use super::recording::*;
use super::FileSet;
use crate::error::{DDAError, Result};
use std::collections::HashMap;

fn number(token: &str) -> Option<f64> {
    token.parse().ok()
}

/// The first of tab, semicolon and comma that `line` holds, or `None` for whitespace.
fn delimiter(line: &str) -> Option<char> {
    ['\t', ';', ','].into_iter().find(|&d| line.contains(d))
}

fn split(line: &str, delimiter: Option<char>) -> Vec<&str> {
    match delimiter {
        Some(d) => line.split(d).map(str::trim).collect(),
        None => line.split_whitespace().collect(),
    }
}

/// A label such as "time", "Time (s)" or "timestamp_ms": a time word not continued by a letter.
fn is_time_header(label: &str) -> bool {
    let label = label.trim().to_lowercase();
    [
        "time",
        "timestamp",
        "second",
        "seconds",
        "sample",
        "samples",
    ]
    .iter()
    .any(|word| {
        label
            .strip_prefix(word)
            .is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_lowercase()))
    })
}

/// 1 / the mean of the positive steps between consecutive times, or `None` without such a step.
fn rate_from(t: &[f64]) -> Option<f64> {
    let steps: Vec<f64> = t
        .windows(2)
        .map(|w| w[1] - w[0])
        .filter(|d| d.is_finite() && *d > 0.0)
        .collect();
    (!steps.is_empty()).then(|| 1.0 / (steps.iter().sum::<f64>() / steps.len() as f64).max(1e-6))
}

/// `names` with a repeat of "A" renamed "A-2", "A-3", ... so every channel has its own label.
fn unique_names(names: Vec<String>) -> Vec<String> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut unique: Vec<String> = Vec::new();
    for name in names {
        let count = seen.entry(name.clone()).or_insert(0);
        *count += 1;
        let mut candidate = if *count == 1 {
            name.clone()
        } else {
            format!("{name}-{count}")
        };
        while unique.contains(&candidate) {
            *count += 1;
            candidate = format!("{name}-{count}");
        }
        unique.push(candidate);
    }
    unique
}

struct AsciiReader {
    info: RecordingInfo,
    /// Row-major, `width` values per row; the first `first` columns are time.
    data: Vec<f64>,
    width: usize,
    first: usize,
}

/// Opens `name` in `files`. The rate is `sample_rate_hz`, else 1 / the mean step of the time column, else 1 Hz with a warning.
pub fn open_ascii(
    files: &FileSet,
    name: &str,
    sample_rate_hz: Option<f64>,
) -> Result<Box<dyn Reader>> {
    if let Some(rate) = sample_rate_hz.filter(|r| !(r.is_finite() && *r > 0.0)) {
        return Err(DDAError::InvalidParameter(format!(
            "sample rate must be positive and finite, got {rate}"
        )));
    }
    let source = files
        .source(name)
        .ok_or_else(|| DDAError::FileNotFound(name.to_string()))?;
    // shortcut: whole-file parse, add a sparse line index if ASCII recordings above ~1 GB appear
    let mut bytes = vec![0u8; source.len() as usize];
    source.read_at(0, &mut bytes)?;
    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text
        .split(['\r', '\n'])
        .map(|line| line.trim().trim_start_matches('\u{feff}').trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    let first_line = *lines
        .first()
        .ok_or_else(|| DDAError::ParseError(format!("{name} is empty")))?;

    let delimiter = delimiter(first_line);
    let first_tokens = split(first_line, delimiter);
    // An empty cell is a gap in a data row, so only a non-empty cell that is not a number makes a header.
    let has_header = first_tokens
        .iter()
        .any(|t| !t.is_empty() && number(t).is_none());
    let body = &lines[has_header as usize..];

    let parsed: Vec<Vec<Option<f64>>> = body
        .iter()
        .map(|line| split(line, delimiter).into_iter().map(number).collect())
        .collect();
    let rows: Vec<&Vec<Option<f64>>> = parsed
        .iter()
        .filter(|row| row.iter().any(Option::is_some))
        .collect();
    if rows.is_empty() {
        return Err(DDAError::ParseError(format!(
            "No numeric samples were found in {name}"
        )));
    }
    // The most common row width; ties go to the width seen first.
    let mut counts: Vec<(usize, usize)> = Vec::new();
    for row in &rows {
        match counts.iter_mut().find(|c| c.0 == row.len()) {
            Some(c) => c.1 += 1,
            None => counts.push((row.len(), 1)),
        }
    }
    let width = counts
        .iter()
        .fold((0, 0), |best, &c| if c.1 > best.1 { c } else { best })
        .0;
    let mut data = vec![f64::NAN; rows.len() * width];
    for (i, row) in rows.iter().enumerate() {
        for (j, value) in row.iter().take(width).enumerate() {
            data[i * width + j] = value.unwrap_or(f64::NAN);
        }
    }

    let mut warnings = Vec::new();
    let skipped = parsed.len() - rows.len();
    if skipped > 0 {
        warnings.push(format!("{skipped} text-only lines were skipped."));
    }
    let ragged = rows.iter().filter(|row| row.len() != width).count();
    if ragged > 0 {
        warnings.push(format!(
            "{ragged} rows do not have {width} columns; they were padded or cut."
        ));
    }
    let gaps = data.iter().filter(|v| v.is_nan()).count();
    if gaps > 0 {
        warnings.push(format!(
            "{gaps} empty or non-numeric cells are treated as gaps (NaN)."
        ));
    }

    let labels = has_header
        .then_some(&first_tokens)
        .filter(|header| header.len() >= width);
    let has_time = labels.is_some_and(|l| is_time_header(l[0]));
    let first = has_time as usize;
    if width == first {
        return Err(DDAError::ParseError(format!(
            "At least one signal channel is required in {name}"
        )));
    }
    let label = |i: usize| {
        labels
            .map(|l| l[first + i])
            .filter(|s| !s.is_empty())
            .map_or_else(|| format!("Channel {}", i + 1), str::to_string)
    };
    let names = unique_names((0..width - first).map(label).collect());

    let times: Vec<f64> = data.iter().step_by(width).copied().collect();
    let estimated = if has_time { rate_from(&times) } else { None };
    let rate = sample_rate_hz.or(estimated).unwrap_or_else(|| {
        warnings.push(
            "No sample rate was given and the file has no usable time column; assuming 1 Hz."
                .to_string(),
        );
        1.0
    });

    let channels = names
        .into_iter()
        .map(|label| ChannelInfo {
            label,
            unit: String::new(),
            sample_rate_hz: rate,
            gain: 1.0,
            offset: 0.0,
            kind: ChannelKind::Signal,
            bids_status: None,
            bids_type: None,
        })
        .collect();
    let sample_count = rows.len() as u64;
    Ok(Box::new(AsciiReader {
        info: RecordingInfo {
            format: if name.to_ascii_lowercase().ends_with(".csv") {
                "CSV"
            } else {
                "ASCII"
            }
            .to_string(),
            channels,
            sample_rate_hz: rate,
            sample_count,
            duration_s: sample_count as f64 / rate,
            raw_type: RawType::F64,
            annotations: Vec::new(),
            warnings,
            input_files: vec![name.to_string()],
        },
        data,
        width,
        first,
    }))
}

impl AsciiReader {
    fn value(&self, row: usize, channel: usize) -> f64 {
        self.data[row * self.width + self.first + channel]
    }
}

impl Reader for AsciiReader {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        self.info.check_read(channels, row0, rows)?;
        let row0 = row0 as usize;
        Ok((row0..row0 + rows)
            .map(|row| channels.iter().map(|&c| self.value(row, c)).collect())
            .collect())
    }

    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()> {
        self.info.check_read(channels, row0, rows)?;
        if out.len() != rows * channels.len() {
            return Err(DDAError::InvalidParameter(format!(
                "output holds {} values, but {rows} rows of {} channels need {}",
                out.len(),
                channels.len(),
                rows * channels.len()
            )));
        }
        for (i, slot) in out.iter_mut().enumerate() {
            *slot = self.value(
                row0 as usize + i / channels.len(),
                channels[i % channels.len()],
            ) as f32;
        }
        Ok(())
    }
}
