use crate::models::AppPreferences;
use tauri::Manager;
use std::fs;
use std::path::PathBuf;

fn get_preferences_path(app: tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    Ok(app_data_dir.join("preferences.json"))
}

#[tauri::command]
pub async fn get_app_preferences(app: tauri::AppHandle) -> Result<AppPreferences, String> {
    let prefs_path = get_preferences_path(app)?;

    if prefs_path.exists() {
        let contents = fs::read_to_string(&prefs_path)
            .map_err(|e| format!("Failed to read preferences: {}", e))?;

        let preferences: AppPreferences = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse preferences: {}", e))?;

        log::info!("Loaded preferences from: {:?}", prefs_path);
        Ok(preferences)
    } else {
        log::info!("No preferences file found, returning defaults");
        Ok(AppPreferences::default())
    }
}

#[tauri::command]
pub async fn save_app_preferences(app: tauri::AppHandle, preferences: AppPreferences) -> Result<(), String> {
    let prefs_path = get_preferences_path(app)?;

    let json = serde_json::to_string_pretty(&preferences)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;

    fs::write(&prefs_path, json)
        .map_err(|e| format!("Failed to write preferences: {}", e))?;

    log::info!("Saved preferences to: {:?}", prefs_path);
    Ok(())
}

#[tauri::command]
pub async fn open_file_dialog() -> Result<Option<String>, String> {
    // TODO: Implement with tauri-plugin-dialog v2 API
    // Example: use tauri_plugin_dialog::FileDialogBuilder;
    // let file_path = FileDialogBuilder::new()
    //     .add_filter("EDF Files", &["edf"])
    //     .add_filter("ASCII Files", &["txt", "asc", "csv"])
    //     .add_filter("All Files", &["*"])
    //     .pick_file();
    Ok(None)
}

#[tauri::command]
pub async fn show_notification(title: String, body: String) -> Result<(), String> {
    // TODO: Implement with tauri-plugin-notification v2 API
    // Example: use tauri_plugin_notification::NotificationExt;
    // app.notification()
    //     .builder()
    //     .title(&title)
    //     .body(&body)
    //     .show()?;
    log::info!("Notification: {} - {}", title, body);
    Ok(())
}
