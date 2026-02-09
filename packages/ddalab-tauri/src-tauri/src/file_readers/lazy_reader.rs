//! Lazy File Reader - Window-based access for large files (100GB+)

use super::{ChannelMetadata, FileMetadata, FileReaderError, FileResult};
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

/// Node in the LRU doubly-linked list (uses indices for O(1) operations)
#[derive(Debug)]
struct LruNode {
    window: Arc<DataWindow>,
    prev: Option<usize>,
    next: Option<usize>,
}

/// O(1) LRU cache using HashMap + index-based doubly-linked list
///
/// This implementation provides O(1) for all operations:
/// - get: O(1) lookup + O(1) move-to-back
/// - insert: O(1) insertion + O(1) eviction
/// - eviction: O(1) removal from front
struct LruCache {
    /// Maps keys to node indices for O(1) lookup
    key_to_index: HashMap<WindowKey, usize>,
    /// Node storage - uses indices for linked list pointers
    nodes: Vec<Option<LruNode>>,
    /// Free list for recycling node slots
    free_indices: Vec<usize>,
    /// Head of the LRU list (oldest/least recently used)
    head: Option<usize>,
    /// Tail of the LRU list (newest/most recently used)
    tail: Option<usize>,
    /// Current total size in bytes
    current_size_bytes: usize,
}

impl LruCache {
    fn new() -> Self {
        Self {
            key_to_index: HashMap::new(),
            nodes: Vec::new(),
            free_indices: Vec::new(),
            head: None,
            tail: None,
            current_size_bytes: 0,
        }
    }

    /// Get a window by key and move it to most-recently-used position - O(1)
    fn get(&mut self, key: &WindowKey) -> Option<Arc<DataWindow>> {
        let &idx = self.key_to_index.get(key)?;
        let window = self.nodes[idx].as_ref()?.window.clone();
        self.move_to_tail(idx);
        Some(window)
    }

    /// Insert or update a window - O(1)
    fn insert(&mut self, window: DataWindow) -> Option<Arc<DataWindow>> {
        let key = window.key.clone();
        let size = window.size_bytes;
        let arc_window = Arc::new(window);

        // Remove existing entry if present
        let old = if let Some(&old_idx) = self.key_to_index.get(&key) {
            let old_window = self.remove_node(old_idx);
            self.key_to_index.remove(&key);
            old_window
        } else {
            None
        };

        // Allocate new node
        let new_idx = self.allocate_node(LruNode {
            window: arc_window,
            prev: None,
            next: None,
        });

        // Add to tail (most recently used)
        self.append_to_tail(new_idx);
        self.key_to_index.insert(key, new_idx);
        self.current_size_bytes += size;

        old
    }

    /// Evict the least recently used entry - O(1)
    fn evict_oldest(&mut self) -> Option<(WindowKey, Arc<DataWindow>)> {
        let head_idx = self.head?;
        let node = self.nodes[head_idx].as_ref()?;
        let key = node.window.key.clone();

        let window = self.remove_node(head_idx)?;
        self.key_to_index.remove(&key);

        Some((key, window))
    }

    fn len(&self) -> usize {
        self.key_to_index.len()
    }

    fn clear(&mut self) {
        self.key_to_index.clear();
        self.nodes.clear();
        self.free_indices.clear();
        self.head = None;
        self.tail = None;
        self.current_size_bytes = 0;
    }

    /// Allocate a node slot, reusing freed slots when available
    fn allocate_node(&mut self, node: LruNode) -> usize {
        if let Some(idx) = self.free_indices.pop() {
            self.nodes[idx] = Some(node);
            idx
        } else {
            let idx = self.nodes.len();
            self.nodes.push(Some(node));
            idx
        }
    }

    /// Remove a node and return its window, freeing the slot for reuse
    fn remove_node(&mut self, idx: usize) -> Option<Arc<DataWindow>> {
        let node = self.nodes[idx].take()?;
        let size = node.window.size_bytes;

        // Update linked list pointers
        match (node.prev, node.next) {
            (Some(prev), Some(next)) => {
                // Middle node
                if let Some(ref mut prev_node) = self.nodes[prev] {
                    prev_node.next = Some(next);
                }
                if let Some(ref mut next_node) = self.nodes[next] {
                    next_node.prev = Some(prev);
                }
            }
            (Some(prev), None) => {
                // Tail node
                if let Some(ref mut prev_node) = self.nodes[prev] {
                    prev_node.next = None;
                }
                self.tail = Some(prev);
            }
            (None, Some(next)) => {
                // Head node
                if let Some(ref mut next_node) = self.nodes[next] {
                    next_node.prev = None;
                }
                self.head = Some(next);
            }
            (None, None) => {
                // Only node
                self.head = None;
                self.tail = None;
            }
        }

        self.free_indices.push(idx);
        self.current_size_bytes = self.current_size_bytes.saturating_sub(size);

        Some(node.window)
    }

