use crate::cli::ValidateArgs;
use crate::exit_codes;
use crate::output;
use dda_rs::FileType;
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

pub fn execute(args: ValidateArgs) -> i32 {
    let path = Path::new(&args.file);

    let exists = path.exists();
    let readable = path.is_file() && std::fs::File::open(path).is_ok();

    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    let file_type = FileType::from_extension(extension);
    let supported = file_type.is_some();

    let size_bytes = if readable {
        std::fs::metadata(path).ok().map(|m| m.len())
    } else {
        None
    };

    let error = if !exists {
        Some(format!("File not found: {}", args.file))
    } else if !readable {
        Some(format!("File is not readable: {}", args.file))
    } else if !supported {
        Some(format!(
            "Unsupported file extension '{}'. Supported: edf, ascii, txt, csv",
            extension
        ))
    } else {
        None
    };

    let result = ValidateOutput {
        file: args.file.clone(),
        exists,
        readable,
        supported,
        file_type: file_type.map(|ft| format!("{:?}", ft)),
        size_bytes,
        error: error.clone(),
    };

    if args.json {
        match output::to_json(&result, false) {
            Ok(json) => {
                if let Err(e) = output::write_output(&json, None) {
                    eprintln!("Error: {}", e);
                    return exit_codes::EXECUTION_ERROR;
                }
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                return exit_codes::EXECUTION_ERROR;
            }
        }
    } else if let Some(ref err) = error {
        eprintln!("Error: {}", err);
    } else {
        println!(
            "File '{}' is valid ({}, {} bytes)",
            args.file,
            file_type.map(|ft| format!("{:?}", ft)).unwrap_or_default(),
            size_bytes.unwrap_or(0)
        );
    }

    if error.is_some() {
        exit_codes::INPUT_ERROR
    } else {
        exit_codes::SUCCESS
    }
}
