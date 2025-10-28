use crate::annotations::{AnnotationEntry, AnnotationFile};
use crate::db::annotation_db::Annotation;
use crate::file_readers::FileReaderFactory;
use crate::state_manager::AppStateManager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// Export annotations for a file to a JSON file
#[tauri::command]
pub async fn export_annotations(
    app: tauri::AppHandle,
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<String>, String> {
    log::info!("Exporting annotations for file: {}", file_path);

    // Get file metadata for validation
    let path = std::path::Path::new(&file_path);
    let (sample_rate, duration) = if path.exists() {
        match FileReaderFactory::create_reader(path) {
            Ok(reader) => match reader.metadata() {
                Ok(metadata) => (Some(metadata.sample_rate), Some(metadata.duration)),
                Err(e) => {
                    log::warn!("Failed to read file metadata: {}", e);
                    (None, None)
                }
            },
            Err(e) => {
                log::warn!("Failed to create file reader: {}", e);
                (None, None)
            }
        }
    } else {
        log::warn!("File does not exist, skipping metadata");
        (None, None)
    };

    // Convert database annotations to export format
    let mut annotation_file = AnnotationFile::new(file_path.clone());
    annotation_file.sample_rate = sample_rate;
    annotation_file.duration = duration;

    // Get annotations from file-centric state module
    let file_state_result = state_manager
        .get_file_state_db()
        .get_module_state(&file_path, "annotations")
        .map_err(|e| format!("Failed to get annotations: {}", e))?;

    if let Some(state_value) = file_state_result {
        // Parse the FileAnnotationState from JSON
        #[derive(serde::Deserialize)]
        struct FileAnnotationState {
            #[serde(rename = "timeSeries")]
            time_series: TimeSeriesAnnotations,
            #[serde(rename = "ddaResults", default)]
            dda_results: std::collections::HashMap<String, Vec<PlotAnnotation>>,
        }

        #[derive(serde::Deserialize)]
        struct TimeSeriesAnnotations {
            global: Vec<PlotAnnotation>,
            channels: std::collections::HashMap<String, Vec<PlotAnnotation>>,
        }

        #[derive(serde::Deserialize)]
        struct PlotAnnotation {
            id: String,
            position: f64,
            label: String,
            #[serde(default)]
            description: Option<String>,
            #[serde(default)]
            color: Option<String>,
            #[serde(rename = "createdAt")]
            created_at: String,
            #[serde(rename = "updatedAt", default)]
            updated_at: Option<String>,
        }

        match serde_json::from_value::<FileAnnotationState>(state_value) {
            Ok(file_annotation_state) => {
                // Convert global annotations
                annotation_file.global_annotations = file_annotation_state
                    .time_series
                    .global
                    .into_iter()
                    .map(|ann| AnnotationEntry {
                        id: ann.id,
                        position: ann.position,
                        label: ann.label,
                        description: ann.description,
                        color: ann.color,
                        created_at: ann.created_at,
                        updated_at: ann.updated_at,
                    })
                    .collect();

                // Convert channel annotations
                annotation_file.channel_annotations = file_annotation_state
                    .time_series
                    .channels
                    .into_iter()
                    .map(|(channel, anns)| {
                        (
                            channel,
                            anns.into_iter()
                                .map(|ann| AnnotationEntry {
                                    id: ann.id,
                                    position: ann.position,
                                    label: ann.label,
                                    description: ann.description,
                                    color: ann.color,
                                    created_at: ann.created_at,
                                    updated_at: ann.updated_at,
                                })
                                .collect(),
                        )
                    })
                    .collect();

                log::info!(
                    "Loaded {} global annotations and {} channel annotations from file state",
                    annotation_file.global_annotations.len(),
                    annotation_file.channel_annotations.len()
                );
            }
            Err(e) => {
                log::warn!("Failed to parse annotation state: {}", e);
            }
        }
    } else {
        log::info!("No annotation state found for file: {}", file_path);
    }

    // Show save file dialog
    let save_path = app
        .dialog()
        .file()
        .add_filter("Annotation Files", &["json"])
        .set_file_name("annotations.json")
        .blocking_save_file();

    if let Some(file_path) = save_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        // Save to file
        annotation_file
            .save_to_file(path)
            .map_err(|e| format!("Failed to save annotation file: {}", e))?;

        log::info!(
            "Successfully exported {} annotations to: {}",
            annotation_file.total_count(),
            path_str
        );

        Ok(Some(path_str))
    } else {
        log::info!("Export cancelled by user");
        Ok(None)
    }
}

