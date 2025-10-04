use super::client::SyncClient;
use super::types::AccessPolicy;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

/// Application state with optional sync client
pub struct AppSyncState {
    pub sync_client: Arc<RwLock<Option<SyncClient>>>,
}

impl AppSyncState {
    pub fn new() -> Self {
        Self {
            sync_client: Arc::new(RwLock::new(None)),
        }
    }
}

/// Connect to the sync broker
#[tauri::command]
pub async fn sync_connect(
    broker_url: String,
    user_id: String,
    local_endpoint: String,
    state: State<'_, AppSyncState>,
) -> Result<(), String> {
    let client = SyncClient::connect(broker_url, user_id, local_endpoint)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    *state.sync_client.write().await = Some(client);

    Ok(())
}

/// Disconnect from the sync broker
#[tauri::command]
pub async fn sync_disconnect(state: State<'_, AppSyncState>) -> Result<(), String> {
    if let Some(client) = state.sync_client.read().await.as_ref() {
        client
            .disconnect()
            .await
            .map_err(|e| format!("Failed to disconnect: {}", e))?;
    }

    *state.sync_client.write().await = None;

    Ok(())
}

/// Check if sync is connected
#[tauri::command]
pub async fn sync_is_connected(state: State<'_, AppSyncState>) -> Result<bool, String> {
    Ok(state.sync_client.read().await.is_some())
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
