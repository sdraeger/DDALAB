use crate::state_manager::AppStateManager;
use ddalab_tauri::api::handlers::dda::DDARequest;
use ddalab_tauri::db::{NSGJob, NSGJobStatus};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct NSGCredentialsResponse {
    pub username: String,
    pub password: String,
    pub app_key: String,
}

/// Save NSG credentials to encrypted storage and reinitialize NSG components
#[tauri::command]
pub async fn save_nsg_credentials(
    username: String,
    password: String,
    app_key: String,
    state: State<'_, AppStateManager>,
) -> Result<(), String> {
    let secrets_db = state.get_secrets_db();
    secrets_db
        .save_nsg_credentials(&username, &password, &app_key)
        .map_err(|e| format!("Failed to save NSG credentials: {}", e))?;

    // Reinitialize NSG components with the new credentials
    state.reinitialize_nsg_components()?;

    Ok(())
}

/// Get NSG credentials from encrypted storage
#[tauri::command]
pub async fn get_nsg_credentials(
    state: State<'_, AppStateManager>,
) -> Result<Option<NSGCredentialsResponse>, String> {
    let secrets_db = state.get_secrets_db();

    let creds = secrets_db
        .get_nsg_credentials()
        .map_err(|e| format!("Failed to get NSG credentials: {}", e))?;

    Ok(
        creds.map(|(username, password, app_key)| NSGCredentialsResponse {
            username,
            password,
            app_key,
        }),
    )
}

/// Check if NSG credentials are stored
#[tauri::command]
pub async fn has_nsg_credentials(state: State<'_, AppStateManager>) -> Result<bool, String> {
    let secrets_db = state.get_secrets_db();
    secrets_db
        .has_nsg_credentials()
        .map_err(|e| format!("Failed to check NSG credentials: {}", e))
}

/// Delete NSG credentials from storage
#[tauri::command]
pub async fn delete_nsg_credentials(state: State<'_, AppStateManager>) -> Result<(), String> {
    let secrets_db = state.get_secrets_db();
    secrets_db
        .delete_nsg_credentials()
        .map_err(|e| format!("Failed to delete NSG credentials: {}", e))
}

/// Test NSG connection with current credentials
#[tauri::command]
pub async fn test_nsg_connection(state: State<'_, AppStateManager>) -> Result<bool, String> {
    let secrets_db = state.get_secrets_db();

    // Get credentials
    let (username, password, app_key) = secrets_db
        .get_nsg_credentials()
        .map_err(|e| format!("Failed to get NSG credentials: {}", e))?
        .ok_or_else(|| "No NSG credentials stored".to_string())?;

    // Create temporary client to test connection
    let credentials = ddalab_tauri::nsg::NSGCredentials {
        username,
        password,
        app_key,
    };

    let client = ddalab_tauri::nsg::NSGClient::new(credentials)
        .map_err(|e| format!("Failed to create NSG client: {}", e))?;

    client
        .test_connection()
        .await
        .map_err(|e| format!("Failed to test NSG connection: {}", e))
}

/// Create a new NSG job (prepares job but doesn't submit yet)
#[tauri::command]
pub async fn create_nsg_job(
    tool: String,
    dda_params: DDARequest,
    input_file_path: String,
    runtime_hours: Option<f64>,
    cores: Option<u32>,
    nodes: Option<u32>,
    state: State<'_, AppStateManager>,
) -> Result<String, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    // Create resource configuration
    let resource_config = if runtime_hours.is_some() || cores.is_some() || nodes.is_some() {
        Some(ddalab_tauri::nsg::NSGResourceConfig {
            runtime_hours,
            cores,
            nodes,
        })
    } else {
        Some(ddalab_tauri::nsg::NSGResourceConfig::default())
    };

    let job = nsg_manager
        .create_job_with_resources(tool, dda_params, input_file_path, resource_config)
        .await
        .map_err(|e| format!("Failed to create NSG job: {}", e))?;

    Ok(job.id)
}

/// Submit a prepared NSG job to the cluster
#[tauri::command]
pub async fn submit_nsg_job(
    job_id: String,
    state: State<'_, AppStateManager>,
) -> Result<NSGJob, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    nsg_manager
        .submit_job(&job_id)
        .await
        .map_err(|e| format!("Failed to submit NSG job: {}", e))
}

/// Get status of a specific NSG job
#[tauri::command]
pub async fn get_nsg_job_status(
    job_id: String,
    state: State<'_, AppStateManager>,
) -> Result<NSGJob, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    // Update job status from NSG API
    nsg_manager
        .update_job_status(&job_id)
        .await
        .map_err(|e| format!("Failed to get NSG job status: {}", e))
}

/// List all NSG jobs (both DDALAB and external jobs)
#[tauri::command]
pub async fn list_nsg_jobs(state: State<'_, AppStateManager>) -> Result<Vec<NSGJob>, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    nsg_manager
        .list_all_jobs()
        .await
        .map_err(|e| format!("Failed to list NSG jobs: {}", e))
}

