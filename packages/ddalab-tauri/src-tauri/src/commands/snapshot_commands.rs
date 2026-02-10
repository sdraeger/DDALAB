use crate::db::annotation_db::FileAnnotations;
use crate::snapshot::reader::SnapshotReader;
use crate::snapshot::types::*;
use crate::snapshot::writer::SnapshotWriter;
use crate::state_manager::AppStateManager;
use ddalab_tauri::api::state::ApiState;
use std::path::Path;
use std::sync::Arc;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn export_snapshot(
    app: tauri::AppHandle,
    api_state: State<'_, Arc<ApiState>>,
    state_manager: State<'_, AppStateManager>,
    source_file_path: String,
    analysis_ids: Vec<String>,
    mode: SnapshotMode,
    name: String,
    description: Option<String>,
    _parameters: serde_json::Value,
    source_file_info: SourceFileInfo,
    workflow: Option<serde_json::Value>,
) -> Result<Option<String>, String> {
    log::info!(
        "Exporting snapshot for file: {} ({} analyses, mode: {:?})",
        source_file_path,
        analysis_ids.len(),
        mode
    );

    let analysis_db = api_state
        .analysis_db
        .as_ref()
        .ok_or_else(|| "Analysis database not available".to_string())?;

    let annotation_db = state_manager.get_annotation_db();

    let sanitized_name = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>();
    let default_filename = format!("{}.ddalab", sanitized_name);

    let save_path = app
        .dialog()
        .file()
        .add_filter("DDALAB Snapshot", &["ddalab"])
        .set_file_name(&default_filename)
        .blocking_save_file();

    if let Some(file_path) = save_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        let app_version = env!("CARGO_PKG_VERSION").to_string();
        let writer = SnapshotWriter::new(analysis_db, annotation_db, app_version);

        writer
            .write_snapshot(
                &source_file_path,
                path,
                &analysis_ids,
                &mode,
                &name,
                description.as_deref(),
                &source_file_info,
                workflow.as_ref(),
            )
            .map_err(|e| format!("Failed to write snapshot: {}", e))?;

        log::info!("Snapshot exported to: {}", path_str);
        Ok(Some(path_str))
    } else {
        log::info!("Snapshot export cancelled by user");
        Ok(None)
    }
}

#[tauri::command]
pub async fn import_snapshot(
    app: tauri::AppHandle,
) -> Result<Option<SnapshotImportResult>, String> {
    log::info!("Opening snapshot import dialog");

    let open_path = app
        .dialog()
        .file()
        .add_filter("DDALAB Snapshot", &["ddalab"])
        .blocking_pick_file();

    if let Some(file_path) = open_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        let manifest = SnapshotReader::read_manifest(path)
            .map_err(|e| format!("Failed to read snapshot: {}", e))?;

        let suggested_source = if Path::new(&manifest.source_file.original_path).exists() {
            Some(manifest.source_file.original_path.clone())
        } else {
            None
        };

        let validation = SnapshotReader::validate(&manifest, suggested_source.as_deref());

        log::info!(
            "Snapshot imported: {} ({} analyses, valid: {})",
            manifest.name,
            manifest.analyses.len(),
            validation.valid
        );

        Ok(Some(SnapshotImportResult {
            manifest,
            validation,
            snapshot_path: path_str,
            suggested_source_path: suggested_source,
        }))
    } else {
        log::info!("Snapshot import cancelled by user");
        Ok(None)
    }
}

#[tauri::command]
pub async fn apply_snapshot(
    api_state: State<'_, Arc<ApiState>>,
    state_manager: State<'_, AppStateManager>,
    snapshot_path: String,
    source_file_path: String,
) -> Result<SnapshotApplyResult, String> {
    log::info!(
        "Applying snapshot {} to file {}",
        snapshot_path,
        source_file_path
    );

    let path = Path::new(&snapshot_path);

    let manifest = SnapshotReader::read_manifest(path)
        .map_err(|e| format!("Failed to read snapshot manifest: {}", e))?;

    let analysis_db = api_state
        .analysis_db
        .as_ref()
        .ok_or_else(|| "Analysis database not available".to_string())?;

    let mut analyses_restored = 0usize;

    let analyses = SnapshotReader::extract_analyses(path, &manifest)
        .map_err(|e| format!("Failed to extract analyses: {}", e))?;

    for mut analysis in analyses {
        analysis.file_path = source_file_path.clone();
        analysis_db
            .save_analysis(&analysis)
            .map_err(|e| format!("Failed to save analysis: {}", e))?;
        analyses_restored += 1;
    }

    let mut annotations_restored = 0usize;

    if let Some(annotations_value) = SnapshotReader::extract_annotations(path)
        .map_err(|e| format!("Failed to extract annotations: {}", e))?
    {
        let annotation_db = state_manager.get_annotation_db();

        if let Ok(file_annotations) = serde_json::from_value::<FileAnnotations>(annotations_value) {
            for annotation in &file_annotations.global_annotations {
                if annotation_db
                    .save_annotation(&source_file_path, None, annotation, None)
                    .is_ok()
                {
                    annotations_restored += 1;
                }
            }

            for (channel, channel_anns) in &file_annotations.channel_annotations {
                for annotation in channel_anns {
                    if annotation_db
                        .save_annotation(&source_file_path, Some(channel), annotation, None)
                        .is_ok()
                    {
                        annotations_restored += 1;
                    }
                }
            }
        }
    }

    log::info!(
        "Snapshot applied: {} analyses restored, {} annotations restored",
        analyses_restored,
        annotations_restored
    );

    Ok(SnapshotApplyResult {
        analyses_restored,
        annotations_restored,
        source_file_path,
    })
}

#[tauri::command]
pub async fn inspect_snapshot(path: String) -> Result<SnapshotInspectResult, String> {
    log::info!("Inspecting snapshot: {}", path);

    let snapshot_path = Path::new(&path);

    let file_size_bytes = std::fs::metadata(snapshot_path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?
        .len();

    let manifest = SnapshotReader::read_manifest(snapshot_path)
        .map_err(|e| format!("Failed to read snapshot: {}", e))?;

    let validation = SnapshotReader::validate(&manifest, None);

    Ok(SnapshotInspectResult {
        manifest,
        file_size_bytes,
        validation,
    })
}
