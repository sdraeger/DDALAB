use crate::api::models::{ApiError, ChunkData, EDFFileInfo};
use crate::edf::EDFReader;
use crate::file_readers::{parse_edf_datetime, FileReaderFactory};
use crate::text_reader::TextFileReader;
use chrono::Utc;
use std::path::{Path, PathBuf};

/// Check if a path is a broken git-annex symlink
pub fn check_git_annex_symlink(path: &Path) -> Result<(), ApiError> {
    if let Ok(metadata) = path.symlink_metadata() {
        if metadata.is_symlink() && !path.exists() {
            let path_str = path.to_string_lossy().to_string();
            log::error!(
                "File is a broken symlink (git-annex): {:?}. Run 'git annex get' to download.",
                path
            );
            return Err(ApiError::GitAnnexNotDownloaded(path_str));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileType {
    CSV,
    ASCII,
    EDF,
    BrainVision,
    EEGLAB,
    FIF, // FIFF format (Neuromag/Elekta MEG)
    MEG, // Other MEG formats (not yet supported for analysis)
    Unknown,
}

impl FileType {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "csv" => FileType::CSV,
            "ascii" | "txt" => FileType::ASCII,
            "vhdr" => FileType::BrainVision,
            "set" => FileType::EEGLAB,
            "edf" | "bdf" => FileType::EDF,
            // FIFF format (supported)
            "fif" => FileType::FIF,
            // Other MEG formats (not yet supported)
            "ds" | "sqd" | "meg4" | "con" | "kit" => FileType::MEG,
            _ => FileType::Unknown,
        }
    }

    pub fn from_path(path: &Path) -> Self {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|ext| Self::from_extension(ext))
            .unwrap_or(FileType::Unknown)
    }

    pub fn is_supported(&self) -> bool {
        matches!(
            self,
            FileType::EDF
                | FileType::FIF
                | FileType::CSV
                | FileType::ASCII
                | FileType::BrainVision
                | FileType::EEGLAB
        )
    }

    pub fn is_meg(&self) -> bool {
        matches!(self, FileType::MEG)
    }
}

pub fn read_file_metadata_with_reader(path: &Path) -> Result<EDFFileInfo, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    let file_path = path.to_str().ok_or("Invalid file path")?.to_string();

    let last_modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| {
            let datetime =
                chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
            datetime
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339())
        })
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    let created_at = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| {
            let datetime =
                chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
            datetime
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339())
        })
        .unwrap_or_else(|| last_modified.clone());

    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    let file_metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    // Use file's recording start time if available, otherwise use created_at
    let start_time = file_metadata
        .start_time
        .clone()
        .unwrap_or_else(|| created_at.clone());
    log::info!(
        "File metadata start_time: {:?}, using: {}",
        file_metadata.start_time,
        start_time
    );

    // Calculate end time as start_time + duration
    let end_time = if let Ok(start_dt) = chrono::DateTime::parse_from_rfc3339(&start_time) {
        let end_dt =
            start_dt + chrono::Duration::milliseconds((file_metadata.duration * 1000.0) as i64);
        log::info!("Calculated end_time: {}", end_dt.to_rfc3339());
        end_dt.to_rfc3339()
    } else {
        log::warn!("Failed to parse start_time as RFC3339: {}", start_time);
        // If start_time parsing fails, use start_time as fallback
        start_time.clone()
    };

    let channel_types: Vec<String> = file_metadata
        .channel_metadata
        .iter()
        .map(|m| m.channel_type.clone())
        .collect();
    let channel_units: Vec<String> = file_metadata
        .channel_metadata
        .iter()
        .map(|m| m.unit.clone())
        .collect();

    Ok(EDFFileInfo {
        file_path,
        file_name,
        file_size: metadata.len(),
        duration: Some(file_metadata.duration),
        sample_rate: file_metadata.sample_rate,
        total_samples: Some(file_metadata.num_samples as u64),
        channels: file_metadata.channels,
        created_at,
        last_modified,
        start_time,
        end_time,
        channel_types: Some(channel_types),
        channel_units: Some(channel_units),
    })
}

