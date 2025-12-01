# DDALAB Server

Institutional DDALAB server for multi-user deployment on local networks.

## Features

- **Multi-user support**: Handle multiple DDALAB clients simultaneously
- **Result sharing**: Peer-to-peer result sharing between users
- **mDNS discovery**: Automatic server discovery on local network
- **Application-layer encryption**: AES-256-GCM encryption without TLS certificates
- **HIPAA compliant**: All data stays on local network

## Quick Start

### Using Docker Compose (Recommended)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your settings:
   ```bash
   INSTITUTION_NAME=Your Institution Name
   BROKER_PASSWORD=your_secure_password
   DB_PASSWORD=your_database_password
   ```

3. Start the server:
   ```bash
   docker-compose up -d
   ```

4. Check server health:
   ```bash
   curl http://localhost:8080/health
   ```

### Manual Build

1. Install dependencies:
   - Rust 1.83+
   - PostgreSQL 14+

2. Build:
   ```bash
   cargo build --release
   ```

3. Set environment variables (see `.env.example`)

4. Run:
   ```bash
   ./target/release/ddalab-server
   ```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | - | PostgreSQL connection string |
| `DDALAB_PORT` | `8080` | Server port |
| `DDALAB_BIND_ADDR` | `0.0.0.0` | Bind address |
| `INSTITUTION_NAME` | `DDALAB Server` | Institution name for discovery |
| `BROKER_PASSWORD` | `default_password` | Password for client authentication |
| `ENABLE_MDNS` | `true` | Enable mDNS discovery announcement |
| `REQUIRE_AUTH` | `true` | Require authentication for API |
| `ENABLE_ENCRYPTION` | `true` | Enable AES-256-GCM encryption |
| `SESSION_TIMEOUT_SECONDS` | `3600` | Session expiry time |
| `HEARTBEAT_TIMEOUT_SECONDS` | `300` | Connection heartbeat timeout |

## API Endpoints

### Public Endpoints

- `GET /health` - Health check
- `GET /info` - Server information
- `POST /auth/login` - Authenticate user
- `POST /auth/key-exchange` - Establish encrypted session

### Protected Endpoints (require authentication)

- `POST /auth/logout` - End session
- `GET /auth/session` - Validate session
- `POST /api/shares` - Create share
- `GET /api/shares/:token` - Get share info
- `DELETE /api/shares/:token` - Revoke share
- `GET /api/shares/user/:user_id` - List user's shares

### WebSocket

- `WS /ws` - Real-time sync connection

## Security

### Authentication Flow

1. Client calls `POST /auth/login` with broker password
2. Server returns session token
3. Client calls `POST /auth/key-exchange` with ECDH public key
4. Server returns its public key, both derive shared secret
5. Subsequent requests encrypted with AES-256-GCM

### HIPAA Compliance

- Server binds only to local network interfaces
- No data leaves the local network
- Peer-to-peer result sharing (server only stores metadata)
- Application-layer encryption for sensitive data
- Audit logging for all data access

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              DDALAB Institutional Server             │
├─────────────────────────────────────────────────────┤
│  HTTP/REST API │ WebSocket Sync │ mDNS Discovery    │
├─────────────────────────────────────────────────────┤
│              Unified Server State                    │
│  - User Registry (in-memory)                        │
│  - Session Manager                                   │
│  - Share Store (PostgreSQL)                         │
└─────────────────────────────────────────────────────┘
                        │
              ┌─────────┴─────────┐
              │    PostgreSQL     │
              │  - user_sessions  │
              │  - shared_results │
              └───────────────────┘
```

## Development

### Run tests
```bash
cargo test
```

### Build documentation
```bash
cargo doc --open
```

## License

MIT
