use crate::annotations::{AnnotationEntry, AnnotationFile};
use crate::db::annotation_db::Annotation;
use crate::file_readers::FileReaderFactory;
use crate::state_manager::AppStateManager;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// Result of an annotation import operation
#[derive(serde::Serialize)]
pub struct ImportResult {
    pub total_in_file: usize,
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub skipped_near_duplicates: usize,
    pub warnings: Vec<String>,
}

/// Preview annotation with duplicate status
#[derive(serde::Serialize, Clone)]
pub struct AnnotationPreview {
    pub id: String,
    pub position: f64,
    pub position_samples: Option<i64>,
    pub label: String,
    pub description: Option<String>,
    pub color: Option<String>,
    pub channel: Option<String>,
    pub status: String,        // "new", "duplicate", "near_duplicate"
    pub similarity_score: f64, // 0.0 = identical, 1.0 = completely different
    pub closest_existing: Option<ClosestAnnotation>,
    pub source_file: String,     // Which file this annotation came from
    pub source_filename: String, // Just the filename for display
}

#[derive(serde::Serialize, Clone)]
pub struct ClosestAnnotation {
    pub label: String,
    pub position: f64,
    pub time_diff: f64, // difference in seconds
}

/// Preview result before importing
#[derive(serde::Serialize)]
pub struct ImportPreviewResult {
    pub source_file: String,
    pub target_file: String,
    pub annotations: Vec<AnnotationPreview>,
    pub warnings: Vec<String>,
    pub summary: PreviewSummary,
    pub is_multi_file_export: bool,
    pub available_files: Vec<AvailableFile>,
    pub import_file_path: String, // The actual JSON file path to import from
}

#[derive(serde::Serialize)]
pub struct AvailableFile {
    pub path: String,
    pub filename: String,
    pub annotation_count: usize,
}

#[derive(serde::Serialize)]
pub struct PreviewSummary {
    pub total: usize,
    pub new: usize,
    pub duplicates: usize,
    pub near_duplicates: usize,
}

/// Helper function to check if two annotations are duplicates
/// Considers them duplicates if position is within 0.01s and labels match
fn is_duplicate(existing: &PlotAnnotation, new: &AnnotationEntry) -> bool {
    let position_diff = (existing.position - new.position).abs();
    position_diff < 0.01 && existing.label == new.label
}

/// Helper function to check if two annotations are near-duplicates
/// Considers them near-duplicates if position is within 0.5s and labels match
fn is_near_duplicate(existing: &PlotAnnotation, new: &AnnotationEntry) -> bool {
    let position_diff = (existing.position - new.position).abs();
    position_diff < 0.5 && existing.label == new.label
}

#[derive(Clone, serde::Deserialize)]
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

