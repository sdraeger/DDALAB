use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    Json,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::state::ServerState;
use crate::storage::{
    FederatedInstitutionSummary, FederationInvite, FederationStore, FederationTrust,
    PostgresFederationStore, TrustLevel,
};

/// Create invite request
#[derive(Debug, Deserialize)]
pub struct CreateInviteRequest {
    pub institution_id: Uuid,
    pub to_institution_name: Option<String>,
    #[serde(default = "default_expiry_days")]
    pub expiry_days: u32,
}

fn default_expiry_days() -> u32 {
    7
}

/// Accept invite request
#[derive(Debug, Deserialize)]
pub struct AcceptInviteRequest {
    pub invite_token: String,
    pub institution_id: Uuid,
}

/// Update trust level request
#[derive(Debug, Deserialize)]
pub struct UpdateTrustLevelRequest {
    pub trust_level: TrustLevel,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct FederationErrorResponse {
    pub error: String,
    pub code: String,
}

/// Invite response with token
#[derive(Debug, Serialize)]
pub struct InviteResponse {
    pub invite: FederationInvite,
    pub share_url: String,
}

/// Extract user ID from authorization header
fn extract_user_from_auth(
    state: &ServerState,
    headers: &axum::http::HeaderMap,
) -> Result<(Uuid, String), (StatusCode, Json<FederationErrorResponse>)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(FederationErrorResponse {
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
        .and_then(|(_, user_id)| Uuid::try_parse(&user_id).ok().map(|uuid| (uuid, user_id)))
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(FederationErrorResponse {
                    error: "Invalid session or user ID format".to_string(),
                    code: "UNAUTHORIZED".to_string(),
                }),
            )
        })
}

/// Helper to get federation store using shared pool
fn get_store(state: &ServerState) -> PostgresFederationStore {
    PostgresFederationStore::new(state.db_pool.clone())
}

/// Create a federation invite
pub async fn create_invite(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<CreateInviteRequest>,
) -> Result<Json<InviteResponse>, (StatusCode, Json<FederationErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Generate secure token
    let invite_token = format!("{}-{}", Uuid::new_v4(), Uuid::new_v4());

    let invite = FederationInvite {
        id: Uuid::new_v4(),
        from_institution_id: request.institution_id,
        to_institution_id: None,
        to_institution_name: request.to_institution_name,
        invite_token: invite_token.clone(),
        created_by: user_uuid,
        created_at: Utc::now(),
        expires_at: Utc::now() + Duration::days(request.expiry_days as i64),
        accepted_at: None,
        revoked_at: None,
    };

    store.create_invite(&invite).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "CREATE_ERROR".to_string(),
            }),
        )
    })?;

    let share_url = format!("ddalab://federation/accept?token={}", invite_token);

    Ok(Json(InviteResponse {
        invite,
        share_url,
    }))
}

/// Get invite by token
pub async fn get_invite(
    State(state): State<Arc<ServerState>>,
    Path(token): Path<String>,
) -> Result<Json<FederationInvite>, (StatusCode, Json<FederationErrorResponse>)> {
    let store = get_store(&state);

    let invite = store.get_invite_by_token(&token).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "INVITE_NOT_FOUND".to_string(),
            }),
        )
    })?;

    // Check if invite is still valid
    if !invite.is_valid() {
        return Err((
            StatusCode::GONE,
            Json(FederationErrorResponse {
                error: "Invite has expired or been used".to_string(),
                code: "INVITE_EXPIRED".to_string(),
            }),
        ));
    }

    Ok(Json(invite))
}

