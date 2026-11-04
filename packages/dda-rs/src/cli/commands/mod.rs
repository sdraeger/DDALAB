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
use crate::cli::exit_codes;
use crate::error::DDAError;
use crate::io::{open_referenced, FileSet, Reader, Reference};
use std::path::Path;

/// The reference `args` name, with the TSVs they point to read; `None` without `--reference`.
pub fn reference_of(args: &ReferenceArgs) -> Result<Option<Reference>, String> {
    let Some(word) = &args.reference else {
        return Ok(None);
    };
    let read = |path: &str| {
        std::fs::read_to_string(path)
            .map_err(|e| DDAError::InvalidParameter(format!("{path}: {e}")))
    };
    let mut reference = Reference::parse(word, read).map_err(|e| e.to_string())?;
    if let Some(path) = &args.electrodes {
        let Reference::Laplacian { electrodes_tsv, .. } = &mut reference else {
            return Err("--electrodes goes with --reference laplacian".to_string());
        };
        *electrodes_tsv = Some(read(path).map_err(|e| e.to_string())?);
    }
    Ok(Some(reference))
}

/// Opens the recording at `file` with its BIDS sidecars and the reference `args` name; on failure prints the error
/// and returns the exit code.
fn open_reader(
    file: &str,
    sample_rate_hz: Option<f64>,
    args: &ReferenceArgs,
) -> Result<Box<dyn Reader>, i32> {
    reference_of(args)
        .and_then(|reference| {
            FileSet::from_path(Path::new(file))
                .and_then(|files| open_referenced(&files, sample_rate_hz, reference.as_ref()))
                .map_err(|e| e.to_string())
        })
        .map_err(|error| {
            eprintln!("Error: {file}: {error}");
            exit_codes::INPUT_ERROR
        })
}
