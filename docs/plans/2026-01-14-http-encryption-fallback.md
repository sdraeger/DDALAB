# HTTP Encryption Fallback Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Windows users without OpenSSL/mkcert to use DDALAB by falling back to HTTP with AES-256-GCM encryption.

**Architecture:** When TLS certificate generation fails, the server automatically falls back to HTTP mode with application-layer encryption. A 256-bit key is generated server-side and passed to the frontend via Tauri IPC. All sensitive API traffic is encrypted/decrypted transparently via middleware.

**Tech Stack:** Rust (aes-gcm, axum middleware), TypeScript (Web Crypto API), Zustand

---

## Task 1: Rust Encryption Module

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/api/crypto.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/api/mod.rs`

**Step 1: Create the crypto module with encryption primitives**

```rust
// packages/ddalab-tauri/src-tauri/src/api/crypto.rs
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

/// 256-bit encryption key for AES-GCM
#[derive(Clone)]
pub struct EncryptionKey([u8; 32]);

impl EncryptionKey {
    /// Create a new random encryption key
    pub fn random() -> Self {
        let mut key = [0u8; 32];
        rand::rng().fill_bytes(&mut key);
        Self(key)
    }

    /// Create from existing bytes
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Get the key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Encryption error types
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Invalid encryption key")]
    InvalidKey,
    #[error("Invalid nonce length (expected 12 bytes)")]
    InvalidNonce,
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("Decryption failed - data may be corrupted or tampered")]
    DecryptionFailed,
}

