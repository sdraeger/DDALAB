# Sync Module

This module provides optional institutional sync capabilities for DDALAB.

## Features

- WebSocket connection to institutional broker
- Share results with colleagues via shareable links
- Access shared results from others
- Peer-to-peer data transfers (broker only coordinates)
- Fully optional - works offline if sync is disabled

## Usage

### From Rust

```rust
use ddalab_tauri::sync::{SyncClient, AccessPolicy};

// Connect to broker
let client = SyncClient::connect(
    "wss://ddalab-sync.university.edu/ws".to_string(),
    "alice@university.edu".to_string(),
    "http://localhost:3001".to_string(),
).await?;

// Share a result
let share_link = client.share_result(
    "result-123",
    "My Analysis",
    None,
    AccessPolicy::Public,
).await?;

println!("Share link: {}", share_link);
// Output: ddalab://share/abc123xyz

// Access a shared result
let share_info = client.access_share("abc123xyz").await?;
if share_info.owner_online {
    // Download from owner's endpoint
    let result = reqwest::get(&share_info.download_url)
        .await?
        .json::<DDAResult>()
        .await?;
}
```

### From TypeScript (Tauri Commands)

```typescript
import { invoke } from "@tauri-apps/api/core";

// Connect to broker
await invoke("sync_connect", {
  brokerUrl: "wss://ddalab-sync.university.edu/ws",
  userId: "alice@university.edu",
  localEndpoint: "http://localhost:3001",
});

// Share a result
const shareLink = await invoke("sync_share_result", {
  resultId: "result-123",
  title: "My Analysis",
  description: null,
  accessPolicy: { type: "public" },
});

// Access a share
const shareInfo = await invoke("sync_access_share", {
  token: "abc123xyz",
});

if (shareInfo.owner_online) {
  // Download result from owner
  const response = await fetch(shareInfo.download_url);
  const result = await response.json();
}
```

## Configuration

Users can configure sync in their settings or config file:

```toml
[sync]
enabled = true
broker_url = "wss://ddalab-sync.university.edu/ws"
user_id = "alice@university.edu"

[server]
bind_addr = "0.0.0.0:3001"
external_endpoint = "http://192.168.1.50:3001"  # For NAT/firewall
```

## Architecture

```
Local DDALAB Instance:
├── Tauri App (Frontend)
├── Embedded API Server (Axum)
│   └── GET /api/results/{id}  ← Peer downloads from here
└── SyncClient (WebSocket to broker)
    ├── Registers presence
    ├── Publishes shares
    └── Requests share info
```

## Security

- TLS required (`wss://`) for production
- Share tokens are random 16-byte values
- Access policies: Public, Team, or User-specific
- Peer-to-peer transfers require valid share token

## Implementation Status

- ✅ SyncClient with WebSocket connection
- ✅ Share/access/revoke operations
- ✅ Heartbeat mechanism
- ✅ Tauri commands
- ⏳ UI components (TODO)
- ⏳ Configuration management (TODO)
- ⏳ Peer download implementation (TODO)

## Next Steps

1. Add UI for sharing results
2. Add UI for accessing shares
3. Implement peer download with token validation
4. Add configuration UI in Settings
5. Add local share cache
6. Test with multiple instances
