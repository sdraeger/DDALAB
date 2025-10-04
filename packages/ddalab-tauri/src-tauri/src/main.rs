#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Module declarations
mod models;
mod state_manager;
mod commands;
mod docker_stack;
mod app_setup;
mod utils;
mod embedded_api;
mod edf;
mod sync;

// Import required modules
use app_setup::setup_app;
use commands::*;
use commands::embedded_api_commands::EmbeddedApiState;
use sync::AppSyncState;

fn main() {
    // Initialize logging
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // State management commands
            get_app_state,
            update_file_manager_state,
            update_plot_state,
            update_dda_state,
            update_ui_state,
            save_analysis_result,
            save_plot_data,
            save_window_state,
            save_complete_state,
            get_saved_state,
            force_save_state,
            clear_state,
            // API commands
            check_api_connection,
            // Window management commands
            create_popout_window,
            store_analysis_preview_data,
            get_analysis_preview_data,
            // Preference commands
            get_app_preferences,
            save_app_preferences,
            open_file_dialog,
            show_notification,
            // Docker stack management commands
            docker_stack::setup_docker_stack,
            docker_stack::start_docker_stack,
            docker_stack::stop_docker_stack,
            docker_stack::get_docker_stack_status,
            docker_stack::check_docker_requirements,
            docker_stack::update_docker_config,
            // Embedded API commands
            start_embedded_api_server,
            stop_embedded_api_server,
            get_embedded_api_status,
            check_embedded_api_health,
            // Data directory commands
            select_data_directory,
            get_data_directory,
            set_data_directory,
            // Update commands
            check_for_updates,
            // Sync commands
            sync::commands::sync_connect,
            sync::commands::sync_disconnect,
            sync::commands::sync_is_connected,
            sync::commands::sync_share_result,
            sync::commands::sync_access_share,
            sync::commands::sync_revoke_share,
            sync::commands::sync_discover_brokers,
            sync::commands::sync_verify_password
        ])
        .manage(EmbeddedApiState::default())
        .manage(AppSyncState::new())
        .manage(parking_lot::RwLock::new(None::<commands::data_directory_commands::DataDirectoryConfig>))
        .setup(|app| {
            setup_app(app).map_err(|e| e.to_string())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
