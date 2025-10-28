use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataDirectoryConfig {
    pub path: String,
}

#[tauri::command]
pub async fn select_data_directory(app_handle: AppHandle) -> Result<String, String> {
    // For Tauri v2, we need to use the dialog command directly
    // This will be called from the frontend using the tauri-plugin-dialog
    Err("Use tauri-plugin-dialog from frontend for folder selection".to_string())
}

#[tauri::command]
pub async fn get_data_directory(app_handle: AppHandle) -> Result<String, String> {
    // Try to load from saved preferences
    let config_opt = app_handle
        .state::<parking_lot::RwLock<Option<DataDirectoryConfig>>>()
        .read()
        .clone();

    if let Some(cfg) = config_opt {
        return Ok(cfg.path);
    }

    // Try to load from disk - if nothing saved, return empty string
    // This ensures the UI shows the "No Data Directory Selected" message
    match load_data_directory(&app_handle).await {
        Ok(path) => Ok(path),
        Err(_) => Ok(String::new()), // Return empty string instead of creating default directory
    }
}

#[tauri::command]
pub async fn set_data_directory(app_handle: AppHandle, path: String) -> Result<(), String> {
    // Validate the path exists and is a directory
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !path_buf.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    save_data_directory(&app_handle, &path).await
}

async fn save_data_directory(app_handle: &AppHandle, path: &str) -> Result<(), String> {
    // Update in-memory state
    let config = DataDirectoryConfig {
        path: path.to_string(),
    };

    if let Some(state) = app_handle.try_state::<parking_lot::RwLock<Option<DataDirectoryConfig>>>()
    {
        let mut guard = state.write();
        *guard = Some(config.clone());
    }

    // Persist to disk using app's config directory
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let config_file = config_dir.join("data_directory.json");
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_file, json)
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    log::info!("Data directory saved to config: {}", path);
    Ok(())
}

pub async fn load_data_directory(app_handle: &AppHandle) -> Result<String, String> {
    // Try to load from config file
    let config_dir = app_handle
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let config_file = config_dir.join("data_directory.json");

    if config_file.exists() {
        match std::fs::read_to_string(&config_file) {
            Ok(json) => {
                match serde_json::from_str::<DataDirectoryConfig>(&json) {
                    Ok(config) => {
                        // Update in-memory state
                        if let Some(state) = app_handle
                            .try_state::<parking_lot::RwLock<Option<DataDirectoryConfig>>>()
                        {
                            let mut guard = state.write();
                            *guard = Some(config.clone());
                        }

                        log::info!("Loaded data directory from config: {}", config.path);
                        return Ok(config.path);
                    }
                    Err(e) => {
                        log::warn!("Failed to parse config file: {}", e);
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to read config file: {}", e);
            }
        }
    }

    // No saved config found - return error to trigger empty string
    Err("No data directory configured".to_string())
}
