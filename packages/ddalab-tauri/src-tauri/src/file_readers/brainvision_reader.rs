/// BrainVision File Reader
///
/// Implementation of FileReader trait for BrainVision format (.vhdr, .vmrk, .eeg files).

use std::path::Path;
use std::fs;
use std::io::{Write, Read, Seek, SeekFrom};
use std::os::unix::fs::PermissionsExt;
use bvreader::bv_reader::BVFile;
use super::{FileReader, FileMetadata, FileResult, FileReaderError};

/// Simple BrainVision header parser for AnyWave-exported files
#[derive(Debug)]
struct SimpleBVHeader {
    data_file: String,
    marker_file: Option<String>,
    data_format: String,
    data_orientation: String,
    num_channels: usize,
    sampling_interval_us: f64,
    binary_format: String,
    channels: Vec<String>,
}

impl SimpleBVHeader {
    fn parse(vhdr_path: &Path) -> FileResult<Self> {
        // Read as bytes and convert from Latin-1 to UTF-8
        let bytes = fs::read(vhdr_path)?;
        let content: String = bytes.iter().map(|&b| b as char).collect();

        let mut data_file = String::new();
        let mut marker_file = None;
        let mut data_format = String::new();
        let mut data_orientation = String::new();
        let mut num_channels = 0;
        let mut sampling_interval_us = 0.0;
        let mut binary_format = String::new();
        let mut channels = Vec::new();

        let mut in_channel_section = false;

        for line in content.lines() {
            let line = line.trim();

            if line.starts_with("[Channel Infos]") {
                in_channel_section = true;
                continue;
            } else if line.starts_with('[') {
                in_channel_section = false;
            }

            if in_channel_section && line.starts_with("Ch") {
                // Parse channel line: Ch1=Name,,Resolution,Unit
                if let Some(eq_pos) = line.find('=') {
                    let channel_data = &line[eq_pos + 1..];
                    if let Some(first_comma) = channel_data.find(',') {
                        let channel_name = channel_data[..first_comma].to_string();
                        channels.push(channel_name);
                    }
                }
            } else if let Some(value) = line.strip_prefix("DataFile=") {
                data_file = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("MarkerFile=") {
                marker_file = Some(value.trim().to_string());
            } else if let Some(value) = line.strip_prefix("DataFormat=") {
                data_format = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("DataOrientation=") {
                data_orientation = value.trim().to_string();
            } else if let Some(value) = line.strip_prefix("NumberOfChannels=") {
                num_channels = value.trim().parse().unwrap_or(0);
            } else if let Some(value) = line.strip_prefix("SamplingInterval=") {
                sampling_interval_us = value.trim().parse().unwrap_or(0.0);
            } else if let Some(value) = line.strip_prefix("BinaryFormat=") {
                binary_format = value.trim().to_string();
            }
        }

        Ok(Self {
            data_file,
            marker_file,
            data_format,
            data_orientation,
            num_channels,
            sampling_interval_us,
            binary_format,
            channels,
        })
    }
}

enum BVReaderBackend {
    BVReader(BVFile),
    Simple(SimpleBVHeader, std::path::PathBuf), // header + data file path
}

pub struct BrainVisionFileReader {
    backend: BVReaderBackend,
    path: String,
}

impl BrainVisionFileReader {
    /// Convert Latin-1 encoded BrainVision files to UTF-8 and ensure proper line endings
    ///
    /// BrainVision format consists of 3 files: .vhdr (header), .vmrk (markers), and .eeg (data).
    /// Issues that need fixing:
    /// 1. Latin-1 encoding (µV character) -> UTF-8
    /// 2. Unix line endings (LF) -> Windows line endings (CRLF) that bvreader expects
    fn ensure_utf8_brainvision_files(vhdr_path: &Path) -> FileResult<(std::path::PathBuf, Option<std::path::PathBuf>)> {
        // Always convert to ensure proper line endings, even if UTF-8
        log::info!("Converting BrainVision file {} to UTF-8 with Windows line endings", vhdr_path.display());

        // Need to convert - create a temporary directory for all files
        let temp_dir = std::env::temp_dir().join(format!(
            "bv_utf8_{}",
            vhdr_path.file_stem().unwrap().to_string_lossy()
        ));
        fs::create_dir_all(&temp_dir)?;

        // Get parent directory
        let parent_dir = vhdr_path.parent().unwrap();

        // Helper function to convert text file: Latin-1 to UTF-8, LF to CRLF
        let convert_text_file = |input_path: &Path, output_path: &Path| -> FileResult<()> {
            let bytes = fs::read(input_path)?;

            // Convert from Latin-1 to UTF-8
            let text: String = bytes.iter().map(|&b| b as char).collect();

            // Convert LF to CRLF (normalize line endings)
            let text_crlf = text.replace("\r\n", "\n").replace('\n', "\r\n");

            fs::write(output_path, text_crlf.as_bytes())?;

            // Set permissions to 0644 (rw-r--r--)
            let mut perms = fs::metadata(output_path)?.permissions();
            perms.set_mode(0o644);
            fs::set_permissions(output_path, perms)?;

            Ok(())
        };

        // Convert .vhdr file and parse it to find referenced files
        let temp_vhdr = temp_dir.join(vhdr_path.file_name().unwrap());
        convert_text_file(vhdr_path, &temp_vhdr)?;

        // Parse the header to find DataFile and MarkerFile references
        let header_content = fs::read_to_string(&temp_vhdr)?;
        let mut data_file_name: Option<String> = None;
        let mut marker_file_name: Option<String> = None;

        for line in header_content.lines() {
            if let Some(value) = line.strip_prefix("DataFile=") {
                data_file_name = Some(value.trim().to_string());
            } else if let Some(value) = line.strip_prefix("MarkerFile=") {
                marker_file_name = Some(value.trim().to_string());
            }
        }

        // Convert .vmrk file if referenced
        if let Some(vmrk_name) = marker_file_name {
            let vmrk_path = parent_dir.join(&vmrk_name);
            if vmrk_path.exists() {
                let temp_vmrk = temp_dir.join(&vmrk_name);
                convert_text_file(&vmrk_path, &temp_vmrk)?;
            }
        }

        // Copy .eeg file if referenced (binary data, no conversion needed)
        if let Some(eeg_name) = data_file_name {
            let eeg_path = parent_dir.join(&eeg_name);
            if eeg_path.exists() {
                let temp_eeg = temp_dir.join(&eeg_name);
                fs::copy(&eeg_path, &temp_eeg)?;

                // Set permissions to 0644
                let mut perms = fs::metadata(&temp_eeg)?.permissions();
                perms.set_mode(0o644);
                fs::set_permissions(&temp_eeg, perms)?;
            }
        }

        log::info!("Created UTF-8 temporary BrainVision files with CRLF in: {}", temp_dir.display());

        // Debug: Log first few lines of converted header
        if let Ok(content) = fs::read_to_string(&temp_vhdr) {
            let first_lines: Vec<&str> = content.lines().take(5).collect();
            log::debug!("Converted header first 5 lines: {:?}", first_lines);
            log::debug!("First line bytes: {:?}", content.lines().next().map(|l| l.as_bytes().iter().take(60).collect::<Vec<_>>()));
        }

        Ok((temp_vhdr, Some(temp_dir)))
    }

    pub fn new(path: &Path) -> FileResult<Self> {
        // First try using bvreader for standard BrainVision files
        match Self::try_bvreader(path) {
            Ok(reader) => {
                log::info!("Loaded BrainVision file using bvreader library");
                return Ok(reader);
            }
            Err(e) => {
                log::warn!("bvreader failed ({}), trying simple parser for AnyWave files", e);
            }
        }

        // Fallback to simple parser for AnyWave-exported files
        Self::try_simple_parser(path)
    }

    fn try_bvreader(path: &Path) -> FileResult<Self> {
        let (load_path, temp_dir) = Self::ensure_utf8_brainvision_files(path)?;
        let load_path_str = load_path.to_str()
            .ok_or_else(|| FileReaderError::ParseError("Invalid temp path".to_string()))?;

        let result = BVFile::from_header(load_path_str)
            .map_err(|e| FileReaderError::ParseError(format!("{:?}", e)));

        // Clean up temp directory
        if let Some(dir) = temp_dir {
            let _ = fs::remove_dir_all(&dir);
        }

        let mut file = result?;
        file.validate().map_err(|e| FileReaderError::InvalidData(format!("{:?}", e)))?;
        file.bv_data.scale_channels(&file.bv_header.channel_info)
            .map_err(|e| FileReaderError::ParseError(format!("{:?}", e)))?;

        Ok(Self {
            backend: BVReaderBackend::BVReader(file),
            path: path.to_string_lossy().to_string(),
        })
    }

    fn try_simple_parser(path: &Path) -> FileResult<Self> {
        log::info!("Using simple BrainVision parser for: {}", path.display());

        // Parse header
        let header = SimpleBVHeader::parse(path)?;
        log::info!("Parsed header: {} channels, {} µs sampling interval",
                   header.num_channels, header.sampling_interval_us);

        // Get data file path
        let parent_dir = path.parent().unwrap();
        let data_file_path = parent_dir.join(&header.data_file);

        if !data_file_path.exists() {
            return Err(FileReaderError::MissingFile(format!(
                "Data file not found: {}", data_file_path.display()
            )));
        }

        Ok(Self {
            backend: BVReaderBackend::Simple(header, data_file_path),
            path: path.to_string_lossy().to_string(),
        })
    }

    fn read_decimated_overview(
        header: &SimpleBVHeader,
        data_path: &Path,
        max_points: usize,
        decimation: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        // Determine which channels to read
        let all_channel_names = &header.channels;
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| all_channel_names.iter().position(|c| c == ch))
                .collect()
        } else {
            (0..all_channel_names.len()).collect()
        };

        let num_channels = header.num_channels;
        let bytes_per_sample = 4; // IEEE_FLOAT_32
        let bytes_per_timepoint = num_channels * bytes_per_sample;

        let mut file = fs::File::open(data_path)?;
        let file_size = file.metadata()?.len() as usize;
        let total_samples = file_size / bytes_per_timepoint;

        // Initialize result vectors
        let mut result: Vec<Vec<f64>> = vec![Vec::with_capacity(max_points); channel_indices.len()];

        // Read every Nth sample directly
        let mut sample_buffer = vec![0u8; bytes_per_timepoint];

        for sample_idx in (0..total_samples).step_by(decimation) {
            // Seek to this sample
            let byte_offset = sample_idx * bytes_per_timepoint;
            file.seek(SeekFrom::Start(byte_offset as u64))?;

            // Read one timepoint (all channels)
            file.read_exact(&mut sample_buffer)?;

            // Extract values for selected channels
            for (result_idx, &ch_idx) in channel_indices.iter().enumerate() {
                if ch_idx < num_channels {
                    let byte_start = ch_idx * bytes_per_sample;
                    let bytes: [u8; 4] = [
                        sample_buffer[byte_start],
                        sample_buffer[byte_start + 1],
                        sample_buffer[byte_start + 2],
                        sample_buffer[byte_start + 3],
                    ];
                    let value = f32::from_le_bytes(bytes) as f64;
                    result[result_idx].push(value);
                }
            }

            // Stop if we've collected enough points
            if result[0].len() >= max_points {
                break;
            }
        }

        Ok(result)
    }

