use crate::state_manager::AppStateManager;
use crate::models::WindowState;
use tauri::{App, Manager, PhysicalPosition, PhysicalSize};

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_webview_window("main")
        .ok_or("Failed to get main window")?;

    // Initialize state manager with Tauri's app_config_dir for consistency
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let state_manager = AppStateManager::new(config_dir)
        .map_err(|e| format!("Failed to initialize state manager: {}", e))?;

    // Restore window state if available
    let ui_state = state_manager.get_ui_state();
    if let Some(saved_window_state) = ui_state.windows.get("main") {
        log::info!("📐 Restoring window state: position={:?}, size={:?}, maximized={}",
            saved_window_state.position, saved_window_state.size, saved_window_state.maximized);

        // Restore position and size
        let _ = window.set_position(PhysicalPosition::new(
            saved_window_state.position.0,
            saved_window_state.position.1,
        ));
        let _ = window.set_size(PhysicalSize::new(
            saved_window_state.size.0,
            saved_window_state.size.1,
        ));

        // Restore maximized state
        if saved_window_state.maximized {
            let _ = window.maximize();
        }
    } else {
        log::info!("📐 No saved window state found, using default configuration");
    }

    app.manage(state_manager);

    // Set window title
    window.set_title("DDALAB - Delay Differential Analysis Laboratory")?;

    // Show window after initial setup is complete
    window.show()?;
    window.set_focus()?;

    // Capture window state on resize, move, and close events
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                // Capture and save current window state
                if let Err(e) = save_main_window_state(&window_clone) {
                    log::error!("Failed to save window state: {}", e);
                }
            }
            tauri::WindowEvent::CloseRequested { .. } => {
                // Save final state before closing
                if let Err(e) = save_main_window_state(&window_clone) {
                    log::error!("Failed to save window state on close: {}", e);
                }

                let app_handle = window_clone.app_handle();
                let state_manager = app_handle.state::<AppStateManager>();
                if let Err(e) = state_manager.save() {
                    log::error!("Failed to save state on close: {}", e);
                }
            }
            _ => {}
        }
    });

    Ok(())
}

fn save_main_window_state(window: &tauri::WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = window.app_handle();
    let state_manager = app_handle.state::<AppStateManager>();

    // Get current window geometry
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let is_maximized = window.is_maximized()?;

    let window_state = WindowState {
        position: (position.x, position.y),
        size: (size.width, size.height),
        maximized: is_maximized,
        tab: String::new(), // Main window doesn't use tabs in the same way
    };

    // Save to state manager
    state_manager.update_ui_state(|ui_state| {
        ui_state.windows.insert("main".to_string(), window_state.clone());
    })?;

    log::debug!("💾 Saved window state: position={:?}, size={:?}, maximized={}",
        window_state.position, window_state.size, window_state.maximized);

    Ok(())
}
