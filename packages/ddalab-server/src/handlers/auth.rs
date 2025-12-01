use axum::{
    extract::State,
    http::{header, StatusCode},
    Json,
};
use axum_extra::TypedHeader;
use headers::{authorization::Bearer, Authorization};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{info, warn};

use crate::auth::verify_password;
use crate::crypto::{EcdhKeyPair, EncryptionKey};
use crate::state::ServerState;
use crate::storage::StorageError;

/// Login request
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    /// User identifier (email or unique string)
    pub user_id: String,
    /// Broker password for authentication
    pub password: String,
    /// Client's local endpoint for P2P sharing
    pub endpoint: Option<String>,
}

/// Login response
#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub session_token: String,
    pub user_id: String,
    pub expires_in_seconds: u64,
}

/// Key exchange request (for encrypted sessions)
#[derive(Debug, Deserialize)]
pub struct KeyExchangeRequest {
    /// Session token (from login)
    pub session_token: String,
    /// Client's ECDH public key (base64)
    pub client_public_key: String,
}

/// Key exchange response
#[derive(Debug, Serialize)]
pub struct KeyExchangeResponse {
    /// Server's ECDH public key (base64)
    pub server_public_key: String,
    /// Confirmation that key exchange completed
    pub encryption_enabled: bool,
}

/// Logout request
#[derive(Debug, Deserialize)]
pub struct LogoutRequest {
    pub session_token: String,
}

/// Session validation response
#[derive(Debug, Serialize)]
pub struct SessionResponse {
    pub valid: bool,
    pub user_id: Option<String>,
    pub expires_in_seconds: Option<u64>,
}

/// Login endpoint
pub async fn login(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Look up user by email (user_id is the email address)
    let user = match state.user_store.get_user_by_email(&request.user_id).await {
        Ok(user) => user,
        Err(StorageError::UserNotFound(_)) => {
            warn!("Login attempt for unknown user: {}", request.user_id);
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Invalid email or password".to_string(),
                    code: "AUTH_FAILED".to_string(),
                }),
            ));
        }
        Err(e) => {
            warn!("Database error during login: {}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Internal error".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            ));
        }
    };

    // Check if user is active
    if !user.is_active {
        warn!("Login attempt for suspended user: {}", request.user_id);
        return Err((
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                error: "Account is suspended".to_string(),
                code: "ACCOUNT_SUSPENDED".to_string(),
            }),
        ));
    }

    // Verify password against stored hash
    match verify_password(&request.password, &user.password_hash) {
        Ok(true) => {
            // Password is correct
            info!("User {} logged in successfully", user.email);
        }
        Ok(false) => {
            warn!("Invalid password for user: {}", request.user_id);
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(ErrorResponse {
                    error: "Invalid email or password".to_string(),
                    code: "AUTH_FAILED".to_string(),
                }),
            ));
        }
        Err(e) => {
            warn!("Password verification error: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Internal error".to_string(),
                    code: "INTERNAL_ERROR".to_string(),
                }),
            ));
        }
    }

    // Update last login timestamp
    if let Err(e) = state.user_store.update_last_login(user.id).await {
        warn!("Failed to update last login for user {}: {}", user.email, e);
        // Non-fatal, continue with login
    }

    // Create session
    let (token, _session) = state.auth_state.session_manager.create_session(
        user.email.clone(),
        None, // Encryption key set later via key exchange
    );

    Ok(Json(LoginResponse {
        session_token: token,
        user_id: user.email,
        expires_in_seconds: state.config.session_timeout_seconds,
    }))
}

/// Key exchange endpoint (for encrypted sessions)
pub async fn key_exchange(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<KeyExchangeRequest>,
) -> Result<Json<KeyExchangeResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Validate session token
    if state.auth_state.session_manager.validate_token(&request.session_token).is_none() {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                error: "Invalid session token".to_string(),
                code: "INVALID_TOKEN".to_string(),
            }),
        ));
    }

    // Decode client's public key
    let client_public_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &request.client_public_key,
    )
    .map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid public key encoding".to_string(),
                code: "INVALID_KEY".to_string(),
            }),
        )
    })?;

    if client_public_bytes.len() != 32 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid public key length".to_string(),
                code: "INVALID_KEY".to_string(),
            }),
        ));
    }

    let mut client_key = [0u8; 32];
    client_key.copy_from_slice(&client_public_bytes);

    // Generate server key pair and derive shared secret
    let server_keypair = EcdhKeyPair::generate();
    let server_public = server_keypair.public_key_bytes();

    // Derive session key
    let session_key_bytes = server_keypair
        .derive_session_key(&client_key)
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "Key derivation failed".to_string(),
                    code: "KEY_DERIVATION_ERROR".to_string(),
                }),
            )
        })?;

    // Store encryption key for this session
    let encryption_key = EncryptionKey::new(session_key_bytes);
    state.auth_state.session_manager.set_encryption_key(&request.session_token, encryption_key);

    Ok(Json(KeyExchangeResponse {
        server_public_key: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            server_public,
        ),
        encryption_enabled: true,
    }))
}

/// Logout endpoint
pub async fn logout(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<LogoutRequest>,
) -> StatusCode {
    state.auth_state.session_manager.revoke_session(&request.session_token);
    StatusCode::OK
}

/// Session validation endpoint
/// SECURITY: Uses Authorization header instead of query params to prevent token logging
pub async fn validate_session(
    State(state): State<Arc<ServerState>>,
    auth_header: Option<TypedHeader<Authorization<Bearer>>>,
) -> Json<SessionResponse> {
    // Extract token from Authorization header
    let token = match auth_header {
        Some(TypedHeader(Authorization(bearer))) => bearer.token().to_string(),
        None => {
            return Json(SessionResponse {
                valid: false,
                user_id: None,
                expires_in_seconds: None,
            });
        }
    };

    match state.auth_state.session_manager.validate_token(&token) {
        Some((_, user_id)) => Json(SessionResponse {
            valid: true,
            user_id: Some(user_id),
            expires_in_seconds: Some(state.config.session_timeout_seconds),
        }),
        None => Json(SessionResponse {
            valid: false,
            user_id: None,
            expires_in_seconds: None,
        }),
    }
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: String,
}
