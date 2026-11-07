use std::io::Write;

/// Writes `value` as JSON, indented unless `compact`, to the file `output_path` or, without one, to stdout with a
/// newline after it.
pub fn write_json<T: serde::Serialize>(
    value: &T,
    compact: bool,
    output_path: Option<&str>,
) -> Result<(), String> {
    let json = match compact {
        true => serde_json::to_string(value),
        false => serde_json::to_string_pretty(value),
    }
    .map_err(|e| format!("JSON serialization failed: {e}"))?;
    match output_path {
        Some(path) => std::fs::write(path, json)
            .map_err(|e| format!("Failed to write output file '{path}': {e}")),
        None => {
            let mut handle = std::io::stdout().lock();
            handle
                .write_all(json.as_bytes())
                .and_then(|_| handle.write_all(b"\n"))
                .map_err(|e| format!("Failed to write to stdout: {e}"))
        }
    }
}