pub fn generate_overview_with_file_reader(
    path: &Path,
    max_points: usize,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    log::info!(
        "Generating overview for: {:?} (max_points: {})",
        path,
        max_points
    );

    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    log::info!(
        "Metadata: {} channels, {} samples, {:.2} Hz",
        metadata.num_channels,
        metadata.num_samples,
        metadata.sample_rate
    );

    let channel_names = selected_channels.as_ref().map(|v| v.as_slice());
    let data = reader
        .read_overview(max_points, channel_names)
        .map_err(|e| format!("Failed to read overview: {}", e))?;

    log::info!(
        "Overview data: {} channels, {} points per channel",
        data.len(),
        if !data.is_empty() { data[0].len() } else { 0 }
    );

    let returned_channels = if let Some(selected) = &selected_channels {
        selected.clone()
    } else {
        metadata.channels
    };

    let chunk_size = if !data.is_empty() { data[0].len() } else { 0 };

    let result = ChunkData {
        data,
        channel_labels: returned_channels,
        sampling_frequency: metadata.sample_rate,
        chunk_size,
        chunk_start: 0,
        total_samples: Some(metadata.num_samples as u64),
    };

    log::info!(
        "Returning ChunkData with {} channels, chunk_size: {}",
        result.channel_labels.len(),
        result.chunk_size
    );

    Ok(result)
}

pub fn read_edf_file_chunk(
    path: &Path,
    file_path_clone: &str,
    start_time: f64,
    duration: f64,
    needs_sample_rate: bool,
    channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let mut edf = EDFReader::new(path)?;

    let all_channel_labels: Vec<String> = edf
        .signal_headers
        .iter()
        .map(|sh| sh.label.trim().to_string())
        .collect();

    if all_channel_labels.is_empty() {
        return Err(format!(
            "No channels found in EDF file '{}'",
            file_path_clone
        ));
    }

    let (channels_to_read, channel_labels): (Vec<usize>, Vec<String>) = if let Some(ref selected) =
        channels
    {
        let mut indices = Vec::new();
        let mut labels = Vec::new();

        for channel_name in selected {
            if let Some(idx) = all_channel_labels
                .iter()
                .position(|label| label == channel_name)
            {
                indices.push(idx);
                labels.push(channel_name.clone());
            } else {
                log::warn!("Channel '{}' not found in file", channel_name);
            }
        }

        if indices.is_empty() {
            let num_fallback_channels = all_channel_labels.len().min(10);
            log::warn!("[CHUNK] None of the selected channels found in EDF file, falling back to first {} channels", num_fallback_channels);
            (
                (0..num_fallback_channels).collect(),
                all_channel_labels
                    .iter()
                    .take(num_fallback_channels)
                    .cloned()
                    .collect(),
            )
        } else {
            (indices, labels)
        }
    } else {
        (
            (0..all_channel_labels.len()).collect(),
            all_channel_labels.clone(),
        )
    };

    let sample_rate = edf.signal_headers[channels_to_read[0]]
        .sample_frequency(edf.header.duration_of_data_record);

    let (actual_start_time, actual_duration) = if needs_sample_rate {
        let start_samples = start_time as usize;
        let num_samples = duration as usize;
        (
            start_samples as f64 / sample_rate,
            num_samples as f64 / sample_rate,
        )
    } else {
        (start_time, duration)
    };

    log::info!(
        "Reading chunk from '{}': start_time={:.2}s, duration={:.2}s, channels={:?}",
        file_path_clone,
        actual_start_time,
        actual_duration,
        channel_labels
    );

    let mut data: Vec<Vec<f64>> = Vec::new();
    for &signal_idx in &channels_to_read {
        let signal_data = edf.read_signal_window(signal_idx, actual_start_time, actual_duration)?;
        data.push(signal_data);
    }

    let chunk_start_sample = (actual_start_time * sample_rate) as usize;
    let chunk_size = data.get(0).map(|v| v.len()).unwrap_or(0);

    let samples_per_record = edf.signal_headers[channels_to_read[0]].num_samples_per_record as u64;
    let total_samples_per_channel = edf.header.num_data_records as u64 * samples_per_record;

    log::info!(
        "Read {} channels, {} samples per channel",
        data.len(),
        chunk_size
    );

    Ok(ChunkData {
        data,
        channel_labels,
        sampling_frequency: sample_rate,
        chunk_size,
        chunk_start: chunk_start_sample,
        total_samples: Some(total_samples_per_channel),
    })
}

