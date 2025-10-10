use serde::Deserialize;
use tracing::{debug, info};

const DOCKER_HUB_API: &str = "https://hub.docker.com/v2/repositories/sdraeger1/ddalab-sync-broker/tags";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const CHECK_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Deserialize)]
struct DockerHubResponse {
    results: Vec<TagInfo>,
}

#[derive(Debug, Deserialize)]
struct TagInfo {
    name: String,
}

/// Check if a newer version is available on Docker Hub
pub async fn check_for_updates() -> Option<String> {
    debug!("Checking Docker Hub for updates...");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(CHECK_TIMEOUT_SECS))
        .build()
        .ok()?;

    match client.get(DOCKER_HUB_API).send().await {
        Ok(response) => {
            if !response.status().is_success() {
                debug!("Docker Hub API returned non-success status: {}", response.status());
                return None;
            }

            match response.json::<DockerHubResponse>().await {
                Ok(data) => {
                    // Find the latest semantic version tag (ignore 'latest', 'dev', etc.)
                    let latest_version = data
                        .results
                        .iter()
                        .filter_map(|tag| {
                            // Strip 'v' prefix if present and try to parse as semver
                            let version = tag.name.strip_prefix('v').unwrap_or(&tag.name);
                            version.parse::<semver::Version>().ok().map(|v| (v, tag.name.clone()))
                        })
                        .max_by_key(|(v, _)| v.clone())
                        .map(|(_, name)| name);

                    if let Some(latest) = latest_version {
                        let current = CURRENT_VERSION.parse::<semver::Version>().ok()?;
                        let latest_sem = latest.strip_prefix('v').unwrap_or(&latest).parse::<semver::Version>().ok()?;

                        if latest_sem > current {
                            debug!("Update available: {} > {}", latest, CURRENT_VERSION);
                            return Some(latest);
                        } else {
                            debug!("Running latest version: {}", CURRENT_VERSION);
                        }
                    }
                }
                Err(e) => {
                    debug!("Failed to parse Docker Hub response: {}", e);
                }
            }
        }
        Err(e) => {
            debug!("Failed to check Docker Hub (this is normal for air-gapped deployments): {}", e);
        }
    }

    None
}

/// Display update notification banner in logs
pub fn display_update_notification(latest_version: &str) {
    let border = "═".repeat(62);

    info!("");
    info!("╔{}╗", border);
    info!("║{}║", " ".repeat(62));
    info!("║   📦 UPDATE AVAILABLE{}║", " ".repeat(41));
    info!("║{}║", " ".repeat(62));
    info!("║   New version: {} (current: {}){}║",
        latest_version,
        CURRENT_VERSION,
        " ".repeat(62 - 35 - latest_version.len() - CURRENT_VERSION.len())
    );
    info!("║{}║", " ".repeat(62));
    info!("║   Update command:{}║", " ".repeat(45));
    info!("║   docker pull sdraeger1/ddalab-sync-broker:latest{}║", " ".repeat(13));
    info!("║{}║", " ".repeat(62));
    info!("╚{}╝", border);
    info!("");
}

/// Spawn background task to check for updates on startup
pub fn spawn_update_check() {
    tokio::spawn(async {
        match check_for_updates().await {
            Some(latest_version) => {
                display_update_notification(&latest_version);
            }
            None => {
                debug!("No update check needed or check failed");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_current_version_is_valid_semver() {
        assert!(CURRENT_VERSION.parse::<semver::Version>().is_ok());
    }
}
