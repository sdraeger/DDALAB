use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiConfig {
    pub url: String,
    pub timeout: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileManagerState {
    pub selected_file: Option<String>,
    pub current_path: Vec<String>,
    pub selected_channels: Vec<String>,
    pub search_query: String,
    pub sort_by: String,
    pub sort_order: String,
    pub show_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotState {
    pub visible_channels: Vec<String>,
    pub time_range: (f64, f64),
    pub amplitude_range: (f64, f64),
    pub zoom_level: f64,
    pub annotations: Vec<serde_json::Value>,
    pub color_scheme: String,
    pub plot_mode: String, // 'raw', 'filtered', etc.
    pub filters: HashMap<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preprocessing: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub id: String,
    pub file_path: String,
    pub timestamp: String,
    pub variant_name: String,
    pub variant_display_name: String,
    pub parameters: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_position: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_data: Option<serde_json::Value>, // Cached plot data for quick restore
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>, // Custom name for the analysis
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAState {
    pub selected_variants: Vec<String>,
    pub parameters: HashMap<String, serde_json::Value>,
    pub last_analysis_id: Option<String>,
    pub current_analysis: Option<AnalysisResult>,
    pub analysis_history: Vec<AnalysisResult>,
    pub analysis_parameters: HashMap<String, serde_json::Value>, // Current analysis parameters
    pub running: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub position: (i32, i32),
    pub size: (u32, u32),
    pub maximized: bool,
    pub tab: String, // Currently active tab
}

// Lightweight UI state - only settings and preferences
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIState {
    pub version: String,
    pub active_tab: String,
    pub sidebar_collapsed: bool,
    pub panel_sizes: HashMap<String, f64>,
    pub theme: String,
    pub last_selected_file: Option<String>,
    pub file_manager: FileManagerState,
    pub windows: HashMap<String, WindowState>,
    #[serde(default = "default_zoom")]
    pub zoom: f64, // Global zoom level (0.75 to 1.5, default 1.0)
    #[serde(default)]
    pub ui_extras: HashMap<String, serde_json::Value>, // For misc UI state
}

fn default_zoom() -> f64 {
    1.0
}

// Legacy AppState for backward compatibility during migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub version: String, // For migration purposes
    pub file_manager: FileManagerState,
    pub plot: PlotState,
    pub dda: DDAState,
    pub ui: HashMap<String, serde_json::Value>,
    pub windows: HashMap<String, WindowState>, // For popout windows
    pub active_tab: String,
    pub sidebar_collapsed: bool,
    pub panel_sizes: HashMap<String, f64>, // Panel sizing ratios
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppPreferences {
    pub api_config: ApiConfig,
    pub window_state: HashMap<String, serde_json::Value>,
    pub theme: String,
    #[serde(default = "default_use_https")]
    pub use_https: bool,
}

fn default_use_https() -> bool {
    false // HTTP by default - HTTPS has certificate trust issues in Tauri's WebView
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
            preprocessing: None,
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

impl Default for UIState {
    fn default() -> Self {
        Self {
            version: "2.0.0".to_string(),
            active_tab: "files".to_string(),
            sidebar_collapsed: false,
            panel_sizes: {
                let mut sizes = HashMap::new();
                sizes.insert("sidebar".to_string(), 0.25);
                sizes.insert("main".to_string(), 0.75);
                sizes.insert("plot-height".to_string(), 0.6);
                sizes
            },
            theme: "auto".to_string(),
            last_selected_file: None,
            file_manager: FileManagerState::default(),
            windows: HashMap::new(),
            zoom: 1.0,
            ui_extras: HashMap::new(),
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
                url: "http://localhost:8765".to_string(), // HTTP by default (HTTPS has WebView trust issues)
                timeout: 30,
            },
            window_state: HashMap::new(),
            theme: "auto".to_string(),
            use_https: false, // HTTP by default - HTTPS has certificate trust issues in Tauri's WebView
        }
    }
}
