use std::sync::Arc;
use std::path::PathBuf;
use std::collections::HashMap;
use parking_lot::RwLock;
use serde_json::json;
use crate::api::models::{EDFFileInfo, DDAResult, ChunkData};
use crate::api::auth::constant_time_eq;
use crate::db::analysis_db::AnalysisDatabase;
use crate::db::overview_cache_db::OverviewCacheDatabase;
use crate::models::AnalysisResult;

#[derive(Debug)]
pub struct ApiState {
    pub files: Arc<RwLock<HashMap<String, EDFFileInfo>>>,
    pub analysis_results: Arc<RwLock<HashMap<String, DDAResult>>>,
    pub chunks_cache: Arc<RwLock<HashMap<String, ChunkData>>>,
    pub data_directory: PathBuf,
    pub history_directory: PathBuf,
    pub dda_binary_path: Option<PathBuf>,
    pub analysis_db: Option<Arc<AnalysisDatabase>>,
    pub overview_cache_db: Option<Arc<OverviewCacheDatabase>>,
    pub session_token: Arc<RwLock<Option<String>>>,
    pub require_auth: Arc<RwLock<bool>>,
}

impl ApiState {
    pub fn new(data_directory: PathBuf) -> Self {
        // NOTE: dda_history directory is obsolete - analysis persistence now uses SQLite only
        // The history_directory field is kept for backwards compatibility but no longer used
        let history_directory = data_directory.parent()
            .unwrap_or(&data_directory)
            .join("dda_history");

        // Initialize SQLite database for analysis persistence
        let analysis_db = if let Some(parent) = data_directory.parent() {
            let db_path = parent.join("analysis.db");
            log::info!("Initializing analysis database at: {:?}", db_path);
            match AnalysisDatabase::new(&db_path) {
                Ok(db) => {
                    log::info!("✅ Analysis database initialized successfully");
                    Some(Arc::new(db))
                },
                Err(e) => {
                    log::error!("❌ Failed to initialize analysis database: {}", e);
                    None
                }
            }
        } else {
            log::error!("❌ Cannot determine database path - no parent directory");
            None
        };

        // Initialize SQLite database for overview caching
        let overview_cache_db = if let Some(parent) = data_directory.parent() {
            let db_path = parent.join("overview_cache.db");
            log::info!("Initializing overview cache database at: {:?}", db_path);
            match OverviewCacheDatabase::new(&db_path) {
                Ok(db) => {
                    log::info!("✅ Overview cache database initialized successfully");
                    Some(Arc::new(db))
                },
                Err(e) => {
                    log::error!("❌ Failed to initialize overview cache database: {}", e);
                    None
                }
            }
        } else {
            log::error!("❌ Cannot determine overview cache database path - no parent directory");
            None
        };

        let state = Self {
            files: Arc::new(RwLock::new(HashMap::new())),
            analysis_results: Arc::new(RwLock::new(HashMap::new())),
            chunks_cache: Arc::new(RwLock::new(HashMap::new())),
            data_directory,
            history_directory,
            dda_binary_path: None,
            analysis_db,
            overview_cache_db,
            session_token: Arc::new(RwLock::new(None)),
            require_auth: Arc::new(RwLock::new(true)),
        };

        state
    }

    /// Set the session token for API authentication
    pub fn set_session_token(&self, token: String) {
        *self.session_token.write() = Some(token);
        log::info!("🔐 Session token configured");
    }

    /// Get the session token
    pub fn get_session_token(&self) -> Option<String> {
        self.session_token.read().clone()
    }

    /// Verify if the provided token matches the session token
    pub fn verify_session_token(&self, token: &str) -> bool {
        if let Some(expected_token) = self.session_token.read().as_ref() {
            constant_time_eq(expected_token.as_bytes(), token.as_bytes())
        } else {
            false
        }
    }

    /// Set whether authentication is required
    pub fn set_require_auth(&self, require: bool) {
        *self.require_auth.write() = require;
        log::info!("🔐 Authentication requirement set to: {}", require);
    }

    /// Check if authentication is required
    pub fn requires_auth(&self) -> bool {
        *self.require_auth.read()
    }

    /// Save analysis result to SQLite database
    pub fn save_to_disk(&self, result: &DDAResult) -> Result<(), String> {
        if let Some(ref db) = self.analysis_db {
            let complete_data = json!({
                "results": result.results,
                "channels": result.channels,
                "q_matrix": result.q_matrix,
                "plot_data": result.plot_data,
                "status": result.status
            });

            let analysis_result = AnalysisResult {
                id: result.id.clone(),
                file_path: result.file_path.clone(),
                timestamp: result.created_at.clone(),
                variant_name: result.parameters.variants.first()
                    .unwrap_or(&"single_timeseries".to_string())
                    .clone(),
                variant_display_name: "Single Timeseries (ST)".to_string(),
                parameters: serde_json::to_value(&result.parameters)
                    .map_err(|e| format!("Failed to serialize parameters: {}", e))?,
                chunk_position: None,
                plot_data: Some(complete_data),
                name: None,
            };

            db.save_analysis(&analysis_result)
                .map_err(|e| format!("Failed to save analysis to database: {}", e))?;

            log::info!("✅ Saved analysis {} to SQLite database", result.id);
            Ok(())
        } else {
            log::warn!("⚠️ Analysis database not available, skipping persistence");
            Ok(())
        }
    }

    /// Set the DDA binary path (should be called with Tauri-resolved path)
    pub fn set_dda_binary_path(&mut self, path: PathBuf) {
        log::info!("Setting DDA binary path to: {:?}", path);
        self.dda_binary_path = Some(path);
    }

    /// Initialize overview cache on startup
    /// This preloads metadata for complete caches into memory and logs incomplete caches
    pub fn initialize_overview_cache(&self) {
        if let Some(ref cache_db) = self.overview_cache_db {
            log::info!("🔄 Initializing overview cache...");

            match cache_db.get_incomplete_caches() {
                Ok(incomplete_caches) => {
                    if incomplete_caches.is_empty() {
                        log::info!("✅ No incomplete overview caches found");
                    } else {
                        log::info!(
                            "📊 Found {} incomplete overview cache(s) - they will resume on next request:",
                            incomplete_caches.len()
                        );
                        for cache in incomplete_caches {
                            log::info!(
                                "   - {} ({:.1}% complete, {} channels)",
                                cache.file_path,
                                cache.completion_percentage,
                                cache.channels.len()
                            );
                        }
                    }
                }
                Err(e) => {
                    log::error!("❌ Failed to check incomplete caches: {}", e);
                }
            }

            log::info!("✅ Overview cache initialization complete");
        } else {
            log::info!("⚠️ Overview cache database not available, skipping initialization");
        }
    }
}
