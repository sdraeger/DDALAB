use crate::api::crypto::{decrypt_payload, encrypt_payload, EncryptionKey};
use axum::{
    body::Body,
    extract::State,
    http::{header, Request, Response, StatusCode},
    middleware::Next,
};
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

    // Check if request body is encrypted (Content-Type for POST/PUT with body)
    let content_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Check Accept header for GET requests (client signals it wants encrypted response)
    let accept_header = request
        .headers()
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Request is "encrypted" if either:
    // 1. Content-Type is encrypted (POST/PUT with encrypted body)
    // 2. Accept header requests encrypted response (GET requests)
    let has_encrypted_body = content_type == ENCRYPTED_CONTENT_TYPE;
    let wants_encrypted_response = accept_header == ENCRYPTED_CONTENT_TYPE;
    let is_encrypted_request = has_encrypted_body || wants_encrypted_response;

    // Decrypt request body only if it has encrypted content (POST/PUT with body)
    // GET requests don't have a body to decrypt
    let request = if has_encrypted_body {
        let (parts, body) = request.into_parts();

        // Collect body bytes
        let body_bytes = match body.collect().await {
            Ok(collected) => collected.to_bytes(),
            Err(_) => return Err(StatusCode::BAD_REQUEST),
        };

        // Only decrypt if there's actual content
        if body_bytes.is_empty() {
            Request::from_parts(parts, Body::empty())
        } else {
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
        }
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
