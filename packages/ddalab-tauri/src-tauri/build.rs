use std::path::PathBuf;
use std::process::Command;

fn fetch_latest_version() -> String {
    let latest_json_url = "https://snl.salk.edu/~sfdraeger/dda/latest.json";

    println!(
        "cargo:warning=Fetching latest DDA version from: {}",
        latest_json_url
    );

    let output = Command::new("curl")
        .args(&[
            "-s", // Silent mode
            "-L", // Follow redirects
            latest_json_url,
        ])
        .output()
        .expect("Failed to execute curl command to fetch latest.json");

    if !output.status.success() {
        println!("cargo:warning=Failed to fetch latest.json, falling back to v1.1");
        return "v1.1".to_string();
    }

    let json_str = String::from_utf8_lossy(&output.stdout);

    // Parse JSON to extract version field
    // Simple parsing: look for "version": "vX.Y"
    if let Some(version_start) = json_str.find(r#""version""#) {
        let after_key = &json_str[version_start..];
        if let Some(colon_pos) = after_key.find(':') {
            let after_colon = &after_key[colon_pos + 1..];
            if let Some(quote_start) = after_colon.find('"') {
                let after_quote = &after_colon[quote_start + 1..];
                if let Some(quote_end) = after_quote.find('"') {
                    let version = after_quote[..quote_end].trim().to_string();
                    println!("cargo:warning=Latest DDA version: {}", version);
                    return version;
                }
            }
        }
    }

    println!("cargo:warning=Failed to parse version from latest.json, falling back to v1.1");
    "v1.1".to_string()
}

fn main() {
    // Download run_DDA_AsciiEdf binary if it doesn't exist
    // The binary is an APE (Actually Portable Executable) - same file for all platforms
    // On Windows, it needs .exe extension to be executable
    let bin_dir = PathBuf::from("../../../bin");

    // Platform-specific binary name
    let binary_name = if cfg!(target_os = "windows") {
        "run_DDA_AsciiEdf.exe"
    } else {
        "run_DDA_AsciiEdf"
    };

    let dda_binary = bin_dir.join(binary_name);

    if !dda_binary.exists() {
        println!(
            "cargo:warning={} not found, downloading APE binary from server...",
            binary_name
        );

        // Create bin directory if it doesn't exist
        if !bin_dir.exists() {
            std::fs::create_dir_all(&bin_dir).expect("Failed to create bin directory");
        }

        // Fetch the latest version from latest.json
        let version = fetch_latest_version();

        // APE binary URL with version - same file for all platforms (no extension)
        let download_url = format!(
            "https://snl.salk.edu/~sfdraeger/dda/{}/run_DDA_AsciiEdf",
            version
        );

        println!(
            "cargo:warning=Downloading APE binary from: {}",
            download_url
        );

        // Download the binary using curl - save with platform-appropriate name
        let status = Command::new("curl")
            .args(&[
                "-L", // Follow redirects
                "-o",
                dda_binary.to_str().unwrap(),
                &download_url,
            ])
            .status()
            .expect("Failed to execute curl command");

        if !status.success() {
            panic!("Failed to download APE binary as {}", binary_name);
        }

        // Make it executable on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&dda_binary)
                .expect("Failed to get file metadata")
                .permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&dda_binary, perms)
                .expect("Failed to set executable permissions");
        }

        println!(
            "cargo:warning=Successfully downloaded APE binary as {}",
            binary_name
        );
        println!("cargo:warning=Binary will be bundled in Tauri app resources");
    } else {
        println!(
            "cargo:warning={} already exists, skipping download",
            binary_name
        );
    }

    tauri_build::build()
}
