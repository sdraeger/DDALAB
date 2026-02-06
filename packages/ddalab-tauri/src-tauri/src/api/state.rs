use crate::api::auth::{constant_time_eq, AuthRateLimiter, TokenInfo, TokenVerifyResult};
use crate::api::handlers::ica::ICAResultResponse;
use crate::api::models::{ChunkData, DDAResult, EDFFileInfo};
use crate::db::analysis_db::AnalysisDatabase;
use crate::db::ica_db::{ICADatabase, ICAStoredResult};
use crate::db::overview_cache_db::OverviewCacheDatabase;
use crate::models::AnalysisResult;
use crate::utils::get_database_path;
use parking_lot::{Mutex, RwLock};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Maximum number of entries in the chunks cache before eviction
const MAX_CHUNKS_CACHE_SIZE: usize = 50;
/// Maximum number of entries in the files cache before eviction
const MAX_FILES_CACHE_SIZE: usize = 100;
/// Maximum number of cancelled analysis IDs to track (prevents memory leak)
const MAX_CANCELLED_ANALYSES: usize = 100;

/// LRU-like cache that tracks insertion order for eviction
#[derive(Debug)]
pub struct LruCache<V> {
    map: HashMap<String, Arc<V>>,
    order: VecDeque<String>,
    max_size: usize,
}

impl<V> LruCache<V> {
    pub fn new(max_size: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: VecDeque::new(),
            max_size,
        }
    }

    /// Get a value from the cache (returns Arc to avoid cloning)
    pub fn get(&self, key: &str) -> Option<Arc<V>> {
        self.map.get(key).cloned()
    }

    /// Insert a value, evicting oldest entries if over capacity
    pub fn insert(&mut self, key: String, value: V) {
        self.insert_arc(key, Arc::new(value));
    }

    /// Insert a pre-wrapped Arc value, evicting oldest entries if over capacity.
    /// This avoids cloning when the caller already has an Arc (e.g., for zero-copy responses).
    pub fn insert_arc(&mut self, key: String, value: Arc<V>) {
        // If key exists, remove from order queue (will be re-added at end)
        if self.map.contains_key(&key) {
            self.order.retain(|k| k != &key);
        }

        // Evict oldest entries if at capacity
        while self.map.len() >= self.max_size && !self.order.is_empty() {
            if let Some(old_key) = self.order.pop_front() {
                self.map.remove(&old_key);
                log::debug!("Cache evicted: {}", old_key);
            }
        }

        self.map.insert(key.clone(), value);
        self.order.push_back(key);
    }

    /// Check if key exists
    pub fn contains_key(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    /// Get current cache size
    pub fn len(&self) -> usize {
        self.map.len()
    }
}

/// Bounded set that evicts oldest entries when full (prevents memory leaks)
#[derive(Debug)]
pub struct BoundedSet {
    set: std::collections::HashSet<String>,
    order: VecDeque<String>,
    max_size: usize,
}

impl BoundedSet {
    pub fn new(max_size: usize) -> Self {
        Self {
            set: std::collections::HashSet::new(),
            order: VecDeque::new(),
            max_size,
        }
    }

    /// Insert a value, evicting oldest entries if over capacity
    pub fn insert(&mut self, value: String) -> bool {
        if self.set.contains(&value) {
            return false; // Already present
        }

        // Evict oldest entries if at capacity
        while self.set.len() >= self.max_size && !self.order.is_empty() {
            if let Some(old_value) = self.order.pop_front() {
                self.set.remove(&old_value);
            }
        }

        self.set.insert(value.clone());
        self.order.push_back(value);
        true
    }

    /// Check if value exists
    pub fn contains(&self, value: &str) -> bool {
        self.set.contains(value)
    }

    /// Get current size
    #[allow(dead_code)]
    pub fn len(&self) -> usize {
        self.set.len()
    }
}

