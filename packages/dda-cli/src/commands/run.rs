use crate::cli::RunArgs;
use crate::dda_params;
use crate::exit_codes;
use crate::output;

pub async fn execute(args: RunArgs) -> i32 {
    let normalized_variants = match dda_params::normalize_variants(&args.variants) {
        Ok(v) => v,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    let parsed_ct_pairs = match args
        .ct_pairs
        .as_ref()
        .map(|pairs| crate::cli::parse_pairs(pairs))
        .transpose()
    {
        Ok(pairs) => pairs,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    let parsed_cd_pairs = match args
        .cd_pairs
        .as_ref()
        .map(|pairs| crate::cli::parse_pairs(pairs))
        .transpose()
    {
        Ok(pairs) => pairs,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    let variant_configs = match args.variant_configs.as_deref() {
        Some(path) => match dda_params::load_variant_configs(path) {
            Ok(cfg) => Some(cfg),
            Err(msg) => {
                eprintln!("Error: {}", msg);
                return exit_codes::INPUT_ERROR;
            }
        },
        None => None,
    };

    let (effective_channels, effective_ct_pairs, effective_cd_pairs) =
        dda_params::derive_effective_channels_and_pairs(
            args.channels.clone(),
            parsed_ct_pairs,
            parsed_cd_pairs,
            variant_configs.as_ref(),
        );

    // Validate file
    if let Err(msg) = dda_params::validate_file(&args.file) {
        eprintln!("Error: {}", msg);
        return exit_codes::INPUT_ERROR;
    }

    // Validate shared params
    if let Err(msg) = dda_params::validate_common_params(
        &effective_channels,
        &normalized_variants,
        &args.delays,
        args.wl,
        args.ws,
        &effective_ct_pairs,
        &effective_cd_pairs,
    ) {
        eprintln!("Error: {}", msg);
        return exit_codes::INPUT_ERROR;
    }

    // Build DDARequest
    let request = match dda_params::build_dda_request_with_options(
        &args.file,
        &effective_channels,
        &normalized_variants,
        args.wl,
        args.ws,
        &args.delays,
        args.model.clone(),
        args.dm,
        args.order,
        args.nr_tau,
        args.ct_wl,
        args.ct_ws,
        effective_ct_pairs,
        effective_cd_pairs,
        args.sr,
        args.start,
        args.end,
        args.highpass,
        args.lowpass,
        variant_configs,
    ) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    // Compute sample bounds
    let (start_bound, end_bound) = dda_params::compute_bounds(
        args.start,
        args.end,
        args.start_sample,
        args.end_sample,
        args.sr,
    );

    if !args.quiet {
        eprintln!("Running DDA analysis on {}...", args.file);
        eprintln!("  Variants: {}", normalized_variants.join(", "));
        eprintln!("  Channels: {:?}", effective_channels);
        eprintln!("  Window: length={}, step={}", args.wl, args.ws);
        if args.highpass.is_some() || args.lowpass.is_some() {
            eprintln!(
                "  Preprocessing: highpass={:?}, lowpass={:?}",
                args.highpass, args.lowpass
            );
        }
    }

    // Execute analysis
    match dda_params::execute_request(&request, start_bound, end_bound).await {
        Ok(execution) => {
            if !args.quiet {
                let backend_label = match execution.backend {
                    dda_params::ExecutionBackend::PureRust => "pure-rust",
                };
                eprintln!("  Backend: {}", backend_label);
            }
            match output::to_json(&execution.result, args.compact) {
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

#[cfg(test)]
mod tests {
    use crate::cli::RunArgs;
    use crate::dda_params;
    use dda_rs::{format_select_mask, generate_select_mask};

    fn make_test_args() -> RunArgs {
        RunArgs {
            file: "/tmp/test.edf".to_string(),
            channels: Some(vec![0, 1, 2]),
            variants: vec!["ST".to_string()],
            wl: 200,
            ws: 100,
            ct_wl: None,
            ct_ws: None,
            delays: vec![7, 10],
            model: None,
            dm: 4,
            order: 4,
            nr_tau: 2,
            ct_pairs: None,
            cd_pairs: None,
            variant_configs: None,
            highpass: None,
            lowpass: None,
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
        let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();
        let args = make_test_args();

        let request = dda_params::build_dda_request(
            tmp.path().to_str().unwrap(),
            args.channels.as_deref().unwrap(),
            &args.variants,
            args.wl,
            args.ws,
            &args.delays,
            args.model.clone(),
            args.dm,
            args.order,
            args.nr_tau,
            args.ct_wl,
            args.ct_ws,
            &args.ct_pairs,
            &args.cd_pairs,
            args.sr,
            args.start,
            args.end,
        )
        .unwrap();
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
        let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();
        let mut args = make_test_args();
        args.variants = vec!["CT".to_string()];
        args.ct_pairs = Some(vec!["0,1".to_string(), "0,2".to_string()]);

        let request = dda_params::build_dda_request(
            tmp.path().to_str().unwrap(),
            args.channels.as_deref().unwrap(),
            &args.variants,
            args.wl,
            args.ws,
            &args.delays,
            args.model.clone(),
            args.dm,
            args.order,
            args.nr_tau,
            args.ct_wl,
            args.ct_ws,
            &args.ct_pairs,
            &args.cd_pairs,
            args.sr,
            args.start,
            args.end,
        )
        .unwrap();
        let pairs = request.ct_channel_pairs.unwrap();
        assert_eq!(pairs, vec![[0, 1], [0, 2]]);
        assert_eq!(request.window_parameters.ct_window_length, Some(200));
        assert_eq!(request.window_parameters.ct_window_step, Some(100));
    }

    #[test]
    fn test_validate_invalid_variant() {
        let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();
        let args = make_test_args();

        let result = dda_params::validate_common_params(
            args.channels.as_deref().unwrap(),
            &["INVALID".to_string()],
            &args.delays,
            args.wl,
            args.ws,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown variant"));

        // Also test file validation separately
        let _ = tmp; // keep tempfile alive
    }

    #[test]
    fn test_validate_ct_without_pairs() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["CT".to_string()],
            &[7, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("--ct-pairs"));
    }

    #[test]
    fn test_validate_cd_without_pairs() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["CD".to_string()],
            &[7, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("--cd-pairs"));
    }

    #[test]
    fn test_validate_delay_out_of_range() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[1, 200],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of range"));
    }

    #[test]
    fn test_validate_negative_delay() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[-1, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("non-negative"));
    }

    #[test]
    fn test_validate_ws_greater_than_wl() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[7, 10],
            100,
            200,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not exceed"));
    }

    #[test]
    fn test_compute_bounds_sample_based() {
        let (start, end) = dda_params::compute_bounds(None, None, Some(0), Some(6000), None);
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(6000));
    }

    #[test]
    fn test_compute_bounds_time_based() {
        let (start, end) =
            dda_params::compute_bounds(Some(0.0), Some(10.0), None, None, Some(256.0));
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(2560));
    }

    #[test]
    fn test_compute_bounds_none() {
        let (start, end) = dda_params::compute_bounds(None, None, None, None, None);
        assert_eq!(start, None);
        assert_eq!(end, None);
    }

    #[test]
    fn test_select_mask_generation() {
        let variants = vec!["ST".to_string(), "CD".to_string()];
        let variant_refs: Vec<&str> = variants.iter().map(|s| s.as_str()).collect();
        let mask = generate_select_mask(&variant_refs);
        let mask_str = format_select_mask(&mask);
        assert_eq!(mask_str, "1 0 1 0 0 0");
    }
}
