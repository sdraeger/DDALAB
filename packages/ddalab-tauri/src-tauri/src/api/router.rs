use std::sync::Arc;
use axum::{
    Router,
    routing::{get, post, delete, put},
    middleware,
    http::StatusCode,
    extract::DefaultBodyLimit,
    Json,
};
use tower_http::cors::{CorsLayer, Any};
use crate::api::state::ApiState;
use crate::api::auth::auth_middleware;
use crate::api::handlers::{
    health,
    list_files, get_file_info, get_file_chunk,
    get_edf_info, get_edf_data, get_edf_overview, get_overview_progress,
    run_dda_analysis, get_dda_results, get_analysis_result, get_analysis_status,
    list_analysis_history, save_analysis_to_history, delete_analysis_result, rename_analysis_result,
};

pub fn create_router(state: Arc<ApiState>) -> Router {
    let public_routes = Router::new()
        .route("/api/health", get(health));

    let protected_routes = Router::new()
        .route("/api/files/list", get(list_files))
        .route("/api/files/{file_path}", get(get_file_info))
        .route("/api/files/{file_path}/chunk", get(get_file_chunk))
        .route("/api/edf/info", get(get_edf_info))
        .route("/api/edf/data", get(get_edf_data))
        .route("/api/edf/overview", get(get_edf_overview))
        .route("/api/edf/overview/progress", get(get_overview_progress))
        .route("/api/dda", post(run_dda_analysis))
        .route("/api/dda/analyze", post(run_dda_analysis))
        .route("/api/dda/results", get(get_dda_results))
        .route("/api/dda/results/{analysis_id}", get(get_analysis_result))
        .route("/api/dda/results/{analysis_id}", delete(delete_analysis_result))
        .route("/api/dda/status/{analysis_id}", get(get_analysis_status))
        .route("/api/dda/history", get(list_analysis_history))
        .route("/api/dda/history/save", post(save_analysis_to_history))
        .route("/api/dda/history/{analysis_id}", get(get_analysis_result))
        .route("/api/dda/history/{analysis_id}", delete(delete_analysis_result))
        .route("/api/dda/history/{analysis_id}/rename", put(rename_analysis_result))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware));

    Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .fallback(handle_404)
        .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100 MB limit
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state)
}

async fn handle_404() -> (StatusCode, Json<serde_json::Value>) {
    log::warn!("404 - Endpoint not found");
    (StatusCode::NOT_FOUND, Json(serde_json::json!({
        "error": "Endpoint not found",
        "message": "The requested API endpoint is not implemented in the embedded server"
    })))
}
