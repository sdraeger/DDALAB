pub mod batch;
pub mod info;
pub mod inspect;
pub mod run;
pub mod samples;
pub mod serve;
pub mod validate;
pub mod variants;

use crate::exit_codes;
use dda_rs::io::{open_recording, FileSet, Reader};
use std::path::Path;

/// Opens the recording at `file` with its BIDS sidecars; on failure prints the error and returns the exit code.
fn open_reader(file: &str, sample_rate_hz: Option<f64>) -> Result<Box<dyn Reader>, i32> {
    FileSet::from_path(Path::new(file))
        .and_then(|files| open_recording(&files, sample_rate_hz))
        .map_err(|error| {
            eprintln!("Error: {file}: {error}");
            exit_codes::INPUT_ERROR
        })
}
