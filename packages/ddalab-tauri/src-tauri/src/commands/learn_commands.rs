use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn sample_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let dir = home.join(".ddalab").join("sample-data");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create sample data directory: {e}"))?;
    Ok(dir)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedDataset {
    pub id: String,
    pub path: String,
    pub size_bytes: u64,
}

#[tauri::command]
pub async fn get_sample_data_dir() -> Result<String, String> {
    let dir = sample_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_downloaded_samples() -> Result<Vec<DownloadedDataset>, String> {
    let dir = sample_data_dir()?;
    let mut datasets = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sample data directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                datasets.push(DownloadedDataset {
                    id: stem.to_string(),
                    path: path.to_string_lossy().to_string(),
                    size_bytes: size,
                });
            }
        }
    }

    Ok(datasets)
}

#[tauri::command]
pub async fn download_sample_data(
    url: String,
    dataset_id: String,
    file_extension: String,
) -> Result<String, String> {
    let dir = sample_data_dir()?;
    let filename = format!("{}.{}", dataset_id, file_extension);
    let dest = dir.join(&filename);

    if dest.exists() {
        return Ok(dest.to_string_lossy().to_string());
    }

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write file: {e}"))?;

    log::info!(
        "Downloaded sample dataset '{}' ({} bytes) to {}",
        dataset_id,
        bytes.len(),
        dest.display()
    );

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_sample_data(dataset_id: String) -> Result<(), String> {
    let dir = sample_data_dir()?;

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read sample data directory: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            if stem == dataset_id {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete {}: {e}", path.display()))?;
                log::info!("Deleted sample dataset '{}'", dataset_id);
                return Ok(());
            }
        }
    }

    Err(format!("Dataset '{}' not found", dataset_id))
}

#[tauri::command]
pub async fn fetch_remote_index(url: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch index: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Fetch failed with status: {}", response.status()));
    }

    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    Ok(body)
}
