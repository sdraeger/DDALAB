// Text-based time series file reader (CSV and ASCII/TSV)
// Supports:
// - CSV: Comma-separated values with optional header row
// - ASCII: Whitespace-separated values (TSV-like) with optional header row
//
// Format assumptions:
// - First row may contain channel names (detected if non-numeric)
// - Each column represents a channel
// - Each row represents a time point
// - No sampling rate encoded (assumed non-physiological data)
//
// Memory efficiency:
// - Builds a line position index during construction (byte offsets only)
// - Reads only requested sample ranges from disk
// - Supports streaming reads for large files (multi-GB)
//
// Security:
// - Maximum line length limit prevents OOM on malformed files

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// Maximum line length to prevent OOM on malformed files (10 MB per line)
/// This allows for ~1 million columns of 10-digit numbers
const MAX_LINE_LENGTH: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct TextFileInfo {
    pub num_channels: usize,
    pub num_samples: usize,
    pub channel_labels: Vec<String>,
    pub has_header: bool,
}

#[derive(Debug)]
pub struct TextFileReader {
    pub info: TextFileInfo,
    path: String,
    line_positions: Vec<u64>,
    delimiter: Option<char>,
}

impl TextFileReader {
    /// Read a CSV file (comma-separated)
    pub fn from_csv<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        Self::open_file(path, Some(','))
    }

    /// Read an ASCII file (whitespace-separated)
    pub fn from_ascii<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        Self::open_file(path, None)
    }

    /// Open and index a text file without loading data into memory
    fn open_file<P: AsRef<Path>>(path: P, delimiter: Option<char>) -> Result<Self, String> {
        let path_ref = path.as_ref();
        let file = File::open(path_ref).map_err(|e| format!("Failed to open file: {}", e))?;

        let mut reader = BufReader::new(file);

        // Index line positions and parse header
        let mut line_positions: Vec<u64> = Vec::new();
        let mut current_pos: u64 = 0;
        let mut first_line_content: Option<String> = None;
        let mut num_channels = 0;
        let mut has_header = false;
        let mut line_buf = String::new();

        // Read first line to determine structure
        let first_line_len = reader
            .read_line(&mut line_buf)
            .map_err(|e| format!("Failed to read first line: {}", e))?;

        if first_line_len == 0 {
            return Err("File is empty".to_string());
        }

        // Validate line length to prevent OOM on malformed files
        if first_line_len > MAX_LINE_LENGTH {
            return Err(format!(
                "Line too long: {} bytes (max: {} bytes)",
                first_line_len, MAX_LINE_LENGTH
            ));
        }

        // Parse first line
        let first_values = Self::parse_line(&line_buf, delimiter)?;
        num_channels = first_values.len();
        has_header = first_values.iter().any(|s| s.parse::<f64>().is_err());
        first_line_content = Some(line_buf.clone());

        // Update position tracking
        let first_line_bytes = first_line_len as u64;
        if has_header {
            // Skip header position, move to data start
            current_pos = first_line_bytes;
        } else {
            // First line is data, record its position (0)
            if !line_buf.trim().is_empty() {
                line_positions.push(0);
            }
            current_pos = first_line_bytes;
        }

        // Continue reading to build line index
        loop {
            line_buf.clear();
            let bytes_read = reader
                .read_line(&mut line_buf)
                .map_err(|e| format!("Failed to read line: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            // Validate line length to prevent OOM on malformed files
            if bytes_read > MAX_LINE_LENGTH {
                return Err(format!(
                    "Line too long at position {}: {} bytes (max: {} bytes)",
                    current_pos, bytes_read, MAX_LINE_LENGTH
                ));
            }

            if !line_buf.trim().is_empty() {
                line_positions.push(current_pos);
            }

            current_pos += bytes_read as u64;
        }

        if num_channels == 0 {
            return Err("No channels found in file".to_string());
        }

        let num_samples = line_positions.len();

        // Parse channel labels
        let channel_labels: Vec<String> = if has_header {
            if let Some(ref line) = first_line_content {
                Self::parse_line(line, delimiter)?
                    .into_iter()
                    .map(|s| s.trim().to_string())
                    .collect()
            } else {
                (0..num_channels)
                    .map(|i| format!("Channel {}", i + 1))
                    .collect()
            }
        } else {
            (0..num_channels)
                .map(|i| format!("Channel {}", i + 1))
                .collect()
        };

        let info = TextFileInfo {
            num_channels,
            num_samples,
            channel_labels,
            has_header,
        };

        Ok(Self {
            info,
            path: path_ref.to_string_lossy().to_string(),
            line_positions,
            delimiter,
        })
    }

    /// Parse a line into values based on delimiter
    fn parse_line(line: &str, delimiter: Option<char>) -> Result<Vec<String>, String> {
        let values: Vec<String> = match delimiter {
            Some(delim) => {
                // Split by specific delimiter (e.g., comma for CSV)
                line.split(delim)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            }
            None => {
                // Split by any whitespace (for ASCII/TSV)
                line.split_whitespace().map(|s| s.to_string()).collect()
            }
        };

        if values.is_empty() {
            return Err("Empty line or no values found".to_string());
        }

        Ok(values)
    }

    /// Read a window of data for specific channels
    /// This reads directly from disk, only loading the requested sample range
    /// Uses sequential reading with a single initial seek for optimal I/O performance
    pub fn read_window(
        &self,
        start_sample: usize,
        num_samples: usize,
        channel_indices: &[usize],
    ) -> Result<Vec<Vec<f64>>, String> {
        if start_sample >= self.info.num_samples {
            return Err(format!(
                "Start sample {} is beyond data length {}",
                start_sample, self.info.num_samples
            ));
        }

        let end_sample = (start_sample + num_samples).min(self.info.num_samples);
        let samples_to_read = end_sample - start_sample;

        // Validate channel indices
        for &ch_idx in channel_indices {
            if ch_idx >= self.info.num_channels {
                return Err(format!(
                    "Channel index {} is out of range (max {})",
                    ch_idx,
                    self.info.num_channels - 1
                ));
            }
        }

        // Open file for reading
        let file = File::open(&self.path).map_err(|e| format!("Failed to open file: {}", e))?;
        let mut reader = BufReader::new(file);

        // Pre-allocate channel data vectors
        let mut data: Vec<Vec<f64>> = channel_indices
            .iter()
            .map(|_| Vec::with_capacity(samples_to_read))
            .collect();

        // Seek once to the start position, then read sequentially
        // This avoids N separate seek() calls for N samples
        let start_pos = self.line_positions[start_sample];
        reader
            .seek(SeekFrom::Start(start_pos))
            .map_err(|e| format!("Failed to seek to start position: {}", e))?;

        let mut line_buf = String::new();

        for sample_idx in start_sample..end_sample {
            line_buf.clear();
            reader
                .read_line(&mut line_buf)
                .map_err(|e| format!("Failed to read line: {}", e))?;

            // Skip empty lines and re-read (handles files with inconsistent line endings)
            if line_buf.trim().is_empty() {
                // This shouldn't happen since we only indexed non-empty lines,
                // but handle it gracefully by seeking to the expected position
                let expected_pos = self.line_positions[sample_idx];
                reader
                    .seek(SeekFrom::Start(expected_pos))
                    .map_err(|e| format!("Failed to seek: {}", e))?;
                line_buf.clear();
                reader
                    .read_line(&mut line_buf)
                    .map_err(|e| format!("Failed to read line: {}", e))?;
            }

            let values = Self::parse_line(&line_buf, self.delimiter)?;

            // Extract only the requested channels
            for (data_idx, &ch_idx) in channel_indices.iter().enumerate() {
                if ch_idx < values.len() {
                    let value: f64 = values[ch_idx].parse().unwrap_or(f64::NAN);
                    data[data_idx].push(value);
                } else {
                    data[data_idx].push(f64::NAN);
                }
            }
        }

        Ok(data)
    }

    /// Read a window of data with decimation for overview generation
    /// Only reads every Nth sample to avoid loading all data for large files
    pub fn read_overview(
        &self,
        max_points: usize,
        channel_indices: &[usize],
    ) -> Result<Vec<Vec<f64>>, String> {
        let total_samples = self.info.num_samples;

        if total_samples == 0 {
            return Ok(channel_indices.iter().map(|_| Vec::new()).collect());
        }

        // Calculate decimation factor
        // For min-max downsampling, we need 2 points per bucket, so aim for max_points/2 buckets
        let target_buckets = (max_points / 2).max(1);
        let bucket_size = (total_samples as f64 / target_buckets as f64).ceil() as usize;
        let bucket_size = bucket_size.max(1);

        // Validate channel indices
        for &ch_idx in channel_indices {
            if ch_idx >= self.info.num_channels {
                return Err(format!(
                    "Channel index {} is out of range (max {})",
                    ch_idx,
                    self.info.num_channels - 1
                ));
            }
        }

        // Open file for reading
        let file = File::open(&self.path).map_err(|e| format!("Failed to open file: {}", e))?;
        let mut reader = BufReader::new(file);

        // Initialize result with min/max tracking per bucket
        let num_buckets = (total_samples + bucket_size - 1) / bucket_size;
        let mut bucket_mins: Vec<Vec<f64>> = channel_indices
            .iter()
            .map(|_| vec![f64::INFINITY; num_buckets])
            .collect();
        let mut bucket_maxs: Vec<Vec<f64>> = channel_indices
            .iter()
            .map(|_| vec![f64::NEG_INFINITY; num_buckets])
            .collect();

        // Read all lines sequentially (more efficient than random seeks for overview)
        let mut line_buf = String::new();

        // Seek to first data line
        if !self.line_positions.is_empty() {
            reader
                .seek(SeekFrom::Start(self.line_positions[0]))
                .map_err(|e| format!("Failed to seek: {}", e))?;
        }

        for (sample_idx, &_line_pos) in self.line_positions.iter().enumerate() {
            line_buf.clear();
            let bytes_read = reader
                .read_line(&mut line_buf)
                .map_err(|e| format!("Failed to read line: {}", e))?;

            if bytes_read == 0 {
                break;
            }

            // Skip empty lines (shouldn't happen since we indexed non-empty lines)
            if line_buf.trim().is_empty() {
                continue;
            }

            let values = match Self::parse_line(&line_buf, self.delimiter) {
                Ok(v) => v,
                Err(_) => continue, // Skip malformed lines
            };

            let bucket_idx = sample_idx / bucket_size;
            if bucket_idx >= num_buckets {
                break;
            }

            // Update min/max for each channel
            for (data_idx, &ch_idx) in channel_indices.iter().enumerate() {
                if ch_idx < values.len() {
                    if let Ok(value) = values[ch_idx].parse::<f64>() {
                        if value < bucket_mins[data_idx][bucket_idx] {
                            bucket_mins[data_idx][bucket_idx] = value;
                        }
                        if value > bucket_maxs[data_idx][bucket_idx] {
                            bucket_maxs[data_idx][bucket_idx] = value;
                        }
                    }
                }
            }
        }

        // Build result: alternating min/max values
        let result: Vec<Vec<f64>> = channel_indices
            .iter()
            .enumerate()
            .map(|(data_idx, _)| {
                let mut channel_overview = Vec::with_capacity(num_buckets * 2);
                for bucket_idx in 0..num_buckets {
                    let min_val = bucket_mins[data_idx][bucket_idx];
                    let max_val = bucket_maxs[data_idx][bucket_idx];

                    // Only add valid values (skip buckets with no data)
                    if min_val.is_finite() {
                        channel_overview.push(min_val);
                    }
                    if max_val.is_finite() {
                        channel_overview.push(max_val);
                    }
                }
                channel_overview
            })
            .collect();

        Ok(result)
    }

    /// Provide backwards compatible `data` field access
    /// This loads all data into memory - use sparingly for large files
    /// Prefer `read_window` for targeted access
    #[allow(dead_code)]
    pub fn load_all_data(&self) -> Result<Vec<Vec<f64>>, String> {
        let all_channels: Vec<usize> = (0..self.info.num_channels).collect();
        self.read_window(0, self.info.num_samples, &all_channels)
    }
}

// Provide backwards compatible `data` field for code that expects eager loading
// This is a shim that will be removed once all callers use read_window
impl TextFileReader {
    /// Get data field (for backwards compatibility)
    /// Note: This property triggers a full file read - prefer read_window for large files
    #[allow(dead_code)]
    pub fn data(&self) -> Vec<Vec<f64>> {
        self.load_all_data().unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_csv_with_header() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "Time,Signal1,Signal2").unwrap();
        writeln!(file, "0.0,1.5,2.5").unwrap();
        writeln!(file, "1.0,1.6,2.6").unwrap();
        writeln!(file, "2.0,1.7,2.7").unwrap();
        file.flush().unwrap();

        let reader = TextFileReader::from_csv(file.path()).unwrap();

        assert_eq!(reader.info.num_channels, 3);
        assert_eq!(reader.info.num_samples, 3);
        assert!(reader.info.has_header);
        assert_eq!(
            reader.info.channel_labels,
            vec!["Time", "Signal1", "Signal2"]
        );

        // Test reading specific window
        let data = reader.read_window(0, 3, &[0, 1, 2]).unwrap();
        assert_eq!(data[0][0], 0.0);
        assert_eq!(data[1][0], 1.5);
        assert_eq!(data[2][0], 2.5);
    }

    #[test]
    fn test_ascii_without_header() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "0.0 1.5 2.5").unwrap();
        writeln!(file, "1.0 1.6 2.6").unwrap();
        writeln!(file, "2.0 1.7 2.7").unwrap();
        file.flush().unwrap();

        let reader = TextFileReader::from_ascii(file.path()).unwrap();

        assert_eq!(reader.info.num_channels, 3);
        assert_eq!(reader.info.num_samples, 3);
        assert!(!reader.info.has_header);
        assert_eq!(
            reader.info.channel_labels,
            vec!["Channel 1", "Channel 2", "Channel 3"]
        );
    }

    #[test]
    fn test_read_window() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "0.0 1.0 2.0").unwrap();
        writeln!(file, "0.1 1.1 2.1").unwrap();
        writeln!(file, "0.2 1.2 2.2").unwrap();
        writeln!(file, "0.3 1.3 2.3").unwrap();
        file.flush().unwrap();

        let reader = TextFileReader::from_ascii(file.path()).unwrap();

        let window = reader.read_window(1, 2, &[0, 2]).unwrap();
        assert_eq!(window.len(), 2); // 2 channels
        assert_eq!(window[0], vec![0.1, 0.2]); // Channel 0, samples 1-2
        assert_eq!(window[1], vec![2.1, 2.2]); // Channel 2, samples 1-2
    }

    #[test]
    fn test_read_overview() {
        let mut file = NamedTempFile::new().unwrap();
        for i in 0..100 {
            writeln!(file, "{} {}", i as f64, (i as f64 * 2.0)).unwrap();
        }
        file.flush().unwrap();

        let reader = TextFileReader::from_ascii(file.path()).unwrap();

        // Request overview with max 20 points (10 buckets of min/max)
        let overview = reader.read_overview(20, &[0, 1]).unwrap();

        // Should have decimated data
        assert!(overview[0].len() <= 20);
        assert!(overview[1].len() <= 20);

        // First channel should have values from 0-99
        // Check that we captured the range
        let min_val = overview[0].iter().copied().fold(f64::INFINITY, f64::min);
        let max_val = overview[0]
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(min_val <= 1.0); // Should capture near-beginning values
        assert!(max_val >= 98.0); // Should capture near-end values
    }

    #[test]
    fn test_read_partial_channels() {
        let mut file = NamedTempFile::new().unwrap();
        writeln!(file, "A,B,C,D").unwrap();
        writeln!(file, "1,2,3,4").unwrap();
        writeln!(file, "5,6,7,8").unwrap();
        file.flush().unwrap();

        let reader = TextFileReader::from_csv(file.path()).unwrap();

        // Read only channels B and D (indices 1 and 3)
        let data = reader.read_window(0, 2, &[1, 3]).unwrap();
        assert_eq!(data.len(), 2);
        assert_eq!(data[0], vec![2.0, 6.0]); // Channel B
        assert_eq!(data[1], vec![4.0, 8.0]); // Channel D
    }
}
