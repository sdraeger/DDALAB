//! Lazy File Reader - Window-based access for large files (100GB+)

use super::{FileMetadata, FileReaderError, FileResult};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

/// Configuration for the window cache
#[derive(Debug, Clone)]
pub struct LazyReaderConfig {
    pub max_cached_windows: usize,
    pub max_cache_bytes: usize,
}

impl Default for LazyReaderConfig {
    fn default() -> Self {
        Self {
            max_cached_windows: 10,
            max_cache_bytes: 512 * 1024 * 1024,
        }
    }
}

/// Cache key: file + time range + channels
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct WindowKey {
    pub file_path: String,
    pub start_time_ms: u64,
    pub duration_ms: u64,
    pub channels: Vec<String>,
}

impl Hash for WindowKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.file_path.hash(state);
        self.start_time_ms.hash(state);
        self.duration_ms.hash(state);
        self.channels.hash(state);
    }
}

impl WindowKey {
    pub fn new(file_path: &str, start_sec: f64, duration_sec: f64, channels: &[String]) -> Self {
        let mut sorted_channels = channels.to_vec();
        sorted_channels.sort();
        Self {
            file_path: file_path.to_string(),
            start_time_ms: (start_sec * 1000.0) as u64,
            duration_ms: (duration_sec * 1000.0) as u64,
            channels: sorted_channels,
        }
    }
}

/// Cached data window
#[derive(Debug, Clone)]
pub struct DataWindow {
    pub key: WindowKey,
    pub data: Vec<Vec<f64>>,
    pub channel_labels: Vec<String>,
    pub sample_rate: f64,
    pub start_time_sec: f64,
    pub duration_sec: f64,
    pub num_samples: usize,
    pub size_bytes: usize,
}

impl DataWindow {
    pub fn new(
        key: WindowKey,
        data: Vec<Vec<f64>>,
        channel_labels: Vec<String>,
        sample_rate: f64,
        start_time_sec: f64,
        duration_sec: f64,
    ) -> Self {
        let num_samples = data.first().map(|c| c.len()).unwrap_or(0);
        let size_bytes = data.len() * num_samples * std::mem::size_of::<f64>();
        Self {
            key,
            data,
            channel_labels,
            sample_rate,
            start_time_sec,
            duration_sec,
            num_samples,
            size_bytes,
        }
    }
}

/// Thread-safe LRU cache for data windows
pub struct WindowCache {
    windows: RwLock<HashMap<WindowKey, Arc<DataWindow>>>,
    access_order: RwLock<Vec<WindowKey>>,
    config: LazyReaderConfig,
    current_size_bytes: RwLock<usize>,
}

impl WindowCache {
    pub fn new(config: LazyReaderConfig) -> Self {
        Self {
            windows: RwLock::new(HashMap::new()),
            access_order: RwLock::new(Vec::new()),
            config,
            current_size_bytes: RwLock::new(0),
        }
    }

    pub fn with_defaults() -> Self {
        Self::new(LazyReaderConfig::default())
    }

    pub fn get(&self, key: &WindowKey) -> Option<Arc<DataWindow>> {
        let windows = self.windows.read();
        if let Some(window) = windows.get(key) {
            let mut order = self.access_order.write();
            if let Some(pos) = order.iter().position(|k| k == key) {
                order.remove(pos);
            }
            order.push(key.clone());
            Some(Arc::clone(window))
        } else {
            None
        }
    }

    pub fn insert(&self, window: DataWindow) {
        let key = window.key.clone();
        let size = window.size_bytes;
        self.evict_if_needed(size);

        let mut windows = self.windows.write();
        let mut order = self.access_order.write();
        let mut current_size = self.current_size_bytes.write();

        if let Some(old) = windows.remove(&key) {
            *current_size = current_size.saturating_sub(old.size_bytes);
            if let Some(pos) = order.iter().position(|k| k == &key) {
                order.remove(pos);
            }
        }

        windows.insert(key.clone(), Arc::new(window));
        order.push(key);
        *current_size += size;
    }

