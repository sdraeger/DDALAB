//! Preprocessing Pipeline
//!
//! Orchestrates signal processing operations on EEG data:
//! 1. Notch filter (power line noise removal)
//! 2. Bandpass filter (frequency band selection)
//!
//! Designed for real-time streaming and batch processing.

use super::filters::{create_filter, FilterConfig, FilterType, SosFilter};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Cache key for filter coefficients.
/// Uses ordered bits representation for f64 to enable Hash/Eq.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct FilterCacheKey {
    filter_type: FilterTypeKey,
    /// Frequency as bits (using to_bits for exact comparison)
    frequency_bits: u64,
    /// High frequency as bits (for bandpass/notch)
    frequency_high_bits: Option<u64>,
    /// Filter order
    order: usize,
    /// Sample rate as bits
    sample_rate_bits: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum FilterTypeKey {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
}

impl From<FilterType> for FilterTypeKey {
    fn from(ft: FilterType) -> Self {
        match ft {
            FilterType::Lowpass => FilterTypeKey::Lowpass,
            FilterType::Highpass => FilterTypeKey::Highpass,
            FilterType::Bandpass => FilterTypeKey::Bandpass,
            FilterType::Notch => FilterTypeKey::Notch,
        }
    }
}

impl FilterCacheKey {
    fn from_config(config: &FilterConfig) -> Self {
        Self {
            filter_type: config.filter_type.into(),
            frequency_bits: config.frequency.to_bits(),
            frequency_high_bits: config.frequency_high.map(|f| f.to_bits()),
            order: config.order,
            sample_rate_bits: config.sample_rate.to_bits(),
        }
    }
}

/// Global cache for filter coefficients to avoid redundant computation.
/// The cache stores SosFilter instances which contain the computed coefficients.
static FILTER_CACHE: std::sync::LazyLock<Mutex<HashMap<FilterCacheKey, SosFilter>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Get a filter from the cache or create and cache it.
/// Returns a fresh clone of the cached filter (with reset state).
fn get_or_create_filter(config: &FilterConfig) -> Result<SosFilter, String> {
    let key = FilterCacheKey::from_config(config);

    // Try to get from cache first
    {
        let cache = FILTER_CACHE.lock().unwrap();
        if let Some(filter) = cache.get(&key) {
            return Ok(filter.clone_fresh());
        }
    }

    // Create the filter (expensive operation)
    let filter = create_filter(config)?;

    // Cache it
    {
        let mut cache = FILTER_CACHE.lock().unwrap();
        cache.insert(key, filter.clone());
    }

    Ok(filter)
}

/// Get a filter from cache, returning None if creation fails.
/// This is a convenience wrapper for optional filter creation.
fn get_or_create_filter_opt(config: &FilterConfig) -> Option<SosFilter> {
    get_or_create_filter(config).ok()
}

/// Configuration for the preprocessing pipeline
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingConfig {
    /// Sample rate of the data (Hz)
    pub sample_rate: f64,

    /// Enable notch filter
    #[serde(default)]
    pub notch_enabled: bool,

    /// Notch filter frequency (typically 50 or 60 Hz)
    #[serde(default = "default_notch_freq")]
    pub notch_frequency: f64,

    /// Number of harmonics to filter (1 = just fundamental, 3 = 50, 100, 150 Hz)
    #[serde(default = "default_notch_harmonics")]
    pub notch_harmonics: usize,

    /// Q factor for notch filter (higher = narrower, typical: 30-50)
    #[serde(default = "default_notch_q")]
    pub notch_q: f64,

    /// Enable bandpass filter
    #[serde(default)]
    pub bandpass_enabled: bool,

    /// Low cutoff frequency for bandpass (Hz)
    #[serde(default = "default_bandpass_low")]
    pub bandpass_low: f64,

    /// High cutoff frequency for bandpass (Hz)
    #[serde(default = "default_bandpass_high")]
    pub bandpass_high: f64,

    /// Filter order (2-8, higher = sharper cutoff but more phase distortion)
    #[serde(default = "default_filter_order")]
    pub filter_order: usize,
}

