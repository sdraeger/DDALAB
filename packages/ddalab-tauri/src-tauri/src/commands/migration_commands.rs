use crate::state_manager::AppStateManager;
use crate::utils::file_hash::compute_file_hash;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashMigrationReport {
    pub total_files: usize,
    pub hashed_files: usize,
    pub already_hashed: usize,
    pub failed_files: Vec<FailedFileReport>,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedFileReport {
    pub file_path: String,
    pub error: String,
}

/// Migrate all tracked files to use content-based hash identification
/// This enables cross-machine compatibility for annotations and file state
#[tauri::command]
pub async fn migrate_file_hashes(
    state_manager: State<'_, AppStateManager>,
) -> Result<HashMigrationReport, String> {
    let start_time = std::time::Instant::now();

    log::info!("Starting file hash migration...");

    let mut report = HashMigrationReport {
        total_files: 0,
        hashed_files: 0,
        already_hashed: 0,
        failed_files: vec![],
        duration_ms: 0,
    };

    // Get all tracked files from file state database
    let file_state_db = state_manager.get_file_state_db();
    let tracked_files = file_state_db
        .get_tracked_files()
        .map_err(|e| format!("Failed to get tracked files: {}", e))?;

    report.total_files = tracked_files.len();
    log::info!("Found {} tracked files to process", report.total_files);

    // Get annotation database
    let annotation_db = state_manager.get_annotation_db();

    // Thread-safe counters for parallel processing
    let hashed_files = AtomicUsize::new(0);
    let already_hashed = AtomicUsize::new(0);
    let failed_files = Mutex::new(Vec::new());

    // Process files in parallel using rayon
    tracked_files
        .par_iter()
        .enumerate()
        .for_each(|(index, file_path)| {
            if index % 10 == 0 {
                log::info!(
                    "Processing file {}/{}: {}",
                    index + 1,
                    report.total_files,
                    file_path
                );
            }

            // Check if file exists
            if !std::path::Path::new(file_path).exists() {
                log::warn!("File not found, skipping: {}", file_path);
                failed_files.lock().unwrap().push(FailedFileReport {
                    file_path: file_path.clone(),
                    error: "File not found".to_string(),
                });
                return;
            }

            // Compute file hash
            let hash = match compute_file_hash(file_path) {
                Ok(h) => h,
                Err(e) => {
                    log::warn!("Failed to hash file {}: {}", file_path, e);
                    failed_files.lock().unwrap().push(FailedFileReport {
                        file_path: file_path.clone(),
                        error: format!("Failed to compute hash: {}", e),
                    });
                    return;
                }
            };

            // Update annotations with file hash
            match update_annotation_hashes(&annotation_db, file_path, &hash) {
                Ok(updated) => {
                    if updated {
                        hashed_files.fetch_add(1, Ordering::Relaxed);
                        log::debug!(
                            "Updated annotations for {}: hash={}",
                            file_path,
                            &hash[..16]
                        );
                    } else {
                        already_hashed.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Err(e) => {
                    log::warn!("Failed to update annotations for {}: {}", file_path, e);
                    // Don't fail the whole migration, just log it
                }
            }

            // Update file state metadata with hash
            match update_file_state_hash(&file_state_db, file_path, &hash) {
                Ok(_) => {
                    log::debug!("Updated file state for {}: hash={}", file_path, &hash[..16]);
                }
                Err(e) => {
                    log::warn!("Failed to update file state for {}: {}", file_path, e);
                }
            }
        });

    // Collect results from parallel processing
    report.hashed_files = hashed_files.load(Ordering::Relaxed);
    report.already_hashed = already_hashed.load(Ordering::Relaxed);
    report.failed_files = failed_files.into_inner().unwrap();

    report.duration_ms = start_time.elapsed().as_millis();

    log::info!(
        "Migration complete: {}/{} files hashed successfully ({} already had hashes, {} failed) in {}ms",
        report.hashed_files,
        report.total_files,
        report.already_hashed,
        report.failed_files.len(),
        report.duration_ms
    );

    Ok(report)
}

/// Update all annotations for a file with the file hash
fn update_annotation_hashes(
    annotation_db: &crate::db::AnnotationDatabase,
    file_path: &str,
    hash: &str,
) -> Result<bool, anyhow::Error> {
    use anyhow::Context;

    // Check if any annotations for this file already have a hash
    if annotation_db
        .has_file_hash(file_path)
        .context("Failed to check existing hashes")?
    {
        return Ok(false); // Already hashed
    }

    // Update all annotations for this file with the hash
    let updated = annotation_db
        .update_file_hash(file_path, hash)
        .context("Failed to update annotation hashes")?;

    Ok(updated > 0)
}

/// Update file state metadata and modules with the file hash
fn update_file_state_hash(
    file_state_db: &crate::db::FileStateDatabase,
    file_path: &str,
    hash: &str,
) -> Result<(), anyhow::Error> {
    use anyhow::Context;

    file_state_db
        .update_file_hash(file_path, hash)
        .context("Failed to update file state hash")?;

    Ok(())
}

/// Get hash migration status - check how many files need migration
#[tauri::command]
pub async fn get_hash_migration_status(
    state_manager: State<'_, AppStateManager>,
) -> Result<HashMigrationStatus, String> {
    log::debug!("Checking hash migration status...");

    let annotation_db = state_manager.get_annotation_db();

    // Get migration statistics
    let (with_hash, without_hash) = annotation_db
        .get_hash_migration_stats()
        .map_err(|e| format!("Failed to get migration stats: {}", e))?;

    Ok(HashMigrationStatus {
        files_with_hash: with_hash,
        files_without_hash: without_hash,
        migration_needed: without_hash > 0,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HashMigrationStatus {
    pub files_with_hash: usize,
    pub files_without_hash: usize,
    pub migration_needed: bool,
}