/// Encrypt payload using AES-256-GCM
/// Returns binary format: nonce (12 bytes) || ciphertext (includes 16-byte auth tag)
pub fn encrypt_payload(key: &EncryptionKey, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(&key.0).map_err(|_| CryptoError::InvalidKey)?;

    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt (ciphertext includes authentication tag)
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::EncryptionFailed)?;

    // Concatenate: nonce || ciphertext
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypt payload using AES-256-GCM
/// Expects binary format: nonce (12 bytes) || ciphertext
pub fn decrypt_payload(key: &EncryptionKey, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if data.len() < 12 {
        return Err(CryptoError::InvalidNonce);
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&key.0).map_err(|_| CryptoError::InvalidKey)?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = EncryptionKey::random();
        let plaintext = b"Hello, DDALAB! This is sensitive data.";

        let encrypted = encrypt_payload(&key, plaintext).unwrap();
        let decrypted = decrypt_payload(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_different_nonces() {
        let key = EncryptionKey::random();
        let plaintext = b"Same message";

        let encrypted1 = encrypt_payload(&key, plaintext).unwrap();
        let encrypted2 = encrypt_payload(&key, plaintext).unwrap();

        // Same plaintext produces different ciphertext due to random nonces
        assert_ne!(encrypted1, encrypted2);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = EncryptionKey::random();
        let plaintext = b"Original message";

        let mut encrypted = encrypt_payload(&key, plaintext).unwrap();

        // Tamper with ciphertext (after nonce)
        if encrypted.len() > 12 {
            encrypted[12] ^= 0xFF;
        }

        assert!(decrypt_payload(&key, &encrypted).is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = EncryptionKey::random();
        let key2 = EncryptionKey::random();
        let plaintext = b"Secret message";

        let encrypted = encrypt_payload(&key1, plaintext).unwrap();
        assert!(decrypt_payload(&key2, &encrypted).is_err());
    }
}
```

**Step 2: Run tests to verify encryption works**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test crypto --lib`
Expected: All 4 tests pass

**Step 3: Export crypto module from api/mod.rs**

Add to `packages/ddalab-tauri/src-tauri/src/api/mod.rs`:

```rust
pub mod crypto;

// Add to re-exports:
pub use crypto::{encrypt_payload, decrypt_payload, EncryptionKey, CryptoError};
```

**Step 4: Verify compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/api/crypto.rs packages/ddalab-tauri/src-tauri/src/api/mod.rs
git commit -m "$(cat <<'EOF'
feat(api): add AES-256-GCM encryption module

Add crypto primitives for HTTP fallback encryption:
- EncryptionKey type with random generation
- encrypt_payload/decrypt_payload functions
- Binary format: nonce (12B) || ciphertext
EOF
)"
```

---

## Task 2: Encryption Middleware

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/api/encryption_middleware.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/api/mod.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/api/router.rs`

**Step 1: Create encryption middleware**

```rust
// packages/ddalab-tauri/src-tauri/src/api/encryption_middleware.rs
use crate::api::crypto::{decrypt_payload, encrypt_payload, EncryptionKey};
use axum::{
    body::Body,
    extract::State,
    http::{header, Request, Response, StatusCode},
    middleware::Next,
};
use bytes::Bytes;
use http_body_util::BodyExt;
use std::sync::Arc;

/// Content-Type for encrypted payloads
pub const ENCRYPTED_CONTENT_TYPE: &str = "application/x-ddalab-encrypted";

/// State wrapper for encryption key
#[derive(Clone)]
pub struct EncryptionState {
    pub key: Option<Arc<EncryptionKey>>,
    pub enabled: bool,
}

impl Default for EncryptionState {
    fn default() -> Self {
        Self {
            key: None,
            enabled: false,
        }
    }
}

impl EncryptionState {
    pub fn new(key: EncryptionKey) -> Self {
        Self {
            key: Some(Arc::new(key)),
            enabled: true,
        }
    }
}

/// Middleware that transparently encrypts/decrypts request/response bodies
pub async fn encryption_middleware(
    State(encryption_state): State<Arc<EncryptionState>>,
    request: Request<Body>,
    next: Next,
) -> Result<Response<Body>, StatusCode> {
    // Skip if encryption is not enabled
    if !encryption_state.enabled {
        return Ok(next.run(request).await);
    }

    let key = match &encryption_state.key {
        Some(k) => k.clone(),
        None => return Ok(next.run(request).await),
    };

    // Check if request body is encrypted
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let is_encrypted_request = content_type == ENCRYPTED_CONTENT_TYPE;

    // Decrypt request body if encrypted
    let request = if is_encrypted_request {
        let (parts, body) = request.into_parts();

        // Collect body bytes
        let body_bytes = match body.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => return Err(StatusCode::BAD_REQUEST),
        };

        // Decrypt
        let decrypted = match decrypt_payload(&key, &body_bytes) {
            Ok(d) => d,
            Err(e) => {
                log::error!("Decryption failed: {}", e);
                return Err(StatusCode::BAD_REQUEST);
            }
        };

        // Reconstruct request with decrypted body and JSON content-type
        let mut new_request = Request::from_parts(parts, Body::from(decrypted));
        new_request.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static("application/json"),
        );
        new_request
    } else {
        request
    };

    // Call the actual handler
    let response = next.run(request).await;

    // Encrypt response if request was encrypted
    if is_encrypted_request {
        let (parts, body) = response.into_parts();

        // Collect response body
        let body_bytes = match body.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR),
        };

        // Encrypt response
        let encrypted = match encrypt_payload(&key, &body_bytes) {
            Ok(e) => e,
            Err(e) => {
                log::error!("Response encryption failed: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

        // Reconstruct response with encrypted body
        let mut new_response = Response::from_parts(parts, Body::from(encrypted));
        new_response.headers_mut().insert(
            header::CONTENT_TYPE,
            header::HeaderValue::from_static(ENCRYPTED_CONTENT_TYPE),
        );

        Ok(new_response)
    } else {
        Ok(response)
    }
}
```

**Step 2: Export middleware from mod.rs**

Add to `packages/ddalab-tauri/src-tauri/src/api/mod.rs`:

```rust
pub mod encryption_middleware;

pub use encryption_middleware::{encryption_middleware, EncryptionState, ENCRYPTED_CONTENT_TYPE};
```

**Step 3: Verify compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/api/encryption_middleware.rs packages/ddalab-tauri/src-tauri/src/api/mod.rs
git commit -m "$(cat <<'EOF'
feat(api): add encryption middleware for HTTP fallback

Transparent AES-256-GCM middleware that:
- Detects encrypted requests via Content-Type header
- Decrypts request body before passing to handler
- Encrypts response body before sending to client
EOF
)"
```

---

## Task 3: Server Fallback Logic

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/src/api/server.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/api/router.rs`

