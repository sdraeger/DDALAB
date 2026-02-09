use ddalab_tauri::api::state::ApiState;
use ddalab_tauri::db::gallery_db::{GalleryDB, GalleryItem};
use ddalab_tauri::gallery::data_transform::serialize_for_gallery;
use ddalab_tauri::gallery::generator::{GalleryConfig, GalleryExportResult, GalleryGenerator};
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// Metadata for a single item to publish.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryItemMeta {
    pub analysis_id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub tags: Vec<String>,
}

#[tauri::command]
pub async fn select_gallery_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app.dialog().file().blocking_pick_folder();

    match path {
        Some(file_path) => {
            let p = file_path
                .as_path()
                .ok_or_else(|| "Invalid directory path".to_string())?;
            Ok(Some(p.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn export_gallery(
    api_state: State<'_, Arc<ApiState>>,
    analysis_ids: Vec<String>,
    config: GalleryConfig,
    item_metadata: Vec<GalleryItemMeta>,
    output_directory: String,
) -> Result<GalleryExportResult, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    // Build a lookup map for metadata by analysis_id
    let meta_map: std::collections::HashMap<&str, &GalleryItemMeta> = item_metadata
        .iter()
        .map(|m| (m.analysis_id.as_str(), m))
        .collect();

    // Fetch all analyses and transform them
    let mut gallery_items = Vec::new();
    let mut warnings = Vec::new();

    for analysis_id in &analysis_ids {
        let analysis = db
            .get_analysis(analysis_id)
            .map_err(|e| format!("Failed to fetch analysis {}: {}", analysis_id, e))?
            .ok_or_else(|| format!("Analysis {} not found", analysis_id))?;

        let meta = meta_map
            .get(analysis_id.as_str())
            .ok_or_else(|| format!("No metadata provided for analysis {}", analysis_id))?;

        match serialize_for_gallery(
            &analysis,
            &meta.title,
            &meta.description,
            &meta.author,
            &meta.tags,
            500, // max columns for decimation
        ) {
            Ok(data) => gallery_items.push(data),
            Err(e) => {
                warnings.push(format!("Skipping {}: {}", analysis_id, e));
            }
        }
    }

    if gallery_items.is_empty() {
        return Err("No valid analyses to export".to_string());
    }

    // Generate the gallery
    let generator = GalleryGenerator::new(config);
    let output_path = PathBuf::from(&output_directory);
    let mut result = generator
        .generate(&gallery_items, &output_path)
        .map_err(|e| format!("Gallery generation failed: {}", e))?;

    result.warnings.extend(warnings);

    // Record items in the gallery database
    db.with_connection(|conn| {
        let gallery_db = GalleryDB::new(conn);
        for (item, meta) in gallery_items.iter().zip(item_metadata.iter()) {
            let id = uuid::Uuid::new_v4().to_string();
            if let Err(e) = gallery_db.add_item(
                &id,
                &meta.analysis_id,
                &meta.title,
                Some(meta.description.as_str()),
                Some(meta.author.as_str()),
                &meta.tags,
                &output_directory,
            ) {
                log::warn!("Failed to record gallery item for {}: {}", item.id, e);
            }
        }
        Ok::<_, String>(())
    })
    .map_err(|e| format!("Failed to record gallery items: {}", e))?;

    log::info!(
        "Gallery exported: {} pages to {}",
        result.pages_generated,
        output_directory
    );

    Ok(result)
}

#[tauri::command]
pub async fn list_gallery_items(
    api_state: State<'_, Arc<ApiState>>,
) -> Result<Vec<GalleryItem>, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let gallery_db = GalleryDB::new(conn);
        gallery_db
            .list_items()
            .map_err(|e| format!("Failed to list gallery items: {}", e))
    })
}

#[tauri::command]
pub async fn remove_gallery_item(
    api_state: State<'_, Arc<ApiState>>,
    item_id: String,
) -> Result<bool, String> {
    let db = api_state
        .analysis_db
        .as_ref()
        .ok_or("Analysis database not available")?;

    db.with_connection(|conn| {
        let gallery_db = GalleryDB::new(conn);
        gallery_db
            .remove_item(&item_id)
            .map_err(|e| format!("Failed to remove gallery item: {}", e))
    })
}

#[tauri::command]
pub async fn open_gallery_directory(
    app: tauri::AppHandle,
    directory: String,
) -> Result<(), String> {
    tauri_plugin_shell::ShellExt::shell(&app)
        .open(&directory, None)
        .map_err(|e| format!("Failed to open directory: {}", e))
}