/// List only active NSG jobs (pending, submitted, running)
#[tauri::command]
pub async fn list_active_nsg_jobs(
    state: State<'_, AppStateManager>,
) -> Result<Vec<NSGJob>, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    nsg_manager
        .get_active_jobs()
        .map_err(|e| format!("Failed to list active NSG jobs: {}", e))
}

/// Cancel a running NSG job
#[tauri::command]
pub async fn cancel_nsg_job(
    job_id: String,
    state: State<'_, AppStateManager>,
) -> Result<(), String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    nsg_manager
        .cancel_job(&job_id)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to cancel NSG job: {}", e))
}

/// Download results from a completed NSG job
#[tauri::command]
pub async fn download_nsg_results(
    job_id: String,
    state: State<'_, AppStateManager>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    let paths = nsg_manager
        .download_results(&job_id, Some(app))
        .await
        .map_err(|e| format!("Failed to download NSG results: {}", e))?;

    // Convert PathBuf to String
    Ok(paths
        .into_iter()
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect())
}

/// Extract a tarball from NSG results
#[tauri::command]
pub async fn extract_nsg_tarball(
    job_id: String,
    tar_path: String,
    state: State<'_, AppStateManager>,
) -> Result<Vec<String>, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    let paths = nsg_manager
        .extract_tarball(&job_id, &tar_path)
        .map_err(|e| format!("Failed to extract tarball: {}", e))?;

    // Convert PathBuf to String
    Ok(paths
        .into_iter()
        .filter_map(|p| p.to_str().map(|s| s.to_string()))
        .collect())
}

/// Delete a job and its associated files
#[tauri::command]
pub async fn delete_nsg_job(
    job_id: String,
    state: State<'_, AppStateManager>,
) -> Result<(), String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    nsg_manager
        .delete_job(&job_id)
        .map_err(|e| format!("Failed to delete NSG job: {}", e))
}

/// Manually trigger a poll of active jobs
#[tauri::command]
pub async fn poll_nsg_jobs(state: State<'_, AppStateManager>) -> Result<Vec<String>, String> {
    let nsg_poller = state
        .get_nsg_poller()
        .ok_or_else(|| "NSG poller not initialized".to_string())?;

    nsg_poller
        .poll_once()
        .await
        .map_err(|e| format!("Failed to poll NSG jobs: {}", e))
}

/// Get NSG job statistics
#[tauri::command]
pub async fn get_nsg_job_stats(
    state: State<'_, AppStateManager>,
) -> Result<serde_json::Value, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    let jobs = nsg_manager
        .list_jobs()
        .map_err(|e| format!("Failed to list NSG jobs: {}", e))?;

    let mut stats = serde_json::json!({
        "total": jobs.len(),
        "pending": 0,
        "submitted": 0,
        "running": 0,
        "completed": 0,
        "failed": 0,
        "cancelled": 0,
    });

    for job in jobs {
        match job.status {
            NSGJobStatus::Pending => {
                stats["pending"] = serde_json::json!(stats["pending"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::Submitted => {
                stats["submitted"] = serde_json::json!(stats["submitted"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::Queue => {
                stats["submitted"] = serde_json::json!(stats["submitted"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::InputStaging => {
                stats["submitted"] = serde_json::json!(stats["submitted"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::Running => {
                stats["running"] = serde_json::json!(stats["running"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::Completed => {
                stats["completed"] = serde_json::json!(stats["completed"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::Failed => {
                stats["failed"] = serde_json::json!(stats["failed"].as_u64().unwrap_or(0) + 1)
            }
            NSGJobStatus::Cancelled => {
                stats["cancelled"] = serde_json::json!(stats["cancelled"].as_u64().unwrap_or(0) + 1)
            }
        }
    }

    Ok(stats)
}

/// Clean up old pending jobs (jobs that failed to submit properly)
#[tauri::command]
pub async fn cleanup_pending_nsg_jobs(state: State<'_, AppStateManager>) -> Result<usize, String> {
    let nsg_manager = state
        .get_nsg_manager()
        .ok_or_else(|| "NSG manager not initialized".to_string())?;

    let jobs = nsg_manager
        .list_jobs()
        .map_err(|e| format!("Failed to list NSG jobs: {}", e))?;

    let mut deleted_count = 0;

    // Find all jobs that are still in "Pending" state
    // These are jobs that were created but never successfully submitted
    for job in jobs {
        if matches!(job.status, NSGJobStatus::Pending) {
            log::info!("Cleaning up pending job: {}", job.id);
            nsg_manager
                .delete_job(&job.id)
                .map_err(|e| format!("Failed to delete pending job {}: {}", job.id, e))?;
            deleted_count += 1;
        }
    }

    log::info!("Cleaned up {} pending NSG jobs", deleted_count);
    Ok(deleted_count)
}
