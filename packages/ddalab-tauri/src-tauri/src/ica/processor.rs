use anyhow::{anyhow, Result};
use linfa::prelude::*;
use linfa_ica::fast_ica::FastIca;
use ndarray::{Array2, Axis};
use rayon::prelude::*;
use rustfft::{num_complex::Complex, FftPlanner};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::f64::consts::PI;

// Thread-local FFT planner for efficient reuse across parallel computations
thread_local! {
    static FFT_PLANNER: RefCell<FftPlanner<f64>> = RefCell::new(FftPlanner::new());
}

use crate::intermediate_format::IntermediateData;

use super::quality_metrics::QualityMetrics;

/// ICA algorithm selection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ICAAlgorithm {
    FastICA,
}

impl Default for ICAAlgorithm {
    fn default() -> Self {
        Self::FastICA
    }
}

/// Non-linearity function for FastICA
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GFunction {
    Logcosh,
    Exp,
    Cube,
}

impl Default for GFunction {
    fn default() -> Self {
        Self::Logcosh
    }
}

/// Preprocessing options for ICA
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICAPreprocessing {
    pub centering: bool,
    pub whitening: bool,
}

impl Default for ICAPreprocessing {
    fn default() -> Self {
        Self {
            centering: true,
            whitening: true,
        }
    }
}

/// Parameters for ICA analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICAParameters {
    pub n_components: Option<usize>,
    pub algorithm: ICAAlgorithm,
    pub g_function: GFunction,
    pub max_iterations: usize,
    pub tolerance: f64,
    pub preprocessing: ICAPreprocessing,
    pub random_seed: Option<u64>,
}

impl Default for ICAParameters {
    fn default() -> Self {
        Self {
            n_components: None, // Use all channels
            algorithm: ICAAlgorithm::default(),
            g_function: GFunction::default(),
            max_iterations: 200,
            tolerance: 1e-4,
            preprocessing: ICAPreprocessing::default(),
            random_seed: Some(42),
        }
    }
}

/// A single independent component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICAComponent {
    pub component_id: usize,
    pub spatial_map: Vec<f64>,
    pub time_series: Vec<f64>,
    pub kurtosis: f64,
    pub non_gaussianity: f64,
    pub variance_explained: f64,
    pub power_spectrum: Option<PowerSpectrum>,
}

/// Power spectrum data for a component
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerSpectrum {
    pub frequencies: Vec<f64>,
    pub power: Vec<f64>,
}

/// Result of ICA analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ICAAnalysisResult {
    pub components: Vec<ICAComponent>,
    pub mixing_matrix: Vec<Vec<f64>>,
    pub unmixing_matrix: Vec<Vec<f64>>,
    pub channel_names: Vec<String>,
    pub sample_rate: f64,
    pub n_samples: usize,
    pub parameters: ICAParameters,
    pub total_variance: f64,
}

/// ICA processor that wraps linfa-ica
pub struct ICAProcessor;