/// Export annotations for a file to a JSON or CSV file
#[tauri::command]
pub async fn export_annotations(
    app: tauri::AppHandle,
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    format: String, // "json" or "csv"
) -> Result<Option<String>, String> {
    log::info!(
        "Exporting annotations for file: {} (format: {})",
        file_path,
        format
    );

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

    // Compute and set file hash for cross-machine compatibility
    if path.exists() {
        match crate::utils::file_hash::compute_file_hash(path) {
            Ok(hash) => {
                annotation_file.file_hash = Some(hash);
                log::info!(
                    "Computed file hash for export: {}...",
                    &annotation_file.file_hash.as_ref().unwrap()[..16]
                );
            }
            Err(e) => {
                log::warn!("Failed to compute file hash for export: {}", e);
            }
        }
    }

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
                    .map(|ann| {
                        let position_samples = sample_rate.map(|sr| (ann.position * sr) as i64);
                        AnnotationEntry {
                            id: ann.id,
                            position: ann.position,
                            position_samples,
                            label: ann.label,
                            description: ann.description,
                            color: ann.color,
                            created_at: ann.created_at,
                            updated_at: ann.updated_at,
                        }
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
                                .map(|ann| {
                                    let position_samples = sample_rate.map(|sr| (ann.position * sr) as i64);
                                    AnnotationEntry {
                                        id: ann.id,
                                        position: ann.position,
                                        position_samples,
                                        label: ann.label,
                                        description: ann.description,
                                        color: ann.color,
                                        created_at: ann.created_at,
                                        updated_at: ann.updated_at,
                                    }
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

    // Show save file dialog based on format
    let (filter_name, filter_ext, default_filename) = match format.as_str() {
        "csv" => ("CSV Files", vec!["csv"], "annotations.csv"),
        _ => ("JSON Files", vec!["json"], "annotations.json"),
    };

    let save_path = app
        .dialog()
        .file()
        .add_filter(filter_name, &filter_ext)
        .set_file_name(default_filename)
        .blocking_save_file();

    if let Some(file_path) = save_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        // Save to file in the requested format
        match format.as_str() {
            "csv" => annotation_file
                .save_to_csv(path)
                .map_err(|e| format!("Failed to save CSV file: {}", e))?,
            _ => annotation_file
                .save_to_file(path)
                .map_err(|e| format!("Failed to save JSON file: {}", e))?,
        }

        log::info!(
            "Successfully exported {} annotations to: {} (format: {})",
            annotation_file.total_count(),
            path_str,
            format
        );

        Ok(Some(path_str))
    } else {
        log::info!("Export cancelled by user");
        Ok(None)
    }
}

/// Preview annotations before importing - shows duplicates and allows selection
#[tauri::command]
pub async fn preview_import_annotations(
    app: tauri::AppHandle,
    state_manager: State<'_, AppStateManager>,
    target_file_path: String,
) -> Result<Option<ImportPreviewResult>, String> {
    log::info!(
        "Previewing annotation import for file: {}",
        target_file_path
    );

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

        // Read the JSON file
        let json_content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;

        // Try to detect if this is an all-files export or single-file export
        #[derive(serde::Deserialize)]
        struct AllAnnotationsExport {
            files: std::collections::HashMap<String, AnnotationFile>,
        }

        // Structure to hold either single file or all files
        enum AnnotationSource {
            Single(AnnotationFile),
            Multi(std::collections::HashMap<String, AnnotationFile>),
        }

        let (annotation_source, is_multi_file, available_files) = if let Ok(single_file) =
            serde_json::from_str::<AnnotationFile>(&json_content)
        {
            log::info!("Loaded single-file annotation format");
            (AnnotationSource::Single(single_file), false, vec![])
        } else if let Ok(all_files) = serde_json::from_str::<AllAnnotationsExport>(&json_content) {
            log::info!(
                "Loaded all-files annotation format with {} files",
                all_files.files.len()
            );

            // Build list of available files
            let available: Vec<AvailableFile> = all_files
                .files
                .iter()
                .map(|(path, ann_file)| {
                    let total_annotations = ann_file.global_annotations.len()
                        + ann_file
                            .channel_annotations
                            .values()
                            .map(|v| v.len())
                            .sum::<usize>();
                    AvailableFile {
                        path: path.clone(),
                        filename: std::path::Path::new(path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(path)
                            .to_string(),
                        annotation_count: total_annotations,
                    }
                })
                .collect();

            log::info!(
                "Multi-file export - will show all annotations from all {} files",
                all_files.files.len()
            );
            (AnnotationSource::Multi(all_files.files), true, available)
        } else {
            return Err(
                "Failed to parse annotation file. File format is not recognized.".to_string(),
            );
        };

        // Helper structures for parsing
        #[derive(serde::Deserialize)]
        struct FileAnnotationState {
            #[serde(rename = "timeSeries")]
            time_series: TimeSeriesAnnotations,
        }

        #[derive(serde::Deserialize)]
        struct TimeSeriesAnnotations {
            global: Vec<PlotAnnotation>,
            channels: std::collections::HashMap<String, Vec<PlotAnnotation>>,
        }

        // Helper function to resolve file path - tries exact match first, then filename match
        let resolve_file_path = |json_path: &str| -> Option<String> {
            let file_state_db = state_manager.get_file_state_db();

            // Try exact match first
            if let Ok(Some(_)) = file_state_db.get_module_state(json_path, "annotations") {
                log::info!("Exact path match found for: {}", json_path);
                return Some(json_path.to_string());
            }

            // Try to find by filename match
            if let Ok(tracked_files) = file_state_db.get_tracked_files() {
                let json_filename = std::path::Path::new(json_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(json_path);

                log::info!(
                    "Looking for filename match: {} (from path: {})",
                    json_filename,
                    json_path
                );

                for tracked_path in tracked_files {
                    let tracked_filename = std::path::Path::new(&tracked_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&tracked_path);

                    if tracked_filename == json_filename {
                        log::info!(
                            "Found filename match: {} -> {}",
                            json_filename,
                            tracked_path
                        );
                        return Some(tracked_path);
                    }
                }
            }

            log::warn!(
                "No path match found for: {} (tried exact and filename matching)",
                json_path
            );
            None
        };

        // Helper function to get existing annotations for a file
        // CRITICAL: Merges annotations from BOTH SQLite database and FileStateManager (just like the frontend)
        let get_existing_annotations = |file_path: &str| -> (
            Vec<PlotAnnotation>,
            std::collections::HashMap<String, Vec<PlotAnnotation>>,
        ) {
            // Resolve the file path to handle path mismatches
            let resolved_path = match resolve_file_path(file_path) {
                Some(path) => path,
                None => {
                    log::warn!("Could not resolve file path: {}", file_path);
                    return (Vec::new(), std::collections::HashMap::new());
                }
            };

            log::info!(
                "Getting existing annotations for resolved path: {}",
                resolved_path
            );

            let mut global_annotations = Vec::new();
            let mut channel_map: std::collections::HashMap<String, Vec<PlotAnnotation>> =
                std::collections::HashMap::new();

            // 1. Load from SQLite database first
            let annotation_db = state_manager.get_annotation_db();
            match annotation_db.get_file_annotations(&resolved_path) {
                Ok(db_annotations) => {
                    let total_db = db_annotations.global_annotations.len()
                        + db_annotations
                            .channel_annotations
                            .values()
                            .map(|v| v.len())
                            .sum::<usize>();
                    log::info!("Loaded {} annotations from SQLite database", total_db);

                    // Convert SQLite annotations to PlotAnnotation format
                    for db_ann in db_annotations.global_annotations {
                        global_annotations.push(PlotAnnotation {
                            id: db_ann.id,
                            position: db_ann.position,
                            label: db_ann.label,
                            description: db_ann.description,
                            color: db_ann.color,
                            created_at: chrono::Utc::now().to_rfc3339(),
                            updated_at: None,
                        });
                    }

                    for (channel, db_anns) in db_annotations.channel_annotations {
                        let channel_anns: Vec<PlotAnnotation> = db_anns
                            .into_iter()
                            .map(|db_ann| PlotAnnotation {
                                id: db_ann.id,
                                position: db_ann.position,
                                label: db_ann.label,
                                description: db_ann.description,
                                color: db_ann.color,
                                created_at: chrono::Utc::now().to_rfc3339(),
                                updated_at: None,
                            })
                            .collect();
                        channel_map.insert(channel, channel_anns);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to load annotations from SQLite database: {}", e);
                }
            }

            // 2. Load from FileStateManager and merge (avoid duplicates)
            let file_state_db = state_manager.get_file_state_db();
            match file_state_db.get_module_state(&resolved_path, "annotations") {
                Ok(Some(state_value)) => {
                    match serde_json::from_value::<FileAnnotationState>(state_value) {
                        Ok(state) => {
                            let total_fs = state.time_series.global.len()
                                + state
                                    .time_series
                                    .channels
                                    .values()
                                    .map(|v| v.len())
                                    .sum::<usize>();
                            log::info!("Loaded {} annotations from FileStateManager", total_fs);

                            // Merge global annotations (avoid duplicates by ID)
                            let existing_ids: std::collections::HashSet<String> =
                                global_annotations.iter().map(|a| a.id.clone()).collect();

                            for fs_ann in state.time_series.global {
                                if !existing_ids.contains(&fs_ann.id) {
                                    global_annotations.push(fs_ann);
                                }
                            }

                            // Merge channel annotations
                            for (channel, fs_anns) in state.time_series.channels {
                                let channel_entry =
                                    channel_map.entry(channel).or_insert_with(Vec::new);
                                let existing_ids: std::collections::HashSet<String> =
                                    channel_entry.iter().map(|a| a.id.clone()).collect();

                                for fs_ann in fs_anns {
                                    if !existing_ids.contains(&fs_ann.id) {
                                        channel_entry.push(fs_ann);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to parse FileStateManager annotations for {}: {}",
                                resolved_path,
                                e
                            );
                        }
                    }
                }
                Ok(None) => {
                    log::info!(
                        "No FileStateManager annotations found for: {}",
                        resolved_path
                    );
                }
                Err(e) => {
                    log::warn!(
                        "Failed to get FileStateManager annotations for {}: {}",
                        resolved_path,
                        e
                    );
                }
            }

            let total =
                global_annotations.len() + channel_map.values().map(|v| v.len()).sum::<usize>();
            log::info!(
                "Total merged annotations: {} (global: {}, channels: {})",
                total,
                global_annotations.len(),
                channel_map.len()
            );

            (global_annotations, channel_map)
        };

        // For single-file exports, get existing annotations from target file
        // For multi-file exports, we'll get annotations per source file
        let (existing_global, existing_channel_map) = match &annotation_source {
            AnnotationSource::Single(_) => get_existing_annotations(&target_file_path),
            AnnotationSource::Multi(_) => (Vec::new(), std::collections::HashMap::new()), // Will be loaded per file
        };

        let mut preview_annotations = Vec::new();
        let mut new_count = 0;
        let mut duplicate_count = 0;
        let mut near_duplicate_count = 0;
        let mut warnings = Vec::new();

        // Process annotations based on source type
        match annotation_source {
            AnnotationSource::Single(annotation_file) => {
                log::info!("Processing single file: {}", annotation_file.file_path);

                // Analyze global annotations
                for ann_entry in &annotation_file.global_annotations {
                    let (status, similarity, closest) =
                        analyze_annotation(ann_entry, &existing_global);

                    match status.as_str() {
                        "duplicate" => duplicate_count += 1,
                        "near_duplicate" => near_duplicate_count += 1,
                        _ => new_count += 1,
                    }

                    preview_annotations.push(AnnotationPreview {
                        id: ann_entry.id.clone(),
                        position: ann_entry.position,
                        position_samples: ann_entry.position_samples,
                        label: ann_entry.label.clone(),
                        description: ann_entry.description.clone(),
                        color: ann_entry.color.clone(),
                        channel: None,
                        status,
                        similarity_score: similarity,
                        closest_existing: closest,
                        source_file: annotation_file.file_path.clone(),
                        source_filename: std::path::Path::new(&annotation_file.file_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(&annotation_file.file_path)
                            .to_string(),
                    });
                }

                // Analyze channel annotations
                for (channel, anns) in &annotation_file.channel_annotations {
                    let existing_channel_anns = existing_channel_map
                        .get(channel)
                        .cloned()
                        .unwrap_or_default();

                    for ann_entry in anns {
                        let (status, similarity, closest) =
                            analyze_annotation(ann_entry, &existing_channel_anns);

                        match status.as_str() {
                            "duplicate" => duplicate_count += 1,
                            "near_duplicate" => near_duplicate_count += 1,
                            _ => new_count += 1,
                        }

                        preview_annotations.push(AnnotationPreview {
                            id: ann_entry.id.clone(),
                            position: ann_entry.position,
                            position_samples: ann_entry.position_samples,
                            label: ann_entry.label.clone(),
                            description: ann_entry.description.clone(),
                            color: ann_entry.color.clone(),
                            channel: Some(channel.clone()),
                            status,
                            similarity_score: similarity,
                            closest_existing: closest,
                            source_file: annotation_file.file_path.clone(),
                            source_filename: std::path::Path::new(&annotation_file.file_path)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or(&annotation_file.file_path)
                                .to_string(),
                        });
                    }
                }
            }
            AnnotationSource::Multi(files) => {
                log::info!("Processing multi-file export with {} files", files.len());

                // Process all files
                for (file_path, annotation_file) in &files {
                    let filename = std::path::Path::new(file_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(file_path)
                        .to_string();

                    log::info!("Processing annotations from: {}", filename);

                    // Get existing annotations for THIS source file (not the target file)
                    let (source_existing_global, source_existing_channel_map) =
                        get_existing_annotations(file_path.as_str());

                    log::info!(
                        "Found {} existing global annotations in {}",
                        source_existing_global.len(),
                        filename
                    );

                    log::info!(
                        "File has {} global annotations to import",
                        annotation_file.global_annotations.len()
                    );

                    // Analyze global annotations
                    for ann_entry in &annotation_file.global_annotations {
                        log::info!(
                            "  Checking annotation: '{}' at {:.2}s (id: {})",
                            ann_entry.label,
                            ann_entry.position,
                            ann_entry.id
                        );
                        let (status, similarity, closest) =
                            analyze_annotation(ann_entry, &source_existing_global);

                        log::info!("    Status: {} (similarity: {:.3})", status, similarity);

                        match status.as_str() {
                            "duplicate" => duplicate_count += 1,
                            "near_duplicate" => near_duplicate_count += 1,
                            _ => new_count += 1,
                        }

                        preview_annotations.push(AnnotationPreview {
                            id: ann_entry.id.clone(),
                            position: ann_entry.position,
                            position_samples: ann_entry.position_samples,
                            label: ann_entry.label.clone(),
                            description: ann_entry.description.clone(),
                            color: ann_entry.color.clone(),
                            channel: None,
                            status,
                            similarity_score: similarity,
                            closest_existing: closest,
                            source_file: file_path.clone(),
                            source_filename: filename.clone(),
                        });
                    }

                    // Analyze channel annotations
                    for (channel, anns) in &annotation_file.channel_annotations {
                        let source_existing_channel_anns = source_existing_channel_map
                            .get(channel)
                            .cloned()
                            .unwrap_or_default();

                        for ann_entry in anns {
                            let (status, similarity, closest) =
                                analyze_annotation(ann_entry, &source_existing_channel_anns);

                            match status.as_str() {
                                "duplicate" => duplicate_count += 1,
                                "near_duplicate" => near_duplicate_count += 1,
                                _ => new_count += 1,
                            }

                            preview_annotations.push(AnnotationPreview {
                                id: ann_entry.id.clone(),
                                position: ann_entry.position,
                                position_samples: ann_entry.position_samples,
                                label: ann_entry.label.clone(),
                                description: ann_entry.description.clone(),
                                color: ann_entry.color.clone(),
                                channel: Some(channel.clone()),
                                status,
                                similarity_score: similarity,
                                closest_existing: closest,
                                source_file: file_path.clone(),
                                source_filename: filename.clone(),
                            });
                        }
                    }
                }
            }
        }

        let total = preview_annotations.len();

        log::info!(
            "Preview complete - Total: {}, New: {}, Duplicates: {}, Near-duplicates: {}",
            total,
            new_count,
            duplicate_count,
            near_duplicate_count
        );

        log::info!(
            "Returning {} preview annotations to frontend",
            preview_annotations.len()
        );

        Ok(Some(ImportPreviewResult {
            source_file: path_str.clone(),
            target_file: target_file_path.clone(),
            annotations: preview_annotations,
            warnings,
            summary: PreviewSummary {
                total,
                new: new_count,
                duplicates: duplicate_count,
                near_duplicates: near_duplicate_count,
            },
            is_multi_file_export: is_multi_file,
            available_files,
            import_file_path: path_str, // The JSON file path we opened
        }))
    } else {
        log::info!("Preview cancelled by user");
        Ok(None)
    }
}

/// Analyze an annotation against existing ones
fn analyze_annotation(
    new: &AnnotationEntry,
    existing: &[PlotAnnotation],
) -> (String, f64, Option<ClosestAnnotation>) {
    if existing.is_empty() {
        return ("new".to_string(), 1.0, None);
    }

    let mut closest_dist = f64::MAX;
    let mut closest_ann: Option<&PlotAnnotation> = None;

    // Find closest existing annotation with same label
    for ex in existing {
        if ex.label == new.label {
            let dist = (ex.position - new.position).abs();
            if dist < closest_dist {
                closest_dist = dist;
                closest_ann = Some(ex);
            }
        }
    }

    if let Some(closest) = closest_ann {
        let status = if closest_dist < 0.01 {
            "duplicate"
        } else if closest_dist < 0.5 {
            "near_duplicate"
        } else {
            "new"
        };

        let similarity = (closest_dist / 1.0).min(1.0); // Normalize to 0-1 (0 = identical)

        (
            status.to_string(),
            similarity,
            Some(ClosestAnnotation {
                label: closest.label.clone(),
                position: closest.position,
                time_diff: closest.position - new.position,
            }),
        )
    } else {
        // No annotation with same label found
        ("new".to_string(), 1.0, None)
    }
}

/// Import annotations from a JSON file
#[tauri::command]
pub async fn import_annotations(
    app: tauri::AppHandle,
    state_manager: State<'_, AppStateManager>,
    target_file_path: String,
) -> Result<ImportResult, String> {
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
        let mut warnings = annotation_file
            .validate_compatibility(current_sample_rate, current_duration)
            .map_err(|e| format!("Validation failed: {}", e))?;

        if !warnings.is_empty() {
            log::warn!("Compatibility warnings:");
            for warning in &warnings {
                log::warn!("  - {}", warning);
            }
        }

        // Get existing annotations from file-centric state
        let file_state_db = state_manager.get_file_state_db();
        let existing_annotations_state = file_state_db
            .get_module_state(&target_file_path, "annotations")
            .map_err(|e| format!("Failed to get existing annotations: {}", e))?;

        // Parse existing annotations
        #[derive(serde::Deserialize)]
        struct FileAnnotationState {
            #[serde(rename = "timeSeries")]
            time_series: TimeSeriesAnnotations,
        }

        #[derive(serde::Deserialize)]
        struct TimeSeriesAnnotations {
            global: Vec<PlotAnnotation>,
            channels: std::collections::HashMap<String, Vec<PlotAnnotation>>,
        }

        let (existing_global, existing_channel_map) =
            if let Some(state_value) = existing_annotations_state {
                match serde_json::from_value::<FileAnnotationState>(state_value) {
                    Ok(state) => (state.time_series.global, state.time_series.channels),
                    Err(e) => {
                        log::warn!("Failed to parse existing annotations: {}", e);
                        (Vec::new(), std::collections::HashMap::new())
                    }
                }
            } else {
                (Vec::new(), std::collections::HashMap::new())
            };

        let annotation_db = state_manager.get_annotation_db();
        let mut imported_count = 0;
        let mut skipped_duplicates = 0;
        let mut skipped_near_duplicates = 0;
        let total_in_file = annotation_file.global_annotations.len()
            + annotation_file
                .channel_annotations
                .values()
                .map(|v| v.len())
                .sum::<usize>();

        // Import global annotations with duplicate detection
        for ann_entry in annotation_file.global_annotations {
            // Check if this is a duplicate
            let is_dup = existing_global
                .iter()
                .any(|ex| is_duplicate(ex, &ann_entry));
            if is_dup {
                log::info!(
                    "Skipping duplicate global annotation: {} at {:.2}s",
                    ann_entry.label,
                    ann_entry.position
                );
                skipped_duplicates += 1;
                continue;
            }

            // Check if this is a near-duplicate
            let is_near_dup = existing_global
                .iter()
                .any(|ex| is_near_duplicate(ex, &ann_entry));
            if is_near_dup {
                log::info!(
                    "Skipping near-duplicate global annotation: {} at {:.2}s",
                    ann_entry.label,
                    ann_entry.position
                );
                skipped_near_duplicates += 1;
                warnings.push(format!(
                    "Skipped near-duplicate: '{}' at {:.2}s (within 0.5s of existing)",
                    ann_entry.label, ann_entry.position
                ));
                continue;
            }

            // Not a duplicate, import it
            let annotation = Annotation {
                id: ann_entry.id.clone(),
                position: ann_entry.position,
                label: ann_entry.label.clone(),
                color: ann_entry.color.clone(),
                description: ann_entry.description.clone(),
                visible_in_plots: vec![],
            };
            annotation_db
                .save_annotation(&target_file_path, None, &annotation)
                .map_err(|e| format!("Failed to save annotation: {}", e))?;
            imported_count += 1;
            log::info!(
                "Imported global annotation: {} at {:.2}s",
                ann_entry.label,
                ann_entry.position
            );
        }

        // Import channel annotations with duplicate detection
        for (channel, anns) in annotation_file.channel_annotations {
            let existing_channel_anns = existing_channel_map
                .get(&channel)
                .cloned()
                .unwrap_or_default();

            for ann_entry in anns {
                // Check if this is a duplicate
                let is_dup = existing_channel_anns
                    .iter()
                    .any(|ex| is_duplicate(ex, &ann_entry));
                if is_dup {
                    log::info!(
                        "Skipping duplicate channel annotation: {} at {:.2}s (channel: {})",
                        ann_entry.label,
                        ann_entry.position,
                        channel
                    );
                    skipped_duplicates += 1;
                    continue;
                }

                // Check if this is a near-duplicate
                let is_near_dup = existing_channel_anns
                    .iter()
                    .any(|ex| is_near_duplicate(ex, &ann_entry));
                if is_near_dup {
                    log::info!(
                        "Skipping near-duplicate channel annotation: {} at {:.2}s (channel: {})",
                        ann_entry.label,
                        ann_entry.position,
                        channel
                    );
                    skipped_near_duplicates += 1;
                    warnings.push(format!(
                        "Skipped near-duplicate in {}: '{}' at {:.2}s (within 0.5s of existing)",
                        channel, ann_entry.label, ann_entry.position
                    ));
                    continue;
                }

                // Not a duplicate, import it
                let annotation = Annotation {
                    id: ann_entry.id.clone(),
                    position: ann_entry.position,
                    label: ann_entry.label.clone(),
                    color: ann_entry.color.clone(),
                    description: ann_entry.description.clone(),
                    visible_in_plots: vec![],
                };
                annotation_db
                    .save_annotation(&target_file_path, Some(&channel), &annotation)
                    .map_err(|e| format!("Failed to save annotation: {}", e))?;
                imported_count += 1;
                log::info!(
                    "Imported channel annotation: {} at {:.2}s (channel: {})",
                    ann_entry.label,
                    ann_entry.position,
                    channel
                );
            }
        }

        log::info!(
            "Import complete - Total: {}, Imported: {}, Skipped duplicates: {}, Skipped near-duplicates: {}",
            total_in_file,
            imported_count,
            skipped_duplicates,
            skipped_near_duplicates
        );

        Ok(ImportResult {
            total_in_file,
            imported: imported_count,
            skipped_duplicates,
            skipped_near_duplicates,
            warnings,
        })
    } else {
        log::info!("Import cancelled by user");
        Ok(ImportResult {
            total_in_file: 0,
            imported: 0,
            skipped_duplicates: 0,
            skipped_near_duplicates: 0,
            warnings: vec![],
        })
    }
}

/// Import selected annotations from a JSON file by their IDs
#[tauri::command]
pub async fn import_selected_annotations(
    state_manager: State<'_, AppStateManager>,
    import_file_path: String,
    target_file_path: String,
    selected_ids: Vec<String>,
) -> Result<usize, String> {
    log::info!(
        "Importing {} selected annotations from {} to {}",
        selected_ids.len(),
        import_file_path,
        target_file_path
    );

    log::info!("Selected IDs: {:?}", selected_ids);

    // Read the JSON file and handle both single-file and multi-file formats
    let json_content = std::fs::read_to_string(&import_file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    #[derive(serde::Deserialize)]
    struct AllAnnotationsExport {
        files: std::collections::HashMap<String, AnnotationFile>,
    }

    // Collect all annotation entries from all files with their source file paths
    let mut all_annotations: Vec<(AnnotationEntry, Option<String>, String)> = Vec::new(); // (annotation, channel, source_file)

    if let Ok(single_file) = serde_json::from_str::<AnnotationFile>(&json_content) {
        log::info!(
            "Loading from single-file format - will import to target file: {}",
            target_file_path
        );
        // Add global annotations - for single-file imports, use target_file_path
        for ann in single_file.global_annotations {
            all_annotations.push((ann, None, target_file_path.clone()));
        }
        // Add channel annotations
        for (channel, anns) in single_file.channel_annotations {
            for ann in anns {
                all_annotations.push((ann, Some(channel.clone()), target_file_path.clone()));
            }
        }
    } else if let Ok(multi_file) = serde_json::from_str::<AllAnnotationsExport>(&json_content) {
        log::info!(
            "Loading from multi-file format with {} files",
            multi_file.files.len()
        );
        // Process all files - IMPORTANT: Track each annotation's source file
        for (file_path, annotation_file) in multi_file.files {
            log::info!("Processing annotations from source file: {}", file_path);
            // Add global annotations - use the original source file path
            for ann in annotation_file.global_annotations {
                all_annotations.push((ann, None, file_path.clone()));
            }
            // Add channel annotations
            for (channel, anns) in annotation_file.channel_annotations {
                for ann in anns {
                    all_annotations.push((ann, Some(channel.clone()), file_path.clone()));
                }
            }
        }
    } else {
        return Err("Failed to parse annotation file".to_string());
    }

    log::info!(
        "Collected {} total annotations from file",
        all_annotations.len()
    );

    let annotation_db = state_manager.get_annotation_db();
    let mut imported_count = 0;

    // Convert selected IDs to a HashSet for fast lookup
    let selected_set: std::collections::HashSet<String> = selected_ids.into_iter().collect();

    log::info!(
        "Starting import of {} selected annotations...",
        selected_set.len()
    );

    // Import selected annotations to their original source files
    for (ann_entry, channel, source_file) in all_annotations {
        log::info!(
            "Processing annotation: '{}' (id: {}) - Selected: {} - Source file: {}",
            ann_entry.label,
            ann_entry.id,
            selected_set.contains(&ann_entry.id),
            source_file
        );

        if selected_set.contains(&ann_entry.id) {
            let annotation = Annotation {
                id: ann_entry.id.clone(),
                position: ann_entry.position,
                label: ann_entry.label.clone(),
                color: ann_entry.color.clone(),
                description: ann_entry.description.clone(),
                visible_in_plots: vec![],
            };
            // KEY FIX: Save to the annotation's original source file, not the target file
            annotation_db
                .save_annotation(&source_file, channel.as_deref(), &annotation)
                .map_err(|e| format!("Failed to save annotation to {}: {}", source_file, e))?;
            imported_count += 1;
            log::info!(
                "Imported annotation: {} at {:.2}s{} to file: {}",
                ann_entry.label,
                ann_entry.position,
                channel
                    .as_ref()
                    .map(|c| format!(" (channel: {})", c))
                    .unwrap_or_default(),
                source_file
            );
        }
    }

    log::info!(
        "Successfully imported {} selected annotations",
        imported_count
    );

    Ok(imported_count)
}

/// Export ALL annotations from all tracked files to a single JSON or CSV file
#[tauri::command]
pub async fn export_all_annotations(
    app: tauri::AppHandle,
    state_manager: State<'_, AppStateManager>,
    format: String, // "json" or "csv"
) -> Result<Option<String>, String> {
    log::info!(
        "Exporting all annotations from all tracked files (format: {})",
        format
    );

    // Create a structure to hold all files' annotations
    #[derive(serde::Serialize)]
    struct AllAnnotationsExport {
        version: String,
        exported_at: String,
        app_version: String,
        files: std::collections::HashMap<String, AnnotationFile>,
    }

    let mut all_files = std::collections::HashMap::new();
    let file_state_db = state_manager.get_file_state_db();

    // Get all tracked files
    let tracked_files = file_state_db
        .get_tracked_files()
        .map_err(|e| format!("Failed to get tracked files: {}", e))?;

    log::info!("Found {} tracked files", tracked_files.len());

    // For each file, get its annotations
    for file_path in tracked_files {
        // Get file metadata for validation
        let path = std::path::Path::new(&file_path);
        let (sample_rate, duration) = if path.exists() {
            match FileReaderFactory::create_reader(path) {
                Ok(reader) => match reader.metadata() {
                    Ok(metadata) => (Some(metadata.sample_rate), Some(metadata.duration)),
                    Err(e) => {
                        log::warn!("Failed to read file metadata for {}: {}", file_path, e);
                        (None, None)
                    }
                },
                Err(e) => {
                    log::warn!("Failed to create file reader for {}: {}", file_path, e);
                    (None, None)
                }
            }
        } else {
            log::warn!("File does not exist, skipping metadata: {}", file_path);
            (None, None)
        };

        // Create annotation file structure
        let mut annotation_file = AnnotationFile::new(file_path.clone());
        annotation_file.sample_rate = sample_rate;
        annotation_file.duration = duration;

        // Compute and set file hash for cross-machine compatibility
        if path.exists() {
            match crate::utils::file_hash::compute_file_hash(path) {
                Ok(hash) => {
                    log::debug!("Computed file hash for {}: {}...", file_path, &hash[..16]);
                    annotation_file.file_hash = Some(hash);
                }
                Err(e) => {
                    log::warn!("Failed to compute file hash for {}: {}", file_path, e);
                }
            }
        }

        // Get annotations from file-centric state module
        let file_state_result = file_state_db
            .get_module_state(&file_path, "annotations")
            .map_err(|e| format!("Failed to get annotations for {}: {}", file_path, e))?;

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
                        .map(|ann| {
                            let position_samples = sample_rate.map(|sr| (ann.position * sr) as i64);
                            AnnotationEntry {
                                id: ann.id,
                                position: ann.position,
                                position_samples,
                                label: ann.label,
                                description: ann.description,
                                color: ann.color,
                                created_at: ann.created_at,
                                updated_at: ann.updated_at,
                            }
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
                                    .map(|ann| {
                                        let position_samples = sample_rate.map(|sr| (ann.position * sr) as i64);
                                        AnnotationEntry {
                                            id: ann.id,
                                            position: ann.position,
                                            position_samples,
                                            label: ann.label,
                                            description: ann.description,
                                            color: ann.color,
                                            created_at: ann.created_at,
                                            updated_at: ann.updated_at,
                                        }
                                    })
                                    .collect(),
                            )
                        })
                        .collect();

                    let total_annotations = annotation_file.total_count();
                    if total_annotations > 0 {
                        log::info!("File {} has {} annotations", file_path, total_annotations);
                        all_files.insert(file_path.clone(), annotation_file);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to parse annotation state for {}: {}", file_path, e);
                }
            }
        }
    }

    if all_files.is_empty() {
        log::info!("No annotations found in any tracked files");
        return Ok(None);
    }

    // Create the export structure
    let export = AllAnnotationsExport {
        version: "1.0".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        files: all_files,
    };

    // Count total annotations across all files
    let total_count: usize = export.files.values().map(|f| f.total_count()).sum();

    log::info!(
        "Exporting {} annotations from {} files",
        total_count,
        export.files.len()
    );

    // Show save file dialog based on format
    let (filter_name, filter_ext, default_filename) = match format.as_str() {
        "csv" => ("CSV Files", vec!["csv"], "all_annotations.csv"),
        _ => ("JSON Files", vec!["json"], "all_annotations.json"),
    };

    let save_path = app
        .dialog()
        .file()
        .add_filter(filter_name, &filter_ext)
        .set_file_name(default_filename)
        .blocking_save_file();

    if let Some(file_path) = save_path {
        let path = file_path
            .as_path()
            .ok_or_else(|| "Invalid file path".to_string())?;
        let path_str = path.to_string_lossy().to_string();

        // Save to file in the requested format
        match format.as_str() {
            "csv" => {
                // For CSV, flatten all annotations from all files into a single CSV
                use crate::annotations::AnnotationEntry;
                use flatten_json_object::Flattener;
                use json_objects_to_csv::Json2Csv;

                #[derive(serde::Serialize)]
                struct FlatAnnotation {
                    file_path: String,
                    file_hash: String,
                    channel: String,
                    position: f64,
                    position_samples: String,
                    label: String,
                    description: String,
                    color: String,
                    id: String,
                    created_at: String,
                    updated_at: String,
                }

                let mut flat_annotations = Vec::new();

                // Flatten annotations from all files
                for (file_path, ann_file) in &export.files {
                    // Add global annotations
                    for ann in &ann_file.global_annotations {
                        let position_samples = if let Some(samples) = ann.position_samples {
                            samples.to_string()
                        } else if let Some(sr) = ann_file.sample_rate {
                            format!("{:.0}", ann.position * sr)
                        } else {
                            "N/A".to_string()
                        };

                        flat_annotations.push(FlatAnnotation {
                            file_path: file_path.clone(),
                            file_hash: ann_file.file_hash.clone().unwrap_or_default(),
                            channel: "global".to_string(),
                            position: ann.position,
                            position_samples,
                            label: ann.label.clone(),
                            description: ann.description.clone().unwrap_or_default(),
                            color: ann.color.clone().unwrap_or_default(),
                            id: ann.id.clone(),
                            created_at: ann.created_at.clone(),
                            updated_at: ann.updated_at.clone().unwrap_or_default(),
                        });
                    }

                    // Add channel-specific annotations
                    for (channel, anns) in &ann_file.channel_annotations {
                        for ann in anns {
                            let position_samples = if let Some(samples) = ann.position_samples {
                                samples.to_string()
                            } else if let Some(sr) = ann_file.sample_rate {
                                format!("{:.0}", ann.position * sr)
                            } else {
                                "N/A".to_string()
                            };

                            flat_annotations.push(FlatAnnotation {
                                file_path: file_path.clone(),
                                file_hash: ann_file.file_hash.clone().unwrap_or_default(),
                                channel: channel.clone(),
                                position: ann.position,
                                position_samples,
                                label: ann.label.clone(),
                                description: ann.description.clone().unwrap_or_default(),
                                color: ann.color.clone().unwrap_or_default(),
                                id: ann.id.clone(),
                                created_at: ann.created_at.clone(),
                                updated_at: ann.updated_at.clone().unwrap_or_default(),
                            });
                        }
                    }
                }

                // Use json-objects-to-csv crate
                let flattener = Flattener::new();
                let mut output = Vec::<u8>::new();
                let csv_writer = csv::WriterBuilder::new()
                    .delimiter(b',')
                    .from_writer(&mut output);

                // Convert Vec to slice of serde_json::Value
                let json_values: Vec<serde_json::Value> = flat_annotations
                    .into_iter()
                    .map(|ann| serde_json::to_value(ann).unwrap())
                    .collect();

                Json2Csv::new(flattener)
                    .convert_from_array(&json_values, csv_writer)
                    .map_err(|e| format!("Failed to convert to CSV: {}", e))?;

                let csv = String::from_utf8(output)
                    .map_err(|e| format!("Failed to convert CSV output to string: {}", e))?;

                std::fs::write(path, csv)
                    .map_err(|e| format!("Failed to write CSV file: {}", e))?;
            }
            _ => {
                // JSON format - save the structured export
                let json = serde_json::to_string_pretty(&export)
                    .map_err(|e| format!("Failed to serialize annotations: {}", e))?;
                std::fs::write(path, json)
                    .map_err(|e| format!("Failed to write JSON file: {}", e))?;
            }
        }

        log::info!(
            "Successfully exported {} annotations from {} files to: {} (format: {})",
            total_count,
            export.files.len(),
            path_str,
            format
        );

        Ok(Some(path_str))
    } else {
        log::info!("Export cancelled by user");
        Ok(None)
    }
}

/// Helper function to convert database Annotation to AnnotationEntry
fn convert_annotation(ann: Annotation) -> AnnotationEntry {
    AnnotationEntry {
        id: ann.id,
        position: ann.position,
        position_samples: None, // Database doesn't store sample rate, so we can't calculate this
        label: ann.label,
        description: ann.description,
        color: ann.color,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: None,
    }
}
