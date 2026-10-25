//! EDF, EDF+, BDF and BDF+ reader (https://www.edfplus.info/specs/): a 256-byte header, 256 bytes per
//! signal, then data records that each hold `record_duration_s` of every signal, signal after signal.

use super::recording::*;
use super::{ByteSource, FileSet};
use crate::error::{DDAError, Result};
use std::collections::BTreeMap;
use std::sync::Arc;

const FIXED_HEADER: usize = 256;
/// Widths of the per-signal header columns, in file order; each column holds one cell per signal.
const WIDTHS: [usize; 10] = [16, 80, 8, 8, 8, 8, 8, 80, 8, 32];
const LABEL: usize = 0;
const DIMENSION: usize = 2;
const PHYSICAL_MIN: usize = 3;
const PHYSICAL_MAX: usize = 4;
const DIGITAL_MIN: usize = 5;
const DIGITAL_MAX: usize = 6;
const SAMPLES_PER_RECORD: usize = 8;

/// Most bytes one `read_at` fetches, so a long request does not hold its whole span in memory.
const MAX_READ_BYTES: usize = 8 << 20;
/// An EDF+D recording is contiguous when its last onset minus its first matches `(records - 1) * record_duration_s` within this.
const SPAN_TOLERANCE_S: f64 = 1e-9;
/// When the span test fails: a record onset that differs from the end of the previous record by less than this is contiguous.
const ONSET_TOLERANCE_S: f64 = 1e-6;

fn unsupported(message: String) -> DDAError {
    DDAError::UnsupportedFileType(message)
}

/// Header text without its padding: UTF-8, or Latin-1 when the bytes are not valid UTF-8.
fn text(raw: &[u8]) -> String {
    let text = std::str::from_utf8(raw)
        .map(str::to_string)
        .unwrap_or_else(|_| raw.iter().map(|&b| b as char).collect());
    text.trim_matches([' ', '\0']).to_string()
}

fn int(what: &str, raw: &[u8]) -> Result<i64> {
    text(raw).parse().map_err(|_| {
        unsupported(format!(
            "header field '{what}' is malformed: '{}'",
            text(raw)
        ))
    })
}

fn float(what: &str, raw: &[u8]) -> Result<f64> {
    text(raw)
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .ok_or_else(|| {
            unsupported(format!(
                "header field '{what}' is malformed: '{}'",
                text(raw)
            ))
        })
}

/// The SI unit and the factor from a physical dimension to it.
fn si_unit(dimension: &str) -> (&str, f64) {
    match dimension {
        // Micro sign U+00B5 (Latin-1 byte 0xB5) or Greek mu U+03BC.
        "uV" | "\u{b5}V" | "\u{3bc}V" => ("V", 1e-6),
        "mV" => ("V", 1e-3),
        "nV" => ("V", 1e-9),
        "V" => ("V", 1.0),
        other => (other, 1.0),
    }
}

/// Onset, duration and texts of one time-stamped annotation list.
type Tal = (f64, f64, Vec<String>);

/// Parses `+<onset>[\x15<duration>]\x14<text>\x14...`, or `None` when onset or duration is not a number.
fn parse_tal(tal: &[u8]) -> Option<Tal> {
    let tal = String::from_utf8_lossy(tal);
    let mut parts = tal.split('\x14');
    let head = parts.next()?;
    let (onset, duration) = head.split_once('\x15').unwrap_or((head, "0"));
    let texts = parts
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .collect();
    Some((onset.parse().ok()?, duration.parse().ok()?, texts))
}

/// The onset of the timekeeping TAL, the one without text that opens each record's first annotation channel.
fn timekeeping(tals: &[Tal]) -> Option<f64> {
    tals.first().filter(|tal| tal.2.is_empty()).map(|tal| tal.0)
}

/// Where a channel's samples sit in a data record.
struct Slot {
    byte_offset: usize,
    samples: usize,
}

struct EdfReader {
    info: RecordingInfo,
    source: Arc<dyn ByteSource>,
    data_start: u64,
    record_duration_s: f64,
    record_bytes: usize,
    records: u64,
    bytes_per_sample: usize,
    /// By channel.
    slots: Vec<Slot>,
}