impl ICAProcessor {
    /// Run ICA analysis on intermediate data
    pub fn analyze(
        data: &IntermediateData,
        params: &ICAParameters,
        selected_channels: Option<&[usize]>,
    ) -> Result<ICAAnalysisResult> {
        log::info!("[ICA-PROC] Starting ICA analysis...");

        // Extract channel data
        let channels: Vec<_> = if let Some(indices) = selected_channels {
            log::info!("[ICA-PROC] Selecting {} specific channels", indices.len());
            indices
                .iter()
                .filter_map(|&i| data.channels.get(i))
                .collect()
        } else {
            log::info!("[ICA-PROC] Using all {} channels", data.channels.len());
            data.channels.iter().collect()
        };

        if channels.is_empty() {
            return Err(anyhow!("No channels selected for ICA"));
        }

        let n_channels = channels.len();
        let n_samples = channels[0].samples.len();
        let sample_rate = channels[0].sample_rate.unwrap_or(data.metadata.sample_rate);

        log::info!(
            "[ICA-PROC] Data dimensions: {} channels x {} samples (sample_rate={})",
            n_channels,
            n_samples,
            sample_rate
        );

        // Determine number of components
        let n_components = params.n_components.unwrap_or(n_channels);
        if n_components > n_channels {
            return Err(anyhow!(
                "Number of components ({}) cannot exceed number of channels ({})",
                n_components,
                n_channels
            ));
        }

        log::info!(
            "[ICA-PROC] Building data matrix ({} x {})...",
            n_samples,
            n_channels
        );
        let build_start = std::time::Instant::now();

        // Build data matrix efficiently using from_shape_fn
        // This is more cache-friendly than nested loops with individual assignments
        let data_matrix =
            Array2::from_shape_fn((n_samples, n_channels), |(i, j)| channels[j].samples[i]);
        log::info!(
            "[ICA-PROC] Data matrix built in {:.2}s",
            build_start.elapsed().as_secs_f64()
        );

        // Preprocess: centering
        if params.preprocessing.centering {
            log::info!("[ICA-PROC] Centering data...");
            let center_start = std::time::Instant::now();
            let data_matrix_centered = Self::center_data(&data_matrix);
            log::info!(
                "[ICA-PROC] Data centered in {:.2}s",
                center_start.elapsed().as_secs_f64()
            );
            // Use centered data
            let data_matrix = data_matrix_centered;

            // Calculate total variance before ICA (parallel)
            log::info!("[ICA-PROC] Calculating total variance...");
            let total_variance: f64 = (0..n_channels)
                .into_par_iter()
                .map(|j| {
                    let col = data_matrix.column(j);
                    let mean = col.mean().unwrap_or(0.0);
                    col.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n_samples as f64
                })
                .sum();
            log::info!("[ICA-PROC] Total variance: {:.4}", total_variance);

            // Create dataset for linfa
            log::info!("[ICA-PROC] Creating linfa dataset...");
            let dataset = DatasetBase::from(data_matrix.clone());

            // Configure FastICA
            log::info!(
                "[ICA-PROC] Configuring FastICA: n_components={}, max_iter={}, tol={}",
                n_components,
                params.max_iterations,
                params.tolerance
            );
            let ica = FastIca::params()
                .ncomponents(n_components)
                .max_iter(params.max_iterations)
                .tol(params.tolerance);

            // Run FastICA
            log::info!("[ICA-PROC] Running FastICA fitting (this may take a while)...");
            let fit_start = std::time::Instant::now();
            let ica_result = ica
                .fit(&dataset)
                .map_err(|e| anyhow!("FastICA failed: {:?}", e))?;
            log::info!(
                "[ICA-PROC] FastICA fit completed in {:.2}s",
                fit_start.elapsed().as_secs_f64()
            );

            // Transform data to get independent components
            log::info!("[ICA-PROC] Transforming data to get independent components...");
            let transform_start = std::time::Instant::now();
            let sources_array = ica_result.predict(&data_matrix);
            log::info!(
                "[ICA-PROC] Transform completed in {:.2}s",
                transform_start.elapsed().as_secs_f64()
            );

            // Continue with the rest of the processing using sources_array
            return Self::process_ica_results(
                sources_array,
                data_matrix,
                channels,
                n_components,
                n_samples,
                sample_rate,
                total_variance,
                params,
            );
        }

        // Non-centered path - calculate total variance (parallel)
        let total_variance: f64 = (0..n_channels)
            .into_par_iter()
            .map(|j| {
                let col = data_matrix.column(j);
                let mean = col.mean().unwrap_or(0.0);
                col.iter().map(|&x| (x - mean).powi(2)).sum::<f64>() / n_samples as f64
            })
            .sum();

        // Create dataset for linfa
        let dataset = DatasetBase::from(data_matrix.clone());

        // Configure FastICA
        let ica = FastIca::params()
            .ncomponents(n_components)
            .max_iter(params.max_iterations)
            .tol(params.tolerance);

        // Run FastICA
        log::info!("[ICA-PROC] Running FastICA fitting (non-centered)...");
        let fit_start = std::time::Instant::now();
        let ica_result = ica
            .fit(&dataset)
            .map_err(|e| anyhow!("FastICA failed: {:?}", e))?;
        log::info!(
            "[ICA-PROC] FastICA fit completed in {:.2}s",
            fit_start.elapsed().as_secs_f64()
        );

        // Transform data to get independent components
        let sources_array = ica_result.predict(&data_matrix);

        Self::process_ica_results(
            sources_array,
            data_matrix,
            channels,
            n_components,
            n_samples,
            sample_rate,
            total_variance,
            params,
        )
    }