    fn evict_if_needed(&self, new_size_bytes: usize) {
        let mut windows = self.windows.write();
        let mut order = self.access_order.write();
        let mut current_size = self.current_size_bytes.write();

        while !order.is_empty()
            && (windows.len() >= self.config.max_cached_windows
                || *current_size + new_size_bytes > self.config.max_cache_bytes)
        {
            let oldest_key = order.remove(0);
            if let Some(removed) = windows.remove(&oldest_key) {
                *current_size = current_size.saturating_sub(removed.size_bytes);
            }
        }
    }

    pub fn clear(&self) {
        self.windows.write().clear();
        self.access_order.write().clear();
        *self.current_size_bytes.write() = 0;
    }

    pub fn stats(&self) -> CacheStats {
        CacheStats {
            num_windows: self.windows.read().len(),
            total_size_bytes: *self.current_size_bytes.read(),
            max_windows: self.config.max_cached_windows,
            max_size_bytes: self.config.max_cache_bytes,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CacheStats {
    pub num_windows: usize,
    pub total_size_bytes: usize,
    pub max_windows: usize,
    pub max_size_bytes: usize,
}

/// Request for a data window
#[derive(Debug, Clone)]
pub struct WindowRequest {
    pub start_time_sec: f64,
    pub duration_sec: f64,
    pub channels: Option<Vec<String>>,
}

impl WindowRequest {
    pub fn new(start_time_sec: f64, duration_sec: f64) -> Self {
        Self {
            start_time_sec,
            duration_sec,
            channels: None,
        }
    }

    pub fn with_channels(mut self, channels: Vec<String>) -> Self {
        self.channels = Some(channels);
        self
    }
}

/// Trait for lazy/windowed file access (100GB+ files)
pub trait LazyFileReader: Send + Sync {
    fn metadata(&self) -> FileResult<FileMetadata>;
    fn read_window(&self, request: &WindowRequest) -> FileResult<DataWindow>;
    fn format_name(&self) -> &str;

    fn read_window_cached(
        &self,
        request: &WindowRequest,
        cache: &WindowCache,
    ) -> FileResult<Arc<DataWindow>> {
        let metadata = self.metadata()?;
        let channels = request
            .channels
            .clone()
            .unwrap_or_else(|| metadata.channels.clone());

        let key = WindowKey::new(
            &metadata.file_path,
            request.start_time_sec,
            request.duration_sec,
            &channels,
        );

        if let Some(window) = cache.get(&key) {
            return Ok(window);
        }

        let window = self.read_window(request)?;
        cache.insert(window.clone());
        Ok(Arc::new(window))
    }
}

// ============================================================================
// LAZY EDF READER
// ============================================================================

use crate::edf::EDFReader as CoreEDFReader;
use parking_lot::Mutex;

/// Lazy reader for EDF files
///
/// This wraps the core EDFReader with lazy loading capabilities,
/// allowing efficient access to very large EDF files.
pub struct LazyEDFReader {
    /// The underlying EDF reader (mutex for interior mutability)
    reader: Mutex<CoreEDFReader>,
    /// File path
    path: String,
    /// Cached metadata
    metadata: FileMetadata,
    /// Channel name to index map for O(1) lookup
    channel_map: HashMap<String, usize>,
}

impl LazyEDFReader {
    /// Open an EDF file for lazy reading
    pub fn open(path: &std::path::Path) -> FileResult<Self> {
        let reader = CoreEDFReader::new(path)
            .map_err(|e| FileReaderError::ParseError(format!("Failed to open EDF: {}", e)))?;

        // Build channel map
        let channel_map: HashMap<String, usize> = reader
            .signal_headers
            .iter()
            .enumerate()
            .map(|(i, sh)| (sh.label.clone(), i))
            .collect();

        // Cache metadata
        let channels: Vec<String> = reader
            .signal_headers
            .iter()
            .map(|sh| sh.label.clone())
            .collect();

        let sample_rate = if !reader.signal_headers.is_empty() {
            reader.signal_headers[0].sample_frequency(reader.header.duration_of_data_record)
        } else {
            0.0
        };

        let num_samples = if !reader.signal_headers.is_empty() {
            reader.header.num_data_records as usize
                * reader.signal_headers[0].num_samples_per_record
        } else {
            0
        };

        let duration =
            reader.header.num_data_records as f64 * reader.header.duration_of_data_record;

        let file_size = std::fs::metadata(path)?.len();

        let start_time =
            super::parse_edf_datetime(&reader.header.start_date, &reader.header.start_time);

        let metadata = FileMetadata {
            file_path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size,
            sample_rate,
            num_channels: channels.len(),
            num_samples,
            duration,
            channels,
            start_time,
            file_type: "EDF".to_string(),
        };

        Ok(Self {
            reader: Mutex::new(reader),
            path: path.to_string_lossy().to_string(),
            metadata,
            channel_map,
        })
    }
}

impl LazyFileReader for LazyEDFReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        Ok(self.metadata.clone())
    }

    fn read_window(&self, request: &WindowRequest) -> FileResult<DataWindow> {
        let mut reader = self.reader.lock();

        // Determine which channels to read
        let channels_to_read: Vec<String> = request
            .channels
            .clone()
            .unwrap_or_else(|| self.metadata.channels.clone());

        let channel_indices: Vec<usize> = channels_to_read
            .iter()
            .filter_map(|ch| self.channel_map.get(ch).copied())
            .collect();

        if channel_indices.is_empty() {
            return Err(FileReaderError::InvalidData(
                "No valid channels specified".to_string(),
            ));
        }

        // Read data for each channel
        let mut data = Vec::with_capacity(channel_indices.len());

        for &ch_idx in &channel_indices {
            let channel_data = reader
                .read_signal_window(ch_idx, request.start_time_sec, request.duration_sec)
                .map_err(|e| {
                    FileReaderError::ParseError(format!("Failed to read channel {}: {}", ch_idx, e))
                })?;
            data.push(channel_data);
        }

        let key = WindowKey::new(
            &self.path,
            request.start_time_sec,
            request.duration_sec,
            &channels_to_read,
        );

        Ok(DataWindow::new(
            key,
            data,
            channels_to_read,
            self.metadata.sample_rate,
            request.start_time_sec,
            request.duration_sec,
        ))
    }

    fn format_name(&self) -> &str {
        "EDF"
    }
}

// ============================================================================
// LAZY CSV/ASCII READER
// ============================================================================

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};

