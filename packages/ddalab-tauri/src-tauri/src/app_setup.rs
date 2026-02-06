use crate::commands::data_directory_commands::DataDirectoryConfig;
use crate::models::WindowState;
use crate::state_manager::AppStateManager;
use ddalab_tauri::api::state::ApiState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{App, Emitter, Manager, PhysicalPosition, PhysicalSize};

/// Debounce delay for window state saves (milliseconds)
const WINDOW_STATE_DEBOUNCE_MS: u64 = 500;

/// Cooldown period after window show before we start saving state (milliseconds)
/// This prevents the Linux window manager feedback loop during startup
const STARTUP_COOLDOWN_MS: u64 = 2000;

/// Global state for window state save debouncing
static WINDOW_STATE_SAVE_PENDING: AtomicBool = AtomicBool::new(false);
static LAST_WINDOW_EVENT_TIME: AtomicU64 = AtomicU64::new(0);
static STARTUP_TIME: AtomicU64 = AtomicU64::new(0);

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("Failed to get main window")?;

    // Initialize state manager with Tauri's app_config_dir for consistency
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to get app config dir: {}", e))?;
    let state_manager = AppStateManager::new(config_dir.clone())
        .map_err(|e| format!("Failed to initialize state manager: {}", e))?;

    // Load persisted data directory and sync to ApiState
    let data_dir_config_file = config_dir.join("data_directory.json");
    if data_dir_config_file.exists() {
        if let Ok(json) = std::fs::read_to_string(&data_dir_config_file) {
            if let Ok(config) = serde_json::from_str::<DataDirectoryConfig>(&json) {
                let path = PathBuf::from(&config.path);
                if path.exists() && path.is_dir() {
                    // Update ApiState with persisted data directory
                    if let Some(api_state) = app.try_state::<Arc<ApiState>>() {
                        api_state.set_data_directory(path.clone());
                        log::info!("📂 Synced persisted data directory to ApiState: {:?}", path);
                    }

                    // Also update the DataDirectoryConfig managed state
                    if let Some(state) =
                        app.try_state::<parking_lot::RwLock<Option<DataDirectoryConfig>>>()
                    {
                        let mut guard = state.write();
                        *guard = Some(config);
                    }
                } else {
                    log::warn!(
                        "Persisted data directory no longer exists: {:?}",
                        config.path
                    );
                }
            }
        }
    }

    // Restore window state if available
    if let Some(saved_window_state) = state_manager.get_window_state("main") {
        log::info!(
            "📐 Restoring window state: position={:?}, size={:?}, maximized={}",
            saved_window_state.position,
            saved_window_state.size,
            saved_window_state.maximized
        );

        // On Linux, skip restoring position/size as it can cause a feedback loop
        // with the window manager. Only restore maximized state.
        #[cfg(target_os = "linux")]
        {
            log::info!(
                "📐 Linux detected: skipping position/size restoration to avoid window manager conflicts"
            );
            // Only restore maximized state on Linux
            if saved_window_state.maximized {
                let _ = window.maximize();
            }
        }

        // On non-Linux platforms, restore full window state
        #[cfg(not(target_os = "linux"))]
        {
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

    // Record startup time for cooldown period
    let startup_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    STARTUP_TIME.store(startup_time, Ordering::SeqCst);

    // Capture window state on resize, move, and close events
    let window_clone = window.clone();
    let app_handle = app.app_handle().clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                // Check if we're still in the startup cooldown period
                let startup = STARTUP_TIME.load(Ordering::SeqCst);
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                if now < startup + STARTUP_COOLDOWN_MS {
                    // Still in cooldown, ignore window events to prevent feedback loop
                    return;
                }

                // Record the time of this event for debouncing
                LAST_WINDOW_EVENT_TIME.store(now, Ordering::SeqCst);

                // If we don't already have a pending save, schedule one
                if !WINDOW_STATE_SAVE_PENDING.swap(true, Ordering::SeqCst) {
                    let window_for_save = window_clone.clone();
                    let app_handle_clone = app_handle.clone();

                    // Spawn a task to save after debounce delay
                    std::thread::spawn(move || {
                        loop {
                            std::thread::sleep(Duration::from_millis(WINDOW_STATE_DEBOUNCE_MS));

                            let last_event = LAST_WINDOW_EVENT_TIME.load(Ordering::SeqCst);
                            let current_time = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            // If enough time has passed since last event, save and exit
                            if current_time >= last_event + WINDOW_STATE_DEBOUNCE_MS {
                                if let Err(e) =
                                    save_main_window_state(&window_for_save, &app_handle_clone)
                                {
                                    log::error!("Failed to save window state: {}", e);
                                }
                                WINDOW_STATE_SAVE_PENDING.store(false, Ordering::SeqCst);
                                break;
                            }
                            // Otherwise, loop and wait more
                        }
                    });
                }
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // Prevent the default close behavior
                api.prevent_close();

                // Save state before potential close (immediate, no debounce)
                if let Err(e) = save_main_window_state(&window_clone, &app_handle) {
                    log::error!("Failed to save window state on close: {}", e);
                }

                let state_manager = app_handle.state::<AppStateManager>();
                if let Err(e) = state_manager.save() {
                    log::error!("Failed to save state on close: {}", e);
                }

                // Emit event to frontend to handle close confirmation
                // Frontend will call force_close_window if user confirms
                log::info!("Window close requested, emitting event to frontend");
                let _ = window_clone.emit("close-requested", ());
            }
            _ => {}
        }
    });

    Ok(())
}

fn save_main_window_state(
    window: &tauri::WebviewWindow,
    app_handle: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
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
        ui_state
            .windows
            .insert("main".to_string(), window_state.clone());
    })?;

    log::info!(
        "💾 Saved window state (debounced): position={:?}, size={:?}, maximized={}",
        window_state.position,
        window_state.size,
        window_state.maximized
    );

    Ok(())
}
