use crate::api::state::ApiState;
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use base64::Engine;
use parking_lot::Mutex;
use rand::Rng;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Default token time-to-live: 1 hour
pub const DEFAULT_TOKEN_TTL_SECS: u64 = 3600;

/// Maximum failed authentication attempts before lockout
const MAX_FAILED_ATTEMPTS: u32 = 5;

/// Lockout duration after exceeding max failed attempts (15 minutes)
const LOCKOUT_DURATION_SECS: u64 = 900;

/// Window for tracking failed attempts (5 minutes)
const FAILED_ATTEMPT_WINDOW_SECS: u64 = 300;

/// Token information with expiration tracking
#[derive(Debug, Clone)]
pub struct TokenInfo {
    /// The actual token string
    pub token: String,
    /// When the token was created
    pub created_at: Instant,
    /// When the token expires
    pub expires_at: Instant,
}

impl TokenInfo {
    /// Create a new token with the specified TTL
    pub fn new(token: String, ttl_secs: u64) -> Self {
        let now = Instant::now();
        Self {
            token,
            created_at: now,
            expires_at: now + Duration::from_secs(ttl_secs),
        }
    }

    /// Create a new token with the default TTL (1 hour)
    pub fn with_default_ttl(token: String) -> Self {
        Self::new(token, DEFAULT_TOKEN_TTL_SECS)
    }

    /// Check if the token has expired
    pub fn is_expired(&self) -> bool {
        Instant::now() >= self.expires_at
    }

    /// Get remaining time until expiration in seconds
    pub fn remaining_secs(&self) -> u64 {
        let now = Instant::now();
        if now >= self.expires_at {
            0
        } else {
            (self.expires_at - now).as_secs()
        }
    }

    /// Extend the token's expiration by the given duration
    pub fn extend(&mut self, duration_secs: u64) {
        self.expires_at = Instant::now() + Duration::from_secs(duration_secs);
    }
}

/// Rate limiter for authentication attempts (prevents brute force attacks)
#[derive(Debug)]
pub struct AuthRateLimiter {
    /// Track failed attempts per source (IP or identifier)
    failed_attempts: Mutex<HashMap<String, Vec<Instant>>>,
    /// Track lockouts
    lockouts: Mutex<HashMap<String, Instant>>,
}

impl AuthRateLimiter {
    pub fn new() -> Self {
        Self {
            failed_attempts: Mutex::new(HashMap::new()),
            lockouts: Mutex::new(HashMap::new()),
        }
    }

    /// Check if a source is currently locked out
    pub fn is_locked_out(&self, source: &str) -> bool {
        let lockouts = self.lockouts.lock();
        if let Some(lockout_until) = lockouts.get(source) {
            if Instant::now() < *lockout_until {
                return true;
            }
        }
        false
    }

    /// Record a failed authentication attempt
    /// Returns true if the source is now locked out
    pub fn record_failed_attempt(&self, source: &str) -> bool {
        let now = Instant::now();
        let window_start = now - Duration::from_secs(FAILED_ATTEMPT_WINDOW_SECS);

        let mut attempts = self.failed_attempts.lock();
        let source_attempts = attempts.entry(source.to_string()).or_insert_with(Vec::new);

        // Remove attempts outside the window
        source_attempts.retain(|t| *t > window_start);

        // Add the new attempt
        source_attempts.push(now);

        // Check if we've exceeded the limit
        if source_attempts.len() >= MAX_FAILED_ATTEMPTS as usize {
            // Lock out the source
            let mut lockouts = self.lockouts.lock();
            let lockout_until = now + Duration::from_secs(LOCKOUT_DURATION_SECS);
            lockouts.insert(source.to_string(), lockout_until);
            log::warn!(
                "🔒 Source {} locked out for {} seconds due to {} failed attempts",
                source,
                LOCKOUT_DURATION_SECS,
                source_attempts.len()
            );
            return true;
        }

        false
    }

    /// Record a successful authentication (clears failed attempts)
    pub fn record_success(&self, source: &str) {
        self.failed_attempts.lock().remove(source);
        self.lockouts.lock().remove(source);
    }

