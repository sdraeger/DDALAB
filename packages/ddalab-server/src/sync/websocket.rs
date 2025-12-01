use axum::{
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::auth::SessionManager;
use crate::sync::registry::UserRegistry;
use crate::sync::types::SyncMessage;
use crate::sync::verify_psk;
use crate::storage::{SharedResultStore, SharedResultInfo};

/// Shared application state for WebSocket handling
#[derive(Clone)]
pub struct SyncState {
    pub registry: UserRegistry,
    pub share_store: Arc<dyn SharedResultStore>,
    pub session_manager: SessionManager,
    pub institution: String,
    pub server_version: String,
    /// Password hash for legacy PSK authentication (fallback)
    pub password_hash: Option<String>,
    /// Whether authentication is required
    pub require_auth: bool,
}

/// Handle WebSocket upgrade
pub async fn handle_websocket(
    ws: WebSocketUpgrade,
    State(state): State<SyncState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: SyncState) {
    let (mut sender, mut receiver) = socket.split();
    let mut current_user_id: Option<String> = None;

    info!("New WebSocket connection established");

    while let Some(msg) = receiver.next().await {
        let msg = match msg {
            Ok(msg) => msg,
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                // Parse incoming message
                let sync_msg: SyncMessage = match serde_json::from_str(&text) {
                    Ok(msg) => msg,
                    Err(e) => {
                        error!("Failed to parse message: {}", e);
                        let error_msg = SyncMessage::Error {
                            message: format!("Invalid message format: {}", e),
                            code: "PARSE_ERROR".to_string(),
                        };
                        if let Ok(json) = serde_json::to_string(&error_msg) {
                            let _ = sender.send(Message::Text(json.into())).await;
                        }
                        continue;
                    }
                };

                // Handle the message
                let response = handle_sync_message(sync_msg, &state, &mut current_user_id).await;

                // Send response if any
                if let Some(resp) = response {
                    match serde_json::to_string(&resp) {
                        Ok(json) => {
                            if let Err(e) = sender.send(Message::Text(json.into())).await {
                                error!("Failed to send response: {}", e);
                                break;
                            }
                        }
                        Err(e) => {
                            error!("Failed to serialize response: {}", e);
                        }
                    }
                }
            }
            Message::Close(_) => {
                info!("WebSocket connection closed by client");
                break;
            }
            Message::Ping(data) => {
                if let Err(e) = sender.send(Message::Pong(data)).await {
                    error!("Failed to send pong: {}", e);
                    break;
                }
            }
            _ => {}
        }
    }

    // Clean up user registration on disconnect
    if let Some(user_id) = current_user_id {
        state.registry.disconnect(&user_id);
        info!("User {} disconnected", user_id);
    }

    info!("WebSocket connection terminated");
}

