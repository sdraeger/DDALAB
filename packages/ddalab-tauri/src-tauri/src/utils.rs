use std::path::PathBuf;

/// Get the application configuration directory
pub fn get_app_config_dir() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?;

    let app_config_dir = config_dir.join("ddalab");
    std::fs::create_dir_all(&app_config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    Ok(app_config_dir)
}

/// Get the application data directory
pub fn get_app_data_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .ok_or("Could not find data directory")?;

    let app_data_dir = data_dir.join("com.ddalab.app");
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    Ok(app_data_dir)
}

/// Format log messages consistently
pub fn format_log_message(level: &str, message: &str) -> String {
    format!("[{}] {}", level.to_uppercase(), message)
}
