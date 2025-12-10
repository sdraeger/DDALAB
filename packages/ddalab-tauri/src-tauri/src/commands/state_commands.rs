use crate::db::{Annotation, FileAnnotations, FileSpecificState, FileStateRegistry, FileViewState};
use crate::models::{
    AnalysisResult, AppState, DDAState, FileManagerState, PlotState, UIState, WindowState,
};
use crate::state_manager::AppStateManager;
use std::collections::HashMap;
use tauri::State;

// ============================================================================
// UI State Commands (lightweight JSON-based)
// ============================================================================

#[tauri::command]
pub async fn get_app_state(state_manager: State<'_, AppStateManager>) -> Result<AppState, String> {
    log::debug!("get_app_state called");
    let state = state_manager.get_state();
    log::debug!("returning state with version: {}", state.version);
    Ok(state)
}

#[tauri::command]
pub async fn get_ui_state(state_manager: State<'_, AppStateManager>) -> Result<UIState, String> {
    log::debug!("get_ui_state called");
    Ok(state_manager.get_ui_state())
}

#[tauri::command]
pub async fn update_file_manager_state(
    state_manager: State<'_, AppStateManager>,
    file_manager_state: FileManagerState,
) -> Result<(), String> {
    log::debug!(
        "update_file_manager_state called with selected_file: {:?}",
        file_manager_state.selected_file
    );
    state_manager.update_ui_state(|ui_state| {
        ui_state.last_selected_file = file_manager_state.selected_file.clone();
        ui_state.file_manager = file_manager_state;
    })
}

#[tauri::command]
pub async fn update_plot_state(
    state_manager: State<'_, AppStateManager>,
    plot_state: serde_json::Value,
) -> Result<(), String> {
    // Persist preprocessing and filters immediately for reliable state restoration
    state_manager.update_ui_state(|ui_state| {
        // Save preprocessing (notch, highpass, lowpass filters)
        if let Some(preprocessing) = plot_state.get("preprocessing") {
            ui_state
                .ui_extras
                .insert("plot_preprocessing".to_string(), preprocessing.clone());
        }
        // Save plot filters (chunkSize, amplitude, chartHeight, etc.)
        if let Some(filters) = plot_state.get("filters") {
            ui_state
                .ui_extras
                .insert("plot_filters".to_string(), filters.clone());
        }
    })
}

#[tauri::command]
pub async fn update_dda_state(
    _state_manager: State<'_, AppStateManager>,
    _dda_state: serde_json::Value,
) -> Result<(), String> {
    // DDA state is now managed via database - no need to persist here
    // Accept as JSON value to avoid type mismatch between frontend and backend structures
    Ok(())
}

#[tauri::command]
pub async fn update_ui_state(
    state_manager: State<'_, AppStateManager>,
    ui_updates: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    state_manager.update_ui_state(|ui_state| {
        for (key, value) in ui_updates {
            ui_state.ui_extras.insert(key, value);
        }
    })
}

#[tauri::command]
pub async fn save_window_state(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
    window_state: WindowState,
) -> Result<(), String> {
    log::debug!(
        "save_window_state called for: {}, size: {:?}, position: {:?}, maximized: {}",
        window_id,
        window_state.size,
        window_state.position,
        window_state.maximized
    );
    state_manager.update_ui_state(|ui_state| {
        ui_state.windows.insert(window_id, window_state);
    })
}

#[tauri::command]
pub async fn get_window_state(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
) -> Result<Option<WindowState>, String> {
    let ui_state = state_manager.get_ui_state();
    Ok(ui_state.windows.get(&window_id).cloned())
}

