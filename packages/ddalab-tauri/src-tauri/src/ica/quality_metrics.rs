/// Quality metrics for ICA components
use rayon::prelude::*;

/// Minimum data length to use parallel processing (overhead not worth it for small data)
const PAR_THRESHOLD: usize = 10_000;

/// Combined quality metrics result from single-pass computation
#[derive(Debug, Clone, Copy)]
pub struct CombinedMetrics {
    pub kurtosis: f64,
    pub non_gaussianity: f64,
}

pub struct QualityMetrics;

impl QualityMetrics {
    /// Compute kurtosis and non-Gaussianity in a single pass over the data.
    /// This is significantly more efficient than calling kurtosis() and non_gaussianity()
    /// separately, as it avoids redundant mean/variance calculations and multiple data traversals.
    ///
    /// Uses a two-pass approach:
    /// - Pass 1: Compute mean
    /// - Pass 2: Compute variance (m2), kurtosis (m4), and log-cosh expectation simultaneously
    pub fn compute_combined(data: &[f64]) -> CombinedMetrics {
        if data.len() < 4 {
            return CombinedMetrics {
                kurtosis: 0.0,
                non_gaussianity: 0.0,
            };
        }

        let n = data.len() as f64;
        let use_parallel = data.len() >= PAR_THRESHOLD;

        // Pass 1: Compute mean
        let mean = if use_parallel {
            data.par_iter().sum::<f64>() / n
        } else {
            data.iter().sum::<f64>() / n
        };

        // Pass 2: Compute m2 and m4 in a single iteration
        // Note: We cannot compute the standardized log-cosh in this pass because
        // we need std (derived from m2) to standardize the values. The log-cosh
        // of non-standardized values cannot be mathematically transformed to
        // log-cosh of standardized values (log(cosh(x/s)) != log(cosh(x))/s).
        let (m2, m4) = if use_parallel {
            data.par_iter()
                .map(|&x| {
                    let dev = x - mean;
                    let dev2 = dev * dev;
                    let dev4 = dev2 * dev2;
                    (dev2, dev4)
                })
                .reduce(|| (0.0, 0.0), |(a2, a4), (b2, b4)| (a2 + b2, a4 + b4))
        } else {
            data.iter().fold((0.0, 0.0), |(m2, m4), &x| {
                let dev = x - mean;
                let dev2 = dev * dev;
                let dev4 = dev2 * dev2;
                (m2 + dev2, m4 + dev4)
            })
        };

        let m2 = m2 / n;
        let m4 = m4 / n;

        // Handle near-zero variance case
        if m2 < 1e-10 {
            return CombinedMetrics {
                kurtosis: 0.0,
                non_gaussianity: 0.0,
            };
        }

        // Compute kurtosis (excess kurtosis, subtract 3 for Gaussian baseline)
        let kurtosis = m4 / m2.powi(2) - 3.0;

        // Compute non-Gaussianity using log-cosh approximation
        // We need to adjust for standardization: log(cosh(x/std)) != log(cosh(x))/std
        // So we need a second computation for the standardized log-cosh
        let std = m2.sqrt();
        let gaussian_expectation = 0.3746;

        let g_expectation = if use_parallel {
            data.par_iter()
                .map(|&x| ((x - mean) / std).cosh().ln())
                .sum::<f64>()
                / n
        } else {
            data.iter()
                .map(|&x| ((x - mean) / std).cosh().ln())
                .sum::<f64>()
                / n
        };

        let non_gaussianity = (g_expectation - gaussian_expectation).powi(2);

        CombinedMetrics {
            kurtosis,
            non_gaussianity,
        }
    }

