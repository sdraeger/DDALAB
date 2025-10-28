use ddalab_tauri::api::{self, start_api_server, ApiServerConfig};
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::task::JoinHandle;

// ============================================================================
// API Connection Configuration
// ============================================================================

/// Configuration for connecting to the DDA API server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConnectionConfig {
    /// Hostname or IP address of the API server
    pub host: String,
    /// Port number
    pub port: u16,
    /// Use HTTPS (true) or HTTP (false)
    pub use_https: bool,
    /// Whether this is a local embedded server or remote server
    pub is_local: bool,
    /// Session token for authentication
    pub session_token: Option<String>,
}

impl Default for ApiConnectionConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8765,
            use_https: false, // HTTP by default - HTTPS has WebView trust issues
            is_local: true,
            session_token: None,
        }
    }
}

impl ApiConnectionConfig {
    /// Get the full API URL
    pub fn url(&self) -> String {
        let protocol = if self.use_https { "https" } else { "http" };
        format!("{}://{}:{}", protocol, self.host, self.port)
    }

    /// Check if this is a localhost connection
    pub fn is_localhost(&self) -> bool {
        self.host == "127.0.0.1" || self.host == "localhost"
    }
}

// ============================================================================
// Global API State
// ============================================================================

/// Global state for the API server (when running locally)
#[derive(Debug)]
pub struct ApiServerState {
    /// Handle to the running server task (if local)
    pub server_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
    /// Whether a local server is running
    pub is_local_server_running: Arc<Mutex<bool>>,
    /// Current API connection configuration
    pub connection_config: Arc<RwLock<ApiConnectionConfig>>,
}

impl Default for ApiServerState {
    fn default() -> Self {
        Self {
            server_handle: Arc::new(RwLock::new(None)),
            is_local_server_running: Arc::new(Mutex::new(false)),
            connection_config: Arc::new(RwLock::new(ApiConnectionConfig::default())),
        }
    }
}

// ============================================================================
// Configuration Persistence
// ============================================================================

const API_CONFIG_FILE: &str = "api_connection.json";

/// Save API connection configuration to disk
#[tauri::command]
pub async fn save_api_config(
    app_handle: AppHandle,
    config: ApiConnectionConfig,
    state: State<'_, ApiServerState>,
) -> Result<(), String> {
    // Save to app data directory
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    let config_path = app_data_dir.join(API_CONFIG_FILE);
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    std::fs::write(&config_path, json).map_err(|e| format!("Failed to write config: {}", e))?;

    // Update in-memory state
    {
        let mut conn_config = state.connection_config.write();
        *conn_config = config;
    }

    log::info!("Saved API connection config to: {:?}", config_path);
    Ok(())
}

/// Load API connection configuration from disk
#[tauri::command]
pub async fn load_api_config(
    app_handle: AppHandle,
    state: State<'_, ApiServerState>,
) -> Result<ApiConnectionConfig, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let config_path = app_data_dir.join(API_CONFIG_FILE);

    if !config_path.exists() {
        log::info!("No saved API config found, using defaults");
        return Ok(ApiConnectionConfig::default());
    }

    let json = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: ApiConnectionConfig =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse config: {}", e))?;

    // Update in-memory state
    {
        let mut conn_config = state.connection_config.write();
        *conn_config = config.clone();
    }

    log::info!("Loaded API connection config from: {:?}", config_path);
    Ok(config)
}

/// Get current API connection configuration
#[tauri::command]
pub async fn get_api_config(
    state: State<'_, ApiServerState>,
) -> Result<ApiConnectionConfig, String> {
    let config = state.connection_config.read().clone();
    Ok(config)
}

// ============================================================================
// API Server Management (for local server only)
// ============================================================================

