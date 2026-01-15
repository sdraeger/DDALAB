use crate::api::auth::auth_middleware;
use crate::api::encryption_middleware::{encryption_middleware, EncryptionState};
use crate::api::handlers::{
    cancel_dda_analysis, clear_edf_cache, delete_analysis_result, delete_ica_result,
    get_analysis_result, get_analysis_status, get_dda_results, get_edf_cache_stats, get_edf_data,
    get_edf_info, get_edf_overview, get_edf_window, get_file_chunk, get_file_info, get_ica_result,
    get_ica_results, get_overview_progress, get_running_analysis_status, health,
    list_analysis_history, list_files, reconstruct_without_components, rename_analysis_result,
    run_dda_analysis, run_ica_analysis, save_analysis_to_history, update_data_directory,
};
use crate::api::state::ApiState;
use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    http::{header, HeaderName, HeaderValue, Method, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{delete, get, post, put},
    Json, Router,
};
use std::sync::Arc;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;

/// Security headers middleware - adds headers to prevent common web vulnerabilities
async fn security_headers_middleware(request: Request<Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // Prevent MIME type sniffing
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );

    // Prevent clickjacking (deny embedding in iframes from other origins)
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));

    // Enable XSS filter (legacy browsers)
    headers.insert(
        HeaderName::from_static("x-xss-protection"),
        HeaderValue::from_static("1; mode=block"),
    );

    // Referrer policy - don't leak URLs to external sites
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );

    // Content Security Policy - restrict resource loading
    // Allow 'self' for scripts/styles, data: for base64 images, blob: for dynamically generated content
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'"
        ),
    );

    // Permissions Policy - disable potentially dangerous APIs
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );

    response
}

/// Create CORS layer for localhost and Tauri origins
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
            "http://tauri.localhost".parse::<HeaderValue>().unwrap(),
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

/// Build protected routes with authentication middleware
fn build_protected_routes(state: Arc<ApiState>) -> Router<Arc<ApiState>> {
    Router::new()
        .route("/api/files/list", get(list_files))
        .route("/api/files/data-directory", put(update_data_directory))
        .route("/api/files/{file_path}", get(get_file_info))
        .route("/api/files/{file_path}/chunk", get(get_file_chunk))
        .route("/api/edf/info", get(get_edf_info))
        .route("/api/edf/data", get(get_edf_data))
        .route("/api/edf/overview", get(get_edf_overview))
        .route("/api/edf/overview/progress", get(get_overview_progress))
        // Lazy window-based access (optimized for 100GB+ files)
        .route("/api/edf/window", get(get_edf_window))
        .route("/api/edf/cache/stats", get(get_edf_cache_stats))
        .route("/api/edf/cache/clear", post(clear_edf_cache))
        .route("/api/dda", post(run_dda_analysis))
        .route("/api/dda/analyze", post(run_dda_analysis))
        .route("/api/dda/cancel", post(cancel_dda_analysis))
        .route("/api/dda/running", get(get_running_analysis_status))
        .route("/api/dda/results", get(get_dda_results))
        .route("/api/dda/results/{analysis_id}", get(get_analysis_result))
        .route(
            "/api/dda/results/{analysis_id}",
            delete(delete_analysis_result),
        )
        .route("/api/dda/status/{analysis_id}", get(get_analysis_status))
        .route("/api/dda/history", get(list_analysis_history))
        .route("/api/dda/history/save", post(save_analysis_to_history))
        .route("/api/dda/history/{analysis_id}", get(get_analysis_result))
        .route(
            "/api/dda/history/{analysis_id}",
            delete(delete_analysis_result),
        )
        .route(
            "/api/dda/history/{analysis_id}/rename",
            put(rename_analysis_result),
        )
        // ICA routes
        .route("/api/ica", post(run_ica_analysis))
        .route("/api/ica/results", get(get_ica_results))
        .route("/api/ica/results/{analysis_id}", get(get_ica_result))
        .route("/api/ica/results/{analysis_id}", delete(delete_ica_result))
        .route("/api/ica/reconstruct", post(reconstruct_without_components))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
}

pub fn create_router(state: Arc<ApiState>) -> Router {
    let public_routes = Router::new().route("/api/health", get(health));
    let protected_routes = build_protected_routes(state.clone());

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .fallback(handle_404)
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100 MB limit
        .layer(CompressionLayer::new()) // Enable gzip/br compression for responses
        .layer(cors())
        .with_state(state)
}

/// Create router with encryption middleware support
///
/// This is the primary router constructor that supports both HTTPS and HTTP+encryption modes.
/// When encryption is enabled (HTTP fallback mode), request/response bodies are transparently
/// encrypted using AES-256-GCM.
pub fn create_router_with_encryption(
    state: Arc<ApiState>,
    encryption_state: Arc<EncryptionState>,
) -> Router {
    let public_routes = Router::new().route("/api/health", get(health));
    let protected_routes = build_protected_routes(state.clone());

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .fallback(handle_404)
        .layer(middleware::from_fn_with_state(
            encryption_state,
            encryption_middleware,
        ))
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100 MB limit
        .layer(CompressionLayer::new()) // Enable gzip/br compression for responses
        .layer(cors())
        .with_state(state)
}

async fn handle_404() -> (StatusCode, Json<serde_json::Value>) {
    log::warn!("404 - Endpoint not found");
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "error": "Endpoint not found",
            "message": "The requested API endpoint is not implemented in the embedded server"
        })),
    )
}