/// Accept a federation invite
pub async fn accept_invite(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<AcceptInviteRequest>,
) -> Result<Json<FederationTrust>, (StatusCode, Json<FederationErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Get the invite first to get its ID
    let invite = store
        .get_invite_by_token(&request.invite_token)
        .await
        .map_err(|e| {
            (
                StatusCode::NOT_FOUND,
                Json(FederationErrorResponse {
                    error: e.to_string(),
                    code: "INVITE_NOT_FOUND".to_string(),
                }),
            )
        })?;

    // Check if invite is still valid
    if !invite.is_valid() {
        return Err((
            StatusCode::GONE,
            Json(FederationErrorResponse {
                error: "Invite has expired or been used".to_string(),
                code: "INVITE_EXPIRED".to_string(),
            }),
        ));
    }

    // Cannot accept own invite
    if invite.from_institution_id == request.institution_id {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(FederationErrorResponse {
                error: "Cannot accept invite from same institution".to_string(),
                code: "SAME_INSTITUTION".to_string(),
            }),
        ));
    }

    let trust = store
        .accept_invite(invite.id, request.institution_id, user_uuid)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(FederationErrorResponse {
                    error: e.to_string(),
                    code: "ACCEPT_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(trust))
}

/// Revoke a federation invite
pub async fn revoke_invite(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(invite_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<FederationErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Get invite to verify ownership
    let invite = store.get_invite(invite_id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "INVITE_NOT_FOUND".to_string(),
            }),
        )
    })?;

    // Verify the user created this invite
    if invite.created_by != user_uuid {
        return Err((
            StatusCode::FORBIDDEN,
            Json(FederationErrorResponse {
                error: "Cannot revoke invite created by another user".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    store.revoke_invite(invite_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "REVOKE_ERROR".to_string(),
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// List pending invites from an institution
///
/// SECURITY NOTE: This endpoint currently only verifies the user is authenticated,
/// but does not verify they belong to the requested institution. Full institution
/// membership checks require adding institution_id to the User model.
/// For now, this relies on application-level security (client only requests their own institution).
pub async fn list_pending_invites(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(institution_id): Path<Uuid>,
) -> Result<Json<Vec<FederationInvite>>, (StatusCode, Json<FederationErrorResponse>)> {
    // TODO: Add institution membership check once User model has institution_id
    let _ = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    let invites = store
        .list_pending_invites(institution_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(FederationErrorResponse {
                    error: e.to_string(),
                    code: "LIST_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(invites))
}

/// List federated institutions
///
/// SECURITY NOTE: This endpoint currently only verifies the user is authenticated,
/// but does not verify they belong to the requested institution. Full institution
/// membership checks require adding institution_id to the User model.
/// For now, this relies on application-level security (client only requests their own institution).
pub async fn list_federated_institutions(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(institution_id): Path<Uuid>,
) -> Result<Json<Vec<FederatedInstitutionSummary>>, (StatusCode, Json<FederationErrorResponse>)> {
    // TODO: Add institution membership check once User model has institution_id
    let _ = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    let institutions = store
        .get_federated_institutions(institution_id)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(FederationErrorResponse {
                    error: e.to_string(),
                    code: "LIST_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(institutions))
}

/// Update trust level
pub async fn update_trust_level(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(trust_id): Path<Uuid>,
    Json(request): Json<UpdateTrustLevelRequest>,
) -> Result<StatusCode, (StatusCode, Json<FederationErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Get trust to verify user has authority
    let trust = store.get_trust(trust_id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "TRUST_NOT_FOUND".to_string(),
            }),
        )
    })?;

    // Verify the user established this trust relationship
    // TODO: Also allow users who are verified members of either institution
    // (requires user-institution mapping to be implemented)
    if trust.established_by != user_uuid {
        return Err((
            StatusCode::FORBIDDEN,
            Json(FederationErrorResponse {
                error: "Only the user who established this federation can modify it".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    store
        .update_trust_level(trust_id, request.trust_level)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(FederationErrorResponse {
                    error: e.to_string(),
                    code: "UPDATE_ERROR".to_string(),
                }),
            )
        })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Revoke trust relationship
pub async fn revoke_trust(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(trust_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<FederationErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Get trust to verify user has authority
    let trust = store.get_trust(trust_id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "TRUST_NOT_FOUND".to_string(),
            }),
        )
    })?;

    // Verify the user established this trust relationship
    // TODO: Also allow users who are verified members of either institution
    // (requires user-institution mapping to be implemented)
    if trust.established_by != user_uuid {
        return Err((
            StatusCode::FORBIDDEN,
            Json(FederationErrorResponse {
                error: "Only the user who established this federation can revoke it".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    store.revoke_trust(trust_id, user_uuid).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(FederationErrorResponse {
                error: e.to_string(),
                code: "REVOKE_ERROR".to_string(),
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Check if two institutions are federated
pub async fn check_federation(
    State(state): State<Arc<ServerState>>,
    Path((institution_a, institution_b)): Path<(Uuid, Uuid)>,
) -> Result<Json<Option<FederationTrust>>, (StatusCode, Json<FederationErrorResponse>)> {
    let store = get_store(&state);

    let trust = store
        .are_federated(institution_a, institution_b)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(FederationErrorResponse {
                    error: e.to_string(),
                    code: "CHECK_ERROR".to_string(),
                }),
            )
        })?;

    Ok(Json(trust))
}