pub fn open_edf(files: &FileSet, name: &str) -> Result<Box<dyn Reader>> {
    let source = files
        .source(name)
        .ok_or_else(|| DDAError::FileNotFound(name.to_string()))?
        .clone();
    let len = source.len();
    if len < FIXED_HEADER as u64 {
        return Err(unsupported(format!(
            "{name} holds {len} bytes, fewer than the 256-byte EDF header"
        )));
    }
    let mut head = [0u8; FIXED_HEADER];
    source.read_at(0, &mut head)?;
    let bdf = head[..8] == *b"\xFFBIOSEMI";
    if !bdf && text(&head[..8]) != "0" {
        return Err(unsupported(format!(
            "{name} is not an EDF or BDF file: unrecognized version field '{}'",
            text(&head[..8])
        )));
    }
    let reserved = text(&head[192..236]);
    let plus = reserved.starts_with("EDF+") || reserved.starts_with("BDF+");
    let plus_d = reserved.starts_with("EDF+D") || reserved.starts_with("BDF+D");
    let header_bytes = int("header size", &head[184..192])?;
    let declared_records = int("number of data records", &head[236..244])?;
    let record_duration_s = float("data record duration", &head[244..252])?;
    let signals = int("number of signals", &head[252..256])?;
    if signals < 1 {
        return Err(unsupported(format!(
            "header field 'number of signals' is {signals}"
        )));
    }
    if record_duration_s <= 0.0 {
        return Err(unsupported(format!(
            "header field 'data record duration' is {record_duration_s}"
        )));
    }
    let signals = signals as usize;
    let header_len = FIXED_HEADER * (1 + signals);
    if len < header_len as u64 {
        return Err(unsupported(format!(
            "{name} holds {len} bytes, fewer than the {header_len} bytes of its header"
        )));
    }
    let mut warnings = Vec::new();
    if header_bytes != header_len as i64 {
        warnings.push(format!(
            "The header declares a size of {header_bytes} bytes, but {signals} signals need {header_len}; using {header_len}."
        ));
    }
    let mut signal_header = vec![0u8; header_len - FIXED_HEADER];
    source.read_at(FIXED_HEADER as u64, &mut signal_header)?;
    let cell = |column: usize, signal: usize| {
        let start = signals * WIDTHS[..column].iter().sum::<usize>() + signal * WIDTHS[column];
        &signal_header[start..start + WIDTHS[column]]
    };

    let bytes_per_sample = if bdf { 3 } else { 2 };
    let mut channels = Vec::new();
    let mut slots = Vec::new();
    let mut record_bytes = 0;
    for i in 0..signals {
        let label = text(cell(LABEL, i));
        let field = |name: &str| format!("signal {i} ({label}) {name}");
        let samples = int(&field("samples per record"), cell(SAMPLES_PER_RECORD, i))?;
        if samples < 0 {
            return Err(unsupported(format!(
                "header field '{}' is {samples}",
                field("samples per record")
            )));
        }
        let samples = samples as usize;
        let kind = match label.as_str() {
            "EDF Annotations" | "BDF Annotations" => ChannelKind::Annotation,
            "Status" if bdf => ChannelKind::Status,
            _ => ChannelKind::Signal,
        };
        let dimension = text(cell(DIMENSION, i));
        let (unit, gain, offset) = if kind == ChannelKind::Signal {
            let physical_min = float(&field("physical minimum"), cell(PHYSICAL_MIN, i))?;
            let physical_max = float(&field("physical maximum"), cell(PHYSICAL_MAX, i))?;
            let digital_min = float(&field("digital minimum"), cell(DIGITAL_MIN, i))?;
            let digital_max = float(&field("digital maximum"), cell(DIGITAL_MAX, i))?;
            if digital_max == digital_min {
                return Err(unsupported(format!(
                    "header fields '{}' and '{}' are both {digital_min}",
                    field("digital minimum"),
                    field("digital maximum")
                )));
            }
            let scale = (physical_max - physical_min) / (digital_max - digital_min);
            let (unit, factor) = si_unit(&dimension);
            (
                unit.to_string(),
                scale * factor,
                (physical_min - digital_min * scale) * factor,
            )
        } else {
            (dimension, 1.0, 0.0)
        };
        channels.push(ChannelInfo {
            label,
            unit,
            sample_rate_hz: samples as f64 / record_duration_s,
            gain,
            offset,
            kind,
            bids_status: None,
            bids_type: None,
        });
        slots.push(Slot {
            byte_offset: record_bytes,
            samples,
        });
        record_bytes += samples * bytes_per_sample;
    }
    if record_bytes == 0 {
        return Err(unsupported(
            "every signal has 0 samples per data record".to_string(),
        ));
    }

    let available = len - header_len as u64;
    let complete = available / record_bytes as u64;
    let records = match u64::try_from(declared_records) {
        Ok(declared) if declared <= complete => declared,
        _ => {
            warnings.push(format!(
                "The header declares {declared_records} data records, but the file holds {complete} complete records and {} extra bytes.",
                available % record_bytes as u64
            ));
            complete
        }
    };

    // The dominant rate is the one most signals share (ties: the higher rate).
    let mut signals_per_count = BTreeMap::<usize, usize>::new();
    for (channel, slot) in channels.iter().zip(&slots) {
        if channel.kind == ChannelKind::Signal {
            *signals_per_count.entry(slot.samples).or_default() += 1;
        }
    }
    let dominant_samples = signals_per_count
        .iter()
        .max_by_key(|&(&samples, &signals)| (signals, samples))
        .map_or(0, |(&samples, _)| samples);

    if plus_d
        && !channels
            .iter()
            .any(|channel| channel.kind == ChannelKind::Annotation)
    {
        return Err(unsupported(
            "EDF+D recording without an annotation channel".to_string(),
        ));
    }

    let prefix = if bdf { "BDF" } else { "EDF" };
    let info = RecordingInfo {
        format: if plus {
            format!("{prefix}+")
        } else {
            prefix.to_string()
        },
        channels,
        sample_rate_hz: dominant_samples as f64 / record_duration_s,
        sample_count: records * dominant_samples as u64,
        duration_s: records as f64 * record_duration_s,
        raw_type: if bdf { RawType::I24 } else { RawType::I16 },
        annotations: Vec::new(),
        warnings,
        input_files: vec![name.to_string()],
    };
    let reader = EdfReader {
        info,
        source,
        data_start: header_len as u64,
        record_duration_s,
        record_bytes,
        records,
        bytes_per_sample,
        slots,
    };
    if plus_d {
        reader.check_contiguous()?;
    }
    Ok(Box::new(reader))
}

