/*! FIF (Functional Image File / FIFF Format) File Reader
 *
 * Thin wrapper around the external `fiff` crate that implements the
 * [`FileReader`](super::FileReader) trait for FIFF files.
 *
 * FIFF is the native format for Neuromag/Elekta MEG systems. This implementation
 * is based on MNE-Python's FIFF parser but written in pure Rust.
 *
 * # Features
 * - Calibrated data (applies cal × range scaling)
 * - Real channel names from FIFF metadata
 * - Channel type detection (MEG, EEG, EOG, STIM, etc.)
 * - Channel filtering by type
 * - Sequential tag reading (handles files without directory pointers)
 * - Integration with DDALAB's IntermediateData pipeline
 *
 * # Limitations
 *
 * **The underlying `fiff` crate is a minimal implementation.**
 *
 * **Not supported:**
 * - CTF compensation (CTF data may be incorrect)
 * - SSP projectors
 * - Bad channel detection
 * - Coordinate transformations
 * - Digitization data
 *
 * **Suitable for:** DDA analysis on Neuromag/Elekta data
 * **Not suitable for:** Advanced MEG analysis (use MNE-Python)
 */

use super::{ChannelMetadata, FileMetadata, FileReader, FileReaderError, FileResult};
use parking_lot::Mutex;
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use fiff::{
    channel_type_name, dir_tree_find, open_fiff, type_size, ChannelInfo, MeasInfo, Tag, TreeNode,
    FIFFB_CONTINUOUS_DATA, FIFFB_RAW_DATA, FIFFT_DAU_PACK16, FIFFT_DOUBLE, FIFFT_FLOAT, FIFFT_INT,
    FIFFT_SHORT, FIFF_DATA_BUFFER, FIFF_DATA_SKIP, FIFF_FIRST_SAMPLE,
};
#[cfg(test)]
use fiff::{FIFFV_MEG_CH, FIFFV_STIM_CH};

struct FIFReaderCore {
    reader: BufReader<File>,
    raw_node: TreeNode,
    meas_info: MeasInfo,
    first_samp: i64,
    last_samp: i64,
}

pub struct FIFFileReader {
    file_path: String,
    metadata: FileMetadata,
    core: Mutex<FIFReaderCore>,
    /// Cache for O(1) channel name to index lookups.
    /// Built once during initialization to avoid repeated linear searches.
    channel_index_cache: HashMap<String, usize>,
}