#[tauri::command]
pub async fn save_ui_state_only(
    state_manager: State<'_, AppStateManager>,
    ui_updates: serde_json::Value,
) -> Result<(), String> {
    // Debug: Log incoming values
    if let Some(obj) = ui_updates.as_object() {
        if let Some(plot) = obj.get("plot") {
            if let Some(filters) = plot.get("filters") {
                if let Some(ch) = filters.get("chartHeight") {
                    log::info!("[save_ui_state_only] Incoming chartHeight: {}", ch);
                }
            }
        }
        if let Some(ui) = obj.get("ui") {
            if let Some(sw) = ui.get("sidebarWidth") {
                log::info!("[save_ui_state_only] Incoming sidebarWidth: {}", sw);
            }
        }
    }

    state_manager.update_ui_state(|ui_state| {
        if let Some(obj) = ui_updates.as_object() {
            if let Some(active_tab) = obj.get("active_tab").and_then(|v| v.as_str()) {
                ui_state.active_tab = active_tab.to_string();
            }
            if let Some(sidebar) = obj.get("sidebar_collapsed").and_then(|v| v.as_bool()) {
                ui_state.sidebar_collapsed = sidebar;
            }
            if let Some(panel_sizes) = obj.get("panel_sizes") {
                if let Ok(sizes) = serde_json::from_value(panel_sizes.clone()) {
                    ui_state.panel_sizes = sizes;
                }
            }
            if let Some(file_manager) = obj.get("file_manager") {
                if let Ok(fm) = serde_json::from_value::<FileManagerState>(file_manager.clone()) {
                    // Update last_selected_file from the FileManagerState
                    ui_state.last_selected_file = fm.selected_file.clone();
                    ui_state.file_manager = fm;
                }
            }
            // Save plot filters (including chartHeight) in ui_extras
            if let Some(plot) = obj.get("plot") {
                if let Some(filters) = plot.get("filters") {
                    ui_state
                        .ui_extras
                        .insert("plot_filters".to_string(), filters.clone());
                }
                if let Some(preprocessing) = plot.get("preprocessing") {
                    ui_state
                        .ui_extras
                        .insert("plot_preprocessing".to_string(), preprocessing.clone());
                }
            }
            // Save UI extras including popout windows
            if let Some(ui) = obj.get("ui") {
                if let Some(ui_obj) = ui.as_object() {
                    // Save popout windows
                    if let Some(popout_windows) = ui_obj.get("popoutWindows") {
                        ui_state
                            .ui_extras
                            .insert("popoutWindows".to_string(), popout_windows.clone());
                    }
                    // Save other UI extras
                    for (key, value) in ui_obj {
                        if key != "popoutWindows" {
                            ui_state.ui_extras.insert(key.clone(), value.clone());
                        }
                    }
                }
            }
        }
    })?;

    Ok(())
}

#[tauri::command]
pub async fn save_complete_state(
    state_manager: State<'_, AppStateManager>,
    complete_state: serde_json::Value,
) -> Result<(), String> {
    log::debug!("save_complete_state called (deprecated - forwarding to save_ui_state_only)");

    // Forward to new lightweight save
    save_ui_state_only(state_manager, complete_state).await
}

