use crate::cli::args as cli;
use crate::blocks::validate_request;
use crate::{
    format_select_mask, generate_select_mask, AlgorithmSelection, ComputeDevice, DDARequest,
    DDAResult, DelayParameters, FileType, ModelParameters, PreprocessingOptions, PureRustOptions,
    PureRustProgress, PureRustRunner, TimeRange, VariantChannelConfig, WindowParameters,
};
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};
use std::path::Path;

fn pure_rust_common_support_reason(request: &DDARequest) -> Result<(), String> {
    if request
        .delay_parameters
        .delays
        .iter()
        .any(|delay| *delay < 0)
    {
        return Err(
            "delay values must be non-negative because negative delays imply lookahead".to_string(),
        );
    }
    let nr_tau = request
        .model_parameters
        .as_ref()
        .map(|model| model.nr_tau as usize)
        .unwrap_or(crate::DEFAULT_NUM_TAU as usize);
    if request.delay_parameters.delays.len() < nr_tau {
        return Err(format!(
            "pure Rust DDA needs at least nr_tau={} delays, but only {} were supplied",
            nr_tau,
            request.delay_parameters.delays.len()
        ));
    }
    Ok(())
}

pub fn pure_rust_matrix_support_reason(request: &DDARequest) -> Result<(), String> {
    pure_rust_common_support_reason(request)
}

pub async fn execute_request_on_matrix_with_progress_on_device<F>(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
    device: ComputeDevice,
    on_progress: F,
) -> Result<DDAResult, String>
where
    F: FnMut(&PureRustProgress),
{
    pure_rust_matrix_support_reason(request)
        .map_err(|reason| format!("Pure Rust DDA cannot execute this request: {}", reason))?;
    run_on_samples(request, samples, channel_labels, device, on_progress)
}

/// Runs `request` on `samples` (rows of channels) once `validate_request` accepts it for their columns.
fn run_on_samples<F>(
    request: &DDARequest,
    samples: &[Vec<f64>],
    channel_labels: Option<&[String]>,
    device: ComputeDevice,
    on_progress: F,
) -> Result<DDAResult, String>
where
    F: FnMut(&PureRustProgress),
{
    validate_request(request, samples.first().map_or(0, Vec::len))
        .map_err(|error| format!("Pure Rust DDA cannot execute this request: {error}"))?;
    PureRustRunner::new(PureRustOptions {
        compute_device: device,
        ..PureRustOptions::default()
    })
    .run_on_matrix_with_progress(request, samples, channel_labels, on_progress)
    .map_err(|error| format!("Pure Rust DDA failed: {}", error))
}

const VARIANT_IDS: &[(&str, &str)] = &[
    ("ST", "single_timeseries"),
    ("CT", "cross_timeseries"),
    ("CD", "cross_dynamical"),
    ("CCD", "conditional_cross_dynamical"),
    ("CCDLOG", "conditional_cross_dynamical_log_mse_ratio"),
    ("CCDPR2", "conditional_cross_dynamical_partial_r2"),
    ("CCDSIG", "conditional_cross_dynamical_significance"),
    ("CCDSTAB", "conditional_cross_dynamical_stability"),
    (
        "TRCCD",
        "temporally_regularized_conditional_cross_dynamical",
    ),
    ("MVCCD", "multivariate_conditional_cross_dynamical"),
    ("DE", "dynamical_ergodicity"),
    ("SY", "synchronization"),
];

pub fn supported_variant_ids() -> impl Iterator<Item = &'static str> {
    VARIANT_IDS.iter().map(|(variant_id, _)| *variant_id)
}

pub fn app_variant_ids() -> impl Iterator<Item = &'static str> {
    VARIANT_IDS.iter().map(|(_, app_id)| *app_id)
}

