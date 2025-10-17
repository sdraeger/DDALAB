use std::sync::Arc;
use std::path::PathBuf;
use parking_lot::{RwLock, Mutex};
use tauri::{Manager, State, AppHandle};
use tokio::task::JoinHandle;
use crate::embedded_api;

// Global state for the embedded API server
#[derive(Debug)]
pub struct EmbeddedApiState {
    pub server_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
    pub is_running: Arc<Mutex<bool>>, // Use Mutex for proper mutual exclusion against race conditions
    pub port: Arc<RwLock<u16>>,
    pub session_token: Arc<RwLock<Option<String>>>,
    pub use_https: Arc<RwLock<bool>>,
}

impl Default for EmbeddedApiState {
    fn default() -> Self {
        Self {
            server_handle: Arc::new(RwLock::new(None)),
            is_running: Arc::new(Mutex::new(false)), // Mutex ensures only one thread can check/set at a time
            port: Arc::new(RwLock::new(8765)), // Default port
            session_token: Arc::new(RwLock::new(None)),
            use_https: Arc::new(RwLock::new(true)), // HTTPS enabled by default
        }
    }
}

#[tauri::command]
pub async fn start_embedded_api_server(
    state: State<'_, EmbeddedApiState>,
    app_handle: AppHandle,
    port: Option<u16>,
    data_directory: Option<String>,
) -> Result<String, String> {
    let port = port.unwrap_or(8765); // Use 8765 - a less common port to avoid conflicts
    let data_dir = if let Some(dir) = data_directory {
        PathBuf::from(dir)
    } else {
        // Try to load from saved configuration
        match crate::commands::data_directory_commands::load_data_directory(&app_handle).await {
            Ok(dir) => PathBuf::from(dir),
            Err(_) => {
                // Fall back to default
                let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
                PathBuf::from(home).join("Desktop/DDALAB/data")
            }
        }
    };

    // Check if server is already running - return session token for idempotency
    {
        let is_running = state.is_running.lock();
        if *is_running {
            let port = *state.port.read();
            let use_https = *state.use_https.read();
            let session_token = state.session_token.read().clone().unwrap_or_default();
            let protocol = if use_https { "https" } else { "http" };
            log::info!("Embedded API server is already running on port {}", port);
            return Ok(session_token);
        }
    }

    // Ensure data directory exists
    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create data directory: {}", e))?;
    }

    // Start the server in a background task with proper error handling
    log::info!("🚀 Starting embedded API server on port {} with data dir: {:?}", port, data_dir);

    // Resolve DDA binary path using Tauri's path resolution
    // Platform-specific binary name (APE binary needs .exe extension on Windows)
    let binary_resource_path = if cfg!(target_os = "windows") {
        "bin/run_DDA_AsciiEdf.exe"
    } else {
        "bin/run_DDA_AsciiEdf"
    };

    let dda_binary_path = app_handle.path()
        .resolve(binary_resource_path, tauri::path::BaseDirectory::Resource)
        .ok()
        .and_then(|path| {
            // Only use the resolved path if it actually exists
            if path.exists() {
                log::info!("✅ Resolved DDA binary path: {:?}", path);
                Some(path)
            } else {
                log::warn!("⚠️ Tauri resolved path doesn't exist: {:?}, will fall back to development paths", path);
                None
            }
        });

    if dda_binary_path.is_none() {
        log::info!("🔍 No bundled binary found, will use development fallback paths");
    }

    // Configure the server with HTTPS enabled by default
    // TODO: Re-enable auth after debugging race condition - token mismatch still occurring
    let config = embedded_api::ApiServerConfig {
        port,
        bind_address: "127.0.0.1".to_string(),
        use_https: true,
        require_auth: true,
        hostname: None,
    };

    // Check if server is already running and return existing token
    // IMPORTANT: Use Mutex to ensure atomic check-and-set operation
    // This prevents race conditions where two calls both see is_running==false
    let should_start = {
        let mut is_running = state.is_running.lock();
        if *is_running {
            false // Already running
        } else {
            *is_running = true; // Mark as running NOW to prevent concurrent starts
            true // Should start new server
        }
    };

    if !should_start {
        // Server already running, return existing token
        if let Some(existing_token) = state.session_token.read().clone() {
            log::info!("✅ Server already running, returning existing token");
            return Ok(existing_token);
        }
    }

    log::info!("⏰ About to start secure embedded API server...");

    // Start the server and get the session token
    // The server spawns its own background task internally
    match embedded_api::start_embedded_api_server_secure(config, data_dir, dda_binary_path).await {
        Ok(token) => {
            log::info!("✅ Embedded API server started successfully with session token");

            // Store the session token in state
            {
                let mut session_token = state.session_token.write();
                *session_token = Some(token.clone());
            }

            // Store the port
            {
                let mut port_guard = state.port.write();
                *port_guard = port;
            }

            log::info!("✅ Returning session token to frontend: {}", &token[..8.min(token.len())]);
            Ok(token)
        }
        Err(e) => {
            log::error!("❌ Embedded API server startup failed: {}", e);

            // Update the running state on failure
            {
                let mut running = state.is_running.lock();
                *running = false;
            }

            Err(format!("Failed to start embedded API server: {}", e))
        }
    }
}