/// Cancellation token for DDA analysis
#[derive(Debug)]
pub struct CancellationToken {
    cancelled: AtomicBool,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn reset(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// Simple token bucket rate limiter for DDA analysis requests
/// Prevents DoS by limiting how many concurrent analyses can run
#[derive(Debug)]
pub struct RateLimiter {
    /// Maximum number of requests allowed in the window
    max_requests: u32,
    /// Time window for rate limiting (in seconds)
    window_secs: u64,
    /// Current request count in this window
    request_count: AtomicU64,
    /// Timestamp when the current window started
    window_start: Mutex<Instant>,
}

impl RateLimiter {
    pub fn new(max_requests: u32, window_secs: u64) -> Self {
        Self {
            max_requests,
            window_secs,
            request_count: AtomicU64::new(0),
            window_start: Mutex::new(Instant::now()),
        }
    }

    /// Check if a request is allowed under the rate limit.
    /// Returns true if allowed, false if rate limited.
    pub fn check_and_increment(&self) -> bool {
        let now = Instant::now();
        let mut window_start = self.window_start.lock();

        // Check if we need to reset the window
        if now.duration_since(*window_start) > Duration::from_secs(self.window_secs) {
            *window_start = now;
            self.request_count.store(1, Ordering::SeqCst);
            return true;
        }

        // Increment and check count
        let count = self.request_count.fetch_add(1, Ordering::SeqCst) + 1;
        count <= self.max_requests as u64
    }

    /// Get current request count (for monitoring)
    pub fn current_count(&self) -> u64 {
        self.request_count.load(Ordering::SeqCst)
    }

    /// Get seconds until the rate limit window resets
    pub fn seconds_until_reset(&self) -> u64 {
        let window_start = self.window_start.lock();
        let elapsed = Instant::now().duration_since(*window_start).as_secs();
        self.window_secs.saturating_sub(elapsed)
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        // Default: 10 DDA analysis requests per minute
        Self::new(10, 60)
    }
}

#[derive(Debug)]
pub struct ApiState {
    pub files: Arc<RwLock<LruCache<EDFFileInfo>>>,
    pub analysis_results: Arc<RwLock<HashMap<String, Arc<DDAResult>>>>,
    pub chunks_cache: Arc<RwLock<LruCache<ChunkData>>>,
    pub data_directory: Arc<RwLock<PathBuf>>,
    pub history_directory: PathBuf,
    pub dda_binary_path: Option<PathBuf>,
    pub analysis_db: Option<Arc<AnalysisDatabase>>,
    pub overview_cache_db: Option<Arc<OverviewCacheDatabase>>,
    pub ica_db: Option<Arc<ICADatabase>>,
    pub session_token: Arc<RwLock<Option<TokenInfo>>>,
    pub revoked_tokens: Arc<RwLock<HashSet<String>>>,
    pub require_auth: Arc<RwLock<bool>>,
    pub auth_rate_limiter: Arc<AuthRateLimiter>,
    pub ica_history: Mutex<Vec<ICAResultResponse>>,
    /// Current running analysis ID (for cancellation tracking)
    pub current_analysis_id: Arc<RwLock<Option<String>>>,
    /// Cancellation token for the current analysis
    pub cancellation_token: Arc<CancellationToken>,
    /// Bounded set of cancelled analysis IDs (prevents memory leak from unbounded growth)
    pub cancelled_analyses: Arc<RwLock<BoundedSet>>,
    /// Rate limiter for DDA analysis requests (prevents DoS)
    pub dda_rate_limiter: Arc<RateLimiter>,
}

impl ApiState {
    pub fn new(data_directory: PathBuf) -> Self {
        // NOTE: dda_history directory is obsolete - analysis persistence now uses SQLite only
        // The history_directory field is kept for backwards compatibility but no longer used
        let history_directory = data_directory
            .parent()
            .unwrap_or(&data_directory)
            .join("dda_history");

        // Initialize SQLite database for analysis persistence
        // Use platform-specific database directory (NOT the data_directory parent)
        let analysis_db = match get_database_path("api_analysis.db") {
            Ok(db_path) => {
                log::info!("Initializing API analysis database at: {:?}", db_path);
                match AnalysisDatabase::new(&db_path) {
                    Ok(db) => {
                        log::info!("API analysis database initialized successfully");
                        Some(Arc::new(db))
                    }
                    Err(e) => {
                        log::error!("Failed to initialize API analysis database: {}", e);
                        None
                    }
                }
            }
            Err(e) => {
                log::error!("Cannot determine API analysis database path: {}", e);
                None
            }
        };

        // Initialize SQLite database for overview caching
        // Use platform-specific database directory (NOT the data_directory parent)
        let overview_cache_db = match get_database_path("overview_cache.db") {
            Ok(db_path) => {
                log::info!("Initializing overview cache database at: {:?}", db_path);
                match OverviewCacheDatabase::new(&db_path) {
                    Ok(db) => {
                        log::info!("Overview cache database initialized successfully");
                        Some(Arc::new(db))
                    }
                    Err(e) => {
                        log::error!("Failed to initialize overview cache database: {}", e);
                        None
                    }
                }
            }
            Err(e) => {
                log::error!("Cannot determine overview cache database path: {}", e);
                None
            }
        };

        // Initialize SQLite database for ICA analysis persistence
        let (ica_db, ica_history) = match get_database_path("ica_analysis.db") {
            Ok(db_path) => {
                log::info!("Initializing ICA analysis database at: {:?}", db_path);
                match ICADatabase::new(&db_path) {
                    Ok(db) => {
                        // Load existing ICA history from database
                        let history: Vec<ICAResultResponse> = match db.get_all_analyses(50) {
                            Ok(analyses) => {
                                log::info!(
                                    "ICA database initialized, loaded {} analyses",
                                    analyses.len()
                                );
                                // Convert from ICAStoredResult to ICAResultResponse
                                // Filter out any that fail to deserialize
                                analyses
                                    .into_iter()
                                    .filter_map(|stored| {
                                        match serde_json::from_value(stored.results) {
                                            Ok(results) => Some(ICAResultResponse {
                                                id: stored.id,
                                                name: stored.name,
                                                file_path: stored.file_path,
                                                channels: stored.channels,
                                                created_at: stored.created_at,
                                                status: stored.status,
                                                results,
                                            }),
                                            Err(e) => {
                                                log::warn!(
                                                    "Failed to deserialize ICA result {}: {}",
                                                    stored.id,
                                                    e
                                                );
                                                None
                                            }
                                        }
                                    })
                                    .collect()
                            }
                            Err(e) => {
                                log::error!("Failed to load ICA history: {}", e);
                                Vec::new()
                            }
                        };
                        (Some(Arc::new(db)), history)
                    }
                    Err(e) => {
                        log::error!("Failed to initialize ICA database: {}", e);
                        (None, Vec::new())
                    }
                }
            }
            Err(e) => {
                log::error!("Cannot determine ICA database path: {}", e);
                (None, Vec::new())
            }
        };

        let state = Self {
            files: Arc::new(RwLock::new(LruCache::new(MAX_FILES_CACHE_SIZE))),
            analysis_results: Arc::new(RwLock::new(HashMap::new())),
            chunks_cache: Arc::new(RwLock::new(LruCache::new(MAX_CHUNKS_CACHE_SIZE))),
            data_directory: Arc::new(RwLock::new(data_directory)),
            history_directory,
            dda_binary_path: None,
            analysis_db,
            overview_cache_db,
            ica_db,
            session_token: Arc::new(RwLock::new(None)),
            revoked_tokens: Arc::new(RwLock::new(HashSet::new())),
            require_auth: Arc::new(RwLock::new(true)),
            auth_rate_limiter: Arc::new(AuthRateLimiter::new()),
            ica_history: Mutex::new(ica_history),
            current_analysis_id: Arc::new(RwLock::new(None)),
            cancellation_token: Arc::new(CancellationToken::new()),
            cancelled_analyses: Arc::new(RwLock::new(BoundedSet::new(MAX_CANCELLED_ANALYSES))),
            // Rate limiter: 10 DDA analyses per minute (prevents DoS)
            dda_rate_limiter: Arc::new(RateLimiter::new(10, 60)),
        };

        state
    }

    /// Set the session token for API authentication with default TTL (1 hour)
    pub fn set_session_token(&self, token: String) {
        self.set_session_token_with_ttl(token, crate::api::auth::DEFAULT_TOKEN_TTL_SECS);
    }

    /// Set the session token with a custom TTL in seconds
    pub fn set_session_token_with_ttl(&self, token: String, ttl_secs: u64) {
        let token_info = TokenInfo::new(token, ttl_secs);
        *self.session_token.write() = Some(token_info);
        log::info!("🔐 Session token configured with {}s TTL", ttl_secs);
    }

    /// Get the session token string (if valid and not expired)
    pub fn get_session_token(&self) -> Option<String> {
        let guard = self.session_token.read();
        if let Some(ref token_info) = *guard {
            if !token_info.is_expired() {
                return Some(token_info.token.clone());
            }
        }
        None
    }

    /// Get token info including expiration details
    pub fn get_token_info(&self) -> Option<(String, u64)> {
        let guard = self.session_token.read();
        if let Some(ref token_info) = *guard {
            if !token_info.is_expired() {
                return Some((token_info.token.clone(), token_info.remaining_secs()));
            }
        }
        None
    }

    /// Verify if the provided token matches the session token and is not expired
    pub fn verify_session_token(&self, token: &str) -> TokenVerifyResult {
        // Check if token is revoked first
        if self.revoked_tokens.read().contains(token) {
            return TokenVerifyResult::Revoked;
        }

        let guard = self.session_token.read();
        if let Some(ref token_info) = *guard {
            // Check expiration first
            if token_info.is_expired() {
                return TokenVerifyResult::Expired;
            }

            // Constant-time comparison to prevent timing attacks
            if constant_time_eq(token_info.token.as_bytes(), token.as_bytes()) {
                TokenVerifyResult::Valid
            } else {
                TokenVerifyResult::Invalid
            }
        } else {
            TokenVerifyResult::NoToken
        }
    }

    /// Revoke the current session token
    pub fn revoke_current_token(&self) {
        let mut session = self.session_token.write();
        if let Some(ref token_info) = *session {
            self.revoked_tokens.write().insert(token_info.token.clone());
            log::info!("🔐 Session token revoked");
        }
        *session = None;
    }

    /// Revoke a specific token by value
    pub fn revoke_token(&self, token: &str) {
        self.revoked_tokens.write().insert(token.to_string());
        log::info!("🔐 Token revoked");

        // If it's the current token, clear it
        let mut session = self.session_token.write();
        if let Some(ref token_info) = *session {
            if token_info.token == token {
                *session = None;
            }
        }
    }

    /// Refresh the current token (extend expiration)
    pub fn refresh_token(&self) -> Option<String> {
        let mut guard = self.session_token.write();
        if let Some(ref mut token_info) = *guard {
            if !token_info.is_expired() {
                token_info.extend(crate::api::auth::DEFAULT_TOKEN_TTL_SECS);
                log::debug!(
                    "🔐 Token refreshed, new expiration in {}s",
                    token_info.remaining_secs()
                );
                return Some(token_info.token.clone());
            }
        }
        None
    }

    /// Generate a new session token, revoking the old one
    pub fn rotate_token(&self) -> String {
        // Revoke old token
        self.revoke_current_token();

        // Generate and set new token
        let new_token = crate::api::auth::generate_session_token();
        self.set_session_token(new_token.clone());
        log::info!("🔐 Token rotated");
        new_token
    }

    /// Clean up expired tokens and auth rate limiter state
    pub fn cleanup_auth_state(&self) {
        // Clean up rate limiter
        self.auth_rate_limiter.cleanup();

        // Check if current token is expired and clear it
        let mut session = self.session_token.write();
        if let Some(ref token_info) = *session {
            if token_info.is_expired() {
                log::info!("🔐 Expired session token cleaned up");
                *session = None;
            }
        }

        // Limit the size of revoked tokens set (keep last 100)
        let mut revoked = self.revoked_tokens.write();
        if revoked.len() > 100 {
            // Just clear old revoked tokens since they're no longer useful
            // after the original token would have expired anyway
            revoked.clear();
            log::debug!("🔐 Cleared old revoked tokens cache");
        }
    }

    /// Check if a token is currently valid (not expired)
    pub fn is_token_valid(&self) -> bool {
        let guard = self.session_token.read();
        if let Some(ref token_info) = *guard {
            !token_info.is_expired()
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

    /// Get the current data directory
    pub fn get_data_directory(&self) -> PathBuf {
        self.data_directory.read().clone()
    }

    /// Update the data directory at runtime
    /// This is called when the user changes the data directory in the UI
    pub fn set_data_directory(&self, path: PathBuf) {
        log::info!("📂 Updating API data directory to: {:?}", path);
        *self.data_directory.write() = path;
    }

    /// Save analysis result to SQLite database
    pub fn save_to_disk(&self, result: &DDAResult) -> Result<(), String> {
        if let Some(ref db) = self.analysis_db {
            // Debug: Check if network_motifs are present in any variant
            if let Some(variants) = result.results.get("variants").and_then(|v| v.as_array()) {
                for (i, variant) in variants.iter().enumerate() {
                    let has_motifs = variant.get("network_motifs").is_some();
                    let variant_id = variant
                        .get("variant_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("?");
                    if has_motifs {
                        log::info!(
                            "📊 Saving variant {} ({}): has network_motifs",
                            i,
                            variant_id
                        );
                    }
                }
            }

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
                variant_name: result
                    .parameters
                    .variants
                    .first()
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

            log::info!("Saved analysis {} to SQLite database", result.id);
            Ok(())
        } else {
            log::warn!("Analysis database not available, skipping persistence");
            Ok(())
        }
    }

    /// Set the DDA binary path (should be called with Tauri-resolved path)
    pub fn set_dda_binary_path(&mut self, path: PathBuf) {
        log::info!("Setting DDA binary path to: {:?}", path);
        self.dda_binary_path = Some(path);
    }

    /// Start tracking a new DDA analysis
    pub fn start_analysis(&self, analysis_id: String) {
        // Reset cancellation state
        self.cancellation_token.reset();
        // Set current analysis ID
        *self.current_analysis_id.write() = Some(analysis_id.clone());
        log::info!("🚀 Started tracking analysis: {}", analysis_id);
    }

    /// Mark the current analysis as complete (remove tracking)
    pub fn complete_analysis(&self) {
        let analysis_id = self.current_analysis_id.write().take();
        if let Some(id) = analysis_id {
            log::info!("Analysis {} completed", id);
        }
    }

    /// Request cancellation of the current analysis
    pub fn cancel_current_analysis(&self) -> Option<String> {
        let analysis_id = self.current_analysis_id.read().clone();
        if let Some(ref id) = analysis_id {
            self.cancellation_token.cancel();
            self.cancelled_analyses.write().insert(id.clone());
            log::info!("🛑 Requested cancellation of analysis: {}", id);
        }
        analysis_id
    }

    /// Check if the current analysis has been cancelled
    pub fn is_analysis_cancelled(&self) -> bool {
        self.cancellation_token.is_cancelled()
    }

    /// Check if a specific analysis ID has been cancelled
    pub fn is_analysis_id_cancelled(&self, analysis_id: &str) -> bool {
        self.cancelled_analyses.read().contains(analysis_id)
    }

    /// Get the current running analysis ID
    pub fn get_current_analysis_id(&self) -> Option<String> {
        self.current_analysis_id.read().clone()
    }

    /// Initialize overview cache on startup
    /// This preloads metadata for complete caches into memory and logs incomplete caches
    pub fn initialize_overview_cache(&self) {
        if let Some(ref cache_db) = self.overview_cache_db {
            log::info!("🔄 Initializing overview cache...");

            match cache_db.get_incomplete_caches() {
                Ok(incomplete_caches) => {
                    if incomplete_caches.is_empty() {
                        log::info!("No incomplete overview caches found");
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
                    log::error!("Failed to check incomplete caches: {}", e);
                }
            }

            log::info!("Overview cache initialization complete");
        } else {
            log::info!("Overview cache database not available, skipping initialization");
        }
    }
}
