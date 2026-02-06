//! Signal Processing Module
//!
//! Provides digital signal processing filters for EEG/neurophysiology data:
//! - Butterworth bandpass/highpass/lowpass filters
//! - Notch filters for power line noise removal (50/60 Hz)
//!
//! All filters use second-order sections (biquads) for numerical stability.

mod filters;
mod pipeline;

pub use filters::{
    BiquadFilter, ButterworthFilter, FilterConfig, FilterType, NotchFilter, SosFilter,
};
pub use pipeline::{
    preprocess_batch, preprocess_batch_owned, PreprocessingConfig, PreprocessingPipeline,
    PreprocessingResult,
};