**Step 1: Update ApiServerConfig to include encryption key**

In `packages/ddalab-tauri/src-tauri/src/api/server.rs`, update the config struct and return type:

```rust
// At the top, add import:
use crate::api::crypto::EncryptionKey;

/// Result from starting the API server
#[derive(Debug)]
pub struct ApiServerResult {
    pub session_token: String,
    pub port: u16,
    pub handle: JoinHandle<()>,
    pub encryption_key: Option<Vec<u8>>,
    pub using_encryption: bool,
}
```

**Step 2: Update start_api_server to handle fallback**

Replace the `start_api_server` function in `server.rs` with fallback logic:

```rust
/// Start the API server with HTTPS support and HTTP+encryption fallback
pub async fn start_api_server(
    config: ApiServerConfig,
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
) -> anyhow::Result<ApiServerResult> {
    log::info!("🚀 Initializing API server...");
    log::info!("📁 Data directory: {:?}", data_directory);
    log::info!("🔌 Port: {}", config.port);
    log::info!("🔒 HTTPS: {}", config.use_https);
    log::info!("🔐 Auth required: {}", config.require_auth);
    log::info!("🌐 Bind address: {}", config.bind_address);

    if let Some(ref path) = dda_binary_path {
        log::info!("🔧 DDA binary path: {:?}", path);
    }

    // Find available port
    let mut port_to_use = config.port;
    let mut attempts = 0;
    let test_listener = loop {
        let test_addr = format!("{}:{}", config.bind_address, port_to_use);
        match tokio::net::TcpListener::bind(&test_addr).await {
            Ok(listener) => {
                log::info!("Port {} is available", port_to_use);
                break listener;
            }
            Err(e) => {
                log::warn!("Port {} is not available: {}", port_to_use, e);
                attempts += 1;
                if attempts >= 3 {
                    return Err(anyhow::anyhow!(
                        "No available ports found after trying {}, {}, and {}",
                        config.port,
                        config.port + 1,
                        config.port + 2
                    ));
                }
                port_to_use += 1;
            }
        }
    };
    drop(test_listener);

    // Generate session token
    let session_token = generate_session_token();
    log::info!("🔑 Generated session token");

    let bind_addr = format!("{}:{}", config.bind_address, port_to_use);

    // Try HTTPS first if configured
    if config.use_https {
        match try_start_https_server(
            &config,
            &data_directory,
            &dda_binary_path,
            &session_token,
            &bind_addr,
            port_to_use,
        )
        .await
        {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("HTTPS failed: {}. Falling back to HTTP with encryption.", e);
            }
        }
    }

    // Fallback to HTTP with encryption
    start_http_with_encryption(
        &config,
        data_directory,
        dda_binary_path,
        session_token,
        bind_addr,
        port_to_use,
    )
    .await
}

async fn try_start_https_server(
    config: &ApiServerConfig,
    data_directory: &PathBuf,
    dda_binary_path: &Option<PathBuf>,
    session_token: &str,
    bind_addr: &str,
    port: u16,
) -> anyhow::Result<ApiServerResult> {
    use crate::utils::certs::{
        check_certificates, generate_lan_certs, generate_localhost_certs, get_certs_dir,
        load_tls_config,
    };

    let cert_dir = get_certs_dir()?;
    let cert_path = cert_dir.join("server.crt");
    let key_path = cert_dir.join("server.key");

    // Generate certificates if needed
    if !check_certificates(&cert_dir).unwrap_or(false) {
        log::info!("🔐 Certificates not found, generating new ones...");

        if config.bind_address == "0.0.0.0" {
            let hostname = config.hostname.as_deref().unwrap_or("localhost");
            let local_ip = local_ip_address::local_ip()
                .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)))
                .to_string();
            generate_lan_certs(&cert_dir, hostname, &local_ip).await?;
        } else {
            generate_localhost_certs(&cert_dir).await?;
        }
    }

    // Load TLS configuration
    let tls_config = load_tls_config(&cert_path, &key_path).await?;

    // Create API state without encryption
    let state = create_api_state(data_directory.clone(), dda_binary_path.clone(), session_token, config.require_auth);
    let encryption_state = Arc::new(EncryptionState::default());
    let app = create_router_with_encryption(state, encryption_state);

    log::info!("🌐 Starting HTTPS server on https://{}", bind_addr);

    let bind_addr_owned = bind_addr.to_string();
    let token = session_token.to_string();

    let server_handle = tokio::spawn(async move {
        let result = axum_server::bind_rustls(
            bind_addr_owned.parse().expect("Invalid bind address"),
            tls_config,
        )
        .serve(app.into_make_service())
        .await;

        if let Err(e) = result {
            log::error!("HTTPS server error: {}", e);
        }
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    Ok(ApiServerResult {
        session_token: token,
        port,
        handle: server_handle,
        encryption_key: None,
        using_encryption: false,
    })
}

async fn start_http_with_encryption(
    config: &ApiServerConfig,
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
    session_token: String,
    bind_addr: String,
    port: u16,
) -> anyhow::Result<ApiServerResult> {
    // Generate encryption key
    let encryption_key = EncryptionKey::random();
    let key_bytes = encryption_key.as_bytes().to_vec();

    log::warn!("⚠️ Starting HTTP server with application-layer encryption");
    log::warn!("   Install mkcert for native HTTPS: choco install mkcert (Windows)");

    // Create API state with encryption
    let state = create_api_state(data_directory, dda_binary_path, &session_token, config.require_auth);
    let encryption_state = Arc::new(EncryptionState::new(encryption_key));
    let app = create_router_with_encryption(state, encryption_state);

    log::info!("🌐 Starting HTTP+encryption server on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;

    let server_handle = tokio::spawn(async move {
        let result = axum::serve(listener, app).await;
        if let Err(e) = result {
            log::error!("HTTP server error: {}", e);
        }
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    Ok(ApiServerResult {
        session_token,
        port,
        handle: server_handle,
        encryption_key: Some(key_bytes),
        using_encryption: true,
    })
}

fn create_api_state(
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
    session_token: &str,
    require_auth: bool,
) -> Arc<ApiState> {
    let mut api_state = ApiState::new(data_directory);
    if let Some(binary_path) = dda_binary_path {
        api_state.set_dda_binary_path(binary_path);
    }
    api_state.set_session_token(session_token.to_string());
    api_state.set_require_auth(require_auth);
    api_state.initialize_overview_cache();
    Arc::new(api_state)
}
```

