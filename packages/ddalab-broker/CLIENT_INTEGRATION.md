# Client Integration Guide

This guide explains how local DDALAB instances (the embedded Rust API in ddalab-tauri) should connect to and interact with the institutional sync broker.

## Architecture Overview

```
┌─────────────────┐          ┌──────────────┐          ┌─────────────────┐
│   Alice's       │          │    Sync      │          │   Bob's         │
│   Local DDALAB  │◄────────►│    Broker    │◄────────►│   Local DDALAB  │
│   (Tauri App)   │   WSS    │ (Institution)│   WSS    │   (Tauri App)   │
└─────────────────┘          └──────────────┘          └─────────────────┘
        │                                                       │
        │                                                       │
        └───────────────── Direct Data Transfer ──────────────►┘
                         (Peer-to-Peer HTTP)
```

**Key Principle**: The broker is just a **coordinator**. Actual data transfers happen peer-to-peer.

## Connection Flow

### 1. Application Startup

When the Tauri app starts, optionally connect to the broker:

```rust
// In ddalab-tauri/src-tauri/src/sync/client.rs

use tokio_tungstenite::{connect_async, tungstenite::Message};
use futures_util::{SinkExt, StreamExt};

pub struct SyncClient {
    broker_url: String,
    user_id: String,
    local_endpoint: String, // e.g., "http://192.168.1.50:3001"
    ws_sender: Option<SplitSink<WebSocketStream, Message>>,
}

impl SyncClient {
    pub async fn connect(
        broker_url: String,
        user_id: String,
        local_endpoint: String,
    ) -> Result<Self> {
        // Connect to broker WebSocket
        let (ws_stream, _) = connect_async(&broker_url).await?;
        let (mut sender, mut receiver) = ws_stream.split();

        // Register with broker
        let register_msg = json!({
            "type": "register_user",
            "user_id": user_id,
            "endpoint": local_endpoint
        });

        sender.send(Message::Text(register_msg.to_string())).await?;

        // Wait for acknowledgment
        if let Some(Ok(Message::Text(response))) = receiver.next().await {
            let ack: SyncMessage = serde_json::from_str(&response)?;
            match ack {
                SyncMessage::Ack { .. } => {
                    info!("Successfully registered with broker");
                }
                _ => return Err("Failed to register"),
            }
        }

        // Spawn background task to handle incoming messages
        tokio::spawn(handle_broker_messages(receiver));

        Ok(Self {
            broker_url,
            user_id,
            local_endpoint,
            ws_sender: Some(sender),
        })
    }
}
```

### 2. Heartbeat (Keep-Alive)

Send periodic heartbeats to stay registered:

```rust
impl SyncClient {
    pub fn start_heartbeat(&self) {
        let user_id = self.user_id.clone();
        let sender = self.ws_sender.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;

                let heartbeat = json!({
                    "type": "heartbeat",
                    "user_id": user_id
                });

                if let Some(sender) = &sender {
                    let _ = sender.send(Message::Text(heartbeat.to_string())).await;
                }
            }
        });
    }
}
```

### 3. Share a Result

When user clicks "Share" on a result:

```rust
impl SyncClient {
    pub async fn share_result(
        &self,
        result_id: &str,
        title: &str,
        access_policy: AccessPolicy,
    ) -> Result<String> {
        // Generate share token
        let token = generate_share_token(); // e.g., base64(random_bytes)

        // Publish to broker
        let publish_msg = json!({
            "type": "publish_share",
            "token": token,
            "metadata": {
                "owner_user_id": self.user_id,
                "result_id": result_id,
                "title": title,
                "description": null,
                "created_at": Utc::now(),
                "access_policy": access_policy
            }
        });

        self.ws_sender.send(Message::Text(publish_msg.to_string())).await?;

        // Return shareable link
        Ok(format!("ddalab://share/{}", token))
    }
}
```

### 4. Access a Shared Result

When user pastes a share link:

```rust
impl SyncClient {
    pub async fn access_share(&self, token: &str) -> Result<DDAResult> {
        // Request share info from broker
        let request_msg = json!({
            "type": "request_share",
            "token": token,
            "requester_id": self.user_id
        });

        self.ws_sender.send(Message::Text(request_msg.to_string())).await?;

        // Wait for response (handled in message handler)
        // In practice, use a channel to receive the response
        let share_info = self.wait_for_share_info(token).await?;

        if !share_info.owner_online {
            return Err("Owner is offline. Cannot download result.");
        }

        // Download directly from owner's local server
        let client = reqwest::Client::new();
        let result: DDAResult = client
            .get(&share_info.download_url)
            .header("X-Share-Token", token)
            .send()
            .await?
            .json()
            .await?;

        // Optionally cache locally
        self.cache_result(result.clone()).await?;

        Ok(result)
    }
}
```

## Message Handling

Background task to handle incoming broker messages:

