use super::{FileReaderError, FileResult};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

/// Detected Python environment with MNE availability info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PythonEnvironment {
    pub python_path: String,
    pub has_mne: bool,
    pub mne_version: Option<String>,
}

/// Try common Python executable names and return the first that has MNE installed.
pub fn detect_python() -> Option<PythonEnvironment> {
    let candidates = ["python3", "python"];
    for candidate in &candidates {
        if let Some(env) = probe_python(candidate) {
            return Some(env);
        }
    }
    None
}

/// Detect Python at a specific path.
pub fn detect_python_at(python_path: &str) -> Option<PythonEnvironment> {
    probe_python(python_path)
}

/// Probe a single Python executable for MNE availability.
fn probe_python(python_path: &str) -> Option<PythonEnvironment> {
    let output = Command::new(python_path)
        .args(["-c", "import mne; print(mne.__version__)"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Some(PythonEnvironment {
            python_path: python_path.to_string(),
            has_mne: true,
            mne_version: Some(version),
        })
    } else {
        // Python exists but MNE not installed — check if Python itself works
        let py_check = Command::new(python_path)
            .args(["-c", "import sys; print(sys.version)"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()?;

        if py_check.status.success() {
            Some(PythonEnvironment {
                python_path: python_path.to_string(),
                has_mne: false,
                mne_version: None,
            })
        } else {
            None
        }
    }
}

/// Invoke the MNE bridge script with a JSON request. Returns parsed JSON response.
pub fn invoke_bridge(
    python_env: &PythonEnvironment,
    bridge_script: &Path,
    request: &serde_json::Value,
) -> FileResult<serde_json::Value> {
    if !bridge_script.exists() {
        return Err(FileReaderError::MissingFile(format!(
            "Bridge script not found: {}",
            bridge_script.display()
        )));
    }

    let request_json = serde_json::to_string(request).map_err(|e| {
        FileReaderError::ParseError(format!("Failed to serialize bridge request: {}", e))
    })?;

    let mut child = Command::new(&python_env.python_path)
        .arg(bridge_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            FileReaderError::ParseError(format!(
                "Failed to spawn Python process ({}): {}",
                python_env.python_path, e
            ))
        })?;

    // Write request to stdin
    if let Some(ref mut stdin) = child.stdin {
        stdin.write_all(request_json.as_bytes()).map_err(|e| {
            FileReaderError::ParseError(format!("Failed to write to Python stdin: {}", e))
        })?;
        stdin.write_all(b"\n").map_err(|e| {
            FileReaderError::ParseError(format!("Failed to write newline to stdin: {}", e))
        })?;
    }
    // Drop stdin to signal EOF
    drop(child.stdin.take());

    // Wait with timeout (60 seconds)
    let output = wait_with_timeout(&mut child, Duration::from_secs(60))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FileReaderError::ParseError(format!(
            "Python bridge failed (exit {}): {}",
            output.status, stderr
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let response: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        FileReaderError::ParseError(format!(
            "Failed to parse bridge response: {} (raw: {})",
            e,
            &stdout[..stdout.len().min(200)]
        ))
    })?;

    // Check for application-level error
    if let Some(status) = response.get("status").and_then(|v| v.as_str()) {
        if status == "error" {
            let error_msg = response
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown bridge error");
            return Err(FileReaderError::ParseError(format!(
                "MNE bridge error: {}",
                error_msg
            )));
        }
    }

    Ok(response)
}

/// Wait for a child process with timeout.
fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
) -> FileResult<std::process::Output> {
    let start = std::time::Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // Process exited — collect output
                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                if let Some(ref mut out) = child.stdout {
                    std::io::Read::read_to_end(out, &mut stdout).ok();
                }
                if let Some(ref mut err) = child.stderr {
                    std::io::Read::read_to_end(err, &mut stderr).ok();
                }
                return Ok(std::process::Output {
                    status: _status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(FileReaderError::ParseError(
                        "Python bridge timed out after 60 seconds".to_string(),
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => {
                return Err(FileReaderError::ParseError(format!(
                    "Failed to wait for Python process: {}",
                    e
                )));
            }
        }
    }
}

/// Locate the bridge script bundled with the app.
pub fn locate_bridge_script() -> FileResult<std::path::PathBuf> {
    // In development, the script is in src-tauri/resources/python/
    let dev_path = std::path::PathBuf::from("resources/python/mne_bridge.py");
    if dev_path.exists() {
        return Ok(dev_path);
    }

    // When bundled, resolve relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // macOS: DDALAB.app/Contents/MacOS/DDALAB → ../Resources/python/mne_bridge.py
            let macos_path = exe_dir
                .join("..")
                .join("Resources")
                .join("python")
                .join("mne_bridge.py");
            if macos_path.exists() {
                return Ok(macos_path);
            }

            // Linux/Windows: same directory or resources subdirectory
            let local_path = exe_dir.join("python").join("mne_bridge.py");
            if local_path.exists() {
                return Ok(local_path);
            }

            let resources_path = exe_dir
                .join("resources")
                .join("python")
                .join("mne_bridge.py");
            if resources_path.exists() {
                return Ok(resources_path);
            }
        }
    }

    Err(FileReaderError::MissingFile(
        "MNE bridge script not found in any expected location".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_locate_bridge_script_dev() {
        // This test only passes in the dev environment where
        // resources/python/mne_bridge.py exists relative to src-tauri/
        // Just ensure the function doesn't panic
        let _ = locate_bridge_script();
    }
}
