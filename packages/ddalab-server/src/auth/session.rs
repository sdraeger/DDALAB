use chrono::{Duration, Utc};
use parking_lot::RwLock;
use rand::RngCore;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Arc;
use uuid::Uuid;

use crate::crypto::EncryptionKey;
use crate::storage::{UserId, UserSession};

/// Generate a secure random session token (64 hex characters)
pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// In-memory session manager for active sessions
pub struct SessionManager {
    /// Active sessions indexed by session token
    sessions: Arc<RwLock<HashMap<String, ActiveSession>>>,
    /// Session timeout in seconds
    timeout_seconds: u64,
}

/// Active session with encryption key
pub struct ActiveSession {
    pub session_id: Uuid,
    pub user_id: UserId,
    pub token: String,
    pub encryption_key: Option<EncryptionKey>,
    pub created_at: chrono::DateTime<Utc>,
    pub expires_at: chrono::DateTime<Utc>,
}

impl SessionManager {
    pub fn new(timeout_seconds: u64) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            timeout_seconds,
        }
    }

    /// Create a new session
    pub fn create_session(&self, user_id: UserId, encryption_key: Option<EncryptionKey>) -> (String, UserSession) {
        let session_id = Uuid::new_v4();
        let token = generate_session_token();
        let now = Utc::now();
        let expires_at = now + Duration::seconds(self.timeout_seconds as i64);

        let active_session = ActiveSession {
            session_id,
            user_id: user_id.clone(),
            token: token.clone(),
            encryption_key,
            created_at: now,
            expires_at,
        };

        let user_session = UserSession {
            session_id,
            user_id: user_id.clone(),
            endpoint: String::new(),
            encryption_key_id: None,
            created_at: now,
            last_heartbeat: now,
            expires_at,
        };

        self.sessions.write().insert(token.clone(), active_session);

        (token, user_session)
    }

    /// Validate a session token and return the session if valid
    pub fn validate_token(&self, token: &str) -> Option<(Uuid, UserId)> {
        let sessions = self.sessions.read();
        sessions.get(token).and_then(|session| {
            if Utc::now() < session.expires_at {
                Some((session.session_id, session.user_id.clone()))
            } else {
                None
            }
        })
    }

    /// Get encryption key for a session
    pub fn get_encryption_key(&self, token: &str) -> Option<EncryptionKey> {
        let sessions = self.sessions.read();
        sessions.get(token).and_then(|session| {
            if Utc::now() < session.expires_at {
                session.encryption_key.clone()
            } else {
                None
            }
        })
    }

    /// Set encryption key for a session
    pub fn set_encryption_key(&self, token: &str, key: EncryptionKey) -> bool {
        let mut sessions = self.sessions.write();
        if let Some(session) = sessions.get_mut(token) {
            session.encryption_key = Some(key);
            true
        } else {
            false
        }
    }

    /// Revoke a session
    pub fn revoke_session(&self, token: &str) {
        self.sessions.write().remove(token);
    }

    /// Revoke all sessions for a user
    pub fn revoke_user_sessions(&self, user_id: &UserId) {
        self.sessions.write().retain(|_, session| session.user_id != *user_id);
    }

    /// Clean up expired sessions
    pub fn cleanup_expired(&self) -> usize {
        let now = Utc::now();
        let mut sessions = self.sessions.write();
        let before = sessions.len();
        sessions.retain(|_, session| session.expires_at > now);
        before - sessions.len()
    }

    /// Get session count
    pub fn session_count(&self) -> usize {
        self.sessions.read().len()
    }
}

impl Clone for SessionManager {
    fn clone(&self) -> Self {
        Self {
            sessions: Arc::clone(&self.sessions),
            timeout_seconds: self.timeout_seconds,
        }
    }
}

/// Rate limiter for authentication attempts
/// Uses a sliding window algorithm to track failed attempts per IP
pub struct AuthRateLimiter {
    /// Failed attempts: IP -> list of attempt timestamps
    attempts: Arc<RwLock<HashMap<IpAddr, Vec<chrono::DateTime<Utc>>>>>,
    /// Maximum failed attempts in the window
    max_attempts: u32,
    /// Window duration in seconds
    window_seconds: i64,
}

impl AuthRateLimiter {
    pub fn new(max_attempts: u32, window_seconds: i64) -> Self {
        Self {
            attempts: Arc::new(RwLock::new(HashMap::new())),
            max_attempts,
            window_seconds,
        }
    }

    /// Record a failed authentication attempt
    /// Returns true if the IP is now rate limited
    pub fn record_failure(&self, ip: IpAddr) -> bool {
        let now = Utc::now();
        let window_start = now - Duration::seconds(self.window_seconds);

        let mut attempts = self.attempts.write();
        let ip_attempts = attempts.entry(ip).or_insert_with(Vec::new);

        // Remove old attempts outside the window
        ip_attempts.retain(|ts| *ts > window_start);

        // Add new attempt
        ip_attempts.push(now);

        // Check if rate limited
        ip_attempts.len() as u32 >= self.max_attempts
    }

