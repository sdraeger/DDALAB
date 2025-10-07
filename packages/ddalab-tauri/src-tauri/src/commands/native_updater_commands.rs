use tauri::AppHandle;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UpdateStatus {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_date: Option<String>,
    pub release_notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub chunk_length: usize,
    pub content_length: Option<u64>,
}

/// Check for updates using Tauri's native updater
#[tauri::command]
pub async fn check_native_update(app: AppHandle) -> Result<UpdateStatus, String> {
    // Use CARGO_PKG_VERSION which is set at compile time from Cargo.toml
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    log::info!("Checking for native updates. Current version: {}", current_version);

    // Import the updater
    use tauri_plugin_updater::UpdaterExt;

    let updater = app.updater_builder().build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            log::info!("Update available: {}", update.version);

            Ok(UpdateStatus {
                available: true,
                current_version,
                latest_version: Some(update.version.clone()),
                release_date: update.date.map(|d| d.to_string()),
                release_notes: Some(update.body.clone().unwrap_or_default()),
            })
        }
        Ok(None) => {
            log::info!("No updates available");
            Ok(UpdateStatus {
                available: false,
                current_version,
                latest_version: None,
                release_date: None,
                release_notes: None,
            })
        }
        Err(e) => {
            log::error!("Error checking for updates: {}", e);
            Err(format!("Failed to check for updates: {}", e))
        }
    }
}

/// Download and install update using Tauri's native updater
#[tauri::command]
pub async fn download_and_install_update(app: AppHandle) -> Result<(), String> {
    log::info!("Starting update download and installation");

    use tauri_plugin_updater::UpdaterExt;

    let updater = app.updater_builder().build()
        .map_err(|e| format!("Failed to build updater: {}", e))?;

    match updater.check().await {
        Ok(Some(update)) => {
            log::info!("Downloading update version: {}", update.version);

            // Download and install with progress callback
            let mut downloaded = 0;
            let result = update
                .download_and_install(
                    |chunk_length, content_length| {
                        downloaded += chunk_length;
                        log::debug!("Downloaded {} of {:?} bytes", downloaded, content_length);
                    },
                    || {
                        log::info!("Download complete, preparing to install...");
                    },
                )
                .await;

            match result {
                Ok(_) => {
                    log::info!("Update installed successfully. Restart required.");
                    Ok(())
                }
                Err(e) => {
                    log::error!("Failed to download/install update: {}", e);
                    Err(format!("Failed to install update: {}", e))
                }
            }
        }
        Ok(None) => {
            Err("No update available".to_string())
        }
        Err(e) => {
            log::error!("Error checking for updates: {}", e);
            Err(format!("Failed to check for updates: {}", e))
        }
    }
}
