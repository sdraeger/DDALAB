use crate::api::state::ApiState;
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use base64::Engine;
use rand::Rng;
use std::sync::Arc;

/// Generate a random session token
pub fn generate_session_token() -> String {
    let mut rng = rand::rng();
    let bytes: [u8; 32] = rng.random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Constant-time comparison to prevent timing attacks
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Authentication middleware for protected routes
pub async fn auth_middleware(
    State(state): State<Arc<ApiState>>,
    headers: HeaderMap,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Skip auth if not required
    if !state.requires_auth() {
        return Ok(next.run(request).await);
    }

    // Extract Authorization header
    let auth_header = headers
        .get(AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Check for Bearer token
    if !auth_header.starts_with("Bearer ") {
        log::warn!("Invalid Authorization header format");
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_header[7..]; // Skip "Bearer "

    // Verify token
    if !state.verify_session_token(token) {
        log::warn!("🔒 Invalid session token attempted");
        log::warn!(
            "   Received token (first 8 chars): {}...",
            &token[..8.min(token.len())]
        );
        if let Some(expected) = state.get_session_token() {
            log::warn!(
                "   Expected token (first 8 chars): {}...",
                &expected[..8.min(expected.len())]
            );
        } else {
            log::warn!("   No session token set in server state!");
        }
        return Err(StatusCode::FORBIDDEN);
    }

    log::debug!("✅ Token verified successfully");
    Ok(next.run(request).await)
}
