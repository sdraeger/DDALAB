use super::types::{AccessPolicy, ShareMetadata, SharedResultInfo, SyncMessage};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use tracing::{debug, error, info, warn};

type WsStream = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Pending requests waiting for broker responses
type PendingRequests = Arc<RwLock<HashMap<String, oneshot::Sender<SharedResultInfo>>>>;

/// Sync client for connecting to institutional broker
pub struct SyncClient {
    user_id: String,
    local_endpoint: String,
    broker_url: String,
    ws_tx: mpsc::UnboundedSender<SyncMessage>,
    pending_requests: PendingRequests,
}

impl SyncClient {
    /// Connect to the sync broker
    pub async fn connect(
        broker_url: String,
        user_id: String,
        local_endpoint: String,
    ) -> Result<Self> {
        info!("Connecting to sync broker at {}", broker_url);

        // Connect to WebSocket
        let (ws_stream, _) = connect_async(&broker_url)
            .await
            .map_err(|e| anyhow!("Failed to connect to broker: {}", e))?;

        // Split into sender and receiver
        let (write, read) = ws_stream.split();

        // Create channels
        let (ws_tx, ws_rx) = mpsc::unbounded_channel::<SyncMessage>();
        let pending_requests: PendingRequests = Arc::new(RwLock::new(HashMap::new()));

        // Spawn WebSocket writer task
        tokio::spawn(write_task(write, ws_rx));

        // Spawn WebSocket reader task
        tokio::spawn(read_task(read, pending_requests.clone()));

        // Register with broker
        let register_msg = SyncMessage::RegisterUser {
            user_id: user_id.clone(),
            endpoint: local_endpoint.clone(),
        };

        ws_tx.send(register_msg)?;

        let client = Self {
            user_id: user_id.clone(),
            local_endpoint,
            broker_url,
            ws_tx,
            pending_requests,
        };

        // Start heartbeat
        client.start_heartbeat();

        info!("Successfully connected to sync broker");

        Ok(client)
    }

    /// Start periodic heartbeat
    fn start_heartbeat(&self) {
        let user_id = self.user_id.clone();
        let ws_tx = self.ws_tx.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
            loop {
                interval.tick().await;

                let heartbeat = SyncMessage::Heartbeat {
                    user_id: user_id.clone(),
                };

                if let Err(e) = ws_tx.send(heartbeat) {
                    error!("Failed to send heartbeat: {}", e);
                    break;
                }

                debug!("Sent heartbeat to broker");
            }
        });
    }

    /// Share a result with others
    pub async fn share_result(
        &self,
        result_id: &str,
        title: &str,
        description: Option<String>,
        access_policy: AccessPolicy,
    ) -> Result<String> {
        // Generate share token
        let token = generate_share_token();

        let metadata = ShareMetadata {
            owner_user_id: self.user_id.clone(),
            result_id: result_id.to_string(),
            title: title.to_string(),
            description,
            created_at: Utc::now(),
            access_policy,
        };

        let publish_msg = SyncMessage::PublishShare {
            token: token.clone(),
            metadata,
        };

        self.ws_tx.send(publish_msg)?;

        info!("Published share: {}", token);

        // Return shareable link
        Ok(format!("ddalab://share/{}", token))
    }

    /// Access a shared result
    pub async fn access_share(&self, token: &str) -> Result<SharedResultInfo> {
        // Create oneshot channel for response
        let (tx, rx) = oneshot::channel();

        // Register pending request
        self.pending_requests.write().insert(token.to_string(), tx);

        // Request share info from broker
        let request_msg = SyncMessage::RequestShare {
            token: token.to_string(),
            requester_id: self.user_id.clone(),
        };

        self.ws_tx.send(request_msg)?;

        // Wait for response with timeout
        let share_info = tokio::time::timeout(std::time::Duration::from_secs(10), rx)
            .await
            .map_err(|_| anyhow!("Timeout waiting for share info"))?
            .map_err(|_| anyhow!("Failed to receive share info"))?;

        Ok(share_info)
    }

    /// Revoke a previously shared result
    pub async fn revoke_share(&self, token: &str) -> Result<()> {
        let revoke_msg = SyncMessage::RevokeShare {
            token: token.to_string(),
        };

        self.ws_tx.send(revoke_msg)?;

        info!("Revoked share: {}", token);

        Ok(())
    }

    /// Disconnect from broker
    pub async fn disconnect(&self) -> Result<()> {
        let disconnect_msg = SyncMessage::Disconnect {
            user_id: self.user_id.clone(),
        };

        self.ws_tx.send(disconnect_msg)?;

        info!("Disconnected from sync broker");

        Ok(())
    }

    /// Get user ID
    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    /// Get local endpoint
    pub fn local_endpoint(&self) -> &str {
        &self.local_endpoint
    }
}

/// WebSocket write task
async fn write_task(
    mut write: futures_util::stream::SplitSink<WsStream, Message>,
    mut rx: mpsc::UnboundedReceiver<SyncMessage>,
) {
    while let Some(msg) = rx.recv().await {
        let json = match serde_json::to_string(&msg) {
            Ok(j) => j,
            Err(e) => {
                error!("Failed to serialize message: {}", e);
                continue;
            }
        };

        if let Err(e) = write.send(Message::Text(json.into())).await {
            error!("Failed to send WebSocket message: {}", e);
            break;
        }
    }

    debug!("WebSocket write task ended");
}

/// WebSocket read task
async fn read_task(
    mut read: futures_util::stream::SplitStream<WsStream>,
    pending_requests: PendingRequests,
) {
    while let Some(msg) = read.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
        };

        if let Message::Text(text) = msg {
            let sync_msg: SyncMessage = match serde_json::from_str(&text) {
                Ok(m) => m,
                Err(e) => {
                    error!("Failed to parse broker message: {}", e);
                    continue;
                }
            };

            handle_broker_message(sync_msg, &pending_requests);
        }
    }

    debug!("WebSocket read task ended");
}

/// Handle incoming broker messages
fn handle_broker_message(msg: SyncMessage, pending_requests: &PendingRequests) {
    match msg {
        SyncMessage::ShareInfo { info } => {
            // Find pending request for this share
            let token = info.metadata.result_id.clone();
            if let Some(tx) = pending_requests.write().remove(&token) {
                let _ = tx.send(info);
            } else {
                warn!("Received share info for unknown request");
            }
        }

        SyncMessage::Ack { .. } => {
            debug!("Received ACK from broker");
        }

        SyncMessage::Error { message, code } => {
            error!("Broker error [{}]: {}", code, message);
        }

        _ => {
            warn!("Unexpected message from broker: {:?}", msg);
        }
    }
}

/// Generate a random share token
fn generate_share_token() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: [u8; 16] = rng.gen();
    URL_SAFE_NO_PAD.encode(bytes)
}
