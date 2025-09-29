use crate::models::{AppState, AnalysisResult, DDAState, FileManagerState, PlotState, WindowState};
use crate::state_manager::AppStateManager;
use std::collections::HashMap;
use tauri::State;
use chrono::Utc;

#[tauri::command]
pub async fn get_app_state(state_manager: State<'_, AppStateManager>) -> Result<AppState, String> {
    log::debug!("get_app_state called");
    let state = state_manager.get_state();
    log::debug!("returning state with version: {}", state.version);
    Ok(state)
}

#[tauri::command]
pub async fn update_file_manager_state(
    state_manager: State<'_, AppStateManager>,
    file_manager_state: FileManagerState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.file_manager = file_manager_state;
    })
}

#[tauri::command]
pub async fn update_plot_state(
    state_manager: State<'_, AppStateManager>,
    plot_state: PlotState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.plot = plot_state;
    })
}

#[tauri::command]
pub async fn update_dda_state(
    state_manager: State<'_, AppStateManager>,
    dda_state: DDAState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.dda = dda_state;
    })
}

#[tauri::command]
pub async fn update_ui_state(
    state_manager: State<'_, AppStateManager>,
    ui_updates: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        for (key, value) in ui_updates {
            state.ui.insert(key, value);
        }
    })
}

#[tauri::command]
pub async fn save_analysis_result(
    state_manager: State<'_, AppStateManager>,
    analysis: AnalysisResult,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        // Update current analysis
        state.dda.current_analysis = Some(analysis.clone());
        state.dda.last_analysis_id = Some(analysis.id.clone());

        // Add to history (limit to 50 entries)
        state.dda.analysis_history.insert(0, analysis);
        if state.dda.analysis_history.len() > 50 {
            state.dda.analysis_history.truncate(50);
        }
    })
}

#[tauri::command]
pub async fn save_plot_data(
    state_manager: State<'_, AppStateManager>,
    plot_data: serde_json::Value,
    analysis_id: Option<String>,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        // Save plot data to current analysis if available
        if let Some(ref analysis_id) = analysis_id {
            if let Some(ref mut current_analysis) = state.dda.current_analysis {
                if current_analysis.id == *analysis_id {
                    current_analysis.plot_data = Some(plot_data.clone());
                }
            }

            // Also update in history
            for analysis in &mut state.dda.analysis_history {
                if analysis.id == *analysis_id {
                    analysis.plot_data = Some(plot_data.clone());
                    break;
                }
            }
        }

        // Save general plot state
        state.ui.insert("last_plot_data".to_string(), plot_data);
    })
}

#[tauri::command]
pub async fn save_window_state(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
    window_state: WindowState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.windows.insert(window_id, window_state);
    })
}

#[tauri::command]
pub async fn save_complete_state(
    state_manager: State<'_, AppStateManager>,
    complete_state: serde_json::Value,
) -> Result<(), String> {
    log::debug!("save_complete_state called with state keys: {:?}",
        complete_state.as_object().map(|o| o.keys().collect::<Vec<_>>()));

    let result = state_manager.update_state(|state| {
        // Save the complete frontend state as JSON
        state.ui.insert("frontend_state".to_string(), complete_state.clone());
        state.ui.insert("last_saved".to_string(), serde_json::Value::String(
            Utc::now().to_rfc3339()
        ));
    });

    match &result {
        Ok(_) => log::debug!("save_complete_state succeeded"),
        Err(e) => log::debug!("save_complete_state failed: {}", e),
    }

    result
}

#[tauri::command]
pub async fn get_saved_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<serde_json::Value, String> {
    log::debug!("get_saved_state called");
    let state = state_manager.get_state();
    log::debug!("state has {} UI keys", state.ui.len());
    let json_result = serde_json::to_value(state).map_err(|e| e.to_string())?;
    log::debug!("converted to JSON successfully");
    Ok(json_result)
}

#[tauri::command]
pub async fn force_save_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<(), String> {
    state_manager.save()
}

#[tauri::command]
pub async fn clear_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        *state = AppState::default();
    })
}
