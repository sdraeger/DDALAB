#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

#[derive(Debug, Serialize, Deserialize)]
struct ApiConfig {
    url: String,
    timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FileManagerState {
    selected_file: Option<String>,
    current_path: Vec<String>,
    selected_channels: Vec<String>,
    search_query: String,
    sort_by: String,
    sort_order: String,
    show_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlotState {
    visible_channels: Vec<String>,
    time_range: (f64, f64),
    amplitude_range: (f64, f64),
    zoom_level: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DDAState {
    selected_variants: Vec<String>,
    parameters: HashMap<String, serde_json::Value>,
    last_analysis_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppState {
    file_manager: FileManagerState,
    plot: PlotState,
    dda: DDAState,
    ui: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct AppPreferences {
    api_config: ApiConfig,
    window_state: HashMap<String, serde_json::Value>,
    theme: String,
}

impl Default for FileManagerState {
    fn default() -> Self {
        Self {
            selected_file: None,
            current_path: Vec::new(),
            selected_channels: Vec::new(),
            search_query: String::new(),
            sort_by: "name".to_string(),
            sort_order: "asc".to_string(),
            show_hidden: false,
        }
    }
}

impl Default for PlotState {
    fn default() -> Self {
        Self {
            visible_channels: Vec::new(),
            time_range: (0.0, 30.0),
            amplitude_range: (-100.0, 100.0),
            zoom_level: 1.0,
        }
    }
}

impl Default for DDAState {
    fn default() -> Self {
        Self {
            selected_variants: vec!["single_timeseries".to_string()],
            parameters: HashMap::new(),
            last_analysis_id: None,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            file_manager: FileManagerState::default(),
            plot: PlotState::default(),
            dda: DDAState::default(),
            ui: HashMap::new(),
        }
    }
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            api_config: ApiConfig {
                url: "http://localhost:8000".to_string(),
                timeout: 30,
            },
            window_state: HashMap::new(),
            theme: "auto".to_string(),
        }
    }
}

struct AppStateManager {
    state: Arc<RwLock<AppState>>,
    config_path: PathBuf,
    analysis_preview_data: Arc<RwLock<HashMap<String, serde_json::Value>>>,
}

impl AppStateManager {
    fn new() -> Result<Self, String> {
        let config_dir = dirs::config_dir()
            .ok_or("Could not find config directory")?;
        
        let app_config_dir = config_dir.join("ddalab");
        fs::create_dir_all(&app_config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
        
        let config_path = app_config_dir.join("state.json");
        
        let state = if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read state file: {}", e))?;
            
            serde_json::from_str(&content)
                .unwrap_or_default()
        } else {
            AppState::default()
        };
        
        Ok(Self {
            state: Arc::new(RwLock::new(state)),
            config_path,
            analysis_preview_data: Arc::new(RwLock::new(HashMap::new())),
        })
    }
    
    fn save(&self) -> Result<(), String> {
        let state = self.state.read();
        let content = serde_json::to_string_pretty(&*state)
            .map_err(|e| format!("Failed to serialize state: {}", e))?;
        
        fs::write(&self.config_path, content)
            .map_err(|e| format!("Failed to write state file: {}", e))?;
        
        Ok(())
    }
    
    fn get_state(&self) -> AppState {
        self.state.read().clone()
    }
    
    fn update_state<F>(&self, updater: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppState),
    {
        {
            let mut state = self.state.write();
            updater(&mut state);
        }
        self.save()
    }
    
    fn store_analysis_preview_data(&self, window_id: String, analysis_data: serde_json::Value) {
        let mut preview_data = self.analysis_preview_data.write();
        preview_data.insert(window_id, analysis_data);
    }
    
    fn get_analysis_preview_data(&self, window_id: &str) -> Option<serde_json::Value> {
        let preview_data = self.analysis_preview_data.read();
        preview_data.get(window_id).cloned()
    }
}

#[tauri::command]
async fn get_app_state(state_manager: State<'_, AppStateManager>) -> Result<AppState, String> {
    Ok(state_manager.get_state())
}

#[tauri::command]
async fn update_file_manager_state(
    state_manager: State<'_, AppStateManager>,
    file_manager_state: FileManagerState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.file_manager = file_manager_state;
    })
}

#[tauri::command]
async fn update_plot_state(
    state_manager: State<'_, AppStateManager>,
    plot_state: PlotState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.plot = plot_state;
    })
}

