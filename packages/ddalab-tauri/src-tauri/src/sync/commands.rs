use super::client::SyncClient;
use super::discovery::{self, DiscoveredBroker};
use super::types::{
    AccessPolicy, DDAJobParameters, DataClassification, InstitutionConfig, JobStatusResponse,
    QueueStats, ServerFileInfo, ShareableContentType, SubmitJobResponse, SubmitServerFileRequest,
};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

static SYNC_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .build()
        .expect("Failed to create HTTP client")
});

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
    pub local_shares: Arc<RwLock<HashMap<String, LocalSharedContentRecord>>>,
}

impl AppSyncState {
    pub fn new() -> Self {
        Self {
            sync_client: Arc::new(RwLock::new(None)),
            server_connection: Arc::new(RwLock::new(None)),
            local_shares: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RichAccessPolicy {
    #[serde(rename = "type")]
    pub policy_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_ids: Option<Vec<String>>,
    pub institution_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub federated_institution_ids: Option<Vec<String>>,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub expires_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_downloads: Option<u32>,
}

impl RichAccessPolicy {
    fn from_legacy(policy: &AccessPolicy) -> Self {
        let policy_type = match policy {
            AccessPolicy::Public => "public".to_string(),
            AccessPolicy::Team { .. } => "team".to_string(),
            AccessPolicy::Users { .. } => "users".to_string(),
        };
        let team_id = match policy {
            AccessPolicy::Team { team_id } => Some(team_id.clone()),
            _ => None,
        };
        let user_ids = match policy {
            AccessPolicy::Users { user_ids } => Some(user_ids.clone()),
            _ => None,
        };

        let expires_at = (chrono::Utc::now() + chrono::Duration::days(30)).to_rfc3339();

        Self {
            policy_type,
            team_id,
            user_ids,
            institution_id: "default".to_string(),
            federated_institution_ids: None,
            permissions: vec!["view".to_string(), "download".to_string()],
            expires_at,
            max_downloads: None,
        }
    }

    fn to_legacy(&self) -> AccessPolicy {
        match self.policy_type.as_str() {
            "team" => AccessPolicy::Team {
                team_id: self.team_id.clone().unwrap_or_default(),
            },
            "users" => AccessPolicy::Users {
                user_ids: self.user_ids.clone().unwrap_or_default(),
            },
            _ => AccessPolicy::Public,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiShareMetadata {
    pub share_token: String,
    pub owner_user_id: String,
    pub content_type: ShareableContentType,
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: String,
    pub access_policy: RichAccessPolicy,
    pub classification: DataClassification,
    pub download_count: u32,
    pub last_accessed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSharedItem {
    #[serde(flatten)]
    pub metadata: ApiShareMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedContentInfo {
    pub metadata: ApiShareMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_data: Option<serde_json::Value>,
    pub download_url: String,
    pub owner_online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_name: Option<String>,
}

#[derive(Debug, Clone)]
pub struct LocalSharedContentRecord {
    pub metadata: ApiShareMetadata,
    pub content_data: Option<serde_json::Value>,
    pub owner_name: Option<String>,
}

fn generate_local_share_token() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use rand::Rng;

    let mut rng = rand::rng();
    let bytes: [u8; 16] = rng.random();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn parse_share_token(share_link: &str) -> Option<String> {
    share_link
        .strip_prefix("ddalab://share/")
        .map(ToString::to_string)
}

fn parse_rfc3339_or_now(value: &str) -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|_| chrono::Utc::now())
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

    let login_url = format!("{}/auth/login", http_base_url);

    let response = SYNC_CLIENT
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

/// Share a result (legacy - for DDA results only)
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

    let description_for_store = description.clone();
    let access_policy_for_store = access_policy.clone();
    let share_link = client
        .share_result(&result_id, &title, description, access_policy)
        .await
        .map_err(|e| format!("Failed to share: {}", e))?;

    let share_token = parse_share_token(&share_link).unwrap_or_else(generate_local_share_token);
    let owner_user_id = client.user_id().to_string();
    let owner_name = owner_user_id
        .split('@')
        .next()
        .map(ToString::to_string)
        .filter(|v| !v.is_empty());
    let metadata = ApiShareMetadata {
        share_token: share_token.clone(),
        owner_user_id,
        content_type: ShareableContentType::DdaResult,
        content_id: result_id,
        title,
        description: description_for_store,
        created_at: chrono::Utc::now().to_rfc3339(),
        access_policy: RichAccessPolicy::from_legacy(&access_policy_for_store),
        classification: DataClassification::Unclassified,
        download_count: 0,
        last_accessed_at: None,
    };

    state.local_shares.write().await.insert(
        share_token,
        LocalSharedContentRecord {
            metadata,
            content_data: None,
            owner_name,
        },
    );

    Ok(share_link)
}

/// Request to share any content type
#[derive(Debug, Deserialize)]
pub struct ShareContentRequest {
    pub content_type: ShareableContentType,
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub access_policy: RichAccessPolicy,
    pub classification: DataClassification,
    pub content_data: Option<serde_json::Value>,
}

/// Share any content type (annotations, workflows, parameters, etc.)
#[tauri::command]
pub async fn sync_share_content(
    request: ShareContentRequest,
    state: State<'_, AppSyncState>,
) -> Result<String, String> {
    let ShareContentRequest {
        content_type,
        content_id,
        title,
        description,
        access_policy,
        classification,
        content_data,
    } = request;

    let guard = state.sync_client.read().await;
    let client = guard.as_ref().ok_or("Sync is not connected")?;
    let owner_user_id = client.user_id().to_string();
    let created_at = chrono::Utc::now();

    let broker_metadata = super::types::ShareMetadata {
        owner_user_id: owner_user_id.clone(),
        content_type,
        content_id: content_id.clone(),
        title: title.clone(),
        description: description.clone(),
        created_at,
        access_policy: access_policy.to_legacy(),
        classification,
        download_count: 0,
        last_accessed_at: None,
    };

    let share_link = client
        .publish_share_metadata(broker_metadata)
        .await
        .map_err(|e| format!("Failed to share: {}", e))?;
    let share_token = parse_share_token(&share_link).unwrap_or_else(generate_local_share_token);
    let owner_name = owner_user_id
        .split('@')
        .next()
        .map(ToString::to_string)
        .filter(|v| !v.is_empty());

    let metadata = ApiShareMetadata {
        share_token: share_token.clone(),
        owner_user_id,
        content_type,
        content_id,
        title,
        description,
        created_at: created_at.to_rfc3339(),
        access_policy,
        classification,
        download_count: 0,
        last_accessed_at: None,
    };

    state.local_shares.write().await.insert(
        share_token,
        LocalSharedContentRecord {
            metadata,
            content_data,
            owner_name,
        },
    );

    Ok(share_link)
}

/// List content shared by current user
#[tauri::command]
pub async fn sync_list_my_shares(
    state: State<'_, AppSyncState>,
) -> Result<Vec<ApiShareMetadata>, String> {
    let current_user_id = state
        .sync_client
        .read()
        .await
        .as_ref()
        .map(|c| c.user_id().to_string());

    let mut shares: Vec<ApiShareMetadata> = state
        .local_shares
        .read()
        .await
        .values()
        .filter(|record| {
            current_user_id
                .as_ref()
                .map(|uid| record.metadata.owner_user_id == *uid)
                .unwrap_or(true)
        })
        .map(|record| record.metadata.clone())
        .collect();

    shares.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(shares)
}

/// List content shared with current user
#[tauri::command]
pub async fn sync_list_shared_with_me(
    state: State<'_, AppSyncState>,
) -> Result<Vec<ApiSharedItem>, String> {
    let current_user_id = state
        .sync_client
        .read()
        .await
        .as_ref()
        .map(|c| c.user_id().to_string());

    let mut shares: Vec<ApiSharedItem> = state
        .local_shares
        .read()
        .await
        .values()
        .filter(|record| {
            current_user_id
                .as_ref()
                .map(|uid| record.metadata.owner_user_id != *uid)
                .unwrap_or(true)
        })
        .map(|record| ApiSharedItem {
            metadata: record.metadata.clone(),
            owner_name: record.owner_name.clone(),
        })
        .collect();

    shares.sort_by(|a, b| b.metadata.created_at.cmp(&a.metadata.created_at));
    Ok(shares)
}

/// Access shared content with typed payload (annotations/workflows/parameters/data-segments)
#[tauri::command]
pub async fn sync_access_shared_content(
    token: String,
    state: State<'_, AppSyncState>,
) -> Result<SharedContentInfo, String> {
    let mut local_shares = state.local_shares.write().await;
    if let Some(record) = local_shares.get_mut(&token) {
        record.metadata.download_count += 1;
        record.metadata.last_accessed_at = Some(chrono::Utc::now().to_rfc3339());
        return Ok(SharedContentInfo {
            metadata: record.metadata.clone(),
            content_data: record.content_data.clone(),
            download_url: format!("ddalab://share/{}", token),
            owner_online: true,
            owner_name: record.owner_name.clone(),
        });
    }
    drop(local_shares);

    let client = state.sync_client.read().await;
    let client = client.as_ref().ok_or("Sync is not connected")?;
    let share_info = client
        .access_share(&token)
        .await
        .map_err(|e| format!("Failed to access shared content: {}", e))?;

    let metadata = ApiShareMetadata {
        share_token: token,
        owner_user_id: share_info.metadata.owner_user_id,
        content_type: share_info.metadata.content_type,
        content_id: share_info.metadata.content_id,
        title: share_info.metadata.title,
        description: share_info.metadata.description,
        created_at: share_info.metadata.created_at.to_rfc3339(),
        access_policy: RichAccessPolicy::from_legacy(&share_info.metadata.access_policy),
        classification: share_info.metadata.classification,
        download_count: share_info.metadata.download_count,
        last_accessed_at: share_info
            .metadata
            .last_accessed_at
            .map(|dt| dt.to_rfc3339()),
    };

    Ok(SharedContentInfo {
        metadata,
        content_data: None,
        download_url: share_info.download_url,
        owner_online: share_info.owner_online,
        owner_name: None,
    })
}

/// Access a shared result
#[tauri::command]
pub async fn sync_access_share(
    token: String,
    state: State<'_, AppSyncState>,
) -> Result<super::types::SharedResultInfo, String> {
    let mut local_shares = state.local_shares.write().await;
    if let Some(record) = local_shares.get_mut(&token) {
        record.metadata.download_count += 1;
        record.metadata.last_accessed_at = Some(chrono::Utc::now().to_rfc3339());
        let metadata = super::types::ShareMetadata {
            owner_user_id: record.metadata.owner_user_id.clone(),
            content_type: record.metadata.content_type,
            content_id: record.metadata.content_id.clone(),
            title: record.metadata.title.clone(),
            description: record.metadata.description.clone(),
            created_at: parse_rfc3339_or_now(&record.metadata.created_at),
            access_policy: record.metadata.access_policy.to_legacy(),
            classification: record.metadata.classification,
            download_count: record.metadata.download_count,
            last_accessed_at: record
                .metadata
                .last_accessed_at
                .as_deref()
                .map(parse_rfc3339_or_now),
        };
        return Ok(super::types::SharedResultInfo {
            metadata,
            download_url: format!("ddalab://share/{}", token),
            owner_online: true,
        });
    }
    drop(local_shares);

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
    let removed_local = state.local_shares.write().await.remove(&token).is_some();

    let client = state.sync_client.read().await;
    if let Some(client) = client.as_ref() {
        if let Err(e) = client.revoke_share(&token).await {
            if !removed_local {
                return Err(format!("Failed to revoke share: {}", e));
            }
            warn!("Failed to revoke broker share {}: {}", token, e);
        }
    }

    if !removed_local && client.is_none() {
        return Err("Share not found".to_string());
    }

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

// ============================================================================
// Institution Configuration Commands
// ============================================================================

/// Get the current institution configuration
#[tauri::command]
pub async fn get_institution_config(
    state: State<'_, AppSyncState>,
) -> Result<InstitutionConfig, String> {
    let conn = state.server_connection.read().await;

    if let Some(ref conn) = *conn {
        let client = conn.create_client()?;
        let url = format!("{}/api/institution/config", conn.base_url);

        let response = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Failed to get institution config: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Failed to get institution config: {}", error_text));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse institution config: {}", e))
    } else {
        Ok(InstitutionConfig::default())
    }
}

/// Update institution configuration (admin only)
#[tauri::command]
pub async fn update_institution_config(
    config: InstitutionConfig,
    state: State<'_, AppSyncState>,
) -> Result<InstitutionConfig, String> {
    let conn = state.server_connection.read().await;

    if let Some(ref conn) = *conn {
        let client = conn.create_client()?;
        let url = format!("{}/api/institution/config", conn.base_url);

        let response = client
            .put(&url)
            .json(&config)
            .send()
            .await
            .map_err(|e| format!("Failed to update institution config: {}", e))?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!(
                "Failed to update institution config: {}",
                error_text
            ));
        }

        response
            .json()
            .await
            .map_err(|e| format!("Failed to parse updated institution config: {}", e))
    } else {
        Err("Not connected to server".to_string())
    }
}