#[tauri::command]
pub async fn get_saved_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<serde_json::Value, String> {
    // Build a complete AppState for frontend compatibility
    let ui_state = state_manager.get_ui_state();

    // Debug: Log loaded values
    if let Some(plot_filters) = ui_state.ui_extras.get("plot_filters") {
        if let Some(ch) = plot_filters.get("chartHeight") {
            log::info!("[get_saved_state] Loaded chartHeight: {}", ch);
        }
    }
    if let Some(sw) = ui_state.ui_extras.get("sidebarWidth") {
        log::info!("[get_saved_state] Loaded sidebarWidth: {}", sw);
    }
    if let Some(pw) = ui_state.ui_extras.get("popoutWindows") {
        log::info!(
            "[get_saved_state] Loaded popoutWindows count: {}",
            pw.as_array().map(|a| a.len()).unwrap_or(0)
        );
    }

    // Get saved plot filters from ui_extras, or use empty object as default
    let plot_filters = ui_state
        .ui_extras
        .get("plot_filters")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let plot_preprocessing = ui_state.ui_extras.get("plot_preprocessing").cloned();

    // Create a JSON object with all expected fields (using snake_case for TypeScript compatibility)
    let state_json = serde_json::json!({
        "version": ui_state.version,
        "active_tab": ui_state.active_tab,
        "sidebar_collapsed": ui_state.sidebar_collapsed,
        "panel_sizes": ui_state.panel_sizes,
        "file_manager": {
            "selected_file": ui_state.last_selected_file,
            "current_path": ui_state.file_manager.current_path,
            "selected_channels": ui_state.file_manager.selected_channels,
            "search_query": ui_state.file_manager.search_query,
            "sort_by": ui_state.file_manager.sort_by,
            "sort_order": ui_state.file_manager.sort_order,
            "show_hidden": ui_state.file_manager.show_hidden,
        },
        "plot": {
            "visible_channels": [],
            "time_range": [0.0, 30.0],
            "amplitude_range": [-100.0, 100.0],
            "zoom_level": 1.0,
            "annotations": [],
            "color_scheme": "default",
            "plot_mode": "raw",
            "filters": plot_filters,
            "preprocessing": plot_preprocessing,
        },
        "dda": {
            "selected_variants": ["single_timeseries"],
            "parameters": {},
            "last_analysis_id": null,
            "current_analysis": null,
            "analysis_history": [],
            "analysis_parameters": {},
            "running": false,
        },
        "ui": ui_state.ui_extras,
        "windows": ui_state.windows,
    });

    log::debug!("converted UI state to AppState JSON successfully");
    Ok(state_json)
}

#[tauri::command]
pub async fn force_save_state(state_manager: State<'_, AppStateManager>) -> Result<(), String> {
    state_manager.save()
}

#[tauri::command]
pub async fn clear_state(state_manager: State<'_, AppStateManager>) -> Result<(), String> {
    state_manager.update_ui_state(|ui_state| {
        *ui_state = UIState::default();
    })
}

// ============================================================================
// Analysis Database Commands (SQLite-based)
// ============================================================================

#[tauri::command]
pub async fn save_analysis_result(
    state_manager: State<'_, AppStateManager>,
    analysis: AnalysisResult,
) -> Result<(), String> {
    log::debug!("save_analysis_result called for: {}", analysis.id);
    state_manager
        .get_analysis_db()
        .save_analysis(&analysis)
        .map_err(|e| e.to_string())?;
    log::debug!("Analysis saved successfully: {}", analysis.id);
    Ok(())
}

