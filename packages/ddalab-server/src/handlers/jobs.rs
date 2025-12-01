use crate::jobs::{
    DDAJob, DDAParameters, FileSource, JobStatusResponse, QueueStats, SubmitJobResponse,
};
use crate::state::ServerState;
use axum::{
    extract::{Multipart, Path, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Query params for listing jobs
#[derive(Debug, Deserialize)]
pub struct ListJobsQuery {
    /// Filter by user ID (admin can see all, users see their own)
    pub user_id: Option<String>,
    /// Filter by status
    pub status: Option<String>,
}

/// Request to submit job for server-side file
#[derive(Debug, Deserialize)]
pub struct SubmitServerFileRequest {
    /// Path to file on server (relative to server_files_directory)
    pub server_path: String,
    /// DDA parameters
    pub parameters: DDAParameters,
}

/// Response for file upload
#[derive(Debug, Serialize)]
pub struct UploadResponse {
    pub upload_id: String,
    pub filename: String,
    pub size: u64,
}

/// Submit a job for a server-side file
pub async fn submit_server_file_job(
    State(state): State<Arc<ServerState>>,
    Json(request): Json<SubmitServerFileRequest>,
) -> Result<Json<SubmitJobResponse>, (StatusCode, String)> {
    // Validate server-side file access is enabled
    let server_files_dir = state.config.server_files_directory.as_ref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Server-side file access is not configured".to_string(),
        )
    })?;

    // SECURITY: Reject absolute paths and path traversal attempts early
    let requested_path = PathBuf::from(&request.server_path);
    if requested_path.is_absolute() {
        warn!(
            "Rejected absolute path in job submission: {}",
            request.server_path
        );
        return Err((
            StatusCode::BAD_REQUEST,
            "Absolute paths are not allowed".to_string(),
        ));
    }

    // SECURITY: Check for path traversal components before any path resolution
    if request.server_path.contains("..") {
        warn!(
            "Rejected path traversal attempt in job submission: {}",
            request.server_path
        );
        return Err((
            StatusCode::BAD_REQUEST,
            "Path traversal sequences are not allowed".to_string(),
        ));
    }

    // Resolve path - only relative paths reach here
    let full_path = server_files_dir.join(&requested_path);

    // Security: Canonicalize and verify path is within allowed directory
    let canonical_path = full_path.canonicalize().map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            format!("File not found: {}", e),
        )
    })?;

    let canonical_base = server_files_dir.canonicalize().map_err(|e| {
        error!("Server files directory invalid: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server configuration error".to_string(),
        )
    })?;

    if !canonical_path.starts_with(&canonical_base) {
        warn!(
            "Path traversal attempt: {} outside of {}",
            canonical_path.display(),
            canonical_base.display()
        );
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    // Verify file exists and is readable
    if !canonical_path.is_file() {
        return Err((StatusCode::NOT_FOUND, "File not found".to_string()));
    }

    // Extract filename for display
    let filename = canonical_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Create job
    let job = DDAJob::new(
        "anonymous".to_string(), // TODO: Get from auth
        FileSource::ServerPath(canonical_path),
        filename,
        request.parameters,
        false, // Don't delete server-side files
    );

    let job_id = job.id;

    // Submit to queue
    state.job_queue.submit(job).await.map_err(|e| {
        error!("Failed to submit job: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to submit job: {}", e),
        )
    })?;

    info!("Job {} submitted for server file", job_id);

    Ok(Json(SubmitJobResponse {
        job_id,
        status: crate::jobs::JobStatus::Pending,
        message: "Job submitted successfully".to_string(),
    }))
}

