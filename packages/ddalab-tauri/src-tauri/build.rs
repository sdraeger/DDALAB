use std::path::PathBuf;
use std::process::Command;

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

        // APE binary URL - same file for all platforms (no extension)
        let download_url = "https://snl.salk.edu/~sfdraeger/run_DDA_AsciiEdf";

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
                download_url,
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
