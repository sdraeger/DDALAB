// Time-based sliding window buffer for real-time streaming
//
// Maintains a fixed time window of data with automatic expiration and downsampling
// to ensure scalable real-time performance regardless of sampling rate.

use crate::streaming::processor::StreamingDDAResult;
use crate::streaming::source::DataChunk;
use parking_lot::RwLock;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

/// Configuration for time-based windowing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeWindowConfig {
    /// Maximum time window to keep in seconds
    pub window_seconds: f64,

    /// Maximum number of points to downsample to for display
    pub max_display_points: usize,

    /// Minimum interval between samples when downsampling (seconds)
    pub min_sample_interval: f64,
}

impl Default for TimeWindowConfig {
    fn default() -> Self {
        Self {
            window_seconds: 30.0,       // Keep last 30 seconds
            max_display_points: 2000,   // Max 2000 points for plotting
            min_sample_interval: 0.001, // 1ms minimum interval
        }
    }
}

/// Entry with timestamp for automatic expiration
#[derive(Debug, Clone)]
struct TimestampedChunk {
    chunk: DataChunk,
    timestamp: f64,
}

/// Time-based sliding window buffer
pub struct TimeWindowBuffer {
    data: Arc<RwLock<VecDeque<TimestampedChunk>>>,
    results: Arc<RwLock<VecDeque<(StreamingDDAResult, f64)>>>,
    config: TimeWindowConfig,
}

impl TimeWindowBuffer {
    pub fn new(config: TimeWindowConfig) -> Self {
        Self {
            data: Arc::new(RwLock::new(VecDeque::new())),
            results: Arc::new(RwLock::new(VecDeque::new())),
            config,
        }
    }

    /// Get current timestamp in seconds
    fn now() -> f64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
    }

    /// Push a data chunk with automatic timestamp
    pub fn push_data(&self, chunk: DataChunk) {
        let now = Self::now();
        let cutoff = now - self.config.window_seconds;

        let mut data = self.data.write();

        // Add new chunk
        data.push_back(TimestampedChunk {
            chunk,
            timestamp: now,
        });

        // Remove expired data
        while let Some(front) = data.front() {
            if front.timestamp < cutoff {
                data.pop_front();
            } else {
                break;
            }
        }
    }

    /// Push a DDA result with automatic timestamp
    pub fn push_result(&self, result: StreamingDDAResult) {
        let now = Self::now();
        let cutoff = now - self.config.window_seconds;

        let mut results = self.results.write();

        // Add new result
        results.push_back((result, now));

        // Remove expired results
        while let Some((_, timestamp)) = results.front() {
            if *timestamp < cutoff {
                results.pop_front();
            } else {
                break;
            }
        }
    }

    /// Get recent data chunks with optional downsampling
    pub fn get_data(&self, max_count: Option<usize>) -> Vec<DataChunk> {
        let data = self.data.read();

        let limit = max_count.unwrap_or(data.len()).min(data.len());

        if limit == 0 {
            return Vec::new();
        }

        // If we have more data than requested, take evenly spaced samples (decimation)
        if data.len() > limit {
            let step = data.len() as f64 / limit as f64;
            (0..limit)
                .into_par_iter()
                .map(|i| {
                    let idx = (i as f64 * step) as usize;
                    data[idx].chunk.clone()
                })
                .collect()
        } else {
            // Return all data
            data.par_iter().map(|tc| tc.chunk.clone()).collect()
        }
    }

    /// Get recent DDA results with optional limit
    pub fn get_results(&self, max_count: Option<usize>) -> Vec<StreamingDDAResult> {
        let results = self.results.read();

        let limit = max_count.unwrap_or(results.len()).min(results.len());

        if limit == 0 {
            return Vec::new();
        }

        // Take most recent results
        results
            .par_iter()
            .rev()
            .take(limit)
            .map(|(r, _)| r.clone())
            .collect::<Vec<_>>()
            .into_par_iter()
            .rev()
            .collect()
    }

    /// Get downsampled data for efficient display
    /// Returns at most max_display_points, intelligently sampled
    pub fn get_display_data(&self) -> Vec<DataChunk> {
        self.get_data(Some(self.config.max_display_points))
    }

    /// Get current buffer statistics
    pub fn get_stats(&self) -> TimeWindowStats {
        let data = self.data.read();
        let results = self.results.read();

        let now = Self::now();
        let oldest_data_age = data.front().map(|tc| now - tc.timestamp).unwrap_or(0.0);
        let newest_data_age = data.back().map(|tc| now - tc.timestamp).unwrap_or(0.0);

        TimeWindowStats {
            data_chunks_stored: data.len(),
            results_stored: results.len(),
            oldest_data_age_seconds: oldest_data_age,
            newest_data_age_seconds: newest_data_age,
            window_seconds: self.config.window_seconds,
        }
    }

    /// Clear all buffered data
    pub fn clear(&self) {
        self.data.write().clear();
        self.results.write().clear();
    }

    /// Update configuration
    pub fn update_config(&mut self, config: TimeWindowConfig) {
        self.config = config;
    }
}

/// Statistics about the time window buffer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeWindowStats {
    pub data_chunks_stored: usize,
    pub results_stored: usize,
    pub oldest_data_age_seconds: f64,
    pub newest_data_age_seconds: f64,
    pub window_seconds: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_chunk(sample_count: usize) -> DataChunk {
        DataChunk {
            samples: vec![vec![0.0; sample_count]],
            sequence: Some(0),
            channel_names: vec!["test".to_string()],
            sample_rate: 1000.0,
            timestamp: 0.0,
        }
    }

    #[test]
    fn test_time_window_expiration() {
        let config = TimeWindowConfig {
            window_seconds: 1.0, // 1 second window
            max_display_points: 100,
            min_sample_interval: 0.001,
        };

        let buffer = TimeWindowBuffer::new(config);

        // Add some chunks
        buffer.push_data(create_test_chunk(100));
        std::thread::sleep(std::time::Duration::from_millis(500));
        buffer.push_data(create_test_chunk(100));

        // Should have 2 chunks
        assert_eq!(buffer.get_data(None).len(), 2);

        // Wait for expiration
        std::thread::sleep(std::time::Duration::from_millis(600));
        buffer.push_data(create_test_chunk(100)); // Trigger cleanup

        // Oldest chunk should be expired, now have 2 chunks
        let data = buffer.get_data(None);
        assert!(data.len() <= 2);
    }

    #[test]
    fn test_downsampling() {
        let config = TimeWindowConfig {
            window_seconds: 60.0,
            max_display_points: 10,
            min_sample_interval: 0.001,
        };

        let buffer = TimeWindowBuffer::new(config);

        // Add 100 chunks
        for _ in 0..100 {
            buffer.push_data(create_test_chunk(100));
        }

        // Request downsampled data
        let display_data = buffer.get_display_data();

        // Should get at most max_display_points
        assert!(display_data.len() <= 10);
    }
}
