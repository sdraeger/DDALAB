use arboard::Clipboard;
use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::net::TcpStream;
use std::process::Command;
use std::time::Duration;
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
    const MAX_SIZE: u64 = 1_048_576;

    let log_file = std::env::temp_dir().join("ddalab.log");

    if !log_file.exists() {
        return Ok(String::from(
            "Log file not found. The application may not have generated any logs yet.",
        ));
    }

    let mut file =
        fs::File::open(&log_file).map_err(|e| format!("Failed to open log file: {}", e))?;

    let file_len = file
        .metadata()
        .map_err(|e| format!("Failed to get file metadata: {}", e))?
        .len();

    let mut content = String::new();

    if file_len > MAX_SIZE {
        file.seek(SeekFrom::Start(file_len - MAX_SIZE))
            .map_err(|e| format!("Failed to seek in log file: {}", e))?;
        file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read log file: {}", e))?;
    } else {
        file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read log file: {}", e))?;
    }

    Ok(content)
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

#[derive(Serialize)]
pub struct NetworkDiagnostics {
    pub localhost_reachable: bool,
    pub ip_127_reachable: bool,
    pub port_check_result: String,
    pub proxy_env_vars: Vec<(String, String)>,
    pub platform: String,
    pub diagnostics: Vec<String>,
}

#[tauri::command]
pub async fn run_network_diagnostics(port: u16) -> Result<NetworkDiagnostics, String> {
    let mut diagnostics = Vec::new();

    // Check if localhost:port is reachable
    let localhost_reachable = TcpStream::connect_timeout(
        &format!("localhost:{}", port)
            .parse()
            .unwrap_or_else(|_| std::net::SocketAddr::from(([127, 0, 0, 1], port))),
        Duration::from_secs(2),
    )
    .is_ok();

    diagnostics.push(format!(
        "localhost:{} reachable: {}",
        port, localhost_reachable
    ));

    // Check if 127.0.0.1:port is reachable
    let ip_127_reachable = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_secs(2),
    )
    .is_ok();

    diagnostics.push(format!(
        "127.0.0.1:{} reachable: {}",
        port, ip_127_reachable
    ));

    // Check for proxy environment variables
    let proxy_vars = [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "NO_PROXY",
        "no_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];

    let proxy_env_vars: Vec<(String, String)> = proxy_vars
        .iter()
        .filter_map(|var| std::env::var(var).ok().map(|val| (var.to_string(), val)))
        .collect();

    if proxy_env_vars.is_empty() {
        diagnostics.push("No proxy environment variables detected".to_string());
    } else {
        diagnostics.push(format!(
            "Proxy environment variables found: {:?}",
            proxy_env_vars
        ));
    }

    // Platform-specific checks
    #[cfg(target_os = "windows")]
    {
        // Check Windows proxy settings via registry or netsh
        diagnostics.push("Platform: Windows".to_string());

        // Try to detect if IE/System proxy is configured
        if let Ok(output) = Command::new("netsh")
            .args(["winhttp", "show", "proxy"])
            .output()
        {
            let proxy_output = String::from_utf8_lossy(&output.stdout);
            if proxy_output.contains("Direct access") {
                diagnostics.push("WinHTTP proxy: Direct access (no proxy)".to_string());
            } else {
                diagnostics.push(format!("WinHTTP proxy settings: {}", proxy_output.trim()));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        diagnostics.push("Platform: macOS".to_string());

        // Check macOS proxy settings
        if let Ok(output) = Command::new("scutil").args(["--proxy"]).output() {
            let proxy_output = String::from_utf8_lossy(&output.stdout);
            if proxy_output.contains("HTTPEnable : 1") || proxy_output.contains("HTTPSEnable : 1") {
                diagnostics.push("System proxy is enabled".to_string());
            } else {
                diagnostics.push("No system proxy detected".to_string());
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        diagnostics.push("Platform: Linux".to_string());
    }

    // Determine port check result message
    let port_check_result = if localhost_reachable && ip_127_reachable {
        "Both localhost and 127.0.0.1 are reachable".to_string()
    } else if !localhost_reachable && ip_127_reachable {
        "WARNING: localhost is blocked but 127.0.0.1 works - possible DNS/proxy interception"
            .to_string()
    } else if localhost_reachable && !ip_127_reachable {
        "WARNING: 127.0.0.1 is blocked but localhost works - unusual configuration".to_string()
    } else {
        "ERROR: Neither localhost nor 127.0.0.1 is reachable - server may not be running or firewall is blocking"
            .to_string()
    };

    diagnostics.push(port_check_result.clone());

    Ok(NetworkDiagnostics {
        localhost_reachable,
        ip_127_reachable,
        port_check_result,
        proxy_env_vars,
        platform: std::env::consts::OS.to_string(),
        diagnostics,
    })
}
