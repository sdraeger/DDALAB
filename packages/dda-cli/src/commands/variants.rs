use crate::cli::VariantsArgs;
use crate::exit_codes;
use crate::output;
use dda_rs::VariantMetadata;
use serde::Serialize;

#[derive(Serialize)]
struct VariantInfo {
    abbreviation: &'static str,
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
            name: v.name,
            position: v.position,
            stride: v.stride,
            channel_format: format!("{:?}", v.channel_format),
            documentation: v.documentation,
        })
        .collect();

    if args.json {
        match output::to_json(&variants, false) {
            Ok(json) => {
                if let Err(e) = output::write_output(&json, None) {
                    eprintln!("Error: {}", e);
                    return exit_codes::EXECUTION_ERROR;
                }
            }
            Err(e) => {
                eprintln!("Error: {}", e);
                return exit_codes::EXECUTION_ERROR;
            }
        }
    } else {
        println!("Available DDA Variants:\n");
        println!(
            "  {:<8} {:<24} {:<4} {:<8} {:<16}",
            "Abbrev", "Name", "Pos", "Stride", "Channels"
        );
        println!("  {}", "-".repeat(64));
        for v in &variants {
            println!(
                "  {:<8} {:<24} {:<4} {:<8} {:<16}",
                v.abbreviation, v.name, v.position, v.stride, v.channel_format
            );
        }
        println!();
        println!("SELECT mask format: ST CT CD RESERVED DE SY");
        println!("Example: --variants ST CD  ->  SELECT mask: 1 0 1 0 0 0");
    }

    exit_codes::SUCCESS
}
