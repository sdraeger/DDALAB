use super::client::SyncClient;
use super::discovery::{self, DiscoveredBroker};
use super::types::{
    AccessPolicy, DDAJobParameters, JobStatusResponse, QueueStats, ServerFileInfo,
    SubmitJobResponse, SubmitServerFileRequest,
};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Emit sync connection status change event to frontend
fn emit_sync_connection_change(app: &AppHandle, connected: bool) {
    if let Err(e) = app.emit("sync-connection-changed", connected) {
        warn!("Failed to emit sync-connection-changed event: {}", e);
    }
}

/// Login request to auth/login endpoint
#[derive(Debug, Serialize)]
struct LoginRequest {
    user_id: String,
    password: String,
    endpoint: Option<String>,
}

/// Login response from auth/login endpoint
#[derive(Debug, Deserialize)]
struct LoginResponse {
    session_token: String,
    user_id: String,
    expires_in_seconds: u64,
}

/// Server connection info for HTTP API calls
#[derive(Clone)]
pub struct ServerConnection {
    pub base_url: String,
    pub auth_token: Option<String>,
}

impl ServerConnection {
    /// Create an HTTP client with auth headers
    fn create_client(&self) -> Result<reqwest::Client, String> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        if let Some(ref token) = self.auth_token {
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {}", token))
                    .map_err(|e| format!("Invalid auth token: {}", e))?,
            );
        }

        reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))
    }
}

/// Application state with optional sync client
pub struct AppSyncState {
    pub sync_client: Arc<RwLock<Option<SyncClient>>>,
    pub server_connection: Arc<RwLock<Option<ServerConnection>>>,
}

impl AppSyncState {
    pub fn new() -> Self {
        Self {
            sync_client: Arc::new(RwLock::new(None)),
            server_connection: Arc::new(RwLock::new(None)),
        }
    }
}

/// Connect to the sync broker
#[tauri::command]
pub async fn sync_connect(
    broker_url: String,
    user_id: String,
    local_endpoint: String,
    password: Option<String>,
    app: AppHandle,
    state: State<'_, AppSyncState>,
) -> Result<(), String> {
    // Extract HTTP base URL from WebSocket URL
    let http_base_url = broker_url
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .trim_end_matches("/ws")
        .to_string();

    // Authenticate with the server first (always attempt - server may require auth)
    info!("Authenticating with server at {}", http_base_url);

    let login_request = LoginRequest {
        user_id: user_id.clone(),
        password: password.clone().unwrap_or_default(),
        endpoint: Some(local_endpoint.clone()),
    };

    let client = reqwest::Client::new();
    let login_url = format!("{}/auth/login", http_base_url);

    let response = client
        .post(&login_url)
        .json(&login_request)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to server: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        error!("Authentication failed: {}", error_text);
        // Provide a helpful error message
        if error_text.contains("Invalid password") && password.is_none() {
            return Err("Server requires authentication. Please provide a password.".to_string());
        }
        return Err(format!("Authentication failed: {}", error_text));
    }

    let login_response: LoginResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse login response: {}", e))?;

    info!(
        "Authenticated as {} (session expires in {}s)",
        login_response.user_id, login_response.expires_in_seconds
    );

    let session_token = login_response.session_token;

    // Connect WebSocket for sync features (pass session token, not password)
    let client = SyncClient::connect(
        broker_url,
        user_id,
        local_endpoint,
        Some(session_token.clone()),
    )
    .await
    .map_err(|e| format!("Failed to connect: {}", e))?;

    *state.sync_client.write().await = Some(client);

    // Store server connection for HTTP API calls
    *state.server_connection.write().await = Some(ServerConnection {
        base_url: http_base_url,
        auth_token: Some(session_token),
    });

    // Emit connection status change event
    emit_sync_connection_change(&app, true);

    Ok(())
}

/// Disconnect from the sync broker
#[tauri::command]
pub async fn sync_disconnect(app: AppHandle, state: State<'_, AppSyncState>) -> Result<(), String> {
    if let Some(client) = state.sync_client.read().await.as_ref() {
        client
            .disconnect()
            .await
            .map_err(|e| format!("Failed to disconnect: {}", e))?;
    }

    *state.sync_client.write().await = None;
    *state.server_connection.write().await = None;

    // Emit disconnection event
    emit_sync_connection_change(&app, false);

    Ok(())
}

/// Check if sync is connected
#[tauri::command]
pub async fn sync_is_connected(state: State<'_, AppSyncState>) -> Result<bool, String> {
    let guard = state.sync_client.read().await;
    match guard.as_ref() {
        Some(client) => Ok(client.is_connected()),
        None => Ok(false),
    }
}

