use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::manifest::{PluginCategory, PluginManifest, PluginPermission};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryIndex {
    pub version: u32,
    pub updated_at: String,
    pub registry_url: Option<String>,
    pub plugins: Vec<RegistryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub category: String,
    pub permissions: Vec<String>,
    pub artifact_url: String,
    pub sha256: String,
    pub min_ddalab_version: Option<String>,
    pub published_at: String,
}

impl RegistryEntry {
    pub fn to_manifest(&self) -> PluginManifest {
        let permissions: Vec<PluginPermission> = self
            .permissions
            .iter()
            .filter_map(|p| match p.as_str() {
                "ReadChannelData" => Some(PluginPermission::ReadChannelData),
                "WriteResults" => Some(PluginPermission::WriteResults),
                "ReadMetadata" => Some(PluginPermission::ReadMetadata),
                _ => None,
            })
            .collect();

        let category = match self.category.as_str() {
            "preprocessing" => PluginCategory::Preprocessing,
            "visualization" => PluginCategory::Visualization,
            "export" => PluginCategory::Export,
            _ => PluginCategory::Analysis,
        };

        PluginManifest {
            id: self.id.clone(),
            name: self.name.clone(),
            version: self.version.clone(),
            description: self.description.clone(),
            author: self.author.clone(),
            license: None,
            permissions,
            category,
            entry_point: "plugin.wasm".to_string(),
            min_ddalab_version: self.min_ddalab_version.clone(),
        }
    }
}

pub struct RegistryClient {
    http_client: reqwest::Client,
}

impl RegistryClient {
    pub fn new() -> Self {
        Self {
            http_client: reqwest::Client::new(),
        }
    }

    pub async fn fetch_index(&self, registry_url: &str) -> Result<RegistryIndex> {
        let url = if registry_url.ends_with("/registry.json") {
            registry_url.to_string()
        } else {
            format!("{}/registry.json", registry_url.trim_end_matches('/'))
        };

        let response = self
            .http_client
            .get(&url)
            .send()
            .await
            .context("Failed to fetch registry index")?;

        if !response.status().is_success() {
            bail!("Registry returned status {}: {}", response.status(), url);
        }

        let index: RegistryIndex = response
            .json()
            .await
            .context("Failed to parse registry index")?;

        Ok(index)
    }

    pub async fn search(&self, registry_url: &str, query: &str) -> Result<Vec<RegistryEntry>> {
        let index = self.fetch_index(registry_url).await?;
        let q = query.to_lowercase();

        let results: Vec<RegistryEntry> = index
            .plugins
            .into_iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&q)
                    || p.description.to_lowercase().contains(&q)
                    || p.category.to_lowercase().contains(&q)
                    || p.id.to_lowercase().contains(&q)
            })
            .collect();

        Ok(results)
    }

    pub async fn download_artifact(&self, entry: &RegistryEntry) -> Result<Vec<u8>> {
        let response = self
            .http_client
            .get(&entry.artifact_url)
            .send()
            .await
            .context("Failed to download plugin artifact")?;

        if !response.status().is_success() {
            bail!(
                "Download failed with status {}: {}",
                response.status(),
                entry.artifact_url
            );
        }

        let bytes = response
            .bytes()
            .await
            .context("Failed to read artifact bytes")?
            .to_vec();

        // Verify SHA-256
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let computed = hex::encode(hasher.finalize());

        if computed != entry.sha256 {
            bail!(
                "SHA-256 verification failed for {}: expected {}, got {}",
                entry.id,
                entry.sha256,
                computed
            );
        }

        log::info!(
            "Downloaded and verified {} ({} bytes)",
            entry.id,
            bytes.len()
        );

        Ok(bytes)
    }
}
