use crate::cli;
use dda_rs::{
    format_select_mask, generate_select_mask, AlgorithmSelection, DDARequest, DDARunner,
    DelayParameters, FileType, ModelParameters, PreprocessingOptions, TimeRange,
    VariantChannelConfig, WindowParameters,
};
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};
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

/// Normalize variant IDs to canonical abbreviations used by dda-rs.
/// Accepts both app IDs and CLI abbreviations.
pub fn normalize_variant_id(input: &str) -> Option<&'static str> {
    match input.trim().to_lowercase().as_str() {
        "st" | "single_timeseries" | "single-timeseries" | "single timeseries" => Some("ST"),
        "ct" | "cross_timeseries" | "cross-timeseries" | "cross timeseries" => Some("CT"),
        "cd" | "cross_dynamical" | "cross-dynamical" | "cross dynamical" => Some("CD"),
        "de" | "dynamical_ergodicity" | "dynamical-ergodicity" | "dynamical ergodicity" => {
            Some("DE")
        }
        "sy" | "synchronization" | "synchronisation" => Some("SY"),
        _ => None,
    }
}

fn to_variant_config_key(abbrev: &str) -> &'static str {
    match abbrev {
        "ST" => "single_timeseries",
        "CT" => "cross_timeseries",
        "CD" => "cross_dynamical",
        "DE" => "dynamical_ergodicity",
        "SY" => "synchronization",
        _ => "single_timeseries",
    }
}

/// Normalize and deduplicate variants while preserving input order.
pub fn normalize_variants(variants: &[String]) -> Result<Vec<String>, String> {
    let mut normalized = Vec::with_capacity(variants.len());
    for v in variants {
        let abbrev = normalize_variant_id(v).ok_or_else(|| {
            format!(
                "Unknown variant '{}'. Valid variants: ST, CT, CD, DE, SY (or app IDs like single_timeseries)",
                v
            )
        })?;

        if !normalized.iter().any(|existing| existing == abbrev) {
            normalized.push(abbrev.to_string());
        }
    }
    Ok(normalized)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VariantConfigInput {
    selected_channels: Option<Vec<usize>>,
    ct_channel_pairs: Option<Vec<[usize; 2]>>,
    cd_channel_pairs: Option<Vec<[usize; 2]>>,
}

/// Load app-compatible variant config JSON from disk.
///
/// Supported shapes:
/// 1) Direct map: {"single_timeseries": {...}, "cross_timeseries": {...}}
/// 2) Wrapped map: {"variant_configs": {...}}
pub fn load_variant_configs(path: &str) -> Result<HashMap<String, VariantChannelConfig>, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read variant config file '{}': {}", path, e))?;

    let mut value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse variant config JSON '{}': {}", path, e))?;

    if let Some(nested) = value.get("variant_configs").cloned() {
        value = nested;
    }

    let parsed: HashMap<String, VariantConfigInput> = serde_json::from_value(value)
        .map_err(|e| format!("Invalid variant config shape in '{}': {}", path, e))?;

    let mut configs: HashMap<String, VariantChannelConfig> = HashMap::new();
    for (key, cfg) in parsed {
        let Some(abbrev) = normalize_variant_id(&key) else {
            return Err(format!(
                "Unknown variant config key '{}'. Expected ST/CT/CD/DE/SY or app IDs",
                key
            ));
        };
        let canonical_key = to_variant_config_key(abbrev).to_string();
        configs.insert(
            canonical_key,
            VariantChannelConfig {
                selected_channels: cfg.selected_channels,
                ct_channel_pairs: cfg.ct_channel_pairs,
                cd_channel_pairs: cfg.cd_channel_pairs,
            },
        );
    }

    Ok(configs)
}