/// Upload a file and submit a job
pub async fn upload_and_submit_job(
    State(state): State<Arc<ServerState>>,
    mut multipart: Multipart,
) -> Result<Json<SubmitJobResponse>, (StatusCode, String)> {
    let mut uploaded_file: Option<(PathBuf, String)> = None;
    let mut parameters: Option<DDAParameters> = None;
    let mut delete_after = true;
    let mut persist_upload = false;

    // Process multipart form
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid multipart data: {}", e),
        )
    })? {
        let name = field.name().unwrap_or_default().to_string();

        match name.as_str() {
            "file" => {
                let filename = field
                    .file_name()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "upload.edf".to_string());

                let data = field.bytes().await.map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Failed to read file: {}", e),
                    )
                })?;

                // Check file size
                if data.len() as u64 > state.config.max_upload_size {
                    return Err((
                        StatusCode::PAYLOAD_TOO_LARGE,
                        format!(
                            "File too large. Maximum size: {} bytes",
                            state.config.max_upload_size
                        ),
                    ));
                }

                // Create upload directory if needed
                tokio::fs::create_dir_all(&state.config.upload_directory)
                    .await
                    .map_err(|e| {
                        error!("Failed to create upload directory: {}", e);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Upload failed".to_string(),
                        )
                    })?;

                // Save file with unique name
                let upload_id = Uuid::new_v4();
                let ext = std::path::Path::new(&filename)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("edf");
                let saved_filename = format!("{}_{}.{}", upload_id, sanitize_filename(&filename), ext);
                let file_path = state.config.upload_directory.join(&saved_filename);

                tokio::fs::write(&file_path, &data).await.map_err(|e| {
                    error!("Failed to save uploaded file: {}", e);
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to save file".to_string(),
                    )
                })?;

                info!("File uploaded: {} ({} bytes)", file_path.display(), data.len());
                uploaded_file = Some((file_path, filename));
            }
            "parameters" => {
                let text = field.text().await.map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Failed to read parameters: {}", e),
                    )
                })?;
                parameters = Some(serde_json::from_str(&text).map_err(|e| {
                    (
                        StatusCode::BAD_REQUEST,
                        format!("Invalid parameters JSON: {}", e),
                    )
                })?);
            }
            "delete_after" => {
                let text = field.text().await.unwrap_or_default();
                delete_after = text.to_lowercase() == "true";
            }
            "persist_upload" => {
                let text = field.text().await.unwrap_or_default();
                persist_upload = text.to_lowercase() == "true";
            }
            _ => {
                // Ignore unknown fields
            }
        }
    }

    // Validate we have required data
    let (file_path, filename) = uploaded_file.ok_or_else(|| {
        (StatusCode::BAD_REQUEST, "No file provided".to_string())
    })?;

    let params = parameters.unwrap_or_default();

    // Determine file source type
    let file_source = if persist_upload {
        FileSource::UploadedPersistent(file_path)
    } else {
        FileSource::UploadedTemp(file_path)
    };

    // Create job
    let job = DDAJob::new(
        "anonymous".to_string(), // TODO: Get from auth
        file_source,
        filename,
        params,
        delete_after && !persist_upload,
    );

    let job_id = job.id;

    // Submit to queue
    state.job_queue.submit(job).await.map_err(|e| {
        error!("Failed to submit job: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to submit job: {}", e),
        )
    })?;

    info!("Job {} submitted with uploaded file", job_id);

    Ok(Json(SubmitJobResponse {
        job_id,
        status: crate::jobs::JobStatus::Pending,
        message: "Job submitted successfully".to_string(),
    }))
}

/// Get job status
pub async fn get_job_status(
    State(state): State<Arc<ServerState>>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<JobStatusResponse>, (StatusCode, String)> {
    let job = state.job_queue.get_job(job_id).await.ok_or_else(|| {
        (StatusCode::NOT_FOUND, "Job not found".to_string())
    })?;

    Ok(Json(JobStatusResponse::from(&job)))
}

/// List jobs
pub async fn list_jobs(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<ListJobsQuery>,
) -> Result<Json<Vec<JobStatusResponse>>, (StatusCode, String)> {
    let jobs = if let Some(user_id) = query.user_id {
        state.job_queue.get_user_jobs(&user_id).await
    } else {
        state.job_queue.get_all_jobs().await
    };

    let responses: Vec<JobStatusResponse> = jobs.iter().map(JobStatusResponse::from).collect();
    Ok(Json(responses))
}

/// Cancel a job
pub async fn cancel_job(
    State(state): State<Arc<ServerState>>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    let cancelled = state.job_queue.cancel(job_id).await.map_err(|e| {
        error!("Failed to cancel job: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to cancel: {}", e),
        )
    })?;

    if cancelled {
        Ok(Json(serde_json::json!({
            "success": true,
            "message": "Job cancelled"
        })))
    } else {
        Err((
            StatusCode::BAD_REQUEST,
            "Job cannot be cancelled (already completed or not found)".to_string(),
        ))
    }
}

