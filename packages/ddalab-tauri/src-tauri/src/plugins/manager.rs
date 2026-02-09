use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::db::analysis_db::AnalysisDatabase;
use crate::db::plugins_db::{InstalledPlugin, PluginsDB};
use crate::intermediate_format::IntermediateData;

use super::manifest::{PluginManifest, PluginPermission};
use super::registry::RegistryEntry;
use super::runtime::PluginRuntime;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginOutput {
    pub plugin_id: String,
    pub results: serde_json::Value,
    pub logs: Vec<String>,
}

pub struct PluginManager {
    runtime: PluginRuntime,
    plugins_dir: PathBuf,
}

impl PluginManager {
    pub fn new(plugins_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&plugins_dir).context("Failed to create plugins directory")?;

        let runtime = PluginRuntime::new()?;

        Ok(Self {
            runtime,
            plugins_dir,
        })
    }

    pub fn plugins_dir(&self) -> &Path {
        &self.plugins_dir
    }

    pub fn install_from_bytes(
        &self,
        wasm_bytes: &[u8],
        manifest: &PluginManifest,
        source: &str,
        source_url: Option<&str>,
        db: &AnalysisDatabase,
    ) -> Result<InstalledPlugin> {
        // Compute SHA-256
        let hash = compute_sha256(wasm_bytes);

        // Validate the WASM module can be compiled
        wasmtime::Module::new(self.runtime.engine(), wasm_bytes)
            .context("WASM module validation failed")?;

        // Create plugin directory
        let plugin_dir = self.plugins_dir.join(&manifest.id).join(&manifest.version);
        std::fs::create_dir_all(&plugin_dir)
            .context("Failed to create plugin version directory")?;

        // Write WASM file
        let wasm_path = plugin_dir.join("plugin.wasm");
        std::fs::write(&wasm_path, wasm_bytes).context("Failed to write WASM file")?;

        // Write manifest
        let manifest_path = plugin_dir.join("manifest.json");
        let manifest_json =
            serde_json::to_string_pretty(manifest).context("Failed to serialize manifest")?;
        std::fs::write(&manifest_path, manifest_json).context("Failed to write manifest")?;

        // Insert into DB
        let perms: Vec<String> = manifest.permissions.iter().map(|p| p.to_string()).collect();
        let installed = db.with_connection(|conn| {
            let plugins_db = PluginsDB::new(conn);
            plugins_db.install_plugin(
                &manifest.id,
                &manifest.name,
                &manifest.version,
                Some(&manifest.description),
                Some(&manifest.author),
                manifest.license.as_deref(),
                &manifest.category.to_string(),
                &perms,
                &hash,
                source,
                source_url,
            )
        })?;

        log::info!(
            "Installed plugin {} v{} (hash: {})",
            manifest.id,
            manifest.version,
            &hash[..16]
        );

        Ok(installed)
    }

    pub fn install_from_registry(
        &self,
        wasm_bytes: &[u8],
        entry: &RegistryEntry,
        db: &AnalysisDatabase,
    ) -> Result<InstalledPlugin> {
        // Verify SHA-256
        let computed_hash = compute_sha256(wasm_bytes);
        if computed_hash != entry.sha256 {
            bail!(
                "SHA-256 mismatch: expected {}, got {}",
                entry.sha256,
                computed_hash
            );
        }

        // Try to read manifest from the WASM module, fall back to registry entry
        let manifest = match self.runtime.read_manifest(wasm_bytes) {
            Ok(manifest_bytes) => serde_json::from_slice::<PluginManifest>(&manifest_bytes)
                .unwrap_or_else(|_| entry.to_manifest()),
            Err(_) => entry.to_manifest(),
        };

        self.install_from_bytes(
            wasm_bytes,
            &manifest,
            "registry",
            Some(&entry.artifact_url),
            db,
        )
    }

    pub fn uninstall(&self, plugin_id: &str, db: &AnalysisDatabase) -> Result<()> {
        // Remove from DB
        db.with_connection(|conn| {
            let plugins_db = PluginsDB::new(conn);
            plugins_db.uninstall_plugin(plugin_id)
        })?;

        // Remove files
        let plugin_dir = self.plugins_dir.join(plugin_id);
        if plugin_dir.exists() {
            std::fs::remove_dir_all(&plugin_dir).context("Failed to remove plugin directory")?;
        }

        log::info!("Uninstalled plugin {}", plugin_id);
        Ok(())
    }

    pub fn run_plugin(
        &self,
        plugin_id: &str,
        input: &IntermediateData,
        db: &AnalysisDatabase,
    ) -> Result<PluginOutput> {
        // Load plugin metadata from DB
        let plugin = db
            .with_connection(|conn| {
                let plugins_db = PluginsDB::new(conn);
                plugins_db.get_plugin(plugin_id)
            })?
            .ok_or_else(|| anyhow::anyhow!("Plugin '{}' not found", plugin_id))?;

        if !plugin.enabled {
            bail!("Plugin '{}' is disabled", plugin_id);
        }

        // Find the WASM file on disk
        let wasm_path = self
            .plugins_dir
            .join(plugin_id)
            .join(&plugin.version)
            .join("plugin.wasm");
        if !wasm_path.exists() {
            bail!("Plugin WASM file not found at {:?}", wasm_path);
        }

        let wasm_bytes = std::fs::read(&wasm_path).context("Failed to read plugin WASM")?;

        // Verify hash
        let hash = compute_sha256(&wasm_bytes);
        if hash != plugin.wasm_hash {
            bail!(
                "Plugin hash mismatch (file may have been tampered with): expected {}, got {}",
                plugin.wasm_hash,
                hash
            );
        }

        // Build permission set
        let permissions: HashSet<PluginPermission> = plugin
            .permissions
            .iter()
            .filter_map(|p| match p.as_str() {
                "ReadChannelData" => Some(PluginPermission::ReadChannelData),
                "WriteResults" => Some(PluginPermission::WriteResults),
                "ReadMetadata" => Some(PluginPermission::ReadMetadata),
                _ => None,
            })
            .collect();

        // Serialize input
        let input_json = serde_json::to_vec(input).context("Failed to serialize plugin input")?;

        // Prepare metadata if permitted
        let metadata_json = if permissions.contains(&PluginPermission::ReadMetadata) {
            serde_json::to_vec(&input.metadata).ok()
        } else {
            None
        };

        // Execute
        let result_bytes =
            self.runtime
                .execute(&wasm_bytes, &input_json, &permissions, metadata_json)?;

        // Parse result
        let results: serde_json::Value =
            serde_json::from_slice(&result_bytes).context("Failed to parse plugin output")?;

        Ok(PluginOutput {
            plugin_id: plugin_id.to_string(),
            results,
            logs: Vec::new(),
        })
    }

    pub fn list_installed(&self, db: &AnalysisDatabase) -> Result<Vec<InstalledPlugin>> {
        db.with_connection(|conn| {
            let plugins_db = PluginsDB::new(conn);
            plugins_db.list_plugins()
        })
    }

    pub fn get_plugin(
        &self,
        plugin_id: &str,
        db: &AnalysisDatabase,
    ) -> Result<Option<InstalledPlugin>> {
        db.with_connection(|conn| {
            let plugins_db = PluginsDB::new(conn);
            plugins_db.get_plugin(plugin_id)
        })
    }

    pub fn set_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
        db: &AnalysisDatabase,
    ) -> Result<bool> {
        db.with_connection(|conn| {
            let plugins_db = PluginsDB::new(conn);
            plugins_db.set_enabled(plugin_id, enabled)
        })
    }
}

fn compute_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}
