use crate::state_manager::AppStateManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::command;
use tauri::{AppHandle, Emitter, State};

const OPENNEURO_API_KEY_NAME: &str = "openneuro_api_key";

/// Maximum duration for git clone/fetch operations (4 hours)
/// Prevents indefinite hangs from malicious/slow repositories
const GIT_OPERATION_TIMEOUT_SECS: u64 = 4 * 60 * 60;

/// Validate an OpenNeuro dataset ID format.
/// Prevents command injection by ensuring dataset ID matches expected pattern.
/// Valid format: "ds" followed by exactly 6 digits (e.g., ds000001)
fn validate_dataset_id(dataset_id: &str) -> Result<(), String> {
    // Must be exactly 8 characters: "ds" + 6 digits
    if dataset_id.len() != 8 {
        return Err(format!(
            "Invalid dataset ID format: '{}'. Expected format: dsNNNNNN (e.g., ds000001)",
            dataset_id
        ));
    }

    // Must start with "ds"
    if !dataset_id.starts_with("ds") {
        return Err(format!(
            "Invalid dataset ID format: '{}'. Must start with 'ds'",
            dataset_id
        ));
    }

    // Remaining 6 characters must be digits
    let digits = &dataset_id[2..];
    if !digits.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!(
            "Invalid dataset ID format: '{}'. Expected 6 digits after 'ds'",
            dataset_id
        ));
    }

    Ok(())
}

/// Validate a git reference (branch name, tag name) for safety.
/// Prevents command injection by allowing only safe characters.
/// Allows alphanumeric characters, dots, dashes, underscores, and forward slashes.
/// Rejects shell metacharacters and other potentially dangerous characters.
fn validate_git_ref(git_ref: &str) -> Result<(), String> {
    if git_ref.is_empty() {
        return Err("Git reference cannot be empty".to_string());
    }

    if git_ref.len() > 256 {
        return Err("Git reference too long (max 256 characters)".to_string());
    }

    // Check for git-specific dangerous patterns
    if git_ref.starts_with('-') {
        return Err(
            "Git reference cannot start with a dash (potential option injection)".to_string(),
        );
    }

    if git_ref.contains("..") {
        return Err("Git reference cannot contain '..' (potential path traversal)".to_string());
    }

    // Allow only safe characters: alphanumeric, dots, dashes, underscores, forward slashes
    for c in git_ref.chars() {
        if !c.is_ascii_alphanumeric() && c != '.' && c != '-' && c != '_' && c != '/' {
            return Err(format!(
                "Invalid git reference: '{}'. Only alphanumeric characters, dots, dashes, underscores, and forward slashes are allowed. Found invalid character: '{}'",
                git_ref, c
            ));
        }
    }

    Ok(())
}

/// Information about a running download process for safe cancellation
#[derive(Clone)]
pub struct ProcessInfo {
    /// Process ID
    pub pid: u32,
    /// Timestamp when the process was started (for verification)
    pub started_at: std::time::Instant,
    /// Command that was executed (for verification)
    pub command: String,
}

