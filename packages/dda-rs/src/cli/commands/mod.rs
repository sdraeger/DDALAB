pub mod batch;
pub mod classify;
pub mod info;
pub mod inspect;
pub mod mcp;
pub mod run;
pub mod samples;
pub mod stream;
pub mod validate;
pub mod variants;

use crate::cli::args::ReferenceArgs;
use crate::error::DDAError;
use crate::io::{open_referenced, FileSet, Reader, Reference};
use std::path::Path;

impl ReferenceArgs {
    /// The reference these flags name, with the TSVs they point to read; `None` without `--reference`.
    pub fn parse(&self) -> Result<Option<Reference>, String> {
        let Some(word) = &self.reference else {
            return Ok(None);
        };
        let read = |path: &str| {
            std::fs::read_to_string(path)
                .map_err(|e| DDAError::InvalidParameter(format!("{path}: {e}")))
        };
        let mut reference = Reference::parse(word, read).map_err(|e| e.to_string())?;
        if let Some(path) = &self.electrodes {
            let Reference::Laplacian { electrodes_tsv, .. } = &mut reference else {
                return Err("--electrodes goes with --reference laplacian".to_string());
            };
            *electrodes_tsv = Some(read(path).map_err(|e| e.to_string())?);
        }
        Ok(Some(reference))
    }
}

/// The recording at `file` with its BIDS sidecars, opened with `reference`, and the files it was read from; an
/// error names the file.
pub fn open(
    file: &str,
    sample_rate_hz: Option<f64>,
    reference: Option<&Reference>,
) -> Result<(FileSet, Box<dyn Reader>), String> {
    FileSet::from_path(Path::new(file))
        .and_then(|files| {
            let reader = open_referenced(&files, sample_rate_hz, reference)?;
            Ok((files, reader))
        })
        .map_err(|e| format!("{file}: {e}"))
}