    /// Clean up expired lockouts and old attempt records
    pub fn cleanup(&self) {
        let now = Instant::now();
        let window_start = now - Duration::from_secs(FAILED_ATTEMPT_WINDOW_SECS);

        // Clean up expired lockouts
        self.lockouts
            .lock()
            .retain(|_, lockout_until| now < *lockout_until);

        // Clean up old attempt records
        let mut attempts = self.failed_attempts.lock();
        for (_, source_attempts) in attempts.iter_mut() {
            source_attempts.retain(|t| *t > window_start);
        }
        attempts.retain(|_, v| !v.is_empty());
    }

    /// Get the number of failed attempts for a source
    pub fn get_failed_attempts(&self, source: &str) -> usize {
        let now = Instant::now();
        let window_start = now - Duration::from_secs(FAILED_ATTEMPT_WINDOW_SECS);

        let attempts = self.failed_attempts.lock();
        if let Some(source_attempts) = attempts.get(source) {
            source_attempts
                .iter()
                .filter(|t| **t > window_start)
                .count()
        } else {
            0
        }
    }

    /// Get seconds until lockout expires (0 if not locked out)
    pub fn lockout_remaining_secs(&self, source: &str) -> u64 {
        let now = Instant::now();
        let lockouts = self.lockouts.lock();
        if let Some(lockout_until) = lockouts.get(source) {
            if now < *lockout_until {
                return (*lockout_until - now).as_secs();
            }
        }
        0
    }
}

impl Default for AuthRateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate a random session token
pub fn generate_session_token() -> String {
    let mut rng = rand::rng();
    let bytes: [u8; 32] = rng.random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Constant-time comparison to prevent timing attacks
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Authentication middleware for protected routes
pub async fn auth_middleware(
    State(state): State<Arc<ApiState>>,
    headers: HeaderMap,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Skip auth if not required
    if !state.requires_auth() {
        return Ok(next.run(request).await);
    }

    // Use a source identifier for rate limiting
    // In a real network scenario, this would be the client IP
    // For local desktop app, we use a fixed identifier
    let source = "local_client";

    // Check if source is locked out due to too many failed attempts
    if state.auth_rate_limiter.is_locked_out(source) {
        let remaining = state.auth_rate_limiter.lockout_remaining_secs(source);
        log::warn!(
            "🔒 Authentication blocked: source {} is locked out for {} more seconds",
            source,
            remaining
        );
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // Extract Authorization header
    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            state.auth_rate_limiter.record_failed_attempt(source);
            StatusCode::UNAUTHORIZED
        })?;

    // Check for Bearer token
    if !auth_header.starts_with("Bearer ") {
        log::warn!("Invalid Authorization header format");
        state.auth_rate_limiter.record_failed_attempt(source);
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_header[7..]; // Skip "Bearer "

    // Verify token (includes expiration check)
    match state.verify_session_token(token) {
        TokenVerifyResult::Valid => {
            state.auth_rate_limiter.record_success(source);
            log::debug!("Token verified successfully");
            Ok(next.run(request).await)
        }
        TokenVerifyResult::Expired => {
            log::warn!("🔒 Authentication failed: token has expired");
            // Don't count expired tokens as failed attempts (user needs to refresh)
            Err(StatusCode::UNAUTHORIZED)
        }
        TokenVerifyResult::Invalid => {
            log::warn!("🔒 Authentication failed: invalid session token");
            state.auth_rate_limiter.record_failed_attempt(source);
            Err(StatusCode::FORBIDDEN)
        }
        TokenVerifyResult::Revoked => {
            log::warn!("🔒 Authentication failed: token has been revoked");
            Err(StatusCode::FORBIDDEN)
        }
        TokenVerifyResult::NoToken => {
            log::warn!("🔒 Authentication failed: no session token configured");
            state.auth_rate_limiter.record_failed_attempt(source);
            Err(StatusCode::FORBIDDEN)
        }
    }
}

/// Result of token verification
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenVerifyResult {
    /// Token is valid and not expired
    Valid,
    /// Token was valid but has expired
    Expired,
    /// Token does not match
    Invalid,
    /// Token has been revoked
    Revoked,
    /// No token is configured on the server
    NoToken,
}