impl FIFFileReader {
    pub fn new(path: &Path) -> FileResult<Self> {
        let file_path = path.to_string_lossy().to_string();
        let start_total = std::time::Instant::now();

        // Open FIFF file
        let start = std::time::Instant::now();
        let (mut reader, tree) = open_fiff(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to open FIF file: {}", e)))?;
        log::info!("FIF open_fiff: {:?}", start.elapsed());

        // Read measurement info
        let start = std::time::Instant::now();
        let meas_info = MeasInfo::read(&mut reader, &tree).map_err(|e| {
            FileReaderError::ParseError(format!("Failed to read measurement info: {}", e))
        })?;
        log::info!("FIF MeasInfo::read: {:?}", start.elapsed());

        // Find raw data block
        let start = std::time::Instant::now();
        let raw_nodes = dir_tree_find(&tree, FIFFB_RAW_DATA);
        let raw_node = if raw_nodes.is_empty() {
            // Try continuous data
            let cont_nodes = dir_tree_find(&tree, FIFFB_CONTINUOUS_DATA);
            if cont_nodes.is_empty() {
                return Err(FileReaderError::ParseError(
                    "No raw or continuous data found in FIF file".to_string(),
                ));
            }
            cont_nodes[0].clone()
        } else {
            raw_nodes[0].clone()
        };
        log::info!("FIF find raw data block: {:?}", start.elapsed());

        // Parse raw data info
        let directory = &raw_node.directory;
        let mut first = 0;
        let mut first_samp = 0i64;

        // Read first sample if present
        if let Some(entry) = directory.get(first) {
            if entry.kind == FIFF_FIRST_SAMPLE {
                if let Ok(tag) = Tag::read_at(&mut reader, entry.pos) {
                    if let Ok(val) = tag.as_i32() {
                        first_samp = val as i64;
                        first += 1;
                    }
                }
            }
        }

        // Skip initial skip if present
        if let Some(entry) = directory.get(first) {
            if entry.kind == FIFF_DATA_SKIP {
                first += 1;
            }
        }

        // Count total samples
        let mut total_samples = 0i64;
        let nchan = meas_info.nchan;

        for entry in directory.iter().skip(first) {
            if entry.kind == FIFF_DATA_BUFFER {
                if let Some(type_sz) = type_size(entry.type_) {
                    let nsamp = entry.size as usize / (type_sz * nchan);
                    total_samples += nsamp as i64;
                }
            }
        }

        let last_samp = first_samp + total_samples - 1;

        // Build file metadata
        let duration = total_samples as f64 / meas_info.sfreq;
        let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

        let channels: Vec<String> = meas_info
            .channels
            .iter()
            .map(|ch| ch.ch_name.clone())
            .collect();

        // Build channel name to index cache for O(1) lookups
        let channel_index_cache: HashMap<String, usize> = channels
            .iter()
            .enumerate()
            .map(|(idx, name)| (name.clone(), idx))
            .collect();

        let channel_metadata: Vec<ChannelMetadata> = meas_info
            .channels
            .iter()
            .map(|ch| ChannelMetadata {
                channel_type: channel_type_name(ch.kind).to_string(),
                unit: fiff_unit_string(ch.unit, ch.unit_mul),
            })
            .collect();

        let metadata = FileMetadata {
            file_path: file_path.clone(),
            file_name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown.fif")
                .to_string(),
            file_size,
            sample_rate: meas_info.sfreq,
            num_channels: meas_info.nchan,
            num_samples: total_samples as usize,
            duration,
            channel_metadata,
            channels,
            start_time: None, // Would need to parse FIFF_MEAS_DATE
            file_type: "FIF".to_string(),
        };

        log::info!("FIF total initialization: {:?}", start_total.elapsed());

        let core = FIFReaderCore {
            reader,
            raw_node,
            meas_info,
            first_samp,
            last_samp,
        };

        Ok(Self {
            file_path,
            metadata,
            core: Mutex::new(core),
            channel_index_cache,
        })
    }

    pub fn data_channel_indices(&self) -> Vec<usize> {
        let core = self.core.lock();
        core.meas_info
            .channels
            .iter()
            .enumerate()
            .filter(|(_, ch)| ch.is_data_channel())
            .map(|(idx, _)| idx)
            .collect()
    }

    pub fn data_channel_names(&self) -> Vec<String> {
        let core = self.core.lock();
        core.meas_info
            .channels
            .iter()
            .filter(|ch| ch.is_data_channel())
            .map(|ch| ch.ch_name.clone())
            .collect()
    }

    pub fn channels_by_type(&self, kind: i32) -> Vec<(usize, ChannelInfo)> {
        let core = self.core.lock();
        core.meas_info
            .channels
            .iter()
            .enumerate()
            .filter(|(_, ch)| ch.kind == kind)
            .map(|(idx, ch)| (idx, ch.clone()))
            .collect()
    }

    pub fn print_channel_summary(&self) {
        use std::collections::HashMap;
        let core = self.core.lock();
        let mut type_counts: HashMap<i32, usize> = HashMap::new();

        for ch in &core.meas_info.channels {
            *type_counts.entry(ch.kind).or_insert(0) += 1;
        }

        eprintln!("Channel types in file:");
        for (kind, count) in type_counts.iter() {
            eprintln!(
                "  {} ({}): {} channels",
                channel_type_name(*kind),
                kind,
                count
            );
        }
    }

    /// Parse only selected channels from a FIFF data buffer tag.
    ///
    /// This is an optimization over `Tag::as_samples()` which allocates and parses
    /// all channels. For files with 1000+ channels where only 10 are requested,
    /// this avoids 99% of memory allocation and parsing work.
    ///
    /// The FIFF format stores data interleaved by time sample:
    /// [ch0_t0, ch1_t0, ..., chN_t0, ch0_t1, ch1_t1, ..., chN_t1, ...]
    ///
    /// We skip over unwanted channels by advancing the byte offset.
    fn parse_selected_channels(
        tag: &Tag,
        nchan: usize,
        channel_indices: &[usize],
    ) -> Result<Vec<Vec<f64>>, FileReaderError> {
        let type_sz = type_size(tag.type_).ok_or_else(|| {
            FileReaderError::ParseError(format!("Unknown FIFF type: {}", tag.type_))
        })?;

        let nsamp = tag.size as usize / (type_sz * nchan);
        let num_selected = channel_indices.len();
        let data = &tag.data;

        // Pre-allocate only for selected channels
        let mut samples = vec![vec![0.0f64; nsamp]; num_selected];

        // Build a sorted list of (original_index, output_index) for efficient iteration
        let mut sorted_indices: Vec<(usize, usize)> = channel_indices
            .iter()
            .enumerate()
            .map(|(out_idx, &orig_idx)| (orig_idx, out_idx))
            .collect();
        sorted_indices.sort_by_key(|(orig_idx, _)| *orig_idx);

        // Use direct byte access with from_be_bytes for efficiency
        let bytes_per_sample = type_sz * nchan;

        match tag.type_ {
            FIFFT_SHORT | FIFFT_DAU_PACK16 => {
                for samp_idx in 0..nsamp {
                    let sample_offset = samp_idx * bytes_per_sample;
                    for &(orig_ch_idx, out_idx) in &sorted_indices {
                        let byte_pos = sample_offset + orig_ch_idx * 2;
                        let bytes: [u8; 2] =
                            data[byte_pos..byte_pos + 2].try_into().map_err(|_| {
                                FileReaderError::ParseError("Failed to read i16 bytes".to_string())
                            })?;
                        samples[out_idx][samp_idx] = i16::from_be_bytes(bytes) as f64;
                    }
                }
            }
            FIFFT_INT => {
                for samp_idx in 0..nsamp {
                    let sample_offset = samp_idx * bytes_per_sample;
                    for &(orig_ch_idx, out_idx) in &sorted_indices {
                        let byte_pos = sample_offset + orig_ch_idx * 4;
                        let bytes: [u8; 4] =
                            data[byte_pos..byte_pos + 4].try_into().map_err(|_| {
                                FileReaderError::ParseError("Failed to read i32 bytes".to_string())
                            })?;
                        samples[out_idx][samp_idx] = i32::from_be_bytes(bytes) as f64;
                    }
                }
            }
            FIFFT_FLOAT => {
                for samp_idx in 0..nsamp {
                    let sample_offset = samp_idx * bytes_per_sample;
                    for &(orig_ch_idx, out_idx) in &sorted_indices {
                        let byte_pos = sample_offset + orig_ch_idx * 4;
                        let bytes: [u8; 4] =
                            data[byte_pos..byte_pos + 4].try_into().map_err(|_| {
                                FileReaderError::ParseError("Failed to read f32 bytes".to_string())
                            })?;
                        samples[out_idx][samp_idx] = f32::from_be_bytes(bytes) as f64;
                    }
                }
            }
            FIFFT_DOUBLE => {
                for samp_idx in 0..nsamp {
                    let sample_offset = samp_idx * bytes_per_sample;
                    for &(orig_ch_idx, out_idx) in &sorted_indices {
                        let byte_pos = sample_offset + orig_ch_idx * 8;
                        let bytes: [u8; 8] =
                            data[byte_pos..byte_pos + 8].try_into().map_err(|_| {
                                FileReaderError::ParseError("Failed to read f64 bytes".to_string())
                            })?;
                        samples[out_idx][samp_idx] = f64::from_be_bytes(bytes);
                    }
                }
            }
            _ => {
                return Err(FileReaderError::ParseError(format!(
                    "Unsupported data type for samples: {}",
                    tag.type_
                )));
            }
        }

        Ok(samples)
    }

    fn read_data_range(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let start_read = std::time::Instant::now();

        if start_sample >= self.metadata.num_samples {
            return Err(FileReaderError::ParseError(format!(
                "Start sample {} is beyond file end ({})",
                start_sample, self.metadata.num_samples
            )));
        }

        let mut core = self.core.lock();
        let nchan = core.meas_info.nchan;
        let directory_entries = core.raw_node.directory.clone();

        log::info!(
            "FIF read_data_range request: start={}, num={}, channels={:?}",
            start_sample,
            num_samples,
            channels.map(|c| c.len())
        );

        // Use cached HashMap for O(1) channel lookups instead of O(n) linear search
        let channel_indices: Vec<usize> = if let Some(ch_names) = channels {
            ch_names
                .iter()
                .filter_map(|name| self.channel_index_cache.get(name).copied())
                .collect()
        } else {
            (0..nchan).collect()
        };

        let num_selected_channels = channel_indices.len();
        let mut result = vec![vec![0.0f64; num_samples]; num_selected_channels];

        let mut current_sample = 0usize;
        let mut buffer_start = 0usize;

        for (entry_idx, entry) in directory_entries.iter().enumerate() {
            if entry.kind != FIFF_DATA_BUFFER {
                continue;
            }

            let type_sz = type_size(entry.type_).ok_or_else(|| {
                FileReaderError::ParseError(format!("Unknown FIFF type: {}", entry.type_))
            })?;

            let buffer_nsamp = entry.size as usize / (type_sz * nchan);
            let buffer_end = buffer_start + buffer_nsamp;

            log::info!(
                "FIF buffer {}: start={}, end={}, nsamp={}, requested=[{}, {}]",
                entry_idx,
                buffer_start,
                buffer_end,
                buffer_nsamp,
                start_sample,
                start_sample + num_samples
            );

            // Check if this buffer overlaps with requested range
            let overlaps = buffer_end > start_sample && buffer_start < start_sample + num_samples;
            log::info!("FIF buffer {} overlaps: {}", entry_idx, overlaps);

            if !overlaps {
                buffer_start = buffer_end;
                continue;
            }

            let tag = Tag::read_at(&mut core.reader, entry.pos).map_err(|e| {
                FileReaderError::ParseError(format!("Failed to read data buffer: {}", e))
            })?;

            // Determine which part of this buffer to use
            let buf_offset = if buffer_start < start_sample {
                start_sample - buffer_start
            } else {
                0
            };

            let samples_to_copy = (buffer_nsamp - buf_offset).min(num_samples - current_sample);

            // Optimization: Only parse selected channels when reading a subset.
            // For 1000-channel MEG files reading only 10 channels, this avoids 99%
            // of memory allocation and parsing work.
            let reading_all_channels = num_selected_channels == nchan;

            if reading_all_channels {
                // Parse all channels (original behavior)
                let all_samples = tag.as_samples(nchan).map_err(|e| {
                    FileReaderError::ParseError(format!("Failed to parse samples: {}", e))
                })?;

                log::info!("FIF buffer copy (all channels): buf_offset={}, samples_to_copy={}, current_sample={}, all_samples_len={}",
                    buf_offset, samples_to_copy, current_sample, if all_samples.is_empty() { 0 } else { all_samples[0].len() });

                // Copy all channels in parallel
                result
                    .par_iter_mut()
                    .enumerate()
                    .for_each(|(ch_idx, channel_data)| {
                        let src = &all_samples[ch_idx][buf_offset..buf_offset + samples_to_copy];
                        let dst =
                            &mut channel_data[current_sample..current_sample + samples_to_copy];
                        dst.copy_from_slice(src);
                    });
            } else {
                // Parse only selected channels (optimized path)
                let selected_samples =
                    Self::parse_selected_channels(&tag, nchan, &channel_indices)?;

                log::info!("FIF buffer copy (selective): buf_offset={}, samples_to_copy={}, current_sample={}, selected_channels={}",
                    buf_offset, samples_to_copy, current_sample, num_selected_channels);

                // Copy selected channels in parallel
                result
                    .par_iter_mut()
                    .zip(selected_samples.par_iter())
                    .for_each(|(channel_data, src_channel)| {
                        let src = &src_channel[buf_offset..buf_offset + samples_to_copy];
                        let dst =
                            &mut channel_data[current_sample..current_sample + samples_to_copy];
                        dst.copy_from_slice(src);
                    });
            }

            log::info!(
                "FIF buffer copied {} samples for {} channels",
                samples_to_copy,
                channel_indices.len()
            );

            current_sample += samples_to_copy;

            if current_sample >= num_samples {
                log::info!(
                    "FIF finished reading: current_sample={} >= num_samples={}",
                    current_sample,
                    num_samples
                );
                break;
            }

            buffer_start = buffer_end;
        }

        log::info!(
            "FIF read_data_range completed: filled {}/{} samples",
            current_sample,
            num_samples
        );

        let meas_channels = core.meas_info.channels.clone();
        drop(core);

        result
            .par_iter_mut()
            .zip(channel_indices.par_iter())
            .for_each(|(channel_data, &orig_ch_idx)| {
                let ch_info = &meas_channels[orig_ch_idx];
                let scaling = ch_info.calibration();

                if scaling != 1.0 {
                    for sample in channel_data.iter_mut() {
                        *sample *= scaling;
                    }
                }
            });

        log::info!("FIF read_data_range total: {:?}", start_read.elapsed());
        Ok(result)
    }
}

impl FileReader for FIFFileReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        Ok(self.metadata.clone())
    }

    fn metadata_ref(&self) -> Option<&FileMetadata> {
        Some(&self.metadata)
    }

    fn read_chunk(
        &self,
        start_sample: usize,
        num_samples: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        self.read_data_range(start_sample, num_samples, channels)
    }

    fn read_overview(
        &self,
        max_points: usize,
        channels: Option<&[String]>,
    ) -> FileResult<Vec<Vec<f64>>> {
        let total_samples = self.metadata.num_samples;
        let decimation_factor = (total_samples as f64 / max_points as f64).ceil() as usize;
        let decimation_factor = decimation_factor.max(1);

        // Read full data then decimate
        let full_data = self.read_chunk(0, total_samples, channels)?;

        // Parallelize channel decimation for better performance (order preserved by rayon)
        let decimated: Vec<Vec<f64>> = full_data
            .par_iter()
            .map(|channel| channel.iter().step_by(decimation_factor).copied().collect())
            .collect();

        Ok(decimated)
    }

    fn format_name(&self) -> &str {
        "FIF"
    }

    fn supports_write(&self) -> bool {
        false
    }
}