**Step 3: Update router.rs to accept encryption state**

Add new function to `packages/ddalab-tauri/src-tauri/src/api/router.rs`:

```rust
use crate::api::encryption_middleware::{encryption_middleware, EncryptionState};

/// Create router with optional encryption middleware
pub fn create_router_with_encryption(
    state: Arc<ApiState>,
    encryption_state: Arc<EncryptionState>,
) -> Router {
    let public_routes = Router::new().route("/api/health", get(health));

    let protected_routes = Router::new()
        // ... (keep all existing routes)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .fallback(handle_404)
        .layer(middleware::from_fn_with_state(
            encryption_state,
            encryption_middleware,
        ))
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024))
        .layer(CompressionLayer::new())
        .layer(cors())
        .with_state(state)
}

fn cors() -> CorsLayer {
    CorsLayer::new()
        .allow_origin([
            "http://localhost:3000".parse::<HeaderValue>().unwrap(),
            "http://localhost:3001".parse::<HeaderValue>().unwrap(),
            "http://localhost:3003".parse::<HeaderValue>().unwrap(),
            "http://127.0.0.1:3000".parse::<HeaderValue>().unwrap(),
            "http://127.0.0.1:3001".parse::<HeaderValue>().unwrap(),
            "http://127.0.0.1:3003".parse::<HeaderValue>().unwrap(),
            "tauri://localhost".parse::<HeaderValue>().unwrap(),
            "https://tauri.localhost".parse::<HeaderValue>().unwrap(),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT])
}
```

