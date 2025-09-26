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
use chrono::{DateTime, Utc};

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
    annotations: Vec<serde_json::Value>,
    color_scheme: String,
    plot_mode: String, // 'raw', 'filtered', etc.
    filters: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnalysisResult {
    id: String,
    file_path: String,
    created_at: String,
    results: serde_json::Value,
    parameters: serde_json::Value,
    plot_data: Option<serde_json::Value>, // Cached plot data for quick restore
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DDAState {
    selected_variants: Vec<String>,
    parameters: HashMap<String, serde_json::Value>,
    last_analysis_id: Option<String>,
    current_analysis: Option<AnalysisResult>,
    analysis_history: Vec<AnalysisResult>,
    analysis_parameters: HashMap<String, serde_json::Value>, // Current analysis parameters
    running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct WindowState {
    position: (i32, i32),
    size: (u32, u32),
    maximized: bool,
    tab: String, // Currently active tab
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppState {
    version: String, // For migration purposes
    file_manager: FileManagerState,
    plot: PlotState,
    dda: DDAState,
    ui: HashMap<String, serde_json::Value>,
    windows: HashMap<String, WindowState>, // For popout windows
    active_tab: String,
    sidebar_collapsed: bool,
    panel_sizes: HashMap<String, f64>, // Panel sizing ratios
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
            annotations: Vec::new(),
            color_scheme: "default".to_string(),
            plot_mode: "raw".to_string(),
            filters: HashMap::new(),
        }
    }
}

impl Default for DDAState {
    fn default() -> Self {
        Self {
            selected_variants: vec!["single_timeseries".to_string()],
            parameters: HashMap::new(),
            last_analysis_id: None,
            current_analysis: None,
            analysis_history: Vec::new(),
            analysis_parameters: HashMap::new(),
            running: false,
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            version: "1.0.0".to_string(),
            file_manager: FileManagerState::default(),
            plot: PlotState::default(),
            dda: DDAState::default(),
            ui: HashMap::new(),
            windows: HashMap::new(),
            active_tab: "files".to_string(),
            sidebar_collapsed: false,
            panel_sizes: {
                let mut sizes = HashMap::new();
                sizes.insert("sidebar".to_string(), 0.25);
                sizes.insert("main".to_string(), 0.75);
                sizes.insert("plot-height".to_string(), 0.6);
                sizes
            },
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
    auto_save_enabled: bool,
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
        
        let manager = Self {
            state: Arc::new(RwLock::new(state)),
            config_path,
            analysis_preview_data: Arc::new(RwLock::new(HashMap::new())),
            auto_save_enabled: true,
        };
        
        // Run migration if needed
        manager.migrate_state()?;
        
        Ok(manager)
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
        if self.auto_save_enabled {
            self.save()
        } else {
            Ok(())
        }
    }
    
    fn set_auto_save(&mut self, enabled: bool) {
        self.auto_save_enabled = enabled;
    }
    
    fn migrate_state(&self) -> Result<(), String> {
        let mut state = self.state.write();
        
        // Check if migration is needed based on version
        if state.version != "1.0.0" {
            println!("Migrating state from version {} to 1.0.0", state.version);
            
            // Add migration logic here for different versions
            match state.version.as_str() {
                "" => {
                    // Migrate from pre-versioned state
                    state.version = "1.0.0".to_string();
                    if state.panel_sizes.is_empty() {
                        state.panel_sizes.insert("sidebar".to_string(), 0.25);
                        state.panel_sizes.insert("main".to_string(), 0.75);
                        state.panel_sizes.insert("plot-height".to_string(), 0.6);
                    }
                }
                _ => {
                    // Unknown version, reset to defaults
                    println!("Unknown state version {}, resetting to defaults", state.version);
                    *state = AppState::default();
                }
            }
        }
        
        Ok(())
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
    println!("DEBUG: get_app_state called");
    let state = state_manager.get_state();
    println!("DEBUG: returning state with version: {}", state.version);
    Ok(state)
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

#[tauri::command]
async fn save_analysis_result(
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
async fn save_plot_data(
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
async fn save_window_state(
    state_manager: State<'_, AppStateManager>,
    window_id: String,
    window_state: WindowState,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        state.windows.insert(window_id, window_state);
    })
}

#[tauri::command]
async fn save_complete_state(
    state_manager: State<'_, AppStateManager>,
    complete_state: serde_json::Value,
) -> Result<(), String> {
    println!("DEBUG: save_complete_state called with state keys: {:?}", 
        complete_state.as_object().map(|o| o.keys().collect::<Vec<_>>()));
    
    let result = state_manager.update_state(|state| {
        // Save the complete frontend state as JSON
        state.ui.insert("frontend_state".to_string(), complete_state.clone());
        state.ui.insert("last_saved".to_string(), serde_json::Value::String(
            chrono::Utc::now().to_rfc3339()
        ));
    });
    
    match &result {
        Ok(_) => println!("DEBUG: save_complete_state succeeded"),
        Err(e) => println!("DEBUG: save_complete_state failed: {}", e),
    }
    
    result
}

#[tauri::command]
async fn get_saved_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<serde_json::Value, String> {
    println!("DEBUG: get_saved_state called");
    let state = state_manager.get_state();
    println!("DEBUG: state has {} UI keys", state.ui.len());
    let json_result = serde_json::to_value(state).map_err(|e| e.to_string())?;
    println!("DEBUG: converted to JSON successfully");
    Ok(json_result)
}

#[tauri::command]
async fn force_save_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<(), String> {
    state_manager.save()
}

#[tauri::command]
async fn clear_state(
    state_manager: State<'_, AppStateManager>,
) -> Result<(), String> {
    state_manager.update_state(|state| {
        *state = AppState::default();
    })
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
            get_analysis_preview_data,
            save_analysis_result,
            save_plot_data,
            save_window_state,
            save_complete_state,
            get_saved_state,
            force_save_state,
            clear_state
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