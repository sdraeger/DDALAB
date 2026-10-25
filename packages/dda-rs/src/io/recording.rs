//! The metadata every recording format reports and the trait every format reader implements.

use crate::error::Result;
use serde::{Deserialize, Serialize};

/// How the file stores its samples.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RawType {
    I16,
    I24,
    I32,
    F32,
    F64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChannelKind {
    Signal,
    Annotation,
    Status,
    Other,
}

/// Physical value = `raw * gain + offset`, in SI units (volts for voltage).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChannelInfo {
    pub label: String,
    pub unit: String,
    pub sample_rate_hz: f64,
    pub gain: f64,
    pub offset: f64,
    pub kind: ChannelKind,
    pub bids_status: Option<String>,
    pub bids_type: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Annotation {
    pub onset_s: f64,
    pub duration_s: f64,
    pub label: String,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecordingInfo {
    pub format: String,
    pub channels: Vec<ChannelInfo>,
    /// The rate shared by the most signal channels (ties: the higher rate).
    pub sample_rate_hz: f64,
    /// Samples per channel at `sample_rate_hz`.
    pub sample_count: u64,
    pub duration_s: f64,
    pub raw_type: RawType,
    pub annotations: Vec<Annotation>,
    pub warnings: Vec<String>,
    pub input_files: Vec<String>,
}

impl RecordingInfo {
    /// Indices into `channels` of the signal channels at `sample_rate_hz`, in recording order.
    /// `DDARequest` channel indices count in this list.
    pub fn analysis_channels(&self) -> Vec<usize> {
        (0..self.channels.len())
            .filter(|&i| {
                let channel = &self.channels[i];
                channel.kind == ChannelKind::Signal && channel.sample_rate_hz == self.sample_rate_hz
            })
            .collect()
    }
}

/// Channel arguments index `RecordingInfo::channels`.
pub trait Reader: Send + Sync {
    fn info(&self) -> &RecordingInfo;

    /// All annotations and the warnings raised finding them. `RecordingInfo::annotations` holds only
    /// what opening the file finds cheaply, so a format whose annotations cost a pass over the file overrides this.
    fn scan_annotations(&self) -> Result<(Vec<Annotation>, Vec<String>)> {
        Ok((self.info().annotations.clone(), Vec::new()))
    }

    /// `rows` rows from `row0` as `[row][channel]`, physical SI values.
    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>>;

    /// The stored samples, uncalibrated, row-major into `out` (`rows * channels.len()` values).
    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()>;
}