/// Share a result
#[tauri::command]
pub async fn sync_share_result(
    result_id: String,
    title: String,
    description: Option<String>,
    access_policy: AccessPolicy,
    state: State<'_, AppSyncState>,
) -> Result<String, String> {
    let guard = state.sync_client.read().await;
    let client = guard.as_ref().ok_or("Sync is not connected")?;

    let share_link = client
        .share_result(&result_id, &title, description, access_policy)
        .await
        .map_err(|e| format!("Failed to share: {}", e))?;

    Ok(share_link)
}

/// Access a shared result
#[tauri::command]
pub async fn sync_access_share(
    token: String,
    state: State<'_, AppSyncState>,
) -> Result<super::types::SharedResultInfo, String> {
    let client = state.sync_client.read().await;
    let client = client.as_ref().ok_or("Sync is not connected")?;

    let share_info = client
        .access_share(&token)
        .await
        .map_err(|e| format!("Failed to access share: {}", e))?;

    Ok(share_info)
}

/// Revoke a share
#[tauri::command]
pub async fn sync_revoke_share(
    token: String,
    state: State<'_, AppSyncState>,
) -> Result<(), String> {
    let client = state.sync_client.read().await;
    let client = client.as_ref().ok_or("Sync is not connected")?;

    client
        .revoke_share(&token)
        .await
        .map_err(|e| format!("Failed to revoke share: {}", e))?;

    Ok(())
}

/// Discover brokers on the local network
#[tauri::command]
pub async fn sync_discover_brokers(timeout_secs: u64) -> Result<Vec<DiscoveredBroker>, String> {
    discovery::discover_brokers(timeout_secs)
        .await
        .map_err(|e| format!("Discovery failed: {}", e))
}

/// Verify password against broker's auth hash
#[tauri::command]
pub fn sync_verify_password(password: String, auth_hash: String) -> Result<bool, String> {
    Ok(discovery::verify_password(&password, &auth_hash))
}

// ============================================================================
// Job Management Commands
// ============================================================================

/// Submit a job for a server-side file
#[tauri::command]
pub async fn job_submit_server_file(
    server_path: String,
    parameters: DDAJobParameters,
    state: State<'_, AppSyncState>,
) -> Result<SubmitJobResponse, String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let url = format!("{}/api/jobs/submit", conn.base_url);

    let request = SubmitServerFileRequest {
        server_path,
        parameters,
    };

    info!("Submitting job to server: {}", url);

    let response = client
        .post(&url)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Failed to submit job: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        error!("Job submission failed: {}", error_text);
        return Err(format!("Job submission failed: {}", error_text));
    }

    let result: SubmitJobResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    info!("Job submitted successfully: {}", result.job_id);
    Ok(result)
}

/// Get job status
#[tauri::command]
pub async fn job_get_status(
    job_id: String,
    state: State<'_, AppSyncState>,
) -> Result<JobStatusResponse, String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let url = format!("{}/api/jobs/{}", conn.base_url, job_id);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to get job status: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get job status: {}", error_text));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// List all jobs
#[tauri::command]
pub async fn job_list(
    user_id: Option<String>,
    state: State<'_, AppSyncState>,
) -> Result<Vec<JobStatusResponse>, String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let mut url = format!("{}/api/jobs", conn.base_url);
    if let Some(uid) = user_id {
        url = format!("{}?user_id={}", url, uid);
    }

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to list jobs: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to list jobs: {}", error_text));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Cancel a job
#[tauri::command]
pub async fn job_cancel(job_id: String, state: State<'_, AppSyncState>) -> Result<bool, String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let url = format!("{}/api/jobs/{}/cancel", conn.base_url, job_id);

    let response = client
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to cancel job: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to cancel job: {}", error_text));
    }

    info!("Job {} cancelled", job_id);
    Ok(true)
}

/// Get queue statistics
#[tauri::command]
pub async fn job_get_queue_stats(state: State<'_, AppSyncState>) -> Result<QueueStats, String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let url = format!("{}/api/jobs/stats", conn.base_url);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to get queue stats: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get queue stats: {}", error_text));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// List available server files
#[tauri::command]
pub async fn job_list_server_files(
    path: Option<String>,
    state: State<'_, AppSyncState>,
) -> Result<Vec<ServerFileInfo>, String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let url = format!("{}/api/files", conn.base_url);

    let mut request = client.get(&url);
    if let Some(p) = path {
        request = request.query(&[("path", p)]);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to list server files: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to list server files: {}", error_text));
    }

    response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

/// Download job results
#[tauri::command]
pub async fn job_download_results(
    job_id: String,
    output_path: String,
    state: State<'_, AppSyncState>,
) -> Result<(), String> {
    let conn = state.server_connection.read().await;
    let conn = conn.as_ref().ok_or("Not connected to server")?;

    let client = conn.create_client()?;
    let url = format!("{}/api/jobs/{}/download", conn.base_url, job_id);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download results: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to download results: {}", error_text));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    tokio::fs::write(&output_path, &bytes)
        .await
        .map_err(|e| format!("Failed to save results: {}", e))?;

    info!("Downloaded job results to {}", output_path);
    Ok(())
}