/// Get queue statistics
pub async fn get_queue_stats(
    State(state): State<Arc<ServerState>>,
) -> Json<QueueStats> {
    Json(state.job_queue.stats().await)
}

/// Download job results
pub async fn download_job_results(
    State(state): State<Arc<ServerState>>,
    Path(job_id): Path<Uuid>,
) -> Result<(StatusCode, Vec<u8>), (StatusCode, String)> {
    let job = state.job_queue.get_job(job_id).await.ok_or_else(|| {
        (StatusCode::NOT_FOUND, "Job not found".to_string())
    })?;

    let output_path = job.output_path.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Job has no output (not completed or failed)".to_string(),
        )
    })?;

    let data = tokio::fs::read(&output_path).await.map_err(|e| {
        error!("Failed to read job output: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to read results".to_string(),
        )
    })?;

    Ok((StatusCode::OK, data))
}

/// SSE endpoint for job progress updates
pub async fn job_progress_stream(
    State(state): State<Arc<ServerState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut receiver = state.job_queue.subscribe();

    let stream = async_stream::stream! {
        loop {
            match receiver.recv().await {
                Ok(event) => {
                    let data = serde_json::to_string(&event).unwrap_or_default();
                    yield Ok(Event::default().data(data).event("progress"));
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!("SSE client lagged, missed {} events", n);
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    break;
                }
            }
        }
    };

    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// List available server-side files
#[derive(Debug, Serialize)]
pub struct ServerFileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_directory: bool,
}

pub async fn list_server_files(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<ListServerFilesQuery>,
) -> Result<Json<Vec<ServerFileInfo>>, (StatusCode, String)> {
    let server_files_dir = state.config.server_files_directory.as_ref().ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "Server-side file access is not configured".to_string(),
        )
    })?;

    let subpath = query.path.unwrap_or_default();

    // SECURITY: Early validation of path before any resolution
    if !subpath.is_empty() {
        let subpath_path = PathBuf::from(&subpath);
        if subpath_path.is_absolute() {
            warn!("Rejected absolute path in file listing: {}", subpath);
            return Err((
                StatusCode::BAD_REQUEST,
                "Absolute paths are not allowed".to_string(),
            ));
        }
        if subpath.contains("..") {
            warn!("Rejected path traversal attempt in file listing: {}", subpath);
            return Err((
                StatusCode::BAD_REQUEST,
                "Path traversal sequences are not allowed".to_string(),
            ));
        }
    }

    let target_dir = if subpath.is_empty() {
        server_files_dir.clone()
    } else {
        server_files_dir.join(&subpath)
    };

    // Security check (defense in depth)
    let canonical_target = target_dir.canonicalize().map_err(|_| {
        (StatusCode::NOT_FOUND, "Directory not found".to_string())
    })?;

    let canonical_base = server_files_dir.canonicalize().map_err(|e| {
        error!("Server files directory invalid: {}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Server configuration error".to_string(),
        )
    })?;

    if !canonical_target.starts_with(&canonical_base) {
        return Err((StatusCode::FORBIDDEN, "Access denied".to_string()));
    }

    let mut entries = Vec::new();
    let mut read_dir = tokio::fs::read_dir(&canonical_target).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read directory: {}", e),
        )
    })?;

    while let Some(entry) = read_dir.next_entry().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read entry: {}", e),
        )
    })? {
        let metadata = entry.metadata().await.ok();
        let is_dir = metadata.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);

        // Calculate relative path from server_files_dir
        let full_path = entry.path();
        let relative_path = full_path
            .strip_prefix(&canonical_base)
            .unwrap_or(&full_path)
            .to_string_lossy()
            .to_string();

        entries.push(ServerFileInfo {
            path: relative_path,
            name: entry.file_name().to_string_lossy().to_string(),
            size,
            is_directory: is_dir,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        }
    });

    Ok(Json(entries))
}

#[derive(Debug, Deserialize)]
pub struct ListServerFilesQuery {
    pub path: Option<String>,
}

/// Sanitize filename for safe storage
fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
        .take(100)
        .collect()
}
