//! Digital Filter Implementations
//!
//! Implements IIR filters using second-order sections (biquads) for numerical stability.
//! Supports Butterworth bandpass/highpass/lowpass and notch filters.

use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

/// Filter type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterType {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
}

/// Configuration for a filter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterConfig {
    pub filter_type: FilterType,
    /// Cutoff frequency in Hz (for lowpass/highpass) or center frequency (for notch)
    pub frequency: f64,
    /// High cutoff for bandpass, or bandwidth for notch (Q factor = center/bandwidth)
    pub frequency_high: Option<f64>,
    /// Filter order (typically 2-8 for Butterworth)
    pub order: usize,
    /// Sampling rate in Hz
    pub sample_rate: f64,
}

/// Second-order section (biquad) coefficients
/// Transfer function: H(z) = (b0 + b1*z^-1 + b2*z^-2) / (1 + a1*z^-1 + a2*z^-2)
#[derive(Debug, Clone, Copy)]
pub struct BiquadCoeffs {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
}

/// State for a single biquad section (Direct Form II Transposed)
#[derive(Debug, Clone)]
pub struct BiquadState {
    z1: f64,
    z2: f64,
}

impl Default for BiquadState {
    fn default() -> Self {
        Self { z1: 0.0, z2: 0.0 }
    }
}

/// Single biquad filter section
#[derive(Debug, Clone)]
pub struct BiquadFilter {
    coeffs: BiquadCoeffs,
    state: BiquadState,
}

impl BiquadFilter {
    pub fn new(coeffs: BiquadCoeffs) -> Self {
        Self {
            coeffs,
            state: BiquadState::default(),
        }
    }

    /// Process a single sample using Direct Form II Transposed
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let output = self.coeffs.b0 * input + self.state.z1;
        self.state.z1 = self.coeffs.b1 * input - self.coeffs.a1 * output + self.state.z2;
        self.state.z2 = self.coeffs.b2 * input - self.coeffs.a2 * output;
        output
    }

    /// Reset filter state
    pub fn reset(&mut self) {
        self.state = BiquadState::default();
    }
}

/// Cascaded second-order sections filter
#[derive(Debug, Clone)]
pub struct SosFilter {
    sections: Vec<BiquadFilter>,
    gain: f64,
}

impl SosFilter {
    pub fn new(sections: Vec<BiquadCoeffs>, gain: f64) -> Self {
        Self {
            sections: sections.into_iter().map(BiquadFilter::new).collect(),
            gain,
        }
    }

    /// Process a single sample through all sections
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let mut output = input * self.gain;
        for section in &mut self.sections {
            output = section.process(output);
        }
        output
    }

    /// Process an entire signal array in-place
    pub fn process_signal(&mut self, signal: &mut [f64]) {
        for sample in signal.iter_mut() {
            *sample = self.process(*sample);
        }
    }

    /// Process a signal and return a new array (original unchanged)
    pub fn filter(&mut self, signal: &[f64]) -> Vec<f64> {
        signal.iter().map(|&s| self.process(s)).collect()
    }

    /// Reset all section states
    pub fn reset(&mut self) {
        for section in &mut self.sections {
            section.reset();
        }
    }
}

/// Butterworth filter designer
pub struct ButterworthFilter;

impl ButterworthFilter {
    /// Design a Butterworth lowpass filter
    pub fn lowpass(cutoff: f64, sample_rate: f64, order: usize) -> SosFilter {
        let wn = Self::prewarp(cutoff, sample_rate);
        let (sos, gain) = Self::design_lowpass(wn, order);
        SosFilter::new(sos, gain)
    }

    /// Design a Butterworth highpass filter
    pub fn highpass(cutoff: f64, sample_rate: f64, order: usize) -> SosFilter {
        let wn = Self::prewarp(cutoff, sample_rate);
        let (sos, gain) = Self::design_highpass(wn, order);
        SosFilter::new(sos, gain)
    }

    /// Design a Butterworth bandpass filter
    pub fn bandpass(low: f64, high: f64, sample_rate: f64, order: usize) -> SosFilter {
        let wn_low = Self::prewarp(low, sample_rate);
        let wn_high = Self::prewarp(high, sample_rate);
        let (sos, gain) = Self::design_bandpass(wn_low, wn_high, order);
        SosFilter::new(sos, gain)
    }

