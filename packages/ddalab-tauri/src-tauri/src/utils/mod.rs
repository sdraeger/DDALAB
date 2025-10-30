use std::path::PathBuf;

pub mod certs;
pub mod file_hash;

/// Get the application configuration directory
pub fn get_app_config_dir() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir().ok_or("Could not find config directory")?;

    let app_config_dir = config_dir.join("ddalab");
    std::fs::create_dir_all(&app_config_dir)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    Ok(app_config_dir)
}

/// Get the application data directory
pub fn get_app_data_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir().ok_or("Could not find data directory")?;

    let app_data_dir = data_dir.join("com.ddalab.app");
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;

    Ok(app_data_dir)
}

/// Get the database directory for application databases
///
/// This returns the proper platform-specific directory for storing SQLite databases:
/// - macOS: ~/Library/Application Support/com.ddalab.app/
/// - Windows: %APPDATA%\com.ddalab.app\
/// - Linux: ~/.config/ddalab/
///
/// IMPORTANT: This directory is protected from accidental user deletion and is appropriate
/// for storing application-critical data like databases.
pub fn get_database_dir() -> Result<PathBuf, String> {
    // Use the same directory as app_data_dir for consistency
    // This ensures all databases are in a platform-appropriate location
    get_app_data_dir()
}

/// Get a specific database file path
///
/// # Arguments
/// * `db_name` - Name of the database file (e.g., "analysis.db")
///
/// # Returns
/// The full path to the database file in the application's data directory
pub fn get_database_path(db_name: &str) -> Result<PathBuf, String> {
    let db_dir = get_database_dir()?;
    Ok(db_dir.join(db_name))
}

/// Format log messages consistently
pub fn format_log_message(level: &str, message: &str) -> String {
    format!("[{}] {}", level.to_uppercase(), message)
}
