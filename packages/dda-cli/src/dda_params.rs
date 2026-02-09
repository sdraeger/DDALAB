use crate::cli;
use dda_rs::{
    format_select_mask, generate_select_mask, AlgorithmSelection, DDARequest, DDARunner,
    DelayParameters, FileType, ModelParameters, PreprocessingOptions, TimeRange, VariantMetadata,
    WindowParameters,
};
use std::path::Path;

pub fn resolve_runner(binary_path: &Option<String>) -> Result<DDARunner, String> {
    match binary_path {
        Some(path) => DDARunner::new(path).map_err(|e| e.to_string()),
        None => DDARunner::discover().map_err(|e| e.to_string()),
    }
}

/// Validate a single file path: existence and supported extension.
pub fn validate_file(file_path: &str) -> Result<(), String> {
    if !Path::new(file_path).exists() {
        return Err(format!("Input file not found: {}", file_path));
    }

    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if FileType::from_extension(ext).is_none() {
        return Err(format!(
            "Unsupported file extension '{}'. Supported: edf, ascii, txt, csv",
            ext
        ));
    }

    Ok(())
}

/// Validate shared DDA parameters (not file-specific).
pub fn validate_common_params(
    channels: &[usize],
    variants: &[String],
    delays: &[i32],
    wl: u32,
    ws: u32,
    ct_pairs: &Option<Vec<String>>,
    cd_pairs: &Option<Vec<String>>,
) -> Result<(), String> {
    // Channels
    if channels.is_empty() {
        return Err("At least one channel must be specified".to_string());
    }

    // Variant names
    for v in variants {
        if VariantMetadata::from_abbrev(v).is_none() {
            return Err(format!(
                "Unknown variant '{}'. Valid variants: ST, CT, CD, DE, SY",
                v
            ));
        }
    }

    // CT requires pairs
    if variants.iter().any(|v| v == "CT") && ct_pairs.is_none() {
        return Err(
            "CT variant requires --ct-pairs (e.g., --ct-pairs \"0,1\" \"0,2\")".to_string(),
        );
    }

    // CD requires pairs
    if variants.iter().any(|v| v == "CD") && cd_pairs.is_none() {
        return Err(
            "CD variant requires --cd-pairs (e.g., --cd-pairs \"0,1\" \"1,0\")".to_string(),
        );
    }

    // Delay range
    for &d in delays {
        if d < -100 || d > 100 {
            return Err(format!("Delay value {} is out of range [-100, 100]", d));
        }
    }

    // Window parameters
    if wl == 0 {
        return Err("Window length (--wl) must be greater than 0".to_string());
    }
    if ws == 0 {
        return Err("Window step (--ws) must be greater than 0".to_string());
    }
    if ws > wl {
        return Err(format!(
            "Window step ({}) must not exceed window length ({})",
            ws, wl
        ));
    }

    // Validate pair formats
    if let Some(ref pairs) = ct_pairs {
        for p in pairs {
            cli::parse_pair(p)?;
        }
    }
    if let Some(ref pairs) = cd_pairs {
        for p in pairs {
            cli::parse_pair(p)?;
        }
    }

    Ok(())
}

/// Build a DDARequest from individual parameters.
#[allow(clippy::too_many_arguments)]
pub fn build_dda_request(
    file_path: &str,
    channels: &[usize],
    variants: &[String],
    wl: u32,
    ws: u32,
    delays: &[i32],
    dm: u32,
    order: u32,
    nr_tau: u32,
    ct_wl: Option<u32>,
    ct_ws: Option<u32>,
    ct_pairs: &Option<Vec<String>>,
    cd_pairs: &Option<Vec<String>>,
    sr: Option<f64>,
    start: Option<f64>,
    end: Option<f64>,
) -> Result<DDARequest, String> {
    let variant_refs: Vec<&str> = variants.iter().map(|s| s.as_str()).collect();
    let mask = generate_select_mask(&variant_refs);
    let mask_str = format_select_mask(&mask);

    let ct_channel_pairs = ct_pairs
        .as_ref()
        .map(|pairs| cli::parse_pairs(pairs))
        .transpose()?;

    let cd_channel_pairs = cd_pairs
        .as_ref()
        .map(|pairs| cli::parse_pairs(pairs))
        .transpose()?;

    // Determine CT window params: use explicit values, or default to 2 when CT/CD is enabled
    let needs_ct_params = variants.iter().any(|v| v == "CT" || v == "CD" || v == "DE");
    let ct_wl = ct_wl.or(if needs_ct_params { Some(2) } else { None });
    let ct_ws = ct_ws.or(if needs_ct_params { Some(2) } else { None });

    Ok(DDARequest {
        file_path: file_path.to_string(),
        channels: Some(channels.to_vec()),
        time_range: TimeRange {
            start: start.unwrap_or(0.0),
            end: end.unwrap_or(f64::MAX),
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: variants.to_vec(),
            select_mask: Some(mask_str),
        },
        window_parameters: WindowParameters {
            window_length: wl,
            window_step: ws,
            ct_window_length: ct_wl,
            ct_window_step: ct_ws,
        },
        delay_parameters: DelayParameters {
            delays: delays.to_vec(),
        },
        ct_channel_pairs,
        cd_channel_pairs,
        model_parameters: Some(ModelParameters {
            dm,
            order,
            nr_tau,
        }),
        variant_configs: None,
        sampling_rate: sr,
    })
}