/// Import annotations from a JSON file
#[tauri::command]
pub async fn import_annotations(
    app: tauri::AppHandle,
    state_manager: State<'_, AppStateManager>,
    target_file_path: String,
) -> Result<usize, String> {
    log::info!("Importing annotations for file: {}", target_file_path);

    // Show open file dialog
    let import_path = app
        .dialog()
        .file()
        .add_filter("Annotation Files", &["json"])
        .blocking_pick_file();

    if let Some(file_path) = import_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();
        log::info!("Loading annotations from: {}", path_str);

        // Load annotation file
        let annotation_file = AnnotationFile::load_from_file(path)
            .map_err(|e| format!("Failed to load annotation file: {}", e))?;

        // Get current file metadata for validation
        let target_path = std::path::Path::new(&target_file_path);
        let (current_sample_rate, current_duration) = if target_path.exists() {
            match FileReaderFactory::create_reader(target_path) {
                Ok(reader) => match reader.metadata() {
                    Ok(metadata) => (Some(metadata.sample_rate), Some(metadata.duration)),
                    Err(e) => {
                        log::warn!("Failed to read target file metadata: {}", e);
                        (None, None)
                    }
                },
                Err(e) => {
                    log::warn!("Failed to create file reader: {}", e);
                    (None, None)
                }
            }
        } else {
            return Err(format!("Target file does not exist: {}", target_file_path));
        };

        // Validate compatibility
        let warnings = annotation_file
            .validate_compatibility(current_sample_rate, current_duration)
            .map_err(|e| format!("Validation failed: {}", e))?;

        if !warnings.is_empty() {
            log::warn!("Compatibility warnings:");
            for warning in &warnings {
                log::warn!("  - {}", warning);
            }
            // For now, we'll import anyway with warnings logged
            // In the future, we could return warnings to the UI
        }

        let annotation_db = state_manager.get_annotation_db();
        let mut imported_count = 0;

        // Import global annotations
        for ann_entry in annotation_file.global_annotations {
            let annotation = Annotation {
                id: ann_entry.id,
                position: ann_entry.position,
                label: ann_entry.label,
                color: ann_entry.color,
                description: ann_entry.description,
                visible_in_plots: vec![],
            };
            annotation_db
                .save_annotation(&target_file_path, None, &annotation)
                .map_err(|e| format!("Failed to save annotation: {}", e))?;
            imported_count += 1;
        }

        // Import channel annotations
        for (channel, anns) in annotation_file.channel_annotations {
            for ann_entry in anns {
                let annotation = Annotation {
                    id: ann_entry.id,
                    position: ann_entry.position,
                    label: ann_entry.label,
                    color: ann_entry.color,
                    description: ann_entry.description,
                    visible_in_plots: vec![],
                };
                annotation_db
                    .save_annotation(&target_file_path, Some(&channel), &annotation)
                    .map_err(|e| format!("Failed to save annotation: {}", e))?;
                imported_count += 1;
            }
        }

        log::info!(
            "Successfully imported {} annotations from: {}",
            imported_count,
            path_str
        );

        Ok(imported_count)
    } else {
        log::info!("Import cancelled by user");
        Ok(0)
    }
}

/// Helper function to convert database Annotation to AnnotationEntry
fn convert_annotation(ann: Annotation) -> AnnotationEntry {
    AnnotationEntry {
        id: ann.id,
        position: ann.position,
        label: ann.label,
        description: ann.description,
        color: ann.color,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
    }
}
