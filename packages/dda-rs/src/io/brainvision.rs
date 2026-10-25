//! BrainVision reader (BrainVision Core Data Format 1.0): an INI `.vhdr` header, a binary little-endian data file
//! laid out sample by sample (`MULTIPLEXED`) or channel by channel (`VECTORIZED`), and a `.vmrk` marker file.

use super::recording::*;
use super::{ByteSource, FileSet};
use crate::error::{DDAError, Result};
use std::sync::Arc;

/// Most bytes one `read_at` fetches, which keeps a long request from holding its whole span in memory.
const MAX_READ_BYTES: usize = 8 << 20;

fn unsupported(message: String) -> DDAError {
    DDAError::UnsupportedFileType(message)
}

#[derive(Clone, Copy)]
enum Binary {
    Int16,
    Uint16,
    Int32,
    Float32,
}

impl Binary {
    fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_uppercase().as_str() {
            "INT_16" => Some(Self::Int16),
            "UINT_16" => Some(Self::Uint16),
            "INT_32" => Some(Self::Int32),
            "IEEE_FLOAT_32" => Some(Self::Float32),
            _ => None,
        }
    }

    fn bytes(self) -> usize {
        match self {
            Self::Int16 | Self::Uint16 => 2,
            Self::Int32 | Self::Float32 => 4,
        }
    }

    /// `UINT_16` reports `I32`: its values pass 32767 and would wrap in an i16 store.
    fn raw_type(self) -> RawType {
        match self {
            Self::Int16 => RawType::I16,
            Self::Uint16 | Self::Int32 => RawType::I32,
            Self::Float32 => RawType::F32,
        }
    }

    /// The sample in the first `self.bytes()` bytes of `b`; exact in `f64` for every type.
    fn decode(self, b: &[u8]) -> f64 {
        match self {
            Self::Int16 => i16::from_le_bytes([b[0], b[1]]) as f64,
            Self::Uint16 => u16::from_le_bytes([b[0], b[1]]) as f64,
            Self::Int32 => i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
            Self::Float32 => f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
        }
    }
}

/// `(section, key, value)` of one `key=value` line.
type Entry = (String, String, String);

/// The entries of an INI file in UTF-8, or Latin-1 when the bytes are not valid UTF-8; `;` lines are comments.
fn parse_ini(bytes: &[u8]) -> Vec<Entry> {
    let text = std::str::from_utf8(bytes)
        .map(str::to_string)
        .unwrap_or_else(|_| bytes.iter().map(|&b| b as char).collect());
    let mut section = String::new();
    let mut entries = Vec::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with(';'))
    {
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            section = name.trim().to_string();
        } else if let Some((key, value)) = line.split_once('=') {
            entries.push((
                section.clone(),
                key.trim().to_string(),
                value.trim().to_string(),
            ));
        }
    }
    entries
}

fn get<'a>(ini: &'a [Entry], section: &str, key: &str) -> Option<&'a str> {
    ini.iter()
        .find(|(s, k, _)| s.eq_ignore_ascii_case(section) && k.eq_ignore_ascii_case(key))
        .map(|(_, _, value)| value.as_str())
}

/// The file name without any directory the header gives. This keeps a header from pointing outside its file set.
fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// A channel or marker name; the format writes a comma as `\1`.
fn name(raw: &str) -> String {
    raw.replace("\\1", ",")
}

fn malformed(what: &str, text: &str) -> DDAError {
    unsupported(format!("header field '{what}' is malformed: '{text}'"))
}

fn float(what: &str, text: &str) -> Result<f64> {
    text.parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
        .ok_or_else(|| malformed(what, text))
}

/// The SI unit and the factor from a header unit to it; an empty unit means microvolts.
fn si_unit(unit: &str) -> (&str, f64) {
    match unit {
        // Micro sign U+00B5 (Latin-1 byte 0xB5) or Greek mu U+03BC.
        "" | "uV" | "\u{b5}V" | "\u{3bc}V" => ("V", 1e-6),
        "mV" => ("V", 1e-3),
        "nV" => ("V", 1e-9),
        "V" => ("V", 1.0),
        other => (other, 1.0),
    }
}

fn read_all(source: &Arc<dyn ByteSource>) -> Result<Vec<u8>> {
    let mut bytes = vec![0u8; source.len() as usize];
    source.read_at(0, &mut bytes)?;
    Ok(bytes)
}

