use crate::file_readers::FileReaderFactory;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Request parameters for computing phase space embedding
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseSpaceRequest {
    pub file_path: String,
    pub channel_index: usize,
    pub delay: usize,
    pub max_points: Option<usize>,
    pub start_sample: Option<usize>,
    pub end_sample: Option<usize>,
}

/// Result of phase space computation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseSpaceResult {
    pub points: Vec<[f64; 3]>,
    pub channel_label: String,
    pub delay_samples: usize,
    pub sample_rate: f64,
    pub delay_ms: f64,
    pub num_points: usize,
}

/// Compute delay embedding for 3D phase space visualization
/// Creates points (x(t), x(t-τ), x(t-2τ)) for attractor reconstruction
#[tauri::command]
pub async fn compute_phase_space(request: PhaseSpaceRequest) -> Result<PhaseSpaceResult, String> {
    let path = Path::new(&request.file_path);

    if !path.exists() {
        return Err(format!("File not found: {}", request.file_path));
    }

    if !FileReaderFactory::is_supported(path) {
        return Err(format!(
            "Unsupported file format: {}",
            path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("unknown")
        ));
    }

    // Create reader and get metadata
    let reader = FileReaderFactory::create_reader(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let metadata = reader
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    if request.channel_index >= metadata.num_channels {
        return Err(format!(
            "Channel index {} out of range (file has {} channels)",
            request.channel_index, metadata.num_channels
        ));
    }

    // Get the channel label
    let channel_label = metadata
        .channels
        .get(request.channel_index)
        .cloned()
        .unwrap_or_else(|| format!("Ch{}", request.channel_index));

    let sample_rate = metadata.sample_rate;
    let total_samples = metadata.num_samples;
    let delay = request.delay;

    // Calculate sample range
    let start = request.start_sample.unwrap_or(0);
    let end = request
        .end_sample
        .unwrap_or(total_samples)
        .min(total_samples);

    if start >= end {
        return Err("Invalid sample range".to_string());
    }

    let num_samples = end - start;

    // Need at least 2*delay + 1 samples for one point
    if num_samples < 2 * delay + 1 {
        return Err(format!(
            "Not enough samples for delay embedding. Need at least {} samples, have {}",
            2 * delay + 1,
            num_samples
        ));
    }

    // Read only the channel we need
    let channel_names = vec![channel_label.clone()];
    let data = reader
        .read_chunk(start, num_samples, Some(&channel_names))
        .map_err(|e| format!("Failed to load data: {}", e))?;

    if data.is_empty() || data[0].is_empty() {
        return Err("No data loaded for the specified channel".to_string());
    }

    let samples = &data[0];

    // Calculate maximum possible points
    let max_possible_points = samples.len().saturating_sub(2 * delay);
    if max_possible_points == 0 {
        return Err("Not enough data points for phase space reconstruction".to_string());
    }

    let target_points = request.max_points.unwrap_or(10000).min(max_possible_points);

    // Compute downsampling stride if needed
    let stride = if target_points < max_possible_points {
        max_possible_points / target_points
    } else {
        1
    };

    // Compute phase space embedding: (x(t), x(t-τ), x(t-2τ))
    // We iterate from 2*delay onwards so we can look back
    let mut points: Vec<[f64; 3]> = Vec::with_capacity(target_points);

    for i in (2 * delay..samples.len()).step_by(stride.max(1)) {
        if points.len() >= target_points {
            break;
        }

        let x_t = samples[i];
        let x_t_tau = samples[i - delay];
        let x_t_2tau = samples[i - 2 * delay];

        points.push([x_t, x_t_tau, x_t_2tau]);
    }

    let delay_ms = (delay as f64 / sample_rate) * 1000.0;
    let num_points = points.len();

    Ok(PhaseSpaceResult {
        points,
        channel_label,
        delay_samples: delay,
        sample_rate,
        delay_ms,
        num_points,
    })
}
