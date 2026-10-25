//! Synchronous random-access byte sources and the file sets recording readers consume.

mod ascii;
mod bids;
mod brainvision;
mod edf;
mod recording;
mod source;

pub use ascii::open_ascii;
pub use bids::apply_bids_sidecars;
#[cfg(not(target_arch = "wasm32"))]
pub use bids::discover_bids_recordings;
pub use brainvision::open_brainvision;
pub use edf::open_edf;
pub use recording::*;
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
        // `apply_bids_sidecars` only appends, so the events follow what the reader's own info holds.
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

/// Opens the recording `files.primary` names with the reader its extension selects (`.edf` `.bdf`, `.vhdr`,
/// `.txt` `.csv` `.tsv` `.ascii` `.dat`) and applies the BIDS sidecars in `files`.
/// `sample_rate_hz` only reaches the text formats, which store no rate.
pub fn open_recording(files: &FileSet, sample_rate_hz: Option<f64>) -> Result<Box<dyn Reader>> {
    let name = files.primary.as_str();
    let extension = name.rsplit_once('.').map_or("", |(_, ext)| ext);
    let reader = match extension.to_ascii_lowercase().as_str() {
        "edf" | "bdf" => open_edf(files, name)?,
        "vhdr" => open_brainvision(files, name)?,
        "txt" | "csv" | "tsv" | "ascii" | "dat" => open_ascii(files, name, sample_rate_hz)?,
        _ => return Err(DDAError::UnsupportedFileType(name.to_string())),
    };
    let mut info = reader.info().clone();
    apply_bids_sidecars(&mut info, files);
    Ok(Box::new(WithSidecars { reader, info }))
}
