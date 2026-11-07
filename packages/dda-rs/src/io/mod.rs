//! Synchronous random-access byte sources and the file sets recording readers consume.

mod ascii;
mod bids;
mod brainvision;
mod edf;
pub mod edit;
mod eeglab;
mod mat;
mod recording;
mod reference;
mod source;

pub use ascii::{open_ascii, open_matrix};
pub use bids::apply_bids_sidecars;
#[cfg(not(target_arch = "wasm32"))]
pub use bids::discover_bids_recordings;
pub use brainvision::open_brainvision;
pub use edf::open_edf;
pub use eeglab::open_eeglab;
pub use recording::*;
pub use reference::*;
pub use source::*;

use crate::error::{DDAError, Result};

/// A reader whose `info` has the BIDS sidecars applied; reads go to the format's reader.
struct WithSidecars {
    reader: Box<dyn Reader>,
    info: RecordingInfo,
}

impl Reader for WithSidecars {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn scan_annotations(&self) -> Result<(Vec<Annotation>, Vec<String>)> {
        let (mut annotations, warnings) = self.reader.scan_annotations()?;
        // `apply_bids_sidecars` only appends. The events follow what the reader's own info holds.
        annotations
            .extend_from_slice(&self.info.annotations[self.reader.info().annotations.len()..]);
        Ok((annotations, warnings))
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        self.reader.read_rows(channels, row0, rows)
    }

    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()> {
        self.reader.read_raw_f32(channels, row0, rows, out)
    }
}

/// `open_recording` with `reference`, when there is one, applied to its analysis channels.
pub fn open_referenced(
    files: &FileSet,
    sample_rate_hz: Option<f64>,
    reference: Option<&Reference>,
) -> Result<Box<dyn Reader>> {
    let reader = open_recording(files, sample_rate_hz)?;
    match reference {
        Some(reference) => with_reference(reader, reference, files),
        None => Ok(reader),
    }
}

/// A recording format, as the extension of its primary file names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// EDF and BDF.
    Edf,
    BrainVision,
    Eeglab,
    /// Delimited text, one row per sample.
    Text,
}

impl Format {
    /// Every extension a recording's primary file may have, lower case, and its format.
    pub const EXTENSIONS: &[(&str, Format)] = &[
        ("edf", Format::Edf),
        ("bdf", Format::Edf),
        ("vhdr", Format::BrainVision),
        ("set", Format::Eeglab),
        ("txt", Format::Text),
        ("csv", Format::Text),
        ("tsv", Format::Text),
        ("ascii", Format::Text),
        ("dat", Format::Text),
    ];

    /// The format of the file `name`, by its extension in any case; `None` for a file no reader opens.
    pub fn of(name: &str) -> Option<Format> {
        let (_, extension) = name.rsplit_once('.')?;
        Self::EXTENSIONS
            .iter()
            .find(|(e, _)| e.eq_ignore_ascii_case(extension))
            .map(|&(_, format)| format)
    }

    /// `Format::of(name)`, or the error refusing the file.
    pub(crate) fn require(name: &str) -> Result<Format> {
        Self::of(name).ok_or_else(|| DDAError::UnsupportedFileType(name.to_string()))
    }
}

/// Opens the recording `files.primary` names with the reader of its `Format` and applies the BIDS sidecars in
/// `files`. `sample_rate_hz` only reaches the text formats, which store no rate.
pub fn open_recording(files: &FileSet, sample_rate_hz: Option<f64>) -> Result<Box<dyn Reader>> {
    let name = files.primary.as_str();
    let reader = match Format::require(name)? {
        Format::Edf => open_edf(files, name)?,
        Format::BrainVision => open_brainvision(files, name)?,
        Format::Eeglab => open_eeglab(files, name)?,
        Format::Text => open_ascii(files, name, sample_rate_hz)?,
    };
    let mut info = reader.info().clone();
    apply_bids_sidecars(&mut info, files);
    Ok(Box::new(WithSidecars { reader, info }))
}
