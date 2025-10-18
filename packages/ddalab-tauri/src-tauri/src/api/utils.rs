use std::path::{Path, PathBuf};
use chrono::Utc;
use crate::api::models::{EDFFileInfo, ChunkData};
use crate::edf::EDFReader;
use crate::text_reader::TextFileReader;
use crate::file_readers::FileReaderFactory;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileType {
    CSV,
    ASCII,
    EDF,
    BrainVision,
    EEGLAB,
}

impl FileType {
    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "csv" => FileType::CSV,
            "ascii" | "txt" => FileType::ASCII,
            "vhdr" => FileType::BrainVision,
            "set" => FileType::EEGLAB,
            _ => FileType::EDF,
        }
    }

    pub fn from_path(path: &Path) -> Self {
        path.extension()
            .and_then(|e| e.to_str())
            .map(|ext| Self::from_extension(ext))
            .unwrap_or(FileType::EDF)
    }
}

pub fn read_file_metadata_with_reader(path: &Path) -> Result<EDFFileInfo, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    let file_path = path.to_str()
        .ok_or("Invalid file path")?
        .to_string();

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

    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    let file_metadata = reader.metadata()
        .map_err(|e| format!("Failed to read file metadata: {}", e))?;

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
    })
}

pub fn generate_overview_with_file_reader(
    path: &Path,
    max_points: usize,
    selected_channels: Option<Vec<String>>,
) -> Result<ChunkData, String> {
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to create file reader: {}", e))?;

    let metadata = reader.metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let channel_names = selected_channels.as_ref().map(|v| v.as_slice());
    let data = reader.read_overview(max_points, channel_names)
        .map_err(|e| format!("Failed to read overview: {}", e))?;

    let returned_channels = if let Some(selected) = &selected_channels {
        selected.clone()
    } else {
        metadata.channels
    };

    let chunk_size = if !data.is_empty() { data[0].len() } else { 0 };

    Ok(ChunkData {
        data,
        channel_labels: returned_channels,
        sampling_frequency: metadata.sample_rate,
        chunk_size,
        chunk_start: 0,
        total_samples: Some(metadata.num_samples as u64),
    })
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

    let all_channel_labels: Vec<String> = edf.signal_headers
        .iter()
        .map(|sh| sh.label.trim().to_string())
        .collect();

    if all_channel_labels.is_empty() {
        return Err(format!("No channels found in EDF file '{}'", file_path_clone));
    }

    let (channels_to_read, channel_labels): (Vec<usize>, Vec<String>) = if let Some(ref selected) = channels {
        let mut indices = Vec::new();
        let mut labels = Vec::new();

        for channel_name in selected {
            if let Some(idx) = all_channel_labels.iter().position(|label| label == channel_name) {
                indices.push(idx);
                labels.push(channel_name.clone());
            } else {
                log::warn!("Channel '{}' not found in file", channel_name);
            }
        }

        if indices.is_empty() {
            let num_fallback_channels = all_channel_labels.len().min(10);
            log::warn!("[CHUNK] None of the selected channels found in EDF file, falling back to first {} channels", num_fallback_channels);
            ((0..num_fallback_channels).collect(), all_channel_labels.iter().take(num_fallback_channels).cloned().collect())
        } else {
            (indices, labels)
        }
    } else {
        ((0..all_channel_labels.len()).collect(), all_channel_labels.clone())
    };

    let sample_rate = edf.signal_headers[channels_to_read[0]].sample_frequency(edf.header.duration_of_data_record);

    let (actual_start_time, actual_duration) = if needs_sample_rate {
        let start_samples = start_time as usize;
        let num_samples = duration as usize;
        (start_samples as f64 / sample_rate, num_samples as f64 / sample_rate)
    } else {
        (start_time, duration)
    };

    log::info!(
        "Reading chunk from '{}': start_time={:.2}s, duration={:.2}s, channels={:?}",
        file_path_clone, actual_start_time, actual_duration, channel_labels
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

    log::info!("Read {} channels, {} samples per channel", data.len(), chunk_size);

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
        if path.symlink_metadata().is_ok() && path.symlink_metadata().unwrap().is_symlink() {
            if !path.exists() {
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
            FileType::CSV => {
                match TextFileReader::from_csv(&path) {
                    Ok(reader) => {
                        let channels = reader.info.channel_labels.clone();
                        let num_channels = channels.len();
                        let num_samples = reader.info.num_samples;

                        log::info!("Read CSV file '{}' with {} channels, {} samples", file_name, num_channels, num_samples);

                        let sample_rate = 1.0;
                        let duration = num_samples as f64 / sample_rate;

                        Some(EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(num_samples as u64),
                            channels,
                            created_at,
                            last_modified,
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

                        Some(EDFFileInfo {
                            file_path,
                            file_name,
                            file_size: metadata.len(),
                            duration: Some(duration),
                            sample_rate,
                            total_samples: Some(num_samples as u64),
                            channels,
                            created_at,
                            last_modified,
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
        }
    })
    .await
    .ok()
    .flatten()
}
