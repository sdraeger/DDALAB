use crate::cli::VariantsArgs;
use crate::dda_params;
use crate::exit_codes;
use crate::output;
use dda_rs::VariantMetadata;
use serde::Serialize;

#[derive(Serialize)]
struct VariantInfo {
    abbreviation: &'static str,
    app_id: &'static str,
    name: &'static str,
    position: u8,
    stride: u8,
    channel_format: String,
    documentation: &'static str,
}

pub fn execute(args: VariantsArgs) -> i32 {
    let variants: Vec<VariantInfo> = VariantMetadata::active_variants()
        .map(|v| VariantInfo {
            abbreviation: v.abbreviation,
            app_id: dda_params::variant_app_id(v.abbreviation).unwrap_or("unknown"),
            name: v.name,
            position: v.position,
            stride: v.stride,
            channel_format: format!("{:?}", v.channel_format),
            documentation: v.documentation,
        })
        .collect();

    if args.json {
        if let Err(error) = output::write_json(&variants, false, None) {
            eprintln!("Error: {}", error);
            return exit_codes::EXECUTION_ERROR;
        }
    } else {
        println!("Available DDA Variants:\n");
        println!(
            "  {:<8} {:<24} {:<24} {:<4} {:<8} {:<16}",
            "Abbrev", "App ID", "Name", "Pos", "Stride", "Channels"
        );
        println!("  {}", "-".repeat(92));
        for v in &variants {
            println!(
                "  {:<8} {:<24} {:<24} {:<4} {:<8} {:<16}",
                v.abbreviation, v.app_id, v.name, v.position, v.stride, v.channel_format
            );
        }
        println!();
        println!("SELECT mask format: ST CT CD RESERVED DE SY");
        println!("Example: --variants ST CD  ->  SELECT mask: 1 0 1 0 0 0");
    }

    exit_codes::SUCCESS
}
