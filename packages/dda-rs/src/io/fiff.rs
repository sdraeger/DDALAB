//! Pure-Rust Neuromag / Elekta / MEGIN / MNE FIFF (`.fif`) reader over `ByteSource`.
//!
//! Reads continuous raw measurements (`FIFFB_RAW_DATA`, `FIFFB_CONTINUOUS_DATA`,
//! `FIFFB_IAS_RAW_DATA`) with random-access buffer indexing, channel calibration (`range * cal * 10^unit_mul`),
//! MNE bad-channel lists (`FIFFB_MNE_BAD_CHANNELS`), and MNE annotations (`FIFFB_MNE_ANNOTATIONS`).
//! Works identically on native files, browser `File` handles, and streamed byte sources.

use super::recording::*;
use super::{ByteSource, FileSet};
use crate::error::{DDAError, Result};
use std::collections::HashSet;
use std::sync::Arc;

const TAG_HEADER_LEN: u64 = 16;

// Core FIFF tag kinds.
const FIFF_FILE_ID: i32 = 100;
const FIFF_BLOCK_START: i32 = 104;
const FIFF_BLOCK_END: i32 = 105;
const FIFF_NCHAN: i32 = 200;
const FIFF_SFREQ: i32 = 201;
const FIFF_CH_INFO: i32 = 203;
const FIFF_COMMENT: i32 = 206;
const FIFF_FIRST_SAMPLE: i32 = 208;
const FIFF_DATA_SKIP: i32 = 219;
const FIFF_DATA_SKIP_SAMP: i32 = 220;
const FIFF_DATA_BUFFER: i32 = 300;
const FIFF_MNE_CH_NAME_LIST: i32 = 3507;
const FIFF_MNE_BASELINE_MIN: i32 = 3568;
const FIFF_MNE_BASELINE_MAX: i32 = 3569;

// Core FIFF block kinds.
const FIFFB_MEAS_INFO: i32 = 101;
const FIFFB_RAW_DATA: i32 = 102;
const FIFFB_CONTINUOUS_DATA: i32 = 112;
const FIFFB_IAS_RAW_DATA: i32 = 119;
const FIFFB_MNE_BAD_CHANNELS: i32 = 359;
const FIFFB_MNE_ANNOTATIONS: i32 = 3810;

// FIFF tag navigation constants.
const FIFFV_NEXT_SEQ: i32 = 0;
const FIFFV_NEXT_NONE: i32 = -1;

// FIFF base data types (lower 16 bits of tag `type`).
const FIFFT_SHORT: i32 = 2;
const FIFFT_INT: i32 = 3;
const FIFFT_FLOAT: i32 = 4;
const FIFFT_DOUBLE: i32 = 5;
const FIFFT_DAU_PACK16: i32 = 16;

// FIFF channel kinds.
const FIFFV_STIM_CH: i32 = 3;

// FIFF units.
const FIFF_UNIT_V: i32 = 107;
const FIFF_UNIT_T: i32 = 112;
const FIFF_UNIT_T_M: i32 = 201;
const FIFF_UNIT_A: i32 = 106;
const FIFF_UNIT_S: i32 = 105;

const CH_INFO_BYTES: usize = 96;
/// Safety bound against cyclic `next` tag pointers in malformed files.
const MAX_TAGS: usize = 2_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SampleDtype {
    I16,
    I32,
    F32,
    F64,
}

impl SampleDtype {
    fn from_fiff_type(raw_type: i32) -> Option<Self> {
        match raw_type & 0xFFFF {
            FIFFT_SHORT | FIFFT_DAU_PACK16 => Some(Self::I16),
            FIFFT_INT => Some(Self::I32),
            FIFFT_FLOAT => Some(Self::F32),
            FIFFT_DOUBLE => Some(Self::F64),
            _ => None,
        }
    }

    fn bytes(self) -> usize {
        match self {
            Self::I16 => 2,
            Self::I32 | Self::F32 => 4,
            Self::F64 => 8,
        }
    }

