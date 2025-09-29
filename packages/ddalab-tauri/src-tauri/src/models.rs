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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub id: String,
    pub file_path: String,
    pub created_at: String,
    pub results: serde_json::Value,
    pub parameters: serde_json::Value,
    pub plot_data: Option<serde_json::Value>, // Cached plot data for quick restore
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