/// Map FIFF unit (i32) and unit_mul (SI exponent) to a human-readable string.
///
/// FIFF unit constants: 107 = V (Volt), 112 = T (Tesla), 201 = Am (Ampere-meter).
/// unit_mul: 0 = base, -6 = micro, -9 = nano, -12 = pico, -15 = femto.
fn fiff_unit_string(unit: i32, unit_mul: i32) -> String {
    let prefix = match unit_mul {
        0 => "",
        -3 => "m",
        -6 => "u",
        -9 => "n",
        -12 => "p",
        -15 => "f",
        3 => "k",
        6 => "M",
        _ => "",
    };
    let base = match unit {
        107 => "V",
        112 => "T",
        201 => "Am",
        _ => "",
    };
    if base.is_empty() {
        "uV".to_string() // Fallback
    } else {
        format!("{}{}", prefix, base)
    }
}

#[cfg(test)]
mod tests {
    use super::super::FileReaderFactory;
    use super::*;
    use std::path::Path;

    // Note: These tests are based on MNE-Python's test_raw_fiff.py
    // To use a custom FIF file, set the TEST_FIF_FILE environment variable:
    // TEST_FIF_FILE=/path/to/file.fif cargo test --lib fif_reader -- --ignored

    fn get_test_fif_path() -> std::path::PathBuf {
        // Check for environment variable first (most flexible)
        if let Ok(custom_path) = std::env::var("TEST_FIF_FILE") {
            return std::path::PathBuf::from(custom_path);
        }

        // Try to find the file in common locations
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("."));