/// Start a local embedded API server
#[tauri::command]
pub async fn start_local_api_server(
    state: State<'_, ApiServerState>,
    app_handle: AppHandle,
    port: Option<u16>,
    host: Option<String>,
    data_directory: Option<String>,
) -> Result<ApiConnectionConfig, String> {
    // Atomic check-and-set to prevent race conditions from double-starts
    {
        let mut is_running = state.is_local_server_running.lock();
        if *is_running {
            log::info!("Local API server already running, returning existing config");
            return Ok(state.connection_config.read().clone());
        }
        // Set the flag immediately to prevent concurrent starts
        *is_running = true;
    }

    // Load saved config or use defaults
    let saved_config = load_api_config(app_handle.clone(), state.clone())
        .await
        .ok();

    let port = port
        .or_else(|| saved_config.as_ref().map(|c| c.port))
        .unwrap_or(8765);
    let host = host
        .or_else(|| saved_config.as_ref().map(|c| c.host.clone()))
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let data_dir = if let Some(dir) = data_directory {
        PathBuf::from(dir)
    } else {
        match crate::commands::data_directory_commands::load_data_directory(&app_handle).await {
            Ok(dir) => PathBuf::from(dir),
            Err(_) => {
                let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                PathBuf::from(home).join("Desktop/DDALAB/data")
            }
        }
    };

    // Ensure data directory exists
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    log::info!(
        "🚀 Starting local API server on {}:{} with data dir: {:?}",
        host,
        port,
        data_dir
    );

    // Resolve DDA binary path
    let binary_resource_path = if cfg!(target_os = "windows") {
        "bin/run_DDA_AsciiEdf.exe"
    } else {
        "bin/run_DDA_AsciiEdf"
    };

    let dda_binary_path = app_handle
        .path()
        .resolve(binary_resource_path, tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|path| {
            if path.exists() {
                log::info!("✅ Resolved DDA binary path: {:?}", path);
                Some(path)
            } else {
                log::warn!("⚠️ Tauri resolved path doesn't exist: {:?}", path);
                None
            }
        });

    // Load use_https preference from app preferences
    let use_https =
        match crate::commands::preference_commands::get_app_preferences(app_handle.clone()).await {
            Ok(prefs) => prefs.use_https,
            Err(_) => true, // Default to HTTPS for security
        };

    log::info!(
        "🔐 HTTPS mode: {}",
        if use_https {
            "enabled"
        } else {
            "disabled (HTTP)"
        }
    );

    // Configure the server
    let server_config = ApiServerConfig {
        port,
        bind_address: host.clone(),
        use_https,
        require_auth: true,
        hostname: None,
    };

    log::info!("⏰ Starting API server...");

    // Start the server
    match start_api_server(server_config, data_dir, dda_binary_path).await {
        Ok((session_token, actual_port, task_handle)) => {
            log::info!(
                "✅ Local API server started successfully on port {}",
                actual_port
            );

            // Store the task handle so we can stop the server later
            {
                let mut handle_guard = state.server_handle.write();
                *handle_guard = Some(task_handle);
                log::info!("📌 Server task handle stored for clean shutdown");
            }

            // Create connection config with the ACTUAL port that was used
            let config = ApiConnectionConfig {
                host: host.clone(),
                port: actual_port, // Use actual port, not requested port!
                use_https,
                is_local: true,
                session_token: Some(session_token),
            };

            log::info!(
                "📡 API accessible at: {}://{}:{}",
                if use_https { "https" } else { "http" },
                host,
                actual_port
            );

            // Update state
            {
                let mut conn_config = state.connection_config.write();
                *conn_config = config.clone();
            }

            // Save config
            if let Err(e) = save_api_config(app_handle, config.clone(), state.clone()).await {
                log::warn!("Failed to save API config: {}", e);
            }

            Ok(config)
        }
        Err(e) => {
            log::error!("❌ Failed to start local API server: {}", e);
            {
                let mut is_running = state.is_local_server_running.lock();
                *is_running = false;
            }
            Err(format!("Failed to start local API server: {}", e))
        }
    }
}