**Step 4: Verify compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/api/server.rs packages/ddalab-tauri/src-tauri/src/api/router.rs
git commit -m "$(cat <<'EOF'
feat(api): add HTTP fallback when TLS cert generation fails

Server now automatically falls back to HTTP + AES-256-GCM encryption
when mkcert/openssl are unavailable. Encryption key is generated
server-side and returned to frontend via ApiServerResult.
EOF
)"
```

---

## Task 4: Update API Commands

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/src/commands/api_commands.rs`

**Step 1: Update ApiConnectionConfig to include encryption fields**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConnectionConfig {
    pub host: String,
    pub port: u16,
    pub use_https: bool,
    pub is_local: bool,
    pub session_token: Option<String>,
    /// Encryption key (only present when using HTTP + encryption fallback)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_key: Option<Vec<u8>>,
    /// Whether the connection uses application-layer encryption
    #[serde(default)]
    pub using_encryption: bool,
}

impl Default for ApiConnectionConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 8765,
            use_https: true,
            is_local: true,
            session_token: None,
            encryption_key: None,
            using_encryption: false,
        }
    }
}
```

**Step 2: Update start_local_api_server to return encryption info**

Update the success branch in `start_local_api_server`:

```rust
match start_api_server(server_config, data_dir, dda_binary_path).await {
    Ok(result) => {
        log::info!(
            "Local API server started successfully on port {}",
            result.port
        );

        // Store the task handle
        {
            let mut handle_guard = state.server_handle.write();
            *handle_guard = Some(result.handle);
        }

        // Create connection config with encryption info
        let config = ApiConnectionConfig {
            host: host.clone(),
            port: result.port,
            use_https: !result.using_encryption && use_https,
            is_local: true,
            session_token: Some(result.session_token),
            encryption_key: result.encryption_key,
            using_encryption: result.using_encryption,
        };

        if result.using_encryption {
            log::warn!("📡 API using HTTP + encryption fallback");
        } else {
            log::info!(
                "📡 API accessible at: {}://{}:{}",
                if config.use_https { "https" } else { "http" },
                host,
                result.port
            );
        }

        // Update state and save config
        {
            let mut conn_config = state.connection_config.write();
            *conn_config = config.clone();
        }

        // Note: Don't save encryption_key to disk for security
        let config_to_save = ApiConnectionConfig {
            encryption_key: None, // Never persist key
            ..config.clone()
        };
        if let Err(e) = save_api_config(app_handle, config_to_save, state.clone()).await {
            log::warn!("Failed to save API config: {}", e);
        }

        Ok(config)
    }
    Err(e) => {
        // ... existing error handling
    }
}
```

**Step 3: Verify compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo check`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/commands/api_commands.rs
git commit -m "$(cat <<'EOF'
feat(api): return encryption key in ApiConnectionConfig

Frontend receives encryption_key and using_encryption flag
when HTTP fallback is used. Key is never persisted to disk.
EOF
)"
```

---

## Task 5: TypeScript Crypto Utilities

**Files:**
- Create: `packages/ddalab-tauri/src/utils/crypto.ts`

**Step 1: Create Web Crypto wrapper**

```typescript
// packages/ddalab-tauri/src/utils/crypto.ts

/**
 * AES-256-GCM encryption utilities using Web Crypto API
 * Compatible with Rust aes-gcm implementation
 */

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Import encryption key from raw bytes
 */
