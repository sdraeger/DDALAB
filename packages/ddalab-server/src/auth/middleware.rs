use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::warn;

use crate::auth::session::{AuthRateLimiter, SessionManager};
use crate::sync::verify_psk;

/// Authentication state shared with middleware
#[derive(Clone)]
pub struct AuthState {
    pub session_manager: SessionManager,
    pub rate_limiter: AuthRateLimiter,
    pub broker_password_hash: String,
    pub require_auth: bool,
}

impl AuthState {
    pub fn new(session_manager: SessionManager, broker_password: &str, require_auth: bool) -> Self {
        Self {
            session_manager,
            rate_limiter: AuthRateLimiter::default(), // 10 attempts per minute
            broker_password_hash: crate::sync::hash_psk(broker_password),
            require_auth,
        }
    }

    /// Verify broker password
    pub fn verify_broker_password(&self, password: &str) -> bool {
        verify_psk(password, &self.broker_password_hash)
    }
}

/// Authentication middleware for protected routes
pub async fn auth_middleware(
    State(state): State<Arc<AuthState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    // Skip auth if not required
    if !state.require_auth {
        return next.run(request).await;
    }

    let client_ip = addr.ip();

    // Check if rate limited BEFORE any auth attempt
    if state.rate_limiter.is_rate_limited(client_ip) {
        warn!("Rate limited request from {}", client_ip);
        return rate_limited_response();
    }

    // Extract Authorization header
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let Some(auth_value) = auth_header else {
        // Record failure for missing auth header
        state.rate_limiter.record_failure(client_ip);
        return unauthorized_response("Missing Authorization header");
    };

    // Support both "Bearer <token>" and raw token
    let token = if auth_value.starts_with("Bearer ") {
        &auth_value[7..]
    } else {
        auth_value
    };

    // Validate token
    if state.session_manager.validate_token(token).is_none() {
        // Record failure for invalid token
        let is_limited = state.rate_limiter.record_failure(client_ip);
        if is_limited {
            warn!("IP {} is now rate limited after failed auth", client_ip);
        }
        return unauthorized_response("Invalid or expired session token");
    }

    // Clear rate limit on successful auth
    state.rate_limiter.clear(client_ip);

    next.run(request).await
}

/// Create rate limited response
fn rate_limited_response() -> Response {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(json!({
            "error": "Too Many Requests",
            "message": "Too many failed authentication attempts. Please try again later."
        })),
    )
        .into_response()
}

/// Create unauthorized response
fn unauthorized_response(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": "Unauthorized",
            "message": message
        })),
    )
        .into_response()
}

/// Constant-time string comparison to prevent timing attacks
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq(b"hello", b"hello"));
        assert!(!constant_time_eq(b"hello", b"world"));
        assert!(!constant_time_eq(b"hello", b"hello!"));
    }

    #[test]
    fn test_auth_state() {
        let session_manager = SessionManager::new(3600);
        let auth_state = AuthState::new(session_manager, "test_password", true);

        assert!(auth_state.verify_broker_password("test_password"));
        assert!(!auth_state.verify_broker_password("wrong_password"));
    }
}
