use chrono::Utc;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

use crate::storage::{ConnectionInfo, UserId};

/// Default maximum connections to prevent DoS
const DEFAULT_MAX_CONNECTIONS: usize = 10_000;

/// Registration result
#[derive(Debug, Clone, PartialEq)]
pub enum RegistrationResult {
    /// Successfully registered
    Ok,
    /// Registration replaced existing connection
    Replaced,
    /// Server at capacity, registration rejected
    AtCapacity,
}

/// In-memory registry of connected users
#[derive(Clone)]
pub struct UserRegistry {
    connections: Arc<RwLock<HashMap<UserId, ConnectionInfo>>>,
    max_connections: usize,
}

impl UserRegistry {
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_MAX_CONNECTIONS)
    }

    /// Create registry with custom max connections
    pub fn with_capacity(max_connections: usize) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            max_connections,
        }
    }

    /// Register a new user connection
    /// Returns RegistrationResult indicating success or failure
    pub fn register(&self, user_id: UserId, session_id: Uuid, endpoint: String) -> RegistrationResult {
        let now = Utc::now();
        let info = ConnectionInfo {
            user_id: user_id.clone(),
            session_id,
            endpoint,
            connected_at: now,
            last_heartbeat: now,
        };

        let mut connections = self.connections.write();

        // Check if replacing existing connection
        if connections.contains_key(&user_id) {
            connections.insert(user_id, info);
            return RegistrationResult::Replaced;
        }

        // Check capacity before inserting new connection
        if connections.len() >= self.max_connections {
            return RegistrationResult::AtCapacity;
        }

        connections.insert(user_id, info);
        RegistrationResult::Ok
    }

    /// Update heartbeat timestamp
    pub fn heartbeat(&self, user_id: &UserId) -> bool {
        if let Some(conn) = self.connections.write().get_mut(user_id) {
            conn.last_heartbeat = Utc::now();
            true
        } else {
            false
        }
    }

    /// Disconnect a user
    pub fn disconnect(&self, user_id: &UserId) {
        self.connections.write().remove(user_id);
    }

    /// Check if a user is online
    pub fn is_online(&self, user_id: &UserId) -> bool {
        self.connections.read().contains_key(user_id)
    }

    /// Get connection info for a user
    pub fn get_connection(&self, user_id: &UserId) -> Option<ConnectionInfo> {
        self.connections.read().get(user_id).cloned()
    }

    /// Get all connected users
    pub fn get_all_connections(&self) -> Vec<ConnectionInfo> {
        self.connections.read().values().cloned().collect()
    }

    /// Get the count of connected users
    pub fn connection_count(&self) -> usize {
        self.connections.read().len()
    }

    /// Remove stale connections (no heartbeat in last N seconds)
    pub fn cleanup_stale(&self, timeout_seconds: i64) -> usize {
        let now = Utc::now();
        let mut removed = 0;
        self.connections.write().retain(|_, conn| {
            let is_stale = (now - conn.last_heartbeat).num_seconds() >= timeout_seconds;
            if is_stale {
                removed += 1;
            }
            !is_stale
        });
        removed
    }
}

impl Default for UserRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_register_and_lookup() {
        let registry = UserRegistry::new();
        let user_id = "test_user".to_string();
        let session_id = Uuid::new_v4();

        registry.register(user_id.clone(), session_id, "http://localhost:8765".to_string());

        assert!(registry.is_online(&user_id));
        assert!(!registry.is_online(&"other_user".to_string()));

        let conn = registry.get_connection(&user_id).unwrap();
        assert_eq!(conn.user_id, user_id);
        assert_eq!(conn.session_id, session_id);
    }

    #[test]
    fn test_heartbeat() {
        let registry = UserRegistry::new();
        let user_id = "test_user".to_string();

        // Heartbeat for non-existent user should fail
        assert!(!registry.heartbeat(&user_id));

        // Register and heartbeat
        registry.register(user_id.clone(), Uuid::new_v4(), "http://localhost:8765".to_string());
        assert!(registry.heartbeat(&user_id));
    }

    #[test]
    fn test_disconnect() {
        let registry = UserRegistry::new();
        let user_id = "test_user".to_string();

        registry.register(user_id.clone(), Uuid::new_v4(), "http://localhost:8765".to_string());
        assert!(registry.is_online(&user_id));

        registry.disconnect(&user_id);
        assert!(!registry.is_online(&user_id));
    }

    #[test]
    fn test_connection_count() {
        let registry = UserRegistry::new();

        registry.register("user1".to_string(), Uuid::new_v4(), "http://localhost:8765".to_string());
        registry.register("user2".to_string(), Uuid::new_v4(), "http://localhost:8766".to_string());

        assert_eq!(registry.connection_count(), 2);

        registry.disconnect(&"user1".to_string());
        assert_eq!(registry.connection_count(), 1);
    }
}
