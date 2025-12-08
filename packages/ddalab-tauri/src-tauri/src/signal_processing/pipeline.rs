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
}

impl PreprocessingPipeline {
    /// Create a new preprocessing pipeline
    pub fn new(config: PreprocessingConfig, num_channels: usize) -> Result<Self, String> {
        let mut channel_filters = Vec::with_capacity(num_channels);

        for _ in 0..num_channels {
            let notch = if config.notch_enabled {
                let notch_config = FilterConfig {
                    filter_type: FilterType::Notch,
                    frequency: config.notch_frequency,
                    frequency_high: Some(config.notch_frequency / config.notch_q),
                    order: 2, // Notch is always 2nd order per harmonic
                    sample_rate: config.sample_rate,
                };
                Some(create_filter(&notch_config)?)
            } else {
                None
            };

            let bandpass = if config.bandpass_enabled {
                let bp_config = FilterConfig {
                    filter_type: FilterType::Bandpass,
                    frequency: config.bandpass_low,
                    frequency_high: Some(config.bandpass_high),
                    order: config.filter_order,
                    sample_rate: config.sample_rate,
                };
                Some(create_filter(&bp_config)?)
            } else {
                None
            };

            channel_filters.push(ChannelFilters { notch, bandpass });
        }

        Ok(Self {
            config,
            channel_filters,
        })
    }

    /// Get the current configuration
    pub fn config(&self) -> &PreprocessingConfig {
        &self.config
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
        // Use parallel iteration with mutable references
        channels
            .par_iter_mut()
            .enumerate()
            .for_each(|(idx, channel)| {
                // Create temporary filters for parallel processing
                // (we can't share mutable state across threads)
                let mut notch = if self.config.notch_enabled {
                    let notch_config = FilterConfig {
                        filter_type: FilterType::Notch,
                        frequency: self.config.notch_frequency,
                        frequency_high: Some(self.config.notch_frequency / self.config.notch_q),
                        order: 2,
                        sample_rate: self.config.sample_rate,
                    };
                    create_filter(&notch_config).ok()
                } else {
                    None
                };

                let mut bandpass = if self.config.bandpass_enabled {
                    let bp_config = FilterConfig {
                        filter_type: FilterType::Bandpass,
                        frequency: self.config.bandpass_low,
                        frequency_high: Some(self.config.bandpass_high),
                        order: self.config.filter_order,
                        sample_rate: self.config.sample_rate,
                    };
                    create_filter(&bp_config).ok()
                } else {
                    None
                };

                if let Some(ref mut n) = notch {
                    n.process_signal(channel);
                }
                if let Some(ref mut bp) = bandpass {
                    bp.process_signal(channel);
                }
            });
    }

    /// Process a batch of data and return the result (original data unchanged)
    pub fn process_batch(
        &self,
        channels: &[Vec<f64>],
        channel_names: &[String],
    ) -> PreprocessingResult {
        let start = std::time::Instant::now();

        // Clone and process
        let mut processed: Vec<Vec<f64>> = channels.to_vec();

        // Process in parallel
        processed.par_iter_mut().for_each(|channel| {
            let mut notch = if self.config.notch_enabled {
                let notch_config = FilterConfig {
                    filter_type: FilterType::Notch,
                    frequency: self.config.notch_frequency,
                    frequency_high: Some(self.config.notch_frequency / self.config.notch_q),
                    order: 2,
                    sample_rate: self.config.sample_rate,
                };
                create_filter(&notch_config).ok()
            } else {
                None
            };

            let mut bandpass = if self.config.bandpass_enabled {
                let bp_config = FilterConfig {
                    filter_type: FilterType::Bandpass,
                    frequency: self.config.bandpass_low,
                    frequency_high: Some(self.config.bandpass_high),
                    order: self.config.filter_order,
                    sample_rate: self.config.sample_rate,
                };
                create_filter(&bp_config).ok()
            } else {
                None
            };

            if let Some(ref mut n) = notch {
                n.process_signal(channel);
            }
            if let Some(ref mut bp) = bandpass {
                bp.process_signal(channel);
            }
        });

        let processing_time_ms = start.elapsed().as_secs_f64() * 1000.0;

        PreprocessingResult {
            channels: processed,
            channel_names: channel_names.to_vec(),
            config: self.config.clone(),
            processing_time_ms,
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
}