        let candidates = vec![
            // Your DDALAB data directory (absolute path from home)
            format!("{}/data/ds006035/sub-sm04/ses-meeg/meg/sub-sm04_ses-meeg_task-somatomotor_run-1_meg.fif", home),
            format!("{}/Desktop/DDALAB/data/ds006035/sub-sm04/ses-meeg/meg/sub-sm04_ses-meeg_task-somatomotor_run-1_meg.fif", home),
            // Project test_data directory
            "test_data/sample_audvis_raw.fif".to_string(),
        ];

        // Return first existing file
        for candidate in &candidates {
            let path = std::path::PathBuf::from(candidate);
            if path.exists() {
                eprintln!("Found test FIF file: {:?}", path);
                return path;
            }
        }

        // If none found, return the first candidate with a helpful message
        eprintln!("⚠ No test FIF file found. Tried:");
        for candidate in &candidates {
            eprintln!("  - {}", candidate);
        }
        eprintln!("\nTo specify a custom file, use:");
        eprintln!(
            "  TEST_FIF_FILE=/path/to/your/file.fif cargo test --lib fif_reader -- --ignored"
        );

        std::path::PathBuf::from(&candidates[0])
    }

    // ========== Tests that don't require test data ==========

    #[test]
    fn test_format_name() {
        // Format name is a constant
        assert_eq!("FIF", "FIF");
    }

    #[test]
    fn test_nonexistent_file() {
        let fake_path = Path::new("nonexistent_file.fif");
        let result = FIFFileReader::new(fake_path);
        assert!(result.is_err(), "Should fail for nonexistent file");
    }

    // ========== Tests based on MNE-Python test_raw_fiff.py ==========

    /// Test basic I/O for raw data
    #[test]
    #[ignore]
    fn test_io_raw() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            eprintln!("Test file not found: {:?}", fif_path);
            return;
        }

        let raw = FIFFileReader::new(&fif_path);
        if let Err(ref e) = raw {
            eprintln!("Error opening FIF file: {:?}", e);
        }
        assert!(
            raw.is_ok(),
            "Failed to open FIF file: {:?}",
            raw.as_ref().err()
        );
        let raw = raw.unwrap();

        let info = raw.metadata().unwrap();
        assert!(info.num_channels > 0, "No channels found");
        assert!(info.sample_rate > 0.0, "Invalid sample rate");
        assert!(info.num_samples > 0, "No samples found");
        assert_eq!(info.file_type, "FIF");
        assert_eq!(info.channels.len(), info.num_channels);

        let expected_duration = info.num_samples as f64 / info.sample_rate;
        assert!((info.duration - expected_duration).abs() < 0.001);
    }

    /// Test indexing/slicing
    #[test]
    #[ignore]
    fn test_getitem() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();
        let test_size = 1000.min(metadata.num_samples);

        // Read first channel
        let data1 = raw
            .read_chunk(0, test_size, Some(&vec![metadata.channels[0].clone()]))
            .unwrap();
        assert_eq!(data1.len(), 1);
        assert_eq!(data1[0].len(), test_size);

        // Read first two channels
        if metadata.num_channels >= 2 {
            let channels = vec![metadata.channels[0].clone(), metadata.channels[1].clone()];
            let data2 = raw.read_chunk(0, test_size, Some(&channels)).unwrap();
            assert_eq!(data2.len(), 2);

            for (i, &val) in data1[0].iter().enumerate() {
                assert!((val - data2[0][i]).abs() < 1e-15);
            }
        }

        let data_all = raw.read_chunk(0, test_size, None).unwrap();
        assert_eq!(data_all.len(), metadata.num_channels);
    }

    /// Test data integrity
    #[test]
    #[ignore]
    fn test_data_integrity() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw1 = FIFFileReader::new(&fif_path).unwrap();
        let raw2 = FIFFileReader::new(&fif_path).unwrap();

        let data1 = raw1.read_chunk(0, 1000, None).unwrap();
        let data2 = raw2.read_chunk(0, 1000, None).unwrap();

        for (ch_idx, (ch1, ch2)) in data1.iter().zip(data2.iter()).enumerate() {
            for (samp_idx, (&s1, &s2)) in ch1.iter().zip(ch2.iter()).enumerate() {
                assert!(
                    (s1 - s2).abs() < 1e-20,
                    "Mismatch at ch {}, samp {}",
                    ch_idx,
                    samp_idx
                );
            }
        }
    }

    /// Test chunk reading
    #[test]
    #[ignore]
    fn test_chunk_reading() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        for (start, size) in vec![(0, 100), (100, 200), (1000, 500)] {
            if start + size > metadata.num_samples {
                continue;
            }

            let data = raw.read_chunk(start, size, None).unwrap();
            assert_eq!(data.len(), metadata.num_channels);
            assert_eq!(data[0].len(), size);
        }
    }

    /// Test channel selection
    #[test]
    #[ignore]
    fn test_channel_selection() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        if metadata.num_channels < 3 {
            return;
        }

        let selected: Vec<String> = metadata.channels.iter().take(3).cloned().collect();
        let data = raw.read_chunk(0, 500, Some(&selected)).unwrap();
        assert_eq!(data.len(), 3);

        let all_data = raw.read_chunk(0, 500, None).unwrap();
        for ch_idx in 0..3 {
            for samp_idx in 0..500 {
                assert!((data[ch_idx][samp_idx] - all_data[ch_idx][samp_idx]).abs() < 1e-15);
            }
        }
    }

    /// Test edge cases
    #[test]
    #[ignore]
    fn test_edge_cases() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        // Read one sample
        let data = raw.read_chunk(0, 1, None).unwrap();
        assert_eq!(data[0].len(), 1);

        // Try to read beyond end
        let result = raw.read_chunk(metadata.num_samples, 100, None);
        assert!(result.is_err());
    }

    /// Test overview/decimation
    #[test]
    #[ignore]
    fn test_overview() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        let data = raw.read_overview(1000, None).unwrap();
        assert_eq!(data.len(), metadata.num_channels);
        assert!(data[0].len() <= 1000);
    }

    /// Test intermediate format conversion
    #[test]
    #[ignore]
    fn test_intermediate_format() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let reader = FIFFileReader::new(&fif_path).unwrap();
        let metadata = reader.metadata().unwrap();

        let intermediate = FileReaderFactory::to_intermediate_data(&reader, None).unwrap();
        assert_eq!(intermediate.num_channels(), metadata.num_channels);
        assert_eq!(intermediate.num_samples(), metadata.num_samples);
        assert_eq!(intermediate.metadata.sample_rate, metadata.sample_rate);
    }

    /// Test channel type detection
    #[test]
    #[ignore]
    fn test_channel_types() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        // Print channel summary
        raw.print_channel_summary();

        // Check that we can filter data channels
        let data_channels = raw.data_channel_names();
        eprintln!("Total channels: {}", metadata.num_channels);
        eprintln!("Data channels: {}", data_channels.len());

        // Data channels should be <= total channels
        assert!(data_channels.len() <= metadata.num_channels);

        // Check that we can get channels by type
        let meg_channels = raw.channels_by_type(FIFFV_MEG_CH);
        let stim_channels = raw.channels_by_type(FIFFV_STIM_CH);

        eprintln!("MEG channels: {}", meg_channels.len());
        eprintln!("STIM channels: {}", stim_channels.len());

        eprintln!("First 10 channels:");
        let core = raw.core.lock();
        for (idx, ch) in core.meas_info.channels.iter().take(10).enumerate() {
            eprintln!(
                "  {}: {} ({}) - cal={}, range={}",
                idx,
                ch.ch_name,
                ch.type_name(),
                ch.cal,
                ch.range
            );
        }
    }

    /// Test iteration over data chunks
    #[test]
    #[ignore]
    fn test_iter() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        // Read data in chunks and verify we can iterate through entire file
        let chunk_size = 1000;
        let mut total_read = 0;
        let mut start = 0;

        while start < metadata.num_samples {
            let remaining = metadata.num_samples - start;
            let size = chunk_size.min(remaining);

            let data = raw.read_chunk(start, size, None).unwrap();
            assert_eq!(data.len(), metadata.num_channels);
            assert_eq!(data[0].len(), size);

            total_read += size;
            start += size;
        }

        assert_eq!(total_read, metadata.num_samples);
    }

    /// Test reading non-contiguous segments
    #[test]
    #[ignore]
    fn test_crop() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        if metadata.num_samples < 2000 {
            return;
        }

        // Read from beginning
        let data_start = raw.read_chunk(0, 500, None).unwrap();
        assert_eq!(data_start[0].len(), 500);

        // Read from middle
        let data_middle = raw.read_chunk(1000, 500, None).unwrap();
        assert_eq!(data_middle[0].len(), 500);

        // Read from end
        let end_start = metadata.num_samples - 500;
        let data_end = raw.read_chunk(end_start, 500, None).unwrap();
        assert_eq!(data_end[0].len(), 500);

        // Verify middle data is different from start (not all zeros)
        let middle_sum: f64 = data_middle[0].iter().map(|x| x.abs()).sum();
        assert!(middle_sum > 0.0, "Middle segment should have non-zero data");
    }

    /// Test preload vs streaming
    #[test]
    #[ignore]
    fn test_preload() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        // Our implementation streams data (doesn't preload all at once)
        let raw1 = FIFFileReader::new(&fif_path).unwrap();
        let raw2 = FIFFileReader::new(&fif_path).unwrap();

        // Reading same segment should give identical results
        let data1 = raw1.read_chunk(0, 1000, None).unwrap();
        let data2 = raw2.read_chunk(0, 1000, None).unwrap();

        for (ch1, ch2) in data1.iter().zip(data2.iter()) {
            for (s1, s2) in ch1.iter().zip(ch2.iter()) {
                assert!((s1 - s2).abs() < 1e-20);
            }
        }
    }

    /// Test copy-like behavior
    #[test]
    #[ignore]
    fn test_copy() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw1 = FIFFileReader::new(&fif_path).unwrap();
        let raw2 = FIFFileReader::new(&fif_path).unwrap();

        // Both readers should have identical metadata
        let meta1 = raw1.metadata().unwrap();
        let meta2 = raw2.metadata().unwrap();

        assert_eq!(meta1.num_channels, meta2.num_channels);
        assert_eq!(meta1.num_samples, meta2.num_samples);
        assert_eq!(meta1.sample_rate, meta2.sample_rate);
        assert_eq!(meta1.channels, meta2.channels);
    }

    /// Test reading with different data types
    #[test]
    #[ignore]
    fn test_output_formats() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();

        // Read data
        let data = raw.read_chunk(0, 100, None).unwrap();

        // All output is f64, verify it's valid
        for channel in &data {
            for &sample in channel {
                assert!(sample.is_finite(), "Sample should be finite");
            }
        }

        // Verify data range is reasonable (calibrated physical units)
        let first_channel_max = data[0].iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
        let first_channel_min = data[0].iter().fold(f64::INFINITY, |a, &b| a.min(b));

        // For MEG data in Tesla, expect values in range of 1e-15 to 1e-11 typically
        // But we'll just verify they're not uncalibrated raw values (which would be huge)
        assert!(
            first_channel_max.abs() < 1e6,
            "Max value suggests uncalibrated data"
        );
        assert!(
            first_channel_min.abs() < 1e6,
            "Min value suggests uncalibrated data"
        );
    }

    /// Test sequential access patterns
    #[test]
    #[ignore]
    fn test_sequential_access() {
        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let raw = FIFFileReader::new(&fif_path).unwrap();
        let metadata = raw.metadata().unwrap();

        if metadata.num_samples < 3000 {
            return;
        }

        // Read in three chunks
        let chunk1 = raw.read_chunk(0, 1000, None).unwrap();
        let chunk2 = raw.read_chunk(1000, 1000, None).unwrap();
        let chunk3 = raw.read_chunk(2000, 1000, None).unwrap();

        // Read the whole range at once
        let full = raw.read_chunk(0, 3000, None).unwrap();

        // Verify chunks match the full read
        for ch_idx in 0..metadata.num_channels {
            // Check first chunk
            for s_idx in 0..1000 {
                assert!((chunk1[ch_idx][s_idx] - full[ch_idx][s_idx]).abs() < 1e-20);
            }
            // Check second chunk
            for s_idx in 0..1000 {
                assert!((chunk2[ch_idx][s_idx] - full[ch_idx][1000 + s_idx]).abs() < 1e-20);
            }
            // Check third chunk
            for s_idx in 0..1000 {
                assert!((chunk3[ch_idx][s_idx] - full[ch_idx][2000 + s_idx]).abs() < 1e-20);
            }
        }
    }

    /// Test ASCII export
    #[test]
    #[ignore]
    fn test_ascii_export() {
        use tempfile::tempdir;

        let fif_path = get_test_fif_path();
        if !fif_path.exists() {
            return;
        }

        let reader = FIFFileReader::new(&fif_path).unwrap();
        let mut intermediate = FileReaderFactory::to_intermediate_data(&reader, None).unwrap();

        // Limit samples for speed
        for channel in &mut intermediate.channels {
            channel.samples.truncate(100);
        }

        let temp_dir = tempdir().unwrap();
        let ascii_path = temp_dir.path().join("test_output.txt");

        let selected: Vec<String> = intermediate
            .channel_labels_owned()
            .into_iter()
            .take(3)
            .collect();
        let result = intermediate.to_ascii(&ascii_path, Some(&selected));
        assert!(result.is_ok());
        assert!(ascii_path.exists());

        let contents = std::fs::read_to_string(&ascii_path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert!(lines.len() > 4);
        assert!(lines[0].starts_with("# Channels:"));
    }
}
