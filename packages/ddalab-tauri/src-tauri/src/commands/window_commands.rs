use crate::state_manager::AppStateManager;
use tauri::{State, WebviewWindowBuilder, WebviewUrl};

#[tauri::command]
pub async fn create_popout_window(
    app: tauri::AppHandle,
    window_type: String,
    window_id: String,
    title: String,
    url: String,
    width: f64,
    height: f64
) -> Result<String, String> {
    let label = format!("popout-{}-{}", window_type, window_id);

    match WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(400.0, 300.0)
        .center()
        .resizable(true)
        .build()
    {
        Ok(_window) => {
            log::info!("Created popout window: {}", label);
            Ok(label)
        },
        Err(e) => {
            log::error!("Failed to create popout window: {}", e);
            Err(format!("Failed to create window: {}", e))
        }
    }
}

#[tauri::command]
pub async fn store_analysis_preview_data(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
    analysis_data: serde_json::Value,
) -> Result<(), String> {
    state_manager.store_analysis_preview_data(window_id, analysis_data);
    Ok(())
}

#[tauri::command]
pub async fn get_analysis_preview_data(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
) -> Result<serde_json::Value, String> {
    match state_manager.get_analysis_preview_data(&window_id) {
        Some(data) => Ok(data),
        None => Err(format!("Analysis preview data not found for window: {}", window_id))
    }
}