    /// Check if an IP is currently rate limited
    pub fn is_rate_limited(&self, ip: IpAddr) -> bool {
        let now = Utc::now();
        let window_start = now - Duration::seconds(self.window_seconds);

        let attempts = self.attempts.read();
        if let Some(ip_attempts) = attempts.get(&ip) {
            let recent_count = ip_attempts.iter().filter(|ts| **ts > window_start).count();
            recent_count as u32 >= self.max_attempts
        } else {
            false
        }
    }

    /// Clear rate limit for an IP (call on successful auth)
    pub fn clear(&self, ip: IpAddr) {
        self.attempts.write().remove(&ip);
    }

    /// Cleanup old entries (call periodically)
    pub fn cleanup(&self) -> usize {
        let now = Utc::now();
        let window_start = now - Duration::seconds(self.window_seconds);

        let mut attempts = self.attempts.write();
        let before = attempts.len();

        // Remove IPs with no recent attempts
        attempts.retain(|_, ip_attempts| {
            ip_attempts.retain(|ts| *ts > window_start);
            !ip_attempts.is_empty()
        });

        before - attempts.len()
    }
}

impl Clone for AuthRateLimiter {
    fn clone(&self) -> Self {
        Self {
            attempts: Arc::clone(&self.attempts),
            max_attempts: self.max_attempts,
            window_seconds: self.window_seconds,
        }
    }
}

impl Default for AuthRateLimiter {
    fn default() -> Self {
        // Default: 10 failed attempts per minute
        Self::new(10, 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_validate_session() {
        let manager = SessionManager::new(3600);
        let user_id = "test_user".to_string();

        let (token, session) = manager.create_session(user_id.clone(), None);

        assert!(!token.is_empty());
        assert_eq!(session.user_id, user_id);

        // Token should be valid
        let validated = manager.validate_token(&token);
        assert!(validated.is_some());
        let (_, validated_user) = validated.unwrap();
        assert_eq!(validated_user, user_id);

        // Invalid token should not validate
        assert!(manager.validate_token("invalid_token").is_none());
    }

    #[test]
    fn test_revoke_session() {
        let manager = SessionManager::new(3600);
        let (token, _) = manager.create_session("user".to_string(), None);

        assert!(manager.validate_token(&token).is_some());

        manager.revoke_session(&token);

        assert!(manager.validate_token(&token).is_none());
    }

    #[test]
    fn test_encryption_key() {
        let manager = SessionManager::new(3600);
        let (token, _) = manager.create_session("user".to_string(), None);

        // Initially no encryption key
        assert!(manager.get_encryption_key(&token).is_none());

        // Set encryption key
        let key = EncryptionKey::random();
        assert!(manager.set_encryption_key(&token, key.clone()));

        // Should be able to retrieve it
        let retrieved = manager.get_encryption_key(&token);
        assert!(retrieved.is_some());
    }

    #[test]
    fn test_session_token_format() {
        let token = generate_session_token();

        // Should be 64 hex characters (32 bytes)
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_rate_limiter_basic() {
        let limiter = AuthRateLimiter::new(3, 60); // 3 attempts per 60 seconds
        let ip: IpAddr = "192.168.1.1".parse().unwrap();

        // First two attempts should not be rate limited
        assert!(!limiter.is_rate_limited(ip));
        assert!(!limiter.record_failure(ip));
        assert!(!limiter.record_failure(ip));

        // Third attempt triggers rate limit
        assert!(limiter.record_failure(ip));
        assert!(limiter.is_rate_limited(ip));
    }

    #[test]
    fn test_rate_limiter_clear() {
        let limiter = AuthRateLimiter::new(2, 60);
        let ip: IpAddr = "192.168.1.2".parse().unwrap();

        limiter.record_failure(ip);
        limiter.record_failure(ip);
        assert!(limiter.is_rate_limited(ip));

        // Clear should reset
        limiter.clear(ip);
        assert!(!limiter.is_rate_limited(ip));
    }

    #[test]
    fn test_rate_limiter_different_ips() {
        let limiter = AuthRateLimiter::new(2, 60);
        let ip1: IpAddr = "192.168.1.1".parse().unwrap();
        let ip2: IpAddr = "192.168.1.2".parse().unwrap();

        // Rate limit IP1
        limiter.record_failure(ip1);
        limiter.record_failure(ip1);
        assert!(limiter.is_rate_limited(ip1));

        // IP2 should not be affected
        assert!(!limiter.is_rate_limited(ip2));
    }
}
