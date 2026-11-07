use crate::cli::args::InfoArgs;
use crate::cli::{execution_error, output, Failure};
use crate::VARIANTS;
use serde::Serialize;

#[derive(Serialize)]
struct InfoOutput {
    cli_version: String,
    built_in_backend: &'static str,
    rayon_default_mode_cli: &'static str,
    rayon_override_env_vars: Vec<&'static str>,
    platform: String,
    arch: String,
    supported_variants: Vec<&'static str>,
    accepted_variant_ids: Vec<&'static str>,
    notes: Vec<&'static str>,
}

pub fn execute(args: InfoArgs) -> Result<(), Failure> {
    let info = InfoOutput {
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        built_in_backend: "pure-rust",
        rayon_default_mode_cli: "throughput",
        rayon_override_env_vars: vec!["DDALAB_RAYON_MODE", "DDALAB_RAYON_THREADS"],
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        supported_variants: VARIANTS.iter().map(|v| v.abbreviation).collect(),
        accepted_variant_ids: VARIANTS.iter().map(|v| v.app_id).collect(),
        notes: vec![
            "execution is handled entirely by the Rust dda-rs engine",
            "CCD-family variants are pure-Rust-only conditional directed extensions",
        ],
    };

    if args.json {
        return output::write_json(&info, false, None).map_err(execution_error);
    }
    println!("ddalab CLI v{}", info.cli_version);
    println!("Platform: {} ({})", info.platform, info.arch);
    println!();
    println!("Built-in backend: {}", info.built_in_backend);
    println!(
        "Rayon default mode (CLI runs): {}",
        info.rayon_default_mode_cli
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
    println!("Notes: {}", info.notes.join("; "));
    Ok(())
}
