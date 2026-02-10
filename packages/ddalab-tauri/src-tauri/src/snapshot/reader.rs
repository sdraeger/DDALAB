use crate::snapshot::types::*;
use anyhow::{Context, Result};
use ddalab_tauri::models::AnalysisResult;
use ddalab_tauri::utils::file_hash::compute_file_hash;
use std::io::Read;
use std::path::Path;

pub struct SnapshotReader;

impl SnapshotReader {
    pub fn read_manifest(path: &Path) -> Result<SnapshotManifest> {
        let file = std::fs::File::open(path).context("Failed to open snapshot file")?;
        let mut archive = zip::ZipArchive::new(file).context("Failed to read snapshot as ZIP")?;

        let mut manifest_file = archive
            .by_name("manifest.json")
            .context("manifest.json not found in snapshot")?;

        let mut manifest_content = String::new();
        manifest_file
            .read_to_string(&mut manifest_content)
            .context("Failed to read manifest.json")?;

        let manifest: SnapshotManifest =
            serde_json::from_str(&manifest_content).context("Failed to parse manifest.json")?;

        Ok(manifest)
    }

    pub fn validate(
        manifest: &SnapshotManifest,
        suggested_source_path: Option<&str>,
    ) -> SnapshotValidation {
        let mut warnings = Vec::new();
        let mut errors = Vec::new();

        let manifest_major = manifest.format_version.split('.').next().unwrap_or("0");
        let current_major = SNAPSHOT_FORMAT_VERSION.split('.').next().unwrap_or("0");
        let format_version_compatible = manifest_major == current_major;

        if !format_version_compatible {
            errors.push(format!(
                "Incompatible format version: {} (expected major version {})",
                manifest.format_version, current_major
            ));
        }

        let mut source_file_found = false;
        let mut source_file_hash_match = false;

        if let Some(source_path) = suggested_source_path {
            let path = Path::new(source_path);
            if path.exists() {
                source_file_found = true;
                match compute_file_hash(path) {
                    Ok(hash) => {
                        source_file_hash_match = hash == manifest.source_file.file_hash;
                        if !source_file_hash_match {
                            warnings.push(
                                "Source file hash does not match the snapshot. The file may have been modified."
                                    .to_string(),
                            );
                        }
                    }
                    Err(e) => {
                        warnings.push(format!("Could not verify source file hash: {}", e));
                    }
                }
            } else {
                warnings.push(format!("Source file not found: {}", source_path));
            }
        } else if Path::new(&manifest.source_file.original_path).exists() {
            source_file_found = true;
            match compute_file_hash(&manifest.source_file.original_path) {
                Ok(hash) => {
                    source_file_hash_match = hash == manifest.source_file.file_hash;
                    if !source_file_hash_match {
                        warnings.push(
                            "Source file hash does not match the snapshot. The file may have been modified."
                                .to_string(),
                        );
                    }
                }
                Err(e) => {
                    warnings.push(format!("Could not verify source file hash: {}", e));
                }
            }
        } else {
            warnings.push(format!(
                "Original source file not found: {}",
                manifest.source_file.original_path
            ));
        }

        let valid = format_version_compatible && errors.is_empty();

        SnapshotValidation {
            valid,
            format_version_compatible,
            source_file_found,
            source_file_hash_match,
            analysis_count: manifest.analyses.len(),
            warnings,
            errors,
        }
    }

    pub fn extract_analyses(
        path: &Path,
        manifest: &SnapshotManifest,
    ) -> Result<Vec<AnalysisResult>> {
        let file = std::fs::File::open(path).context("Failed to open snapshot file")?;
        let mut archive = zip::ZipArchive::new(file).context("Failed to read snapshot as ZIP")?;

        let mut results = Vec::new();

        for entry in &manifest.analyses {
            if let Some(ref results_file) = entry.results_file {
                let mut zip_file = archive.by_name(results_file).with_context(|| {
                    format!("Results file not found in snapshot: {}", results_file)
                })?;

                let mut compressed = Vec::new();
                zip_file
                    .read_to_end(&mut compressed)
                    .context("Failed to read results data")?;

                let decompressed = lz4_flex::decompress_size_prepended(&compressed)
                    .map_err(|e| anyhow::anyhow!("LZ4 decompression failed: {}", e))?;

                let analysis: AnalysisResult = rmp_serde::from_slice(&decompressed)
                    .context("Failed to deserialize analysis from MessagePack")?;

                results.push(analysis);
            }
        }

        Ok(results)
    }

    pub fn extract_annotations(path: &Path) -> Result<Option<serde_json::Value>> {
        let file = std::fs::File::open(path).context("Failed to open snapshot file")?;
        let mut archive = zip::ZipArchive::new(file).context("Failed to read snapshot as ZIP")?;

        let result = match archive.by_name("annotations.json") {
            Ok(mut zip_file) => {
                let mut content = String::new();
                zip_file
                    .read_to_string(&mut content)
                    .context("Failed to read annotations.json")?;
                let value: serde_json::Value =
                    serde_json::from_str(&content).context("Failed to parse annotations.json")?;
                Ok(Some(value))
            }
            Err(zip::result::ZipError::FileNotFound) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("Failed to read annotations.json: {}", e)),
        };
        result
    }

    pub fn extract_workflow(path: &Path) -> Result<Option<serde_json::Value>> {
        let file = std::fs::File::open(path).context("Failed to open snapshot file")?;
        let mut archive = zip::ZipArchive::new(file).context("Failed to read snapshot as ZIP")?;

        let result = match archive.by_name("workflow.json") {
            Ok(mut zip_file) => {
                let mut content = String::new();
                zip_file
                    .read_to_string(&mut content)
                    .context("Failed to read workflow.json")?;
                let value: serde_json::Value =
                    serde_json::from_str(&content).context("Failed to parse workflow.json")?;
                Ok(Some(value))
            }
            Err(zip::result::ZipError::FileNotFound) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("Failed to read workflow.json: {}", e)),
        };
        result
    }
}