impl EdfReader {
    fn annotation_channels(&self) -> impl Iterator<Item = usize> + '_ {
        (0..self.info.channels.len())
            .filter(|&c| self.info.channels[c].kind == ChannelKind::Annotation)
    }

    /// The TALs in annotation channel `c` of `record`, from one `read_at` of that channel's samples,
    /// and the number of entries that did not parse.
    fn record_tals(&self, record: u64, c: usize) -> Result<(Vec<Tal>, usize)> {
        let slot = &self.slots[c];
        let mut bytes = vec![0u8; slot.samples * self.bytes_per_sample];
        let at = self.data_start + record * self.record_bytes as u64 + slot.byte_offset as u64;
        self.source.read_at(at, &mut bytes)?;
        let entries: Vec<&[u8]> = bytes
            .split(|&b| b == 0)
            .filter(|entry| !entry.is_empty())
            .collect();
        let tals: Vec<Tal> = entries.iter().copied().filter_map(parse_tal).collect();
        let unparsed = entries.len() - tals.len();
        Ok((tals, unparsed))
    }

    /// The start time of `record`, from the timekeeping TAL of the first annotation channel.
    fn record_onset(&self, record: u64) -> Result<f64> {
        let c = self.annotation_channels().next().ok_or_else(|| {
            unsupported("EDF+D recording without an annotation channel".to_string())
        })?;
        timekeeping(&self.record_tals(record, c)?.0).ok_or_else(|| {
            unsupported(format!(
                "EDF+D record {record} has no timekeeping annotation"
            ))
        })
    }

    /// Refuses an EDF+D recording with a gap between records. Two reads decide it when the first and last
    /// onsets span `(records - 1) * record_duration_s`; only a mismatch reads every onset, to name the gap.
    /// shortcut: a gap cancelled by an overlap passes the span test; scan every onset if such files turn up.
    fn check_contiguous(&self) -> Result<()> {
        if self.records < 2 {
            return Ok(());
        }
        let first = self.record_onset(0)?;
        let span = self.record_onset(self.records - 1)? - first;
        let expected = (self.records - 1) as f64 * self.record_duration_s;
        if (span - expected).abs() <= SPAN_TOLERANCE_S {
            return Ok(());
        }
        let mut end = first + self.record_duration_s;
        for record in 1..self.records {
            let onset = self.record_onset(record)?;
            let gap = onset - end;
            if gap.abs() > ONSET_TOLERANCE_S {
                return Err(unsupported(format!(
                    "discontinuous EDF+D recording: gap of {} s after record {}",
                    (gap * 1e6).round() / 1e6,
                    record - 1
                )));
            }
            end = onset + self.record_duration_s;
        }
        Ok(())
    }

    /// The samples per record shared by `channels`, or the error naming why they cannot be read together.
    fn shared_samples(&self, channels: &[usize]) -> Result<usize> {
        if channels.is_empty() {
            return Err(DDAError::InvalidParameter(
                "no channels requested".to_string(),
            ));
        }
        // (samples per record, rate, labels) in order of first appearance.
        let mut groups: Vec<(usize, f64, Vec<&str>)> = Vec::new();
        for &c in channels {
            let channel = self.info.channels.get(c).ok_or_else(|| {
                DDAError::InvalidParameter(format!(
                    "channel {c} is out of range for {} channels",
                    self.info.channels.len()
                ))
            })?;
            if channel.kind != ChannelKind::Signal {
                return Err(DDAError::InvalidParameter(format!(
                    "channel {c} ({}) is a {:?} channel, not a signal",
                    channel.label, channel.kind
                )));
            }
            let samples = self.slots[c].samples;
            match groups.iter_mut().find(|g| g.0 == samples) {
                Some(group) => group.2.push(&channel.label),
                None => groups.push((samples, channel.sample_rate_hz, vec![&channel.label])),
            }
        }
        if groups.len() > 1 {
            let groups: Vec<String> = groups
                .iter()
                .map(|(_, rate, labels)| format!("{} use {rate} Hz", labels.join(", ")))
                .collect();
            return Err(DDAError::InvalidParameter(format!(
                "channels {}; choose channels of one rate",
                groups.join(" and ")
            )));
        }
        Ok(groups[0].0)
    }

    /// Calls `emit(row - row0, k, raw)` for the stored sample of `channels[k]` in each row of `row0..row0 + rows`.
    fn decode(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        mut emit: impl FnMut(usize, usize, i32),
    ) -> Result<()> {
        let samples = self.shared_samples(channels)? as u64;
        let total = self.records * samples;
        let end = row0
            .checked_add(rows as u64)
            .filter(|&end| end <= total)
            .ok_or_else(|| {
                DDAError::InvalidParameter(format!(
                    "rows {row0}..{row0}+{rows} pass the {total} rows of these channels"
                ))
            })?;
        if rows == 0 {
            return Ok(());
        }
        let records_per_read = (MAX_READ_BYTES / self.record_bytes).max(1) as u64;
        let mut buf = Vec::new();
        for first in (row0 / samples..=(end - 1) / samples).step_by(records_per_read as usize) {
            let last = (first + records_per_read).min((end - 1) / samples + 1);
            buf.resize((last - first) as usize * self.record_bytes, 0);
            self.source
                .read_at(self.data_start + first * self.record_bytes as u64, &mut buf)?;
            for record in first..last {
                let record_start = (record - first) as usize * self.record_bytes;
                for (k, &c) in channels.iter().enumerate() {
                    let at = record_start + self.slots[c].byte_offset;
                    for row in (record * samples).max(row0)..((record + 1) * samples).min(end) {
                        let from = at + (row - record * samples) as usize * self.bytes_per_sample;
                        let raw = &buf[from..from + self.bytes_per_sample];
                        // Little-endian two's complement; the 24-bit value is shifted up to take its sign.
                        let value = match raw {
                            [a, b] => i16::from_le_bytes([*a, *b]) as i32,
                            [a, b, c] => i32::from_le_bytes([0, *a, *b, *c]) >> 8,
                            _ => unreachable!("samples are 2 or 3 bytes"),
                        };
                        emit((row - row0) as usize, k, value);
                    }
                }
            }
        }
        Ok(())
    }
}

