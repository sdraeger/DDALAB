use crate::cli::{self, RunArgs};
use crate::exit_codes;
use crate::output;
use dda_rs::{
    format_select_mask, generate_select_mask, AlgorithmSelection, DDARequest, DDARunner,
    DelayParameters, FileType, ModelParameters, PreprocessingOptions, TimeRange, VariantMetadata,
    WindowParameters,
};
use std::path::Path;

pub async fn execute(args: RunArgs) -> i32 {
    // Validate inputs
    if let Err(msg) = validate_args(&args) {
        eprintln!("Error: {}", msg);
        return exit_codes::INPUT_ERROR;
    }

    // Resolve DDA binary
    let runner = match resolve_runner(&args.binary) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::BINARY_NOT_FOUND;
        }
    };

    // Build DDARequest
    let request = match build_request(&args) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    // Compute sample bounds
    let (start_bound, end_bound) = compute_bounds(&args);

    if !args.quiet {
        eprintln!("Running DDA analysis on {}...", args.file);
        eprintln!(
            "  Variants: {}",
            args.variants.join(", ")
        );
        eprintln!(
            "  Channels: {:?}",
            args.channels
        );
        eprintln!(
            "  Window: length={}, step={}",
            args.wl, args.ws
        );
    }

    // Execute analysis
    match runner.run(&request, start_bound, end_bound, None).await {
        Ok(result) => {
            match output::to_json(&result, args.compact) {
                Ok(json) => {
                    if let Err(e) = output::write_output(&json, args.output.as_deref()) {
                        eprintln!("Error: {}", e);
                        return exit_codes::EXECUTION_ERROR;
                    }
                    if !args.quiet {
                        if let Some(ref path) = args.output {
                            eprintln!("Results written to {}", path);
                        }
                    }
                    exit_codes::SUCCESS
                }
                Err(e) => {
                    eprintln!("Error serializing result: {}", e);
                    exit_codes::EXECUTION_ERROR
                }
            }
        }
        Err(e) => {
            eprintln!("DDA execution failed: {}", e);
            exit_codes::EXECUTION_ERROR
        }
    }
}

fn resolve_runner(binary_path: &Option<String>) -> Result<DDARunner, String> {
    match binary_path {
        Some(path) => DDARunner::new(path).map_err(|e| e.to_string()),
        None => DDARunner::discover().map_err(|e| e.to_string()),
    }
}

fn validate_args(args: &RunArgs) -> Result<(), String> {
    // File existence
    if !Path::new(&args.file).exists() {
        return Err(format!("Input file not found: {}", args.file));
    }

    // File extension
    let ext = Path::new(&args.file)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if FileType::from_extension(ext).is_none() {
        return Err(format!(
            "Unsupported file extension '{}'. Supported: edf, ascii, txt, csv",
            ext
        ));
    }

    // Channels
    if args.channels.is_empty() {
        return Err("At least one channel must be specified".to_string());
    }

    // Variant names
    for v in &args.variants {
        if VariantMetadata::from_abbrev(v).is_none() {
            return Err(format!(
                "Unknown variant '{}'. Valid variants: ST, CT, CD, DE, SY",
                v
            ));
        }
    }

    // CT requires pairs
    if args.variants.iter().any(|v| v == "CT") && args.ct_pairs.is_none() {
        return Err("CT variant requires --ct-pairs (e.g., --ct-pairs \"0,1\" \"0,2\")".to_string());
    }

    // CD requires pairs
    if args.variants.iter().any(|v| v == "CD") && args.cd_pairs.is_none() {
        return Err("CD variant requires --cd-pairs (e.g., --cd-pairs \"0,1\" \"1,0\")".to_string());
    }

    // Delay range
    for &d in &args.delays {
        if d < -100 || d > 100 {
            return Err(format!("Delay value {} is out of range [-100, 100]", d));
        }
    }

    // Window parameters
    if args.wl == 0 {
        return Err("Window length (--wl) must be greater than 0".to_string());
    }
    if args.ws == 0 {
        return Err("Window step (--ws) must be greater than 0".to_string());
    }
    if args.ws > args.wl {
        return Err(format!(
            "Window step ({}) must not exceed window length ({})",
            args.ws, args.wl
        ));
    }

    // Validate pair formats
    if let Some(ref pairs) = args.ct_pairs {
        for p in pairs {
            cli::parse_pair(p)?;
        }
    }
    if let Some(ref pairs) = args.cd_pairs {
        for p in pairs {
            cli::parse_pair(p)?;
        }
    }

    Ok(())
}