    /// Prewarp frequency for bilinear transform
    fn prewarp(freq: f64, sample_rate: f64) -> f64 {
        (PI * freq / sample_rate).tan()
    }

    /// Design lowpass second-order sections
    fn design_lowpass(wn: f64, order: usize) -> (Vec<BiquadCoeffs>, f64) {
        let num_sections = (order + 1) / 2;
        let mut sections = Vec::with_capacity(num_sections);
        let mut total_gain = 1.0;

        for k in 0..num_sections {
            let theta = PI * (2.0 * k as f64 + 1.0) / (2.0 * order as f64);
            let alpha = -2.0 * theta.cos();

            // For odd order, last section is first-order
            if order % 2 == 1 && k == num_sections - 1 {
                // First-order section: H(s) = wn / (s + wn)
                let k_coeff = wn / (1.0 + wn);
                sections.push(BiquadCoeffs {
                    b0: k_coeff,
                    b1: k_coeff,
                    b2: 0.0,
                    a1: (wn - 1.0) / (wn + 1.0),
                    a2: 0.0,
                });
                total_gain *= 1.0;
            } else {
                // Second-order section via bilinear transform
                let wn2 = wn * wn;
                let denom = 1.0 + alpha * wn + wn2;

                let b0 = wn2 / denom;
                let b1 = 2.0 * wn2 / denom;
                let b2 = wn2 / denom;
                let a1 = 2.0 * (wn2 - 1.0) / denom;
                let a2 = (1.0 - alpha * wn + wn2) / denom;

                sections.push(BiquadCoeffs { b0, b1, b2, a1, a2 });
            }
        }

        (sections, total_gain)
    }

    /// Design highpass second-order sections
    fn design_highpass(wn: f64, order: usize) -> (Vec<BiquadCoeffs>, f64) {
        let num_sections = (order + 1) / 2;
        let mut sections = Vec::with_capacity(num_sections);
        let mut total_gain = 1.0;

        for k in 0..num_sections {
            let theta = PI * (2.0 * k as f64 + 1.0) / (2.0 * order as f64);
            let alpha = -2.0 * theta.cos();

            if order % 2 == 1 && k == num_sections - 1 {
                // First-order highpass
                let k_coeff = 1.0 / (1.0 + wn);
                sections.push(BiquadCoeffs {
                    b0: k_coeff,
                    b1: -k_coeff,
                    b2: 0.0,
                    a1: (wn - 1.0) / (wn + 1.0),
                    a2: 0.0,
                });
            } else {
                let wn2 = wn * wn;
                let denom = 1.0 + alpha * wn + wn2;

                let b0 = 1.0 / denom;
                let b1 = -2.0 / denom;
                let b2 = 1.0 / denom;
                let a1 = 2.0 * (wn2 - 1.0) / denom;
                let a2 = (1.0 - alpha * wn + wn2) / denom;

                sections.push(BiquadCoeffs { b0, b1, b2, a1, a2 });
            }
        }

        (sections, total_gain)
    }

    /// Design bandpass second-order sections
    fn design_bandpass(wn_low: f64, wn_high: f64, order: usize) -> (Vec<BiquadCoeffs>, f64) {
        // Bandpass = cascade of highpass and lowpass
        let (hp_sos, hp_gain) = Self::design_highpass(wn_low, order);
        let (lp_sos, lp_gain) = Self::design_lowpass(wn_high, order);

        let mut sections = hp_sos;
        sections.extend(lp_sos);

        (sections, hp_gain * lp_gain)
    }
}

/// Notch (band-reject) filter for removing specific frequencies
pub struct NotchFilter;

impl NotchFilter {
    /// Design a notch filter to remove a specific frequency
    ///
    /// # Arguments
    /// * `center_freq` - Frequency to remove (Hz)
    /// * `sample_rate` - Sampling rate (Hz)
    /// * `q_factor` - Quality factor (higher = narrower notch, typical: 30-50)
    pub fn design(center_freq: f64, sample_rate: f64, q_factor: f64) -> SosFilter {
        let w0 = 2.0 * PI * center_freq / sample_rate;
        let bandwidth = w0 / q_factor;

        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 * (bandwidth / 2.0).sinh();

        let b0 = 1.0;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        // Normalize by a0
        let coeffs = BiquadCoeffs {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        };

        SosFilter::new(vec![coeffs], 1.0)
    }