export async function importKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt data using AES-256-GCM
 * Returns: nonce (12 bytes) || ciphertext (includes 16-byte auth tag)
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<Uint8Array> {
  // Generate random 12-byte nonce
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
    key,
    plaintext
  );

  // Concatenate: nonce || ciphertext
  const result = new Uint8Array(NONCE_LENGTH + ciphertext.byteLength);
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertext), NONCE_LENGTH);

  return result;
}

/**
 * Decrypt data using AES-256-GCM
 * Expects: nonce (12 bytes) || ciphertext
 */
export async function decrypt(
  key: CryptoKey,
  data: Uint8Array
): Promise<Uint8Array> {
  if (data.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Data too short to contain nonce and auth tag");
  }

  const nonce = data.slice(0, NONCE_LENGTH);
  const ciphertext = data.slice(NONCE_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH * 8 },
    key,
    ciphertext
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypt a JSON object for API request
 */
export async function encryptJson(
  key: CryptoKey,
  data: unknown
): Promise<Uint8Array> {
  const jsonString = JSON.stringify(data);
  const plaintext = new TextEncoder().encode(jsonString);
  return encrypt(key, plaintext);
}

/**
 * Decrypt API response to JSON
 */
export async function decryptJson<T>(
  key: CryptoKey,
  data: Uint8Array
): Promise<T> {
  const plaintext = await decrypt(key, data);
  const jsonString = new TextDecoder().decode(plaintext);
  return JSON.parse(jsonString) as T;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/utils/crypto.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add AES-256-GCM crypto utilities

Web Crypto API wrapper compatible with Rust aes-gcm:
- importKey, encrypt, decrypt functions
- encryptJson/decryptJson for API payloads
- Binary format: nonce (12B) || ciphertext
EOF
)"
```

---

## Task 6: Update UI Slice for Encryption State

**Files:**
- Modify: `packages/ddalab-tauri/src/store/slices/types.ts`
- Modify: `packages/ddalab-tauri/src/store/slices/uiSlice.ts`

**Step 1: Add encryption state to UIState type**

In `packages/ddalab-tauri/src/store/slices/types.ts`, add to UIState:

```typescript
export interface UIState {
  // ... existing fields
  isServerReady: boolean;
  /** Encryption key for HTTP fallback mode (in-memory only) */
  encryptionKey: CryptoKey | null;
  /** Whether using HTTP + encryption fallback */
  isEncryptedMode: boolean;
}
```

**Step 2: Add encryption actions to UISlice type**

```typescript
export interface UISlice {
  ui: UIState;
  // ... existing actions
  setServerReady: (ready: boolean) => void;
  setEncryptionKey: (key: CryptoKey | null) => void;
  setEncryptedMode: (enabled: boolean) => void;
}
```

**Step 3: Update defaultUIState in uiSlice.ts**

```typescript
export const defaultUIState: UIState = {
  // ... existing fields
  isServerReady: false,
  encryptionKey: null,
  isEncryptedMode: false,
};
```

**Step 4: Add actions to createUISlice**

```typescript
setEncryptionKey: (key) => {
  set((state) => {
    state.ui.encryptionKey = key;
  });
},

setEncryptedMode: (enabled) => {
  set((state) => {
    state.ui.isEncryptedMode = enabled;
  });
},
```

**Step 5: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 6: Commit**

```bash
git add packages/ddalab-tauri/src/store/slices/types.ts packages/ddalab-tauri/src/store/slices/uiSlice.ts
git commit -m "$(cat <<'EOF'
feat(store): add encryption state to UI slice

Add encryptionKey and isEncryptedMode to Zustand store.
Key stored in-memory only, never persisted.
EOF
)"
```

---

## Task 7: Update ApiService for Encryption

**Files:**
- Modify: `packages/ddalab-tauri/src/services/apiService.ts`

**Step 1: Add encryption support to ApiService**

Add imports and encryption properties:

```typescript
import { encrypt, decrypt, encryptJson, decryptJson } from "@/utils/crypto";