impl Reader for EdfReader {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        let mut out = vec![vec![0.0; channels.len()]; rows];
        self.decode(channels, row0, rows, |row, k, raw| {
            let channel = &self.info.channels[channels[k]];
            out[row][k] = raw as f64 * channel.gain + channel.offset;
        })?;
        Ok(out)
    }

    fn scan_annotations(&self) -> Result<(Vec<Annotation>, Vec<String>)> {
        let mut annotations = Vec::new();
        let (mut malformed, mut first_bad) = (0, None);
        for record in 0..self.records {
            for (n, c) in self.annotation_channels().enumerate() {
                let (tals, unparsed) = self.record_tals(record, c)?;
                // The first annotation channel opens every record with the timekeeping TAL.
                let missing = n == 0 && timekeeping(&tals).is_none();
                if unparsed > 0 || missing {
                    malformed += unparsed + missing as usize;
                    first_bad.get_or_insert(record);
                }
                let source = &self.info.channels[c].label;
                for (onset_s, duration_s, texts) in tals {
                    annotations.extend(texts.into_iter().map(|label| Annotation {
                        onset_s,
                        duration_s,
                        label,
                        source: source.clone(),
                    }));
                }
            }
        }
        let warnings = first_bad
            .map(|record| {
                format!("{malformed} malformed annotation entries, first in record {record}")
            })
            .into_iter()
            .collect();
        annotations.extend(self.info.annotations.iter().cloned());
        Ok((annotations, warnings))
    }

    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()> {
        if out.len() != rows * channels.len() {
            return Err(DDAError::InvalidParameter(format!(
                "output holds {} values, but {rows} rows of {} channels need {}",
                out.len(),
                channels.len(),
                rows * channels.len()
            )));
        }
        self.decode(channels, row0, rows, |row, k, raw| {
            out[row * channels.len() + k] = raw as f32
        })
    }
}
