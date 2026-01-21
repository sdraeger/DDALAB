use arboard::Clipboard;
use std::fs;
use std::process::Command;
use tauri::AppHandle;

#[tauri::command]
pub async fn open_logs_folder(_app_handle: AppHandle) -> Result<(), String> {
    // Logs are written to system temp directory (same as main.rs:35)
    let log_file = std::env::temp_dir().join("ddalab.log");

    // Open the folder and select the log file in the system file explorer
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R") // -R flag reveals the file in Finder
            .arg(&log_file)
            .spawn()
            .map_err(|e| format!("Failed to open logs folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg("/select,") // /select flag selects the file in Explorer
            .arg(&log_file)
            .spawn()
            .map_err(|e| format!("Failed to open logs folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Most Linux file managers don't support selecting a file,
        // so we fall back to opening the directory
        let log_dir = std::env::temp_dir();
        Command::new("xdg-open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open logs folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_logs_path(_app_handle: AppHandle) -> Result<String, String> {
    // Logs are written to system temp directory (same as main.rs:35)
    let log_file = std::env::temp_dir().join("ddalab.log");
    Ok(log_file.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn read_logs_content(_app_handle: AppHandle) -> Result<String, String> {
    // Logs are written to system temp directory (same as main.rs:35)
    let log_file = std::env::temp_dir().join("ddalab.log");

    // Check if log file exists
    if !log_file.exists() {
        return Ok(String::from(
            "Log file not found. The application may not have generated any logs yet.",
        ));
    }

    // Read the log file content
    fs::read_to_string(&log_file).map_err(|e| format!("Failed to read log file: {}", e))
}

#[tauri::command]
pub async fn copy_to_clipboard(text: String) -> Result<(), String> {
    // Use arboard for cross-platform clipboard access
    let mut clipboard =
        Clipboard::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    clipboard
        .set_text(&text)
        .map_err(|e| format!("Failed to copy to clipboard: {}", e))
}

#[tauri::command]
pub async fn read_config_files(app_handle: AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // Get platform-specific app data directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let api_config_path = app_data_dir.join("api_connection.json");
    let preferences_path = app_data_dir.join("preferences.json");

    let mut result = String::new();

    // Read api_connection.json
    result.push_str("--- api_connection.json ---\n");
    if api_config_path.exists() {
        match fs::read_to_string(&api_config_path) {
            Ok(content) => {
                result.push_str(&content);
                result.push('\n');
            }
            Err(e) => {
                result.push_str(&format!("Error reading file: {}\n", e));
            }
        }
    } else {
        result.push_str("(File does not exist)\n");
    }

    result.push('\n');

    // Read preferences.json
    result.push_str("--- preferences.json ---\n");
    if preferences_path.exists() {
        match fs::read_to_string(&preferences_path) {
            Ok(content) => {
                result.push_str(&content);
                result.push('\n');
            }
            Err(e) => {
                result.push_str(&format!("Error reading file: {}\n", e));
            }
        }
    } else {
        result.push_str("(File does not exist)\n");
    }

    result.push('\n');

    // Add file paths for reference
    result.push_str(&format!(
        "Config directory: {}\n",
        app_data_dir.to_string_lossy()
    ));

    Ok(result)
}
