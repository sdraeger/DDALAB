use crate::state_manager::AppStateManager;
use tauri::{App, Manager};

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_webview_window("main")
        .ok_or("Failed to get main window")?;

    // Initialize state manager with Tauri's app_config_dir for consistency
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let state_manager = AppStateManager::new(config_dir)
        .map_err(|e| format!("Failed to initialize state manager: {}", e))?;

    app.manage(state_manager);

    // Set window title
    window.set_title("DDALAB - Delay Differential Analysis Laboratory")?;

    // Show window after initial setup is complete
    window.show()?;
    window.set_focus()?;

    // Save state on window close
    let window_clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let app_handle = window_clone.app_handle();
            let state_manager = app_handle.state::<AppStateManager>();
            if let Err(e) = state_manager.save() {
                log::error!("Failed to save state on close: {}", e);
            }
        }
    });

    Ok(())
}