/// Merge legacy CLI channel/pair args with optional app-style variant configs.
/// Variant config values take precedence when present and non-empty.
pub fn derive_effective_channels_and_pairs(
    channels: Option<Vec<usize>>,
    ct_pairs: Option<Vec<[usize; 2]>>,
    cd_pairs: Option<Vec<[usize; 2]>>,
    variant_configs: Option<&HashMap<String, VariantChannelConfig>>,
) -> (Vec<usize>, Option<Vec<[usize; 2]>>, Option<Vec<[usize; 2]>>) {
    let mut channel_set: BTreeSet<usize> = channels.unwrap_or_default().into_iter().collect();
    let mut effective_ct = ct_pairs;
    let mut effective_cd = cd_pairs;

    if let Some(configs) = variant_configs {
        if let Some(ct_cfg) = configs.get("cross_timeseries") {
            if let Some(pairs) = &ct_cfg.ct_channel_pairs {
                if !pairs.is_empty() {
                    effective_ct = Some(pairs.clone());
                }
            }
        }
        if let Some(cd_cfg) = configs.get("cross_dynamical") {
            if let Some(pairs) = &cd_cfg.cd_channel_pairs {
                if !pairs.is_empty() {
                    effective_cd = Some(pairs.clone());
                }
            }
        }

        let mut single_variant_channels: BTreeSet<usize> = BTreeSet::new();
        for key in [
            "single_timeseries",
            "dynamical_ergodicity",
            "synchronization",
        ] {
            if let Some(cfg) = configs.get(key) {
                if let Some(chans) = &cfg.selected_channels {
                    for ch in chans {
                        single_variant_channels.insert(*ch);
                    }
                }
            }
        }
        if !single_variant_channels.is_empty() {
            channel_set = single_variant_channels;
        }
    }

    (
        channel_set.into_iter().collect(),
        effective_ct,
        effective_cd,
    )
}