fn build_request(args: &RunArgs) -> Result<DDARequest, String> {
    let variant_refs: Vec<&str> = args.variants.iter().map(|s| s.as_str()).collect();
    let mask = generate_select_mask(&variant_refs);
    let mask_str = format_select_mask(&mask);

    let ct_channel_pairs = args
        .ct_pairs
        .as_ref()
        .map(|pairs| cli::parse_pairs(pairs))
        .transpose()?;

    let cd_channel_pairs = args
        .cd_pairs
        .as_ref()
        .map(|pairs| cli::parse_pairs(pairs))
        .transpose()?;

    // Determine CT window params: use explicit values, or default to 2 when CT/CD is enabled
    let needs_ct_params = args.variants.iter().any(|v| v == "CT" || v == "CD" || v == "DE");
    let ct_wl = args.ct_wl.or(if needs_ct_params { Some(2) } else { None });
    let ct_ws = args.ct_ws.or(if needs_ct_params { Some(2) } else { None });

    Ok(DDARequest {
        file_path: args.file.clone(),
        channels: Some(args.channels.clone()),
        time_range: TimeRange {
            start: args.start.unwrap_or(0.0),
            end: args.end.unwrap_or(f64::MAX),
        },
        preprocessing_options: PreprocessingOptions {
            highpass: None,
            lowpass: None,
        },
        algorithm_selection: AlgorithmSelection {
            enabled_variants: args.variants.clone(),
            select_mask: Some(mask_str),
        },
        window_parameters: WindowParameters {
            window_length: args.wl,
            window_step: args.ws,
            ct_window_length: ct_wl,
            ct_window_step: ct_ws,
        },
        delay_parameters: DelayParameters {
            delays: args.delays.clone(),
        },
        ct_channel_pairs,
        cd_channel_pairs,
        model_parameters: Some(ModelParameters {
            dm: args.dm,
            order: args.order,
            nr_tau: args.nr_tau,
        }),
        variant_configs: None,
        sampling_rate: args.sr,
    })
}

fn compute_bounds(args: &RunArgs) -> (Option<u64>, Option<u64>) {
    // Sample-based bounds take precedence
    if args.start_sample.is_some() || args.end_sample.is_some() {
        return (args.start_sample, args.end_sample);
    }

    // Time-based bounds require sampling rate
    if let (Some(start), Some(end), Some(sr)) = (args.start, args.end, args.sr) {
        let start_sample = (start * sr) as u64;
        let end_sample = (end * sr) as u64;
        return (Some(start_sample), Some(end_sample));
    }

    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_args() -> RunArgs {
        RunArgs {
            file: "/tmp/test.edf".to_string(),
            channels: vec![0, 1, 2],
            variants: vec!["ST".to_string()],
            wl: 200,
            ws: 100,
            ct_wl: None,
            ct_ws: None,
            delays: vec![7, 10],
            dm: 4,
            order: 4,
            nr_tau: 2,
            ct_pairs: None,
            cd_pairs: None,
            start: None,
            end: None,
            start_sample: None,
            end_sample: None,
            sr: None,
            binary: None,
            output: None,
            compact: false,
            quiet: false,
        }
    }

    #[test]
    fn test_build_request_defaults() {
        // Create a temp file so validation passes
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();

        let request = build_request(&args).unwrap();
        assert_eq!(request.window_parameters.window_length, 200);
        assert_eq!(request.window_parameters.window_step, 100);
        assert_eq!(request.delay_parameters.delays, vec![7, 10]);
        assert!(request.model_parameters.is_some());
        let model = request.model_parameters.unwrap();
        assert_eq!(model.dm, 4);
        assert_eq!(model.order, 4);
        assert_eq!(model.nr_tau, 2);
    }

    #[test]
    fn test_build_request_with_ct_pairs() {
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();
        args.variants = vec!["CT".to_string()];
        args.ct_pairs = Some(vec!["0,1".to_string(), "0,2".to_string()]);

        let request = build_request(&args).unwrap();
        let pairs = request.ct_channel_pairs.unwrap();
        assert_eq!(pairs, vec![[0, 1], [0, 2]]);
        // CT should trigger default ct_wl/ct_ws
        assert_eq!(request.window_parameters.ct_window_length, Some(2));
        assert_eq!(request.window_parameters.ct_window_step, Some(2));
    }

    #[test]
    fn test_validate_invalid_variant() {
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();
        args.variants = vec!["INVALID".to_string()];

        let result = validate_args(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown variant"));
    }

    #[test]
    fn test_validate_ct_without_pairs() {
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();
        args.variants = vec!["CT".to_string()];

        let result = validate_args(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("--ct-pairs"));
    }

    #[test]
    fn test_validate_cd_without_pairs() {
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();
        args.variants = vec!["CD".to_string()];

        let result = validate_args(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("--cd-pairs"));
    }

    #[test]
    fn test_validate_delay_out_of_range() {
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();
        args.delays = vec![1, 200];

        let result = validate_args(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of range"));
    }

    #[test]
    fn test_validate_ws_greater_than_wl() {
        let tmp = tempfile::Builder::new()
            .suffix(".edf")
            .tempfile()
            .unwrap();
        let mut args = make_test_args();
        args.file = tmp.path().to_str().unwrap().to_string();
        args.wl = 100;
        args.ws = 200;

        let result = validate_args(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not exceed"));
    }

    #[test]
    fn test_compute_bounds_sample_based() {
        let mut args = make_test_args();
        args.start_sample = Some(0);
        args.end_sample = Some(6000);

        let (start, end) = compute_bounds(&args);
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(6000));
    }

    #[test]
    fn test_compute_bounds_time_based() {
        let mut args = make_test_args();
        args.start = Some(0.0);
        args.end = Some(10.0);
        args.sr = Some(256.0);

        let (start, end) = compute_bounds(&args);
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(2560));
    }

    #[test]
    fn test_compute_bounds_none() {
        let args = make_test_args();
        let (start, end) = compute_bounds(&args);
        assert_eq!(start, None);
        assert_eq!(end, None);
    }

    #[test]
    fn test_select_mask_generation() {
        let args = RunArgs {
            variants: vec!["ST".to_string(), "CD".to_string()],
            ..make_test_args()
        };
        let variant_refs: Vec<&str> = args.variants.iter().map(|s| s.as_str()).collect();
        let mask = generate_select_mask(&variant_refs);
        let mask_str = format_select_mask(&mask);
        assert_eq!(mask_str, "1 0 1 0 0 0");
    }
}