    fn raw_type(self) -> RawType {
        match self {
            Self::I16 => RawType::I16,
            Self::I32 => RawType::I32,
            Self::F32 => RawType::F32,
            Self::F64 => RawType::F64,
        }
    }
}

#[derive(Debug, Clone)]
enum Segment {
    Buffer {
        start_row: u64,
        rows: u64,
        byte_offset: u64,
        dtype: SampleDtype,
    },
    Skip {
        start_row: u64,
        rows: u64,
    },
}

impl Segment {
    fn start_row(&self) -> u64 {
        match *self {
            Self::Buffer { start_row, .. } | Self::Skip { start_row, .. } => start_row,
        }
    }

    fn end_row(&self) -> u64 {
        match *self {
            Self::Buffer {
                start_row, rows, ..
            }
            | Self::Skip { start_row, rows } => start_row + rows,
        }
    }
}

pub struct FiffReader {
    info: RecordingInfo,
    source: Arc<dyn ByteSource>,
    n_channels: usize,
    segments: Vec<Segment>,
}

fn malformed(msg: impl Into<String>) -> DDAError {
    DDAError::ParseError(msg.into())
}

fn unsupported(msg: impl Into<String>) -> DDAError {
    DDAError::UnsupportedFileType(msg.into())
}

fn read_be_i32(bytes: &[u8]) -> i32 {
    i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn read_be_f32(bytes: &[u8]) -> f32 {
    f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn read_be_f64(bytes: &[u8]) -> f64 {
    f64::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ])
}

fn read_payload(source: &dyn ByteSource, offset: u64, size: i32) -> Result<Vec<u8>> {
    if size < 0 {
        return Err(malformed(format!("negative FIFF tag size: {size}")));
    }
    let len = size as usize;
    let mut buf = vec![0u8; len];
    if len > 0 {
        source.read_at(offset, &mut buf)?;
    }
    Ok(buf)
}

fn unit_str(code: i32) -> &'static str {
    match code {
        FIFF_UNIT_V => "V",
        FIFF_UNIT_T => "T",
        FIFF_UNIT_T_M => "T/m",
        FIFF_UNIT_A => "A",
        FIFF_UNIT_S => "s",
        _ => "",
    }
}

fn parse_ch_info(buf: &[u8], sfreq: f64) -> Result<ChannelInfo> {
    if buf.len() < CH_INFO_BYTES {
        return Err(malformed(format!(
            "FIFF_CH_INFO payload too short ({} bytes, expected {CH_INFO_BYTES})",
            buf.len()
        )));
    }
    let kind_code = read_be_i32(&buf[8..12]);
    let range = read_be_f32(&buf[12..16]) as f64;
    let cal = read_be_f32(&buf[16..20]) as f64;
    let unit_code = read_be_i32(&buf[72..76]);
    let unit_mul = read_be_i32(&buf[76..80]);
    let name_bytes = &buf[80..96];
    let nul = name_bytes.iter().position(|&b| b == 0).unwrap_or(16);
    let label = String::from_utf8_lossy(&name_bytes[..nul])
        .trim()
        .to_string();

    let kind = if kind_code == FIFFV_STIM_CH {
        ChannelKind::Status
    } else {
        ChannelKind::Signal
    };

    let mul = 10f64.powi(unit_mul.clamp(-24, 24));
    let gain = if range.is_finite() && cal.is_finite() {
        range * cal * mul
    } else {
        1.0
    };

    Ok(ChannelInfo {
        label,
        unit: unit_str(unit_code).to_string(),
        sample_rate_hz: sfreq,
        gain,
        offset: 0.0,
        kind,
        bids_status: None,
        bids_type: None,
    })
}

fn parse_float_array(buf: &[u8], dtype: i32) -> Vec<f64> {
    match dtype & 0xFFFF {
        FIFFT_DOUBLE => buf
            .chunks_exact(8)
            .map(read_be_f64)
            .collect(),
        FIFFT_FLOAT => buf
            .chunks_exact(4)
            .map(|c| read_be_f32(c) as f64)
            .collect(),
        _ => Vec::new(),
    }
}