```rust
async fn handle_broker_messages(mut receiver: SplitStream<WebSocketStream>) {
    while let Some(Ok(Message::Text(text))) = receiver.next().await {
        let msg: SyncMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                error!("Failed to parse message: {}", e);
                continue;
            }
        };

        match msg {
            SyncMessage::ShareInfo { info } => {
                // Handle share info response
                // Send to waiting request via channel
                share_response_tx.send(info).await;
            }

            SyncMessage::Error { message, code } => {
                error!("Broker error [{}]: {}", code, message);
            }

            SyncMessage::Ack { .. } => {
                // Message acknowledged
            }

            _ => {
                warn!("Unexpected message type");
            }
        }
    }
}
```

## Local API Endpoints

Your local Rust API server needs these endpoints for peer-to-peer transfers:

```rust
// In ddalab-tauri/src-tauri/src/api/results.rs

#[get("/api/results/{result_id}")]
async fn get_result(
    Path(result_id): Path<String>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Result<Json<DDAResult>> {
    // Verify share token if provided
    if let Some(token) = headers.get("X-Share-Token") {
        // Validate token with broker or local cache
        if !validate_share_token(token, &result_id).await? {
            return Err(StatusCode::FORBIDDEN);
        }
    }

    // Load and return result
    let result = state.services.analysis.get_result(&result_id).await?;
    Ok(Json(result))
}
```

## Configuration

Users configure sync in `~/.ddalab/config.toml`:

```toml
[sync]
enabled = true
broker_url = "wss://ddalab-sync.university.edu/ws"
auto_connect = true

[user]
id = "alice@university.edu"  # Could be email or username
```

Or disable for fully offline mode:

```toml
[sync]
enabled = false
```

## UI Integration

### Share Button

```typescript
// In ddalab-tauri/src/components/DDAResults.tsx

const handleShare = async () => {
  if (!syncEnabled) {
    toast.error("Sync is disabled. Enable in Settings.");
    return;
  }

  try {
    const shareLink = await invoke('share_result', {
      resultId: result.id,
      title: result.title,
      accessPolicy: { type: 'public' }
    });

    // Copy to clipboard
    await navigator.clipboard.writeText(shareLink);
    toast.success("Share link copied!");
  } catch (err) {
    toast.error("Failed to share: " + err);
  }
};
```

### Access Shared Link

```typescript
// In ddalab-tauri/src/components/ImportShare.tsx

const handleImport = async (shareLink: string) => {
  const token = shareLink.replace('ddalab://share/', '');

  try {
    const result = await invoke('access_share', { token });

    // Add to local results
    toast.success("Result imported successfully!");
    navigate(`/results/${result.id}`);
  } catch (err) {
    if (err.includes("offline")) {
      toast.error("Owner is offline. Try again later.");
    } else {
      toast.error("Access denied or invalid link.");
    }
  }
};
```

## Tauri Commands

Expose these commands to the frontend:

```rust
// In ddalab-tauri/src-tauri/src/commands.rs

#[tauri::command]
async fn share_result(
    result_id: String,
    title: String,
    access_policy: AccessPolicy,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if let Some(sync) = &state.sync_client {
        sync.share_result(&result_id, &title, access_policy)
            .await
            .map_err(|e| e.to_string())
    } else {
        Err("Sync is not enabled".to_string())
    }
}

#[tauri::command]
async fn access_share(
    token: String,
    state: State<'_, AppState>,
) -> Result<DDAResult, String> {
    if let Some(sync) = &state.sync_client {
        sync.access_share(&token)
            .await
            .map_err(|e| e.to_string())
    } else {
        Err("Sync is not enabled".to_string())
    }
}
```

## Error Handling

Common scenarios:

1. **Broker Offline**: Graceful degradation - local-only mode
2. **Owner Offline**: Show message "Result owner is offline"
3. **Access Denied**: Show appropriate error based on access policy
4. **Network Issues**: Retry with exponential backoff

## Security Considerations

1. **TLS Required**: Use `wss://` in production, not `ws://`
2. **Authentication**: Add JWT token to WebSocket connection
3. **Token Validation**: Verify share tokens before serving data
4. **Rate Limiting**: Limit share creation per user
5. **IP Whitelisting**: Institutional firewall rules

## Testing Locally

Test with two Tauri instances:

```bash
# Terminal 1: Start broker
cd packages/ddalab-broker
./dev.sh dev

# Terminal 2: Alice's instance
cd packages/ddalab-tauri
PORT=3001 npm run tauri:dev

# Terminal 3: Bob's instance
cd packages/ddalab-tauri
PORT=3002 npm run tauri:dev
```

Configure each instance with different user IDs and test sharing between them.

## Next Steps

1. Implement `SyncClient` in `packages/ddalab-tauri/src-tauri/src/sync/`
2. Add share UI components
3. Add configuration UI in Settings
4. Add share token validation
5. Test peer-to-peer transfers
6. Deploy broker to institutional server

---

**Key Takeaway**: The broker is a lightweight coordinator. Keep local DDALAB instances independent and capable of offline operation!