/// Normalize variant IDs to canonical abbreviations used by dda-rs.
/// Accepts both app IDs and CLI abbreviations.
pub fn normalize_variant_id(input: &str) -> Option<&'static str> {
    match input.trim().to_lowercase().as_str() {
        "st" | "single_timeseries" | "single-timeseries" | "single timeseries" => Some("ST"),
        "ct" | "cross_timeseries" | "cross-timeseries" | "cross timeseries" => Some("CT"),
        "cd" | "cross_dynamical" | "cross-dynamical" | "cross dynamical" => Some("CD"),
        "ccd"
        | "conditional_cross_dynamical"
        | "conditional-cross-dynamical"
        | "conditional cross dynamical" => Some("CCD"),
        "ccdlog"
        | "conditional_cross_dynamical_log_mse_ratio"
        | "conditional-cross-dynamical-log-mse-ratio"
        | "conditional cross dynamical log mse ratio" => Some("CCDLOG"),
        "ccdpr2"
        | "conditional_cross_dynamical_partial_r2"
        | "conditional-cross-dynamical-partial-r2"
        | "conditional cross dynamical partial r2" => Some("CCDPR2"),
        "ccdsig"
        | "conditional_cross_dynamical_significance"
        | "conditional-cross-dynamical-significance"
        | "conditional cross dynamical significance" => Some("CCDSIG"),
        "ccdstab"
        | "conditional_cross_dynamical_stability"
        | "conditional-cross-dynamical-stability"
        | "conditional cross dynamical stability" => Some("CCDSTAB"),
        "trccd"
        | "temporally_regularized_conditional_cross_dynamical"
        | "temporally-regularized-conditional-cross-dynamical"
        | "temporally regularized conditional cross dynamical" => Some("TRCCD"),
        "mvccd"
        | "multivariate_conditional_cross_dynamical"
        | "multivariate-conditional-cross-dynamical"
        | "multivariate conditional cross dynamical" => Some("MVCCD"),
        "de" | "dynamical_ergodicity" | "dynamical-ergodicity" | "dynamical ergodicity" => {
            Some("DE")
        }
        "sy" | "synchronization" | "synchronisation" => Some("SY"),
        _ => None,
    }
}

pub fn variant_app_id(abbrev: &str) -> Option<&'static str> {
    VARIANT_IDS
        .iter()
        .find_map(|(candidate, app_id)| (*candidate == abbrev).then_some(*app_id))
}

/// Normalize and deduplicate variants while preserving input order.
pub fn normalize_variants(variants: &[String]) -> Result<Vec<String>, String> {
    let mut normalized = Vec::with_capacity(variants.len());
    for v in variants {
        let abbrev = normalize_variant_id(v).ok_or_else(|| {
            format!(
                "Unknown variant '{}'. Valid variants: {} (or app IDs like single_timeseries)",
                v,
                supported_variant_ids().collect::<Vec<_>>().join(", ")
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
    conditioning_channels: Option<Vec<usize>>,
    conditioning_strategy: Option<crate::CcdConditioningStrategy>,
    surrogate_shifts: Option<Vec<usize>>,
    temporal_lambda: Option<f64>,
    max_active_sources: Option<usize>,
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
                "Unknown variant config key '{}'. Expected ST/CT/CD/CCD/CCDLOG/CCDPR2/CCDSIG/CCDSTAB/TRCCD/MVCCD/DE/SY or app IDs",
                key
            ));
        };
        let canonical_key = variant_app_id(abbrev)
            .unwrap_or("single_timeseries")
            .to_string();
        configs.insert(
            canonical_key,
            VariantChannelConfig {
                selected_channels: cfg.selected_channels,
                ct_channel_pairs: cfg.ct_channel_pairs,
                cd_channel_pairs: cfg.cd_channel_pairs,
                conditioning_channels: cfg.conditioning_channels,
                conditioning_strategy: cfg.conditioning_strategy,
                surrogate_shifts: cfg.surrogate_shifts,
                temporal_lambda: cfg.temporal_lambda,
                max_active_sources: cfg.max_active_sources,
            },
        );
    }

    Ok(configs)
}

pub struct PreparedSelection {
    pub variants: Vec<String>,
    pub channels: Vec<usize>,
    pub ct_pairs: Option<Vec<[usize; 2]>>,
    pub cd_pairs: Option<Vec<[usize; 2]>>,
    pub variant_configs: Option<HashMap<String, VariantChannelConfig>>,
}

