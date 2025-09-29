use crate::models::AppState;
use crate::utils::get_app_config_dir;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppStateManager {
    state: Arc<RwLock<AppState>>,
    config_path: PathBuf,
    analysis_preview_data: Arc<RwLock<HashMap<String, serde_json::Value>>>,
    auto_save_enabled: bool,
}

impl AppStateManager {
    pub fn new() -> Result<Self, String> {
        let app_config_dir = get_app_config_dir()?;
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

    pub fn save(&self) -> Result<(), String> {
        let state = self.state.read();
        let content = serde_json::to_string_pretty(&*state)
            .map_err(|e| format!("Failed to serialize state: {}", e))?;

        fs::write(&self.config_path, content)
            .map_err(|e| format!("Failed to write state file: {}", e))?;

        Ok(())
    }

    pub fn get_state(&self) -> AppState {
        self.state.read().clone()
    }

    pub fn update_state<F>(&self, updater: F) -> Result<(), String>
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

    pub fn set_auto_save(&mut self, enabled: bool) {
        self.auto_save_enabled = enabled;
    }

    fn migrate_state(&self) -> Result<(), String> {
        let mut state = self.state.write();

        // Check if migration is needed based on version
        if state.version != "1.0.0" {
            log::info!("Migrating state from version {} to 1.0.0", state.version);

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
                    log::warn!("Unknown state version {}, resetting to defaults", state.version);
                    *state = AppState::default();
                }
            }
        }

        Ok(())
    }

    pub fn store_analysis_preview_data(&self, window_id: String, analysis_data: serde_json::Value) {
        let mut preview_data = self.analysis_preview_data.write();
        preview_data.insert(window_id, analysis_data);
    }

    pub fn get_analysis_preview_data(&self, window_id: &str) -> Option<serde_json::Value> {
        let preview_data = self.analysis_preview_data.read();
        preview_data.get(window_id).cloned()
    }
}
