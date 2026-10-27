use crate::cli::args::ValidateArgs;
use crate::cli::exit_codes;
use crate::cli::output;
use crate::io::{open_recording, FileSet};
use crate::DDAError;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize)]
struct ValidateOutput {
    file: String,
    exists: bool,
    readable: bool,
    supported: bool,
    file_type: Option<String>,
    size_bytes: Option<u64>,
    error: Option<String>,
}

/// Whether `open_recording` reads files named like `name`: it refuses an unknown extension before it looks at any file.
fn supported(name: &str) -> bool {
    let files = FileSet {
        primary: name.to_string(),
        files: BTreeMap::new(),
    };
    !matches!(
        open_recording(&files, None),
        Err(DDAError::UnsupportedFileType(_))
    )
}

pub fn execute(args: ValidateArgs) -> i32 {
    let path = Path::new(&args.file);

    let exists = path.exists();
    let readable = path.is_file() && std::fs::File::open(path).is_ok();

    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let supported = supported(&args.file);

    let size_bytes = if readable {
        std::fs::metadata(path).ok().map(|m| m.len())
    } else {
        None
    };

    // The file must open: its header parses and the sidecars that belong to it are found.
    let opened = (readable && supported).then(|| {
        FileSet::from_path(path)
            .and_then(|files| open_recording(&files, None))
            .map(|reader| reader.info().format.clone())
    });
    let (file_type, open_error) = match opened {
        Some(Ok(format)) => (Some(format), None),
        Some(Err(error)) => (None, Some(error)),
        None => (None, None),
    };

    let error = if !exists {
        Some(format!("File not found: {}", args.file))
    } else if !readable {
        Some(format!("File is not readable: {}", args.file))
    } else if !supported {
        Some(format!(
            "Unsupported file extension '{}'. Supported: edf, bdf, vhdr, set, txt, csv, tsv, ascii, dat",
            extension
        ))
    } else {
        open_error.map(|error| format!("Could not open {}: {}", args.file, error))
    };

    let result = ValidateOutput {
        file: args.file,
        exists,
        readable,
        supported,
        file_type,
        size_bytes,
        error,
    };

    if args.json {
        if let Err(error) = output::write_json(&result, false, None) {
            eprintln!("Error: {}", error);
            return exit_codes::EXECUTION_ERROR;
        }
    } else if let Some(err) = &result.error {
        eprintln!("Error: {}", err);
    } else {
        println!(
            "File '{}' is valid ({}, {} bytes)",
            result.file,
            result.file_type.as_deref().unwrap_or_default(),
            size_bytes.unwrap_or(0)
        );
    }

    if result.error.is_some() {
        exit_codes::INPUT_ERROR
    } else {
        exit_codes::SUCCESS
    }
}
