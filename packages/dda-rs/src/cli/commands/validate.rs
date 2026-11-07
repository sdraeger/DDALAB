use crate::cli::args::ValidateArgs;
use crate::cli::{exit_codes, output, Failure};
use crate::io::{open_recording, FileSet, Format};
use serde::Serialize;
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

pub fn execute(args: ValidateArgs) -> Result<(), Failure> {
    let path = Path::new(&args.file);

    let exists = path.exists();
    let readable = path.is_file() && std::fs::File::open(path).is_ok();
    let supported = Format::of(&args.file).is_some();
    let size_bytes = readable
        .then(|| std::fs::metadata(path).ok().map(|m| m.len()))
        .flatten();

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
        let extensions: Vec<&str> = Format::EXTENSIONS.iter().map(|(e, _)| *e).collect();
        Some(format!(
            "Unsupported file extension '{}'. Supported: {}",
            path.extension().and_then(|e| e.to_str()).unwrap_or(""),
            extensions.join(", ")
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
        output::write_json(&result, false, None).map_err(crate::cli::execution_error)?;
        // The JSON holds the error, so it is not printed again.
        return match result.error {
            Some(_) => Err((exit_codes::INPUT_ERROR, String::new())),
            None => Ok(()),
        };
    }
    match result.error {
        Some(error) => Err((exit_codes::INPUT_ERROR, error)),
        None => {
            println!(
                "File '{}' is valid ({}, {} bytes)",
                result.file,
                result.file_type.as_deref().unwrap_or_default(),
                size_bytes.unwrap_or(0)
            );
            Ok(())
        }
    }
}