pub async fn create_file_info(path: PathBuf) -> Option<EDFFileInfo> {
    tokio::task::spawn_blocking(move || {
        if let Ok(metadata) = path.symlink_metadata() {
            if metadata.is_symlink() && !path.exists() {
                log::error!("File is a broken symlink (possibly git-annex): {:?}. Run 'git annex get' to download the actual file.", path);
                return None;
            }
        }

        if !path.exists() || !path.is_file() {
            log::error!("File does not exist or is not a file: {:?}", path);
            return None;
        }

        match read_file_metadata_with_reader(&path) {
            Ok(file_info) => {
                log::info!("Successfully read file metadata using modular reader for: {:?}", path);
                return Some(file_info);
            }
            Err(e) => {
                log::error!("Modular file reader failed for {:?}: {}", path, e);
            }
        }

        let metadata = std::fs::metadata(&path).ok()?;
        let file_name = path.file_name()?.to_str()?.to_string();
        let file_path = path.to_str()?.to_string();

        let last_modified = metadata.modified().ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| {
                let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
                datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
            })
            .unwrap_or_else(|| Utc::now().to_rfc3339());

        let created_at = metadata.created().ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| {
                let datetime = chrono::DateTime::<chrono::Utc>::from_timestamp(duration.as_secs() as i64, 0);
                datetime.map(|dt| dt.to_rfc3339()).unwrap_or_else(|| Utc::now().to_rfc3339())
            })
            .unwrap_or_else(|| last_modified.clone());

        match FileType::from_path(&path) {
            FileType::FIF | FileType::BrainVision | FileType::EEGLAB => {
                // These formats use the modular FileReaderFactory, already handled above
                log::warn!("FIF/BrainVision/EEGLAB file fell through to legacy code path");
                None
            }
            FileType::CSV => {
                match TextFileReader::from_csv(&path) {
                    Ok(reader) => {
                        let channels = reader.info.channel_labels.clone();
                        let num_channels = channels.len();
                        let num_samples = reader.info.num_samples;

                        log::info!("Read CSV file '{}' with {} channels, {} samples", file_name, num_channels, num_samples);

                        let sample_rate = 1.0;
                        let duration = num_samples as f64 / sample_rate;

                        // Calculate end time
                        let end_time = if let Ok(start_dt) = chrono::DateTime::parse_from_rfc3339(&created_at) {
                            let end_dt = start_dt + chrono::Duration::milliseconds((duration * 1000.0) as i64);
                            end_dt.to_rfc3339()
                        } else {
                            created_at.clone()
                        };

                        Some(EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(num_samples as u64),
                            channels,
                            created_at: created_at.clone(),
                            last_modified,
                            start_time: created_at,
                            end_time,
                            channel_types: None,
                            channel_units: None,
                        })
                    }
                    Err(e) => {
                        log::error!("Failed to read CSV file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::ASCII => {
                match TextFileReader::from_ascii(&path) {
                    Ok(reader) => {
                        let channels = reader.info.channel_labels.clone();
                        let num_channels = channels.len();
                        let num_samples = reader.info.num_samples;

                        log::info!("Read ASCII file '{}' with {} channels, {} samples", file_name, num_channels, num_samples);

                        let sample_rate = 1.0;
                        let duration = num_samples as f64 / sample_rate;

                        // Calculate end time
                        let end_time = if let Ok(start_dt) = chrono::DateTime::parse_from_rfc3339(&created_at) {
                            let end_dt = start_dt + chrono::Duration::milliseconds((duration * 1000.0) as i64);
                            end_dt.to_rfc3339()
                        } else {
                            created_at.clone()
                        };

                        Some(EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(num_samples as u64),
                            channels,
                            created_at: created_at.clone(),
                            last_modified,
                            start_time: created_at,
                            end_time,
                            channel_types: None,
                            channel_units: None,
                        })
                    }
                    Err(e) => {
                        log::error!("Failed to read ASCII file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::EDF => {
                match EDFReader::new(&path) {
                    Ok(edf) => {
                        let header = &edf.header;

                        let channels: Vec<String> = edf.signal_headers
                            .iter()
                            .map(|sh| sh.label.trim().to_string())
                            .collect();

                        let num_channels = channels.len();
                        log::info!("Read EDF file '{}' with {} channels", file_name, num_channels);

                        let sample_rate = if num_channels > 0 {
                            edf.signal_headers[0].sample_frequency(header.duration_of_data_record)
                        } else {
                            256.0
                        };

                        let samples_per_record = if num_channels > 0 {
                            edf.signal_headers[0].num_samples_per_record as u64
                        } else {
                            1
                        };
                        let total_samples_per_channel = header.num_data_records as u64 * samples_per_record;

                        let duration = edf.total_duration();

                        log::info!(
                            "EDF file '{}': channels={}, sample_rate={:.2}Hz, data_records={}, samples/record={}, total_samples={}, duration={:.2}s ({:.1}min)",
                            file_name, num_channels, sample_rate, header.num_data_records, samples_per_record, total_samples_per_channel, duration, duration / 60.0
                        );

                        // Get EDF recording start time from header
                        // EDF format: date="dd.mm.yy" time="hh.mm.ss"
                        let start_time = parse_edf_datetime(&header.start_date, &header.start_time)
                            .unwrap_or_else(|| created_at.clone());

                        // Calculate end time
                        let end_time = if let Ok(start_dt) = chrono::DateTime::parse_from_rfc3339(&start_time) {
                            let end_dt = start_dt + chrono::Duration::milliseconds((duration * 1000.0) as i64);
                            end_dt.to_rfc3339()
                        } else {
                            start_time.clone()
                        };

                        let file_info = EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(total_samples_per_channel),
                            channels,
                            created_at,
                            last_modified,
                            start_time,
                            end_time,
                            channel_types: None,
                            channel_units: None,
                        };

                        log::info!("Returning file info with duration: {:?}", file_info.duration);

                        Some(file_info)
                    }
                    Err(e) => {
                        log::error!("Failed to read EDF file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::BrainVision | FileType::EEGLAB => {
                match read_file_metadata_with_reader(&path) {
                    Ok(file_info) => {
                        log::info!("Read file '{}' using modular reader", file_name);
                        Some(file_info)
                    }
                    Err(e) => {
                        log::error!("Failed to read file '{}': {}", file_name, e);
                        None
                    }
                }
            }
            FileType::MEG => {
                log::warn!("MEG file '{}' detected but not supported for analysis yet", file_name);
                None
            }
            FileType::Unknown => {
                log::warn!("Unknown file type for '{}'", file_name);
                None
            }
        }
    })
    .await
    .ok()
    .flatten()
}

/// Create file info with proper error handling (returns Result instead of Option)
pub async fn create_file_info_result(path: PathBuf) -> Result<EDFFileInfo, ApiError> {
    let path_str = path.to_string_lossy().to_string();

    tokio::task::spawn_blocking(move || {
        // Check for git-annex broken symlinks first
        check_git_annex_symlink(&path)?;

        // Check if file exists
        if !path.exists() {
            return Err(ApiError::FileNotFound(path_str.clone()));
        }

        if !path.is_file() {
            return Err(ApiError::BadRequest(format!(
                "Path is not a file: {}",
                path_str
            )));
        }

        // Try to read metadata using the modular reader
        match read_file_metadata_with_reader(&path) {
            Ok(file_info) => {
                log::info!("Successfully read file metadata for: {:?}", path);
                Ok(file_info)
            }
            Err(e) => {
                log::error!("Failed to read file {:?}: {}", path, e);
                Err(ApiError::ParseError(e))
            }
        }
    })
    .await
    .map_err(|e| ApiError::InternalError(format!("Task join error: {}", e)))?
}

// ============================================================================
// MessagePack Response Support
// ============================================================================

use axum::{
    body::Body,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Serialize;

/// Content type for MessagePack
pub const MSGPACK_CONTENT_TYPE: &str = "application/msgpack";

/// Response format based on Accept header
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseFormat {
    Json,
    MessagePack,
}

impl ResponseFormat {
    /// Determine response format from Accept header
    pub fn from_headers(headers: &HeaderMap) -> Self {
        if let Some(accept) = headers.get(header::ACCEPT) {
            if let Ok(accept_str) = accept.to_str() {
                // Check for MessagePack preference
                if accept_str.contains("application/msgpack")
                    || accept_str.contains("application/x-msgpack")
                {
                    return ResponseFormat::MessagePack;
                }
            }
        }
        ResponseFormat::Json
    }
}

/// A response that can serialize to either JSON or MessagePack
/// Use this for large responses where MessagePack provides significant size reduction
pub struct NegotiatedResponse<T: Serialize> {
    data: T,
    format: ResponseFormat,
}

impl<T: Serialize> NegotiatedResponse<T> {
    pub fn new(data: T, headers: &HeaderMap) -> Self {
        Self {
            data,
            format: ResponseFormat::from_headers(headers),
        }
    }

    pub fn json(data: T) -> Self {
        Self {
            data,
            format: ResponseFormat::Json,
        }
    }

    pub fn msgpack(data: T) -> Self {
        Self {
            data,
            format: ResponseFormat::MessagePack,
        }
    }
}

impl<T: Serialize> IntoResponse for NegotiatedResponse<T> {
    fn into_response(self) -> Response {
        match self.format {
            ResponseFormat::Json => match serde_json::to_vec(&self.data) {
                Ok(body) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap_or_else(|_| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to build response",
                        )
                            .into_response()
                    }),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("JSON serialization error: {}", e),
                )
                    .into_response(),
            },
            ResponseFormat::MessagePack => match rmp_serde::to_vec(&self.data) {
                Ok(body) => Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, MSGPACK_CONTENT_TYPE)
                    .body(Body::from(body))
                    .unwrap_or_else(|_| {
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Failed to build response",
                        )
                            .into_response()
                    }),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("MessagePack serialization error: {}", e),
                )
                    .into_response(),
            },
        }
    }
}

/// Estimate if MessagePack would provide significant benefit
/// Returns true for responses likely to be >100KB as JSON
pub fn should_use_msgpack_hint<T: Serialize>(data: &T) -> bool {
    // Quick heuristic: serialize to JSON and check size
    if let Ok(json) = serde_json::to_vec(data) {
        json.len() > 100_000 // 100KB threshold
    } else {
        false
    }
}
