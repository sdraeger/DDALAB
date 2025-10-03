# DDALAB Sync Broker

Lightweight institutional sync broker for DDALAB deployments. Enables user-to-user collaboration, result sharing, and optional state backup.

## Architecture

The broker is a **coordination layer**, not a full DDALAB server. It:

- **Does NOT** process analysis data or run DDA computations
- **Does NOT** store actual result files (only metadata)
- **DOES** coordinate peer-to-peer connections between users
- **DOES** manage share tokens and access control
- **DOES** track user presence (who's online)
- **DOES** optionally backup user state

### Local-First Design

Users run DDALAB locally with their own Rust API server. The broker is **optional** and only used for:
1. Sharing results with colleagues
2. Creating shareable links
3. Institutional state backup

All data transfers happen **peer-to-peer** - the broker only provides the connection info.

## Features

### Core Features
- ✅ User presence registry (track who's online)
- ✅ Share token management (publish/request/revoke)
- ✅ Access control (public, team-based, user-specific)
- ✅ WebSocket real-time communication
- ✅ HTTP REST API for share lookups
- ✅ PostgreSQL storage for shares

### Optional Features
- ⏳ State backup/restore (schema ready, handlers TODO)
- ⏳ Team management (access policy exists, membership registry TODO)

## Deployment

### Prerequisites

- PostgreSQL 14+
- Rust 1.70+ (for building)

### Environment Variables

```bash
# Database connection
DATABASE_URL=postgres://ddalab:password@localhost:5432/ddalab_broker

# Server binding
BIND_ADDR=0.0.0.0:8080

# Heartbeat timeout (seconds) - cleanup stale connections
HEARTBEAT_TIMEOUT_SECONDS=300

# Logging level
RUST_LOG=ddalab_broker=info,tower_http=debug
```

### Build and Run

```bash
# Development
cargo run

# Production
cargo build --release
./target/release/ddalab-broker
```

### Docker Deployment

```bash
# Build image
docker build -t ddalab-broker:latest .

# Run with docker-compose
docker-compose up -d
```

See `docker-compose.yml` for complete setup.

## API Reference

### WebSocket Protocol

Connect to `ws://broker-address/ws`

#### Messages

**Register User:**
```json
{
  "type": "register_user",
  "user_id": "alice@institution.edu",
  "endpoint": "http://192.168.1.50:3001"
}
```

**Publish Share:**
```json
{
  "type": "publish_share",
  "token": "abc123xyz",
  "metadata": {
    "owner_user_id": "alice@institution.edu",
    "result_id": "result-uuid",
    "title": "My DDA Analysis",
    "description": "EEG analysis from experiment X",
    "created_at": "2025-10-03T12:00:00Z",
    "access_policy": {
      "type": "public"
    }
  }
}
```

**Request Share:**
```json
{
  "type": "request_share",
  "token": "abc123xyz",
  "requester_id": "bob@institution.edu"
}
```

**Response:**
```json
{
  "type": "share_info",
  "info": {
    "metadata": { ... },
    "download_url": "http://192.168.1.50:3001/api/results/result-uuid",
    "owner_online": true
  }
}
```

### HTTP REST API

**Get Share Info:**
```bash
GET /api/shares/:token
```

Returns share metadata and owner availability.

**Health Check:**
```bash
GET /health
```

Returns `OK` if broker is running.

## Database Schema

### `shared_results` Table

```sql
CREATE TABLE shared_results (
    share_token TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    result_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    access_policy JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);
```

### `user_backups` Table (Optional)

```sql
CREATE TABLE user_backups (
    user_id TEXT PRIMARY KEY,
    data BYTEA NOT NULL,
    state_hash TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Security Considerations

1. **TLS Required**: Deploy behind HTTPS/WSS in production
2. **Authentication**: Add JWT or OAuth before production use
3. **Rate Limiting**: Consider adding rate limits for share creation
4. **Access Control**: Team-based policies need institutional directory integration

## License

MIT - See LICENSE file
