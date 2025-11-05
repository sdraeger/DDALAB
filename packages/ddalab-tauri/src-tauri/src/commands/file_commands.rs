use crate::edf::EDFReader;
use crate::intermediate_format::{ChannelData, DataMetadata, IntermediateData};
use crate::text_reader::TextFileReader;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentFileResult {
    pub output_path: String,
}

#[tauri::command]
pub async fn segment_file(params: SegmentFileParams) -> Result<SegmentFileResult, String> {
    log::info!("[FILE_CUT] Starting file extraction: {}", params.file_path);
    log::info!(
        "[FILE_CUT] Start: {} {}, End: {} {}",
        params.start_time,
        params.start_unit,
        params.end_time,
        params.end_unit
    );
    log::info!("[FILE_CUT] Output format: {}", params.output_format);

    // Load the file into IntermediateData
    let file_path = PathBuf::from(&params.file_path);
    let data = load_file_to_intermediate(&file_path)?;

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

    // Extract the segment
    let segment = extract_segment(&filtered_data, start_sample, end_sample)?;

    // Determine output format
    let output_format = determine_output_format(&params.output_format, &file_path)?;

    // Create output directory if it doesn't exist
    let output_dir = PathBuf::from(&params.output_directory);
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    // Construct output path
    let output_path = output_dir.join(&params.output_filename);

    // Export segment
    export_segment(&segment, &output_path, &output_format)?;

    log::info!("[FILE_CUT] File cut successfully: {:?}", output_path);

    Ok(SegmentFileResult {
        output_path: output_path.to_string_lossy().to_string(),
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
    match format {
        "csv" => segment.to_csv(output_path, None),
        "ascii" | "txt" => segment.to_ascii(output_path, None),
        "edf" => {
            // For EDF, we'd need to implement an EDF writer
            // For now, fall back to ASCII
            log::warn!("[FILE_CUT] EDF output not yet implemented, using ASCII instead");
            segment.to_ascii(output_path, None)
        }
        _ => Err(format!("Unsupported export format: {}", format)),
    }
}

#[tauri::command]
pub async fn compute_file_hash(file_path: String) -> Result<String, String> {
    log::debug!("[FILE_HASH] Computing BLAKE3 hash for: {}", file_path);

    crate::utils::file_hash::compute_file_hash(&file_path)
        .map_err(|e| {
            log::error!("[FILE_HASH] Failed to compute hash: {}", e);
            format!("Failed to compute file hash: {}", e)
        })
}