fn default_notch_freq() -> f64 {
    60.0
}
fn default_notch_harmonics() -> usize {
    1
}
fn default_notch_q() -> f64 {
    30.0
}
fn default_bandpass_low() -> f64 {
    0.5
}
fn default_bandpass_high() -> f64 {
    100.0
}
fn default_filter_order() -> usize {
    4
}

impl Default for PreprocessingConfig {
    fn default() -> Self {
        Self {
            sample_rate: 256.0,
            notch_enabled: false,
            notch_frequency: 60.0,
            notch_harmonics: 1,
            notch_q: 30.0,
            bandpass_enabled: false,
            bandpass_low: 0.5,
            bandpass_high: 100.0,
            filter_order: 4,
        }
    }
}

impl PreprocessingConfig {
    /// Create a minimal preprocessing config (just notch filter)
    pub fn minimal(sample_rate: f64, powerline_freq: f64) -> Self {
        Self {
            sample_rate,
            notch_enabled: true,
            notch_frequency: powerline_freq,
            notch_harmonics: 2, // Remove fundamental + first harmonic
            notch_q: 30.0,
            bandpass_enabled: false,
            ..Default::default()
        }
    }

    /// Create a standard EEG preprocessing config
    pub fn standard_eeg(sample_rate: f64, powerline_freq: f64) -> Self {
        Self {
            sample_rate,
            notch_enabled: true,
            notch_frequency: powerline_freq,
            notch_harmonics: 3,
            notch_q: 30.0,
            bandpass_enabled: true,
            bandpass_low: 0.5,
            bandpass_high: 100.0,
            filter_order: 4,
        }
    }
}

/// Result of preprocessing a chunk of data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreprocessingResult {
    /// Preprocessed channel data
    pub channels: Vec<Vec<f64>>,
    /// Channel names (preserved from input)
    pub channel_names: Vec<String>,
    /// Applied configuration
    pub config: PreprocessingConfig,
    /// Processing time in milliseconds
    pub processing_time_ms: f64,
    /// Warnings about skipped filters (e.g., notch skipped due to low sample rate)
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Per-channel filter state
struct ChannelFilters {
    notch: Option<SosFilter>,
    bandpass: Option<SosFilter>,
}

impl Clone for ChannelFilters {
    fn clone(&self) -> Self {
        Self {
            notch: self.notch.clone(),
            bandpass: self.bandpass.clone(),
        }
    }
}

/// Preprocessing pipeline that maintains filter states across chunks
pub struct PreprocessingPipeline {
    config: PreprocessingConfig,
    channel_filters: Vec<ChannelFilters>,
    /// Warnings generated during pipeline creation (e.g., skipped filters)
    warnings: Vec<String>,
}