#[tauri::command]
pub async fn stop_embedded_api_server(
    state: State<'_, EmbeddedApiState>,
) -> Result<String, String> {
    // Check if server is running
    {
        let is_running = state.is_running.lock();
        if !*is_running {
            return Err("Embedded API server is not running".to_string());
        }
    }

    // Stop the server
    {
        let mut handle_guard = state.server_handle.write();
        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }
    }

    // Update state
    {
        let mut is_running = state.is_running.lock();
        *is_running = false;
    }

    log::info!("Stopped embedded API server");
    Ok("Embedded API server stopped".to_string())
}

#[tauri::command]
pub async fn get_embedded_api_status(
    state: State<'_, EmbeddedApiState>,
) -> Result<serde_json::Value, String> {
    let is_running = *state.is_running.lock();
    let port = *state.port.read();

    let use_https = *state.use_https.read();
    let protocol = if use_https { "https" } else { "http" };
    let session_token = state.session_token.read().clone();

    Ok(serde_json::json!({
        "running": is_running,
        "port": port,
        "url": if is_running {
            Some(format!("{}://127.0.0.1:{}", protocol, port))
        } else {
            None
        },
        "session_token": session_token,
        "use_https": use_https
    }))
}

#[tauri::command]
pub async fn check_embedded_api_health(
    state: State<'_, EmbeddedApiState>,
) -> Result<serde_json::Value, String> {
    let is_running = *state.is_running.lock();

    if !is_running {
        return Ok(serde_json::json!({
            "status": "stopped",
            "healthy": false
        }));
    }

    let port = *state.port.read();
    let use_https = *state.use_https.read();
    let protocol = if use_https { "https" } else { "http" };

    // Create client that accepts self-signed certificates for HTTPS
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true) // Accept self-signed certs in development
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    match client
        .get(&format!("{}://127.0.0.1:{}/api/health", protocol, port))
        .send()
        .await
    {
        Ok(response) => {
            if response.status().is_success() {
                match response.json::<serde_json::Value>().await {
                    Ok(health_data) => Ok(serde_json::json!({
                        "status": "running",
                        "healthy": true,
                        "health": health_data
                    })),
                    Err(_) => Ok(serde_json::json!({
                        "status": "running",
                        "healthy": false,
                        "error": "Invalid health response"
                    }))
                }
            } else {
                Ok(serde_json::json!({
                    "status": "running",
                    "healthy": false,
                    "error": format!("HTTP {}", response.status())
                }))
            }
        }
        Err(e) => Ok(serde_json::json!({
            "status": "running",
            "healthy": false,
            "error": e.to_string()
        }))
    }
}
