# HTTP Encryption Fallback Design

## Problem

Windows users without OpenSSL or mkcert installed cannot start the embedded API server because certificate generation fails. The file manager spins indefinitely waiting for `serverReady` which never becomes `true`.

Error observed:
```
Failed to start embedded API: Failed to start local API server: Failed to run openssl
```

## Solution

HTTP fallback with application-layer AES-256-GCM encryption when TLS certificate generation fails.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Key exchange | Pre-shared key via Tauri IPC | Key never traverses HTTP, stays in secure IPC |
| Format | Binary with `application/x-ddalab-encrypted` | No base64 overhead, efficient |
| Encrypted routes | All except `/api/health` | Health checks don't contain sensitive data |
| Fallback trigger | Auto on cert failure + manual setting | Unblocks Windows users, allows manual override |
| Key storage | In-memory (Zustand) | Never written to disk, cleared on app close |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        App Startup                               │
├─────────────────────────────────────────────────────────────────┤
│  1. Try HTTPS (mkcert → openssl)                                │
│     ↓ success? → HTTPS server, no encryption middleware         │
│     ↓ failure? → HTTP server + encryption middleware            │
│                                                                  │
│  2. Generate encryption key (Rust side, random 256-bit)         │
│  3. Pass key to frontend via Tauri IPC command                  │
│  4. Store key in Zustand (memory only)                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Encrypted HTTP Request                         │
├─────────────────────────────────────────────────────────────────┤
│  Frontend:                                                       │
│    1. Serialize request body to bytes                           │
│    2. Encrypt with AES-256-GCM → (nonce || ciphertext)          │
│    3. POST with Content-Type: application/x-ddalab-encrypted    │
│                                                                  │
│  Backend (middleware):                                           │
│    1. Detect content-type, extract nonce (first 12 bytes)       │
│    2. Decrypt ciphertext with shared key                        │
│    3. Pass decrypted body to handler                            │
│    4. Encrypt response, return with same content-type           │
└─────────────────────────────────────────────────────────────────┘
```

## Binary Format

```
Request/Response body when encrypted:
┌──────────────┬─────────────────────────────────┐
│ Nonce (12B)  │ Ciphertext (variable + 16B tag) │
└──────────────┴─────────────────────────────────┘
```

## Components

### Rust Backend (4 files)

| File | Purpose |
|------|---------|
| `src/api/crypto.rs` (new) | AES-256-GCM encrypt/decrypt functions |
| `src/api/middleware.rs` (new) | Axum middleware for transparent encryption |
| `src/api/server.rs` (modify) | Fallback logic on cert failure |
| `src/commands/api_commands.rs` (modify) | `get_encryption_key` Tauri command |

### TypeScript Frontend (3 files)

| File | Purpose |
|------|---------|
| `src/utils/crypto.ts` (new) | Web Crypto API wrapper for AES-256-GCM |
| `src/services/apiService.ts` (modify) | Wrap requests with encryption when needed |
| `src/store/slices/uiSlice.ts` (modify) | Store encryption key and mode flag |

## Startup Flow

```
page.tsx initialization
    │
    ├─► TauriService.startLocalApiServer()
    │       │
    │       ├─► Try HTTPS with certs
    │       │       │
    │       │       ├─► Success: return { port, token, protocol: "https", encryptionKey: null }
    │       │       │
    │       │       └─► Failure (no mkcert/openssl):
    │       │               └─► Retry HTTP + generate encryption key
    │       │                   └─► return { port, token, protocol: "http", encryptionKey: [u8; 32] }
    │       │
    │       └─► Frontend receives response
    │               ├─► Set serverReady = true
    │               ├─► If encryptionKey: store in Zustand, set isEncryptedMode = true
    │               └─► apiService configures base URL (http vs https)
```

## Error Handling

| Error | Handling |
|-------|----------|
| Cert generation fails | Log warning, auto-fallback to HTTP + encryption |
| Decryption fails | Return 400 with `"Decryption failed"` error |
| Frontend missing key | Refuse requests, show error toast |
| Key mismatch | Impossible - key regenerated each startup, always in sync |

## User Setting

In Preferences → Security:

```
API Transport: [HTTPS (auto-detect) ▼]
               ├── HTTPS (auto-detect)  ← default, falls back if needed
               ├── HTTPS (require)      ← fail if certs unavailable
               └── HTTP + Encryption    ← force encrypted HTTP mode
```

## User Notification

When fallback occurs, show one-time toast:
```
⚠️ Running in encrypted HTTP mode
   Certificate generation unavailable.
   Install mkcert for native HTTPS: choco install mkcert (Windows)
```

## Testing

1. **Unit tests (Rust)**: Encrypt/decrypt roundtrip, tamper detection, nonce uniqueness
2. **Unit tests (TS)**: Web Crypto encrypt/decrypt matching Rust output
3. **Integration test**: Mock cert failure, verify HTTP fallback starts
4. **Cross-compatibility**: Verify Rust ↔ TypeScript encryption interoperability
5. **Manual test**: Remove mkcert/openssl from PATH on Windows, verify app works

## Related Fixes

- **CSP fix**: Added `http://ipc.localhost` to connect-src in `tauri.conf.json` to allow Tauri IPC fallback