    /// Move an existing node to the tail (most recently used) - O(1)
    fn move_to_tail(&mut self, idx: usize) {
        if self.tail == Some(idx) {
            return; // Already at tail
        }

        let node = match self.nodes[idx].as_ref() {
            Some(n) => n,
            None => return,
        };

        let prev = node.prev;
        let next = node.next;

        // Unlink from current position
        if let Some(prev_idx) = prev {
            if let Some(ref mut prev_node) = self.nodes[prev_idx] {
                prev_node.next = next;
            }
        } else {
            self.head = next;
        }

        if let Some(next_idx) = next {
            if let Some(ref mut next_node) = self.nodes[next_idx] {
                next_node.prev = prev;
            }
        }

        // Append to tail
        if let Some(tail_idx) = self.tail {
            if let Some(ref mut tail_node) = self.nodes[tail_idx] {
                tail_node.next = Some(idx);
            }
        }

        if let Some(ref mut node) = self.nodes[idx] {
            node.prev = self.tail;
            node.next = None;
        }

        self.tail = Some(idx);

        if self.head.is_none() {
            self.head = Some(idx);
        }
    }

    /// Append a new node to the tail - O(1)
    fn append_to_tail(&mut self, idx: usize) {
        if let Some(tail_idx) = self.tail {
            if let Some(ref mut tail_node) = self.nodes[tail_idx] {
                tail_node.next = Some(idx);
            }
            if let Some(ref mut node) = self.nodes[idx] {
                node.prev = Some(tail_idx);
                node.next = None;
            }
        } else {
            // First node
            self.head = Some(idx);
        }
        self.tail = Some(idx);
    }
}

/// Thread-safe LRU cache for data windows with O(1) operations
pub struct WindowCache {
    cache: RwLock<LruCache>,
    config: LazyReaderConfig,
}

impl WindowCache {
    pub fn new(config: LazyReaderConfig) -> Self {
        Self {
            cache: RwLock::new(LruCache::new()),
            config,
        }
    }

    pub fn with_defaults() -> Self {
        Self::new(LazyReaderConfig::default())
    }

    /// Get a cached window by key - O(1)
    pub fn get(&self, key: &WindowKey) -> Option<Arc<DataWindow>> {
        self.cache.write().get(key)
    }

    /// Insert a window into the cache - O(1)
    pub fn insert(&self, window: DataWindow) {
        let size = window.size_bytes;

        let mut cache = self.cache.write();

        // Evict entries if needed (O(1) per eviction)
        while cache.len() >= self.config.max_cached_windows
            || cache.current_size_bytes + size > self.config.max_cache_bytes
        {
            if cache.evict_oldest().is_none() {
                break;
            }
        }

        cache.insert(window);
    }

    pub fn clear(&self) {
        self.cache.write().clear();
    }

    pub fn stats(&self) -> CacheStats {
        let cache = self.cache.read();
        CacheStats {
            num_windows: cache.len(),
            total_size_bytes: cache.current_size_bytes,
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

    /// Get a reference to cached metadata without cloning (optional optimization)
    ///
    /// Returns `None` by default. Readers that cache their metadata should override
    /// this to return a reference, avoiding allocation on each call.
    fn metadata_ref(&self) -> Option<&FileMetadata> {
        None
    }

    fn read_window_cached(
        &self,
        request: &WindowRequest,
        cache: &WindowCache,
    ) -> FileResult<Arc<DataWindow>> {
        // Use metadata_ref to avoid cloning when possible
        let owned_metadata;
        let metadata: &FileMetadata = if let Some(meta_ref) = self.metadata_ref() {
            meta_ref
        } else {
            owned_metadata = self.metadata()?;
            &owned_metadata
        };

        // Use Cow to avoid cloning channels when reading all channels
        let channels: std::borrow::Cow<'_, [String]> = match &request.channels {
            Some(ch) => std::borrow::Cow::Borrowed(ch),
            None => std::borrow::Cow::Borrowed(&metadata.channels),
        };

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

        let num_ch = channels.len();
        let ch_metadata = super::channel_classifier::classify_channel_labels(&channels);
        let metadata = FileMetadata {
            file_path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string(),
            file_size,
            sample_rate,
            num_channels: num_ch,
            num_samples,
            duration,
            channel_metadata: ch_metadata,
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

    fn metadata_ref(&self) -> Option<&FileMetadata> {
        Some(&self.metadata)
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

        let ch_metadata = super::channel_classifier::classify_channel_labels(&channel_labels);
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
            channel_metadata: ch_metadata,
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

    fn metadata_ref(&self) -> Option<&FileMetadata> {
        Some(&self.metadata)
    }

    fn read_window(&self, request: &WindowRequest) -> FileResult<DataWindow> {
        let start_sample = (request.start_time_sec * self.assumed_sample_rate).floor() as usize;
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
