use crate::api::auth::auth_middleware;
use crate::api::handlers::{
    delete_analysis_result, delete_ica_result, get_analysis_result, get_analysis_status,
    get_dda_results, get_edf_data, get_edf_info, get_edf_overview, get_file_chunk, get_file_info,
    get_ica_result, get_ica_results, get_overview_progress, health, list_analysis_history,
    list_files, reconstruct_without_components, rename_analysis_result, run_dda_analysis,
    run_ica_analysis, save_analysis_to_history,
};
use crate::api::state::ApiState;
use axum::{
    extract::DefaultBodyLimit,
    http::StatusCode,
    middleware,
    routing::{delete, get, post, put},
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

pub fn create_router(state: Arc<ApiState>) -> Router {
    let public_routes = Router::new().route("/api/health", get(health));

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
        ));

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
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({
            "error": "Endpoint not found",
            "message": "The requested API endpoint is not implemented in the embedded server"
        })),
    )
}