pub fn open_fiff(files: &FileSet, name: &str) -> Result<Box<dyn Reader>> {
    let source = files
        .source(name)
        .ok_or_else(|| DDAError::FileNotFound(name.to_string()))?
        .clone();
    let len = source.len();
    if len < TAG_HEADER_LEN {
        return Err(unsupported(format!(
            "{name} is too small ({len} bytes) to be a FIFF file"
        )));
    }

    // Verify FIFF magic: first tag must be FIFF_FILE_ID (100) with a 20-byte id payload.
    let mut head = [0u8; 16];
    source.read_at(0, &mut head)?;
    let first_kind = read_be_i32(&head[0..4]);
    let first_size = read_be_i32(&head[8..12]);
    if first_kind != FIFF_FILE_ID || first_size != 20 {
        return Err(unsupported(format!(
            "{name} does not begin with a valid FIFF_FILE_ID header (kind={first_kind}, size={first_size})"
        )));
    }

    let mut pos: u64 = 0;
    let mut block_stack: Vec<i32> = Vec::new();
    let mut nchan_declared: Option<usize> = None;
    let mut sfreq: Option<f64> = None;
    let mut raw_ch_infos: Vec<Vec<u8>> = Vec::new();
    let mut bad_channels: HashSet<String> = HashSet::new();
    let mut annotations: Vec<Annotation> = Vec::new();

    // Pending annotation fields inside an active FIFFB_MNE_ANNOTATIONS block.
    let mut ann_onsets: Vec<f64> = Vec::new();
    let mut ann_durations: Vec<f64> = Vec::new();
    let mut ann_descriptions: Vec<String> = Vec::new();

    // Pending raw buffers & skips (resolved once nchan is finalized).
    enum RawOp {
        Buffer {
            byte_offset: u64,
            byte_size: usize,
            dtype: SampleDtype,
        },
        SkipBuffers(u64),
        SkipSamples(u64),
    }
    let mut raw_ops: Vec<RawOp> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut visited_tags = 0usize;

    while pos + TAG_HEADER_LEN <= len {
        visited_tags += 1;
        if visited_tags > MAX_TAGS {
            return Err(malformed(format!(
                "{name}: exceeded {MAX_TAGS} FIFF tags (possible pointer cycle)"
            )));
        }

        source.read_at(pos, &mut head)?;
        let kind = read_be_i32(&head[0..4]);
        let dtype = read_be_i32(&head[4..8]);
        let size = read_be_i32(&head[8..12]);
        let next = read_be_i32(&head[12..16]);

        if size < 0 {
            return Err(malformed(format!(
                "{name}: negative FIFF tag size {size} at offset {pos}"
            )));
        }
        let payload_offset = pos + TAG_HEADER_LEN;
        let payload_end = payload_offset
            .checked_add(size as u64)
            .ok_or_else(|| malformed(format!("{name}: FIFF tag offset overflow")))?;
        if payload_end > len {
            warnings.push(format!(
                "FIFF tag kind {kind} at offset {pos} extends past end of file; truncating."
            ));
            break;
        }

        let in_meas_info = block_stack.contains(&FIFFB_MEAS_INFO);
        let in_raw = block_stack.iter().any(|&b| {
            b == FIFFB_RAW_DATA || b == FIFFB_CONTINUOUS_DATA || b == FIFFB_IAS_RAW_DATA
        });
        let in_bads = block_stack.contains(&FIFFB_MNE_BAD_CHANNELS);
        let in_anns = block_stack.contains(&FIFFB_MNE_ANNOTATIONS);

        match kind {
            FIFF_BLOCK_START if size >= 4 => {
                let buf = read_payload(source.as_ref(), payload_offset, 4)?;
                let blk = read_be_i32(&buf);
                block_stack.push(blk);
                if blk == FIFFB_MNE_ANNOTATIONS {
                    ann_onsets.clear();
                    ann_durations.clear();
                    ann_descriptions.clear();
                }
            }
            FIFF_BLOCK_END => {
                if let Some(ended) = block_stack.pop() {
                    if ended == FIFFB_MNE_ANNOTATIONS {
                        let count = ann_onsets
                            .len()
                            .min(ann_durations.len())
                            .min(ann_descriptions.len());
                        for i in 0..count {
                            let onset_s = ann_onsets[i];
                            let duration_s = ann_durations[i].max(0.0);
                            if onset_s.is_finite() && duration_s.is_finite() {
                                annotations.push(Annotation {
                                    onset_s,
                                    duration_s,
                                    label: ann_descriptions[i].clone(),
                                    source: "FIFF".to_string(),
                                });
                            }
                        }
                    }
                }
            }
            FIFF_NCHAN if in_meas_info && size >= 4 => {
                let buf = read_payload(source.as_ref(), payload_offset, 4)?;
                let n = read_be_i32(&buf);
                if n > 0 {
                    nchan_declared = Some(n as usize);
                }
            }
            FIFF_SFREQ if in_meas_info && size >= 4 => {
                let buf = read_payload(source.as_ref(), payload_offset, 4)?;
                let rate = if (dtype & 0xFFFF) == FIFFT_DOUBLE && size >= 8 {
                    let full = read_payload(source.as_ref(), payload_offset, 8)?;
                    read_be_f64(&full)
                } else {
                    read_be_f32(&buf) as f64
                };
                if rate.is_finite() && rate > 0.0 {
                    sfreq = Some(rate);
                }
            }
            FIFF_CH_INFO if in_meas_info && size >= CH_INFO_BYTES as i32 => {
                raw_ch_infos.push(read_payload(source.as_ref(), payload_offset, size)?);
            }
            FIFF_MNE_CH_NAME_LIST if in_bads && size > 0 => {
                let buf = read_payload(source.as_ref(), payload_offset, size)?;
                let text = String::from_utf8_lossy(&buf);
                for ch in text.trim_end_matches('\0').split(':') {
                    let trimmed = ch.trim();
                    if !trimmed.is_empty() {
                        bad_channels.insert(trimmed.to_string());
                    }
                }
            }
            FIFF_MNE_BASELINE_MIN if in_anns && size > 0 => {
                let buf = read_payload(source.as_ref(), payload_offset, size)?;
                ann_onsets = parse_float_array(&buf, dtype);
            }
            FIFF_MNE_BASELINE_MAX if in_anns && size > 0 => {
                let buf = read_payload(source.as_ref(), payload_offset, size)?;
                ann_durations = parse_float_array(&buf, dtype);
            }
            FIFF_COMMENT if in_anns && size > 0 => {
                let buf = read_payload(source.as_ref(), payload_offset, size)?;
                let text = String::from_utf8_lossy(&buf);
                ann_descriptions = text
                    .trim_end_matches('\0')
                    .split(':')
                    .map(|s| s.to_string())
                    .collect();
            }
            FIFF_FIRST_SAMPLE if in_raw && size >= 4 => {
                // Informational; raw timeline starts at sample 0 of the continuous buffer.
            }
            FIFF_DATA_BUFFER if in_raw => {
                let Some(sdtype) = SampleDtype::from_fiff_type(dtype) else {
                    return Err(unsupported(format!(
                        "{name}: unsupported FIFF_DATA_BUFFER data type 0x{:x}",
                        dtype & 0xFFFF
                    )));
                };
                raw_ops.push(RawOp::Buffer {
                    byte_offset: payload_offset,
                    byte_size: size as usize,
                    dtype: sdtype,
                });
            }
            FIFF_DATA_SKIP if in_raw && size >= 4 => {
                let buf = read_payload(source.as_ref(), payload_offset, 4)?;
                let count = read_be_i32(&buf);
                if count > 0 {
                    raw_ops.push(RawOp::SkipBuffers(count as u64));
                }
            }
            FIFF_DATA_SKIP_SAMP if in_raw && size >= 4 => {
                let buf = read_payload(source.as_ref(), payload_offset, 4)?;
                let count = read_be_i32(&buf);
                if count > 0 {
                    raw_ops.push(RawOp::SkipSamples(count as u64));
                }
            }
            _ => {}
        }

        if next == FIFFV_NEXT_NONE {
            break;
        } else if next == FIFFV_NEXT_SEQ {
            pos = payload_end;
        } else if next > 0 {
            let next_pos = next as u64;
            if next_pos <= pos {
                break;
            }
            pos = next_pos;
        } else {
            break;
        }
    }

    let sample_rate_hz = sfreq.ok_or_else(|| {
        unsupported(format!(
            "{name}: FIFF file has no valid FIFF_SFREQ in FIFFB_MEAS_INFO"
        ))
    })?;
    let n_channels = nchan_declared.unwrap_or(raw_ch_infos.len());
    if n_channels == 0 {
        return Err(unsupported(format!(
            "{name}: FIFF file declares 0 channels"
        )));
    }

    let mut channels = Vec::with_capacity(n_channels);
    if raw_ch_infos.is_empty() {
        for i in 0..n_channels {
            channels.push(ChannelInfo {
                label: format!("ch{i}"),
                unit: "V".to_string(),
                sample_rate_hz,
                gain: 1.0,
                offset: 0.0,
                kind: ChannelKind::Signal,
                bids_status: None,
                bids_type: None,
            });
        }
    } else {
        for (i, raw) in raw_ch_infos.iter().take(n_channels).enumerate() {
            let mut ch = parse_ch_info(raw, sample_rate_hz)?;
            if ch.label.is_empty() {
                ch.label = format!("ch{i}");
            }
            if bad_channels.contains(&ch.label) {
                ch.bids_status = Some("bad".to_string());
            }
            channels.push(ch);
        }
    }

    // Build segment table with cumulative row offsets.
    let mut segments: Vec<Segment> = Vec::with_capacity(raw_ops.len());
    let mut cursor: u64 = 0;
    let mut last_buf_rows: u64 = 0;
    let mut first_dtype: Option<SampleDtype> = None;

    // Pre-scan first buffer size in case FIFF_DATA_SKIP appears before the first buffer.
    for op in &raw_ops {
        if let RawOp::Buffer {
            byte_size, dtype, ..
        } = *op
        {
            let row_bytes = n_channels * dtype.bytes();
            if row_bytes > 0 {
                last_buf_rows = (byte_size / row_bytes) as u64;
                first_dtype = Some(dtype);
                break;
            }
        }
    }

    for op in raw_ops {
        match op {
            RawOp::Buffer {
                byte_offset,
                byte_size,
                dtype,
            } => {
                let row_bytes = n_channels * dtype.bytes();
                if row_bytes == 0 || byte_size < row_bytes {
                    continue;
                }
                if byte_size % row_bytes != 0 {
                    warnings.push(format!(
                        "FIFF data buffer at offset {byte_offset} ({byte_size} bytes) is not a multiple of frame size {row_bytes}."
                    ));
                }
                let rows = (byte_size / row_bytes) as u64;
                last_buf_rows = rows;
                first_dtype.get_or_insert(dtype);
                segments.push(Segment::Buffer {
                    start_row: cursor,
                    rows,
                    byte_offset,
                    dtype,
                });
                cursor += rows;
            }
            RawOp::SkipBuffers(n_bufs) => {
                let rows = n_bufs.saturating_mul(last_buf_rows);
                if rows > 0 {
                    segments.push(Segment::Skip {
                        start_row: cursor,
                        rows,
                    });
                    cursor += rows;
                }
            }
            RawOp::SkipSamples(rows) => {
                if rows > 0 {
                    segments.push(Segment::Skip {
                        start_row: cursor,
                        rows,
                    });
                    cursor += rows;
                }
            }
        }
    }

    if cursor == 0 {
        return Err(unsupported(format!(
            "{name}: FIFF file contains no continuous raw data buffers (FIFFB_RAW_DATA)"
        )));
    }

    let raw_type = first_dtype.map_or(RawType::F32, SampleDtype::raw_type);
    let info = RecordingInfo {
        reference: None,
        format: "FIFF".to_string(),
        channels,
        sample_rate_hz,
        sample_count: cursor,
        duration_s: cursor as f64 / sample_rate_hz,
        raw_type,
        annotations,
        warnings,
        input_files: vec![name.to_string()],
    };

    Ok(Box::new(FiffReader {
        info,
        source,
        n_channels,
        segments,
    }))
}