/// Lazy reader for CSV/ASCII files
///
/// Uses line position indexing for efficient random access to large text files.
/// Builds an index of line byte positions on open, then reads only requested windows.
pub struct LazyTextReader {
    path: String,
    metadata: FileMetadata,
    channel_map: HashMap<String, usize>,
    line_positions: Vec<u64>,
    delimiter: Option<char>,
    has_header: bool,
    assumed_sample_rate: f64,
}

impl LazyTextReader {
    /// Open a CSV file for lazy reading
    pub fn open_csv(path: &std::path::Path) -> FileResult<Self> {
        Self::open(path, Some(','))
    }

    /// Open an ASCII/TSV file for lazy reading
    pub fn open_ascii(path: &std::path::Path) -> FileResult<Self> {
        Self::open(path, None)
    }

    fn open(path: &std::path::Path, delimiter: Option<char>) -> FileResult<Self> {
        let file = File::open(path).map_err(FileReaderError::IoError)?;

        let file_size = std::fs::metadata(path)?.len();
        let reader = BufReader::new(file);

        // Index line positions and parse header
        let mut line_positions: Vec<u64> = Vec::new();
        let mut current_pos: u64 = 0;
        let mut first_line: Option<String> = None;
        let mut num_channels = 0;
        let mut has_header = false;

        for (idx, line_result) in reader.lines().enumerate() {
            let line = line_result.map_err(FileReaderError::IoError)?;

            if idx == 0 {
                // Parse first line to determine structure
                let values = Self::parse_line(&line, delimiter)?;
                num_channels = values.len();
                has_header = values.iter().any(|s| s.parse::<f64>().is_err());
                first_line = Some(line.clone());
            }

            let line_len = line.len() as u64 + 1; // +1 for newline

            if idx == 0 && has_header {
                // Skip header line position
                current_pos += line_len;
                continue;
            }

            if !line.trim().is_empty() {
                line_positions.push(current_pos);
            }

            current_pos += line_len;
        }

        if num_channels == 0 {
            return Err(FileReaderError::InvalidData(
                "No channels found in file".to_string(),
            ));
        }

        let num_samples = line_positions.len();

        // Parse channel labels
        let channel_labels: Vec<String> = if has_header {
            if let Some(ref line) = first_line {
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

        // Build channel map
        let channel_map: HashMap<String, usize> = channel_labels
            .iter()
            .enumerate()
            .map(|(i, label)| (label.clone(), i))
            .collect();

        // Assume 1Hz sample rate for text files (can be overridden)
        let assumed_sample_rate = 1.0;
        let duration = num_samples as f64 / assumed_sample_rate;

        let file_type = if delimiter == Some(',') {
            "CSV"
        } else {
            "ASCII"
        };

        let metadata = FileMetadata {
            file_path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size,
            sample_rate: assumed_sample_rate,
            num_channels,
            num_samples,
            duration,
            channels: channel_labels,
            start_time: None,
            file_type: file_type.to_string(),
        };

        Ok(Self {
            path: path.to_string_lossy().to_string(),
            metadata,
            channel_map,
            line_positions,
            delimiter,
            has_header,
            assumed_sample_rate,
        })
    }

    fn parse_line(line: &str, delimiter: Option<char>) -> FileResult<Vec<String>> {
        let values: Vec<String> = match delimiter {
            Some(delim) => line
                .split(delim)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            None => line.split_whitespace().map(|s| s.to_string()).collect(),
        };

        if values.is_empty() {
            return Err(FileReaderError::InvalidData(
                "Empty line or no values found".to_string(),
            ));
        }

        Ok(values)
    }

    /// Set assumed sample rate (for time-based window requests)
    pub fn set_sample_rate(&mut self, sample_rate: f64) {
        self.assumed_sample_rate = sample_rate;
    }
}

impl LazyFileReader for LazyTextReader {
    fn metadata(&self) -> FileResult<FileMetadata> {
        Ok(self.metadata.clone())
    }

    fn read_window(&self, request: &WindowRequest) -> FileResult<DataWindow> {
        let start_sample =
            (request.start_time_sec * self.assumed_sample_rate).floor() as usize;
        let num_samples_requested =
            (request.duration_sec * self.assumed_sample_rate).ceil() as usize;

        let end_sample = (start_sample + num_samples_requested).min(self.line_positions.len());
        let actual_start = start_sample.min(self.line_positions.len().saturating_sub(1));

        if actual_start >= self.line_positions.len() {
            return Err(FileReaderError::InvalidData(
                "Start position beyond file".to_string(),
            ));
        }

        // Determine channels to read
        let channels_to_read: Vec<String> = request
            .channels
            .clone()
            .unwrap_or_else(|| self.metadata.channels.clone());

        let channel_indices: Vec<usize> = channels_to_read
            .iter()
            .filter_map(|ch| self.channel_map.get(ch).copied())
            .collect();

        if channel_indices.is_empty() {
            return Err(FileReaderError::InvalidData(
                "No valid channels specified".to_string(),
            ));
        }

        // Open file with buffered reader
        let file = File::open(&self.path).map_err(FileReaderError::IoError)?;
        let mut reader = BufReader::new(file);

        // Pre-allocate channel data vectors
        let num_samples_to_read = end_sample - actual_start;
        let mut data: Vec<Vec<f64>> = channel_indices
            .iter()
            .map(|_| Vec::with_capacity(num_samples_to_read))
            .collect();

        // Reuse line buffer across iterations
        let mut line = String::new();

        // Read lines in the requested range
        for sample_idx in actual_start..end_sample {
            let line_pos = self.line_positions[sample_idx];
            reader
                .seek(SeekFrom::Start(line_pos))
                .map_err(FileReaderError::IoError)?;

            line.clear();
            reader
                .read_line(&mut line)
                .map_err(FileReaderError::IoError)?;

            let values = Self::parse_line(&line, self.delimiter)?;

            for (data_idx, &ch_idx) in channel_indices.iter().enumerate() {
                if ch_idx < values.len() {
                    let value: f64 = values[ch_idx].parse().unwrap_or(f64::NAN);
                    data[data_idx].push(value);
                } else {
                    data[data_idx].push(f64::NAN);
                }
            }
        }

        let key = WindowKey::new(
            &self.path,
            request.start_time_sec,
            request.duration_sec,
            &channels_to_read,
        );

        Ok(DataWindow::new(
            key,
            data,
            channels_to_read,
            self.assumed_sample_rate,
            request.start_time_sec,
            request.duration_sec,
        ))
    }

    fn format_name(&self) -> &str {
        if self.delimiter == Some(',') {
            "CSV"
        } else {
            "ASCII"
        }
    }
}

// ============================================================================
// LAZY READER FACTORY
// ============================================================================

/// Factory for creating lazy file readers
pub struct LazyReaderFactory;

impl LazyReaderFactory {
    /// Create a lazy reader for the given file path
    pub fn create_reader(path: &std::path::Path) -> FileResult<Box<dyn LazyFileReader>> {
        // Handle .nii.gz files specially
        let path_str = path.to_string_lossy();
        if path_str.ends_with(".nii.gz") {
            return Err(FileReaderError::UnsupportedFormat(
                "NIfTI files don't support lazy reading".to_string(),
            ));
        }

        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        match extension.to_lowercase().as_str() {
            "edf" | "bdf" => Ok(Box::new(LazyEDFReader::open(path)?)),
            "csv" => Ok(Box::new(LazyTextReader::open_csv(path)?)),
            "txt" | "tsv" | "ascii" => Ok(Box::new(LazyTextReader::open_ascii(path)?)),
            _ => Err(FileReaderError::UnsupportedFormat(format!(
                "Lazy reading not supported for extension: {}",
                extension
            ))),
        }
    }

    /// Check if lazy reading is supported for a file
    pub fn supports_lazy_reading(path: &std::path::Path) -> bool {
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        matches!(
            extension.to_lowercase().as_str(),
            "edf" | "bdf" | "csv" | "txt" | "tsv" | "ascii"
        )
    }
}

// ============================================================================
// GLOBAL CACHE (OPTIONAL)
// ============================================================================

use std::sync::OnceLock;

/// Global window cache instance
static GLOBAL_CACHE: OnceLock<WindowCache> = OnceLock::new();

/// Get or initialize the global window cache
pub fn global_cache() -> &'static WindowCache {
    GLOBAL_CACHE.get_or_init(|| WindowCache::with_defaults())
}

/// Initialize the global cache with custom configuration
pub fn init_global_cache(config: LazyReaderConfig) {
    let _ = GLOBAL_CACHE.set(WindowCache::new(config));
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_key_hashing() {
        let key1 = WindowKey::new("test.edf", 0.0, 10.0, &["C1".to_string(), "C2".to_string()]);
        let key2 = WindowKey::new("test.edf", 0.0, 10.0, &["C2".to_string(), "C1".to_string()]);

        // Keys with same channels in different order should be equal
        assert_eq!(key1, key2);
    }

    #[test]
    fn test_cache_eviction() {
        let config = LazyReaderConfig {
            max_cached_windows: 2,
            max_cache_bytes: 1024 * 1024 * 1024, // 1GB (won't limit)
            ..Default::default()
        };

        let cache = WindowCache::new(config);

        // Insert 3 windows, first should be evicted
        for i in 0..3 {
            let key = WindowKey::new("test.edf", i as f64 * 10.0, 10.0, &[]);
            let window = DataWindow::new(
                key,
                vec![vec![0.0; 100]],
                vec!["C1".to_string()],
                100.0,
                i as f64 * 10.0,
                10.0,
            );
            cache.insert(window);
        }

        let stats = cache.stats();
        assert_eq!(stats.num_windows, 2);

        // First window should be evicted
        let key0 = WindowKey::new("test.edf", 0.0, 10.0, &[]);
        assert!(cache.get(&key0).is_none());

        // Last two should still be there
        let key1 = WindowKey::new("test.edf", 10.0, 10.0, &[]);
        let key2 = WindowKey::new("test.edf", 20.0, 10.0, &[]);
        assert!(cache.get(&key1).is_some());
        assert!(cache.get(&key2).is_some());
    }

}
