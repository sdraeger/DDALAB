use crate::cli::InfoArgs;
use crate::dda_params;
use crate::exit_codes;
use crate::output;
use serde::Serialize;

#[derive(Serialize)]
struct InfoOutput {
    cli_version: String,
    built_in_backend: &'static str,
    built_in_backend_inputs: Vec<&'static str>,
    native_binary_enabled: bool,
    rayon_default_mode_cli: &'static str,
    rayon_default_mode_sidecar: &'static str,
    rayon_override_env_vars: Vec<&'static str>,
    platform: String,
    arch: String,
    supported_variants: Vec<&'static str>,
    accepted_variant_ids: Vec<&'static str>,
    supports_variant_configs: bool,
    supports_preprocessing_flags: bool,
    notes: Vec<&'static str>,
}

pub fn execute(args: InfoArgs) -> i32 {
    let _ = args.binary;

    let info = InfoOutput {
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        built_in_backend: "pure-rust",
        built_in_backend_inputs: vec!["ascii", "txt", "csv"],
        native_binary_enabled: false,
        rayon_default_mode_cli: "throughput",
        rayon_default_mode_sidecar: "desktop",
        rayon_override_env_vars: vec!["DDALAB_RAYON_MODE", "DDALAB_RAYON_THREADS"],
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        supported_variants: dda_params::supported_variant_ids().collect(),
        accepted_variant_ids: dda_params::app_variant_ids().collect(),
        supports_variant_configs: true,
        supports_preprocessing_flags: true,
        notes: vec![
            "execution is handled entirely by the Rust dda-rs engine",
            "non-ASCII requests must be normalized before DDA execution",
            "CCD-family variants are pure-Rust-only conditional directed extensions",
        ],
    };

    if args.json {
        if let Err(error) = output::write_json(&info, false, None) {
            eprintln!("Error: {}", error);
            return exit_codes::EXECUTION_ERROR;
        }
    } else {
        println!("ddalab CLI v{}", info.cli_version);
        println!("Platform: {} ({})", info.platform, info.arch);
        println!();
        println!("Built-in backend: {}", info.built_in_backend);
        println!(
            "Built-in inputs: {}",
            info.built_in_backend_inputs.join(", ")
        );
        println!(
            "Native binary enabled: {}",
            if info.native_binary_enabled {
                "yes"
            } else {
                "no"
            }
        );
        println!(
            "Rayon default mode (CLI runs): {}",
            info.rayon_default_mode_cli
        );
        println!(
            "Rayon default mode (sidecar / GUI): {}",
            info.rayon_default_mode_sidecar
        );
        println!(
            "Rayon overrides: {}",
            info.rayon_override_env_vars.join(", ")
        );
        println!("Supported variants: {}", info.supported_variants.join(", "));
        println!(
            "Accepted app variant IDs: {}",
            info.accepted_variant_ids.join(", ")
        );
        println!(
            "Variant config JSON support: {}",
            if info.supports_variant_configs {
                "yes"
            } else {
                "no"
            }
        );
        println!(
            "Preprocessing flags (--highpass/--lowpass): {}",
            if info.supports_preprocessing_flags {
                "yes"
            } else {
                "no"
            }
        );
        println!("Notes: {}", info.notes.join("; "));
    }

    exit_codes::SUCCESS
}
