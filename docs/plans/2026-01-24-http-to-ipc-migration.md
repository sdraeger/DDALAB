# HTTP to Tauri IPC Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the embedded HTTP server with pure Tauri IPC commands to eliminate network-based communication that enterprise security tools (Proofpoint URLdefense) can intercept.

**Architecture:** Remove the Axum HTTP server entirely. Convert all 31 HTTP endpoints to Tauri commands. Create a `TauriBackendService` that mirrors the `ApiService` interface but uses `invoke()` instead of HTTP. Frontend hooks continue using TanStack Query but with Tauri commands as the data source.

**Tech Stack:** Tauri v2 commands, Tauri events (for streaming), TanStack Query, TypeScript

---

## Phase 1: Create Rust Tauri Commands for Data Operations

### Task 1.1: Create EDF Data Commands Module

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/commands/edf_commands.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`

**Step 1: Create the EDF commands file**

```rust
// packages/ddalab-tauri/src-tauri/src/commands/edf_commands.rs
use crate::api::models::{ChunkData, EDFFileInfo};
use crate::api::utils::{create_file_info_result, read_edf_file_chunk};
use crate::file_readers::{global_cache, FileReaderFactory, LazyReaderFactory, WindowRequest};
use crate::signal_processing::{preprocess_batch, PreprocessingConfig};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use crate::db::AppDatabase;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdfInfoResult {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub duration: Option<f64>,
    pub sample_rate: f64,
    pub total_samples: Option<u64>,
    pub channels: Vec<String>,
    pub created_at: String,
    pub last_modified: String,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdfChunkResult {
    pub data: Vec<Vec<f64>>,
    pub channel_labels: Vec<String>,
    pub sampling_frequency: f64,
    pub chunk_size: usize,
    pub chunk_start: usize,
    pub total_samples: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdfOverviewResult {
    pub data: HashMap<String, Vec<f64>>,
    pub sample_rate: f64,
    pub total_points: usize,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewProgressResult {
    pub status: String,
    pub progress: f64,
    pub current_channel: Option<String>,
    pub total_channels: usize,
    pub completed_channels: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdfWindowResult {
    pub data: HashMap<String, Vec<f64>>,
    pub start_time: f64,
    pub end_time: f64,
    pub sample_rate: f64,
    pub channels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_readers: usize,
    pub memory_usage_bytes: u64,
    pub oldest_access: Option<String>,
    pub newest_access: Option<String>,
}

/// Get EDF file information (channels, duration, sample rate, etc.)
#[tauri::command]
pub async fn get_edf_info(file_path: String) -> Result<EdfInfoResult, String> {
    let path = PathBuf::from(&file_path);

    let info = create_file_info_result(path)
        .await
        .map_err(|e| format!("Failed to get EDF info: {:?}", e))?;

    Ok(EdfInfoResult {
        file_path: info.file_path,
        file_name: info.file_name,
        file_size: info.file_size,
        duration: info.duration,
        sample_rate: info.sample_rate,
        total_samples: info.total_samples,
        channels: info.channels,
        created_at: info.created_at,
        last_modified: info.last_modified,
        start_time: info.start_time,
        end_time: info.end_time,
    })
}

/// Get EDF chunk data for visualization
#[tauri::command]
pub async fn get_edf_chunk(
    file_path: String,
    chunk_start: usize,
    chunk_size: usize,
    channels: Option<Vec<String>>,
    highpass: Option<f64>,
    lowpass: Option<f64>,
    notch: Option<Vec<f64>>,
) -> Result<EdfChunkResult, String> {
    let path = PathBuf::from(&file_path);

    // Read the chunk
    let chunk = read_edf_file_chunk(&path, chunk_start, chunk_size, channels.as_deref())
        .await
        .map_err(|e| format!("Failed to read EDF chunk: {:?}", e))?;

    // Apply preprocessing if requested
    let data = if highpass.is_some() || lowpass.is_some() || notch.is_some() {
        let config = PreprocessingConfig {
            highpass,
            lowpass,
            notch: notch.unwrap_or_default(),
            sample_rate: chunk.sampling_frequency,
        };
        preprocess_batch(&chunk.data, &config)
    } else {
        chunk.data
    };

    Ok(EdfChunkResult {
        data,
        channel_labels: chunk.channel_labels,
        sampling_frequency: chunk.sampling_frequency,
        chunk_size: chunk.chunk_size,
        chunk_start: chunk.chunk_start,
        total_samples: chunk.total_samples,
    })
}

/// Get downsampled overview data for navigation
#[tauri::command]
pub async fn get_edf_overview(
    file_path: String,
    channels: Vec<String>,
    max_points: Option<usize>,
) -> Result<EdfOverviewResult, String> {
    use crate::api::overview_generator::ProgressiveOverviewGenerator;

    let max_pts = max_points.unwrap_or(2000);
    let path = PathBuf::from(&file_path);

    // Use the existing overview generator
    let generator = ProgressiveOverviewGenerator::new();
    let overview = generator
        .generate_overview(&path, &channels, max_pts)
        .await
        .map_err(|e| format!("Failed to generate overview: {}", e))?;

    Ok(overview)
}

/// Get overview computation progress
#[tauri::command]
pub async fn get_edf_overview_progress(
    file_path: String,
    channels: Vec<String>,
) -> Result<OverviewProgressResult, String> {
    use crate::api::overview_generator::ProgressiveOverviewGenerator;

    let generator = ProgressiveOverviewGenerator::new();
    let progress = generator
        .get_progress(&file_path, &channels)
        .map_err(|e| format!("Failed to get progress: {}", e))?;

    Ok(progress)
}

/// Get lazy-loaded time window (for 100GB+ files)
#[tauri::command]
pub async fn get_edf_window(
    file_path: String,
    start_time: f64,
    duration: f64,
    channels: Vec<String>,
) -> Result<EdfWindowResult, String> {
    let request = WindowRequest {
        file_path: file_path.clone(),
        start_time,
        duration,
        channels: channels.clone(),
    };

    let factory = LazyReaderFactory::global();
    let window = factory
        .get_window(request)
        .await
        .map_err(|e| format!("Failed to get EDF window: {}", e))?;

    Ok(window)
}

/// Get cache statistics
#[tauri::command]
pub async fn get_edf_cache_stats() -> Result<CacheStats, String> {
    let cache = global_cache();
    let stats = cache.get_stats();
    Ok(stats)
}

/// Clear the EDF cache
#[tauri::command]
pub async fn clear_edf_cache() -> Result<(), String> {
    let cache = global_cache();
    cache.clear();
    Ok(())
}
```

**Step 2: Add to commands/mod.rs**

Add to the existing `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`:

```rust
pub mod edf_commands;
pub use edf_commands::*;
```

**Step 3: Register commands in main.rs**

Add to the `.invoke_handler()` in `packages/ddalab-tauri/src-tauri/src/main.rs`:

```rust
// Add these to the existing invoke_handler macro
get_edf_info,
get_edf_chunk,
get_edf_overview,
get_edf_overview_progress,
get_edf_window,
get_edf_cache_stats,
clear_edf_cache,
```

**Step 4: Run Rust tests**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/commands/edf_commands.rs
git add packages/ddalab-tauri/src-tauri/src/commands/mod.rs
git add packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "feat: add EDF Tauri commands for IPC data access"
```

---

### Task 1.2: Create DDA Analysis Commands Module

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/commands/dda_ipc_commands.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/main.rs`

**Step 1: Create the DDA IPC commands file**

```rust
// packages/ddalab-tauri/src-tauri/src/commands/dda_ipc_commands.rs
use crate::api::handlers::dda::{
    cancel_running_analysis, get_running_status, run_analysis, DDAAnalysisRequest,
};
use crate::api::models::DDAResult;
use crate::db::AppDatabase;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDASubmitRequest {
    pub file_path: String,
    pub selected_channels: Vec<String>,
    pub time_range: Option<TimeRangeParams>,
    pub variants: Vec<String>,
    pub window_length: u32,
    pub window_step: u32,
    pub scale_min: f64,
    pub scale_max: f64,
    #[serde(default)]
    pub variant_configs: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRangeParams {
    pub start: Option<usize>,
    pub end: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDASubmitResult {
    pub job_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAStatusResult {
    pub job_id: String,
    pub status: String,
    pub progress: Option<f64>,
    pub current_phase: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DDAHistoryEntry {
    pub id: String,
    pub name: Option<String>,
    pub file_path: String,
    pub channels: Vec<String>,
    pub parameters: serde_json::Value,
    pub created_at: String,
    pub status: String,
}

/// Submit a DDA analysis job
#[tauri::command]
pub async fn submit_dda_analysis(
    app: AppHandle,
    db: State<'_, Arc<AppDatabase>>,
    request: DDASubmitRequest,
) -> Result<DDASubmitResult, String> {
    use crate::dda::run_dda_analysis_async;

    let job_id = uuid::Uuid::new_v4().to_string();

    // Spawn the analysis task
    let app_clone = app.clone();
    let db_clone = db.inner().clone();
    let job_id_clone = job_id.clone();
    let request_clone = request.clone();

    tauri::async_runtime::spawn(async move {
        // Emit progress events during analysis
        let progress_callback = {
            let app = app_clone.clone();
            let job_id = job_id_clone.clone();
            move |phase: &str, progress: f64| {
                let _ = app.emit("dda-progress", serde_json::json!({
                    "job_id": job_id,
                    "phase": phase,
                    "progress": progress,
                }));
            }
        };

        match run_dda_analysis_async(
            &request_clone.file_path,
            &request_clone.selected_channels,
            &request_clone.variants,
            request_clone.window_length,
            request_clone.window_step,
            request_clone.scale_min,
            request_clone.scale_max,
            request_clone.time_range.as_ref().and_then(|r| r.start),
            request_clone.time_range.as_ref().and_then(|r| r.end),
            request_clone.variant_configs.as_ref(),
            progress_callback,
        ).await {
            Ok(result) => {
                // Save result to database
                if let Err(e) = db_clone.save_dda_result(&job_id_clone, &result).await {
                    log::error!("Failed to save DDA result: {}", e);
                }

                // Emit completion
                let _ = app_clone.emit("dda-progress", serde_json::json!({
                    "job_id": job_id_clone,
                    "phase": "completed",
                    "progress": 1.0,
                }));
            }
            Err(e) => {
                // Emit error
                let _ = app_clone.emit("dda-progress", serde_json::json!({
                    "job_id": job_id_clone,
                    "phase": "error",
                    "error": e.to_string(),
                }));
            }
        }
    });

    Ok(DDASubmitResult {
        job_id,
        status: "running".to_string(),
    })
}

/// Get DDA analysis status
#[tauri::command]
pub async fn get_dda_status(
    db: State<'_, Arc<AppDatabase>>,
    job_id: String,
) -> Result<DDAStatusResult, String> {
    // Check if running
    if let Some(status) = get_running_status(&job_id) {
        return Ok(status);
    }

    // Check database for completed result
    match db.get_dda_result(&job_id).await {
        Ok(Some(result)) => Ok(DDAStatusResult {
            job_id,
            status: result.status,
            progress: Some(1.0),
            current_phase: None,
            error: None,
        }),
        Ok(None) => Ok(DDAStatusResult {
            job_id,
            status: "not_found".to_string(),
            progress: None,
            current_phase: None,
            error: None,
        }),
        Err(e) => Err(format!("Failed to get status: {}", e)),
    }
}

/// Cancel running DDA analysis
#[tauri::command]
pub async fn cancel_dda() -> Result<(), String> {
    cancel_running_analysis().await;
    Ok(())
}

/// Get DDA result by ID
#[tauri::command]
pub async fn get_dda_result_by_id(
    db: State<'_, Arc<AppDatabase>>,
    job_id: String,
) -> Result<Option<DDAResult>, String> {
    db.get_dda_result(&job_id)
        .await
        .map_err(|e| format!("Failed to get result: {}", e))
}

/// Get DDA results for a file
#[tauri::command]
pub async fn get_dda_results_for_file(
    db: State<'_, Arc<AppDatabase>>,
    file_path: String,
) -> Result<Vec<DDAResult>, String> {
    db.get_dda_results_for_file(&file_path)
        .await
        .map_err(|e| format!("Failed to get results: {}", e))
}

/// List DDA analysis history
#[tauri::command]
pub async fn list_dda_history(
    db: State<'_, Arc<AppDatabase>>,
) -> Result<Vec<DDAHistoryEntry>, String> {
    db.list_dda_history()
        .await
        .map_err(|e| format!("Failed to list history: {}", e))
}

/// Save DDA analysis to history
#[tauri::command]
pub async fn save_dda_to_history(
    db: State<'_, Arc<AppDatabase>>,
    result: DDAResult,
) -> Result<(), String> {
    db.save_dda_to_history(&result)
        .await
        .map_err(|e| format!("Failed to save to history: {}", e))
}

/// Get DDA result from history
#[tauri::command]
pub async fn get_dda_from_history(
    db: State<'_, Arc<AppDatabase>>,
    result_id: String,
) -> Result<Option<DDAResult>, String> {
    db.get_dda_from_history(&result_id)
        .await
        .map_err(|e| format!("Failed to get from history: {}", e))
}

/// Delete DDA result from history
#[tauri::command]
pub async fn delete_dda_from_history(
    db: State<'_, Arc<AppDatabase>>,
    result_id: String,
) -> Result<(), String> {
    db.delete_dda_from_history(&result_id)
        .await
        .map_err(|e| format!("Failed to delete from history: {}", e))
}

/// Rename DDA result in history
#[tauri::command]
pub async fn rename_dda_in_history(
    db: State<'_, Arc<AppDatabase>>,
    result_id: String,
    new_name: String,
) -> Result<(), String> {
    db.rename_dda_in_history(&result_id, &new_name)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))
}
```

**Step 2: Add to commands/mod.rs**

```rust
pub mod dda_ipc_commands;
pub use dda_ipc_commands::*;
```

**Step 3: Register commands in main.rs**

Add to the `.invoke_handler()`:

```rust
submit_dda_analysis,
get_dda_status,
cancel_dda,
get_dda_result_by_id,
get_dda_results_for_file,
list_dda_history,
save_dda_to_history,
get_dda_from_history,
delete_dda_from_history,
rename_dda_in_history,
```

**Step 4: Run Rust tests**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/commands/dda_ipc_commands.rs
git add packages/ddalab-tauri/src-tauri/src/commands/mod.rs
git add packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "feat: add DDA Tauri commands for IPC analysis"
```

---

### Task 1.3: Create File Operations Commands Module

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/commands/file_ipc_commands.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/main.rs`

**Step 1: Create the file commands**

```rust
// packages/ddalab-tauri/src-tauri/src/commands/file_ipc_commands.rs
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub total_files: usize,
    pub total_directories: usize,
}

/// List directory contents
#[tauri::command]
pub async fn list_directory(path: String) -> Result<DirectoryListing, String> {
    let dir_path = PathBuf::from(&path);

    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let mut total_files = 0;
    let mut total_directories = 0;

    let read_dir = fs::read_dir(&dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    for entry in read_dir {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().ok();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);

        if is_dir {
            total_directories += 1;
        } else {
            total_files += 1;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        let extension = if is_dir {
            None
        } else {
            entry.path().extension().map(|e| e.to_string_lossy().to_string())
        };

        entries.push(FileEntry {
            name,
            path,
            is_directory: is_dir,
            size: metadata.as_ref().map(|m| m.len()),
            modified: metadata.as_ref().and_then(|m| {
                m.modified().ok().map(|t| {
                    chrono::DateTime::<chrono::Utc>::from(t)
                        .format("%Y-%m-%dT%H:%M:%SZ")
                        .to_string()
                })
            }),
            extension,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(DirectoryListing {
        path,
        entries,
        total_files,
        total_directories,
    })
}

/// List available data files (EDF, BrainVision, etc.)
#[tauri::command]
pub async fn list_data_files(
    directory: String,
    recursive: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    use walkdir::WalkDir;

    let supported_extensions = [
        "edf", "bdf", "vhdr", "vmrk", "eeg", "set", "fif", "nii", "nii.gz", "xdf", "csv", "txt", "nwb"
    ];

    let mut files = Vec::new();
    let walker = if recursive.unwrap_or(false) {
        WalkDir::new(&directory)
    } else {
        WalkDir::new(&directory).max_depth(1)
    };

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if supported_extensions.contains(&ext_str.as_str()) {
                    let metadata = fs::metadata(path).ok();
                    files.push(FileEntry {
                        name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                        path: path.to_string_lossy().to_string(),
                        is_directory: false,
                        size: metadata.as_ref().map(|m| m.len()),
                        modified: metadata.as_ref().and_then(|m| {
                            m.modified().ok().map(|t| {
                                chrono::DateTime::<chrono::Utc>::from(t)
                                    .format("%Y-%m-%dT%H:%M:%SZ")
                                    .to_string()
                            })
                        }),
                        extension: Some(ext_str),
                    });
                }
            }
        }
    }

    Ok(files)
}

/// Update the working data directory
#[tauri::command]
pub async fn update_data_directory(
    app: tauri::AppHandle,
    new_path: String,
) -> Result<(), String> {
    use crate::state::APP_STATE;

    let path = PathBuf::from(&new_path);
    if !path.exists() {
        return Err(format!("Directory does not exist: {}", new_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", new_path));
    }

    // Update app state
    APP_STATE.set_data_directory(new_path.clone());

    Ok(())
}

/// Get the current data directory
#[tauri::command]
pub async fn get_data_directory() -> Result<String, String> {
    use crate::state::APP_STATE;

    Ok(APP_STATE.get_data_directory())
}
```

**Step 2: Add to commands/mod.rs**

```rust
pub mod file_ipc_commands;
pub use file_ipc_commands::*;
```

**Step 3: Register commands in main.rs**

```rust
list_directory,
list_data_files,
update_data_directory,
get_data_directory,
```

**Step 4: Run Rust tests**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/commands/file_ipc_commands.rs
git add packages/ddalab-tauri/src-tauri/src/commands/mod.rs
git add packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "feat: add file operation Tauri commands"
```

---

### Task 1.4: Create ICA Analysis Commands

**Files:**
- Create: `packages/ddalab-tauri/src-tauri/src/commands/ica_ipc_commands.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/commands/mod.rs`
- Modify: `packages/ddalab-tauri/src-tauri/src/main.rs`

**Step 1: Create the ICA commands file**

```rust
// packages/ddalab-tauri/src-tauri/src/commands/ica_ipc_commands.rs
use crate::db::AppDatabase;
use crate::ica::{run_ica_analysis, ICARequest, ICAResult, ReconstructRequest};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICASubmitRequest {
    pub file_path: String,
    pub channels: Vec<String>,
    pub n_components: Option<usize>,
    pub method: Option<String>,
    pub max_iter: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICASubmitResult {
    pub analysis_id: String,
    pub status: String,
}

/// Submit an ICA analysis
#[tauri::command]
pub async fn submit_ica_analysis(
    app: AppHandle,
    db: State<'_, Arc<AppDatabase>>,
    request: ICASubmitRequest,
) -> Result<ICASubmitResult, String> {
    let analysis_id = uuid::Uuid::new_v4().to_string();

    let app_clone = app.clone();
    let db_clone = db.inner().clone();
    let analysis_id_clone = analysis_id.clone();

    tauri::async_runtime::spawn(async move {
        let ica_request = ICARequest {
            file_path: request.file_path,
            channels: request.channels,
            n_components: request.n_components,
            method: request.method.unwrap_or_else(|| "fastica".to_string()),
            max_iter: request.max_iter.unwrap_or(200),
        };

        match run_ica_analysis(ica_request).await {
            Ok(result) => {
                if let Err(e) = db_clone.save_ica_result(&analysis_id_clone, &result).await {
                    log::error!("Failed to save ICA result: {}", e);
                }

                let _ = app_clone.emit("ica-complete", serde_json::json!({
                    "analysis_id": analysis_id_clone,
                    "status": "completed",
                }));
            }
            Err(e) => {
                let _ = app_clone.emit("ica-complete", serde_json::json!({
                    "analysis_id": analysis_id_clone,
                    "status": "error",
                    "error": e.to_string(),
                }));
            }
        }
    });

    Ok(ICASubmitResult {
        analysis_id,
        status: "running".to_string(),
    })
}

/// Get all ICA results
#[tauri::command]
pub async fn get_ica_results(
    db: State<'_, Arc<AppDatabase>>,
) -> Result<Vec<ICAResult>, String> {
    db.get_all_ica_results()
        .await
        .map_err(|e| format!("Failed to get ICA results: {}", e))
}

/// Get ICA result by ID
#[tauri::command]
pub async fn get_ica_result_by_id(
    db: State<'_, Arc<AppDatabase>>,
    analysis_id: String,
) -> Result<Option<ICAResult>, String> {
    db.get_ica_result(&analysis_id)
        .await
        .map_err(|e| format!("Failed to get ICA result: {}", e))
}

/// Delete ICA result
#[tauri::command]
pub async fn delete_ica_result(
    db: State<'_, Arc<AppDatabase>>,
    analysis_id: String,
) -> Result<(), String> {
    db.delete_ica_result(&analysis_id)
        .await
        .map_err(|e| format!("Failed to delete ICA result: {}", e))
}

/// Reconstruct signal without specific ICA components
#[tauri::command]
pub async fn ica_reconstruct_without_components(
    db: State<'_, Arc<AppDatabase>>,
    analysis_id: String,
    exclude_components: Vec<usize>,
    output_path: Option<String>,
) -> Result<String, String> {
    use crate::ica::reconstruct_without_components;

    let result = db.get_ica_result(&analysis_id)
        .await
        .map_err(|e| format!("Failed to get ICA result: {}", e))?
        .ok_or_else(|| "ICA result not found".to_string())?;

    let request = ReconstructRequest {
        analysis_id,
        exclude_components,
        output_path,
    };

    reconstruct_without_components(result, request)
        .await
        .map_err(|e| format!("Failed to reconstruct: {}", e))
}
```

**Step 2: Add to commands/mod.rs**

```rust
pub mod ica_ipc_commands;
pub use ica_ipc_commands::*;
```

**Step 3: Register commands in main.rs**

```rust
submit_ica_analysis,
get_ica_results,
get_ica_result_by_id,
delete_ica_result,
ica_reconstruct_without_components,
```

**Step 4: Run Rust tests**

Run: `cd packages/ddalab-tauri/src-tauri && cargo test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/commands/ica_ipc_commands.rs
git add packages/ddalab-tauri/src-tauri/src/commands/mod.rs
git add packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "feat: add ICA Tauri commands"
```

---

## Phase 2: Create Frontend Backend Service

### Task 2.1: Create TauriBackendService

**Files:**
- Create: `packages/ddalab-tauri/src/services/tauriBackendService.ts`

**Step 1: Create the service file**

```typescript
// packages/ddalab-tauri/src/services/tauriBackendService.ts

/**
 * TauriBackendService - Pure IPC backend communication
 *
 * Replaces ApiService with Tauri commands. No HTTP, no network,
 * no ports, no certificates. Pure IPC that enterprise security
 * tools cannot intercept.
 */

import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Types
// ============================================================================

export interface EdfInfoResult {
  file_path: string;
  file_name: string;
  file_size: number;
  duration: number | null;
  sample_rate: number;
  total_samples: number | null;
  channels: string[];
  created_at: string;
  last_modified: string;
  start_time: string;
  end_time: string;
}

export interface EdfChunkResult {
  data: number[][];
  channel_labels: string[];
  sampling_frequency: number;
  chunk_size: number;
  chunk_start: number;
  total_samples: number | null;
}

export interface EdfOverviewResult {
  data: Record<string, number[]>;
  sample_rate: number;
  total_points: number;
  duration: number;
}

export interface OverviewProgressResult {
  status: string;
  progress: number;
  current_channel: string | null;
  total_channels: number;
  completed_channels: number;
}

export interface EdfWindowResult {
  data: Record<string, number[]>;
  start_time: number;
  end_time: number;
  sample_rate: number;
  channels: string[];
}

export interface CacheStats {
  total_readers: number;
  memory_usage_bytes: number;
  oldest_access: string | null;
  newest_access: string | null;
}

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number | null;
  modified: string | null;
  extension: string | null;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
  total_files: number;
  total_directories: number;
}

export interface DDASubmitRequest {
  file_path: string;
  selected_channels: string[];
  time_range?: { start?: number; end?: number };
  variants: string[];
  window_length: number;
  window_step: number;
  scale_min: number;
  scale_max: number;
  variant_configs?: Record<string, unknown>;
}

export interface DDASubmitResult {
  job_id: string;
  status: string;
}

export interface DDAStatusResult {
  job_id: string;
  status: string;
  progress: number | null;
  current_phase: string | null;
  error: string | null;
}

export interface DDAResult {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  parameters: Record<string, unknown>;
  results: Record<string, unknown>;
  plot_data?: Record<string, unknown>;
  Q?: number[][];
  created_at: string;
  status: string;
}

export interface DDAHistoryEntry {
  id: string;
  name?: string;
  file_path: string;
  channels: string[];
  parameters: Record<string, unknown>;
  created_at: string;
  status: string;
}

export interface ICASubmitRequest {
  file_path: string;
  channels: string[];
  n_components?: number;
  method?: string;
  max_iter?: number;
}

export interface ICASubmitResult {
  analysis_id: string;
  status: string;
}

export interface ICAResult {
  id: string;
  file_path: string;
  channels: string[];
  n_components: number;
  mixing_matrix: number[][];
  unmixing_matrix: number[][];
  components: number[][];
  explained_variance: number[];
  created_at: string;
}

// ============================================================================
// Service Class
// ============================================================================

class TauriBackendServiceImpl {
  // ==========================================================================
  // EDF Operations
  // ==========================================================================

  async getEdfInfo(filePath: string): Promise<EdfInfoResult> {
    return invoke<EdfInfoResult>("get_edf_info", { filePath });
  }

  async getEdfChunk(
    filePath: string,
    chunkStart: number,
    chunkSize: number,
    channels?: string[],
    preprocessing?: {
      highpass?: number;
      lowpass?: number;
      notch?: number[];
    }
  ): Promise<EdfChunkResult> {
    return invoke<EdfChunkResult>("get_edf_chunk", {
      filePath,
      chunkStart,
      chunkSize,
      channels,
      highpass: preprocessing?.highpass,
      lowpass: preprocessing?.lowpass,
      notch: preprocessing?.notch,
    });
  }

  async getEdfOverview(
    filePath: string,
    channels: string[],
    maxPoints?: number
  ): Promise<EdfOverviewResult> {
    return invoke<EdfOverviewResult>("get_edf_overview", {
      filePath,
      channels,
      maxPoints,
    });
  }

  async getEdfOverviewProgress(
    filePath: string,
    channels: string[]
  ): Promise<OverviewProgressResult> {
    return invoke<OverviewProgressResult>("get_edf_overview_progress", {
      filePath,
      channels,
    });
  }

  async getEdfWindow(
    filePath: string,
    startTime: number,
    duration: number,
    channels: string[]
  ): Promise<EdfWindowResult> {
    return invoke<EdfWindowResult>("get_edf_window", {
      filePath,
      startTime,
      duration,
      channels,
    });
  }

  async getEdfCacheStats(): Promise<CacheStats> {
    return invoke<CacheStats>("get_edf_cache_stats");
  }

  async clearEdfCache(): Promise<void> {
    return invoke<void>("clear_edf_cache");
  }

  // ==========================================================================
  // File Operations
  // ==========================================================================

  async listDirectory(path: string): Promise<DirectoryListing> {
    return invoke<DirectoryListing>("list_directory", { path });
  }

  async listDataFiles(
    directory: string,
    recursive?: boolean
  ): Promise<FileEntry[]> {
    return invoke<FileEntry[]>("list_data_files", { directory, recursive });
  }

  async updateDataDirectory(newPath: string): Promise<void> {
    return invoke<void>("update_data_directory", { newPath });
  }

  async getDataDirectory(): Promise<string> {
    return invoke<string>("get_data_directory");
  }

  // ==========================================================================
  // DDA Operations
  // ==========================================================================

  async submitDDAAnalysis(request: DDASubmitRequest): Promise<DDASubmitResult> {
    return invoke<DDASubmitResult>("submit_dda_analysis", { request });
  }

  async getDDAStatus(jobId: string): Promise<DDAStatusResult> {
    return invoke<DDAStatusResult>("get_dda_status", { jobId });
  }

  async cancelDDA(): Promise<void> {
    return invoke<void>("cancel_dda");
  }

  async getDDAResult(jobId: string): Promise<DDAResult | null> {
    return invoke<DDAResult | null>("get_dda_result_by_id", { jobId });
  }

  async getDDAResultsForFile(filePath: string): Promise<DDAResult[]> {
    return invoke<DDAResult[]>("get_dda_results_for_file", { filePath });
  }

  async listDDAHistory(): Promise<DDAHistoryEntry[]> {
    return invoke<DDAHistoryEntry[]>("list_dda_history");
  }

  async saveDDAToHistory(result: DDAResult): Promise<void> {
    return invoke<void>("save_dda_to_history", { result });
  }

  async getDDAFromHistory(resultId: string): Promise<DDAResult | null> {
    return invoke<DDAResult | null>("get_dda_from_history", { resultId });
  }

  async deleteDDAFromHistory(resultId: string): Promise<void> {
    return invoke<void>("delete_dda_from_history", { resultId });
  }

  async renameDDAInHistory(resultId: string, newName: string): Promise<void> {
    return invoke<void>("rename_dda_in_history", { resultId, newName });
  }

  // ==========================================================================
  // ICA Operations
  // ==========================================================================

  async submitICAAnalysis(request: ICASubmitRequest): Promise<ICASubmitResult> {
    return invoke<ICASubmitResult>("submit_ica_analysis", { request });
  }

  async getICAResults(): Promise<ICAResult[]> {
    return invoke<ICAResult[]>("get_ica_results");
  }

  async getICAResult(analysisId: string): Promise<ICAResult | null> {
    return invoke<ICAResult | null>("get_ica_result_by_id", { analysisId });
  }

  async deleteICAResult(analysisId: string): Promise<void> {
    return invoke<void>("delete_ica_result", { analysisId });
  }

  async icaReconstructWithoutComponents(
    analysisId: string,
    excludeComponents: number[],
    outputPath?: string
  ): Promise<string> {
    return invoke<string>("ica_reconstruct_without_components", {
      analysisId,
      excludeComponents,
      outputPath,
    });
  }

  // ==========================================================================
  // Health Check (for compatibility - always returns healthy in Tauri)
  // ==========================================================================

  async checkHealth(): Promise<{ status: string }> {
    // In Tauri mode, the backend is always healthy if we can invoke
    try {
      await invoke("get_app_state");
      return { status: "healthy" };
    } catch (e) {
      return { status: "unhealthy" };
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const tauriBackendService = new TauriBackendServiceImpl();
export default tauriBackendService;
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/services/tauriBackendService.ts
git commit -m "feat: add TauriBackendService for pure IPC communication"
```

---

### Task 2.2: Create Backend Context Provider

**Files:**
- Create: `packages/ddalab-tauri/src/contexts/BackendContext.tsx`

**Step 1: Create the context provider**

```typescript
// packages/ddalab-tauri/src/contexts/BackendContext.tsx

/**
 * BackendContext - Unified backend access
 *
 * Provides access to the TauriBackendService throughout the app.
 * This replaces ApiServiceContext with a simpler, network-free approach.
 */

"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  tauriBackendService,
  type EdfInfoResult,
  type EdfChunkResult,
  type EdfOverviewResult,
  type DDASubmitRequest,
  type DDAResult,
  type DDAHistoryEntry,
  type ICAResult,
  type FileEntry,
  type DirectoryListing,
} from "@/services/tauriBackendService";
import { TauriService } from "@/services/tauriService";

// ============================================================================
// Types
// ============================================================================

interface BackendContextValue {
  // Service instance
  backend: typeof tauriBackendService;

  // Status
  isReady: boolean;
  isTauri: boolean;

  // Convenience methods (mirrors tauriBackendService)
  getEdfInfo: (filePath: string) => Promise<EdfInfoResult>;
  getEdfChunk: typeof tauriBackendService.getEdfChunk;
  getEdfOverview: typeof tauriBackendService.getEdfOverview;
  listDirectory: (path: string) => Promise<DirectoryListing>;
  listDataFiles: typeof tauriBackendService.listDataFiles;
  submitDDAAnalysis: typeof tauriBackendService.submitDDAAnalysis;
  cancelDDA: () => Promise<void>;
  getDDAResult: (jobId: string) => Promise<DDAResult | null>;
  listDDAHistory: () => Promise<DDAHistoryEntry[]>;
  submitICAAnalysis: typeof tauriBackendService.submitICAAnalysis;
  getICAResults: () => Promise<ICAResult[]>;
}

// ============================================================================
// Context
// ============================================================================

const BackendContext = createContext<BackendContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface BackendProviderProps {
  children: React.ReactNode;
}

export function BackendProvider({ children }: BackendProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const isTauri = TauriService.isTauri();

  useEffect(() => {
    // In Tauri, we're immediately ready (no server to start)
    if (isTauri) {
      setIsReady(true);
    }
  }, [isTauri]);

  const value: BackendContextValue = {
    backend: tauriBackendService,
    isReady,
    isTauri,

    // Convenience methods
    getEdfInfo: tauriBackendService.getEdfInfo.bind(tauriBackendService),
    getEdfChunk: tauriBackendService.getEdfChunk.bind(tauriBackendService),
    getEdfOverview: tauriBackendService.getEdfOverview.bind(tauriBackendService),
    listDirectory: tauriBackendService.listDirectory.bind(tauriBackendService),
    listDataFiles: tauriBackendService.listDataFiles.bind(tauriBackendService),
    submitDDAAnalysis: tauriBackendService.submitDDAAnalysis.bind(tauriBackendService),
    cancelDDA: tauriBackendService.cancelDDA.bind(tauriBackendService),
    getDDAResult: tauriBackendService.getDDAResult.bind(tauriBackendService),
    listDDAHistory: tauriBackendService.listDDAHistory.bind(tauriBackendService),
    submitICAAnalysis: tauriBackendService.submitICAAnalysis.bind(tauriBackendService),
    getICAResults: tauriBackendService.getICAResults.bind(tauriBackendService),
  };

  return (
    <BackendContext.Provider value={value}>
      {children}
    </BackendContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useBackend(): BackendContextValue {
  const context = useContext(BackendContext);
  if (!context) {
    throw new Error("useBackend must be used within a BackendProvider");
  }
  return context;
}

// ============================================================================
// Conditional Hook (for gradual migration)
// ============================================================================

export function useBackendOptional(): BackendContextValue | null {
  return useContext(BackendContext);
}
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/contexts/BackendContext.tsx
git commit -m "feat: add BackendContext provider for Tauri IPC"
```

---

## Phase 3: Migrate Frontend Hooks

### Task 3.1: Migrate useTimeSeriesData Hook

**Files:**
- Modify: `packages/ddalab-tauri/src/hooks/useTimeSeriesData.ts`

**Step 1: Update the hook to use TauriBackendService**

The key changes:
1. Replace `apiService.getChunkData()` with `tauriBackendService.getEdfChunk()`
2. Replace `apiService.getOverviewData()` with `tauriBackendService.getEdfOverview()`
3. Replace `apiService.getOverviewProgress()` with `tauriBackendService.getEdfOverviewProgress()`

```typescript
// At the top of the file, add:
import { tauriBackendService } from "@/services/tauriBackendService";

// Replace the queryFn in useChunkData:
queryFn: async () => {
  const result = await tauriBackendService.getEdfChunk(
    filePath,
    chunkStart,
    chunkSize,
    selectedChannels,
    preprocessing
  );
  return {
    data: result.data,
    channelLabels: result.channel_labels,
    samplingFrequency: result.sampling_frequency,
    chunkSize: result.chunk_size,
    chunkStart: result.chunk_start,
    totalSamples: result.total_samples,
  };
},

// Replace the queryFn in useOverviewData:
queryFn: async () => {
  const result = await tauriBackendService.getEdfOverview(
    filePath,
    channels,
    maxPoints
  );
  return {
    data: result.data,
    sampleRate: result.sample_rate,
    totalPoints: result.total_points,
    duration: result.duration,
  };
},
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useTimeSeriesData.ts
git commit -m "refactor: migrate useTimeSeriesData to Tauri IPC"
```

---

### Task 3.2: Migrate useFileManagement Hook

**Files:**
- Modify: `packages/ddalab-tauri/src/hooks/useFileManagement.ts`

**Step 1: Update the hook**

Replace all `apiService` calls with `tauriBackendService` calls:
- `apiService.getAvailableFiles()` → `tauriBackendService.listDataFiles()`
- `apiService.getFileInfo()` → `tauriBackendService.getEdfInfo()`
- `apiService.listDirectory()` → `tauriBackendService.listDirectory()`
- `apiService.updateDataDirectory()` → `tauriBackendService.updateDataDirectory()`

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useFileManagement.ts
git commit -m "refactor: migrate useFileManagement to Tauri IPC"
```

---

### Task 3.3: Migrate useDDAAnalysis Hook

**Files:**
- Modify: `packages/ddalab-tauri/src/hooks/useDDAAnalysis.ts`

**Step 1: Update the hook**

Replace all `apiService` DDA calls:
- `apiService.submitDDAAnalysis()` → `tauriBackendService.submitDDAAnalysis()`
- `apiService.getDDAResult()` → `tauriBackendService.getDDAResult()`
- `apiService.getDDAStatus()` → `tauriBackendService.getDDAStatus()`
- `apiService.cancelDDAAnalysis()` → `tauriBackendService.cancelDDA()`
- `apiService.getAnalysisHistory()` → `tauriBackendService.listDDAHistory()`
- `apiService.getAnalysisFromHistory()` → `tauriBackendService.getDDAFromHistory()`
- `apiService.saveAnalysisToHistory()` → `tauriBackendService.saveDDAToHistory()`
- `apiService.deleteAnalysisFromHistory()` → `tauriBackendService.deleteDDAFromHistory()`
- `apiService.renameAnalysisInHistory()` → `tauriBackendService.renameDDAInHistory()`

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useDDAAnalysis.ts
git commit -m "refactor: migrate useDDAAnalysis to Tauri IPC"
```

---

### Task 3.4: Migrate useICAAnalysis Hook

**Files:**
- Modify: `packages/ddalab-tauri/src/hooks/useICAAnalysis.ts`

**Step 1: Update the hook**

Replace all `apiService` ICA calls:
- `apiService.submitICAAnalysis()` → `tauriBackendService.submitICAAnalysis()`
- `apiService.getICAResults()` → `tauriBackendService.getICAResults()`
- `apiService.getICAResult()` → `tauriBackendService.getICAResult()`
- `apiService.deleteICAResult()` → `tauriBackendService.deleteICAResult()`
- `apiService.reconstructWithoutComponents()` → `tauriBackendService.icaReconstructWithoutComponents()`

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useICAAnalysis.ts
git commit -m "refactor: migrate useICAAnalysis to Tauri IPC"
```

---

### Task 3.5: Migrate useHealthCheck Hook

**Files:**
- Modify: `packages/ddalab-tauri/src/hooks/useHealthCheck.ts`

**Step 1: Update the hook**

In Tauri mode, health is always "healthy" since there's no server:

```typescript
import { tauriBackendService } from "@/services/tauriBackendService";
import { TauriService } from "@/services/tauriService";

// In the query:
queryFn: async () => {
  if (TauriService.isTauri()) {
    // In Tauri mode, always healthy (no server needed)
    return { status: "healthy" };
  }
  return tauriBackendService.checkHealth();
},
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/hooks/useHealthCheck.ts
git commit -m "refactor: migrate useHealthCheck to Tauri IPC"
```

---

## Phase 4: Update App Entry Point

### Task 4.1: Update page.tsx to Remove HTTP Server Startup

**Files:**
- Modify: `packages/ddalab-tauri/src/app/page.tsx`

**Step 1: Remove HTTP server startup logic**

The main changes:
1. Remove `startLocalApiServer()` call
2. Remove API URL, session token, encryption key state
3. Remove `ApiServiceProvider` wrapper
4. Add `BackendProvider` wrapper
5. Simplify initialization to just check if Tauri is ready

```typescript
// Remove these imports:
// import { ApiServiceProvider } from "@/contexts/ApiServiceContext";
// import { importKey } from "@/utils/crypto";

// Add this import:
import { BackendProvider } from "@/contexts/BackendContext";

// In the component, remove:
// - const [apiUrl, setApiUrl] = useState(...)
// - const [sessionToken, setSessionToken] = useState(...)
// - const loadPreferences async function (or simplify it)
// - const checkApiConnection async function

// Replace the return with:
return (
  <ErrorBoundary>
    <BackendProvider>
      <StatePersistenceProvider>
        <DashboardLayout />
        {PerformanceMonitor && <PerformanceMonitor />}
        <CloseWarningHandler />
        <OnboardingTour ... />
      </StatePersistenceProvider>
    </BackendProvider>
  </ErrorBoundary>
);
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/app/page.tsx
git commit -m "refactor: remove HTTP server startup, use BackendProvider"
```

---

### Task 4.2: Update Popout Windows

**Files:**
- Modify: `packages/ddalab-tauri/src/components/popout/FileViewerPopout.tsx`
- Modify: `packages/ddalab-tauri/src/components/popout/PopoutDashboard.tsx`

**Step 1: Remove ApiServiceProvider from popouts**

Replace `ApiServiceProvider` with `BackendProvider`:

```typescript
// FileViewerPopout.tsx
import { BackendProvider } from "@/contexts/BackendContext";

// Replace:
// <ApiServiceProvider apiUrl={apiUrl} sessionToken={sessionToken}>
// With:
<BackendProvider>
  <StatePersistenceProvider>
    <PopoutDashboard ... />
  </StatePersistenceProvider>
</BackendProvider>
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src/components/popout/FileViewerPopout.tsx
git add packages/ddalab-tauri/src/components/popout/PopoutDashboard.tsx
git commit -m "refactor: update popout windows to use BackendProvider"
```

---

## Phase 5: Remove HTTP Infrastructure

### Task 5.1: Remove HTTP Server from main.rs

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/src/main.rs`

**Step 1: Remove API server startup**

Remove:
- `start_local_api_server` command registration
- `stop_local_api_server` command registration
- Any API server initialization in the setup hook

**Step 2: Run Rust build**

Run: `cd packages/ddalab-tauri/src-tauri && cargo build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/src/main.rs
git commit -m "refactor: remove HTTP server startup from main.rs"
```

---

### Task 5.2: Remove API Module

**Files:**
- Delete: `packages/ddalab-tauri/src-tauri/src/api/` (entire directory)
- Modify: `packages/ddalab-tauri/src-tauri/src/lib.rs` or `main.rs` to remove `mod api;`

**Step 1: Remove the API module reference**

In the main module file, remove:
```rust
mod api;
```

**Step 2: Delete the API directory**

```bash
rm -rf packages/ddalab-tauri/src-tauri/src/api/
```

**Step 3: Run Rust build**

Run: `cd packages/ddalab-tauri/src-tauri && cargo build`
Expected: Build succeeds (may need to fix imports in new commands)

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove HTTP API module entirely"
```

---

### Task 5.3: Clean Up Cargo.toml Dependencies

**Files:**
- Modify: `packages/ddalab-tauri/src-tauri/Cargo.toml`

**Step 1: Remove unused HTTP dependencies**

Remove or comment out (if not used elsewhere):
- `axum`
- `tower`
- `tower-http`
- `hyper` (if only used by axum)
- `http`

Keep:
- `tokio` (still needed for async)
- `serde`, `serde_json` (still needed)

**Step 2: Run Rust build**

Run: `cd packages/ddalab-tauri/src-tauri && cargo build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add packages/ddalab-tauri/src-tauri/Cargo.toml
git commit -m "chore: remove unused HTTP dependencies from Cargo.toml"
```

---

### Task 5.4: Remove Frontend ApiService and Related Files

**Files:**
- Delete: `packages/ddalab-tauri/src/services/apiService.ts`
- Delete: `packages/ddalab-tauri/src/contexts/ApiServiceContext.tsx`
- Delete: `packages/ddalab-tauri/src/utils/crypto.ts` (if only used for HTTP encryption)
- Delete: `packages/ddalab-tauri/src/utils/httpClient.ts`

**Step 1: Delete the files**

```bash
rm packages/ddalab-tauri/src/services/apiService.ts
rm packages/ddalab-tauri/src/contexts/ApiServiceContext.tsx
rm packages/ddalab-tauri/src/utils/httpClient.ts
# Keep crypto.ts if used elsewhere, otherwise:
rm packages/ddalab-tauri/src/utils/crypto.ts
```

**Step 2: Run TypeScript check**

Run: `cd packages/ddalab-tauri && npx tsc --noEmit`
Expected: No errors (all imports should have been updated in Phase 3)

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated HTTP-related frontend files"
```

---

## Phase 6: Testing and Verification

### Task 6.1: Test File Loading

**Steps:**
1. Run: `cd packages/ddalab-tauri && bun run tauri:dev`
2. Open the app
3. Navigate to a directory with EDF files
4. Select a file
5. Verify: File info loads (channels, duration, sample rate)
6. Verify: Time series visualization renders

**Expected:** File loads without HTTP requests

---

### Task 6.2: Test DDA Analysis

**Steps:**
1. Load an EDF file
2. Configure DDA analysis parameters
3. Click "Run Analysis"
4. Verify: Progress events are received
5. Verify: Results display correctly
6. Verify: Results save to history

**Expected:** Analysis completes via IPC

---

### Task 6.3: Test History Operations

**Steps:**
1. Go to analysis history
2. Verify: History list loads
3. Select an analysis
4. Verify: Full results load
5. Rename an analysis
6. Delete an analysis

**Expected:** All operations work via IPC

---

### Task 6.4: Final Commit

```bash
git add -A
git commit -m "feat: complete migration from HTTP to Tauri IPC

BREAKING CHANGE: Removed embedded HTTP server entirely.
All communication now uses pure Tauri IPC commands.

Benefits:
- No port conflicts
- No TLS certificate issues
- No session token management
- No encryption middleware
- Cannot be intercepted by enterprise security tools (Proofpoint, etc.)
- Faster communication (no network serialization)
- Simpler architecture

Migration:
- ApiService → TauriBackendService
- ApiServiceContext → BackendContext
- HTTP endpoints → Tauri commands
"
```

---

## Summary

| Phase | Tasks | Estimated Time |
|-------|-------|---------------|
| Phase 1 | Create Rust Tauri commands (4 tasks) | 2-3 hours |
| Phase 2 | Create frontend backend service (2 tasks) | 1 hour |
| Phase 3 | Migrate frontend hooks (5 tasks) | 2-3 hours |
| Phase 4 | Update app entry points (2 tasks) | 1 hour |
| Phase 5 | Remove HTTP infrastructure (4 tasks) | 1-2 hours |
| Phase 6 | Testing and verification (4 tasks) | 1-2 hours |

**Total: ~21 tasks, estimated 8-12 hours**

**Key files created:**
- `src-tauri/src/commands/edf_commands.rs`
- `src-tauri/src/commands/dda_ipc_commands.rs`
- `src-tauri/src/commands/file_ipc_commands.rs`
- `src-tauri/src/commands/ica_ipc_commands.rs`
- `src/services/tauriBackendService.ts`
- `src/contexts/BackendContext.tsx`

**Key files deleted:**
- `src-tauri/src/api/` (entire directory)
- `src/services/apiService.ts`
- `src/contexts/ApiServiceContext.tsx`
- `src/utils/httpClient.ts`
