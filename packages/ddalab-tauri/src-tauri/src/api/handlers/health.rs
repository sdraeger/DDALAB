use axum::Json;
use chrono::Utc;
use std::collections::HashMap;
use crate::api::models::HealthStatus;

pub async fn health() -> Json<HealthStatus> {
    let mut services = HashMap::new();
    services.insert("api".to_string(), "healthy".to_string());
    services.insert("embedded".to_string(), "running".to_string());

    Json(HealthStatus {
        status: "healthy".to_string(),
        services,
        timestamp: Utc::now().to_rfc3339(),
    })
}