    fn read_chunk_simple(
        header: &SimpleBVHeader,
        data_path: &Path,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        // Determine which channels to read
        let all_channel_names = &header.channels;
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| all_channel_names.iter().position(|c| c == ch))
                .collect()
        } else {
            (0..all_channel_names.len()).collect()
        };

        // Validate format
        if header.data_format != "BINARY" {
            return Err(FileReaderError::UnsupportedFormat(
                format!("Only BINARY data format supported, got: {}", header.data_format)
            ));
        }
        if header.data_orientation != "MULTIPLEXED" {
            return Err(FileReaderError::UnsupportedFormat(
                format!("Only MULTIPLEXED orientation supported, got: {}", header.data_orientation)
            ));
        }
        if header.binary_format != "IEEE_FLOAT_32" {
            return Err(FileReaderError::UnsupportedFormat(
                format!("Only IEEE_FLOAT_32 format supported, got: {}", header.binary_format)
            ));
        }

        let num_channels = header.num_channels;
        let bytes_per_sample = 4; // IEEE_FLOAT_32
        let bytes_per_timepoint = num_channels * bytes_per_sample;

        // Open file and seek to start position
        let mut file = fs::File::open(data_path)?;
        let file_size = file.metadata()?.len() as usize;
        let total_samples = file_size / bytes_per_timepoint;

        // Clamp to available data
        let start_sample = start_sample.min(total_samples);
        let num_samples = num_samples.min(total_samples - start_sample);

        // Seek to start position
        let start_byte = start_sample * bytes_per_timepoint;
        file.seek(SeekFrom::Start(start_byte as u64))?;

        // Read multiplexed data: [ch1_s1, ch2_s1, ..., chN_s1, ch1_s2, ch2_s2, ..., chN_s2, ...]
        let bytes_to_read = num_samples * bytes_per_timepoint;
        let mut buffer = vec![0u8; bytes_to_read];
        file.read_exact(&mut buffer)?;

        // Parse IEEE_FLOAT_32 values
        let mut all_samples: Vec<f32> = Vec::with_capacity(num_samples * num_channels);
        for chunk in buffer.chunks_exact(4) {
            let bytes: [u8; 4] = [chunk[0], chunk[1], chunk[2], chunk[3]];
            let value = f32::from_le_bytes(bytes);
            all_samples.push(value);
        }

        // De-multiplex: convert from [ch1_s1, ch2_s1, ..., chN_s1, ch1_s2, ...]
        // to separate channel vectors
        let mut result: Vec<Vec<f64>> = vec![Vec::with_capacity(num_samples); channel_indices.len()];

        for sample_idx in 0..num_samples {
            let offset = sample_idx * num_channels;
            for (result_idx, &ch_idx) in channel_indices.iter().enumerate() {
                if ch_idx < num_channels {
                    let value = all_samples[offset + ch_idx] as f64;
                    result[result_idx].push(value);
                }
            }
        }

        Ok(result)
    }

    fn read_chunk_bvreader(
        file: &BVFile,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let channel_info = &file.bv_header.channel_info;
        let all_channel_names: Vec<String> = channel_info.iter()
            .map(|ch| ch.label.clone())
            .collect();

        // Determine which channels to read
        let channel_indices: Vec<usize> = if let Some(selected) = channels {
            selected
                .iter()
                .filter_map(|ch| {
                    all_channel_names
                        .iter()
                        .position(|c| c == ch)
                })
                .collect()
        } else {
            (0..all_channel_names.len()).collect()
        };

        let end_sample = start_sample + num_samples;
        let max_samples = if !file.bv_data.data.is_empty() {
            file.bv_data.data[0].len()
        } else {
            0
        };
        let end_sample = end_sample.min(max_samples);

        let mut result = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            if ch_idx >= file.bv_data.data.len() {
                result.push(Vec::new());
                continue;
            }

            let channel_data = &file.bv_data.data[ch_idx];

            if start_sample < channel_data.len() {
                let data_slice = &channel_data[start_sample..end_sample.min(channel_data.len())];
                let data_f64: Vec<f64> = data_slice.iter().map(|&v| v as f64).collect();
                result.push(data_f64);
            } else {
                result.push(Vec::new());
            }
        }

        Ok(result)
    }
}