// State for tracking active downloads
// Uses ProcessInfo instead of raw PID to prevent race conditions
// when cancelling downloads (PID reuse could kill unrelated processes)
pub struct DownloadState {
    pub active_downloads: Arc<Mutex<HashMap<String, Arc<Mutex<Option<ProcessInfo>>>>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiKeyStatus {
    pub has_key: bool,
    pub key_preview: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub dataset_id: String,
    pub phase: String, // "cloning", "fetching", "completed", "error"
    pub progress_percent: f32,
    pub message: String,
    pub current_file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadOptions {
    pub dataset_id: String,
    pub destination_path: String,
    pub use_github: bool,       // true = GitHub, false = OpenNeuro git server
    pub download_annexed: bool, // Download actual file data
    pub snapshot_tag: Option<String>, // Specific snapshot version
}

#[command]
pub async fn save_openneuro_api_key(
    api_key: String,
    state_manager: State<'_, AppStateManager>,
) -> Result<(), String> {
    log::info!(
        "[SECRETS_DB] save_openneuro_api_key called with key length: {}",
        api_key.len()
    );

    if api_key.trim().is_empty() {
        log::error!("[SECRETS_DB] API key is empty, rejecting save");
        return Err("API key cannot be empty".to_string());
    }

    let secrets_db = state_manager.get_secrets_db();

    log::info!("[SECRETS_DB] Storing encrypted API key...");
    secrets_db
        .set_secret(OPENNEURO_API_KEY_NAME, &api_key)
        .map_err(|e| {
            log::error!("[SECRETS_DB] Failed to store API key: {}", e);
            format!("Failed to save API key: {}", e)
        })?;

    log::info!("[SECRETS_DB] OpenNeuro API key saved successfully to encrypted database");

    // Verify the save by immediately reading it back
    match secrets_db.get_secret(OPENNEURO_API_KEY_NAME) {
        Ok(Some(saved_key)) => {
            if saved_key == api_key {
                log::info!("[SECRETS_DB] Verification successful: key matches what was saved");
            } else {
                log::error!(
                    "[SECRETS_DB] Verification FAILED: retrieved key doesn't match saved key!"
                );
            }
        }
        Ok(None) => {
            log::error!("[SECRETS_DB] Verification FAILED: key not found after save!");
        }
        Err(e) => {
            log::error!(
                "[SECRETS_DB] Verification FAILED: couldn't read back the key: {}",
                e
            );
        }
    }

    Ok(())
}

#[command]
pub async fn get_openneuro_api_key(
    state_manager: State<'_, AppStateManager>,
) -> Result<String, String> {
    log::info!("[SECRETS_DB] get_openneuro_api_key called");

    let secrets_db = state_manager.get_secrets_db();

    log::info!("[SECRETS_DB] Attempting to read encrypted API key...");
    match secrets_db.get_secret(OPENNEURO_API_KEY_NAME) {
        Ok(Some(key)) => {
            log::info!(
                "[SECRETS_DB] Successfully retrieved API key from encrypted database (length: {})",
                key.len()
            );
            Ok(key)
        }
        Ok(None) => {
            log::info!("[SECRETS_DB] No API key found in encrypted database");
            Err("No API key found".to_string())
        }
        Err(e) => {
            log::error!("[SECRETS_DB] Failed to retrieve API key: {}", e);
            Err(format!("Failed to retrieve API key: {}", e))
        }
    }
}

#[command]
pub async fn check_openneuro_api_key(
    state_manager: State<'_, AppStateManager>,
) -> Result<ApiKeyStatus, String> {
    log::info!("[SECRETS_DB] check_openneuro_api_key called");

    let secrets_db = state_manager.get_secrets_db();

    match secrets_db.get_secret(OPENNEURO_API_KEY_NAME) {
        Ok(Some(key)) => {
            log::info!(
                "[SECRETS_DB] Check found API key in encrypted database (length: {})",
                key.len()
            );
            let preview = if key.len() > 8 {
                Some(format!("{}...{}", &key[..4], &key[key.len() - 4..]))
            } else {
                Some("****".to_string())
            };
            Ok(ApiKeyStatus {
                has_key: true,
                key_preview: preview,
            })
        }
        Ok(None) => {
            log::info!("[SECRETS_DB] Check found no API key in encrypted database");
            Ok(ApiKeyStatus {
                has_key: false,
                key_preview: None,
            })
        }
        Err(e) => {
            log::warn!("[SECRETS_DB] Check failed: {}", e);
            Ok(ApiKeyStatus {
                has_key: false,
                key_preview: None,
            })
        }
    }
}

#[command]
pub async fn delete_openneuro_api_key(
    state_manager: State<'_, AppStateManager>,
) -> Result<(), String> {
    log::info!("[SECRETS_DB] delete_openneuro_api_key called");

    let secrets_db = state_manager.get_secrets_db();

    secrets_db
        .delete_secret(OPENNEURO_API_KEY_NAME)
        .map_err(|e| {
            log::error!("[SECRETS_DB] Failed to delete API key: {}", e);
            format!("Failed to delete API key: {}", e)
        })?;

    log::info!("[SECRETS_DB] OpenNeuro API key deleted successfully from encrypted database");
    Ok(())
}

// Check if git is available
#[command]
pub async fn check_git_available() -> Result<bool, String> {
    match Command::new("git").arg("--version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

// Check if git-annex is available (optional but recommended)
#[command]
pub async fn check_git_annex_available() -> Result<bool, String> {
    match Command::new("git-annex").arg("version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

// Helper function to check if download is cancelled
fn is_cancelled(download_state: &State<DownloadState>, dataset_id: &str) -> bool {
    if let Ok(downloads) = download_state.active_downloads.lock() {
        if let Some(process_info_lock) = downloads.get(dataset_id) {
            if let Ok(process_info) = process_info_lock.lock() {
                return process_info.is_none(); // None means cancelled
            }
        }
    }
    false
}

// Download dataset using git clone
#[command]
pub async fn download_openneuro_dataset(
    app_handle: AppHandle,
    download_state: State<'_, DownloadState>,
    options: DownloadOptions,
) -> Result<String, String> {
    log::info!("Starting download for dataset: {}", options.dataset_id);

    // Validate all user-provided inputs before using them in git commands
    validate_dataset_id(&options.dataset_id)?;

    if let Some(ref tag) = options.snapshot_tag {
        validate_git_ref(tag)?;
    }

    // Validate destination path doesn't contain suspicious patterns
    if options.destination_path.contains("..") {
        return Err("Destination path cannot contain '..' (path traversal attempt)".to_string());
    }

    // Register this download with ProcessInfo for safe cancellation
    let process_info_lock: Arc<Mutex<Option<ProcessInfo>>> = Arc::new(Mutex::new(None));
    {
        let mut downloads = download_state
            .active_downloads
            .lock()
            .map_err(|e| format!("Failed to lock download state: {}", e))?;
        downloads.insert(options.dataset_id.clone(), process_info_lock.clone());
    }

    // Construct the git URL using validated dataset_id
    // Only use pre-defined URL patterns with validated dataset ID
    let git_url = if options.use_github {
        format!(
            "https://github.com/OpenNeuroDatasets/{}.git",
            options.dataset_id
        )
    } else {
        format!("https://openneuro.org/git/0/{}", options.dataset_id)
    };

    let dest_path = PathBuf::from(&options.destination_path);
    let dataset_path = dest_path.join(&options.dataset_id);

    // Check if this is a resume operation
    let is_resume = dataset_path.exists() && dataset_path.join(".git").exists();

    if is_resume {
        log::info!(
            "Detected existing repository, will resume download for: {}",
            options.dataset_id
        );
        let _ = app_handle.emit(
            "openneuro-download-progress",
            DownloadProgress {
                dataset_id: options.dataset_id.clone(),
                phase: "cloning".to_string(),
                progress_percent: 0.0,
                message: "Resuming previous download...".to_string(),
                current_file: None,
            },
        );
    } else if dataset_path.exists() {
        // Directory exists but not a git repo - error
        return Err(format!("Dataset directory exists but is not a git repository: {:?}. Please remove it or choose a different location.", dataset_path));
    } else {
        // Fresh download
        let _ = app_handle.emit(
            "openneuro-download-progress",
            DownloadProgress {
                dataset_id: options.dataset_id.clone(),
                phase: "cloning".to_string(),
                progress_percent: 0.0,
                message: "Starting download...".to_string(),
                current_file: None,
            },
        );
    }

    // Set up git command - clone or fetch depending on resume state
    let mut git_cmd = Command::new("git");

    if is_resume {
        // Resume: use git fetch to continue
        log::info!("Resuming with git fetch from: {}", git_url);

        // First, ensure remote URL is correct
        let _ = Command::new("git")
            .arg("remote")
            .arg("set-url")
            .arg("origin")
            .arg(&git_url)
            .current_dir(&dataset_path)
            .output();

        git_cmd
            .arg("fetch")
            .arg("origin") // Only fetch from origin, not git-annex special remotes
            .arg("--progress")
            .current_dir(&dataset_path);
    } else {
        // Fresh clone
        log::info!("Starting fresh clone from: {}", git_url);
        git_cmd.arg("clone").arg("--progress");

        // If a specific snapshot tag is requested, use --branch
        if let Some(ref tag) = options.snapshot_tag {
            git_cmd.arg("--branch").arg(tag);
        }

        git_cmd
            .arg(&git_url)
            .arg(&dataset_path)
            .current_dir(&dest_path);
    }

    git_cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = git_cmd.spawn().map_err(|e| {
        format!(
            "Failed to start git operation: {}. Make sure git is installed.",
            e
        )
    })?;

    // Store process info for safe cancellation (includes timestamp to prevent PID reuse attacks)
    let pid = child.id();
    let started_at = std::time::Instant::now();
    if let Ok(mut process_info_guard) = process_info_lock.lock() {
        *process_info_guard = Some(ProcessInfo {
            pid,
            started_at,
            command: "git".to_string(),
        });
    }

    // Capture stderr for progress (git outputs to stderr)
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            // Check for timeout to prevent indefinite hangs
            if started_at.elapsed().as_secs() > GIT_OPERATION_TIMEOUT_SECS {
                log::error!(
                    "Git operation timeout for dataset: {} (exceeded {} hours)",
                    options.dataset_id,
                    GIT_OPERATION_TIMEOUT_SECS / 3600
                );
                let _ = child.kill();
                let _ = app_handle.emit(
                    "openneuro-download-progress",
                    DownloadProgress {
                        dataset_id: options.dataset_id.clone(),
                        phase: "error".to_string(),
                        progress_percent: 0.0,
                        message: format!(
                            "Download timed out after {} hours. The repository may be too large or the server may be slow.",
                            GIT_OPERATION_TIMEOUT_SECS / 3600
                        ),
                        current_file: None,
                    },
                );
                // Cleanup
                if let Ok(mut downloads) = download_state.active_downloads.lock() {
                    downloads.remove(&options.dataset_id);
                }
                return Err(format!(
                    "Git operation timed out after {} hours",
                    GIT_OPERATION_TIMEOUT_SECS / 3600
                ));
            }

            // Check for cancellation
            if is_cancelled(&download_state, &options.dataset_id) {
                log::info!("Download cancelled for dataset: {}", options.dataset_id);
                let _ = child.kill();
                let _ = app_handle.emit(
                    "openneuro-download-progress",
                    DownloadProgress {
                        dataset_id: options.dataset_id.clone(),
                        phase: "error".to_string(),
                        progress_percent: 0.0,
                        message: "Download cancelled by user".to_string(),
                        current_file: None,
                    },
                );
                // Cleanup
                if let Ok(mut downloads) = download_state.active_downloads.lock() {
                    downloads.remove(&options.dataset_id);
                }
                return Err("Download cancelled".to_string());
            }

            if let Ok(line) = line {
                log::debug!("git clone: {}", line);

                // Parse progress from git output
                let progress_percent =
                    if line.contains("Receiving objects:") || line.contains("Resolving deltas:") {
                        // Try to extract percentage
                        if let Some(pct_str) = line.split('%').next() {
                            if let Some(num_str) = pct_str.split_whitespace().last() {
                                num_str.parse::<f32>().unwrap_or(50.0)
                            } else {
                                50.0
                            }
                        } else {
                            50.0
                        }
                    } else {
                        25.0
                    };

                let _ = app_handle.emit(
                    "openneuro-download-progress",
                    DownloadProgress {
                        dataset_id: options.dataset_id.clone(),
                        phase: "cloning".to_string(),
                        progress_percent,
                        message: line.clone(),
                        current_file: None,
                    },
                );
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for git clone: {}", e))?;

    if !status.success() {
        let _ = app_handle.emit(
            "openneuro-download-progress",
            DownloadProgress {
                dataset_id: options.dataset_id.clone(),
                phase: "error".to_string(),
                progress_percent: 0.0,
                message: if is_resume {
                    "Git fetch failed".to_string()
                } else {
                    "Git clone failed".to_string()
                },
                current_file: None,
            },
        );
        return Err(if is_resume {
            "Git fetch failed. Check logs for details.".to_string()
        } else {
            "Git clone failed. Check logs for details.".to_string()
        });
    }

    log::info!(
        "{} completed successfully",
        if is_resume { "Git fetch" } else { "Git clone" }
    );

    // If resuming, checkout the working tree
    if is_resume {
        log::info!("Checking out working tree after fetch");
        let _ = app_handle.emit(
            "openneuro-download-progress",
            DownloadProgress {
                dataset_id: options.dataset_id.clone(),
                phase: "cloning".to_string(),
                progress_percent: 45.0,
                message: "Updating working tree...".to_string(),
                current_file: None,
            },
        );

        // Determine what to checkout
        let checkout_ref = if let Some(ref tag) = options.snapshot_tag {
            tag.clone()
        } else {
            "origin/HEAD".to_string()
        };

        let checkout_result = Command::new("git")
            .arg("checkout")
            .arg(&checkout_ref)
            .current_dir(&dataset_path)
            .output();

        if let Err(e) = checkout_result {
            log::warn!("Failed to checkout {}: {}", checkout_ref, e);
        }
    }

    // If download_annexed is true and git-annex is available, try to get annexed files
    if options.download_annexed {
        let _ = app_handle.emit(
            "openneuro-download-progress",
            DownloadProgress {
                dataset_id: options.dataset_id.clone(),
                phase: "fetching".to_string(),
                progress_percent: 50.0,
                message: "Starting annexed file download...".to_string(),
                current_file: None,
            },
        );

        // Try git-annex get
        if check_git_annex_available().await.unwrap_or(false) {
            log::info!("Attempting to fetch annexed files with git-annex");

            // Run git-annex with --json-progress for detailed progress tracking
            let mut annex_cmd = Command::new("git-annex");
            annex_cmd
                .arg("get")
                .arg("--json-progress")
                .arg(".")
                .current_dir(&dataset_path)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            let mut child = match annex_cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Failed to spawn git-annex: {}", e);
                    let _ = app_handle.emit(
                        "openneuro-download-progress",
                        DownloadProgress {
                            dataset_id: options.dataset_id.clone(),
                            phase: "fetching".to_string(),
                            progress_percent: 90.0,
                            message: "git-annex failed to start. Dataset structure downloaded."
                                .to_string(),
                            current_file: None,
                        },
                    );
                    // Cleanup and continue without annexing
                    if let Ok(mut downloads) = download_state.active_downloads.lock() {
                        downloads.remove(&options.dataset_id);
                    }
                    return Ok(dataset_path.to_string_lossy().to_string());
                }
            };

            // Store git-annex process info for safe cancellation
            let pid = child.id();
            let started_at = std::time::Instant::now();
            if let Ok(mut process_info_guard) = process_info_lock.lock() {
                *process_info_guard = Some(ProcessInfo {
                    pid,
                    started_at,
                    command: "git-annex".to_string(),
                });
            }

            // Track progress from git-annex output
            let mut files_downloaded = 0;
            let mut total_files = 0;
            let mut current_file_name: Option<String> = None;

            // Capture stdout for JSON progress
            if let Some(stdout) = child.stdout.take() {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    // Check for cancellation
                    if is_cancelled(&download_state, &options.dataset_id) {
                        log::info!(
                            "Download cancelled during git-annex for dataset: {}",
                            options.dataset_id
                        );
                        let _ = child.kill();
                        let _ = app_handle.emit(
                            "openneuro-download-progress",
                            DownloadProgress {
                                dataset_id: options.dataset_id.clone(),
                                phase: "error".to_string(),
                                progress_percent: 0.0,
                                message: "Download cancelled by user".to_string(),
                                current_file: None,
                            },
                        );
                        // Cleanup
                        if let Ok(mut downloads) = download_state.active_downloads.lock() {
                            downloads.remove(&options.dataset_id);
                        }
                        return Err("Download cancelled".to_string());
                    }

                    if let Ok(line) = line {
                        log::debug!("git-annex: {}", line);

                        // Try to parse JSON progress
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                            // Extract file information
                            if let Some(file) = json.get("file").and_then(|f| f.as_str()) {
                                current_file_name = Some(file.to_string());
                            }

                            // Check if this is a download action
                            if let Some(action) = json.get("action") {
                                if let Some(action_str) =
                                    action.get("command").and_then(|c| c.as_str())
                                {
                                    if action_str == "get" {
                                        total_files += 1;
                                    }
                                }
                            }

                            // Check for success status
                            if let Some(success) = json.get("success").and_then(|s| s.as_bool()) {
                                if success {
                                    files_downloaded += 1;
                                }
                            }

                            // Calculate progress percentage (50-95% range for annex phase)
                            let progress_percent = if total_files > 0 {
                                50.0 + ((files_downloaded as f32 / total_files as f32) * 45.0)
                            } else {
                                60.0
                            };

                            let message = if let Some(ref file) = current_file_name {
                                if total_files > 0 {
                                    format!(
                                        "Downloading file {} of {}",
                                        files_downloaded + 1,
                                        total_files
                                    )
                                } else {
                                    format!("Downloading {}", file)
                                }
                            } else {
                                "Downloading annexed files...".to_string()
                            };

                            let _ = app_handle.emit(
                                "openneuro-download-progress",
                                DownloadProgress {
                                    dataset_id: options.dataset_id.clone(),
                                    phase: "fetching".to_string(),
                                    progress_percent,
                                    message,
                                    current_file: current_file_name.clone(),
                                },
                            );
                        } else {
                            // Non-JSON output, just log it
                            log::debug!("git-annex output: {}", line);
                        }
                    }
                }
            }

            let status = child
                .wait()
                .map_err(|e| format!("Failed to wait for git-annex: {}", e))?;

            if status.success() {
                log::info!(
                    "Successfully retrieved annexed files ({} files)",
                    files_downloaded
                );
                let _ = app_handle.emit(
                    "openneuro-download-progress",
                    DownloadProgress {
                        dataset_id: options.dataset_id.clone(),
                        phase: "fetching".to_string(),
                        progress_percent: 95.0,
                        message: format!(
                            "Successfully downloaded {} annexed files",
                            files_downloaded
                        ),
                        current_file: None,
                    },
                );
            } else {
                log::warn!("git-annex get completed with warnings");
                let _ = app_handle.emit(
                    "openneuro-download-progress",
                    DownloadProgress {
                        dataset_id: options.dataset_id.clone(),
                        phase: "fetching".to_string(),
                        progress_percent: 90.0,
                        message: "Some annexed files may not have downloaded".to_string(),
                        current_file: None,
                    },
                );
            }
        } else {
            log::info!("git-annex not available, skipping annexed file retrieval");
            let _ = app_handle.emit("openneuro-download-progress", DownloadProgress {
                dataset_id: options.dataset_id.clone(),
                phase: "cloning".to_string(),
                progress_percent: 90.0,
                message: "git-annex not available. Dataset structure downloaded, but large files may be symbolic links.".to_string(),
                current_file: None,
            });
        }
    }

    // Emit completion and cleanup
    let _ = app_handle.emit(
        "openneuro-download-progress",
        DownloadProgress {
            dataset_id: options.dataset_id.clone(),
            phase: "completed".to_string(),
            progress_percent: 100.0,
            message: "Download completed successfully".to_string(),
            current_file: None,
        },
    );

    // Remove from active downloads
    if let Ok(mut downloads) = download_state.active_downloads.lock() {
        downloads.remove(&options.dataset_id);
    }

    log::info!("Dataset download completed: {:?}", dataset_path);
    Ok(dataset_path.to_string_lossy().to_string())
}

// Cancel an ongoing download
// Uses ProcessInfo to verify process identity before killing,
// preventing PID reuse attacks where killing by PID could terminate an unrelated process.
#[command]
pub async fn cancel_openneuro_download(
    download_state: State<'_, DownloadState>,
    dataset_id: String,
) -> Result<(), String> {
    log::info!("Cancellation requested for dataset: {}", dataset_id);

    if let Ok(downloads) = download_state.active_downloads.lock() {
        if let Some(process_info_lock) = downloads.get(&dataset_id) {
            // Mark as cancelled by setting ProcessInfo to None
            if let Ok(mut process_info_opt) = process_info_lock.lock() {
                if let Some(process_info) = process_info_opt.take() {
                    // Verify the process is still likely ours before killing
                    // Check that the process was started recently (within reasonable time for a download)
                    let elapsed = process_info.started_at.elapsed();
                    const MAX_DOWNLOAD_DURATION: std::time::Duration =
                        std::time::Duration::from_secs(24 * 60 * 60); // 24 hours max

                    if elapsed > MAX_DOWNLOAD_DURATION {
                        log::warn!(
                            "Process {} started too long ago ({:?}), not killing (potential PID reuse)",
                            process_info.pid,
                            elapsed
                        );
                        return Err("Process may have already terminated".to_string());
                    }

                    log::info!(
                        "Marking download as cancelled (PID: {}, command: {}, age: {:?})",
                        process_info.pid,
                        process_info.command,
                        elapsed
                    );

                    // Try to kill the process on Unix systems
                    #[cfg(unix)]
                    {
                        use std::process::Command as StdCommand;
                        // Verify process is still running and is a git-related process
                        // by checking /proc/{pid}/comm or similar before killing
                        let proc_path = format!("/proc/{}/comm", process_info.pid);
                        if let Ok(comm) = std::fs::read_to_string(&proc_path) {
                            let comm = comm.trim();
                            if comm != "git" && comm != "git-annex" {
                                log::warn!(
                                    "Process {} is '{}', not '{}' - not killing",
                                    process_info.pid,
                                    comm,
                                    process_info.command
                                );
                                return Err("Process identity mismatch".to_string());
                            }
                        }
                        // On macOS, /proc doesn't exist, so we fall through and rely on
                        // the timestamp check and the fact that we're signaling with SIGTERM
                        // which allows the process to clean up gracefully

                        let _ = StdCommand::new("kill")
                            .arg("-TERM")
                            .arg(process_info.pid.to_string())
                            .output();
                    }

                    // On Windows
                    #[cfg(windows)]
                    {
                        use std::process::Command as StdCommand;
                        // Windows doesn't have an easy way to verify process name from PID
                        // without additional dependencies, so we rely on the timestamp check
                        let _ = StdCommand::new("taskkill")
                            .args(&["/PID", &process_info.pid.to_string(), "/F"])
                            .output();
                    }

                    return Ok(());
                }
            }
        }
    }

    Err(format!(
        "No active download found for dataset: {}",
        dataset_id
    ))
}

// Tests are in the secrets_db module since these commands require Tauri State
// which cannot be easily mocked in unit tests

// ========== UPLOAD FUNCTIONALITY ==========

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadOptions {
    pub dataset_path: String,
    pub affirm_defaced: bool,
    pub dataset_name: Option<String>,
    pub dataset_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UploadProgress {
    pub dataset_id: Option<String>,
    pub phase: String, // "validating", "creating_dataset", "uploading_files", "committing", "completed", "error"
    pub progress_percent: f32,
    pub message: String,
    pub current_file: Option<String>,
    pub files_uploaded: Option<usize>,
    pub total_files: Option<usize>,
}

// State for tracking active uploads
pub struct UploadState {
    pub active_uploads: Arc<Mutex<HashMap<String, Arc<Mutex<Option<u32>>>>>>,
}

impl Default for UploadState {
    fn default() -> Self {
        Self {
            active_uploads: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[command]
pub async fn upload_bids_dataset(
    options: UploadOptions,
    app_handle: AppHandle,
    upload_state: State<'_, UploadState>,
) -> Result<String, String> {
    log::info!(
        "Starting BIDS dataset upload from: {}",
        options.dataset_path
    );

    // Emit initial progress
    let _ = app_handle.emit(
        "openneuro-upload-progress",
        UploadProgress {
            dataset_id: None,
            phase: "validating".to_string(),
            progress_percent: 0.0,
            message: "Validating BIDS dataset...".to_string(),
            current_file: None,
            files_uploaded: None,
            total_files: None,
        },
    );

    // Validate dataset path exists
    let dataset_path = PathBuf::from(&options.dataset_path);
    if !dataset_path.exists() {
        let _ = app_handle.emit(
            "openneuro-upload-progress",
            UploadProgress {
                dataset_id: None,
                phase: "error".to_string(),
                progress_percent: 0.0,
                message: format!("Dataset path does not exist: {}", options.dataset_path),
                current_file: None,
                files_uploaded: None,
                total_files: None,
            },
        );
        return Err("Dataset path does not exist".to_string());
    }

    // Check for dataset_description.json
    let description_path = dataset_path.join("dataset_description.json");
    if !description_path.exists() {
        let _ = app_handle.emit(
            "openneuro-upload-progress",
            UploadProgress {
                dataset_id: None,
                phase: "error".to_string(),
                progress_percent: 0.0,
                message: "dataset_description.json not found - not a valid BIDS dataset"
                    .to_string(),
                current_file: None,
                files_uploaded: None,
                total_files: None,
            },
        );
        return Err("dataset_description.json not found".to_string());
    }

    let _ = app_handle.emit(
        "openneuro-upload-progress",
        UploadProgress {
            dataset_id: None,
            phase: "validating".to_string(),
            progress_percent: 10.0,
            message: "BIDS dataset validation passed".to_string(),
            current_file: None,
            files_uploaded: None,
            total_files: None,
        },
    );

    // For now, return a message indicating that the upload needs to be completed via the frontend
    // The actual GraphQL mutations will be called from the TypeScript frontend
    log::info!("Dataset validation complete. Upload will continue via GraphQL API from frontend.");

    let _ = app_handle.emit(
        "openneuro-upload-progress",
        UploadProgress {
            dataset_id: None,
            phase: "creating_dataset".to_string(),
            progress_percent: 20.0,
            message: "Ready to create dataset on OpenNeuro...".to_string(),
            current_file: None,
            files_uploaded: None,
            total_files: None,
        },
    );

    Ok("validated".to_string())
}

#[command]
pub async fn cancel_bids_upload(
    dataset_id: String,
    upload_state: State<'_, UploadState>,
) -> Result<(), String> {
    log::info!("Cancelling upload for dataset: {}", dataset_id);

    if let Ok(mut uploads) = upload_state.active_uploads.lock() {
        uploads.remove(&dataset_id);
    }

    Ok(())
}
