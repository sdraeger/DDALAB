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
        if !input.is_finite() {
            self.reset();
            return 0.0;
        }

        let output = self.coeffs.b0 * input + self.state.z1;
        self.state.z1 = self.coeffs.b1 * input - self.coeffs.a1 * output + self.state.z2;
        self.state.z2 = self.coeffs.b2 * input - self.coeffs.a2 * output;

        let output_unstable = !output.is_finite();
        let state_unstable = !self.state.z1.is_finite() || !self.state.z2.is_finite();
        if output_unstable || state_unstable {
            self.reset();
            // Fail-safe: preserve original sample if filter diverges.
            return input;
        }

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

    /// Clone this filter with fresh (zeroed) state.
    /// Useful for parallel processing where each channel needs its own filter instance
    /// with the same coefficients but independent state.
    pub fn clone_fresh(&self) -> Self {
        let mut cloned = self.clone();
        cloned.reset();
        cloned
    }
}

/// Butterworth filter designer
pub struct ButterworthFilter;

impl ButterworthFilter {
    /// Design a Butterworth lowpass filter
    pub fn lowpass(cutoff: f64, sample_rate: f64, order: usize) -> SosFilter {
        let (sos, gain) = Self::design_lowpass(cutoff, sample_rate, order);
        SosFilter::new(sos, gain)
    }

    /// Design a Butterworth highpass filter
    pub fn highpass(cutoff: f64, sample_rate: f64, order: usize) -> SosFilter {
        let (sos, gain) = Self::design_highpass(cutoff, sample_rate, order);
        SosFilter::new(sos, gain)
    }

    /// Design a Butterworth bandpass filter
    pub fn bandpass(low: f64, high: f64, sample_rate: f64, order: usize) -> SosFilter {
        let (sos, gain) = Self::design_bandpass(low, high, sample_rate, order);
        SosFilter::new(sos, gain)
    }

    fn butterworth_q(k: usize, order: usize) -> f64 {
        // Butterworth pole-based Q for each biquad stage (k starts at 0).
        let angle = PI * (2.0 * k as f64 + 1.0) / (2.0 * order as f64);
        (1.0 / (2.0 * angle.cos())).max(1e-6)
    }

    fn lowpass_biquad(cutoff: f64, sample_rate: f64, q: f64) -> BiquadCoeffs {
        let w0 = 2.0 * PI * cutoff / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q.max(1e-6));

        let b0 = (1.0 - cos_w0) / 2.0;
        let b1 = 1.0 - cos_w0;
        let b2 = (1.0 - cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        BiquadCoeffs {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    fn highpass_biquad(cutoff: f64, sample_rate: f64, q: f64) -> BiquadCoeffs {
        let w0 = 2.0 * PI * cutoff / sample_rate;
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let alpha = sin_w0 / (2.0 * q.max(1e-6));

        let b0 = (1.0 + cos_w0) / 2.0;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        BiquadCoeffs {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
        }
    }

    fn lowpass_first_order(cutoff: f64, sample_rate: f64) -> BiquadCoeffs {
        let k = (PI * cutoff / sample_rate).tan();
        let norm = 1.0 / (1.0 + k);
        BiquadCoeffs {
            b0: k * norm,
            b1: k * norm,
            b2: 0.0,
            a1: (k - 1.0) * norm,
            a2: 0.0,
        }
    }

    fn highpass_first_order(cutoff: f64, sample_rate: f64) -> BiquadCoeffs {
        let k = (PI * cutoff / sample_rate).tan();
        let norm = 1.0 / (1.0 + k);
        BiquadCoeffs {
            b0: norm,
            b1: -norm,
            b2: 0.0,
            a1: (k - 1.0) * norm,
            a2: 0.0,
        }
    }

    /// Design lowpass second-order sections
    fn design_lowpass(cutoff: f64, sample_rate: f64, order: usize) -> (Vec<BiquadCoeffs>, f64) {
        let order = order.max(1);
        let biquad_count = order / 2;
        let mut sections = Vec::with_capacity((order + 1) / 2);

        for k in 0..biquad_count {
            let q = Self::butterworth_q(k, order);
            sections.push(Self::lowpass_biquad(cutoff, sample_rate, q));
        }

        if order % 2 == 1 {
            sections.push(Self::lowpass_first_order(cutoff, sample_rate));
        }

        (sections, 1.0)
    }

    /// Design highpass second-order sections
    fn design_highpass(cutoff: f64, sample_rate: f64, order: usize) -> (Vec<BiquadCoeffs>, f64) {
        let order = order.max(1);
        let biquad_count = order / 2;
        let mut sections = Vec::with_capacity((order + 1) / 2);

        for k in 0..biquad_count {
            let q = Self::butterworth_q(k, order);
            sections.push(Self::highpass_biquad(cutoff, sample_rate, q));
        }

        if order % 2 == 1 {
            sections.push(Self::highpass_first_order(cutoff, sample_rate));
        }

        (sections, 1.0)
    }

    /// Design bandpass second-order sections
    fn design_bandpass(
        low: f64,
        high: f64,
        sample_rate: f64,
        order: usize,
    ) -> (Vec<BiquadCoeffs>, f64) {
        // Bandpass = cascade of highpass and lowpass
        let (hp_sos, hp_gain) = Self::design_highpass(low, sample_rate, order);
        let (lp_sos, lp_gain) = Self::design_lowpass(high, sample_rate, order);

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

        let mut outputs = Vec::with_capacity(1000);
        for _ in 0..1000 {
            outputs.push(filter.process(1.0));
        }

        assert!(outputs.iter().all(|v| v.is_finite()));
        let steady_state = outputs.last().copied().unwrap_or(0.0);
        assert!((steady_state - 1.0).abs() < 0.02);
    }

    #[test]
    fn test_notch_filter() {
        let sample_rate = 1000.0;
        let notch_freq = 50.0;
        let mut filter = NotchFilter::design(notch_freq, sample_rate, 30.0);
        let warmup_samples = 1000usize;
        let total_samples = 5000usize;

        // Generate a longer 50Hz sine wave so the notch can settle before evaluation.
        let signal: Vec<f64> = (0..total_samples)
            .map(|i| (2.0 * PI * notch_freq * i as f64 / sample_rate).sin())
            .collect();

        let filtered = filter.filter(&signal);

        // Ignore startup transient; assess attenuation on steady-state tail.
        let input_tail = &signal[warmup_samples..];
        let output_tail = &filtered[warmup_samples..];

        let input_rms: f64 =
            (input_tail.iter().map(|x| x * x).sum::<f64>() / input_tail.len() as f64).sqrt();
        let output_rms: f64 =
            (output_tail.iter().map(|x| x * x).sum::<f64>() / output_tail.len() as f64).sqrt();

        assert!(
            output_rms < input_rms * 0.1,
            "Notch filter should attenuate 50Hz after warm-up"
        );
    }

    #[test]
    fn test_filter_guard_handles_non_finite_input() {
        let mut filter = ButterworthFilter::lowpass(10.0, 100.0, 2);
        let out = filter.process(f64::NAN);
        assert!(out.is_finite());
        assert_eq!(out, 0.0);
    }

    #[test]
    fn test_filter_guard_prevents_unstable_blow_up() {
        let unstable = BiquadCoeffs {
            b0: 1.0,
            b1: 1.0,
            b2: 1.0,
            a1: -10.0,
            a2: 10.0,
        };
        let mut filter = SosFilter::new(vec![unstable], 1.0);
        let signal = vec![1.0; 1024];
        let out = filter.filter(&signal);
        assert!(out.iter().all(|v| v.is_finite()));
    }
}
