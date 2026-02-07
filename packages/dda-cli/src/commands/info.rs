use crate::cli::InfoArgs;
use crate::exit_codes;
use crate::output;
use dda_rs::variants::{find_binary, BINARY_NAME, DEFAULT_BINARY_PATHS};
use serde::Serialize;

#[derive(Serialize)]
struct InfoOutput {
    cli_version: String,
    binary_name: &'static str,
    binary_path: Option<String>,
    binary_found: bool,
    platform: String,
    arch: String,
    search_paths: Vec<&'static str>,
}

pub fn execute(args: InfoArgs) -> i32 {
    let binary_path = match &args.binary {
        Some(path) => find_binary(Some(path.as_str())),
        None => find_binary(None),
    };

    let info = InfoOutput {
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        binary_name: BINARY_NAME,
        binary_path: binary_path.as_ref().map(|p| p.display().to_string()),
        binary_found: binary_path.is_some(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        search_paths: DEFAULT_BINARY_PATHS.to_vec(),
    };

    if args.json {
        match output::to_json(&info, false) {
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
        println!("ddalab CLI v{}", info.cli_version);
        println!("Platform: {} ({})", info.platform, info.arch);
        println!();
        if let Some(ref path) = info.binary_path {
            println!("DDA binary: {}", path);
        } else {
            println!("DDA binary: not found");
        }
        println!("Binary name: {}", info.binary_name);
        println!(
            "Search paths: $DDA_BINARY_PATH, $DDA_HOME/bin, {}",
            info.search_paths.join(", ")
        );
    }

    exit_codes::SUCCESS
}