/// Stop the local API server
#[tauri::command]
pub async fn stop_local_api_server(state: State<'_, ApiServerState>) -> Result<(), String> {
    log::info!("🛑 Attempting to stop local API server...");

    // Always try to abort the task, even if the flag says it's not running
    // This handles zombie servers from previous sessions
    let had_handle = {
        let mut handle_guard = state.server_handle.write();
        if let Some(handle) = handle_guard.take() {
            log::info!("🔪 Aborting server task handle");
            handle.abort();
            true
        } else {
            log::warn!("⚠️ No server task handle found");
            false
        }
    };

    // Always clear the running flag
    {
        let mut is_running = state.is_local_server_running.lock();
        *is_running = false;
    }

    // Clear the connection config to force regeneration on next start
    {
        let mut conn_config = state.connection_config.write();
        conn_config.session_token = None;
    }

    // Give the server a moment to shut down
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    if had_handle {
        log::info!("✅ Stopped local API server");
        Ok(())
    } else {
        log::warn!("⚠️ Server was not tracked, but state has been cleared");
        Ok(()) // Return Ok anyway since we've cleared the state
    }
}

// ============================================================================
// API Connection Testing
// ============================================================================

/// Check if the configured API server is reachable
#[tauri::command]
pub async fn check_api_connection(
    state: State<'_, ApiServerState>,
) -> Result<serde_json::Value, String> {
    let config = state.connection_config.read().clone();
    let url = config.url();

    log::info!("Checking API connection to: {}", url);

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true) // Accept self-signed certs
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    match client.get(&format!("{}/api/health", url)).send().await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(health_data) => Ok(serde_json::json!({
                        "status": "connected",
                        "healthy": true,
                        "url": url,
                        "health": health_data
                    })),
                    Err(_) => Ok(serde_json::json!({
                        "status": "connected",
                        "healthy": false,
                        "url": url,
                        "error": "Invalid health response"
                    })),
                }
            } else {
                Ok(serde_json::json!({
                    "status": "connected",
                    "healthy": false,
                    "url": url,
                    "error": format!("HTTP {}", response.status())
                }))
            }
        }
        Err(e) => Ok(serde_json::json!({
            "status": "disconnected",
            "healthy": false,
            "url": url,
            "error": e.to_string()
        })),
    }
}

/// Get current API server status
#[tauri::command]
pub async fn get_api_status(state: State<'_, ApiServerState>) -> Result<serde_json::Value, String> {
    let config = state.connection_config.read().clone();
    let is_local_running_flag = *state.is_local_server_running.lock();

    // Check if server is actually reachable (more reliable than the flag)
    let url = config.url();
    let is_actually_running = {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .ok();

        if let Some(client) = client {
            client
                .get(&format!("{}/api/health", url))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false)
        } else {
            false
        }
    };

    Ok(serde_json::json!({
        "url": url,
        "host": config.host,
        "port": config.port,
        "use_https": config.use_https,
        "is_local": config.is_local,
        "is_local_server_running": is_actually_running,  // Use actual status, not flag
        "is_local_server_running_flag": is_local_running_flag,  // Include flag for debugging
        "has_session_token": config.session_token.is_some(),
    }))
}

/// Connect to a remote API server
#[tauri::command]
pub async fn connect_to_remote_api(
    app_handle: AppHandle,
    state: State<'_, ApiServerState>,
    host: String,
    port: u16,
    use_https: bool,
) -> Result<ApiConnectionConfig, String> {
    log::info!("Connecting to remote API server: {}:{}", host, port);

    // Create config for remote server
    let config = ApiConnectionConfig {
        host,
        port,
        use_https,
        is_local: false,
        session_token: None, // Remote servers may use different auth
    };

    // Test connection
    let url = config.url();
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    match client.get(&format!("{}/api/health", url)).send().await {
        Ok(response) if response.status().is_success() => {
            log::info!("✅ Successfully connected to remote API server");

            // Update state
            {
                let mut conn_config = state.connection_config.write();
                *conn_config = config.clone();
            }

            // Save config
            if let Err(e) = save_api_config(app_handle, config.clone(), state).await {
                log::warn!("Failed to save remote API config: {}", e);
            }

            Ok(config)
        }
        Ok(response) => Err(format!(
            "API server returned error: HTTP {}",
            response.status()
        )),
        Err(e) => Err(format!("Failed to connect to remote API server: {}", e)),
    }
}