    /// Compute excess kurtosis (measure of non-Gaussianity)
    /// Kurtosis = E[(X-μ)^4] / σ^4 - 3
    /// Gaussian distributions have kurtosis ≈ 0
    /// High |kurtosis| indicates non-Gaussian (interesting) components
    ///
    /// Note: If you also need non_gaussianity, use compute_combined() instead
    /// to avoid redundant computations.
    pub fn kurtosis(data: &[f64]) -> f64 {
        if data.len() < 4 {
            return 0.0;
        }

        let n = data.len() as f64;

        // Use parallel iterators for large datasets
        let (mean, m2, m4) = if data.len() >= PAR_THRESHOLD {
            let sum: f64 = data.par_iter().sum();
            let mean = sum / n;
            let m2: f64 = data.par_iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;
            let m4: f64 = data.par_iter().map(|&x| (x - mean).powi(4)).sum::<f64>() / n;
            (mean, m2, m4)
        } else {
            let mean = data.iter().sum::<f64>() / n;
            let m2: f64 = data.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;
            let m4: f64 = data.iter().map(|&x| (x - mean).powi(4)).sum::<f64>() / n;
            (mean, m2, m4)
        };
        let _ = mean; // Used in calculations above

        if m2 < 1e-10 {
            return 0.0;
        }

        // Excess kurtosis (subtract 3 for Gaussian baseline)
        m4 / m2.powi(2) - 3.0
    }

    /// Compute negentropy-based non-Gaussianity measure
    /// Uses approximation: J(y) ≈ [E{G(y)} - E{G(v)}]^2
    /// where G(u) = -exp(-u^2/2) (approximation for negentropy)
    /// Higher values indicate more non-Gaussian signals
    ///
    /// Note: If you also need kurtosis, use compute_combined() instead
    /// to avoid redundant computations.
    pub fn non_gaussianity(data: &[f64]) -> f64 {
        if data.is_empty() {
            return 0.0;
        }

        let n = data.len() as f64;

        // Use parallel processing for large datasets
        let use_parallel = data.len() >= PAR_THRESHOLD;

        // Standardize data
        let (mean, std) = if use_parallel {
            let sum: f64 = data.par_iter().sum();
            let mean = sum / n;
            let var: f64 = data.par_iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;
            (mean, var.sqrt())
        } else {
            let mean = data.iter().sum::<f64>() / n;
            let var = data.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;
            (mean, var.sqrt())
        };

        if std < 1e-10 {
            return 0.0;
        }

        // Use log-cosh approximation: G(u) = log(cosh(u))
        // E[G(y)] for standard Gaussian is approximately 0.3746
        let gaussian_expectation = 0.3746;

        // Compute g_expectation directly without intermediate vector allocation
        let g_expectation: f64 = if use_parallel {
            data.par_iter()
                .map(|&x| ((x - mean) / std).cosh().ln())
                .sum::<f64>()
                / n
        } else {
            data.iter()
                .map(|&x| ((x - mean) / std).cosh().ln())
                .sum::<f64>()
                / n
        };

        // Squared difference from Gaussian expectation
        (g_expectation - gaussian_expectation).powi(2)
    }

    /// Compute skewness (asymmetry measure)
    /// Skewness = E[(X-μ)^3] / σ^3
    pub fn skewness(data: &[f64]) -> f64 {
        if data.len() < 3 {
            return 0.0;
        }

        let n = data.len() as f64;

        // Use parallel iterators for large datasets
        let (mean, m2, m3) = if data.len() >= PAR_THRESHOLD {
            let sum: f64 = data.par_iter().sum();
            let mean = sum / n;
            let m2: f64 = data.par_iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;
            let m3: f64 = data.par_iter().map(|&x| (x - mean).powi(3)).sum::<f64>() / n;
            (mean, m2, m3)
        } else {
            let mean = data.iter().sum::<f64>() / n;
            let m2: f64 = data.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;
            let m3: f64 = data.iter().map(|&x| (x - mean).powi(3)).sum::<f64>() / n;
            (mean, m2, m3)
        };
        let _ = mean; // Used in calculations above

        if m2 < 1e-10 {
            return 0.0;
        }

        m3 / m2.powf(1.5)
    }

