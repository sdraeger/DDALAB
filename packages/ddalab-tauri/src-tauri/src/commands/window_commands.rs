use crate::state_manager::AppStateManager;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Global flag to track if drag overlay exists
static DRAG_OVERLAY_EXISTS: AtomicBool = AtomicBool::new(false);

/// Force close the main window, bypassing any close confirmation
/// This is called by the frontend after user confirms the close action
#[tauri::command]
pub async fn force_close_window(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("Force closing main window");
    if let Some(window) = app.get_webview_window("main") {
        // Destroy the window to force close
        window.destroy().map_err(|e| e.to_string())?;
        Ok(())
    } else {
        // If window not found, exit the app anyway
        log::warn!("Main window not found, exiting app");
        app.exit(0);
        Ok(())
    }
}

#[tauri::command]
pub async fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_focus().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            // Additional macOS-specific fixes for focus issues
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        Ok(())
    } else {
        Err("Main window not found".to_string())
    }
}

#[tauri::command]
pub async fn create_popout_window(
    app: tauri::AppHandle,
    window_type: String,
    window_id: String,
    title: String,
    url: String,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let label = format!("popout-{}-{}", window_type, window_id);

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(400.0, 300.0)
        .resizable(true);

    // Use saved position if provided, otherwise center the window
    if let (Some(pos_x), Some(pos_y)) = (x, y) {
        builder = builder.position(pos_x, pos_y);
    } else {
        builder = builder.center();
    }

    match builder.build() {
        Ok(_window) => {
            log::info!("Created popout window: {}", label);
            Ok(label)
        }
        Err(e) => {
            log::error!("Failed to create popout window: {}", e);
            Err(format!("Failed to create window: {}", e))
        }
    }
}

/// Get the current position and size of a window
#[tauri::command]
pub async fn get_window_position(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<(i32, i32, u32, u32), String> {
    if let Some(window) = app.get_webview_window(&window_label) {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        Ok((position.x, position.y, size.width, size.height))
    } else {
        Err(format!("Window not found: {}", window_label))
    }
}

/// Window bounds information for cross-window drag detection
#[derive(serde::Serialize)]
pub struct WindowBounds {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub is_focused: bool,
}

/// Get bounds of all open windows for cross-window drag-and-drop detection
#[tauri::command]
pub async fn get_all_window_bounds(app: tauri::AppHandle) -> Result<Vec<WindowBounds>, String> {
    let mut bounds = Vec::new();

    for (label, window) in app.webview_windows() {
        if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
            bounds.push(WindowBounds {
                label: label.clone(),
                x: position.x as f64,
                y: position.y as f64,
                width: size.width as f64,
                height: size.height as f64,
                is_focused: window.is_focused().unwrap_or(false),
            });
        }
    }

    Ok(bounds)
}

#[tauri::command]
pub async fn store_analysis_preview_data(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
    analysis_data: serde_json::Value,
) -> Result<(), String> {
    log::info!("Storing analysis preview data for window: {}", window_id);
    if let Some(obj) = analysis_data.as_object() {
        log::info!(
            "Storing preview data keys: {:?}",
            obj.keys().collect::<Vec<_>>()
        );
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
            log::info!(
                "Found preview data, type: {}",
                if data.is_object() { "object" } else { "other" }
            );
            if let Some(obj) = data.as_object() {
                log::info!(
                    "Retrieved preview data keys: {:?}",
                    obj.keys().collect::<Vec<_>>()
                );
                if let Some(channels) = obj.get("channels") {
                    if let Some(arr) = channels.as_array() {
                        log::info!("Retrieved {} channels", arr.len());
                    }
                }
            }
            Ok(data)
        }
        None => {
            log::error!("Analysis preview data not found for window: {}", window_id);
            Err(format!(
                "Analysis preview data not found for window: {}",
                window_id
            ))
        }
    }
}

/// Create a drag overlay window that follows the cursor
/// This provides visual feedback when dragging tabs outside window bounds
#[tauri::command]
pub async fn show_drag_overlay(
    app: tauri::AppHandle,
    file_name: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    // Check if overlay already exists
    if DRAG_OVERLAY_EXISTS.load(Ordering::SeqCst) {
        // Just update position if it exists
        if let Some(window) = app.get_webview_window("drag-overlay") {
            window
                .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: (x as i32) - 24,
                    y: (y as i32) - 30,
                }))
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    // Simple URL encode for the file name (replace spaces and special chars)
    let encoded_name = file_name
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('&', "%26")
        .replace('=', "%3D")
        .replace('#', "%23")
        .replace('?', "%3F");
    let url = format!("/drag-overlay?fileName={}", encoded_name);

    let builder = WebviewWindowBuilder::new(&app, "drag-overlay", WebviewUrl::App(url.into()))
        .title("")
        .inner_size(300.0, 60.0)
        .position((x as f64) - 24.0, (y as f64) - 30.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .closable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(true);

    match builder.build() {
        Ok(_window) => {
            DRAG_OVERLAY_EXISTS.store(true, Ordering::SeqCst);
            log::debug!("Created drag overlay window");
            Ok(())
        }
        Err(e) => {
            log::error!("Failed to create drag overlay: {}", e);
            Err(format!("Failed to create drag overlay: {}", e))
        }
    }
}

/// Update the position of the drag overlay window
#[tauri::command]
pub async fn update_drag_overlay(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("drag-overlay") {
        window
            .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: (x as i32) - 24,
                y: (y as i32) - 30,
            }))
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        // Overlay doesn't exist, silently ignore
        Ok(())
    }
}

/// Hide and destroy the drag overlay window
#[tauri::command]
pub async fn hide_drag_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("drag-overlay") {
        window.destroy().map_err(|e| e.to_string())?;
        DRAG_OVERLAY_EXISTS.store(false, Ordering::SeqCst);
        log::debug!("Destroyed drag overlay window");
    }
    Ok(())
}
