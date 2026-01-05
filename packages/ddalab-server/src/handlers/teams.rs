use axum::{
    extract::{Path, State},
    http::{header, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::state::ServerState;
use crate::storage::{PostgresTeamStore, Team, TeamMember, TeamRole, TeamStore, TeamSummary};

/// Maximum lengths for input validation
const MAX_NAME_LENGTH: usize = 256;
const MAX_DESCRIPTION_LENGTH: usize = 1024;

/// Helper to get team store using shared pool
fn get_store(state: &ServerState) -> PostgresTeamStore {
    PostgresTeamStore::new(state.db_pool.clone())
}

/// Create team request
#[derive(Debug, Deserialize)]
pub struct CreateTeamRequest {
    pub name: String,
    pub description: Option<String>,
    pub institution_id: Uuid,
}

/// Update team request
#[derive(Debug, Deserialize)]
pub struct UpdateTeamRequest {
    pub name: String,
    pub description: Option<String>,
}

/// Add member request
#[derive(Debug, Deserialize)]
pub struct AddMemberRequest {
    pub user_id: Uuid,
    #[serde(default)]
    pub role: TeamRole,
}

/// Update member role request
#[derive(Debug, Deserialize)]
pub struct UpdateMemberRoleRequest {
    pub role: TeamRole,
}

/// Team response with members
#[derive(Debug, Serialize)]
pub struct TeamResponse {
    pub team: Team,
    pub members: Vec<TeamMember>,
}

/// Error response
#[derive(Debug, Serialize)]
pub struct TeamErrorResponse {
    pub error: String,
    pub code: String,
}

/// Extract user ID from authorization header
fn extract_user_from_auth(
    state: &ServerState,
    headers: &axum::http::HeaderMap,
) -> Result<(Uuid, String), (StatusCode, Json<TeamErrorResponse>)> {
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(TeamErrorResponse {
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
        .and_then(|(_, user_id)| {
            // Parse user_id as UUID - the system should store UUIDs
            Uuid::try_parse(&user_id)
                .ok()
                .map(|uuid| (uuid, user_id))
        })
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(TeamErrorResponse {
                    error: "Invalid session or user ID format".to_string(),
                    code: "UNAUTHORIZED".to_string(),
                }),
            )
        })
}

/// Create a new team
pub async fn create_team(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Json(request): Json<CreateTeamRequest>,
) -> Result<Json<Team>, (StatusCode, Json<TeamErrorResponse>)> {
    // Validate input
    if request.name.len() > MAX_NAME_LENGTH {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(TeamErrorResponse {
                error: "Team name too long".to_string(),
                code: "INVALID_INPUT".to_string(),
            }),
        ));
    }
    if let Some(ref desc) = request.description {
        if desc.len() > MAX_DESCRIPTION_LENGTH {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(TeamErrorResponse {
                    error: "Description too long".to_string(),
                    code: "INVALID_INPUT".to_string(),
                }),
            ));
        }
    }

    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;

    let team = Team {
        id: Uuid::new_v4(),
        institution_id: request.institution_id,
        name: request.name,
        description: request.description,
        created_by: user_uuid,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    };

    let store = get_store(&state);

    store.create_team(&team).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "CREATE_ERROR".to_string(),
            }),
        )
    })?;

    // Add creator as admin
    let member = TeamMember {
        team_id: team.id,
        user_id: user_uuid,
        role: TeamRole::Admin,
        added_at: chrono::Utc::now(),
        added_by: Some(user_uuid),
    };
    store.add_team_member(&member).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "ADD_MEMBER_ERROR".to_string(),
            }),
        )
    })?;

    Ok(Json(team))
}

/// Get team details with members
pub async fn get_team(
    State(state): State<Arc<ServerState>>,
    Path(team_id): Path<Uuid>,
) -> Result<Json<TeamResponse>, (StatusCode, Json<TeamErrorResponse>)> {
    let store = get_store(&state);

    let team = store.get_team(team_id).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "TEAM_NOT_FOUND".to_string(),
            }),
        )
    })?;

    let members = store.get_team_members(team_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "MEMBERS_ERROR".to_string(),
            }),
        )
    })?;

    Ok(Json(TeamResponse { team, members }))
}

/// List teams for an institution
pub async fn list_institution_teams(
    State(state): State<Arc<ServerState>>,
    Path(institution_id): Path<Uuid>,
) -> Result<Json<Vec<TeamSummary>>, (StatusCode, Json<TeamErrorResponse>)> {
    let store = get_store(&state);

    let teams = store.list_institution_teams(institution_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "LIST_ERROR".to_string(),
            }),
        )
    })?;

    Ok(Json(teams))
}

/// List teams the current user belongs to
pub async fn list_my_teams(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<TeamSummary>>, (StatusCode, Json<TeamErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    let teams = store.list_user_teams(user_uuid).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "LIST_ERROR".to_string(),
            }),
        )
    })?;

    Ok(Json(teams))
}

/// Delete a team
pub async fn delete_team(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(team_id): Path<Uuid>,
) -> Result<StatusCode, (StatusCode, Json<TeamErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Check if user is team admin
    if !store.is_team_admin(team_id, user_uuid).await.unwrap_or(false) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(TeamErrorResponse {
                error: "Not a team admin".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    store.delete_team(team_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "DELETE_ERROR".to_string(),
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}

/// Add member to team
pub async fn add_team_member(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path(team_id): Path<Uuid>,
    Json(request): Json<AddMemberRequest>,
) -> Result<StatusCode, (StatusCode, Json<TeamErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Check if user is team admin
    if !store.is_team_admin(team_id, user_uuid).await.unwrap_or(false) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(TeamErrorResponse {
                error: "Not a team admin".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    let member = TeamMember {
        team_id,
        user_id: request.user_id,
        role: request.role,
        added_at: chrono::Utc::now(),
        added_by: Some(user_uuid),
    };

    store.add_team_member(&member).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "ADD_MEMBER_ERROR".to_string(),
            }),
        )
    })?;

    Ok(StatusCode::CREATED)
}

/// Remove member from team
pub async fn remove_team_member(
    State(state): State<Arc<ServerState>>,
    headers: axum::http::HeaderMap,
    Path((team_id, member_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, (StatusCode, Json<TeamErrorResponse>)> {
    let (user_uuid, _) = extract_user_from_auth(&state, &headers)?;
    let store = get_store(&state);

    // Check if user is team admin or removing self
    let is_admin = store.is_team_admin(team_id, user_uuid).await.unwrap_or(false);
    if !is_admin && user_uuid != member_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(TeamErrorResponse {
                error: "Not authorized".to_string(),
                code: "FORBIDDEN".to_string(),
            }),
        ));
    }

    store.remove_team_member(team_id, member_id).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(TeamErrorResponse {
                error: e.to_string(),
                code: "REMOVE_MEMBER_ERROR".to_string(),
            }),
        )
    })?;

    Ok(StatusCode::NO_CONTENT)
}
