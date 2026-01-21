use crate::models::AppPreferences;
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Unwrap Proofpoint URL Defense wrapped URLs
/// Proofpoint wraps URLs like: https://urldefense.com/v3/__https://localhost:8765__;...
fn unwrap_proofpoint_url(url: &str) -> String {
    // Check if URL is wrapped by Proofpoint URL Defense
    if url.contains("urldefense.com/v3/__") {
        // Extract the original URL from the Proofpoint wrapper
        // Format: https://urldefense.com/v3/__<ORIGINAL_URL>__;...
        if let Ok(re) = Regex::new(r"urldefense\.com/v3/__(.+?)__") {
            if let Some(captures) = re.captures(url) {
                if let Some(unwrapped) = captures.get(1) {
                    let result = unwrapped.as_str().to_string();
                    log::info!(
                        "Unwrapped Proofpoint URL: {} -> {}",
                        url.chars().take(50).collect::<String>(),
                        result
                    );
                    return result;
                }
            }
        }
    }
    url.to_string()
}

fn get_preferences_path(app: tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("preferences.json"))
}

#[tauri::command]
pub async fn get_app_preferences(app: tauri::AppHandle) -> Result<AppPreferences, String> {
    let prefs_path = get_preferences_path(app.clone())?;

    if prefs_path.exists() {
        let contents = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;

        let mut preferences: AppPreferences = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse preferences: {}", e))?;

        // Sanitize URL: unwrap any Proofpoint URL Defense wrappers
        // This fixes issues on corporate networks where URLs get mangled by email security
        let original_url = preferences.api_config.url.clone();
        preferences.api_config.url = unwrap_proofpoint_url(&preferences.api_config.url);

        // Self-repair: if URL was mangled, automatically fix preferences.json
        if original_url != preferences.api_config.url {
            log::warn!(
                "🔧 AUTO-REPAIR: API URL was wrapped by Proofpoint URL Defense, fixing preferences file"
            );
            log::warn!(
                "   Original (mangled): {}",
                original_url.chars().take(80).collect::<String>()
            );
            log::warn!("   Fixed: {}", preferences.api_config.url);

            // Write the sanitized preferences back to disk
            let sanitized_json = serde_json::to_string_pretty(&preferences)
                .map_err(|e| format!("Failed to serialize preferences: {}", e))?;

            if let Err(e) = fs::write(&prefs_path, sanitized_json) {
                log::error!("Failed to auto-repair preferences.json: {}", e);
            } else {
                log::info!(
                    "✅ Successfully repaired preferences.json - Proofpoint URL Defense wrapper removed"
                );
            }
        }

        log::info!("Loaded preferences from: {:?}", prefs_path);
        Ok(preferences)
    } else {
        log::info!("No preferences file found, returning defaults");
        Ok(AppPreferences::default())
    }
}

#[tauri::command]
pub async fn save_app_preferences(
    app: tauri::AppHandle,
    preferences: AppPreferences,
) -> Result<(), String> {
    let prefs_path = get_preferences_path(app)?;

    // Sanitize URL before saving: unwrap any Proofpoint URL Defense wrappers
    let mut sanitized_preferences = preferences;
    sanitized_preferences.api_config.url =
        unwrap_proofpoint_url(&sanitized_preferences.api_config.url);

    let json = serde_json::to_string_pretty(&sanitized_preferences)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;

    fs::write(&prefs_path, json).map_err(|e| format!("Failed to write preferences: {}", e))?;

    log::info!("Saved preferences to: {:?}", prefs_path);
    Ok(())
}

#[tauri::command]
pub async fn open_file_dialog() -> Result<Option<String>, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    // Get app handle (this is a workaround for async function)
    // In actual implementation, pass app handle as parameter
    log::info!("Opening file dialog");

    // For now, return None to indicate not yet implemented
    // The actual implementation would use tauri_plugin_dialog::FileDialogBuilder
    // with filters for .edf, .fif, .set, .vhdr, .txt, .csv extensions
    Ok(None)
}

// Alternative approach: Use blocking file dialog
#[tauri::command]
pub fn open_file_dialog_sync(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};

    let file_path = app
        .dialog()
        .file()
        .add_filter("EDF Files", &["edf"])
        .add_filter("FIFF/FIF Files", &["fif"])
        .add_filter("EEGLAB Files", &["set"])
        .add_filter("BrainVision Files", &["vhdr"])
        .add_filter("ASCII Files", &["txt", "asc", "csv", "ascii"])
        .add_filter(
            "All Supported Files",
            &["edf", "fif", "set", "vhdr", "txt", "asc", "csv", "ascii"],
        )
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            // FilePath has as_path() method that returns Option<&Path>
            let path_str = path
                .as_path()
                .ok_or_else(|| "Invalid file path".to_string())?
                .to_string_lossy()
                .to_string();
            log::info!("Selected file: {}", path_str);
            Ok(Some(path_str))
        }
        None => {
            log::info!("File dialog cancelled");
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    log::info!("Showing notification: {} - {}", title, body);

    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| format!("Failed to show notification: {}", e))?;

    Ok(())
}
