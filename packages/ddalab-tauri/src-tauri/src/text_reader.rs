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

use rayon::prelude::*;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

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
    pub data: Vec<Vec<f64>>, // [channel][sample]
}

impl TextFileReader {
    /// Read a CSV file (comma-separated)
    pub fn from_csv<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        Self::read_file(path, b',')
    }

    /// Read an ASCII file (whitespace-separated)
    pub fn from_ascii<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        Self::read_file(path, b' ')
    }

    /// Generic file reader with configurable delimiter
    fn read_file<P: AsRef<Path>>(path: P, delimiter: u8) -> Result<Self, String> {
        let file = File::open(path.as_ref()).map_err(|e| format!("Failed to open file: {}", e))?;

        let reader = BufReader::new(file);
        let lines: Vec<String> = reader
            .lines()
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Failed to read file: {}", e))?;

        if lines.is_empty() {
            return Err("File is empty".to_string());
        }

        // Detect delimiter character (space or tab for ASCII, comma for CSV)
        let delim_str = if delimiter == b' ' {
            // For ASCII, split on any whitespace (spaces or tabs)
            None
        } else {
            Some(delimiter as char)
        };

        // Parse first line to check if it's a header
        let first_line = &lines[0];
        let first_row = Self::parse_line(first_line, delim_str)?;

        // Check if first row contains non-numeric values (header)
        let has_header = first_row.iter().any(|s| s.parse::<f64>().is_err());

        let (channel_labels, data_start_idx) = if has_header {
            // Use first row as channel labels
            let labels: Vec<String> = first_row.iter().map(|s| s.trim().to_string()).collect();
            (labels, 1)
        } else {
            // Generate default channel labels
            let num_channels = first_row.len();
            let labels: Vec<String> = (0..num_channels)
                .map(|i| format!("Channel {}", i + 1))
                .collect();
            (labels, 0)
        };

        let num_channels = channel_labels.len();

        // Parallel parsing of data rows
        let parsed_rows: Vec<Vec<f64>> = lines
            .par_iter()
            .enumerate()
            .skip(data_start_idx)
            .filter(|(_, line)| !line.trim().is_empty())
            .map(|(line_idx, line)| {
                let values = Self::parse_line(line, delim_str)
                    .map_err(|e| format!("Line {}: {}", line_idx + 1, e))?;

                if values.len() != num_channels {
                    return Err(format!(
                        "Line {} has {} values, expected {} channels",
                        line_idx + 1,
                        values.len(),
                        num_channels
                    ));
                }

                // Parse all values in this row
                values
                    .iter()
                    .enumerate()
                    .map(|(ch_idx, value_str)| {
                        value_str.trim().parse::<f64>().map_err(|_| {
                            format!(
                                "Invalid numeric value '{}' at line {}, column {}",
                                value_str,
                                line_idx + 1,
                                ch_idx + 1
                            )
                        })
                    })
                    .collect::<Result<Vec<f64>, String>>()
            })
            .collect::<Result<Vec<Vec<f64>>, String>>()?;

        let num_samples = parsed_rows.len();

        // Transpose: rows -> columns (samples -> channels)
        let mut data: Vec<Vec<f64>> = vec![Vec::with_capacity(num_samples); num_channels];
        for row in parsed_rows {
            for (ch_idx, value) in row.into_iter().enumerate() {
                data[ch_idx].push(value);
            }
        }

        if num_samples == 0 {
            return Err("No data rows found in file".to_string());
        }

        let info = TextFileInfo {
            num_channels,
            num_samples,
            channel_labels: channel_labels.clone(),
            has_header,
        };

        Ok(Self { info, data })
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

        let mut window_data = Vec::new();

        for &ch_idx in channel_indices {
            if ch_idx >= self.info.num_channels {
                return Err(format!(
                    "Channel index {} is out of range (max {})",
                    ch_idx,
                    self.info.num_channels - 1
                ));
            }

            let channel_window: Vec<f64> = self.data[ch_idx][start_sample..end_sample].to_vec();
            window_data.push(channel_window);
        }

        Ok(window_data)
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
        assert_eq!(reader.data[0][0], 0.0);
        assert_eq!(reader.data[1][0], 1.5);
        assert_eq!(reader.data[2][0], 2.5);
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
}