/// `<type>,<description>,<position>,<points>,...` as an annotation, or `None` when position or points is not an integer.
/// Positions count from 1; position 0 gives onset 0, as in MNE.
fn marker(value: &str, rate: f64) -> Option<Annotation> {
    let mut fields = value.split(',');
    let (kind, description) = (fields.next()?, fields.next()?);
    let position: i64 = fields.next()?.trim().parse().ok()?;
    let points: i64 = fields.next()?.trim().parse().ok()?;
    Some(Annotation {
        onset_s: (position - 1).max(0) as f64 / rate,
        duration_s: points as f64 / rate,
        label: name(if description.is_empty() {
            kind
        } else {
            description
        }),
        source: "vmrk".to_string(),
    })
}

/// The markers of a `.vmrk` and the warning for entries that did not parse.
fn markers(vmrk: &[u8], rate: f64) -> (Vec<Annotation>, Option<String>) {
    let mut annotations = Vec::new();
    let (mut bad, mut first_bad) = (0, None);
    for (section, key, value) in parse_ini(vmrk) {
        let is_marker = key.get(..2).is_some_and(|p| p.eq_ignore_ascii_case("Mk"));
        if section.eq_ignore_ascii_case("Marker Infos") && is_marker {
            match marker(&value, rate) {
                Some(annotation) => annotations.push(annotation),
                None => {
                    bad += 1;
                    first_bad.get_or_insert(key);
                }
            }
        }
    }
    let warning = first_bad.map(|key| format!("{bad} malformed marker entries, first {key}"));
    (annotations, warning)
}

struct BrainVisionReader {
    info: RecordingInfo,
    source: Arc<dyn ByteSource>,
    binary: Binary,
    vectorized: bool,
    frame_bytes: usize,
}

