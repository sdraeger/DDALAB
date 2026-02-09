//! Batch DDA Analysis Tauri IPC Commands
//!
//! Provides commands for running DDA analysis across multiple files sequentially,
//! with progress events and cancellation support.
//!
//! Commands:
//! - submit_batch_analysis: Run DDA on multiple files, emitting progress events
//! - cancel_batch_analysis: Cancel the current batch

use super::dda_ipc_commands::{run_single_analysis, DDAAnalysisRequest};
use ddalab_tauri::api::models::DDAResult;
use ddalab_tauri::api::state::ApiState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisRequest {
    pub batch_id: String,
    pub requests: Vec<DDAAnalysisRequest>,
    #[serde(default)]
    pub continue_on_error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchFileResult {
    pub file_path: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAnalysisResult {
    pub batch_id: String,
    pub total: usize,
    pub completed: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub results: Vec<BatchFileResult>,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchProgressEvent {
    pub batch_id: String,
    pub file_index: usize,
    pub total_files: usize,
    pub file_path: String,
    pub file_status: String,
    pub overall_progress: f64,
    pub message: String,
}

// ============================================================================
// Shared cancellation flag for batch operations
// ============================================================================

static BATCH_CANCELLED: AtomicBool = AtomicBool::new(false);

fn reset_batch_cancellation() {
    BATCH_CANCELLED.store(false, Ordering::SeqCst);
}

fn is_batch_cancelled() -> bool {
    BATCH_CANCELLED.load(Ordering::SeqCst)
}

fn request_batch_cancellation() {
    BATCH_CANCELLED.store(true, Ordering::SeqCst);
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Submit a batch DDA analysis job. Processes files sequentially, emitting
/// `batch-progress` events for each file. Supports cancellation between files.
#[tauri::command]
pub async fn submit_batch_analysis(
    app: AppHandle,
    api_state: State<'_, Arc<ApiState>>,
    request: BatchAnalysisRequest,
) -> Result<BatchAnalysisResult, String> {
    let batch_id = request.batch_id.clone();
    let total = request.requests.len();

    log::info!(
        "[BATCH_IPC] submit_batch_analysis: batch_id={}, files={}",
        batch_id,
        total
    );

    if total == 0 {
        return Err("Batch request contains no files".to_string());
    }

    reset_batch_cancellation();

    let start_time = Instant::now();
    let mut results: Vec<BatchFileResult> = Vec::with_capacity(total);
    let mut completed = 0usize;
    let mut failed = 0usize;
    let mut cancelled = 0usize;

    for (i, file_request) in request.requests.iter().enumerate() {
        // Check cancellation between files
        if is_batch_cancelled() {
            log::info!(
                "[BATCH_IPC] Batch {} cancelled at file {}/{}",
                batch_id,
                i + 1,
                total
            );

            // Mark remaining files as cancelled
            for remaining in request.requests.iter().skip(i) {
                results.push(BatchFileResult {
                    file_path: remaining.file_path.clone(),
                    status: "cancelled".to_string(),
                    analysis_id: None,
                    error: None,
                });
                cancelled += 1;
            }
            break;
        }

        let progress = (i as f64 / total as f64) * 100.0;

        // Emit progress: starting file
        let _ = app.emit(
            "batch-progress",
            BatchProgressEvent {
                batch_id: batch_id.clone(),
                file_index: i,
                total_files: total,
                file_path: file_request.file_path.clone(),
                file_status: "running".to_string(),
                overall_progress: progress,
                message: format!(
                    "[{}/{}] Processing {}...",
                    i + 1,
                    total,
                    file_request.file_path
                ),
            },
        );

        // Run analysis
        match run_single_analysis(&app, &api_state, file_request).await {
            Ok(result) => {
                completed += 1;
                results.push(BatchFileResult {
                    file_path: file_request.file_path.clone(),
                    status: "completed".to_string(),
                    analysis_id: Some(result.id.clone()),
                    error: None,
                });

                // Emit progress: file completed
                let _ = app.emit(
                    "batch-progress",
                    BatchProgressEvent {
                        batch_id: batch_id.clone(),
                        file_index: i,
                        total_files: total,
                        file_path: file_request.file_path.clone(),
                        file_status: "completed".to_string(),
                        overall_progress: ((i + 1) as f64 / total as f64) * 100.0,
                        message: format!(
                            "[{}/{}] Completed {}",
                            i + 1,
                            total,
                            file_request.file_path
                        ),
                    },
                );
            }
            Err(e) => {
                failed += 1;
                results.push(BatchFileResult {
                    file_path: file_request.file_path.clone(),
                    status: "error".to_string(),
                    analysis_id: None,
                    error: Some(e.clone()),
                });

                // Emit progress: file failed
                let _ = app.emit(
                    "batch-progress",
                    BatchProgressEvent {
                        batch_id: batch_id.clone(),
                        file_index: i,
                        total_files: total,
                        file_path: file_request.file_path.clone(),
                        file_status: "error".to_string(),
                        overall_progress: ((i + 1) as f64 / total as f64) * 100.0,
                        message: format!(
                            "[{}/{}] Failed: {} - {}",
                            i + 1,
                            total,
                            file_request.file_path,
                            e
                        ),
                    },
                );

                if !request.continue_on_error {
                    // Mark remaining as cancelled
                    for remaining in request.requests.iter().skip(i + 1) {
                        results.push(BatchFileResult {
                            file_path: remaining.file_path.clone(),
                            status: "cancelled".to_string(),
                            analysis_id: None,
                            error: None,
                        });
                        cancelled += 1;
                    }
                    break;
                }
            }
        }
    }

    let elapsed_ms = start_time.elapsed().as_millis() as u64;

    log::info!(
        "[BATCH_IPC] Batch {} complete: {}/{} succeeded, {}/{} failed, {}/{} cancelled, {}ms",
        batch_id,
        completed,
        total,
        failed,
        total,
        cancelled,
        total,
        elapsed_ms
    );

    // Create analysis group from completed results
    let completed_ids: Vec<String> = results
        .iter()
        .filter(|r| r.status == "completed")
        .filter_map(|r| r.analysis_id.clone())
        .collect();

    let group_id = if !completed_ids.is_empty() {
        // Set batch_id on all completed analyses and create a comparison group
        if let Some(ref db) = api_state.analysis_db {
            for aid in &completed_ids {
                if let Err(e) = db.set_batch_id(aid, &batch_id) {
                    log::warn!("[BATCH_IPC] Failed to set batch_id on {}: {}", aid, e);
                }
            }

            let gid = uuid::Uuid::new_v4().to_string();
            let group_name = format!("Batch {}", &batch_id[..8]);
            match db.with_connection(|conn| {
                use crate::db::analysis_groups_db::AnalysisGroupsDB;
                let groups_db = AnalysisGroupsDB::new(conn);
                groups_db.create_group(&gid, &group_name, None, "batch", &completed_ids)
            }) {
                Ok(_) => {
                    log::info!(
                        "[BATCH_IPC] Created analysis group {} with {} members",
                        gid,
                        completed_ids.len()
                    );
                    Some(gid)
                }
                Err(e) => {
                    log::error!("[BATCH_IPC] Failed to create analysis group: {}", e);
                    None
                }
            }
        } else {
            None
        }
    } else {
        None
    };

    // Emit final progress
    let _ = app.emit(
        "batch-progress",
        BatchProgressEvent {
            batch_id: batch_id.clone(),
            file_index: total,
            total_files: total,
            file_path: String::new(),
            file_status: "batch_complete".to_string(),
            overall_progress: 100.0,
            message: format!(
                "Batch complete: {}/{} succeeded, {}/{} failed",
                completed, total, failed, total
            ),
        },
    );

    Ok(BatchAnalysisResult {
        batch_id,
        total,
        completed,
        failed,
        cancelled,
        results,
        elapsed_ms,
        group_id,
    })
}

/// Cancel the current batch analysis. The batch will stop after completing
/// the currently running file.
#[tauri::command]
pub async fn cancel_batch_analysis() -> Result<(), String> {
    log::info!("[BATCH_IPC] cancel_batch_analysis requested");
    request_batch_cancellation();
    Ok(())
}