    /// Compute entropy approximation (via histogram)
    pub fn entropy(data: &[f64], n_bins: usize) -> f64 {
        if data.is_empty() || n_bins == 0 {
            return 0.0;
        }

        let min_val = data.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_val = data.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        if (max_val - min_val).abs() < 1e-10 {
            return 0.0;
        }

        let bin_width = (max_val - min_val) / n_bins as f64;
        let mut histogram = vec![0usize; n_bins];

        for &val in data {
            let bin = ((val - min_val) / bin_width).floor() as usize;
            let bin = bin.min(n_bins - 1);
            histogram[bin] += 1;
        }

        let n = data.len() as f64;
        let mut entropy = 0.0;

        for &count in &histogram {
            if count > 0 {
                let p = count as f64 / n;
                entropy -= p * p.ln();
            }
        }

        entropy
    }

    /// Compute peak-to-peak amplitude
    pub fn peak_to_peak(data: &[f64]) -> f64 {
        if data.is_empty() {
            return 0.0;
        }

        let min_val = data.iter().cloned().fold(f64::INFINITY, f64::min);
        let max_val = data.iter().cloned().fold(f64::NEG_INFINITY, f64::max);

        max_val - min_val
    }

    /// Compute root mean square (RMS)
    pub fn rms(data: &[f64]) -> f64 {
        if data.is_empty() {
            return 0.0;
        }

        let sum_sq: f64 = if data.len() >= PAR_THRESHOLD {
            data.par_iter().map(|&x| x.powi(2)).sum()
        } else {
            data.iter().map(|&x| x.powi(2)).sum()
        };
        (sum_sq / data.len() as f64).sqrt()
    }

    /// Compute zero-crossing rate (useful for artifact detection)
    pub fn zero_crossing_rate(data: &[f64]) -> f64 {
        if data.len() < 2 {
            return 0.0;
        }

        let crossings = data
            .windows(2)
            .filter(|w| (w[0] >= 0.0 && w[1] < 0.0) || (w[0] < 0.0 && w[1] >= 0.0))
            .count();

        crossings as f64 / (data.len() - 1) as f64
    }

    /// Compute autocorrelation at a given lag
    pub fn autocorrelation(data: &[f64], lag: usize) -> f64 {
        if data.len() <= lag {
            return 0.0;
        }

        let n = data.len() as f64;
        let mean = data.iter().sum::<f64>() / n;

        let variance: f64 = data.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n;

        if variance < 1e-10 {
            return 0.0;
        }

        let covariance: f64 = data
            .iter()
            .zip(data.iter().skip(lag))
            .map(|(&x, &y)| (x - mean) * (y - mean))
            .sum::<f64>()
            / (data.len() - lag) as f64;

        covariance / variance
    }

    /// Compute Hurst exponent approximation (fractal dimension indicator)
    /// Values close to 0.5 indicate random walk, >0.5 trending, <0.5 mean-reverting
    pub fn hurst_exponent(data: &[f64]) -> f64 {
        if data.len() < 20 {
            return 0.5;
        }

        // Use R/S analysis with multiple window sizes
        let window_sizes = [8, 16, 32, 64, 128]
            .iter()
            .filter(|&&s| s < data.len())
            .copied()
            .collect::<Vec<_>>();

        if window_sizes.len() < 2 {
            return 0.5;
        }

        let mut log_n = Vec::new();
        let mut log_rs = Vec::new();

        for &window_size in &window_sizes {
            let mut rs_values = Vec::new();

            for chunk in data.chunks(window_size) {
                if chunk.len() < window_size {
                    continue;
                }

                let mean = chunk.iter().sum::<f64>() / chunk.len() as f64;

                // Cumulative deviations
                let mut cumsum = 0.0;
                let mut cumulative = Vec::with_capacity(chunk.len());
                for &val in chunk {
                    cumsum += val - mean;
                    cumulative.push(cumsum);
                }

                let range = cumulative.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
                    - cumulative.iter().cloned().fold(f64::INFINITY, f64::min);

                let std = (chunk.iter().map(|&x| (x - mean).powi(2)).sum::<f64>()
                    / chunk.len() as f64)
                    .sqrt();

                if std > 1e-10 {
                    rs_values.push(range / std);
                }
            }

            if !rs_values.is_empty() {
                let avg_rs: f64 = rs_values.iter().sum::<f64>() / rs_values.len() as f64;
                log_n.push((window_size as f64).ln());
                log_rs.push(avg_rs.ln());
            }
        }

        if log_n.len() < 2 {
            return 0.5;
        }

        // Linear regression to find slope (Hurst exponent)
        let n = log_n.len() as f64;
        let sum_x: f64 = log_n.iter().sum();
        let sum_y: f64 = log_rs.iter().sum();
        let sum_xy: f64 = log_n.iter().zip(log_rs.iter()).map(|(&x, &y)| x * y).sum();
        let sum_x2: f64 = log_n.iter().map(|&x| x.powi(2)).sum();

        let slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x.powi(2));

