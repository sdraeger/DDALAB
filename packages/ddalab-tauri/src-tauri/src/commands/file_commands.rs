use crate::edf::EDFReader;
use crate::file_readers::FileReaderFactory;
use crate::file_writers::{FileWriterFactory, WriterConfig};
use crate::intermediate_format::{ChannelData, DataMetadata, IntermediateData};
use crate::text_reader::TextFileReader;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentFileParams {
    pub file_path: String,
    pub start_time: f64,
    pub start_unit: String, // "seconds" or "samples"
    pub end_time: f64,
    pub end_unit: String, // "seconds" or "samples"
    pub output_directory: String,
    pub output_format: String, // "same", "edf", "csv", "ascii"
    pub output_filename: String,
    pub selected_channels: Option<Vec<usize>>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentFileResult {
    pub output_path: String,
    pub operation_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentFileProgress {
    pub phase: String, // "loading", "processing", "writing", "complete", "error", "cancelled"
    pub progress_percent: f32,
    pub message: String,
    pub operation_id: String,
}

/// Thread-safe cancellation token for per-operation cancellation
#[derive(Clone)]
struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    fn new() -> Self {
        Self(Arc::new(AtomicBool::new(false)))
    }

    fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Global registry of active operations and their cancellation tokens
static OPERATION_COUNTER: AtomicU64 = AtomicU64::new(0);
static ACTIVE_OPERATIONS: OnceLock<RwLock<HashMap<String, CancellationToken>>> = OnceLock::new();

fn get_active_operations() -> &'static RwLock<HashMap<String, CancellationToken>> {
    ACTIVE_OPERATIONS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn generate_operation_id() -> String {
    let counter = OPERATION_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("segment-{}-{}", std::process::id(), counter)
}

fn register_operation(operation_id: &str) -> CancellationToken {
    let token = CancellationToken::new();
    if let Ok(mut ops) = get_active_operations().write() {
        ops.insert(operation_id.to_string(), token.clone());
    }
    token
}

fn unregister_operation(operation_id: &str) {
    if let Ok(mut ops) = get_active_operations().write() {
        ops.remove(operation_id);
    }
}

#[tauri::command]
pub async fn cancel_segment_file(operation_id: Option<String>) -> Result<(), String> {
    if let Some(id) = operation_id {
        log::info!("[FILE_CUT] Cancellation requested for operation: {}", id);
        if let Ok(ops) = get_active_operations().read() {
            if let Some(token) = ops.get(&id) {
                token.cancel();
                return Ok(());
            }
        }
        Err(format!("Operation {} not found or already completed", id))
    } else {
        // Cancel all active operations (backwards compatibility)
        log::info!("[FILE_CUT] Cancellation requested for all operations");
        if let Ok(ops) = get_active_operations().read() {
            for token in ops.values() {
                token.cancel();
            }
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn segment_file(
    app_handle: AppHandle,
    params: SegmentFileParams,
) -> Result<SegmentFileResult, String> {
    // Generate or use provided operation ID for per-operation cancellation
    let operation_id = params
        .operation_id
        .clone()
        .unwrap_or_else(generate_operation_id);

    log::info!(
        "[FILE_CUT] Starting file extraction: {} (operation: {})",
        params.file_path,
        operation_id
    );
    log::info!(
        "[FILE_CUT] Start: {} {}, End: {} {}",
        params.start_time,
        params.start_unit,
        params.end_time,
        params.end_unit
    );
    log::info!("[FILE_CUT] Output format: {}", params.output_format);

    // Register this operation for cancellation tracking
    let cancellation_token = register_operation(&operation_id);
    let op_id_clone = operation_id.clone();

    // Emit starting event
    let _ = app_handle.emit(
        "segment-file-progress",
        SegmentFileProgress {
            phase: "loading".to_string(),
            progress_percent: 0.0,
            message: "Loading source file...".to_string(),
            operation_id: operation_id.clone(),
        },
    );

    // Run blocking file I/O on dedicated thread pool to avoid freezing Tauri
    // Use a 10-minute timeout for large file operations
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(600),
        tokio::task::spawn_blocking(move || {
            segment_file_blocking(params, &cancellation_token, &op_id_clone)
        }),
    )
    .await
    .map_err(|_| "File segmentation timed out after 10 minutes".to_string())?
    .map_err(|e| format!("Task join error: {}", e))?;

    // Unregister the operation after completion
    unregister_operation(&operation_id);

    // Emit completion event
    match &result {
        Ok(r) => {
            let _ = app_handle.emit(
                "segment-file-progress",
                SegmentFileProgress {
                    phase: "complete".to_string(),
                    progress_percent: 100.0,
                    message: format!("File saved: {}", r.output_path),
                    operation_id: operation_id.clone(),
                },
            );
        }
        Err(e) => {
            let phase = if e.contains("cancelled") {
                "cancelled"
            } else {
                "error"
            };
            let _ = app_handle.emit(
                "segment-file-progress",
                SegmentFileProgress {
                    phase: phase.to_string(),
                    progress_percent: 0.0,
                    message: e.clone(),
                    operation_id: operation_id.clone(),
                },
            );
        }
    }

    result
}

fn check_cancelled(token: &CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("Operation cancelled by user".to_string())
    } else {
        Ok(())
    }
}

fn segment_file_blocking(
    params: SegmentFileParams,
    cancellation_token: &CancellationToken,
    operation_id: &str,
) -> Result<SegmentFileResult, String> {
    // Load the file into IntermediateData
    let file_path = PathBuf::from(&params.file_path);
    let data = load_file_to_intermediate(&file_path)?;

    // Check for cancellation after loading
    check_cancelled(cancellation_token)?;

    // Convert start and end to samples
    let start_sample = time_to_samples(
        params.start_time,
        &params.start_unit,
        data.metadata.sample_rate,
    )?;

    let end_sample = time_to_samples(params.end_time, &params.end_unit, data.metadata.sample_rate)?;

    let total_samples = data.num_samples();

    if start_sample >= end_sample {
        return Err("Start time must be less than end time".to_string());
    }

    if start_sample >= total_samples {
        return Err(format!(
            "Start time exceeds file duration (max {} samples)",
            total_samples
        ));
    }

    // Clamp end_sample to total_samples
    let end_sample = end_sample.min(total_samples);

    log::info!(
        "[FILE_CUT] Extracting samples {} to {} (total: {})",
        start_sample,
        end_sample,
        total_samples
    );

    // Filter channels if specified
    let filtered_data = if let Some(channel_indices) = &params.selected_channels {
        filter_channels(&data, channel_indices)?
    } else {
        data
    };

    // Check for cancellation after filtering
    check_cancelled(cancellation_token)?;

    // Extract the segment
    let segment = extract_segment(&filtered_data, start_sample, end_sample)?;

    // Check for cancellation after extraction
    check_cancelled(cancellation_token)?;

    // Determine output format
    let output_format = determine_output_format(&params.output_format, &file_path)?;

    // Validate and canonicalize output directory path to prevent path traversal attacks
    let output_dir = PathBuf::from(&params.output_directory);

    // Check for path traversal patterns
    if params.output_directory.contains("..") || params.output_directory.contains("~") {
        return Err("Invalid output directory: path traversal not allowed".to_string());
    }

    // Canonicalize path if it exists, or validate parent if it doesn't
    let validated_output_dir = if output_dir.exists() {
        output_dir
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalize output directory: {}", e))?
    } else {
        // For new directories, validate parent exists and is safe
        if let Some(parent) = output_dir.parent() {
            if parent.exists() {
                parent
                    .canonicalize()
                    .map_err(|e| format!("Failed to canonicalize parent directory: {}", e))?
                    .join(output_dir.file_name().unwrap())
            } else {
                return Err("Parent directory does not exist".to_string());
            }
        } else {
            return Err("Invalid output directory path".to_string());
        }
    };

    // Create output directory if it doesn't exist
    std::fs::create_dir_all(&validated_output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Validate filename doesn't contain path separators
    if params.output_filename.contains('/') || params.output_filename.contains('\\') {
        return Err("Invalid output filename: path separators not allowed".to_string());
    }

    // Construct output path
    let output_path = validated_output_dir.join(&params.output_filename);

    // Check for cancellation before writing
    check_cancelled(cancellation_token)?;

    // Export segment
    export_segment(&segment, &output_path, &output_format)?;

    log::info!("[FILE_CUT] File cut successfully: {:?}", output_path);

    Ok(SegmentFileResult {
        output_path: output_path.to_string_lossy().to_string(),
        operation_id: operation_id.to_string(),
    })
}

fn load_file_to_intermediate(file_path: &Path) -> Result<IntermediateData, String> {
    let extension = file_path
        .extension()
        .and_then(|s| s.to_str())
        .ok_or("Invalid file extension")?
        .to_lowercase();

    match extension.as_str() {
        "edf" => {
            // Read EDF file
            let mut reader =
                EDFReader::new(file_path).map_err(|e| format!("Failed to open EDF file: {}", e))?;

            // Extract metadata from header
            let num_signals = reader.signal_headers.len();
            let num_records = reader.header.num_data_records as usize;
            let record_duration = reader.header.duration_of_data_record;

            // Get sample rate from first signal
            let sample_rate = reader.signal_headers[0].sample_frequency(record_duration);
            let duration = record_duration * num_records as f64;

            // Create metadata
            let metadata = DataMetadata {
                source_file: file_path.to_string_lossy().to_string(),
                source_format: "EDF".to_string(),
                sample_rate,
                duration,
                start_time: Some(format!(
                    "{} {}",
                    reader.header.start_date, reader.header.start_time
                )),
                subject_id: Some(reader.header.patient_id.clone()),
                custom_metadata: std::collections::HashMap::new(),
            };

            let mut data = IntermediateData::new(metadata);

            // Read all records and collect samples per channel
            let mut channel_samples: Vec<Vec<f64>> = vec![Vec::new(); num_signals];

            for record_idx in 0..num_records {
                let physical_record = reader
                    .read_physical_record(record_idx)
                    .map_err(|e| format!("Failed to read EDF record {}: {}", record_idx, e))?;

                // Append samples from this record to each channel
                for (ch_idx, signal_data) in physical_record.iter().enumerate() {
                    channel_samples[ch_idx].extend(signal_data);
                }
            }

            // Create ChannelData for each signal
            for (ch_idx, signal_header) in reader.signal_headers.iter().enumerate() {
                data.add_channel(ChannelData {
                    label: signal_header.label.clone(),
                    channel_type: "EEG".to_string(),
                    unit: signal_header.physical_dimension.clone(),
                    samples: channel_samples[ch_idx].clone(),
                    sample_rate: Some(signal_header.sample_frequency(record_duration)),
                });
            }

            Ok(data)
        }
        "csv" => {
            // Read CSV file
            let text_reader = TextFileReader::from_csv(file_path)
                .map_err(|e| format!("Failed to read CSV file: {}", e))?;

            // Convert to IntermediateData
            convert_text_reader_to_intermediate(text_reader, file_path, "CSV")
        }
        "ascii" | "txt" => {
            // Read ASCII file
            let text_reader = TextFileReader::from_ascii(file_path)
                .map_err(|e| format!("Failed to read ASCII file: {}", e))?;

            // Convert to IntermediateData
            convert_text_reader_to_intermediate(text_reader, file_path, "ASCII")
        }
        _ => Err(format!("Unsupported file format: {}", extension)),
    }
}

fn convert_text_reader_to_intermediate(
    reader: TextFileReader,
    file_path: &Path,
    format: &str,
) -> Result<IntermediateData, String> {
    // Assume default sample rate of 250 Hz for text files
    let sample_rate = 250.0;
    let num_samples = reader.info.num_samples;
    let duration = num_samples as f64 / sample_rate;

    // Create metadata
    let metadata = DataMetadata {
        source_file: file_path.to_string_lossy().to_string(),
        source_format: format.to_string(),
        sample_rate,
        duration,
        start_time: None,
        subject_id: None,
        custom_metadata: std::collections::HashMap::new(),
    };

    let mut data = IntermediateData::new(metadata);

    // Add channels
    for (ch_idx, label) in reader.info.channel_labels.iter().enumerate() {
        data.add_channel(ChannelData {
            label: label.clone(),
            channel_type: "Unknown".to_string(),
            unit: "unknown".to_string(),
            samples: reader.data[ch_idx].clone(),
            sample_rate: Some(sample_rate),
        });
    }

    Ok(data)
}

fn time_to_samples(time: f64, unit: &str, sample_rate: f64) -> Result<usize, String> {
    match unit {
        "seconds" => Ok((time * sample_rate) as usize),
        "samples" => Ok(time as usize),
        _ => Err(format!("Invalid time unit: {}", unit)),
    }
}

fn filter_channels(
    data: &IntermediateData,
    channel_indices: &[usize],
) -> Result<IntermediateData, String> {
    let mut filtered = IntermediateData::new(data.metadata.clone());

    for &idx in channel_indices {
        if idx < data.channels.len() {
            filtered.add_channel(data.channels[idx].clone());
        } else {
            return Err(format!("Channel index {} out of range", idx));
        }
    }

    if filtered.num_channels() == 0 {
        return Err("No channels selected".to_string());
    }

    Ok(filtered)
}

fn extract_segment(
    data: &IntermediateData,
    start: usize,
    end: usize,
) -> Result<IntermediateData, String> {
    let mut segment = IntermediateData::new(data.metadata.clone());

    // Update duration for the segment
    let segment_duration = (end - start) as f64 / data.metadata.sample_rate;
    segment.metadata.duration = segment_duration;

    for channel in &data.channels {
        if end > channel.samples.len() {
            return Err(format!(
                "End sample {} exceeds channel data length {}",
                end,
                channel.samples.len()
            ));
        }

        let segment_samples = channel.samples[start..end].to_vec();

        segment.add_channel(ChannelData {
            label: channel.label.clone(),
            channel_type: channel.channel_type.clone(),
            unit: channel.unit.clone(),
            samples: segment_samples,
            sample_rate: channel.sample_rate,
        });
    }

    Ok(segment)
}

fn determine_output_format(format: &str, input_path: &Path) -> Result<String, String> {
    match format {
        "same" => {
            // Use the same extension as input
            input_path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
                .ok_or("Invalid input file extension".to_string())
        }
        "edf" | "csv" | "ascii" => Ok(format.to_string()),
        _ => Err(format!("Invalid output format: {}", format)),
    }
}

fn export_segment(
    segment: &IntermediateData,
    output_path: &Path,
    format: &str,
) -> Result<(), String> {
    log::info!(
        "[FILE_CUT] Exporting segment: {} samples, {} channels, format: {}",
        segment.num_samples(),
        segment.num_channels(),
        format
    );

    let config = WriterConfig::default();

    match format {
        "csv" => segment.to_csv(output_path, None),
        "ascii" | "txt" => segment.to_ascii(output_path, None),
        "edf" => FileWriterFactory::write_file(segment, output_path, Some(config))
            .map_err(|e| format!("Failed to write EDF: {}", e)),
        _ => Err(format!("Unsupported export format: {}", format)),
    }
}

#[tauri::command]
pub async fn compute_file_hash(file_path: String) -> Result<String, String> {
    log::debug!("[FILE_HASH] Computing BLAKE3 hash for: {}", file_path);

    crate::utils::file_hash::compute_file_hash(&file_path).map_err(|e| {
        log::error!("[FILE_HASH] Failed to compute hash: {}", e);
        format!("Failed to compute file hash: {}", e)
    })
}

/// Progress update for git annex get operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAnnexProgress {
    pub file_path: String,
    pub file_name: String,
    pub phase: String,         // "starting", "downloading", "complete", "error"
    pub progress_percent: f32, // 0-100
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub transfer_rate: String, // e.g., "12.3 MiB/s"
    pub message: String,
}

/// Result of git annex get operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAnnexGetResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

/// Check if a file is a git-annex placeholder (symlink that hasn't been downloaded)
#[tauri::command]
pub async fn check_annex_placeholder(file_path: String) -> Result<bool, String> {
    let path = std::path::Path::new(&file_path);

    // Use symlink_metadata to check if it's a symlink without following it
    if let Ok(metadata) = std::fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            // Read the symlink target
            if let Ok(target) = std::fs::read_link(path) {
                let target_str = target.to_string_lossy();
                // Git-annex symlinks point to .git/annex/objects/...
                if target_str.contains(".git/annex/objects") || target_str.contains("annex/objects")
                {
                    // Check if the target actually exists (resolved through the symlink)
                    // If path.exists() is false but symlink_metadata succeeds, it's a broken symlink
                    return Ok(!path.exists());
                }
            }
        }
    }
    Ok(false)
}

/// Parse git-annex progress output
/// Example output: "get filename (from remote...) 45% 12.3 MiB/s 2s"
/// Or: "(checksum...) 100%"
fn parse_git_annex_progress(line: &str) -> Option<(f32, String)> {
    // Look for percentage pattern like "45%" or "100%"
    let parts: Vec<&str> = line.split_whitespace().collect();

    for (i, part) in parts.iter().enumerate() {
        if part.ends_with('%') {
            if let Ok(pct) = part.trim_end_matches('%').parse::<f32>() {
                // Try to find transfer rate (e.g., "12.3 MiB/s")
                let rate = if i + 1 < parts.len() && parts[i + 1].contains("/s") {
                    parts[i + 1].to_string()
                } else {
                    String::new()
                };
                return Some((pct, rate));
            }
        }
    }
    None
}

/// Parse file size from git-annex info output
/// Returns size in bytes
fn parse_file_size_from_annex(line: &str) -> Option<u64> {
    // git-annex outputs sizes like "123456789" or "1.5 gigabytes" etc.
    // Usually in the format: "1234567890 filename"
    if let Some(size_str) = line.split_whitespace().next() {
        if let Ok(size) = size_str.parse::<u64>() {
            return Some(size);
        }
    }

    // Try parsing human-readable sizes
    let lower = line.to_lowercase();
    for (suffix, multiplier) in [
        ("gib", 1024u64 * 1024 * 1024),
        ("mib", 1024 * 1024),
        ("kib", 1024),
        ("gigabytes", 1000 * 1000 * 1000),
        ("megabytes", 1000 * 1000),
        ("kilobytes", 1000),
        ("gb", 1000 * 1000 * 1000),
        ("mb", 1000 * 1000),
        ("kb", 1000),
    ] {
        if lower.contains(suffix) {
            // Extract the number before the suffix
            let parts: Vec<&str> = line.split_whitespace().collect();
            for part in parts {
                if let Ok(num) = part.parse::<f64>() {
                    return Some((num * multiplier as f64) as u64);
                }
            }
        }
    }
    None
}

/// Validate that a filename is safe for use with git commands.
/// Returns Ok if safe, Err with explanation if not.
fn validate_git_filename(filename: &str) -> Result<(), String> {
    // Reject empty filenames
    if filename.is_empty() {
        return Err("Filename cannot be empty".to_string());
    }

    // Reject filenames starting with dash (could be interpreted as options)
    if filename.starts_with('-') {
        return Err(
            "Filename cannot start with '-' (could be interpreted as git option)".to_string(),
        );
    }

    // Reject path separators in filename (should be just the name, not a path)
    if filename.contains('/') || filename.contains('\\') {
        return Err("Filename cannot contain path separators".to_string());
    }

    // Reject null bytes
    if filename.contains('\0') {
        return Err("Filename cannot contain null bytes".to_string());
    }

    // Reject special git-annex patterns that could be exploited
    if filename.starts_with('.') && filename != "." && !filename.starts_with("..") {
        // Allow hidden files but log them
        log::debug!("[GIT_ANNEX] Processing hidden file: {}", filename);
    }

    Ok(())
}

/// Run git annex get to download a file managed by git-annex
#[tauri::command]
pub async fn run_git_annex_get(
    app_handle: AppHandle,
    file_path: String,
) -> Result<GitAnnexGetResult, String> {
    log::info!("[GIT_ANNEX] Attempting to download: {}", file_path);

    let path = PathBuf::from(&file_path);

    // Canonicalize the path to resolve symlinks and ../ sequences
    let canonical_path = path
        .canonicalize()
        .or_else(|_| {
            // If canonicalize fails (file doesn't exist yet), validate parent exists
            if let Some(parent) = path.parent() {
                parent
                    .canonicalize()
                    .map(|p| p.join(path.file_name().unwrap_or_default()))
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Invalid path",
                ))
            }
        })
        .map_err(|e| format!("Invalid file path: {}", e))?;

    // Get the directory containing the file
    let parent_dir = canonical_path
        .parent()
        .ok_or_else(|| "Invalid file path - no parent directory".to_string())?;

    // Get the filename
    let file_name = canonical_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file path - no filename".to_string())?
        .to_string();

    // Validate filename is safe for git commands
    validate_git_filename(&file_name)?;

    log::info!(
        "[GIT_ANNEX] Running 'git annex get {}' in {:?}",
        file_name,
        parent_dir
    );

    // Emit starting event
    let _ = app_handle.emit(
        "git-annex-progress",
        GitAnnexProgress {
            file_path: file_path.clone(),
            file_name: file_name.clone(),
            phase: "starting".to_string(),
            progress_percent: 0.0,
            bytes_downloaded: 0,
            total_bytes: 0,
            transfer_rate: String::new(),
            message: "Initializing download...".to_string(),
        },
    );

    // Try to get file size first using git-annex info
    let total_bytes = match Command::new("git")
        .args(["annex", "info", "--bytes", &file_name])
        .current_dir(parent_dir)
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            parse_file_size_from_annex(&stdout).unwrap_or(0)
        }
        _ => 0,
    };

    if total_bytes > 0 {
        log::info!("[GIT_ANNEX] File size: {} bytes", total_bytes);
    }

    // Run git annex get with progress output
    let mut child = Command::new("git")
        .args(["annex", "get", "--progress", &file_name])
        .current_dir(parent_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute git annex get: {}", e))?;

    let mut all_output = String::new();
    let mut last_progress: f32 = 0.0;

    // Read stderr for progress (git-annex outputs progress to stderr)
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                log::debug!("[GIT_ANNEX] {}", line);
                all_output.push_str(&line);
                all_output.push('\n');

                // Parse progress from the line
                if let Some((progress, rate)) = parse_git_annex_progress(&line) {
                    // Only emit if progress changed significantly (avoid flooding)
                    if (progress - last_progress).abs() >= 1.0 || progress >= 100.0 {
                        last_progress = progress;

                        let bytes_downloaded = if total_bytes > 0 {
                            ((progress as f64 / 100.0) * total_bytes as f64) as u64
                        } else {
                            0
                        };

                        let _ = app_handle.emit(
                            "git-annex-progress",
                            GitAnnexProgress {
                                file_path: file_path.clone(),
                                file_name: file_name.clone(),
                                phase: "downloading".to_string(),
                                progress_percent: progress,
                                bytes_downloaded,
                                total_bytes,
                                transfer_rate: rate,
                                message: line.clone(),
                            },
                        );
                    }
                } else if line.contains("get ") {
                    // Starting to get a file
                    let _ = app_handle.emit(
                        "git-annex-progress",
                        GitAnnexProgress {
                            file_path: file_path.clone(),
                            file_name: file_name.clone(),
                            phase: "downloading".to_string(),
                            progress_percent: 0.0,
                            bytes_downloaded: 0,
                            total_bytes,
                            transfer_rate: String::new(),
                            message: line.clone(),
                        },
                    );
                }
            }
        }
    }

    // Also capture stdout
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                log::info!("[GIT_ANNEX] stdout: {}", line);
                all_output.push_str(&line);
                all_output.push('\n');
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for git annex get: {}", e))?;

    if status.success() {
        log::info!("[GIT_ANNEX] Successfully downloaded: {}", file_name);

        // Emit completion event
        let _ = app_handle.emit(
            "git-annex-progress",
            GitAnnexProgress {
                file_path: file_path.clone(),
                file_name: file_name.clone(),
                phase: "complete".to_string(),
                progress_percent: 100.0,
                bytes_downloaded: total_bytes,
                total_bytes,
                transfer_rate: String::new(),
                message: "Download complete!".to_string(),
            },
        );

        Ok(GitAnnexGetResult {
            success: true,
            output: all_output,
            error: None,
        })
    } else {
        let error_msg = if all_output.is_empty() {
            format!("git annex get failed with exit code: {:?}", status.code())
        } else {
            all_output.clone()
        };
        log::error!("[GIT_ANNEX] Failed to download: {}", error_msg);

        // Emit error event
        let _ = app_handle.emit(
            "git-annex-progress",
            GitAnnexProgress {
                file_path: file_path.clone(),
                file_name: file_name.clone(),
                phase: "error".to_string(),
                progress_percent: last_progress,
                bytes_downloaded: 0,
                total_bytes,
                transfer_rate: String::new(),
                message: error_msg.clone(),
            },
        );

        Ok(GitAnnexGetResult {
            success: false,
            output: all_output,
            error: Some(error_msg),
        })
    }
}

/// Result of get_file_info command - basic file metadata for BIDS export
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfoResult {
    pub file_path: String,
    pub file_name: String,
    pub duration: f64,
    pub channel_count: usize,
    pub sample_rate: f64,
    pub file_type: String,
}

/// Get basic file info (duration, channel count) for BIDS export file selection
#[tauri::command]
pub async fn get_file_info(file_path: String) -> Result<FileInfoResult, String> {
    let path = Path::new(&file_path);

    // Check if file exists
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Check if format is supported
    if !FileReaderFactory::is_supported(path) {
        return Err(format!(
            "Unsupported file format: {}",
            path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("unknown")
        ));
    }

    // Create reader and get metadata
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    Ok(FileInfoResult {
        file_path: metadata.file_path,
        file_name: metadata.file_name,
        duration: metadata.duration,
        channel_count: metadata.num_channels,
        sample_rate: metadata.sample_rate,
        file_type: metadata.file_type,
    })
}
