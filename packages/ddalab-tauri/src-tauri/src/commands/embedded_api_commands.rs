use std::sync::Arc;
use std::path::PathBuf;
use parking_lot::RwLock;
use tauri::{Manager, State, AppHandle};
use tokio::task::JoinHandle;
use crate::embedded_api;

// Global state for the embedded API server
#[derive(Debug)]
pub struct EmbeddedApiState {
    pub server_handle: Arc<RwLock<Option<JoinHandle<()>>>>,
    pub is_running: Arc<RwLock<bool>>,
    pub port: Arc<RwLock<u16>>,
}

impl Default for EmbeddedApiState {
    fn default() -> Self {
        Self {
            server_handle: Arc::new(RwLock::new(None)),
            is_running: Arc::new(RwLock::new(false)),
            port: Arc::new(RwLock::new(8765)), // Default port
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

    // Check if server is already running
    {
        let is_running = state.is_running.read();
        if *is_running {
            return Err("Embedded API server is already running".to_string());
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
    let dda_binary_path = app_handle.path()
        .resolve("bin/run_DDA_ASCII", tauri::path::BaseDirectory::Resource)
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

    let is_running_ref = state.is_running.clone();
    let server_handle = tokio::spawn(async move {
        log::info!("📡 Embedded API server task started");

        // Add a delay to ensure we can see this log
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        log::info!("⏰ About to call embedded_api::start_embedded_api_server...");

        if let Err(e) = embedded_api::start_embedded_api_server(port, data_dir, dda_binary_path).await {
            log::error!("❌ Embedded API server startup failed: {}", e);
            // Update the running state on failure
            {
                let mut running = is_running_ref.write();
                *running = false;
            }
        } else {
            log::info!("✅ Embedded API server completed successfully");
        }
        log::info!("🔚 Embedded API server task ended");
    });

    // Update state - will be corrected if startup fails
    {
        let mut handle_guard = state.server_handle.write();
        *handle_guard = Some(server_handle);
    }
    {
        let mut is_running = state.is_running.write();
        *is_running = true;
    }
    {
        let mut port_guard = state.port.write();
        *port_guard = port;
    }

    log::info!("Embedded API server task spawned for port {}", port);
    Ok(format!("Embedded API server starting on http://127.0.0.1:{}", port))
}

#[tauri::command]
pub async fn stop_embedded_api_server(
    state: State<'_, EmbeddedApiState>,
) -> Result<String, String> {
    // Check if server is running
    {
        let is_running = state.is_running.read();
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
        let mut is_running = state.is_running.write();
        *is_running = false;
    }

    log::info!("Stopped embedded API server");
    Ok("Embedded API server stopped".to_string())
}

#[tauri::command]
pub async fn get_embedded_api_status(
    state: State<'_, EmbeddedApiState>,
) -> Result<serde_json::Value, String> {
    let is_running = *state.is_running.read();
    let port = *state.port.read();

    Ok(serde_json::json!({
        "running": is_running,
        "port": port,
        "url": if is_running {
            Some(format!("http://127.0.0.1:{}", port))
        } else {
            None
        }
    }))
}

#[tauri::command]
pub async fn check_embedded_api_health(
    state: State<'_, EmbeddedApiState>,
) -> Result<serde_json::Value, String> {
    let is_running = *state.is_running.read();

    if !is_running {
        return Ok(serde_json::json!({
            "status": "stopped",
            "healthy": false
        }));
    }

    let port = *state.port.read();
    let client = reqwest::Client::new();

    match client
        .get(&format!("http://127.0.0.1:{}/api/health", port))
        .timeout(std::time::Duration::from_secs(5))
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