impl FiffReader {
    fn check_channels(&self, channels: &[usize]) -> Result<()> {
        for &c in channels {
            if c >= self.n_channels {
                return Err(DDAError::InvalidParameter(format!(
                    "channel index {c} out of range (recording has {} channels)",
                    self.n_channels
                )));
            }
        }
        Ok(())
    }

    fn decode(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        mut emit: impl FnMut(usize, usize, f64),
    ) -> Result<()> {
        self.check_channels(channels)?;
        if rows == 0 || channels.is_empty() {
            return Ok(());
        }
        let end = row0
            .checked_add(rows as u64)
            .ok_or_else(|| DDAError::InvalidParameter("row range overflow".to_string()))?;
        if end > self.info.sample_count {
            return Err(DDAError::InvalidParameter(format!(
                "requested rows {row0}..{end} exceed sample count {}",
                self.info.sample_count
            )));
        }

        // Binary search first segment whose end_row > row0.
        let mut seg_idx = self.segments.partition_point(|s| s.end_row() <= row0);
        let mut buf: Vec<u8> = Vec::new();

        while seg_idx < self.segments.len() {
            let seg = &self.segments[seg_idx];
            if seg.start_row() >= end {
                break;
            }
            let r_start = row0.max(seg.start_row());
            let r_end = end.min(seg.end_row());
            let count = (r_end - r_start) as usize;

            match *seg {
                Segment::Skip { .. } => {
                    for r in 0..count {
                        let out_row = (r_start - row0) as usize + r;
                        for k in 0..channels.len() {
                            emit(out_row, k, 0.0);
                        }
                    }
                }
                Segment::Buffer {
                    start_row,
                    byte_offset,
                    dtype,
                    ..
                } => {
                    let elem = dtype.bytes();
                    let frame_bytes = self.n_channels * elem;
                    let rel_row = r_start - start_row;
                    let read_offset = byte_offset + rel_row * frame_bytes as u64;
                    let total_bytes = count * frame_bytes;
                    buf.resize(total_bytes, 0);
                    self.source.read_at(read_offset, &mut buf)?;

                    for r in 0..count {
                        let out_row = (r_start - row0) as usize + r;
                        let frame = &buf[r * frame_bytes..(r + 1) * frame_bytes];
                        for (k, &ch) in channels.iter().enumerate() {
                            let off = ch * elem;
                            let val = match dtype {
                                SampleDtype::I16 => {
                                    i16::from_be_bytes([frame[off], frame[off + 1]]) as f64
                                }
                                SampleDtype::I32 => read_be_i32(&frame[off..off + 4]) as f64,
                                SampleDtype::F32 => read_be_f32(&frame[off..off + 4]) as f64,
                                SampleDtype::F64 => read_be_f64(&frame[off..off + 8]),
                            };
                            emit(out_row, k, val);
                        }
                    }
                }
            }
            seg_idx += 1;
        }
        Ok(())
    }
}