    /// Design a notch filter with harmonics (e.g., 50Hz + 100Hz + 150Hz)
    pub fn design_with_harmonics(
        fundamental: f64,
        sample_rate: f64,
        q_factor: f64,
        num_harmonics: usize,
    ) -> SosFilter {
        let nyquist = sample_rate / 2.0;
        let mut all_coeffs = Vec::new();

        for h in 1..=num_harmonics {
            let freq = fundamental * h as f64;
            if freq < nyquist {
                let filter = Self::design(freq, sample_rate, q_factor);
                all_coeffs.extend(filter.sections.iter().map(|s| s.coeffs).collect::<Vec<_>>());
            }
        }

        SosFilter::new(all_coeffs, 1.0)
    }
}

/// Create a filter from configuration
pub fn create_filter(config: &FilterConfig) -> Result<SosFilter, String> {
    let nyquist = config.sample_rate / 2.0;

    match config.filter_type {
        FilterType::Lowpass => {
            if config.frequency >= nyquist {
                return Err(format!(
                    "Cutoff frequency ({} Hz) must be less than Nyquist ({} Hz)",
                    config.frequency, nyquist
                ));
            }
            Ok(ButterworthFilter::lowpass(
                config.frequency,
                config.sample_rate,
                config.order,
            ))
        }
        FilterType::Highpass => {
            if config.frequency >= nyquist {
                return Err(format!(
                    "Cutoff frequency ({} Hz) must be less than Nyquist ({} Hz)",
                    config.frequency, nyquist
                ));
            }
            Ok(ButterworthFilter::highpass(
                config.frequency,
                config.sample_rate,
                config.order,
            ))
        }
        FilterType::Bandpass => {
            let high = config
                .frequency_high
                .ok_or("Bandpass filter requires frequency_high")?;
            if config.frequency >= high {
                return Err("Low cutoff must be less than high cutoff".to_string());
            }
            if high >= nyquist {
                return Err(format!(
                    "High cutoff ({} Hz) must be less than Nyquist ({} Hz)",
                    high, nyquist
                ));
            }
            Ok(ButterworthFilter::bandpass(
                config.frequency,
                high,
                config.sample_rate,
                config.order,
            ))
        }
        FilterType::Notch => {
            if config.frequency >= nyquist {
                return Err(format!(
                    "Notch frequency ({} Hz) must be less than Nyquist ({} Hz)",
                    config.frequency, nyquist
                ));
            }
            // Q factor from bandwidth if provided, otherwise default to 30
            let q = config
                .frequency_high
                .map(|bw| config.frequency / bw)
                .unwrap_or(30.0);
            Ok(NotchFilter::design(config.frequency, config.sample_rate, q))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lowpass_filter() {
        let mut filter = ButterworthFilter::lowpass(10.0, 100.0, 2);

        // DC should pass through
        for _ in 0..100 {
            let out = filter.process(1.0);
            assert!((out - 1.0).abs() < 0.01 || out > 0.9);
        }
    }

    #[test]
    fn test_notch_filter() {
        let sample_rate = 1000.0;
        let notch_freq = 50.0;
        let mut filter = NotchFilter::design(notch_freq, sample_rate, 30.0);

        // Generate 50Hz sine wave
        let signal: Vec<f64> = (0..1000)
            .map(|i| (2.0 * PI * notch_freq * i as f64 / sample_rate).sin())
            .collect();

        let filtered = filter.filter(&signal);

        // RMS of filtered signal should be much smaller
        let input_rms: f64 =
            (signal.iter().map(|x| x * x).sum::<f64>() / signal.len() as f64).sqrt();
        let output_rms: f64 =
            (filtered.iter().map(|x| x * x).sum::<f64>() / filtered.len() as f64).sqrt();

        assert!(
            output_rms < input_rms * 0.1,
            "Notch filter should attenuate 50Hz"
        );
    }
}