pub fn open_brainvision(files: &FileSet, vhdr_name: &str) -> Result<Box<dyn Reader>> {
    let header = files
        .source(vhdr_name)
        .ok_or_else(|| DDAError::FileNotFound(vhdr_name.to_string()))?;
    let ini = parse_ini(&read_all(header)?);
    let need = |section: &str, key: &str| {
        get(&ini, section, key)
            .ok_or_else(|| unsupported(format!("{vhdr_name} has no {key} in [{section}]")))
    };

    match need("Common Infos", "DataFormat")?
        .to_ascii_uppercase()
        .as_str()
    {
        "BINARY" => {}
        "ASCII" => {
            return Err(unsupported(
                "BrainVision ASCII data is not supported yet".to_string(),
            ))
        }
        other => {
            return Err(unsupported(format!(
                "BrainVision DataFormat '{other}' is not supported"
            )))
        }
    }
    let orientation = need("Common Infos", "DataOrientation")?;
    let vectorized = match orientation.to_ascii_uppercase().as_str() {
        "MULTIPLEXED" => false,
        "VECTORIZED" => true,
        _ => {
            return Err(unsupported(format!(
                "BrainVision DataOrientation '{orientation}' is not supported"
            )))
        }
    };
    let binary_format = need("Binary Infos", "BinaryFormat")?;
    let binary = Binary::parse(binary_format).ok_or_else(|| {
        unsupported(format!(
            "BrainVision BinaryFormat '{binary_format}' is not supported"
        ))
    })?;
    let channel_count = need("Common Infos", "NumberOfChannels")?;
    let channel_count: usize = channel_count
        .parse()
        .ok()
        .filter(|&n| n >= 1)
        .ok_or_else(|| malformed("NumberOfChannels", channel_count))?;
    let interval = need("Common Infos", "SamplingInterval")?;
    let interval = float("SamplingInterval", interval)
        .ok()
        .filter(|&us| us > 0.0)
        .ok_or_else(|| malformed("SamplingInterval", interval))?;
    let rate = 1e6 / interval;

    let data_name = base_name(need("Common Infos", "DataFile")?);
    let source = files
        .source(data_name)
        .ok_or_else(|| {
            DDAError::FileNotFound(format!(
                "{vhdr_name} names {data_name}, which is not among the opened files"
            ))
        })?
        .clone();

    let channels = (1..=channel_count)
        .map(|i| {
            let key = format!("Ch{i}");
            let line = need("Channel Infos", &key)?;
            // Name, reference, resolution, unit.
            let mut fields = line.split(',').map(str::trim);
            let label = name(fields.next().unwrap_or_default());
            let resolution = match fields.nth(1) {
                None | Some("") => 1.0,
                Some(text) => float(&format!("{key} resolution"), text)?,
            };
            let (unit, factor) = si_unit(fields.next().unwrap_or_default());
            Ok(ChannelInfo {
                label,
                unit: unit.to_string(),
                sample_rate_hz: rate,
                gain: resolution * factor,
                offset: 0.0,
                kind: ChannelKind::Signal,
                bids_status: None,
                bids_type: None,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let frame_bytes = channel_count * binary.bytes();
    let data_bytes = source.len();
    let sample_count = data_bytes / frame_bytes as u64;
    let declared = get(&ini, "Common Infos", "DataPoints")
        .filter(|text| text.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|text| text.parse::<u64>().ok());
    // Channel c starts at c * points * bytes. A VECTORIZED file of any other length has untrustworthy offsets.
    let complete_blocks = match declared {
        Some(points) => points.checked_mul(frame_bytes as u64) == Some(data_bytes),
        None => data_bytes % frame_bytes as u64 == 0,
    };
    if vectorized && !complete_blocks {
        return Err(unsupported(format!(
            "truncated VECTORIZED BrainVision data: {data_bytes} bytes do not hold {channel_count} complete channel blocks"
        )));
    }
    let mut warnings = Vec::new();
    if data_bytes % frame_bytes as u64 != 0 {
        warnings.push(format!(
            "The data file {data_name} ends with {} bytes of an incomplete sample frame of {frame_bytes} bytes.",
            data_bytes % frame_bytes as u64
        ));
    }
    if let Some(declared) = declared.filter(|&declared| declared > sample_count) {
        warnings.push(format!(
            "The header declares {declared} samples, but the data file {data_name} holds {sample_count}."
        ));
    }

    let mut input_files = vec![vhdr_name.to_string(), data_name.to_string()];
    let mut annotations = Vec::new();
    if let Some(marker_name) = get(&ini, "Common Infos", "MarkerFile")
        .map(base_name)
        .filter(|marker_name| !marker_name.is_empty())
    {
        match files.source(marker_name) {
            Some(vmrk) => {
                input_files.push(marker_name.to_string());
                let (found, warning) = markers(&read_all(vmrk)?, rate);
                annotations = found;
                warnings.extend(warning);
            }
            None => warnings.push(format!(
                "{vhdr_name} names {marker_name}, which is not among the opened files; its markers are not loaded."
            )),
        }
    }

    Ok(Box::new(BrainVisionReader {
        info: RecordingInfo {
            format: "BrainVision".to_string(),
            channels,
            sample_rate_hz: rate,
            sample_count,
            duration_s: sample_count as f64 / rate,
            raw_type: binary.raw_type(),
            annotations,
            warnings,
            input_files,
        },
        source,
        binary,
        vectorized,
        frame_bytes,
    }))
}

impl BrainVisionReader {
    /// Calls `emit(row - row0, k, raw)` for the stored sample of `channels[k]` in each row of `row0..row0 + rows`.
    /// The caller has run `check_read`.
    fn decode(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        mut emit: impl FnMut(usize, usize, f64),
    ) -> Result<()> {
        let width = self.binary.bytes();
        let per_read = (MAX_READ_BYTES / self.frame_bytes).max(1);
        let mut buf = Vec::new();
        for first in (0..rows).step_by(per_read) {
            let n = per_read.min(rows - first);
            let row = row0 + first as u64;
            if self.vectorized {
                buf.resize(n * width, 0);
                for (k, &c) in channels.iter().enumerate() {
                    let at = (c as u64 * self.info.sample_count + row) * width as u64;
                    self.source.read_at(at, &mut buf)?;
                    for i in 0..n {
                        emit(first + i, k, self.binary.decode(&buf[i * width..]));
                    }
                }
            } else {
                buf.resize(n * self.frame_bytes, 0);
                self.source
                    .read_at(row * self.frame_bytes as u64, &mut buf)?;
                for (k, &c) in channels.iter().enumerate() {
                    for i in 0..n {
                        let from = i * self.frame_bytes + c * width;
                        emit(first + i, k, self.binary.decode(&buf[from..]));
                    }
                }
            }
        }
        Ok(())
    }
}

impl Reader for BrainVisionReader {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        self.info.check_read(channels, row0, rows)?;
        let mut out = vec![vec![0.0; channels.len()]; rows];
        self.decode(channels, row0, rows, |row, k, raw| {
            let channel = &self.info.channels[channels[k]];
            out[row][k] = raw * channel.gain + channel.offset;
        })?;
        Ok(out)
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
        self.info.check_read(channels, row0, rows)?;
        self.decode(channels, row0, rows, |row, k, raw| {
            out[row * channels.len() + k] = raw as f32
        })
    }
}
