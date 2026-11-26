// The DDA request of the command line's flags, which `run`, `batch`, MCP and the Python package all make here.
use crate::cli::args::{parse_pairs, DdaArgs};
use crate::{
    select_mask, AlgorithmSelection, DDARequest, DelayParameters, ModelParameters,
    PreprocessingOptions, TimeRange, Variant, VariantChannelConfig, WindowParameters,
};
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};

/// The abbreviations of `variants` (any name `Variant::find` knows), deduplicated in input order.
pub fn normalize_variants(variants: &[String]) -> Result<Vec<String>, String> {
    let mut normalized: Vec<String> = Vec::with_capacity(variants.len());
    for name in variants {
        let abbreviation = Variant::find(name).map(|v| v.abbreviation).ok_or_else(|| {
            format!(
                "Unknown variant '{name}'. Valid variants: {} (or app IDs like single_timeseries)",
                crate::VARIANTS
                    .iter()
                    .map(|v| v.abbreviation)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
        if !normalized.iter().any(|existing| existing == abbreviation) {
            normalized.push(abbreviation.to_string());
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

/// The variant configs of the JSON file at `path`, keyed by app id: a map from any variant name to its config, or
/// such a map under "variant_configs".
fn load_variant_configs(path: &str) -> Result<HashMap<String, VariantChannelConfig>, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read variant config file '{}': {}", path, e))?;
    let mut value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse variant config JSON '{}': {}", path, e))?;
    if let Some(nested) = value.get("variant_configs").cloned() {
        value = nested;
    }
    let parsed: HashMap<String, VariantConfigInput> = serde_json::from_value(value)
        .map_err(|e| format!("Invalid variant config shape in '{}': {}", path, e))?;

    parsed
        .into_iter()
        .map(|(key, cfg)| {
            let variant = Variant::find(&key).ok_or_else(|| {
                format!(
                    "Unknown variant config key '{key}'. Expected a variant abbreviation or app ID"
                )
            })?;
            let config = VariantChannelConfig {
                selected_channels: cfg.selected_channels,
                ct_channel_pairs: cfg.ct_channel_pairs,
                cd_channel_pairs: cfg.cd_channel_pairs,
                conditioning_channels: cfg.conditioning_channels,
                conditioning_strategy: cfg.conditioning_strategy,
                surrogate_shifts: cfg.surrogate_shifts,
                temporal_lambda: cfg.temporal_lambda,
                max_active_sources: cfg.max_active_sources,
            };
            Ok((variant.app_id.to_string(), config))
        })
        .collect()
}

/// Physical-time overrides (`--wl-s`, `--ws-s`, `--delays-ms`) resolved per recording once its sampling rate is known.
#[derive(Debug, Clone, Default)]
pub struct PhysicalTiming {
    pub wl_s: Option<f64>,
    pub ws_s: Option<f64>,
    pub delays_ms: Option<Vec<f64>>,
    pub ws_explicit: bool,
}

impl PhysicalTiming {
    pub fn is_empty(&self) -> bool {
        self.wl_s.is_none() && self.ws_s.is_none() && self.delays_ms.is_none()
    }

    /// Resolves any physical-time flags into integer samples on `request` for a recording sampled at `sample_rate_hz`.
    pub fn resolve(&self, request: &mut DDARequest, sample_rate_hz: f64) -> Result<(), String> {
        if self.is_empty() {
            return Ok(());
        }
        if !sample_rate_hz.is_finite() || sample_rate_hz <= 0.0 {
            return Err(format!(
                "Cannot convert physical-time parameters without a positive sampling rate (got {sample_rate_hz})"
            ));
        }
        if let Some(wl_s) = self.wl_s {
            let wl = seconds_to_samples(wl_s, sample_rate_hz, "--wl-s")?;
            request.window_parameters.window_length = wl;
            if self.ws_s.is_none() && !self.ws_explicit {
                request.window_parameters.window_step = (wl / 2).max(1);
            }
        }
        if let Some(ws_s) = self.ws_s {
            request.window_parameters.window_step =
                seconds_to_samples(ws_s, sample_rate_hz, "--ws-s")?;
        }
        let wl = request.window_parameters.window_length;
        let ws = request.window_parameters.window_step;
        if ws > wl {
            return Err(format!(
                "Window step ({ws} samples) must not exceed window length ({wl} samples) at {sample_rate_hz} Hz"
            ));
        }
        if let Some(ref delays_ms) = self.delays_ms {
            let mut delays = Vec::with_capacity(delays_ms.len());
            for &ms in delays_ms {
                if !ms.is_finite() || ms < 0.0 {
                    return Err(format!(
                        "Delay value {ms} ms is invalid: delays must be non-negative"
                    ));
                }
                let raw = ms * 1e-3 * sample_rate_hz;
                if !raw.is_finite() || raw > i32::MAX as f64 {
                    return Err(format!(
                        "Delay value {ms} ms overflows sample count at {sample_rate_hz} Hz"
                    ));
                }
                let samples = if ms == 0.0 {
                    0
                } else {
                    raw.round().max(1.0) as i32
                };
                delays.push(samples);
            }
            request.delay_parameters.delays = delays;
        }
        check_request(request)?;
        Ok(())
    }
}

fn seconds_to_samples(seconds: f64, sample_rate_hz: f64, flag: &str) -> Result<u32, String> {
    let raw = seconds * sample_rate_hz;
    if !raw.is_finite() || raw <= 0.0 || raw > u32::MAX as f64 {
        return Err(format!(
            "{flag} {seconds} s cannot be converted to a sample count at {sample_rate_hz} Hz"
        ));
    }
    Ok(raw.round().max(1.0) as u32)
}

impl DdaArgs {
    /// Physical-time overrides to resolve once each recording's sampling rate is known.
    pub fn physical_timing(&self) -> PhysicalTiming {
        PhysicalTiming {
            wl_s: self.wl_s,
            ws_s: self.ws_s,
            delays_ms: self.delays_ms.clone(),
            ws_explicit: self.ws.is_some(),
        }
    }

    /// Sample-domain window length (or default when `--wl` is omitted).
    pub fn wl_samples(&self) -> u32 {
        self.wl.unwrap_or(crate::DEFAULT_WINDOW_LENGTH)
    }

    /// Sample-domain window step (or default when `--ws` is omitted).
    pub fn ws_samples(&self) -> u32 {
        self.ws.unwrap_or(crate::DEFAULT_WINDOW_STEP)
    }

    /// The request these flags make of `file`, or the message refusing them. A variant config's CT and CD pairs
    /// replace `--ct-pairs` and `--cd-pairs`, and the ST, DE and SY configs' channels replace `--channels`. The time
    /// range is the whole recording and no channels mean its good ones: `analyze` settles both once it is open.
    pub fn request(&self, file: &str) -> Result<DDARequest, String> {
        let variants = normalize_variants(&self.variants)?;
        let mut ct_pairs = self.ct_pairs.as_deref().map(parse_pairs).transpose()?;
        let mut cd_pairs = self.cd_pairs.as_deref().map(parse_pairs).transpose()?;
        let variant_configs = self
            .variant_configs
            .as_deref()
            .map(load_variant_configs)
            .transpose()?;
        let mut channels: BTreeSet<usize> = self.channels.iter().flatten().copied().collect();
        if let Some(configs) = &variant_configs {
            let pairs = |id: &str, pick: fn(&VariantChannelConfig) -> &Option<Vec<[usize; 2]>>| {
                configs
                    .get(id)
                    .and_then(|config| pick(config).clone())
                    .filter(|pairs| !pairs.is_empty())
            };
            ct_pairs = pairs("cross_timeseries", |c| &c.ct_channel_pairs).or(ct_pairs);
            cd_pairs = pairs("cross_dynamical", |c| &c.cd_channel_pairs).or(cd_pairs);
            let configured: BTreeSet<usize> = [
                "single_timeseries",
                "dynamical_ergodicity",
                "synchronization",
            ]
            .iter()
            .filter_map(|key| configs.get(*key)?.selected_channels.as_ref())
            .flatten()
            .copied()
            .collect();
            if !configured.is_empty() {
                channels = configured;
            }
        }

        let wl = self.wl_samples();
        let ws = self.ws_samples();
        if self.wl_s.is_none() && self.ws_s.is_none() && ws > wl {
            return Err(format!(
                "Window step ({ws}) must not exceed window length ({wl})"
            ));
        }
        if let (Some(wl_s), Some(ws_s)) = (self.wl_s, self.ws_s) {
            if ws_s > wl_s {
                return Err(format!(
                    "Window step ({ws_s} s) must not exceed window length ({wl_s} s)"
                ));
            }
        }
        let delays = self
            .delays
            .clone()
            .unwrap_or_else(|| crate::DEFAULT_DELAYS.to_vec());

        let request = DDARequest {
            file_path: file.to_string(),
            channels: (!channels.is_empty()).then(|| channels.into_iter().collect()),
            time_range: TimeRange {
                start: 0.0,
                end: f64::MAX,
            },
            preprocessing_options: PreprocessingOptions {
                highpass: None,
                lowpass: None,
            },
            algorithm_selection: AlgorithmSelection {
                select_mask: Some(select_mask(&variants)),
                enabled_variants: variants,
            },
            window_parameters: WindowParameters {
                window_length: wl,
                window_step: ws,
                // The CT and DE channel-group size and stride; the engine groups every channel when absent.
                ct_window_length: self.ct_wl,
                ct_window_step: self.ct_ws,
            },
            delay_parameters: DelayParameters { delays },
            ct_channel_pairs: ct_pairs,
            cd_channel_pairs: cd_pairs,
            model_parameters: Some(ModelParameters {
                dm: self.dm,
                order: self.order,
                nr_tau: self.nr_tau,
            }),
            model_terms: self.model.clone().filter(|terms| !terms.is_empty()),
            variant_configs: variant_configs.filter(|configs| !configs.is_empty()),
            sampling_rate: self.sr,
        };
        check_request(&request)?;
        Ok(request)
    }
}

/// Refuses CT or CD without pairs, a pair of one channel twice, and a delay outside [0, 100]; the messages name
/// the flags that set them.
pub(crate) fn check_request(request: &DDARequest) -> Result<(), String> {
    let variants = &request.algorithm_selection.enabled_variants;
    for (variant, flag, pairs, example) in [
        (
            "CT",
            "--ct-pairs",
            &request.ct_channel_pairs,
            "\"0,1\" \"0,2\"",
        ),
        (
            "CD",
            "--cd-pairs",
            &request.cd_channel_pairs,
            "\"0,1\" \"1,0\"",
        ),
    ] {
        if variants.iter().any(|v| v == variant) && pairs.as_ref().is_none_or(Vec::is_empty) {
            return Err(format!(
                "{variant} variant requires {flag} (e.g., {flag} {example})"
            ));
        }
        if pairs.iter().flatten().any(|pair| pair[0] == pair[1]) {
            return Err(format!(
                "{variant} channel pairs cannot contain identical channels"
            ));
        }
    }
    let delays = &request.delay_parameters.delays;
    if let Some(d) = delays.iter().find(|&&d| d < 0) {
        return Err(format!(
            "Delay value {d} is invalid: delays must be non-negative because negative delays imply lookahead"
        ));
    }
    if let Some(d) = delays.iter().find(|&&d| d > 100) {
        return Err(format!("Delay value {d} is out of range [0, 100]"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::cli::args::{Cli, Command, DdaArgs};
    use clap::Parser;

    /// The `DdaArgs` of `ddalab run --file f.edf` and `flags`.
    fn args(flags: &[&str]) -> DdaArgs {
        let argv = ["ddalab", "run", "--file", "f.edf"].iter().chain(flags);
        match Cli::try_parse_from(argv).unwrap().command {
            Command::Run(run) => run.dda,
            _ => unreachable!(),
        }
    }

    fn refusal(flags: &[&str]) -> String {
        args(flags).request("f.edf").unwrap_err()
    }

    #[test]
    fn request_takes_the_flags() {
        let request = args(&["--wl", "200", "--ws", "100", "--delays", "7", "10"])
            .request("f.edf")
            .unwrap();
        assert_eq!(request.window_parameters.window_length, 200);
        assert_eq!(request.window_parameters.window_step, 100);
        assert_eq!(request.delay_parameters.delays, vec![7, 10]);
        let model = request.model_parameters.unwrap();
        assert_eq!((model.dm, model.order, model.nr_tau), (4, 4, 2));
        assert_eq!(request.channels, None);
    }

    #[test]
    fn request_keeps_ct_pairs_apart_from_the_group_size() {
        let request = args(&["--variants", "CT", "--ct-pairs", "0,1", "0,2"])
            .request("f.edf")
            .unwrap();
        assert_eq!(request.ct_channel_pairs.unwrap(), vec![[0, 1], [0, 2]]);
        assert_eq!(request.window_parameters.ct_window_length, None);
        assert_eq!(request.window_parameters.ct_window_step, None);
    }

    #[test]
    fn request_normalizes_app_ids_and_sets_the_mask() {
        let request = args(&[
            "--variants",
            "single_timeseries",
            "cross_dynamical",
            "SY",
            "ST",
            "--cd-pairs",
            "0,1",
        ])
        .request("f.edf")
        .unwrap();
        let selection = request.algorithm_selection;
        assert_eq!(selection.enabled_variants, vec!["ST", "CD", "SY"]);
        assert_eq!(selection.select_mask.as_deref(), Some("1 0 1 0 0 1"));
    }

    #[test]
    fn request_refuses_what_the_engine_cannot_run() {
        for (flags, message) in [
            (&["--variants", "INVALID"][..], "Unknown variant"),
            (&["--delays", "1", "200"], "out of range"),
            (&["--delays=-1"], "non-negative"),
            (&["--wl", "100", "--ws", "200"], "must not exceed"),
            (&["--variants", "CT"], "--ct-pairs"),
            (&["--variants", "CD"], "--cd-pairs"),
            (&["--variants", "CD", "--cd-pairs", "1,1"], "identical"),
        ] {
            assert!(refusal(flags).contains(message), "{flags:?}");
        }
    }

    #[test]
    fn request_reads_wrapped_variant_configs() {
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
        let path = tmp.path().to_str().unwrap();
        let request = args(&["--variant-configs", path]).request("f.edf").unwrap();
        let configs = request.variant_configs.unwrap();
        assert!(configs.contains_key("single_timeseries"));
        assert!(configs.contains_key("cross_timeseries"));
        assert_eq!(
            configs["conditional_cross_dynamical"]
                .conditioning_channels
                .as_deref(),
            Some(&[2][..])
        );
        assert_eq!(request.channels, Some(vec![0, 2]));
        assert_eq!(request.ct_channel_pairs, Some(vec![[0, 1]]));
    }

    #[test]
    fn physical_timing_resolves_against_sampling_rate() {
        let dda = args(&["--wl-s", "0.5", "--delays-ms", "14", "20"]);
        let mut req = dda.request("f.edf").unwrap();
        dda.physical_timing().resolve(&mut req, 500.0).unwrap();
        assert_eq!(req.window_parameters.window_length, 250);
        // Default 50% overlap when --wl-s is used without --ws or --ws-s.
        assert_eq!(req.window_parameters.window_step, 125);
        assert_eq!(req.delay_parameters.delays, vec![7, 10]);

        // At 1000 Hz, the same physical delays double in samples.
        let mut req_1k = dda.request("f.edf").unwrap();
        dda.physical_timing().resolve(&mut req_1k, 1000.0).unwrap();
        assert_eq!(req_1k.window_parameters.window_length, 500);
        assert_eq!(req_1k.window_parameters.window_step, 250);
        assert_eq!(req_1k.delay_parameters.delays, vec![14, 20]);
    }

    #[test]
    fn physical_timing_rejects_conflicting_flags() {
        assert!(Cli::try_parse_from(["ddalab", "run", "--file", "f.edf", "--wl", "200", "--wl-s", "0.5"]).is_err());
        assert!(Cli::try_parse_from(["ddalab", "run", "--file", "f.edf", "--delays", "7", "--delays-ms", "14"]).is_err());
    }
}