#[tauri::command]
pub async fn get_analysis_result(
    state_manager: State<'_, AppStateManager>,
    analysis_id: String,
) -> Result<Option<AnalysisResult>, String> {
    state_manager
        .get_analysis_db()
        .get_analysis(&analysis_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_analyses_by_file(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    limit: Option<usize>,
) -> Result<Vec<AnalysisResult>, String> {
    let limit = limit.unwrap_or(50);
    state_manager
        .get_analysis_db()
        .get_analyses_by_file(&file_path, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recent_analyses(
    state_manager: State<'_, AppStateManager>,
    limit: Option<usize>,
) -> Result<Vec<AnalysisResult>, String> {
    let limit = limit.unwrap_or(50);
    state_manager
        .get_analysis_db()
        .get_recent_analyses(limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_analysis(
    state_manager: State<'_, AppStateManager>,
    analysis_id: String,
) -> Result<(), String> {
    state_manager
        .get_analysis_db()
        .delete_analysis(&analysis_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_plot_data(
    state_manager: State<'_, AppStateManager>,
    plot_data: serde_json::Value,
    analysis_id: Option<String>,
) -> Result<(), String> {
    if let Some(id) = analysis_id {
        // Load the analysis, update plot_data, and save it back
        if let Some(mut analysis) = state_manager
            .get_analysis_db()
            .get_analysis(&id)
            .map_err(|e| e.to_string())?
        {
            analysis.plot_data = Some(plot_data);
            state_manager
                .get_analysis_db()
                .save_analysis(&analysis)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ============================================================================
// Annotation Database Commands (SQLite-based)
// ============================================================================

#[tauri::command]
pub async fn save_annotation(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    channel: Option<String>,
    annotation: Annotation,
) -> Result<(), String> {
    log::debug!(
        "save_annotation called for file: {}, position: {}",
        file_path,
        annotation.position
    );
    state_manager
        .get_annotation_db()
        .save_annotation(&file_path, channel.as_deref(), &annotation)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_annotations(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<FileAnnotations, String> {
    state_manager
        .get_annotation_db()
        .get_file_annotations(&file_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_annotation(
    state_manager: State<'_, AppStateManager>,
    annotation_id: String,
) -> Result<Option<Annotation>, String> {
    state_manager
        .get_annotation_db()
        .get_annotation(&annotation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_annotation(
    state_manager: State<'_, AppStateManager>,
    annotation_id: String,
) -> Result<(), String> {
    log::debug!("delete_annotation called for: {}", annotation_id);
    state_manager
        .get_annotation_db()
        .delete_annotation(&annotation_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_annotations_in_range(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    start: f64,
    end: f64,
) -> Result<Vec<Annotation>, String> {
    state_manager
        .get_annotation_db()
        .get_annotations_in_range(&file_path, start, end)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_annotations(
    state_manager: State<'_, AppStateManager>,
) -> Result<std::collections::HashMap<String, FileAnnotations>, String> {
    // Use bulk query to load all annotations in a single database call
    // This avoids the N+1 query problem (1 query instead of 1 + N)
    state_manager
        .get_annotation_db()
        .get_all_annotations_bulk()
        .map_err(|e| e.to_string())
}

// ============================================================================
// File View State Database Commands (SQLite-based)
// ============================================================================

#[tauri::command]
pub async fn save_file_view_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    chunk_start: f64,
    chunk_size: i64,
    selected_channels: Vec<String>,
) -> Result<(), String> {
    log::debug!(
        "save_file_view_state called for file: {}, chunk_start: {}, chunk_size: {}",
        file_path,
        chunk_start,
        chunk_size
    );

    let view_state = FileViewState {
        file_path,
        chunk_start,
        chunk_size,
        selected_channels,
        updated_at: chrono::Utc::now().to_rfc3339(),
    };

    state_manager
        .get_file_state_db()
        .save_file_state(&view_state)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_view_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<FileViewState>, String> {
    state_manager
        .get_file_state_db()
        .get_file_state(&file_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file_view_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<(), String> {
    state_manager
        .get_file_state_db()
        .delete_file_state(&file_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_all_file_view_states(
    state_manager: State<'_, AppStateManager>,
) -> Result<Vec<FileViewState>, String> {
    state_manager
        .get_file_state_db()
        .get_all_file_states()
        .map_err(|e| e.to_string())
}

// ============================================================================
// File-Centric State Commands (Modular State Management)
// ============================================================================

/// Save state for a specific module and file
#[tauri::command]
pub async fn save_file_plot_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    state: serde_json::Value,
) -> Result<(), String> {
    log::debug!("save_file_plot_state called for file: {}", file_path);

    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "plot", &state)
        .map_err(|e| e.to_string())?;

    // Update metadata to track file access
    state_manager
        .get_file_state_db()
        .update_file_metadata(&file_path)
        .map_err(|e| e.to_string())
}

/// Get plot state for a specific file
#[tauri::command]
pub async fn get_file_plot_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    state_manager
        .get_file_state_db()
        .get_module_state(&file_path, "plot")
        .map_err(|e| e.to_string())
}

/// Clear plot state for a specific file
#[tauri::command]
pub async fn clear_file_plot_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<(), String> {
    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "plot", &serde_json::Value::Null)
        .map_err(|e| e.to_string())
}

/// Save DDA state for a specific file
#[tauri::command]
pub async fn save_file_dda_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    state: serde_json::Value,
) -> Result<(), String> {
    log::debug!("save_file_dda_state called for file: {}", file_path);

    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "dda", &state)
        .map_err(|e| e.to_string())?;

    state_manager
        .get_file_state_db()
        .update_file_metadata(&file_path)
        .map_err(|e| e.to_string())
}

/// Get DDA state for a specific file
#[tauri::command]
pub async fn get_file_dda_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    state_manager
        .get_file_state_db()
        .get_module_state(&file_path, "dda")
        .map_err(|e| e.to_string())
}

/// Clear DDA state for a specific file
#[tauri::command]
pub async fn clear_file_dda_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<(), String> {
    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "dda", &serde_json::Value::Null)
        .map_err(|e| e.to_string())
}

/// Save annotation state for a specific file
#[tauri::command]
pub async fn save_file_annotation_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    state: serde_json::Value,
) -> Result<(), String> {
    log::debug!("save_file_annotation_state called for file: {}", file_path);

    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "annotations", &state)
        .map_err(|e| e.to_string())?;

    state_manager
        .get_file_state_db()
        .update_file_metadata(&file_path)
        .map_err(|e| e.to_string())
}

/// Get annotation state for a specific file
#[tauri::command]
pub async fn get_file_annotation_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    state_manager
        .get_file_state_db()
        .get_module_state(&file_path, "annotations")
        .map_err(|e| e.to_string())
}

/// Clear annotation state for a specific file
#[tauri::command]
pub async fn clear_file_annotation_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<(), String> {
    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "annotations", &serde_json::Value::Null)
        .map_err(|e| e.to_string())
}

/// Save navigation state for a specific file
#[tauri::command]
pub async fn save_file_navigation_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
    state: serde_json::Value,
) -> Result<(), String> {
    log::debug!("save_file_navigation_state called for file: {}", file_path);

    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "navigation", &state)
        .map_err(|e| e.to_string())?;

    state_manager
        .get_file_state_db()
        .update_file_metadata(&file_path)
        .map_err(|e| e.to_string())
}

/// Get navigation state for a specific file
#[tauri::command]
pub async fn get_file_navigation_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<serde_json::Value>, String> {
    state_manager
        .get_file_state_db()
        .get_module_state(&file_path, "navigation")
        .map_err(|e| e.to_string())
}

/// Clear navigation state for a specific file
#[tauri::command]
pub async fn clear_file_navigation_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<(), String> {
    state_manager
        .get_file_state_db()
        .save_module_state(&file_path, "navigation", &serde_json::Value::Null)
        .map_err(|e| e.to_string())
}

/// Get complete file-specific state (all modules + metadata)
#[tauri::command]
pub async fn get_file_specific_state(
    state_manager: State<'_, AppStateManager>,
    file_path: String,
) -> Result<Option<FileSpecificState>, String> {
    log::debug!("get_file_specific_state called for file: {}", file_path);

    state_manager
        .get_file_state_db()
        .get_file_specific_state(&file_path)
        .map_err(|e| e.to_string())
}

/// Save the file state registry
#[tauri::command]
pub async fn save_file_state_registry(
    state_manager: State<'_, AppStateManager>,
    registry: FileStateRegistry,
) -> Result<(), String> {
    log::debug!("save_file_state_registry called");

    state_manager
        .get_file_state_db()
        .save_registry(&registry)
        .map_err(|e| e.to_string())
}

/// Get the file state registry
#[tauri::command]
pub async fn get_file_state_registry(
    state_manager: State<'_, AppStateManager>,
) -> Result<FileStateRegistry, String> {
    state_manager
        .get_file_state_db()
        .get_registry()
        .map_err(|e| e.to_string())
}

/// Get all tracked file paths
#[tauri::command]
pub async fn get_tracked_files(
    state_manager: State<'_, AppStateManager>,
) -> Result<Vec<String>, String> {
    state_manager
        .get_file_state_db()
        .get_tracked_files()
        .map_err(|e| e.to_string())
}
