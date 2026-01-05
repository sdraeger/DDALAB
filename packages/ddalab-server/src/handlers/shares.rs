use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::state::ServerState;
use crate::storage::{AccessPolicy, ShareMetadata, ShareableContentType, SharedResultInfo};

/// Maximum lengths for input validation
const MAX_TOKEN_LENGTH: usize = 128;
const MAX_USER_ID_LENGTH: usize = 256;
const MAX_TITLE_LENGTH: usize = 512;
const MAX_DESCRIPTION_LENGTH: usize = 4096;

/// Create share request
#[derive(Debug, Deserialize)]
pub struct CreateShareRequest {
    pub token: String,
    #[serde(default)]
    pub content_type: ShareableContentType,
    pub content_id: String,
    pub title: String,
    pub description: Option<String>,
    pub access_policy: AccessPolicy,
    pub owner_user_id: String,
}

/// Pagination query parameters
#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

fn default_limit() -> usize {
    100
}

/// Validate input lengths to prevent DoS
fn validate_create_request(req: &CreateShareRequest) -> Result<(), ShareErrorResponse> {
    if req.token.len() > MAX_TOKEN_LENGTH {
        return Err(ShareErrorResponse {
            error: "Token too long".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }
    if req.owner_user_id.len() > MAX_USER_ID_LENGTH {
        return Err(ShareErrorResponse {
            error: "User ID too long".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }
    if req.title.len() > MAX_TITLE_LENGTH {
        return Err(ShareErrorResponse {
            error: "Title too long".to_string(),
            code: "INVALID_INPUT".to_string(),
        });
    }
    if let Some(ref desc) = req.description {
        if desc.len() > MAX_DESCRIPTION_LENGTH {
            return Err(ShareErrorResponse {
                error: "Description too long".to_string(),
                code: "INVALID_INPUT".to_string(),
            });
        }
    }
    Ok(())
}

/// Share list response
#[derive(Debug, Serialize)]
pub struct ShareListResponse {
    pub shares: Vec<String>,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct ShareErrorResponse {
    pub error: String,
    pub code: String,
}

/// Create a new share
pub async fn create_share(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<CreateShareRequest>,
) -> Result<StatusCode, (StatusCode, Json<ShareErrorResponse>)> {
    // Validate input
    validate_create_request(&request).map_err(|e| (StatusCode::BAD_REQUEST, Json(e)))?;

    // SECURITY: Verify the caller is the owner (extract from auth header)
    let caller_user_id = extract_user_from_auth(&state, &headers)?;
    if caller_user_id != request.owner_user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ShareErrorResponse {
                error: "Cannot create share for another user".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    let metadata = ShareMetadata {
        owner_user_id: request.owner_user_id,
        content_type: request.content_type,
        content_id: request.content_id,
        title: request.title,
        description: request.description,
        created_at: chrono::Utc::now(),
        access_policy: request.access_policy,
        classification: Default::default(),
        download_count: 0,
        last_accessed_at: None,
    };

    state
        .share_store
        .publish_result(&request.token, metadata, None)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ShareErrorResponse {
                    error: e.to_string(),
                    code: "PUBLISH_ERROR".to_string(),
                }),
            )
        })?;

    Ok(StatusCode::CREATED)
}

/// Extract user ID from authorization header
fn extract_user_from_auth(
    state: &ServerState,
    headers: &axum::http::HeaderMap,
) -> Result<String, (StatusCode, Json<ShareErrorResponse>)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ShareErrorResponse {
                    error: "Missing authorization".to_string(),
                    code: "UNAUTHORIZED".to_string(),
                }),
            )
        })?;

    let token = if auth_header.starts_with("Bearer ") {
        &auth_header[7..]
    } else {
        auth_header
    };

    state
        .auth_state
        .session_manager
        .validate_token(token)
        .map(|(_, user_id)| user_id)
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(ShareErrorResponse {
                    error: "Invalid session".to_string(),
                    code: "UNAUTHORIZED".to_string(),
                }),
            )
        })
}

/// Get share info by token
pub async fn get_share(
    State(state): State<Arc<ServerState>>,
    Path(token): Path<String>,
) -> Result<Json<SharedResultInfo>, (StatusCode, Json<ShareErrorResponse>)> {
    let metadata = state
        .share_store
        .get_shared_result(&token)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ShareErrorResponse {
                    error: e.to_string(),
                    code: "SHARE_NOT_FOUND".to_string(),
                }),
            )
        })?;

    // Check if owner is online
    let owner_online = state.registry.is_online(&metadata.owner_user_id);
    let download_url = if owner_online {
        state
            .registry
            .get_connection(&metadata.owner_user_id)
            .map(|conn| format!("{}/api/results/{}", conn.endpoint, metadata.content_id))
            .unwrap_or_default()
    } else {
        String::new()
    };

    Ok(Json(SharedResultInfo {
        metadata,
        download_url,
        owner_online,
    }))
}

/// Revoke a share
pub async fn revoke_share(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(token): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ShareErrorResponse>)> {
    // Validate token length
    if token.len() > MAX_TOKEN_LENGTH {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ShareErrorResponse {
                error: "Token too long".to_string(),
                code: "INVALID_INPUT".to_string(),
            }),
        ));
    }

    // SECURITY: Verify the caller owns this share
    let caller_user_id = extract_user_from_auth(&state, &headers)?;

    // Get the share to verify ownership
    let metadata = state
        .share_store
        .get_shared_result(&token)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(ShareErrorResponse {
                    error: e.to_string(),
                    code: "SHARE_NOT_FOUND".to_string(),
                }),
            )
        })?;

    if metadata.owner_user_id != caller_user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ShareErrorResponse {
                error: "Cannot revoke another user's share".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    state
        .share_store
        .revoke_share(&token)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ShareErrorResponse {
                    error: e.to_string(),
                    code: "REVOKE_ERROR".to_string(),
                }),
            )
        })?;

    Ok(StatusCode::OK)
}

/// List shares for a user (only the user can list their own shares)
pub async fn list_user_shares(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(user_id): Path<String>,
    Query(pagination): Query<PaginationQuery>,
) -> Result<Json<ShareListResponse>, (StatusCode, Json<ShareErrorResponse>)> {
    // Validate user_id length
    if user_id.len() > MAX_USER_ID_LENGTH {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ShareErrorResponse {
                error: "User ID too long".to_string(),
                code: "INVALID_INPUT".to_string(),
            }),
        ));
    }

    // SECURITY: Only allow users to list their own shares
    let caller_user_id = extract_user_from_auth(&state, &headers)?;
    if caller_user_id != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(ShareErrorResponse {
                error: "Cannot list another user's shares".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    // Enforce pagination limits
    let limit = pagination.limit.min(1000); // Max 1000 per request
    let offset = pagination.offset;

    let all_shares = state
        .share_store
        .list_user_shares(&user_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ShareErrorResponse {
                    error: e.to_string(),
                    code: "LIST_ERROR".to_string(),
                }),
            )
        })?;

    // Apply pagination
    let shares: Vec<String> = all_shares
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();

    Ok(Json(ShareListResponse { shares }))
}