    /// Process ICA results after FastICA computation
    fn process_ica_results(
        sources_array: Array2<f64>,
        data_matrix: Array2<f64>,
        channels: Vec<&crate::intermediate_format::ChannelData>,
        n_components: usize,
        n_samples: usize,
        sample_rate: f64,
        total_variance: f64,
        params: &ICAParameters,
    ) -> Result<ICAAnalysisResult> {
        log::info!("[ICA-PROC] Processing ICA results...");

        // Compute mixing matrix from sources and original data
        log::info!("[ICA-PROC] Computing mixing/unmixing matrices...");
        let mixing_start = std::time::Instant::now();
        let (mixing, unmixing) = Self::compute_mixing_unmixing(&data_matrix, &sources_array)?;
        log::info!(
            "[ICA-PROC] Mixing matrices computed in {:.2}s",
            mixing_start.elapsed().as_secs_f64()
        );

        // Extract components with metrics
        log::info!(
            "[ICA-PROC] Extracting {} components with metrics (parallel)...",
            n_components
        );
        let extract_start = std::time::Instant::now();
        let components: Vec<ICAComponent> = (0..n_components)
            .into_par_iter()
            .map(|i| {
                // Extract time series for this component
                let time_series: Vec<f64> = sources_array.column(i).to_vec();

                // Extract spatial map (mixing matrix column)
                let spatial_map: Vec<f64> = mixing.column(i).to_vec();

                // Calculate quality metrics
                let kurtosis = QualityMetrics::kurtosis(&time_series);
                let non_gaussianity = QualityMetrics::non_gaussianity(&time_series);

                // Calculate variance explained
                let component_variance: f64 =
                    time_series.iter().map(|&x| x.powi(2)).sum::<f64>() / n_samples as f64;
                let variance_explained = if total_variance > 0.0 {
                    (component_variance / total_variance) * 100.0
                } else {
                    0.0
                };

                // Compute power spectrum
                let power_spectrum = Self::compute_power_spectrum(&time_series, sample_rate);

                ICAComponent {
                    component_id: i,
                    spatial_map,
                    time_series,
                    kurtosis,
                    non_gaussianity,
                    variance_explained,
                    power_spectrum: Some(power_spectrum),
                }
            })
            .collect();
        log::info!(
            "[ICA-PROC] Components extracted in {:.2}s",
            extract_start.elapsed().as_secs_f64()
        );

        // Sort components by kurtosis (most non-Gaussian first)
        log::info!("[ICA-PROC] Sorting components by kurtosis...");
        let mut sorted_components = components;
        sorted_components.sort_by(|a, b| {
            b.kurtosis
                .abs()
                .partial_cmp(&a.kurtosis.abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Update component IDs after sorting
        for (i, comp) in sorted_components.iter_mut().enumerate() {
            comp.component_id = i;
        }

        // Convert matrices to Vec<Vec<f64>>
        log::info!("[ICA-PROC] Converting matrices to output format...");
        let mixing_vec: Vec<Vec<f64>> = (0..mixing.nrows())
            .map(|i| mixing.row(i).to_vec())
            .collect();

        let unmixing_vec: Vec<Vec<f64>> = (0..unmixing.nrows())
            .map(|i| unmixing.row(i).to_vec())
            .collect();

        let channel_names: Vec<String> = channels.iter().map(|c| c.label.clone()).collect();

        log::info!(
            "[ICA-PROC] ICA processing complete! Returning {} components",
            sorted_components.len()
        );

        Ok(ICAAnalysisResult {
            components: sorted_components,
            mixing_matrix: mixing_vec,
            unmixing_matrix: unmixing_vec,
            channel_names,
            sample_rate,
            n_samples,
            parameters: params.clone(),
            total_variance,
        })
    }

    /// Center data by subtracting column means
    fn center_data(data: &Array2<f64>) -> Array2<f64> {
        // mean_axis returns None only if axis is out of bounds, which won't happen here
        // since we're always using Axis(0) on a 2D array
        let means = match data.mean_axis(Axis(0)) {
            Some(m) => m,
            None => return data.clone(), // Return uncentered data if mean computation fails
        };
        let mut centered = data.clone();
        for (mut col, &mean) in centered.columns_mut().into_iter().zip(means.iter()) {
            col.mapv_inplace(|x| x - mean);
        }
        centered
    }

    /// Compute mixing and unmixing matrices from data and sources
    /// X = S * A^T, where X is data (n_samples x n_channels), S is sources (n_samples x n_components)
    /// A is mixing matrix (n_channels x n_components)
    fn compute_mixing_unmixing(
        data: &Array2<f64>,
        sources: &Array2<f64>,
    ) -> Result<(Array2<f64>, Array2<f64>)> {
        let (_n_samples, n_channels) = data.dim();
        let (_, n_components) = sources.dim();

        // Compute mixing matrix: A = X^T * S * (S^T * S)^(-1)
        let sts = sources.t().dot(sources);
        let sts_inv = Self::invert_matrix(&sts)?;
        let mixing = data.t().dot(sources).dot(&sts_inv);

        // Compute unmixing matrix as pseudo-inverse of mixing
        // W = (A^T * A)^(-1) * A^T
        let ata = mixing.t().dot(&mixing);
        let ata_inv = Self::invert_matrix(&ata)?;
        let unmixing = ata_inv.dot(&mixing.t());

        Ok((mixing, unmixing))
    }

    /// Invert a square matrix using Gauss-Jordan elimination
    fn invert_matrix(matrix: &Array2<f64>) -> Result<Array2<f64>> {
        let n = matrix.nrows();
        if n != matrix.ncols() {
            return Err(anyhow!("Matrix must be square"));
        }

        // Augmented matrix [A | I]
        let mut aug = Array2::<f64>::zeros((n, 2 * n));
        for i in 0..n {
            for j in 0..n {
                aug[[i, j]] = matrix[[i, j]];
            }
            aug[[i, n + i]] = 1.0;
        }

        // Gauss-Jordan elimination
        for i in 0..n {
            // Find pivot
            let mut max_row = i;
            for k in (i + 1)..n {
                if aug[[k, i]].abs() > aug[[max_row, i]].abs() {
                    max_row = k;
                }
            }

            // Swap rows
            for j in 0..(2 * n) {
                let temp = aug[[i, j]];
                aug[[i, j]] = aug[[max_row, j]];
                aug[[max_row, j]] = temp;
            }

            let pivot = aug[[i, i]];
            if pivot.abs() < 1e-10 {
                return Err(anyhow!("Matrix is singular or nearly singular"));
            }

            // Scale row
            for j in 0..(2 * n) {
                aug[[i, j]] /= pivot;
            }

            // Eliminate column
            for k in 0..n {
                if k != i {
                    let factor = aug[[k, i]];
                    for j in 0..(2 * n) {
                        aug[[k, j]] -= factor * aug[[i, j]];
                    }
                }
            }
        }

        // Extract inverse
        let mut inv = Array2::<f64>::zeros((n, n));
        for i in 0..n {
            for j in 0..n {
                inv[[i, j]] = aug[[i, n + j]];
            }
        }

        Ok(inv)
    }

    /// Compute pseudo-inverse using SVD
    fn pseudo_inverse(matrix: &Array2<f64>) -> Result<Array2<f64>> {
        let (m, n) = matrix.dim();

        // Simple pseudo-inverse for small matrices
        // A^+ = (A^T * A)^(-1) * A^T
        let at = matrix.t();
        let ata = at.dot(matrix);

        // Compute inverse of A^T * A using Cholesky-like decomposition
        // For simplicity, we'll use a basic iterative method
        let mut inv = Array2::<f64>::eye(n);

        // Gauss-Jordan elimination
        let mut aug = Array2::<f64>::zeros((n, 2 * n));
        for i in 0..n {
            for j in 0..n {
                aug[[i, j]] = ata[[i, j]];
            }
            aug[[i, n + i]] = 1.0;
        }

        for i in 0..n {
            // Find pivot
            let mut max_row = i;
            for k in (i + 1)..n {
                if aug[[k, i]].abs() > aug[[max_row, i]].abs() {
                    max_row = k;
                }
            }

            // Swap rows
            for j in 0..(2 * n) {
                let temp = aug[[i, j]];
                aug[[i, j]] = aug[[max_row, j]];
                aug[[max_row, j]] = temp;
            }

            let pivot = aug[[i, i]];
            if pivot.abs() < 1e-10 {
                return Err(anyhow!("Matrix is singular or nearly singular"));
            }

            // Scale row
            for j in 0..(2 * n) {
                aug[[i, j]] /= pivot;
            }

            // Eliminate column
            for k in 0..n {
                if k != i {
                    let factor = aug[[k, i]];
                    for j in 0..(2 * n) {
                        aug[[k, j]] -= factor * aug[[i, j]];
                    }
                }
            }
        }

        // Extract inverse
        for i in 0..n {
            for j in 0..n {
                inv[[i, j]] = aug[[i, n + j]];
            }
        }

        // Compute pseudo-inverse: (A^T * A)^(-1) * A^T
        let result = inv.dot(&at);

        // Transpose to get mixing matrix (n_channels x n_components)
        Ok(result.t().to_owned())
    }

    /// Compute power spectrum using FFT (uses thread-local planner for efficiency)
    fn compute_power_spectrum(signal: &[f64], sample_rate: f64) -> PowerSpectrum {
        let n = signal.len();
        let n_fft = n.next_power_of_two();

        // Zero-pad signal
        let mut input: Vec<Complex<f64>> = signal.iter().map(|&x| Complex::new(x, 0.0)).collect();
        input.resize(n_fft, Complex::new(0.0, 0.0));

        // Apply Hanning window
        for (i, val) in input.iter_mut().enumerate().take(n) {
            let window = 0.5 * (1.0 - (2.0 * PI * i as f64 / (n - 1) as f64).cos());
            *val = Complex::new(val.re * window, 0.0);
        }

        // Perform FFT using thread-local planner (caches FFT plans per thread)
        FFT_PLANNER.with(|planner| {
            let fft = planner.borrow_mut().plan_fft_forward(n_fft);
            fft.process(&mut input);
        });

        // Compute power spectrum (only positive frequencies)
        let n_positive = n_fft / 2 + 1;
        let freq_resolution = sample_rate / n_fft as f64;

        let frequencies: Vec<f64> = (0..n_positive)
            .map(|i| i as f64 * freq_resolution)
            .collect();

        let power: Vec<f64> = input[..n_positive]
            .iter()
            .map(|c| (c.norm_sqr() / n_fft as f64).log10() * 10.0) // Power in dB
            .collect();

        PowerSpectrum { frequencies, power }
    }

    /// Reconstruct data with selected components removed (for artifact rejection)
    pub fn reconstruct_without_components(
        result: &ICAAnalysisResult,
        components_to_remove: &[usize],
    ) -> Result<Vec<Vec<f64>>> {
        let n_samples = result.n_samples;
        let n_channels = result.channel_names.len();
        let n_components = result.components.len();

        // Build source matrix with zeroed components
        let mut sources = Array2::<f64>::zeros((n_samples, n_components));
        for comp in &result.components {
            if !components_to_remove.contains(&comp.component_id) {
                for (i, &val) in comp.time_series.iter().enumerate() {
                    sources[[i, comp.component_id]] = val;
                }
            }
        }

        // Reconstruct: X = S * A^T (where A is mixing matrix)
        let mixing: Array2<f64> = Array2::from_shape_vec(
            (n_channels, n_components),
            result.mixing_matrix.iter().flatten().copied().collect(),
        )?;

        let reconstructed = sources.dot(&mixing.t());

        // Convert to Vec<Vec<f64>>
        let result: Vec<Vec<f64>> = (0..n_channels)
            .map(|j| reconstructed.column(j).to_vec())
            .collect();

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intermediate_format::{ChannelData, DataMetadata};

    fn create_test_data(n_channels: usize, n_samples: usize) -> IntermediateData {
        let mut channels = Vec::with_capacity(n_channels);

        for i in 0..n_channels {
            // Create mixed signals with different frequencies
            let samples: Vec<f64> = (0..n_samples)
                .map(|t| {
                    let t = t as f64 / 256.0;
                    let freq1 = 5.0 + i as f64;
                    let freq2 = 10.0 + i as f64 * 0.5;
                    (2.0 * PI * freq1 * t).sin() + 0.5 * (2.0 * PI * freq2 * t).cos()
                })
                .collect();

            channels.push(ChannelData {
                label: format!("Ch{}", i + 1),
                channel_type: "EEG".to_string(),
                unit: "µV".to_string(),
                samples,
                sample_rate: Some(256.0),
            });
        }

        IntermediateData {
            metadata: DataMetadata {
                source_file: "test.edf".to_string(),
                source_format: "EDF".to_string(),
                sample_rate: 256.0,
                duration: n_samples as f64 / 256.0,
                start_time: None,
                subject_id: None,
                custom_metadata: std::collections::HashMap::new(),
            },
            channels,
        }
    }

    #[test]
    fn test_ica_basic() {
        let data = create_test_data(4, 1024);
        let params = ICAParameters {
            n_components: Some(4),
            ..Default::default()
        };

        let result = ICAProcessor::analyze(&data, &params, None).unwrap();

        assert_eq!(result.components.len(), 4);
        assert_eq!(result.mixing_matrix.len(), 4);
        assert_eq!(result.unmixing_matrix.len(), 4);

        // Check that all components have valid metrics
        for comp in &result.components {
            assert!(comp.kurtosis.is_finite());
            assert!(comp.non_gaussianity.is_finite());
            assert!(!comp.time_series.is_empty());
            assert!(!comp.spatial_map.is_empty());
        }
    }

    #[test]
    fn test_ica_fewer_components() {
        let data = create_test_data(6, 1024);
        let params = ICAParameters {
            n_components: Some(3),
            ..Default::default()
        };

        let result = ICAProcessor::analyze(&data, &params, None).unwrap();
        assert_eq!(result.components.len(), 3);
    }

    #[test]
    fn test_power_spectrum() {
        let signal: Vec<f64> = (0..1024)
            .map(|t| {
                let t = t as f64 / 256.0;
                (2.0 * PI * 10.0 * t).sin() // 10 Hz sine wave
            })
            .collect();

        let spectrum = ICAProcessor::compute_power_spectrum(&signal, 256.0);

        assert!(!spectrum.frequencies.is_empty());
        assert!(!spectrum.power.is_empty());
        assert_eq!(spectrum.frequencies.len(), spectrum.power.len());

        // Peak should be around 10 Hz
        let peak_idx = spectrum
            .power
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
            .map(|(i, _)| i)
            .unwrap();

        let peak_freq = spectrum.frequencies[peak_idx];
        assert!((peak_freq - 10.0).abs() < 2.0, "Peak at {} Hz", peak_freq);
    }
}