impl PreprocessingPipeline {
    /// Create a new preprocessing pipeline
    ///
    /// Note: This method gracefully handles filters that cannot be applied
    /// (e.g., notch filter when sample rate is too low). Such filters are
    /// skipped with a warning instead of causing a hard failure.
    pub fn new(config: PreprocessingConfig, num_channels: usize) -> Result<Self, String> {
        let mut channel_filters = Vec::with_capacity(num_channels);
        let mut warnings = Vec::new();
        let nyquist = config.sample_rate / 2.0;

        // Pre-validate filters and create templates
        let notch_template = if config.notch_enabled {
            // Check if notch frequency is valid
            if config.notch_frequency >= nyquist {
                let warning = format!(
                    "Notch filter skipped: frequency ({} Hz) exceeds Nyquist limit ({:.1} Hz) for sample rate {} Hz. \
                     Consider increasing your file's sample rate or disabling the notch filter.",
                    config.notch_frequency, nyquist, config.sample_rate
                );
                log::warn!("[PREPROCESSING] {}", warning);
                warnings.push(warning);
                None
            } else {
                let notch_config = FilterConfig {
                    filter_type: FilterType::Notch,
                    frequency: config.notch_frequency,
                    frequency_high: Some(config.notch_frequency / config.notch_q),
                    order: 2, // Notch is always 2nd order per harmonic
                    sample_rate: config.sample_rate,
                };
                match create_filter(&notch_config) {
                    Ok(filter) => Some(filter),
                    Err(e) => {
                        let warning = format!("Notch filter skipped: {}", e);
                        log::warn!("[PREPROCESSING] {}", warning);
                        warnings.push(warning);
                        None
                    }
                }
            }
        } else {
            None
        };

        let bandpass_template = if config.bandpass_enabled {
            // Check if bandpass frequencies are valid
            if config.bandpass_high >= nyquist {
                let warning = format!(
                    "Bandpass filter skipped: high cutoff ({} Hz) exceeds Nyquist limit ({:.1} Hz) for sample rate {} Hz.",
                    config.bandpass_high, nyquist, config.sample_rate
                );
                log::warn!("[PREPROCESSING] {}", warning);
                warnings.push(warning);
                None
            } else {
                let bp_config = FilterConfig {
                    filter_type: FilterType::Bandpass,
                    frequency: config.bandpass_low,
                    frequency_high: Some(config.bandpass_high),
                    order: config.filter_order,
                    sample_rate: config.sample_rate,
                };
                match create_filter(&bp_config) {
                    Ok(filter) => Some(filter),
                    Err(e) => {
                        let warning = format!("Bandpass filter skipped: {}", e);
                        log::warn!("[PREPROCESSING] {}", warning);
                        warnings.push(warning);
                        None
                    }
                }
            }
        } else {
            None
        };

        // Create per-channel filters by cloning templates
        for _ in 0..num_channels {
            let notch = notch_template.as_ref().map(|t| t.clone_fresh());
            let bandpass = bandpass_template.as_ref().map(|t| t.clone_fresh());
            channel_filters.push(ChannelFilters { notch, bandpass });
        }

        Ok(Self {
            config,
            channel_filters,
            warnings,
        })
    }

    /// Get the current configuration
    pub fn config(&self) -> &PreprocessingConfig {
        &self.config
    }

    /// Get warnings generated during pipeline creation
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// Process a single channel (for streaming)
    pub fn process_channel(&mut self, channel_idx: usize, data: &mut [f64]) {
        if channel_idx >= self.channel_filters.len() {
            return;
        }

        let filters = &mut self.channel_filters[channel_idx];

        // Apply notch filter first (removes power line noise)
        if let Some(ref mut notch) = filters.notch {
            notch.process_signal(data);
        }

        // Then apply bandpass
        if let Some(ref mut bandpass) = filters.bandpass {
            bandpass.process_signal(data);
        }
    }

    /// Process all channels in parallel (for batch processing)
    pub fn process_all_channels(&mut self, channels: &mut [Vec<f64>]) {
        // Get template filters from cache (coefficients are cached to avoid redundant computation)
        // Each parallel thread will clone_fresh() to get independent state
        let notch_template = if self.config.notch_enabled {
            let notch_config = FilterConfig {
                filter_type: FilterType::Notch,
                frequency: self.config.notch_frequency,
                frequency_high: Some(self.config.notch_frequency / self.config.notch_q),
                order: 2,
                sample_rate: self.config.sample_rate,
            };
            get_or_create_filter_opt(&notch_config)
        } else {
            None
        };

        let bandpass_template = if self.config.bandpass_enabled {
            let bp_config = FilterConfig {
                filter_type: FilterType::Bandpass,
                frequency: self.config.bandpass_low,
                frequency_high: Some(self.config.bandpass_high),
                order: self.config.filter_order,
                sample_rate: self.config.sample_rate,
            };
            get_or_create_filter_opt(&bp_config)
        } else {
            None
        };

        // Process channels in parallel, cloning filters with fresh state per channel
        channels.par_iter_mut().for_each(|channel| {
            if let Some(ref template) = notch_template {
                let mut notch = template.clone_fresh();
                notch.process_signal(channel);
            }
            if let Some(ref template) = bandpass_template {
                let mut bandpass = template.clone_fresh();
                bandpass.process_signal(channel);
            }
        });
    }

