use reqwest;
use std::time::Duration;

#[tauri::command]
pub async fn check_api_connection(url: String) -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(&format!("{}/api/health", url)).send().await {
        Ok(response) => {
            log::info!("API check: {} -> {}", url, response.status());
            Ok(response.status().is_success())
        },
        Err(e) => {
            log::warn!("API check failed: {} -> {}", url, e);
            Ok(false)
        },
    }
}