#[tauri::command]
async fn update_dda_state(
    state_manager: State<'_, AppStateManager>,
    dda_state: DDAState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.dda = dda_state;
    })
}

#[tauri::command]
async fn update_ui_state(
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
async fn get_app_preferences() -> Result<AppPreferences, String> {
    // Load preferences from config file or return defaults
    Ok(AppPreferences::default())
}

#[tauri::command]
async fn save_app_preferences(preferences: AppPreferences) -> Result<(), String> {
    // Save preferences to config file
    println!("Saving preferences: {:?}", preferences);
    Ok(())
}

#[tauri::command]
async fn check_api_connection(url: String) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    
    match client.get(&format!("{}/api/health", url)).send().await {
        Ok(response) => {
            println!("API check: {} -> {}", url, response.status());
            Ok(response.status().is_success())
        },
        Err(e) => {
            println!("API check failed: {} -> {}", url, e);
            Ok(false)
        },
    }
}

#[tauri::command]
async fn open_file_dialog() -> Result<Option<String>, String> {
    // TODO: Implement with tauri-plugin-dialog v2 API
    // Example: use tauri_plugin_dialog::FileDialogBuilder;
    // let file_path = FileDialogBuilder::new()
    //     .add_filter("EDF Files", &["edf"])
    //     .add_filter("ASCII Files", &["txt", "asc", "csv"])
    //     .add_filter("All Files", &["*"])
    //     .pick_file();
    Ok(None)
}

#[tauri::command]
async fn show_notification(title: String, body: String) -> Result<(), String> {
    // TODO: Implement with tauri-plugin-notification v2 API
    // Example: use tauri_plugin_notification::NotificationExt;
    // app.notification()
    //     .builder()
    //     .title(&title)
    //     .body(&body)
    //     .show()?;
    println!("Notification: {} - {}", title, body);
    Ok(())
}

#[tauri::command]
async fn create_popout_window(
    app: tauri::AppHandle,
    window_type: String,
    window_id: String,
    title: String,
    url: String,
    width: f64,
    height: f64
) -> Result<String, String> {
    use tauri::WebviewWindowBuilder;
    
    let label = format!("popout-{}-{}", window_type, window_id);
    
    match WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(width, height)
        .min_inner_size(400.0, 300.0)
        .center()
        .resizable(true)
        .build() 
    {
        Ok(_window) => {
            println!("Created popout window: {}", label);
            Ok(label)
        },
        Err(e) => {
            eprintln!("Failed to create popout window: {}", e);
            Err(format!("Failed to create window: {}", e))
        }
    }
}

#[tauri::command]
async fn store_analysis_preview_data(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
    analysis_data: serde_json::Value,
) -> Result<(), String> {
    state_manager.store_analysis_preview_data(window_id, analysis_data);
    Ok(())
}

#[tauri::command]
async fn get_analysis_preview_data(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
) -> Result<serde_json::Value, String> {
    match state_manager.get_analysis_preview_data(&window_id) {
        Some(data) => Ok(data),
        None => Err(format!("Analysis preview data not found for window: {}", window_id))
    }
}

// TODO: Implement menu system with Tauri v2 API
// Menu system removed for Tauri v2 - will need to be reimplemented with new API
// Reference: https://tauri.app/v2/reference/rust/tauri/
// Use Menu and MenuItem from tauri v2 API


fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            update_file_manager_state,
            update_plot_state,
            update_dda_state,
            update_ui_state,
            get_app_preferences,
            save_app_preferences,
            check_api_connection,
            open_file_dialog,
            show_notification,
            create_popout_window,
            store_analysis_preview_data,
            get_analysis_preview_data
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            
            // Initialize state manager
            let state_manager = AppStateManager::new()
                .map_err(|e| format!("Failed to initialize state manager: {}", e))?;
            
            app.manage(state_manager);
            
            // Set window title
            window.set_title("DDALAB - Delay Differential Analysis Laboratory").unwrap();
            
            // Save state on window close
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    let app_handle = window_clone.app_handle();
                    let state_manager = app_handle.state::<AppStateManager>();
                    if let Err(e) = state_manager.save() {
                        eprintln!("Failed to save state on close: {}", e);
                    }
                }
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}