/// Normalize the shared channel, pair, and per-variant CLI inputs.
pub fn prepare_selection(
    channels: Option<Vec<usize>>,
    variants: &[String],
    ct_pairs: Option<&[String]>,
    cd_pairs: Option<&[String]>,
    variant_configs_path: Option<&str>,
) -> Result<PreparedSelection, String> {
    let variants = normalize_variants(variants)?;
    let ct_pairs = ct_pairs.map(cli::parse_pairs).transpose()?;
    let cd_pairs = cd_pairs.map(cli::parse_pairs).transpose()?;
    let variant_configs = variant_configs_path.map(load_variant_configs).transpose()?;
    let mut channel_set: BTreeSet<usize> = channels.unwrap_or_default().into_iter().collect();
    let mut ct_pairs = ct_pairs;
    let mut cd_pairs = cd_pairs;

    if let Some(configs) = &variant_configs {
        if let Some(pairs) = configs
            .get("cross_timeseries")
            .and_then(|config| config.ct_channel_pairs.as_ref())
            .filter(|pairs| !pairs.is_empty())
        {
            ct_pairs = Some(pairs.clone());
        }
        if let Some(pairs) = configs
            .get("cross_dynamical")
            .and_then(|config| config.cd_channel_pairs.as_ref())
            .filter(|pairs| !pairs.is_empty())
        {
            cd_pairs = Some(pairs.clone());
        }

        let configured_channels = [
            "single_timeseries",
            "dynamical_ergodicity",
            "synchronization",
        ]
        .iter()
        .filter_map(|key| configs.get(*key))
        .filter_map(|config| config.selected_channels.as_ref())
        .flatten()
        .copied()
        .collect::<BTreeSet<_>>();
        if !configured_channels.is_empty() {
            channel_set = configured_channels;
        }
    }

    Ok(PreparedSelection {
        variants,
        channels: channel_set.into_iter().collect(),
        ct_pairs,
        cd_pairs,
        variant_configs,
    })
}

