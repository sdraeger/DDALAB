use crate::types::{ConnectionInfo, UserId};
use chrono::Utc;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

/// In-memory registry of connected users
#[derive(Clone)]
pub struct UserRegistry {
    connections: Arc<RwLock<HashMap<UserId, ConnectionInfo>>>,
}

impl UserRegistry {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new user connection
    pub fn register(&self, user_id: UserId, endpoint: String) {
        let now = Utc::now();
        let info = ConnectionInfo {
            user_id: user_id.clone(),
            endpoint,
            connected_at: now,
            last_heartbeat: now,
        };

        self.connections.write().insert(user_id, info);
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

    /// Remove stale connections (no heartbeat in last N seconds)
    pub fn cleanup_stale(&self, timeout_seconds: i64) {
        let now = Utc::now();
        self.connections.write().retain(|_, conn| {
            (now - conn.last_heartbeat).num_seconds() < timeout_seconds
        });
    }
}

impl Default for UserRegistry {
    fn default() -> Self {
        Self::new()
    }
}
