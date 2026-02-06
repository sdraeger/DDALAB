use std::path::{Path, PathBuf};

pub mod certs;
pub mod file_hash;

/// Maximum file size for reading entire files into memory (100 MB)
pub const MAX_FILE_READ_SIZE: u64 = 100 * 1024 * 1024;

/// Maximum file size for config/JSON files (10 MB)
pub const MAX_CONFIG_FILE_SIZE: u64 = 10 * 1024 * 1024;

/// Read a file to string with size validation to prevent OOM on large/malicious files
///
/// # Arguments
/// * `path` - Path to the file
/// * `max_size` - Maximum allowed file size in bytes
///
/// # Returns
/// File contents as String, or error if file is too large or unreadable
pub fn read_to_string_with_limit(path: &Path, max_size: u64) -> std::io::Result<String> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > max_size {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "File too large: {} bytes (max: {} bytes)",
                metadata.len(),
                max_size
            ),
        ));
    }
    std::fs::read_to_string(path)
}

/// Read a file to bytes with size validation to prevent OOM on large/malicious files
///
/// # Arguments
/// * `path` - Path to the file
/// * `max_size` - Maximum allowed file size in bytes
///
/// # Returns
/// File contents as Vec<u8>, or error if file is too large or unreadable
pub fn read_with_limit(path: &Path, max_size: u64) -> std::io::Result<Vec<u8>> {
    let metadata = std::fs::metadata(path)?;
    if metadata.len() > max_size {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "File too large: {} bytes (max: {} bytes)",
                metadata.len(),
                max_size
            ),
        ));
    }
    std::fs::read(path)
}

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