impl FileReader for BrainVisionFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        match &self.backend {
            BVReaderBackend::BVReader(file) => {
                let header = &file.bv_header;
                let channel_info = &header.channel_info;

                let channels: Vec<String> = channel_info.iter()
                    .map(|ch| ch.label.clone())
                    .collect();

                let num_channels = channels.len();
                let num_samples = if !file.bv_data.data.is_empty() {
                    file.bv_data.data[0].len()
                } else {
                    0
                };
                let sample_rate = 1_000_000.0 / header.sampling_interval as f64;
                let duration = num_samples as f64 / sample_rate;

                Ok(FileMetadata {
                    file_path: self.path.clone(),
                    file_name: Path::new(&self.path).file_name()
                        .and_then(|n| n.to_str())
                        .ok_or_else(|| FileReaderError::ParseError("Invalid filename".to_string()))?
                        .to_string(),
                    file_size: std::fs::metadata(&self.path)?.len(),
                    sample_rate,
                    num_channels,
                    num_samples,
                    duration,
                    channels,
                    start_time: None,
                    file_type: "BrainVision".to_string(),
                })
            }
            BVReaderBackend::Simple(header, data_path) => {
                let channels = header.channels.clone();
                let num_channels = header.num_channels;

                // Calculate sample rate from sampling interval (microseconds)
                let sample_rate = 1_000_000.0 / header.sampling_interval_us;

                // Calculate num_samples from binary file size
                let file_size = fs::metadata(data_path)?.len();
                let bytes_per_sample = if header.binary_format == "IEEE_FLOAT_32" { 4 } else { 2 };
                let total_samples = file_size as usize / bytes_per_sample / num_channels;

                let duration = total_samples as f64 / sample_rate;

                Ok(FileMetadata {
                    file_path: self.path.clone(),
                    file_name: Path::new(&self.path).file_name()
                        .and_then(|n| n.to_str())
                        .ok_or_else(|| FileReaderError::ParseError("Invalid filename".to_string()))?
                        .to_string(),
                    file_size: fs::metadata(&self.path)?.len(),
                    sample_rate,
                    num_channels,
                    num_samples: total_samples,
                    duration,
                    channels,
                    start_time: None,
                    file_type: "BrainVision (AnyWave)".to_string(),
                })
            }
        }
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        match &self.backend {
            BVReaderBackend::BVReader(file) => Self::read_chunk_bvreader(file, start_sample, num_samples, channels),
            BVReaderBackend::Simple(header, data_path) => Self::read_chunk_simple(header, data_path, start_sample, num_samples, channels),
        }
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let metadata = self.metadata()?;
        let total_samples = metadata.num_samples;

        // Calculate decimation factor
        let decimation = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation = decimation.max(1);

        // For Simple backend with large files, use optimized decimated reading
        if let BVReaderBackend::Simple(header, data_path) = &self.backend {
            if total_samples > 100000 {
                // Large file: read only the samples we need (every Nth sample)
                return Self::read_decimated_overview(header, data_path, max_points, decimation, channels);
            }
        }

        // Small file or bvreader: read full data and decimate
        let full_data = self.read_chunk(0, total_samples, channels)?;

        let decimated: Vec<Vec<f64>> = full_data
            .into_iter()
            .map(|channel_data| {
                channel_data
                    .iter()
                    .step_by(decimation)
                    .copied()
                    .collect()
            })
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "BrainVision"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_brainvision_reader_with_test_file() {
        // Test with the sample file in data/ directory
        let test_file = Path::new("/Users/simon/Desktop/DDALAB/data/01_header.vhdr");

        if !test_file.exists() {
            println!("Test file not found, skipping test");
            return;
        }

        let reader = BrainVisionFileReader::new(test_file);
        if let Err(ref e) = reader {
            println!("Failed to create BrainVision reader: {:?}", e);
        }
        assert!(reader.is_ok(), "Failed to create BrainVision reader: {:?}", reader.err());

        let reader = reader.unwrap();
        let metadata = reader.metadata();
        assert!(metadata.is_ok(), "Failed to get metadata");

        let metadata = metadata.unwrap();
        assert_eq!(metadata.file_type, "BrainVision");
        assert!(metadata.num_channels > 0, "Should have at least one channel");
        assert!(metadata.num_samples > 0, "Should have at least one sample");
        assert!(metadata.sample_rate > 0.0, "Sample rate should be positive");

        println!("BrainVision test file loaded successfully:");
        println!("  Channels: {}", metadata.num_channels);
        println!("  Samples: {}", metadata.num_samples);
        println!("  Sample rate: {} Hz", metadata.sample_rate);
        println!("  Duration: {} seconds", metadata.duration);
    }
}