/// Compute sample bounds from time or sample-based arguments.
pub fn compute_bounds(
    start: Option<f64>,
    end: Option<f64>,
    start_sample: Option<u64>,
    end_sample: Option<u64>,
    sr: Option<f64>,
) -> (Option<u64>, Option<u64>) {
    // Sample-based bounds take precedence
    if start_sample.is_some() || end_sample.is_some() {
        return (start_sample, end_sample);
    }

    // Time-based bounds require sampling rate
    if let (Some(start), Some(end), Some(sr)) = (start, end, sr) {
        let start_sample = (start * sr) as u64;
        let end_sample = (end * sr) as u64;
        return (Some(start_sample), Some(end_sample));
    }

    (None, None)
}

/// Check if a file extension is supported for DDA analysis.
pub fn is_supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| FileType::from_extension(ext).is_some())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_common_params_valid() {
        let result = validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[7, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_common_params_empty_channels() {
        let result = validate_common_params(
            &[],
            &["ST".to_string()],
            &[7, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("channel"));
    }

    #[test]
    fn test_validate_common_params_invalid_variant() {
        let result = validate_common_params(
            &[0],
            &["INVALID".to_string()],
            &[7],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown variant"));
    }

    #[test]
    fn test_validate_common_params_delay_out_of_range() {
        let result = validate_common_params(
            &[0],
            &["ST".to_string()],
            &[200],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of range"));
    }

    #[test]
    fn test_validate_common_params_ws_exceeds_wl() {
        let result = validate_common_params(
            &[0],
            &["ST".to_string()],
            &[7],
            100,
            200,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not exceed"));
    }

    #[test]
    fn test_build_dda_request_basic() {
        let request = build_dda_request(
            "/tmp/test.edf",
            &[0, 1],
            &["ST".to_string()],
            200,
            100,
            &[7, 10],
            4,
            4,
            2,
            None,
            None,
            &None,
            &None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(request.window_parameters.window_length, 200);
        assert_eq!(request.window_parameters.window_step, 100);
        assert_eq!(request.delay_parameters.delays, vec![7, 10]);
    }

    #[test]
    fn test_build_dda_request_with_ct() {
        let ct_pairs = Some(vec!["0,1".to_string()]);
        let request = build_dda_request(
            "/tmp/test.edf",
            &[0, 1],
            &["CT".to_string()],
            200,
            100,
            &[7],
            4,
            4,
            2,
            None,
            None,
            &ct_pairs,
            &None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(request.window_parameters.ct_window_length, Some(2));
        assert_eq!(request.window_parameters.ct_window_step, Some(2));
        assert_eq!(request.ct_channel_pairs.unwrap(), vec![[0, 1]]);
    }

    #[test]
    fn test_compute_bounds_sample_based() {
        let (start, end) = compute_bounds(None, None, Some(0), Some(6000), None);
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(6000));
    }

    #[test]
    fn test_compute_bounds_time_based() {
        let (start, end) = compute_bounds(Some(0.0), Some(10.0), None, None, Some(256.0));
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(2560));
    }

    #[test]
    fn test_compute_bounds_none() {
        let (start, end) = compute_bounds(None, None, None, None, None);
        assert_eq!(start, None);
        assert_eq!(end, None);
    }
}
