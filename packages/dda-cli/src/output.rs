use std::io::Write;
use std::path::Path;

/// Write JSON string to stdout or a file.
pub fn write_output(json: &str, output_path: Option<&str>) -> Result<(), String> {
    match output_path {
        Some(path) => {
            std::fs::write(Path::new(path), json)
                .map_err(|e| format!("Failed to write output file '{}': {}", path, e))
        }
        None => {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            handle
                .write_all(json.as_bytes())
                .and_then(|_| handle.write_all(b"\n"))
                .map_err(|e| format!("Failed to write to stdout: {}", e))
        }
    }
}

/// Serialize a value to JSON (pretty or compact).
pub fn to_json<T: serde::Serialize>(value: &T, compact: bool) -> Result<String, String> {
    if compact {
        serde_json::to_string(value).map_err(|e| format!("JSON serialization failed: {}", e))
    } else {
        serde_json::to_string_pretty(value)
            .map_err(|e| format!("JSON serialization failed: {}", e))
    }
}