        slope.clamp(0.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::PI;

    #[test]
    fn test_kurtosis_gaussian() {
        // Generate pseudo-Gaussian data using central limit theorem
        let mut data = Vec::with_capacity(10000);
        for i in 0u64..10000 {
            // Sum of uniform random numbers approximates Gaussian
            // Use u64 to avoid overflow
            let val = ((i.wrapping_mul(1234567)) % 1000) as f64 / 1000.0
                + ((i.wrapping_mul(7654321)) % 1000) as f64 / 1000.0
                - 1.0;
            data.push(val);
        }

        let kurt = QualityMetrics::kurtosis(&data);
        // Gaussian should have kurtosis close to 0
        assert!(
            kurt.abs() < 1.0,
            "Expected near-zero kurtosis, got {}",
            kurt
        );
    }

    #[test]
    fn test_kurtosis_uniform() {
        // Uniform distribution has negative excess kurtosis (-1.2)
        let data: Vec<f64> = (0..10000).map(|i| (i % 1000) as f64 / 1000.0).collect();

        let kurt = QualityMetrics::kurtosis(&data);
        assert!(kurt < 0.0, "Uniform should have negative kurtosis");
    }

    #[test]
    fn test_non_gaussianity() {
        // Sine wave is non-Gaussian - compare to pseudo-Gaussian
        let sine: Vec<f64> = (0..1000)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();

        // Generate pseudo-Gaussian for comparison
        let gaussian: Vec<f64> = (0u64..1000)
            .map(|i| ((i.wrapping_mul(1234567)) % 1000) as f64 / 500.0 - 1.0)
            .collect();

        let ng_sine = QualityMetrics::non_gaussianity(&sine);
        let ng_gaussian = QualityMetrics::non_gaussianity(&gaussian);

        // Sine wave should have higher non-Gaussianity than pseudo-Gaussian
        assert!(
            ng_sine > ng_gaussian,
            "Sine wave (ng={}) should have higher non-Gaussianity than pseudo-Gaussian (ng={})",
            ng_sine,
            ng_gaussian
        );
    }

    #[test]
    fn test_zero_crossing_rate() {
        // Sine wave should have predictable zero crossing rate
        let sine: Vec<f64> = (0..1000)
            .map(|i| (2.0 * PI * 10.0 * i as f64 / 1000.0).sin())
            .collect();

        let zcr = QualityMetrics::zero_crossing_rate(&sine);

        // 10 Hz sine over 1000 samples = 10 cycles = 20 crossings
        // Rate = 20/999 ≈ 0.02
        assert!(
            zcr > 0.01 && zcr < 0.05,
            "Expected ZCR around 0.02, got {}",
            zcr
        );
    }

    #[test]
    fn test_rms() {
        // RMS of sine wave should be 1/sqrt(2)
        let sine: Vec<f64> = (0..10000)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();

        let rms = QualityMetrics::rms(&sine);
        let expected = 1.0 / 2.0_f64.sqrt();

        assert!(
            (rms - expected).abs() < 0.05,
            "Expected RMS {}, got {}",
            expected,
            rms
        );
    }

    #[test]
    fn test_entropy() {
        // Uniform distribution should have maximum entropy
        let uniform: Vec<f64> = (0..1000).map(|i| i as f64 / 1000.0).collect();

        // Highly peaked distribution should have low entropy
        let peaked: Vec<f64> = (0..1000).map(|_| 0.5).collect();

        let entropy_uniform = QualityMetrics::entropy(&uniform, 50);
        let entropy_peaked = QualityMetrics::entropy(&peaked, 50);

        assert!(
            entropy_uniform > entropy_peaked,
            "Uniform ({}) should have higher entropy than peaked ({})",
            entropy_uniform,
            entropy_peaked
        );
    }

    #[test]
    fn test_autocorrelation() {
        // Sine wave should have high autocorrelation at period
        let sine: Vec<f64> = (0..1000)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();

        let ac_period = QualityMetrics::autocorrelation(&sine, 100);
        let ac_half = QualityMetrics::autocorrelation(&sine, 50);

        // Autocorrelation at period should be ~1, at half-period ~-1
        assert!(
            ac_period > 0.9,
            "Expected high AC at period, got {}",
            ac_period
        );
        assert!(
            ac_half < -0.9,
            "Expected negative AC at half-period, got {}",
            ac_half
        );
    }

    #[test]
    fn test_compute_combined_matches_individual() {
        // Test that compute_combined produces the same results as calling
        // kurtosis() and non_gaussianity() separately
        let sine: Vec<f64> = (0..1000)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();

        let combined = QualityMetrics::compute_combined(&sine);
        let individual_kurtosis = QualityMetrics::kurtosis(&sine);
        let individual_ng = QualityMetrics::non_gaussianity(&sine);

        assert!(
            (combined.kurtosis - individual_kurtosis).abs() < 1e-10,
            "Kurtosis mismatch: combined={}, individual={}",
            combined.kurtosis,
            individual_kurtosis
        );
        assert!(
            (combined.non_gaussianity - individual_ng).abs() < 1e-10,
            "Non-Gaussianity mismatch: combined={}, individual={}",
            combined.non_gaussianity,
            individual_ng
        );
    }

    #[test]
    fn test_compute_combined_edge_cases() {
        // Test with small data (less than 4 elements)
        let small_data = vec![1.0, 2.0, 3.0];
        let result = QualityMetrics::compute_combined(&small_data);
        assert_eq!(result.kurtosis, 0.0);
        assert_eq!(result.non_gaussianity, 0.0);

        // Test with constant data (zero variance)
        let constant_data = vec![5.0; 100];
        let result = QualityMetrics::compute_combined(&constant_data);
        assert_eq!(result.kurtosis, 0.0);
        assert_eq!(result.non_gaussianity, 0.0);
    }

    #[test]
    fn test_compute_combined_large_data() {
        // Test with data larger than PAR_THRESHOLD to exercise parallel code path
        let large_data: Vec<f64> = (0..15000)
            .map(|i| (2.0 * PI * i as f64 / 100.0).sin())
            .collect();

        let combined = QualityMetrics::compute_combined(&large_data);
        let individual_kurtosis = QualityMetrics::kurtosis(&large_data);
        let individual_ng = QualityMetrics::non_gaussianity(&large_data);

        assert!(
            (combined.kurtosis - individual_kurtosis).abs() < 1e-10,
            "Large data kurtosis mismatch: combined={}, individual={}",
            combined.kurtosis,
            individual_kurtosis
        );
        assert!(
            (combined.non_gaussianity - individual_ng).abs() < 1e-10,
            "Large data non-Gaussianity mismatch: combined={}, individual={}",
            combined.non_gaussianity,
            individual_ng
        );
    }
}
