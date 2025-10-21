use crate::db::{AnalysisDatabase, AnnotationDatabase, FileStateDatabase, SecretsDatabase, NotificationsDatabase};
use crate::models::{AppState, UIState};
use ddalab_tauri::nsg::{NSGJobManager, NSGJobPoller};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppStateManager {
    ui_state: Arc<RwLock<UIState>>,
    analysis_db: Arc<AnalysisDatabase>,
    annotation_db: Arc<AnnotationDatabase>,
    file_state_db: Arc<FileStateDatabase>,
    secrets_db: Arc<SecretsDatabase>,
    notifications_db: Arc<NotificationsDatabase>,
    nsg_manager: Option<Arc<NSGJobManager>>,
    nsg_poller: Option<Arc<NSGJobPoller>>,
    ui_state_path: PathBuf,
    auto_save_enabled: bool,
    analysis_preview_data: Arc<RwLock<HashMap<String, serde_json::Value>>>,
}

impl AppStateManager {
    pub fn new(app_config_dir: PathBuf) -> Result<Self, String> {
        // Ensure the config directory exists
        std::fs::create_dir_all(&app_config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;

        let ui_state_path = app_config_dir.join("ui-state.json");
        let analysis_db_path = app_config_dir.join("analysis.db");
        let annotation_db_path = app_config_dir.join("annotations.db");
        let file_state_db_path = app_config_dir.join("file_state.db");
        let secrets_db_path = app_config_dir.join("secrets.db");
        let notifications_db_path = app_config_dir.join("notifications.db");

        eprintln!("📂 [STATE_MANAGER] Using config directory: {:?}", app_config_dir);
        eprintln!("📄 [STATE_MANAGER] UI state file: {:?}", ui_state_path);
        eprintln!("📊 [STATE_MANAGER] Analysis DB: {:?}", analysis_db_path);
        eprintln!("📌 [STATE_MANAGER] Annotation DB: {:?}", annotation_db_path);
        eprintln!("📁 [STATE_MANAGER] File State DB: {:?}", file_state_db_path);
        eprintln!("🔐 [STATE_MANAGER] Secrets DB: {:?}", secrets_db_path);
        eprintln!("🔔 [STATE_MANAGER] Notifications DB: {:?}", notifications_db_path);

        // Load UI state from JSON
        let ui_state = if ui_state_path.exists() {
            let content = fs::read_to_string(&ui_state_path)
                .map_err(|e| format!("Failed to read UI state file: {}", e))?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            UIState::default()
        };

        // Initialize SQLite databases
        let analysis_db = AnalysisDatabase::new(&analysis_db_path)
            .map_err(|e| format!("Failed to initialize analysis database: {}", e))?;

        let annotation_db = AnnotationDatabase::new(&annotation_db_path)
            .map_err(|e| format!("Failed to initialize annotation database: {}", e))?;

        let file_state_db = FileStateDatabase::new(&file_state_db_path)
            .map_err(|e| format!("Failed to initialize file state database: {}", e))?;

        let secrets_db = SecretsDatabase::new(&secrets_db_path)
            .map_err(|e| format!("Failed to initialize secrets database: {}", e))?;

        let notifications_db = NotificationsDatabase::new(&notifications_db_path)
            .map_err(|e| format!("Failed to initialize notifications database: {}", e))?;

        // Initialize NSG components if credentials are available
        let nsg_jobs_db_path = app_config_dir.join("nsg_jobs.db");
        let nsg_output_dir = app_config_dir.join("nsg_output");

        eprintln!("🚀 [STATE_MANAGER] NSG Jobs DB: {:?}", nsg_jobs_db_path);
        eprintln!("📁 [STATE_MANAGER] NSG Output Dir: {:?}", nsg_output_dir);

        let (nsg_manager, nsg_poller) = match secrets_db.has_nsg_credentials() {
            Ok(true) => {
                eprintln!("🔑 [STATE_MANAGER] NSG credentials found, initializing NSG components...");
                match Self::init_nsg_components(&secrets_db, &nsg_jobs_db_path, &nsg_output_dir) {
                    Ok((manager, poller)) => {
                        eprintln!("✅ [STATE_MANAGER] NSG components initialized successfully");
                        (Some(manager), Some(poller))
                    }
                    Err(e) => {
                        eprintln!("⚠️  [STATE_MANAGER] Failed to initialize NSG components: {}", e);
                        (None, None)
                    }
                }
            }
            _ => {
                eprintln!("ℹ️  [STATE_MANAGER] No NSG credentials found, skipping NSG initialization");
                (None, None)
            }
        };

        let manager = Self {
            ui_state: Arc::new(RwLock::new(ui_state)),
            analysis_db: Arc::new(analysis_db),
            annotation_db: Arc::new(annotation_db),
            file_state_db: Arc::new(file_state_db),
            secrets_db: Arc::new(secrets_db),
            notifications_db: Arc::new(notifications_db),
            nsg_manager,
            nsg_poller,
            ui_state_path,
            auto_save_enabled: true,
            analysis_preview_data: Arc::new(RwLock::new(HashMap::new())),
        };

        // Migrate from old state.json if exists
        let old_state_path = app_config_dir.join("state.json");
        if old_state_path.exists() {
            log::info!("📦 Found old state.json, migrating to new database structure...");
            if let Err(e) = manager.migrate_from_old_state(&old_state_path) {
                log::error!("❌ Migration failed: {}, continuing with defaults", e);
            } else {
                log::info!("✅ Migration completed successfully");
                // Backup old state file
                let backup_path = app_config_dir.join("state.json.backup");
                if let Err(e) = fs::rename(&old_state_path, &backup_path) {
                    log::warn!("Failed to backup old state.json: {}", e);
                }
            }
        }

        Ok(manager)
    }

    fn migrate_from_old_state(&self, old_state_path: &PathBuf) -> Result<(), String> {
        let content = fs::read_to_string(old_state_path)
            .map_err(|e| format!("Failed to read old state: {}", e))?;

        let old_state: AppState = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse old state: {}", e))?;

        // Migrate UI settings
        let mut ui_state = self.ui_state.write();
        ui_state.active_tab = old_state.active_tab;
        ui_state.sidebar_collapsed = old_state.sidebar_collapsed;
        ui_state.panel_sizes = old_state.panel_sizes;
        ui_state.last_selected_file = old_state.file_manager.selected_file.clone();
        ui_state.file_manager = old_state.file_manager;
        ui_state.windows = old_state.windows;
        drop(ui_state);

        // Migrate analysis history to database
        log::info!("📊 Migrating {} analyses to database...", old_state.dda.analysis_history.len());
        for analysis in old_state.dda.analysis_history {
            if let Err(e) = self.analysis_db.save_analysis(&analysis) {
                log::warn!("Failed to migrate analysis {}: {}", analysis.id, e);
            }
        }

        // Migrate annotations to database
        if let Some(frontend_state) = old_state.ui.get("frontend_state") {
            if let Some(annotations) = frontend_state.get("annotations") {
                if let Some(time_series) = annotations.get("timeSeries").and_then(|v| v.as_object()) {
                    log::info!("📌 Migrating annotations for {} files...", time_series.len());
                    for (file_path, file_annotations) in time_series {
                        if let Some(global_annotations) = file_annotations.get("globalAnnotations").and_then(|v| v.as_array()) {
                            for ann in global_annotations {
                                if let Ok(annotation) = serde_json::from_value(ann.clone()) {
                                    if let Err(e) = self.annotation_db.save_annotation(file_path, None, &annotation) {
                                        log::warn!("Failed to migrate annotation: {}", e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Save migrated UI state
        self.save_ui_state()?;

        Ok(())
    }

    fn save_ui_state(&self) -> Result<(), String> {
        let ui_state = self.ui_state.read();
        let content = serde_json::to_string_pretty(&*ui_state)
            .map_err(|e| format!("Failed to serialize UI state: {}", e))?;

        fs::write(&self.ui_state_path, content)
            .map_err(|e| format!("Failed to write UI state file: {}", e))?;

        Ok(())
    }

    pub fn save(&self) -> Result<(), String> {
        self.save_ui_state()
    }

    pub fn get_state(&self) -> AppState {
        // Build legacy AppState for backward compatibility
        let ui_state = self.ui_state.read();

        AppState {
            version: ui_state.version.clone(),
            file_manager: ui_state.file_manager.clone(),
            plot: crate::models::PlotState::default(),
            dda: crate::models::DDAState {
                selected_variants: vec!["single_timeseries".to_string()],
                parameters: HashMap::new(),
                last_analysis_id: None,
                current_analysis: None,
                analysis_history: Vec::new(), // Empty - use DB queries instead
                analysis_parameters: HashMap::new(),
                running: false,
            },
            ui: ui_state.ui_extras.clone(),
            windows: ui_state.windows.clone(),
            active_tab: ui_state.active_tab.clone(),
            sidebar_collapsed: ui_state.sidebar_collapsed,
            panel_sizes: ui_state.panel_sizes.clone(),
        }
    }

    pub fn get_ui_state(&self) -> UIState {
        self.ui_state.read().clone()
    }

    pub fn update_ui_state<F>(&self, updater: F) -> Result<(), String>
    where
        F: FnOnce(&mut UIState),
    {
        {
            let mut state = self.ui_state.write();
            updater(&mut state);
        }
        if self.auto_save_enabled {
            self.save_ui_state()
        } else {
            Ok(())
        }
    }

    pub fn update_state<F>(&self, updater: F) -> Result<(), String>
    where
        F: FnOnce(&mut AppState),
    {
        // For legacy compatibility - convert to UI state update
        let mut legacy_state = self.get_state();
        updater(&mut legacy_state);

        // Extract UI updates
        let mut ui_state = self.ui_state.write();
        ui_state.active_tab = legacy_state.active_tab;
        ui_state.sidebar_collapsed = legacy_state.sidebar_collapsed;
        ui_state.panel_sizes = legacy_state.panel_sizes;
        ui_state.file_manager = legacy_state.file_manager;
        ui_state.windows = legacy_state.windows;
        ui_state.ui_extras = legacy_state.ui;
        drop(ui_state);

        if self.auto_save_enabled {
            self.save_ui_state()
        } else {
            Ok(())
        }
    }

    pub fn set_auto_save(&mut self, enabled: bool) {
        self.auto_save_enabled = enabled;
    }

    pub fn get_analysis_db(&self) -> &AnalysisDatabase {
        &self.analysis_db
    }

    pub fn get_annotation_db(&self) -> &AnnotationDatabase {
        &self.annotation_db
    }

    pub fn get_file_state_db(&self) -> &FileStateDatabase {
        &self.file_state_db
    }

    pub fn get_secrets_db(&self) -> &SecretsDatabase {
        &self.secrets_db
    }

    pub fn get_notifications_db(&self) -> &NotificationsDatabase {
        &self.notifications_db
    }

    pub fn store_analysis_preview_data(&self, window_id: String, analysis_data: serde_json::Value) {
        let mut preview_data = self.analysis_preview_data.write();
        preview_data.insert(window_id, analysis_data);
    }

    pub fn get_analysis_preview_data(&self, window_id: &str) -> Option<serde_json::Value> {
        let preview_data = self.analysis_preview_data.read();
        preview_data.get(window_id).cloned()
    }

    pub fn get_nsg_manager(&self) -> Option<&Arc<NSGJobManager>> {
        self.nsg_manager.as_ref()
    }

    pub fn get_nsg_poller(&self) -> Option<&Arc<NSGJobPoller>> {
        self.nsg_poller.as_ref()
    }

    fn init_nsg_components(
        secrets_db: &SecretsDatabase,
        nsg_jobs_db_path: &PathBuf,
        nsg_output_dir: &PathBuf,
    ) -> Result<(Arc<NSGJobManager>, Arc<NSGJobPoller>), String> {
        use ddalab_tauri::nsg::NSGCredentials;
        use ddalab_tauri::db::NSGJobsDatabase;

        // Get NSG credentials
        let (username, password, app_key) = secrets_db
            .get_nsg_credentials()
            .map_err(|e| format!("Failed to get NSG credentials: {}", e))?
            .ok_or_else(|| "NSG credentials not found".to_string())?;

        // Create credentials struct
        let credentials = NSGCredentials {
            username,
            password,
            app_key,
        };

        // Initialize NSG components
        let nsg_jobs_db = NSGJobsDatabase::new(nsg_jobs_db_path)
            .map_err(|e| format!("Failed to initialize NSG jobs database: {}", e))?;

        std::fs::create_dir_all(nsg_output_dir)
            .map_err(|e| format!("Failed to create NSG output directory: {}", e))?;

        let nsg_manager = NSGJobManager::new(
            credentials,
            Arc::new(nsg_jobs_db),
            nsg_output_dir.clone(),
        )
        .map_err(|e| format!("Failed to create NSG job manager: {}", e))?;

        let nsg_manager = Arc::new(nsg_manager);
        let nsg_poller = Arc::new(NSGJobPoller::new(nsg_manager.clone()));

        // NOTE: Polling will be started later by start_nsg_polling() command
        // after Tauri runtime is fully initialized

        Ok((nsg_manager, nsg_poller))
    }
}