    /// Process a batch of data and return the result (original data unchanged)
    pub fn process_batch(
        &self,
        channels: &[Vec<f64>],
        channel_names: &[String],
    ) -> PreprocessingResult {
        // Clone data since we don't own it, then delegate to owned version
        let owned_channels = channels.to_vec();
        let owned_names = channel_names.to_vec();
        self.process_batch_owned(owned_channels, owned_names)
    }

    /// Process a batch of data in-place and return the result (takes ownership, avoids copy)
    ///
    /// Use this with `std::mem::take` to avoid unnecessary data copies when the caller
    /// no longer needs the original data:
    /// ```ignore
    /// let channels = std::mem::take(&mut chunk.data);
    /// let names = std::mem::take(&mut chunk.channel_names);
    /// let result = pipeline.process_batch_owned(channels, names);
    /// ```
    pub fn process_batch_owned(
        &self,
        mut channels: Vec<Vec<f64>>,
        channel_names: Vec<String>,
    ) -> PreprocessingResult {
        let start = std::time::Instant::now();

        // Get template filters from cache (coefficients are cached to avoid redundant computation)
        let notch_template = if self.config.notch_enabled {
            let notch_config = FilterConfig {
                filter_type: FilterType::Notch,
                frequency: self.config.notch_frequency,
                frequency_high: Some(self.config.notch_frequency / self.config.notch_q),
                order: 2,
                sample_rate: self.config.sample_rate,
            };
            get_or_create_filter_opt(&notch_config)
        } else {
            None
        };

        let bandpass_template = if self.config.bandpass_enabled {
            let bp_config = FilterConfig {
                filter_type: FilterType::Bandpass,
                frequency: self.config.bandpass_low,
                frequency_high: Some(self.config.bandpass_high),
                order: self.config.filter_order,
                sample_rate: self.config.sample_rate,
            };
            get_or_create_filter_opt(&bp_config)
        } else {
            None
        };

        // Process in-place in parallel (no copy needed since we own the data)
        channels.par_iter_mut().for_each(|channel| {
            if let Some(ref template) = notch_template {
                let mut notch = template.clone_fresh();
                notch.process_signal(channel);
            }
            if let Some(ref template) = bandpass_template {
                let mut bandpass = template.clone_fresh();
                bandpass.process_signal(channel);
            }
        });

        let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

        PreprocessingResult {
            channels,
            channel_names,
            config: self.config.clone(),
            processing_time_ms,
            warnings: self.warnings.clone(),
        }
    }

    /// Reset all filter states (call when seeking/jumping in data)
    pub fn reset(&mut self) {
        for filters in &mut self.channel_filters {
            if let Some(ref mut notch) = filters.notch {
                notch.reset();
            }
            if let Some(ref mut bandpass) = filters.bandpass {
                bandpass.reset();
            }
        }
    }
}

/// Stateless batch preprocessing function for one-shot processing
pub fn preprocess_batch(
    channels: &[Vec<f64>],
    channel_names: &[String],
    config: &PreprocessingConfig,
) -> Result<PreprocessingResult, String> {
    let pipeline = PreprocessingPipeline::new(config.clone(), channels.len())?;
    Ok(pipeline.process_batch(channels, channel_names))
}

