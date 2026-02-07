use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const MAX_SCAN_DEPTH: usize = 6;
const MAX_FILES: usize = 10_000;

/// DDA-compatible file extensions
fn dda_compatible_extensions() -> HashSet<&'static str> {
    ["edf", "set", "vhdr", "fif", "csv", "txt", "xdf"]
        .into_iter()
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsFileInfo {
    pub path: String,
    pub file_name: String,
    pub extension: String,
    pub size: u64,
    pub subject: Option<String>,
    pub modality_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BidsScanResult {
    pub files: Vec<BidsFileInfo>,
    pub dda_compatible_count: usize,
}

fn parse_bids_subject(path: &Path) -> Option<String> {
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if name.starts_with("sub-") {
            return Some(name.to_string());
        }
    }
    None
}

fn parse_bids_modality(path: &Path) -> Option<String> {
    let modality_dirs: HashSet<&str> = ["eeg", "meg", "ieeg", "anat", "func", "dwi", "pet", "fmap"]
        .into_iter()
        .collect();

    for component in path.components() {
        let name = component.as_os_str().to_string_lossy();
        if modality_dirs.contains(name.as_ref()) {
            return Some(name.to_string());
        }
    }
    None
}

fn scan_directory_recursive(
    dir: &Path,
    base: &Path,
    depth: usize,
    extensions: &HashSet<&str>,
    results: &mut Vec<BidsFileInfo>,
) -> Result<(), String> {
    if depth > MAX_SCAN_DEPTH || results.len() >= MAX_FILES {
        return Ok(());
    }

    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory {:?}: {}", dir, e))?;

    for entry in entries {
        if results.len() >= MAX_FILES {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Skip hidden files/dirs
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }

        if path.is_dir() {
            scan_directory_recursive(&path, base, depth + 1, extensions, results)?;
        } else if path.is_file() {
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            if extensions.contains(ext.as_str()) {
                let relative = path.strip_prefix(base).unwrap_or(&path);
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let subject = parse_bids_subject(relative);
                let modality_dir = parse_bids_modality(relative);

                results.push(BidsFileInfo {
                    path: path.to_string_lossy().to_string(),
                    file_name,
                    extension: ext,
                    size,
                    subject,
                    modality_dir,
                });
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn scan_bids_directory(directory_path: String) -> Result<BidsScanResult, String> {
    let dir = PathBuf::from(&directory_path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Not a valid directory: {}", directory_path));
    }

    let extensions = dda_compatible_extensions();
    let mut files = Vec::new();

    scan_directory_recursive(&dir, &dir, 0, &extensions, &mut files)?;

    let dda_compatible_count = files.len();

    Ok(BidsScanResult {
        files,
        dda_compatible_count,
    })
}