/// Handle a sync message and return optional response
async fn handle_sync_message(
    msg: SyncMessage,
    state: &SyncState,
    current_user_id: &mut Option<String>,
) -> Option<SyncMessage> {
    match msg {
        SyncMessage::RegisterUser { user_id, endpoint, password, session_token } => {
            info!("Registering user: {} at {}", user_id, endpoint);

            // Verify authentication if required
            if state.require_auth {
                let is_valid = if let Some(ref token) = session_token {
                    // Prefer session token validation (from HTTP login)
                    if let Some((_, validated_user_id)) = state.session_manager.validate_token(token) {
                        // Token is valid, verify user_id matches
                        if validated_user_id == user_id {
                            info!("Session token validated for user: {}", user_id);
                            true
                        } else {
                            warn!("Session token user mismatch: token={}, claimed={}", validated_user_id, user_id);
                            false
                        }
                    } else {
                        warn!("Invalid or expired session token for user: {}", user_id);
                        false
                    }
                } else if let Some(ref expected_hash) = state.password_hash {
                    // Fallback to legacy PSK authentication
                    password
                        .as_ref()
                        .map(|p| verify_psk(p, expected_hash))
                        .unwrap_or(false)
                } else {
                    // No password hash configured but auth required - this shouldn't happen
                    warn!("Auth required but no password hash configured");
                    false
                };

                if !is_valid {
                    warn!("Authentication failed for user: {}", user_id);
                    return Some(SyncMessage::Error {
                        message: "Invalid credentials".to_string(),
                        code: "AUTH_FAILED".to_string(),
                    });
                }
            }

            // Generate session ID and attempt registration
            let session_id = Uuid::new_v4();

            use crate::sync::RegistrationResult;
            match state.registry.register(user_id.clone(), session_id, endpoint) {
                RegistrationResult::Ok | RegistrationResult::Replaced => {
                    *current_user_id = Some(user_id.clone());
                    Some(SyncMessage::Connected {
                        server_version: state.server_version.clone(),
                        institution: state.institution.clone(),
                        user_id,
                    })
                }
                RegistrationResult::AtCapacity => {
                    warn!("Server at capacity, rejecting user: {}", user_id);
                    Some(SyncMessage::Error {
                        message: "Server at capacity".to_string(),
                        code: "SERVER_FULL".to_string(),
                    })
                }
            }
        }

        SyncMessage::Heartbeat { user_id } => {
            if state.registry.heartbeat(&user_id) {
                Some(SyncMessage::Ack { message_id: None })
            } else {
                warn!("Heartbeat from unregistered user: {}", user_id);
                Some(SyncMessage::Error {
                    message: "User not registered".to_string(),
                    code: "USER_NOT_FOUND".to_string(),
                })
            }
        }

        SyncMessage::Disconnect { user_id } => {
            info!("User disconnecting: {}", user_id);
            state.registry.disconnect(&user_id);
            *current_user_id = None;
            Some(SyncMessage::Ack { message_id: None })
        }

        SyncMessage::PublishShare { token, metadata } => {
            // Require authentication before allowing publish
            if current_user_id.is_none() {
                warn!("Unauthenticated publish attempt for share: {}", token);
                return Some(SyncMessage::Error {
                    message: "Authentication required".to_string(),
                    code: "AUTH_REQUIRED".to_string(),
                });
            }

            // Verify the user is publishing their own share
            if current_user_id.as_ref() != Some(&metadata.owner_user_id) {
                warn!(
                    "User {} attempted to publish share owned by {}",
                    current_user_id.as_deref().unwrap_or("unknown"),
                    metadata.owner_user_id
                );
                return Some(SyncMessage::Error {
                    message: "Cannot publish share for another user".to_string(),
                    code: "FORBIDDEN".to_string(),
                });
            }

            info!(
                "Publishing share: {} by user {}",
                token, metadata.owner_user_id
            );
            match state.share_store.publish_result(&token, metadata).await {
                Ok(_) => Some(SyncMessage::Ack { message_id: None }),
                Err(e) => {
                    error!("Failed to publish share: {}", e);
                    Some(SyncMessage::Error {
                        message: e.to_string(),
                        code: "PUBLISH_ERROR".to_string(),
                    })
                }
            }
        }

        SyncMessage::RequestShare {
            token,
            requester_id,
        } => {
            info!("User {} requesting share: {}", requester_id, token);

            // Get share metadata
            let metadata = match state.share_store.get_shared_result(&token).await {
                Ok(meta) => meta,
                Err(e) => {
                    return Some(SyncMessage::Error {
                        message: e.to_string(),
                        code: "SHARE_NOT_FOUND".to_string(),
                    });
                }
            };

            // Check access
            match state.share_store.check_access(&token, &requester_id).await {
                Ok(has_access) if !has_access => {
                    return Some(SyncMessage::Error {
                        message: "Access denied".to_string(),
                        code: "ACCESS_DENIED".to_string(),
                    });
                }
                Err(e) => {
                    return Some(SyncMessage::Error {
                        message: e.to_string(),
                        code: "ACCESS_CHECK_ERROR".to_string(),
                    });
                }
                _ => {}
            }

            // Get owner connection info
            let owner_online = state.registry.is_online(&metadata.owner_user_id);
            let download_url = if owner_online {
                state
                    .registry
                    .get_connection(&metadata.owner_user_id)
                    .map(|conn| format!("{}/api/results/{}", conn.endpoint, metadata.result_id))
                    .unwrap_or_default()
            } else {
                String::new()
            };

            Some(SyncMessage::ShareInfo {
                info: SharedResultInfo {
                    metadata,
                    download_url,
                    owner_online,
                },
            })
        }

        SyncMessage::RevokeShare { token } => {
            info!("Revoking share: {}", token);
            match state.share_store.revoke_share(&token).await {
                Ok(_) => Some(SyncMessage::Ack { message_id: None }),
                Err(e) => {
                    error!("Failed to revoke share: {}", e);
                    Some(SyncMessage::Error {
                        message: e.to_string(),
                        code: "REVOKE_ERROR".to_string(),
                    })
                }
            }
        }

        SyncMessage::ListMyShares { user_id } => {
            info!("Listing shares for user: {}", user_id);
            match state.share_store.list_user_shares(&user_id).await {
                Ok(shares) => Some(SyncMessage::ShareList { shares }),
                Err(e) => {
                    error!("Failed to list shares: {}", e);
                    Some(SyncMessage::Error {
                        message: e.to_string(),
                        code: "LIST_ERROR".to_string(),
                    })
                }
            }
        }

        SyncMessage::BackupState { user_id, state_hash } => {
            warn!("Backup not yet implemented: user={}, hash={}", user_id, state_hash);
            Some(SyncMessage::Error {
                message: "Backup feature not yet implemented".to_string(),
                code: "NOT_IMPLEMENTED".to_string(),
            })
        }

        SyncMessage::RestoreState { user_id } => {
            warn!("Restore not yet implemented: user={}", user_id);
            Some(SyncMessage::Error {
                message: "Restore feature not yet implemented".to_string(),
                code: "NOT_IMPLEMENTED".to_string(),
            })
        }

        // These are responses, not requests
        SyncMessage::Ack { .. }
        | SyncMessage::Error { .. }
        | SyncMessage::ShareInfo { .. }
        | SyncMessage::ShareList { .. }
        | SyncMessage::Connected { .. } => {
            warn!("Received response message as request, ignoring");
            None
        }
    }
}
