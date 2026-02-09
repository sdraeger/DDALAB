//! Comparison / Analysis Group Tauri IPC Commands
//!
//! CRUD operations for analysis groups (persisted comparison sets).
//! Also provides bulk metadata fetching for comparison views.

use crate::db::analysis_groups_db::{AnalysisGroup, AnalysisGroupWithMembers, AnalysisGroupsDB};
use ddalab_tauri::api::models::parse_dda_parameters;
use ddalab_tauri::api::state::ApiState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGroupRequest {
    pub name: String,
    pub description: Option<String>,
    pub source: String,
    pub member_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGroupRequest {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[tauri::command]
pub async fn create_analysis_group(
    api_state: State<'_, Arc<ApiState>>,
    request: CreateGroupRequest,
) -> Result<AnalysisGroup, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    let group_id = uuid::Uuid::new_v4().to_string();

    db.with_connection(|conn| {
        let groups_db = AnalysisGroupsDB::new(conn);
        groups_db
            .create_group(
                &group_id,
                &request.name,
                request.description.as_deref(),
                &request.source,
                &request.member_ids,
            )
            .map_err(|e| format!("Failed to create group: {}", e))
    })
}

#[tauri::command]
pub async fn get_analysis_group(
    api_state: State<'_, Arc<ApiState>>,
    group_id: String,
) -> Result<Option<AnalysisGroupWithMembers>, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let groups_db = AnalysisGroupsDB::new(conn);
        groups_db
            .get_group(&group_id)
            .map_err(|e| format!("Failed to get group: {}", e))
    })
}

#[tauri::command]
pub async fn list_analysis_groups(
    api_state: State<'_, Arc<ApiState>>,
    limit: Option<usize>,
) -> Result<Vec<AnalysisGroup>, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    let limit = limit.unwrap_or(50);

    db.with_connection(|conn| {
        let groups_db = AnalysisGroupsDB::new(conn);
        groups_db
            .list_groups(limit)
            .map_err(|e| format!("Failed to list groups: {}", e))
    })
}

#[tauri::command]
pub async fn update_analysis_group(
    api_state: State<'_, Arc<ApiState>>,
    request: UpdateGroupRequest,
) -> Result<bool, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let groups_db = AnalysisGroupsDB::new(conn);
        groups_db
            .update_group(
                &request.id,
                request.name.as_deref(),
                request.description.as_deref(),
            )
            .map_err(|e| format!("Failed to update group: {}", e))
    })
}

#[tauri::command]
pub async fn delete_analysis_group(
    api_state: State<'_, Arc<ApiState>>,
    group_id: String,
) -> Result<(), String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let groups_db = AnalysisGroupsDB::new(conn);
        groups_db
            .delete_group(&group_id)
            .map_err(|e| format!("Failed to delete group: {}", e))
    })
}

/// Bulk fetch metadata for multiple analyses (avoids N serial IPC calls).
/// Returns metadata without plot_data for fast loading.
#[tauri::command]
pub async fn get_analyses_metadata_batch(
    api_state: State<'_, Arc<ApiState>>,
    analysis_ids: Vec<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    let mut results = Vec::with_capacity(analysis_ids.len());

    for id in &analysis_ids {
        match db.get_analysis_metadata(id) {
            Ok(Some(analysis)) => {
                let channels: Vec<String> = parse_dda_parameters(analysis.parameters.clone())
                    .map(|p| p.selected_channels)
                    .unwrap_or_default();

                results.push(serde_json::json!({
                    "id": analysis.id,
                    "filePath": analysis.file_path,
                    "timestamp": analysis.timestamp,
                    "variantName": analysis.variant_name,
                    "variantDisplayName": analysis.variant_display_name,
                    "parameters": analysis.parameters,
                    "chunkPosition": analysis.chunk_position,
                    "name": analysis.name,
                    "channels": channels,
                }));
            }
            Ok(None) => {
                log::warn!("[COMPARISON] Analysis {} not found", id);
            }
            Err(e) => {
                log::error!("[COMPARISON] Failed to get metadata for {}: {}", id, e);
            }
        }
    }

    Ok(results)
}
