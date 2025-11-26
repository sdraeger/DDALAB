#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

// Module declarations
mod annotations;
mod app_setup;
mod commands;
mod db;
mod docker_stack;
mod edf;
mod file_readers;
mod intermediate_format;
mod models;
mod recording;
mod state_manager;
mod streaming;
mod sync;
mod text_reader;
mod utils;

// Import required modules
use app_setup::setup_app;
use commands::api_commands::ApiServerState;
use commands::*;
use recording::commands::WorkflowState;
use sync::AppSyncState;

fn main() {
    // Initialize rustls crypto provider (required for TLS)
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    // Initialize logging to file in user's temp directory
    let log_file = std::env::temp_dir().join("ddalab.log");
    let log_file_str = log_file.to_string_lossy().to_string();

    // Try to initialize file logging, fall back to env_logger if it fails
    if let Err(_) = simple_logging::log_to_file(&log_file_str, log::LevelFilter::Debug) {
        env_logger::init();
        eprintln!("⚠️  Failed to initialize file logging, using stderr instead");
    } else {
        // Also log to stderr for terminal users
        eprintln!("📝 Logging to: {}", log_file_str);
        eprintln!("📝 Use this file to debug DDA failures on Windows");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // UI State management commands
            get_app_state,
            get_ui_state,
            update_file_manager_state,
            update_plot_state,
            update_dda_state,
            update_ui_state,
            save_window_state,
            get_window_state,
            save_ui_state_only,
            save_complete_state,
            get_saved_state,
            force_save_state,
            clear_state,
            // Analysis database commands
            save_analysis_result,
            get_analysis_result,
            get_analyses_by_file,
            get_recent_analyses,
            delete_analysis,
            save_plot_data,
            // Annotation database commands
            save_annotation,
            get_file_annotations,
            get_annotation,
            delete_annotation,
            get_annotations_in_range,
            get_all_annotations,
            // Annotation file export/import commands
            export_annotations,
            export_all_annotations,
            preview_import_annotations,
            import_annotations,
            import_selected_annotations,
            // DDA export commands
            save_dda_export_file,
            save_plot_export_file,
            // Migration commands
            migrate_file_hashes,
            get_hash_migration_status,
            // File view state database commands
            save_file_view_state,
            get_file_view_state,
            delete_file_view_state,
            get_all_file_view_states,
            // File-centric state commands (modular state management)
            save_file_plot_state,
            get_file_plot_state,
            clear_file_plot_state,
            save_file_dda_state,
            get_file_dda_state,
            clear_file_dda_state,
            save_file_annotation_state,
            get_file_annotation_state,
            clear_file_annotation_state,
            get_file_specific_state,
            save_file_state_registry,
            get_file_state_registry,
            get_tracked_files,
            // Window management commands
            force_close_window,
            focus_main_window,
            create_popout_window,
            store_analysis_preview_data,
            get_analysis_preview_data,
            // Preference commands
            get_app_preferences,
            save_app_preferences,
            open_file_dialog,
            open_file_dialog_sync,
            show_notification,
            // Docker stack management commands
            docker_stack::setup_docker_stack,
            docker_stack::start_docker_stack,
            docker_stack::stop_docker_stack,
            docker_stack::get_docker_stack_status,
            docker_stack::check_docker_requirements,
            docker_stack::update_docker_config,
            // API commands (unified local/remote)
            start_local_api_server,
            stop_local_api_server,
            connect_to_remote_api,
            check_api_connection,
            get_api_status,
            save_api_config,
            load_api_config,
            get_api_config,
            // Data directory commands
            select_data_directory,
            get_data_directory,
            set_data_directory,
            // File operation commands
            segment_file,
            compute_file_hash,
            check_annex_placeholder,
            run_git_annex_get,
            // Update commands
            check_for_updates,
            get_app_version,
            check_native_update,
            download_and_install_update,
            // Sync commands
            sync::commands::sync_connect,
            sync::commands::sync_disconnect,
            sync::commands::sync_is_connected,
            sync::commands::sync_share_result,
            sync::commands::sync_access_share,
            sync::commands::sync_revoke_share,
            sync::commands::sync_discover_brokers,
            sync::commands::sync_verify_password,
            // Workflow recording commands
            recording::commands::workflow_new,
            recording::commands::workflow_add_node,
            recording::commands::workflow_add_edge,
            recording::commands::workflow_remove_node,
            recording::commands::workflow_get_node,
            recording::commands::workflow_get_info,
            recording::commands::workflow_get_topological_order,
            recording::commands::workflow_validate,
            recording::commands::workflow_generate_python,
            recording::commands::workflow_generate_julia,
            recording::commands::workflow_clear,
            recording::commands::workflow_get_all_nodes,
            recording::commands::workflow_get_all_edges,
            recording::commands::workflow_record_action,
            recording::commands::workflow_export,
            recording::commands::workflow_import,
            // OpenNeuro API key management commands
            save_openneuro_api_key,
            get_openneuro_api_key,
            check_openneuro_api_key,
            delete_openneuro_api_key,
            // OpenNeuro download commands
            check_git_available,
            check_git_annex_available,
            download_openneuro_dataset,
            cancel_openneuro_download,
            // OpenNeuro upload commands
            upload_bids_dataset,
            cancel_bids_upload,
            // Debug commands
            open_logs_folder,
            get_logs_path,
            read_logs_content,
            // NSG commands
            save_nsg_credentials,
            get_nsg_credentials,
            has_nsg_credentials,
            delete_nsg_credentials,
            test_nsg_connection,
            create_nsg_job,
            submit_nsg_job,
            get_nsg_job_status,
            list_nsg_jobs,
            list_active_nsg_jobs,
            cancel_nsg_job,
            download_nsg_results,
            extract_nsg_tarball,
            delete_nsg_job,
            poll_nsg_jobs,
            get_nsg_job_stats,
            cleanup_pending_nsg_jobs,
            // Notification commands
            create_notification,
            list_notifications,
            get_unread_count,
            mark_notification_read,
            mark_all_notifications_read,
            delete_notification,
            delete_old_notifications,
            // Streaming commands
            start_stream,
            stop_stream,
            pause_stream,
            resume_stream,
            get_stream_data,
            get_stream_results,
            get_stream_state,
            get_stream_stats,
            list_streams,
            clear_stream_buffers,
            // LSL discovery commands
            discover_lsl_streams,
            discover_lsl_streams_by_type
        ])
        .manage(ApiServerState::default())
        .manage(AppSyncState::new())
        .manage(parking_lot::RwLock::new(
            None::<commands::data_directory_commands::DataDirectoryConfig>,
        ))
        .manage(std::sync::Arc::new(parking_lot::RwLock::new(
            WorkflowState::new().expect("Failed to initialize workflow state"),
        )))
        .manage(commands::openneuro_commands::DownloadState::default())
        .manage(commands::openneuro_commands::UploadState::default())
        .manage(std::sync::Arc::new(
            commands::streaming_commands::StreamingState::new(get_dda_binary_path_for_streaming()),
        ))
        .setup(|app| {
            setup_app(app).map_err(|e| e.to_string())?;

            // Start NSG background polling if credentials are configured
            // Use Tauri's async runtime instead of tokio::spawn
            {
                use tauri::Manager;
                let state = app.state::<state_manager::AppStateManager>();
                if let Some(poller) = state.get_nsg_poller() {
                    let poller_clone = poller.clone();

                    // Use Tauri's runtime to spawn the task
                    tauri::async_runtime::spawn(async move {
                        poller_clone.start_polling().await;
                    });

                    log::info!("🚀 Started NSG background job polling");
                }
            }

            // Fix for macOS window focus issue in dev mode
            // Use event listener to ensure window gets focus after creation
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.set_focus();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Clean up API server on app exit
                use tauri::Manager;
                let api_state = app_handle.state::<ApiServerState>();
                log::info!("App exiting, cleaning up API server...");

                // Abort the server task
                let mut handle_guard = api_state.server_handle.write();
                if let Some(handle) = handle_guard.take() {
                    handle.abort();
                    log::info!("✅ API server task aborted");
                }

                // Reset state
                let mut is_running = api_state.is_local_server_running.lock();
                *is_running = false;
            }
        });
}

