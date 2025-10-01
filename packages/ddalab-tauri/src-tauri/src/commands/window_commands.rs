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
    log::info!("Storing analysis preview data for window: {}", window_id);
    if let Some(obj) = analysis_data.as_object() {
        log::info!("Storing preview data keys: {:?}", obj.keys().collect::<Vec<_>>());
        if let Some(channels) = obj.get("channels") {
            if let Some(arr) = channels.as_array() {
                log::info!("Storing {} channels", arr.len());
            }
        }
    }
    state_manager.store_analysis_preview_data(window_id, analysis_data);
    Ok(())
}

#[tauri::command]
pub async fn get_analysis_preview_data(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
) -> Result<serde_json::Value, String> {
    log::info!("Getting analysis preview data for window: {}", window_id);

    match state_manager.get_analysis_preview_data(&window_id) {
        Some(data) => {
            log::info!("Found preview data, type: {}", if data.is_object() { "object" } else { "other" });
            if let Some(obj) = data.as_object() {
                log::info!("Retrieved preview data keys: {:?}", obj.keys().collect::<Vec<_>>());
                if let Some(channels) = obj.get("channels") {
                    if let Some(arr) = channels.as_array() {
                        log::info!("Retrieved {} channels", arr.len());
                    }
                }
            }
            Ok(data)
        },
        None => {
            log::error!("Analysis preview data not found for window: {}", window_id);
            Err(format!("Analysis preview data not found for window: {}", window_id))
        }
    }
}
