//! EEGLAB datasets (`.set`): a MAT-file (mat.rs) holding the EEG structure, as one variable `EEG` or as its fields at
//! the top level (EEGLAB 2019 and later). The samples are in the `.fdt` file `EEG.data` names (float32, channel by
//! channel within each sample) or in `EEG.data` itself, read where it lies in an uncompressed file. Continuous datasets
//! only: an epoched one (more than one trial) is refused. EEGLAB keeps microvolts. Events are `EEG.event`, at 1-based
//! sample latencies.

use super::mat::{read_mat, Mat, Storage};
use super::recording::*;
use super::{ByteSource, FileSet};
use crate::error::{DDAError, Result};
use std::sync::Arc;

/// Most bytes one `read_at` fetches, which keeps a long request from holding its whole span in memory.
const MAX_READ_BYTES: usize = 8 << 20;

fn unsupported(message: String) -> DDAError {
    DDAError::UnsupportedFileType(message)
}

/// The file name without any directory, which keeps a dataset from pointing outside its file set.
fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

struct EeglabReader {
    info: RecordingInfo,
    source: Arc<dyn ByteSource>,
    storage: Storage,
    frame_bytes: usize,
}

pub fn open_eeglab(files: &FileSet, set_name: &str) -> Result<Box<dyn Reader>> {
    let source = files
        .source(set_name)
        .ok_or_else(|| DDAError::FileNotFound(set_name.to_string()))?;
    let mut variables = read_mat(source)?;
    // EEG's fields: those of the variable EEG, else the top-level variables.
    let wrapped = variables
        .iter()
        .position(|(name, value)| name == "EEG" && matches!(value, Mat::Struct { .. }));
    let mut fields: Vec<(String, Mat)> = match wrapped {
        Some(i) => match variables.swap_remove(i).1 {
            Mat::Struct {
                fields, mut values, ..
            } if !values.is_empty() => fields.into_iter().zip(values.swap_remove(0)).collect(),
            _ => Vec::new(),
        },
        None => variables,
    };
    let data = fields
        .iter()
        .position(|(name, _)| name == "data")
        .map(|i| fields.swap_remove(i).1);
    let field = |name: &str| fields.iter().find(|(f, _)| f == name).map(|(_, v)| v);
    let number = |name: &str| field(name).and_then(Mat::number);
    let need = |name: &str| {
        number(name)
            .filter(|v| v.is_finite() && *v > 0.0)
            .ok_or_else(|| unsupported(format!("{set_name} has no EEGLAB {name}")))
    };

    let nbchan = need("nbchan")? as usize;
    let rate = need("srate")?;
    let trials = number("trials").unwrap_or(1.0);
    if trials > 1.0 {
        return Err(unsupported(format!(
            "{set_name} is an epoched EEGLAB dataset of {trials} trials; DDALAB reads continuous data"
        )));
    }
    let points = number("pnts").filter(|p| p.is_finite() && *p >= 0.0);

    let mut input_files = vec![set_name.to_string()];
    let (source, storage): (Arc<dyn ByteSource>, Storage) = match data {
        Some(Mat::Char(name)) => {
            let fdt = base_name(name.trim());
            let source = files.source(fdt).ok_or_else(|| {
                DDAError::FileNotFound(format!(
                    "{set_name} names {fdt}, which is not among the opened files"
                ))
            })?;
            input_files.push(fdt.to_string());
            (source.clone(), Storage::F32)
        }
        // In the .set itself: read where it lies, or from memory for a compressed file.
        Some(Mat::Numeric {
            dims,
            storage,
            data,
        }) => {
            if dims.first() != Some(&nbchan) {
                return Err(unsupported(format!(
                    "{set_name} holds data of {} rows for {nbchan} channels",
                    dims.first().copied().unwrap_or(0)
                )));
            }
            (data, storage)
        }
        _ => return Err(unsupported(format!("{set_name} holds no EEGLAB data"))),
    };

    let frame_bytes = nbchan * storage.width();
    let held = source.len() / frame_bytes as u64;
    let sample_count = points.map_or(held, |p| (p as u64).min(held));
    let mut warnings = Vec::new();
    if points.is_some_and(|p| p as u64 > held) {
        warnings.push(format!(
            "The dataset declares {} samples, but its data holds {held}.",
            points.unwrap_or_default()
        ));
    }

    let labels: Vec<String> = field("chanlocs")
        .map(|locations| {
            locations
                .elements()
                .iter()
                .map(|element| {
                    element
                        .iter()
                        .find(|(name, _)| *name == "labels")
                        .and_then(|(_, label)| label.text())
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default();
    let channels = (0..nbchan)
        .map(|i| ChannelInfo {
            label: labels
                .get(i)
                .filter(|label| !label.trim().is_empty())
                .map_or_else(|| (i + 1).to_string(), |label| label.trim().to_string()),
            unit: "V".to_string(),
            sample_rate_hz: rate,
            gain: 1e-6,
            offset: 0.0,
            kind: ChannelKind::Signal,
            bids_status: None,
            bids_type: None,
        })
        .collect();

    let annotations = field("event")
        .map(|events| {
            events
                .elements()
                .iter()
                .filter_map(|event| {
                    let get =
                        |key: &str| event.iter().find(|(name, _)| *name == key).map(|(_, v)| *v);
                    let latency = get("latency")?.number().filter(|l| l.is_finite())?;
                    let duration = get("duration")
                        .and_then(Mat::number)
                        .filter(|d| d.is_finite() && *d >= 0.0)
                        .unwrap_or(0.0);
                    Some(Annotation {
                        onset_s: (latency - 1.0).max(0.0) / rate,
                        duration_s: duration / rate,
                        label: get("type").and_then(Mat::text).unwrap_or_default(),
                        source: "set".to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(Box::new(EeglabReader {
        info: RecordingInfo {
            format: "EEGLAB".to_string(),
            channels,
            sample_rate_hz: rate,
            sample_count,
            duration_s: sample_count as f64 / rate,
            raw_type: match storage {
                Storage::I8 | Storage::U8 | Storage::I16 => RawType::I16,
                Storage::U16 | Storage::I32 => RawType::I32,
                Storage::F32 => RawType::F32,
                Storage::U32 | Storage::I64 | Storage::U64 | Storage::F64 => RawType::F64,
            },
            annotations,
            warnings,
            input_files,
        },
        source,
        storage,
        frame_bytes,
    }))
}

impl EeglabReader {
    /// Calls `emit(row - row0, k, raw)` for the stored sample of `channels[k]` in each row of `row0..row0 + rows`.
    /// The caller has run `check_read`.
    fn decode(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        mut emit: impl FnMut(usize, usize, f64),
    ) -> Result<()> {
        let width = self.storage.width();
        let per_read = (MAX_READ_BYTES / self.frame_bytes).max(1);
        let mut buf = Vec::new();
        for first in (0..rows).step_by(per_read) {
            let n = per_read.min(rows - first);
            buf.resize(n * self.frame_bytes, 0);
            let row = row0 + first as u64;
            self.source
                .read_at(row * self.frame_bytes as u64, &mut buf)?;
            for (k, &c) in channels.iter().enumerate() {
                for i in 0..n {
                    emit(
                        first + i,
                        k,
                        self.storage
                            .decode(&buf[i * self.frame_bytes + c * width..]),
                    );
                }
            }
        }
        Ok(())
    }
}

impl Reader for EeglabReader {
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