/// Validate shared DDA parameters (not file-specific).
pub fn validate_common_params(
    channels: &[usize],
    variants: &[String],
    delays: &[i32],
    wl: u32,
    ws: u32,
    ct_pairs: &Option<Vec<[usize; 2]>>,
    cd_pairs: &Option<Vec<[usize; 2]>>,
) -> Result<(), String> {
    let normalized_variants = normalize_variants(variants)?;

    let requires_single_channels = normalized_variants
        .iter()
        .any(|v| v == "ST" || v == "DE" || v == "SY");

    if requires_single_channels && channels.is_empty() {
        return Err(
            "At least one channel must be specified for ST/DE/SY variants (use --channels or --variant-configs)"
                .to_string(),
        );
    }

    // CT requires pairs
    if normalized_variants.iter().any(|v| v == "CT")
        && ct_pairs.as_ref().map_or(true, |pairs| pairs.is_empty())
    {
        return Err(
            "CT variant requires --ct-pairs (e.g., --ct-pairs \"0,1\" \"0,2\")".to_string(),
        );
    }

    // CD requires pairs
    if normalized_variants.iter().any(|v| v == "CD")
        && cd_pairs.as_ref().map_or(true, |pairs| pairs.is_empty())
    {
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

    // Validate pair semantics
    if let Some(pairs) = ct_pairs {
        for pair in pairs {
            if pair[0] == pair[1] {
                return Err("CT channel pairs cannot contain identical channels".to_string());
            }
        }
    }
    if let Some(pairs) = cd_pairs {
        for pair in pairs {
            if pair[0] == pair[1] {
                return Err("CD channel pairs cannot contain identical channels".to_string());
            }
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
    model_terms: Option<Vec<i32>>,
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
    let parsed_ct_pairs = ct_pairs
        .as_ref()
        .map(|pairs| cli::parse_pairs(pairs))
        .transpose()?;

    let parsed_cd_pairs = cd_pairs
        .as_ref()
        .map(|pairs| cli::parse_pairs(pairs))
        .transpose()?;

    build_dda_request_with_options(
        file_path,
        channels,
        variants,
        wl,
        ws,
        delays,
        model_terms,
        dm,
        order,
        nr_tau,
        ct_wl,
        ct_ws,
        parsed_ct_pairs,
        parsed_cd_pairs,
        sr,
        start,
        end,
        None,
        None,
        None,
    )
}

/// Build a DDARequest with full CLI options (preprocessing + parsed pairs + variant configs).
#[allow(clippy::too_many_arguments)]
pub fn build_dda_request_with_options(
    file_path: &str,
    channels: &[usize],
    variants: &[String],
    wl: u32,
    ws: u32,
    delays: &[i32],
    model_terms: Option<Vec<i32>>,
    dm: u32,
    order: u32,
    nr_tau: u32,
    ct_wl: Option<u32>,
    ct_ws: Option<u32>,
    ct_channel_pairs: Option<Vec<[usize; 2]>>,
    cd_channel_pairs: Option<Vec<[usize; 2]>>,
    sr: Option<f64>,
    start: Option<f64>,
    end: Option<f64>,
    highpass: Option<f64>,
    lowpass: Option<f64>,
    variant_configs: Option<HashMap<String, VariantChannelConfig>>,
) -> Result<DDARequest, String> {
    let normalized_variants = normalize_variants(variants)?;
    let variant_refs: Vec<&str> = normalized_variants.iter().map(|s| s.as_str()).collect();
    let mask = generate_select_mask(&variant_refs);
    let mask_str = format_select_mask(&mask);

    // Determine CT window params: use explicit values, or fall back to WL/WS
    // whenever CT/CD/DE-specific windowing is required.
    let needs_ct_params = normalized_variants
        .iter()
        .any(|v| v == "CT" || v == "CD" || v == "DE");
    let ct_wl = ct_wl.or(if needs_ct_params { Some(wl) } else { None });
    let ct_ws = ct_ws.or(if needs_ct_params { Some(ws) } else { None });

    let channels = if channels.is_empty() {
        None
    } else {
        Some(channels.to_vec())
    };

    Ok(DDARequest {
        file_path: file_path.to_string(),
        channels,
        time_range: TimeRange {
            start: start.unwrap_or(0.0),
            end: end.unwrap_or(f64::MAX),
        },
        preprocessing_options: PreprocessingOptions { highpass, lowpass },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: normalized_variants,
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
        model_parameters: Some(ModelParameters { dm, order, nr_tau }),
        model_terms: model_terms.filter(|terms| !terms.is_empty()),
        variant_configs: variant_configs.filter(|cfg| !cfg.is_empty()),
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
        let result =
            validate_common_params(&[], &["ST".to_string()], &[7, 10], 200, 100, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("channel"));
    }

    #[test]
    fn test_validate_common_params_invalid_variant() {
        let result =
            validate_common_params(&[0], &["INVALID".to_string()], &[7], 200, 100, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown variant"));
    }

    #[test]
    fn test_validate_common_params_delay_out_of_range() {
        let result =
            validate_common_params(&[0], &["ST".to_string()], &[200], 200, 100, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of range"));
    }

    #[test]
    fn test_validate_common_params_ws_exceeds_wl() {
        let result =
            validate_common_params(&[0], &["ST".to_string()], &[7], 100, 200, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not exceed"));
    }

    #[test]
    fn test_normalize_variants_accepts_app_ids() {
        let normalized = normalize_variants(&[
            "single_timeseries".to_string(),
            "cross_dynamical".to_string(),
            "SY".to_string(),
        ])
        .unwrap();
        assert_eq!(normalized, vec!["ST", "CD", "SY"]);
    }

    #[test]
    fn test_load_variant_configs_accepts_wrapped_shape() {
        let tmp = tempfile::Builder::new().suffix(".json").tempfile().unwrap();

        let json = r#"{
          "variant_configs": {
            "single_timeseries": { "selectedChannels": [0, 2] },
            "CT": { "ctChannelPairs": [[0, 1]] }
          }
        }"#;
        std::fs::write(tmp.path(), json).unwrap();

        let cfgs = load_variant_configs(tmp.path().to_str().unwrap()).unwrap();
        assert!(cfgs.contains_key("single_timeseries"));
        assert!(cfgs.contains_key("cross_timeseries"));
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
            None,
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
            None,
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
        assert_eq!(request.window_parameters.ct_window_length, Some(200));
        assert_eq!(request.window_parameters.ct_window_step, Some(100));
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