export const ENCRYPTED_CONTENT_TYPE = "application/x-ddalab-encrypted";

export class ApiService {
  private client: AxiosInstance;
  public baseURL: string;
  private chunkCache = getChunkCache();
  private sessionToken: string | null = null;
  private encryptionKey: CryptoKey | null = null;
  private isEncryptedMode: boolean = false;

  // Add methods:
  setEncryptionKey(key: CryptoKey | null) {
    this.encryptionKey = key;
  }

  setEncryptedMode(enabled: boolean) {
    this.isEncryptedMode = enabled;
  }

  isUsingEncryption(): boolean {
    return this.isEncryptedMode && this.encryptionKey !== null;
  }
```

**Step 2: Add encrypted request methods**

```typescript
/**
 * Make an encrypted POST request
 */
private async encryptedPost<T>(
  url: string,
  data: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  if (!this.encryptionKey) {
    throw new Error("Encryption key not set");
  }

  const encrypted = await encryptJson(this.encryptionKey, data);

  const response = await this.client.post(url, encrypted, {
    ...config,
    headers: {
      ...config?.headers,
      "Content-Type": ENCRYPTED_CONTENT_TYPE,
    },
    responseType: "arraybuffer",
  });

  return decryptJson<T>(this.encryptionKey, new Uint8Array(response.data));
}

/**
 * Make an encrypted GET request
 */
private async encryptedGet<T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  if (!this.encryptionKey) {
    throw new Error("Encryption key not set");
  }

  // GET requests don't have body, but response is encrypted
  const response = await this.client.get(url, {
    ...config,
    headers: {
      ...config?.headers,
      Accept: ENCRYPTED_CONTENT_TYPE,
    },
    responseType: "arraybuffer",
  });

  return decryptJson<T>(this.encryptionKey, new Uint8Array(response.data));
}
```

**Step 3: Update API methods to use encryption when enabled**

Update existing methods to check `isUsingEncryption()`. Example for `runDDAAnalysis`:

```typescript
async runDDAAnalysis(request: DDAAnalysisRequest): Promise<DDAResult> {
  if (this.isUsingEncryption()) {
    return this.encryptedPost<DDAResult>("/api/dda/analyze", request);
  }
  const response = await this.client.post<DDAResult>("/api/dda/analyze", request);
  return response.data;
}
```

**Step 4: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src/services/apiService.ts
git commit -m "$(cat <<'EOF'
feat(api): add encryption support to ApiService

ApiService now supports encrypted mode:
- encryptedPost/encryptedGet methods
- Automatic encryption when isEncryptedMode is true
- Binary payload with application/x-ddalab-encrypted
EOF
)"
```

---

## Task 8: Update Page.tsx for Encryption Setup

**Files:**
- Modify: `packages/ddalab-tauri/src/app/page.tsx`

**Step 1: Import crypto utilities and add state**

```typescript
import { importKey } from "@/utils/crypto";

// In component:
const setEncryptionKey = useAppStore((state) => state.setEncryptionKey);
const setEncryptedMode = useAppStore((state) => state.setEncryptedMode);
```

**Step 2: Update server startup to handle encryption**

After `TauriService.startLocalApiServer()` succeeds:

```typescript
const config = await TauriService.startLocalApiServer();

if (config?.session_token) {
  setSessionToken(config.session_token);
}

// Handle encryption key if present (HTTP fallback mode)
if (config?.encryption_key && config.using_encryption) {
  try {
    const keyBytes = new Uint8Array(config.encryption_key);
    const cryptoKey = await importKey(keyBytes);
    setEncryptionKey(cryptoKey);
    setEncryptedMode(true);
    console.log("🔐 Using HTTP with application-layer encryption");
  } catch (error) {
    console.error("Failed to import encryption key:", error);
  }
}

// Update URL based on encryption mode
const actualProtocol = config?.using_encryption
  ? "http"
  : config?.use_https === true
    ? "https"
    : "http";
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(app): initialize encryption from server config

Page.tsx now imports encryption key from ApiConnectionConfig
and stores it in Zustand when HTTP fallback mode is used.
EOF
)"
```

