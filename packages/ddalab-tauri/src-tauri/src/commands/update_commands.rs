use tauri::Manager;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
    pub release_date: Option<String>,
    pub download_url: Option<String>,
}

/// Check for available updates by comparing current version with latest GitHub release
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    log::info!("Checking for updates. Current version: {}", current_version);

    // Fetch latest release from GitHub API
    let client = reqwest::Client::builder()
        .user_agent("DDALAB")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get("https://api.github.com/repos/sdraeger/DDALAB/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest release: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub response: {}", e))?;

    // Parse version numbers for comparison
    let latest_version = release.tag_name.trim_start_matches('v').to_string();

    log::info!("Latest version from GitHub: {}", latest_version);

    // Compare versions
    let update_available = is_newer_version(&current_version, &latest_version);

    log::info!("Update available: {}", update_available);

    Ok(UpdateInfo {
        available: update_available,
        current_version,
        latest_version: Some(latest_version),
        release_notes: Some(release.body),
        release_date: Some(release.published_at),
        download_url: Some(release.html_url),
    })
}

/// Compare two semver version strings
fn is_newer_version(current: &str, latest: &str) -> bool {
    let current_parts: Vec<u32> = current
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    let latest_parts: Vec<u32> = latest
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();

    // Pad with zeros if needed
    let max_len = current_parts.len().max(latest_parts.len());
    let current_padded: Vec<u32> = (0..max_len)
        .map(|i| current_parts.get(i).copied().unwrap_or(0))
        .collect();
    let latest_padded: Vec<u32> = (0..max_len)
        .map(|i| latest_parts.get(i).copied().unwrap_or(0))
        .collect();

    // Compare version components
    for (curr, lat) in current_padded.iter().zip(latest_padded.iter()) {
        if lat > curr {
            return true;
        } else if lat < curr {
            return false;
        }
    }

    false
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: String,
    body: String,
    html_url: String,
    published_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version_comparison() {
        assert!(is_newer_version("0.1.0", "0.2.0"));
        assert!(is_newer_version("0.1.0", "1.0.0"));
        assert!(is_newer_version("1.0.0", "1.0.1"));
        assert!(is_newer_version("1.0.0", "1.1.0"));

        assert!(!is_newer_version("1.0.0", "0.9.0"));
        assert!(!is_newer_version("1.0.0", "1.0.0"));
        assert!(!is_newer_version("2.0.0", "1.9.9"));
    }
}
