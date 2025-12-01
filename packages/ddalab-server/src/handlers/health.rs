use axum::{extract::State, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::ServerState;

/// Health check response
#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub institution: String,
    pub connected_users: usize,
    pub uptime_seconds: u64,
}

/// Server info response
#[derive(Debug, Serialize, Deserialize)]
pub struct ServerInfoResponse {
    pub version: String,
    pub institution: String,
    pub features: ServerFeatures,
    pub encryption: String,
}

/// Server features
#[derive(Debug, Serialize, Deserialize)]
pub struct ServerFeatures {
    pub server_side_analysis: bool,
    pub sharing: bool,
    pub encryption: bool,
}

/// Health check endpoint
pub async fn health_check(
    State(state): State<Arc<ServerState>>,
) -> (StatusCode, Json<HealthResponse>) {
    let response = HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        institution: state.config.institution_name.clone(),
        connected_users: state.registry.connection_count(),
        uptime_seconds: state.uptime_seconds(),
    };

    (StatusCode::OK, Json(response))
}

/// Server info endpoint
pub async fn server_info(
    State(state): State<Arc<ServerState>>,
) -> Json<ServerInfoResponse> {
    Json(ServerInfoResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        institution: state.config.institution_name.clone(),
        features: ServerFeatures {
            server_side_analysis: state.config.enable_server_side_analysis,
            sharing: true,
            encryption: state.config.enable_encryption,
        },
        encryption: if state.config.enable_encryption {
            "aes256gcm".to_string()
        } else {
            "none".to_string()
        },
    })
}

/// Debug response for auth hash verification
#[derive(Debug, Serialize)]
pub struct DebugAuthResponse {
    pub auth_hash: String,
    pub auth_required: bool,
}

/// Debug endpoint to verify auth hash (for troubleshooting only)
pub async fn debug_auth_hash(
    State(state): State<Arc<ServerState>>,
) -> Json<DebugAuthResponse> {
    use crate::sync::hash_psk;
    Json(DebugAuthResponse {
        auth_hash: hash_psk(&state.config.broker_password),
        auth_required: state.config.require_auth,
    })
}