---

## Task 9: Update DashboardLayout to Pass Encryption to ApiService

**Files:**
- Modify: `packages/ddalab-tauri/src/components/DashboardLayout.tsx`

**Step 1: Add encryption selectors**

```typescript
const encryptionKey = useAppStore((state) => state.ui.encryptionKey);
const isEncryptedMode = useAppStore((state) => state.ui.isEncryptedMode);
```

**Step 2: Update ApiService effect to set encryption**

In the useEffect that updates apiService:

```typescript
useEffect(() => {
  if (apiService) {
    apiService.setSessionToken(sessionToken);
    apiService.setEncryptionKey(encryptionKey);
    apiService.setEncryptedMode(isEncryptedMode);
  }
}, [apiService, sessionToken, encryptionKey, isEncryptedMode]);
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 4: Commit**

```bash
git add packages/ddalab-tauri/src/components/DashboardLayout.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): pass encryption state to ApiService

DashboardLayout now passes encryptionKey and isEncryptedMode
from Zustand store to ApiService instance.
EOF
)"
```

---

## Task 10: Add User Notification for Fallback Mode

**Files:**
- Modify: `packages/ddalab-tauri/src/app/page.tsx`

**Step 1: Add notification when using encryption fallback**

Import notification hook and add after encryption setup:

```typescript
import { useNotificationStore } from "@/store/notificationStore";

// After setting encryption mode:
if (config?.using_encryption) {
  const { addNotification } = useNotificationStore.getState();
  addNotification({
    type: "warning",
    title: "Running in encrypted HTTP mode",
    message:
      "Certificate generation unavailable. Install mkcert for native HTTPS: choco install mkcert (Windows)",
    duration: 10000,
  });
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd packages/ddalab-tauri && bun run typecheck`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(app): show notification when using encryption fallback

Users see a warning toast explaining that HTTP + encryption
mode is active and how to install mkcert for native HTTPS.
EOF
)"
```

---

## Task 11: Integration Testing

**Step 1: Test Rust encryption module**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test crypto`
Expected: All tests pass

**Step 2: Test full compilation**

Run: `cd packages/ddalab-tauri/src-tauri && cargo build`
Expected: Builds successfully

**Step 3: Test frontend compilation**

Run: `cd packages/ddalab-tauri && bun run typecheck && bun run build`
Expected: Both pass

**Step 4: Manual test (Windows simulation)**

Temporarily rename/hide mkcert and openssl, then run:
```bash
cd packages/ddalab-tauri && bun run tauri:dev
```
Expected: App starts in HTTP + encryption mode, shows notification

**Step 5: Commit final state**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: HTTP + encryption fallback for Windows users

Complete implementation of automatic fallback when TLS cert
generation fails (no mkcert/openssl):
- Rust: AES-256-GCM crypto module + middleware
- Server: Auto-fallback with key generation
- Frontend: Web Crypto encryption, Zustand state
- User notification explaining fallback mode

Fixes infinite spinner on Windows without OpenSSL.
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Rust crypto module | `api/crypto.rs`, `api/mod.rs` |
| 2 | Encryption middleware | `api/encryption_middleware.rs` |
| 3 | Server fallback logic | `api/server.rs`, `api/router.rs` |
| 4 | API commands update | `commands/api_commands.rs` |
| 5 | TypeScript crypto | `utils/crypto.ts` |
| 6 | UI slice encryption state | `store/slices/types.ts`, `uiSlice.ts` |
| 7 | ApiService encryption | `services/apiService.ts` |
| 8 | Page.tsx setup | `app/page.tsx` |
| 9 | DashboardLayout wiring | `components/DashboardLayout.tsx` |
| 10 | User notification | `app/page.tsx` |
| 11 | Integration testing | - |