/// Validates the DDA parameters that do not depend on the recording; an empty channel selection is filled in
/// once the recording is open.
pub fn validate_params(
    variants: &[String],
    delays: &[i32],
    wl: u32,
    ws: u32,
    ct_pairs: &Option<Vec<[usize; 2]>>,
    cd_pairs: &Option<Vec<[usize; 2]>>,
) -> Result<(), String> {
    let normalized_variants = normalize_variants(variants)?;

    // CT requires pairs
    if normalized_variants.iter().any(|v| v == "CT")
        && !matches!(ct_pairs, Some(pairs) if !pairs.is_empty())
    {
        return Err(
            "CT variant requires --ct-pairs (e.g., --ct-pairs \"0,1\" \"0,2\")".to_string(),
        );
    }

    // CD requires pairs
    if normalized_variants.iter().any(|v| v == "CD")
        && !matches!(cd_pairs, Some(pairs) if !pairs.is_empty())
    {
        return Err(
            "CD variant requires --cd-pairs (e.g., --cd-pairs \"0,1\" \"1,0\")".to_string(),
        );
    }

    // Delay values must be non-negative; negative values imply lookahead.
    for &d in delays {
        if d < 0 {
            return Err(format!(
                "Delay value {} is invalid: delays must be non-negative because negative delays imply lookahead",
                d
            ));
        }
    }

    // Delay range
    for &d in delays {
        if d > 100 {
            return Err(format!("Delay value {} is out of range [0, 100]", d));
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

    // Validate pair semantics in the same CT-before-CD order used above.
    for (variant, pairs) in [("CT", ct_pairs), ("CD", cd_pairs)] {
        if let Some(pairs) = pairs {
            if pairs.iter().any(|pair| pair[0] == pair[1]) {
                return Err(format!(
                    "{} channel pairs cannot contain identical channels",
                    variant
                ));
            }
        }
    }

    Ok(())
}

/// Inputs used to construct a DDA request from CLI parameters.
pub struct RequestConfig<'a> {
    pub file_path: &'a str,
    pub channels: &'a [usize],
    pub variants: &'a [String],
    pub window_length: u32,
    pub window_step: u32,
    pub delays: &'a [i32],
    pub model_terms: Option<Vec<i32>>,
    pub dm: u32,
    pub order: u32,
    pub nr_tau: u32,
    pub ct_window_length: Option<u32>,
    pub ct_window_step: Option<u32>,
    pub ct_channel_pairs: Option<Vec<[usize; 2]>>,
    pub cd_channel_pairs: Option<Vec<[usize; 2]>>,
    pub sampling_rate: Option<f64>,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
    pub variant_configs: Option<HashMap<String, VariantChannelConfig>>,
}

/// Build a DDA request from normalized CLI options.
pub fn build_dda_request(config: RequestConfig<'_>) -> Result<DDARequest, String> {
    let normalized_variants = normalize_variants(config.variants)?;
    let variant_refs: Vec<&str> = normalized_variants.iter().map(|s| s.as_str()).collect();
    let mask = generate_select_mask(&variant_refs);
    let mask_str = format_select_mask(&mask);

    let channels = if config.channels.is_empty() {
        None
    } else {
        Some(config.channels.to_vec())
    };

    Ok(DDARequest {
        file_path: config.file_path.to_string(),
        channels,
        time_range: TimeRange {
            start: config.start.unwrap_or(0.0),
            end: config.end.unwrap_or(f64::MAX),
        },
        preprocessing_options: PreprocessingOptions {
            highpass: config.highpass,
            lowpass: config.lowpass,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: normalized_variants,
            select_mask: Some(mask_str),
        },
        window_parameters: WindowParameters {
            window_length: config.window_length,
            window_step: config.window_step,
            // The CT and DE channel-group size and stride; the engine groups every channel when absent.
            ct_window_length: config.ct_window_length,
            ct_window_step: config.ct_window_step,
        },
        delay_parameters: DelayParameters {
            delays: config.delays.to_vec(),
        },
        ct_channel_pairs: config.ct_channel_pairs,
        cd_channel_pairs: config.cd_channel_pairs,
        model_parameters: Some(ModelParameters {
            dm: config.dm,
            order: config.order,
            nr_tau: config.nr_tau,
        }),
        model_terms: config.model_terms.filter(|terms| !terms.is_empty()),
        variant_configs: config.variant_configs.filter(|cfg| !cfg.is_empty()),
        sampling_rate: config.sampling_rate,
    })
}

/// Check if a file extension is supported for DDA analysis.
#[allow(dead_code)]
pub fn is_supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| FileType::from_extension(ext).is_some())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_request_config<'a>(
        file_path: &'a str,
        channels: &'a [usize],
        variants: &'a [String],
        window_length: u32,
        window_step: u32,
        delays: &'a [i32],
    ) -> RequestConfig<'a> {
        RequestConfig {
            file_path,
            channels,
            variants,
            window_length,
            window_step,
            delays,
            model_terms: None,
            dm: 4,
            order: 4,
            nr_tau: 2,
            ct_window_length: None,
            ct_window_step: None,
            ct_channel_pairs: None,
            cd_channel_pairs: None,
            sampling_rate: None,
            start: None,
            end: None,
            highpass: None,
            lowpass: None,
            variant_configs: None,
        }
    }

    #[test]
    fn test_validate_params_valid() {
        let result = validate_params(&["ST".to_string()], &[7, 10], 200, 100, &None, &None);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_params_invalid_variant() {
        let result = validate_params(&["INVALID".to_string()], &[7], 200, 100, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown variant"));
    }

    #[test]
    fn test_validate_params_delay_out_of_range() {
        let result = validate_params(&["ST".to_string()], &[200], 200, 100, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of range"));
    }

    #[test]
    fn test_validate_params_negative_delay_is_rejected() {
        let result = validate_params(&["ST".to_string()], &[-7, 10], 200, 100, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("non-negative"));
    }

    #[test]
    fn test_validate_params_ws_exceeds_wl() {
        let result = validate_params(&["ST".to_string()], &[7], 100, 200, &None, &None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not exceed"));
    }

    #[test]
    fn test_normalize_variants_accepts_app_ids() {
        let normalized = normalize_variants(&[
            "single_timeseries".to_string(),
            "cross_dynamical".to_string(),
            "conditional_cross_dynamical".to_string(),
            "SY".to_string(),
        ])
        .unwrap();
        assert_eq!(normalized, vec!["ST", "CD", "CCD", "SY"]);
    }

    #[test]
    fn test_load_variant_configs_accepts_wrapped_shape() {
        let tmp = tempfile::Builder::new().suffix(".json").tempfile().unwrap();

        let json = r#"{
          "variant_configs": {
            "single_timeseries": { "selectedChannels": [0, 2] },
            "CT": { "ctChannelPairs": [[0, 1]] },
            "conditional_cross_dynamical": {
              "selectedChannels": [0, 1, 2],
              "cdChannelPairs": [[1, 0]],
              "conditioningChannels": [2]
            }
          }
        }"#;
        std::fs::write(tmp.path(), json).unwrap();

        let cfgs = load_variant_configs(tmp.path().to_str().unwrap()).unwrap();
        assert!(cfgs.contains_key("single_timeseries"));
        assert!(cfgs.contains_key("cross_timeseries"));
        assert!(cfgs.contains_key("conditional_cross_dynamical"));
        assert_eq!(
            cfgs["conditional_cross_dynamical"]
                .conditioning_channels
                .as_deref(),
            Some(&[2][..])
        );
    }

    #[test]
    fn test_build_dda_request_basic() {
        let request = build_dda_request(test_request_config(
            "/tmp/test.edf",
            &[0, 1],
            &["ST".to_string()],
            200,
            100,
            &[7, 10],
        ))
        .unwrap();
        assert_eq!(request.window_parameters.window_length, 200);
        assert_eq!(request.window_parameters.window_step, 100);
        assert_eq!(request.delay_parameters.delays, vec![7, 10]);
    }

    #[test]
    fn test_build_dda_request_with_ct() {
        let variants = ["CT".to_string()];
        let mut config = test_request_config("/tmp/test.edf", &[0, 1], &variants, 200, 100, &[7]);
        config.ct_channel_pairs = Some(vec![[0, 1]]);
        let request = build_dda_request(config).unwrap();
        // WL and WS are no group size.
        assert_eq!(request.window_parameters.ct_window_length, None);
        assert_eq!(request.window_parameters.ct_window_step, None);
        assert_eq!(request.ct_channel_pairs.unwrap(), vec![[0, 1]]);
    }

    #[tokio::test]
    async fn test_execute_request_on_matrix_accepts_non_ascii_source_path() {
        let variants = ["ST".to_string()];
        let mut config = test_request_config("/tmp/test.edf", &[0, 1], &variants, 32, 16, &[1, 2]);
        config.start = Some(0.0);
        config.end = Some(63.0);
        let request = build_dda_request(config).unwrap();

        let samples = (0..64)
            .map(|index| {
                let x = index as f64 * 0.05;
                vec![x.sin(), (x * 1.7).cos()]
            })
            .collect::<Vec<_>>();
        let labels = vec!["A".to_string(), "B".to_string()];

        let result = execute_request_on_matrix_with_progress_on_device(
            &request,
            &samples,
            Some(labels.as_slice()),
            ComputeDevice::Cpu,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(result.file_path, "/tmp/test.edf");
    }

    #[tokio::test]
    async fn test_execute_request_on_matrix_refuses_out_of_range_variant_configs() {
        let variants = ["CCD".to_string()];
        let mut config = test_request_config("/tmp/test.edf", &[], &variants, 32, 16, &[1, 2]);
        config.end = Some(63.0);
        config.variant_configs = Some(HashMap::from([(
            "conditional_cross_dynamical".to_string(),
            VariantChannelConfig {
                selected_channels: None,
                ct_channel_pairs: None,
                cd_channel_pairs: Some(vec![[0, 9]]),
                conditioning_channels: None,
                conditioning_strategy: None,
                surrogate_shifts: None,
                temporal_lambda: None,
                max_active_sources: None,
            },
        )]));
        let request = build_dda_request(config).unwrap();
        let samples = (0..64)
            .map(|index| vec![(index as f64 * 0.05).sin(), (index as f64 * 0.09).cos()])
            .collect::<Vec<_>>();

        let error = execute_request_on_matrix_with_progress_on_device(
            &request,
            &samples,
            None,
            ComputeDevice::Cpu,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("channel 9 is out of range"), "{error}");
    }
}