/// Get the path to the DDA binary for streaming
fn get_dda_binary_path_for_streaming() -> std::path::PathBuf {
    use std::path::PathBuf;

    let binary_name = if cfg!(target_os = "windows") {
        "run_DDA_AsciiEdf.exe"
    } else {
        "run_DDA_AsciiEdf"
    };

    let mut possible_paths = vec![PathBuf::from("./bin").join(binary_name)];

    // When running in a bundled app, resolve paths relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // On macOS: DDALAB.app/Contents/MacOS/DDALAB -> check ../Resources/
            // On Linux/Windows: check relative to exe directory
            possible_paths.push(
                exe_dir
                    .join("..")
                    .join("Resources")
                    .join("bin")
                    .join(binary_name),
            );
            possible_paths.push(exe_dir.join("..").join("Resources").join(binary_name));
            possible_paths.push(exe_dir.join("bin").join(binary_name));
            possible_paths.push(exe_dir.join(binary_name));
        }
    }

    // Add remaining fallback paths
    possible_paths.extend(vec![
        PathBuf::from("../Resources/bin").join(binary_name),
        PathBuf::from("../Resources").join(binary_name),
        PathBuf::from(".").join(binary_name),
        PathBuf::from("./resources/bin").join(binary_name),
        PathBuf::from("./resources").join(binary_name),
        PathBuf::from("/app/bin").join(binary_name),
    ]);

    for path in &possible_paths {
        // Canonicalize to resolve .. and . components, then check existence
        if let Ok(canonical_path) = path.canonicalize() {
            if canonical_path.exists() {
                log::info!("Found DDA binary for streaming at: {:?}", canonical_path);
                return canonical_path;
            }
        }

        // Also check non-canonicalized path
        if path.exists() {
            log::info!("Found DDA binary for streaming at: {:?}", path);
            return path.clone();
        }
    }

    log::warn!(
        "DDA binary not found in any expected location, using default: {}",
        binary_name
    );
    PathBuf::from(binary_name)
}