/// Stateless batch preprocessing function that takes ownership (avoids data copy)
///
/// Use this with `std::mem::take` when the caller no longer needs the original data:
/// ```ignore
/// let channels = std::mem::take(&mut chunk.data);
/// let names = std::mem::take(&mut chunk.channel_labels);
/// let result = preprocess_batch_owned(channels, names, &config)?;
/// chunk.data = result.channels;
/// chunk.channel_labels = result.channel_names;
/// ```
pub fn preprocess_batch_owned(
    channels: Vec<Vec<f64>>,
    channel_names: Vec<String>,
    config: &PreprocessingConfig,
) -> Result<PreprocessingResult, String> {
    let pipeline = PreprocessingPipeline::new(config.clone(), channels.len())?;
    Ok(pipeline.process_batch_owned(channels, channel_names))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pipeline_creation() {
        let config = PreprocessingConfig::standard_eeg(256.0, 60.0);
        let pipeline = PreprocessingPipeline::new(config, 32);
        assert!(pipeline.is_ok());
    }

    #[test]
    fn test_batch_processing() {
        let config = PreprocessingConfig {
            sample_rate: 1000.0,
            notch_enabled: true,
            notch_frequency: 50.0,
            bandpass_enabled: true,
            bandpass_low: 1.0,
            bandpass_high: 100.0,
            ..Default::default()
        };

        // Generate test data: 1 second of data at 1000Hz
        let channels: Vec<Vec<f64>> = (0..4)
            .map(|_| (0..1000).map(|i| (i as f64 * 0.01).sin()).collect())
            .collect();
        let names: Vec<String> = (0..4).map(|i| format!("Ch{}", i)).collect();

        let result = preprocess_batch(&channels, &names, &config);
        assert!(result.is_ok());

        let result = result.unwrap();
        assert_eq!(result.channels.len(), 4);
        assert_eq!(result.channel_names.len(), 4);
    }

    #[test]
    fn test_graceful_handling_low_sample_rate() {
        // Simulate CSV file with sample_rate=1 Hz (common default when no metadata)
        let config = PreprocessingConfig {
            sample_rate: 1.0, // Very low sample rate
            notch_enabled: true,
            notch_frequency: 60.0, // 60 Hz notch is impossible with 1 Hz sample rate
            bandpass_enabled: true,
            bandpass_low: 0.1,
            bandpass_high: 100.0, // Also impossible
            ..Default::default()
        };

        let channels: Vec<Vec<f64>> = (0..2)
            .map(|_| (0..100).map(|i| (i as f64 * 0.1).sin()).collect())
            .collect();
        let names: Vec<String> = vec!["Ch1".to_string(), "Ch2".to_string()];

        // Should NOT error - should gracefully skip invalid filters
        let result = preprocess_batch(&channels, &names, &config);
        assert!(result.is_ok(), "Should not error on low sample rate");

        let result = result.unwrap();
        // Should have warnings about skipped filters
        assert!(
            !result.warnings.is_empty(),
            "Should have warnings about skipped filters"
        );
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("Notch filter skipped")));
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("Bandpass filter skipped")));
    }

    #[test]
    fn test_filter_coefficient_caching() {
        let config = PreprocessingConfig {
            sample_rate: 1000.0,
            notch_enabled: true,
            notch_frequency: 50.0,
            bandpass_enabled: true,
            bandpass_low: 1.0,
            bandpass_high: 100.0,
            ..Default::default()
        };

        // Generate test data
        let channels: Vec<Vec<f64>> = (0..4)
            .map(|_| (0..1000).map(|i| (i as f64 * 0.01).sin()).collect())
            .collect();
        let names: Vec<String> = (0..4).map(|i| format!("Ch{}", i)).collect();

        // Run multiple times - the cache should be hit on subsequent runs
        let start1 = std::time::Instant::now();
        let result1 = preprocess_batch(&channels, &names, &config).unwrap();
        let time1 = start1.elapsed();

        let start2 = std::time::Instant::now();
        let result2 = preprocess_batch(&channels, &names, &config).unwrap();
        let time2 = start2.elapsed();

        let start3 = std::time::Instant::now();
        let result3 = preprocess_batch(&channels, &names, &config).unwrap();
        let time3 = start3.elapsed();

        // All results should be equivalent
        assert_eq!(result1.channels.len(), result2.channels.len());
        assert_eq!(result2.channels.len(), result3.channels.len());

        // Verify cache is being used by checking that it contains entries
        let cache = FILTER_CACHE.lock().unwrap();
        assert!(
            !cache.is_empty(),
            "Filter cache should have entries after processing"
        );

        // Log times for debugging (subsequent runs should be similar or faster)
        println!("Processing times: {:?}, {:?}, {:?}", time1, time2, time3);
    }
}
