use axum::{
    extract::{ConnectInfo, Request, State},
    http::header,
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::error;
use uuid::Uuid;

use crate::auth::SessionManager;
use crate::storage::{AuditAction, AuditEntryBuilder, AuditStore};

/// State for the audit middleware
#[derive(Clone)]
pub struct AuditMiddlewareState {
    pub audit_store: Arc<dyn AuditStore>,
    pub session_manager: SessionManager,
}

/// Mapping of HTTP routes to audit actions
fn route_to_action(method: &str, path: &str) -> Option<AuditAction> {
    match (method, path) {
        // Authentication
        ("POST", "/auth/login") => Some(AuditAction::LoginSuccess), // Will be updated on failure
        ("POST", "/auth/logout") => Some(AuditAction::Logout),

        // Jobs
        ("POST", "/api/jobs/submit") => Some(AuditAction::JobSubmitted),
        ("POST", "/api/jobs/upload") => Some(AuditAction::JobSubmitted),
        ("POST", p) if p.ends_with("/cancel") => Some(AuditAction::JobCancelled),
        ("GET", p) if p.contains("/download") => Some(AuditAction::JobResultsDownloaded),

        // Files
        ("GET", "/api/files") => Some(AuditAction::FileListed),

        // Shares
        ("POST", "/api/shares") => Some(AuditAction::ShareCreated),
        ("GET", p) if p.starts_with("/api/shares/") && !p.contains("/user/") => {
            Some(AuditAction::ShareAccessed)
        }
        ("DELETE", p) if p.starts_with("/api/shares/") => Some(AuditAction::ShareRevoked),

        // Default - log as generic API request for protected routes
        (_, p) if p.starts_with("/api/") => Some(AuditAction::ApiRequest),

        // Don't log health checks and other public routes
        _ => None,
    }
}

/// Extract resource info from path
fn extract_resource(path: &str) -> (Option<String>, Option<String>) {
    let parts: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    match parts.as_slice() {
        // /api/jobs/{job_id}
        ["api", "jobs", job_id, ..] if !job_id.contains("submit") && !job_id.contains("upload") && !job_id.contains("stats") => {
            (Some("job".to_string()), Some(job_id.to_string()))
        }
        // /api/shares/{token}
        ["api", "shares", token, ..] if !token.contains("user") => {
            (Some("share".to_string()), Some(token.to_string()))
        }
        _ => (None, None),
    }
}

/// Audit middleware that logs HTTP requests
pub async fn audit_middleware(
    State(state): State<AuditMiddlewareState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().as_str().to_string();
    let path = request.uri().path().to_string();

    // Check if this route should be audited
    let action = match route_to_action(&method, &path) {
        Some(a) => a,
        None => return next.run(request).await,
    };

    // Extract user info from auth header if present
    let (user_id, user_email) = extract_user_from_request(&request, &state.session_manager);

    // Extract other request info
    let ip_address = addr.ip().to_string();
    let user_agent = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let (resource_type, resource_id) = extract_resource(&path);

    // Run the actual request
    let response = next.run(request).await;

    // Get response status
    let status = response.status().as_u16() as i32;
    let success = response.status().is_success();

    // Adjust action for login failures
    let final_action = if matches!(action, AuditAction::LoginSuccess) && !success {
        AuditAction::LoginFailed
    } else {
        action
    };

    // Build and log the audit entry
    let mut builder = AuditEntryBuilder::new(final_action)
        .ip_address(&ip_address)
        .http_request(&method, &path)
        .http_status(status)
        .success(success);

    if let Some(uid) = user_id {
        builder = builder.user_id(uid);
    }
    if let Some(email) = user_email {
        builder = builder.user_email(&email);
    }
    if let Some(ua) = user_agent {
        builder = builder.user_agent(&ua);
    }
    if let (Some(rt), Some(ri)) = (resource_type, resource_id) {
        builder = builder.resource(&rt, &ri);
    }

    let entry = builder.build();

    // Log asynchronously (don't block the response)
    let audit_store = state.audit_store.clone();
    tokio::spawn(async move {
        if let Err(e) = audit_store.log(entry).await {
            error!("Failed to log audit entry: {}", e);
        }
    });

    response
}

/// Extract user ID and email from the request's authorization token
fn extract_user_from_request(
    request: &Request,
    session_manager: &SessionManager,
) -> (Option<Uuid>, Option<String>) {
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let token = match auth_header {
        Some(h) if h.starts_with("Bearer ") => &h[7..],
        Some(h) => h,
        None => return (None, None),
    };

    // Validate token and get user info
    match session_manager.validate_token(token) {
        Some((_session_id, user_id)) => {
            // For now, we only have user_id (which is email in the new system)
            // The session stores the email as user_id
            (None, Some(user_id))
        }
        None => (None, None),
    }
}
