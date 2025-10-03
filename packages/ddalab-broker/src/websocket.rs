use crate::registry::UserRegistry;
use crate::traits::SharedResultStore;
use crate::types::{SharedResultInfo, SyncMessage};
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

/// Shared application state
#[derive(Clone)]
pub struct BrokerState {
    pub registry: UserRegistry,
    pub share_store: Arc<dyn SharedResultStore>,
}

/// Handle WebSocket upgrade
pub async fn handle_websocket(
    ws: WebSocketUpgrade,
    State(state): State<BrokerState>,
) -> Response {
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: BrokerState) {
    let (mut sender, mut receiver) = socket.split();

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
                let response = handle_sync_message(sync_msg, &state).await;

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

    info!("WebSocket connection terminated");
}

/// Handle a sync message and return optional response
async fn handle_sync_message(
    msg: SyncMessage,
    state: &BrokerState,
) -> Option<SyncMessage> {
    match msg {
        SyncMessage::RegisterUser { user_id, endpoint } => {
            info!("Registering user: {} at {}", user_id, endpoint);
            state.registry.register(user_id, endpoint);
            Some(SyncMessage::Ack { message_id: None })
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
            Some(SyncMessage::Ack { message_id: None })
        }

        SyncMessage::PublishShare { token, metadata } => {
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
            match state
                .share_store
                .check_access(&token, &requester_id)
                .await
            {
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

        SyncMessage::BackupState { user_id, state_hash } => {
            // Backup handling would go here - requires BackupStore
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
        SyncMessage::Ack { .. } | SyncMessage::Error { .. } | SyncMessage::ShareInfo { .. } => {
            warn!("Received response message as request, ignoring");
            None
        }
    }
}
