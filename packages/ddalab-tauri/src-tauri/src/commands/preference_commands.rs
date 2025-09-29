use crate::models::AppPreferences;

#[tauri::command]
pub async fn get_app_preferences() -> Result<AppPreferences, String> {
    // Load preferences from config file or return defaults
    Ok(AppPreferences::default())
}

#[tauri::command]
pub async fn save_app_preferences(preferences: AppPreferences) -> Result<(), String> {
    // Save preferences to config file
    log::info!("Saving preferences: {:?}", preferences);
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