impl Reader for FiffReader {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        let mut out = vec![vec![0.0; channels.len()]; rows];
        self.decode(channels, row0, rows, |r, k, raw| {
            let ch = &self.info.channels[channels[k]];
            out[r][k] = raw * ch.gain + ch.offset;
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
        self.decode(channels, row0, rows, |r, k, raw| {
            out[r * channels.len() + k] = raw as f32;
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemorySource;
    use std::collections::BTreeMap;

    fn push_tag(out: &mut Vec<u8>, kind: i32, dtype: i32, payload: &[u8]) {
        out.extend_from_slice(&kind.to_be_bytes());
        out.extend_from_slice(&dtype.to_be_bytes());
        out.extend_from_slice(&(payload.len() as i32).to_be_bytes());
        out.extend_from_slice(&FIFFV_NEXT_SEQ.to_be_bytes());
        out.extend_from_slice(payload);
    }

    fn ch_info_bytes(name: &str, kind: i32, range: f32, cal: f32, unit: i32, unit_mul: i32) -> Vec<u8> {
        let mut b = vec![0u8; CH_INFO_BYTES];
        b[8..12].copy_from_slice(&kind.to_be_bytes());
        b[12..16].copy_from_slice(&range.to_be_bytes());
        b[16..20].copy_from_slice(&cal.to_be_bytes());
        b[72..76].copy_from_slice(&unit.to_be_bytes());
        b[76..80].copy_from_slice(&unit_mul.to_be_bytes());
        let bytes = name.as_bytes();
        let n = bytes.len().min(16);
        b[80..80 + n].copy_from_slice(&bytes[..n]);
        b
    }

    fn build_synthetic_fiff() -> Vec<u8> {
        let mut out = Vec::new();
        // FIFF_FILE_ID (20 bytes)
        push_tag(&mut out, FIFF_FILE_ID, 103, &[0u8; 20]);

        // FIFFB_MEAS_INFO
        push_tag(&mut out, FIFF_BLOCK_START, FIFFT_INT, &FIFFB_MEAS_INFO.to_be_bytes());
        push_tag(&mut out, FIFF_NCHAN, FIFFT_INT, &3i32.to_be_bytes());
        push_tag(&mut out, FIFF_SFREQ, FIFFT_FLOAT, &250.0f32.to_be_bytes());
        push_tag(&mut out, FIFF_CH_INFO, 30, &ch_info_bytes("Fp1", 2, 1.0, 1e-6, FIFF_UNIT_V, 0));
        push_tag(&mut out, FIFF_CH_INFO, 30, &ch_info_bytes("Fp2", 2, 2.0, 1e-3, FIFF_UNIT_V, -3));
        push_tag(&mut out, FIFF_CH_INFO, 30, &ch_info_bytes("STI 014", FIFFV_STIM_CH, 1.0, 1.0, 0, 0));
        // Bad channel list
        push_tag(&mut out, FIFF_BLOCK_START, FIFFT_INT, &FIFFB_MNE_BAD_CHANNELS.to_be_bytes());
        push_tag(&mut out, FIFF_MNE_CH_NAME_LIST, 10, b"Fp2");
        push_tag(&mut out, FIFF_BLOCK_END, FIFFT_INT, &FIFFB_MNE_BAD_CHANNELS.to_be_bytes());
        push_tag(&mut out, FIFF_BLOCK_END, FIFFT_INT, &FIFFB_MEAS_INFO.to_be_bytes());

        // FIFFB_MNE_ANNOTATIONS
        push_tag(&mut out, FIFF_BLOCK_START, FIFFT_INT, &FIFFB_MNE_ANNOTATIONS.to_be_bytes());
        let mut onsets = Vec::new();
        onsets.extend_from_slice(&0.5f64.to_be_bytes());
        onsets.extend_from_slice(&2.0f64.to_be_bytes());
        push_tag(&mut out, FIFF_MNE_BASELINE_MIN, FIFFT_DOUBLE, &onsets);
        let mut durs = Vec::new();
        durs.extend_from_slice(&0.25f64.to_be_bytes());
        durs.extend_from_slice(&1.0f64.to_be_bytes());
        push_tag(&mut out, FIFF_MNE_BASELINE_MAX, FIFFT_DOUBLE, &durs);
        push_tag(&mut out, FIFF_COMMENT, 10, b"onset:seizure");
        push_tag(&mut out, FIFF_BLOCK_END, FIFFT_INT, &FIFFB_MNE_ANNOTATIONS.to_be_bytes());

        // FIFFB_RAW_DATA: buffer of 4 samples (f32), skip 2 samples, buffer of 4 samples (i16)
        push_tag(&mut out, FIFF_BLOCK_START, FIFFT_INT, &FIFFB_RAW_DATA.to_be_bytes());
        let mut buf1 = Vec::new();
        for s in 0..4 {
            buf1.extend_from_slice(&((s as f32) + 1.0).to_be_bytes());
            buf1.extend_from_slice(&((s as f32) * 10.0).to_be_bytes());
            buf1.extend_from_slice(&0.0f32.to_be_bytes());
        }
        push_tag(&mut out, FIFF_DATA_BUFFER, FIFFT_FLOAT, &buf1);
        push_tag(&mut out, FIFF_DATA_SKIP_SAMP, FIFFT_INT, &2i32.to_be_bytes());
        let mut buf2 = Vec::new();
        for s in 0..4i16 {
            buf2.extend_from_slice(&(100 + s).to_be_bytes());
            buf2.extend_from_slice(&(-50 - s).to_be_bytes());
            buf2.extend_from_slice(&1i16.to_be_bytes());
        }
        push_tag(&mut out, FIFF_DATA_BUFFER, FIFFT_SHORT, &buf2);
        push_tag(&mut out, FIFF_BLOCK_END, FIFFT_INT, &FIFFB_RAW_DATA.to_be_bytes());

        // EOF sentinel tag
        out.extend_from_slice(&0i32.to_be_bytes());
        out.extend_from_slice(&0i32.to_be_bytes());
        out.extend_from_slice(&0i32.to_be_bytes());
        out.extend_from_slice(&FIFFV_NEXT_NONE.to_be_bytes());
        out
    }

    #[test]
    fn fiff_reads_channels_calibration_skips_bads_and_annotations() {
        let bytes = build_synthetic_fiff();
        let mut files = BTreeMap::new();
        files.insert(
            "sample_raw.fif".to_string(),
            Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>,
        );
        let set = FileSet {
            primary: "sample_raw.fif".to_string(),
            files,
        };
        let reader = open_fiff(&set, "sample_raw.fif").unwrap();
        let info = reader.info();
        assert_eq!(info.format, "FIFF");
        assert_eq!(info.sample_rate_hz, 250.0);
        assert_eq!(info.sample_count, 10);
        assert_eq!(info.channels.len(), 3);
        assert_eq!(info.channels[0].label, "Fp1");
        assert_eq!(info.channels[0].unit, "V");
        assert_eq!(info.channels[1].bids_status.as_deref(), Some("bad"));
        assert_eq!(info.channels[2].kind, ChannelKind::Status);
        assert_eq!(info.analysis_channels(), vec![0, 1]);

        let (anns, _) = reader.scan_annotations().unwrap();
        assert_eq!(anns.len(), 2);
        assert_eq!(anns[0].label, "onset");
        assert_eq!(anns[1].label, "seizure");
        assert_eq!(anns[1].onset_s, 2.0);
        assert_eq!(anns[1].duration_s, 1.0);

        // Read across buffer1 -> skip -> buffer2 boundary (rows 2..8).
        let rows = reader.read_rows(&[0, 1], 2, 6).unwrap();
        assert_eq!(rows.len(), 6);
        // Row 2 (buffer1 sample 2): Fp1 = 3.0 * 1e-6, Fp2 = 20.0 * 2e-6 (range/cal are f32 in FIFF)
        assert!((rows[0][0] - 3e-6).abs() < 1e-11);
        assert!((rows[0][1] - 40e-6).abs() < 1e-10);
        // Row 4, 5 (skipped): 0.0
        assert_eq!(rows[2], vec![0.0, 0.0]);
        assert_eq!(rows[3], vec![0.0, 0.0]);
        // Row 6 (buffer2 sample 0): Fp1 = 100 * 1e-6, Fp2 = -50 * 2e-6
        assert!((rows[4][0] - 100e-6).abs() < 1e-10);
        assert!((rows[4][1] - (-100e-6)).abs() < 1e-10);
    }

    #[test]
    fn fiff_rejects_non_fiff_file() {
        let mut files = BTreeMap::new();
        files.insert(
            "bad.fif".to_string(),
            Arc::new(MemorySource(vec![0u8; 64])) as Arc<dyn ByteSource>,
        );
        let set = FileSet {
            primary: "bad.fif".to_string(),
            files,
        };
        assert!(open_fiff(&set, "bad.fif").is_err());
    }
}
