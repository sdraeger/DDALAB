//! ASCII and delimited text reader (CSV, TSV, semicolon or whitespace separated): one sample per line, an optional
//! header row of labels and an optional leading time column. Ported from `readers/delimited.py`.

use super::recording::*;
use super::{ByteSource, FileSet};
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
fn rate_from(times: impl Iterator<Item = f64>) -> Option<f64> {
    let (mut sum, mut steps, mut last) = (0.0, 0, None);
    for t in times {
        let d = last.map_or(f64::NAN, |last| t - last);
        if d.is_finite() && d > 0.0 {
            sum += d;
            steps += 1;
        }
        last = Some(t);
    }
    (steps > 0).then(|| 1.0 / (sum / steps as f64).max(1e-6))
}

/// Bytes of the file one read fetches while parsing.
const READ_BYTES: usize = 1 << 20;

/// Calls `line` on each line of `source` (ended by `\r` or `\n`), trimmed and without a byte order mark, that is not
/// empty or a `#` comment. Reads `READ_BYTES` at a time: the whole file is never in memory.
fn for_each_line(source: &dyn ByteSource, mut line: impl FnMut(&str) -> Result<()>) -> Result<()> {
    let mut emit = |bytes: &[u8]| {
        let text = String::from_utf8_lossy(bytes);
        let text = text.trim().trim_start_matches('\u{feff}').trim();
        match text.is_empty() || text.starts_with('#') {
            true => Ok(()),
            false => line(text),
        }
    };
    let mut chunk = vec![0u8; READ_BYTES];
    // The start of a line the last chunk cut.
    let mut carry = Vec::new();
    let mut offset = 0;
    while offset < source.len() {
        let n = READ_BYTES.min((source.len() - offset) as usize);
        source.read_at(offset, &mut chunk[..n])?;
        offset += n as u64;
        let mut rest = &chunk[..n];
        while let Some(end) = rest.iter().position(|&b| b == b'\r' || b == b'\n') {
            if carry.is_empty() {
                emit(&rest[..end])?;
            } else {
                carry.extend_from_slice(&rest[..end]);
                emit(&carry)?;
                carry.clear();
            }
            rest = &rest[end + 1..];
        }
        carry.extend_from_slice(rest);
    }
    emit(&carry)
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
    // Two passes over the file hold only the samples: the first sizes them, the second parses into them.
    let mut first_tokens: Option<Vec<String>> = None;
    let mut has_header = false;
    let mut delimiter_of_file = None;
    // Data rows (a line with a number) and how many have each width, in order of appearance; text-only lines.
    let (mut rows, mut counts, mut skipped) = (0, Vec::<(usize, usize)>::new(), 0);
    for_each_line(source.as_ref(), |line| {
        if first_tokens.is_none() {
            delimiter_of_file = delimiter(line);
            let tokens = split(line, delimiter_of_file);
            // An empty cell is a gap in a data row. Only a non-empty cell that is not a number makes a header.
            has_header = tokens.iter().any(|t| !t.is_empty() && number(t).is_none());
            first_tokens = Some(tokens.into_iter().map(str::to_string).collect());
            if has_header {
                return Ok(());
            }
        }
        let tokens = split(line, delimiter_of_file);
        if !tokens.iter().any(|t| number(t).is_some()) {
            skipped += 1;
            return Ok(());
        }
        rows += 1;
        match counts.iter_mut().find(|c| c.0 == tokens.len()) {
            Some(c) => c.1 += 1,
            None => counts.push((tokens.len(), 1)),
        }
        Ok(())
    })?;
    let first_tokens =
        first_tokens.ok_or_else(|| DDAError::ParseError(format!("{name} is empty")))?;
    if rows == 0 {
        return Err(DDAError::ParseError(format!(
            "No numeric samples were found in {name}"
        )));
    }
    // The most common row width; ties go to the width seen first.
    let (width, full) = counts
        .iter()
        .fold((0, 0), |best, &c| if c.1 > best.1 { c } else { best });

    let mut data = vec![f64::NAN; rows * width];
    let mut slots = data.chunks_exact_mut(width);
    let mut values = Vec::with_capacity(width);
    let mut header = has_header;
    let changed = || DDAError::ParseError(format!("{name} changed while it was read"));
    for_each_line(source.as_ref(), |line| {
        if header {
            header = false;
            return Ok(());
        }
        values.clear();
        values.extend(split(line, delimiter_of_file).into_iter().map(number));
        if values.iter().any(Option::is_some) {
            let slot = slots.next().ok_or_else(changed)?;
            for (cell, value) in slot.iter_mut().zip(&values) {
                *cell = value.unwrap_or(f64::NAN);
            }
        }
        Ok(())
    })?;
    if slots.next().is_some() {
        return Err(changed());
    }

    let mut warnings = Vec::new();
    if skipped > 0 {
        warnings.push(format!("{skipped} text-only lines were skipped."));
    }
    let ragged = rows - full;
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
    let has_time = labels.is_some_and(|l| is_time_header(&l[0]));
    let first = has_time as usize;
    if width == first {
        return Err(DDAError::ParseError(format!(
            "At least one signal channel is required in {name}"
        )));
    }
    let label = |i: usize| {
        labels
            .map(|l| &l[first + i])
            .filter(|s| !s.is_empty())
            .map_or_else(|| format!("Channel {}", i + 1), String::clone)
    };
    let names = unique_names((0..width - first).map(label).collect());

    let times = data.iter().step_by(width).copied();
    let estimated = if has_time { rate_from(times) } else { None };
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
    let sample_count = rows as u64;
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
