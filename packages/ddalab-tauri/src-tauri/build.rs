use std::path::PathBuf;
use std::process::Command;

fn main() {
    // Download run_DDA_ASCII binary if it doesn't exist
    let bin_dir = PathBuf::from("../../../bin");
    let dda_binary = bin_dir.join("run_DDA_ASCII");

    if !dda_binary.exists() {
        println!("cargo:warning=run_DDA_ASCII not found, downloading from server...");

        // Create bin directory if it doesn't exist
        if !bin_dir.exists() {
            std::fs::create_dir_all(&bin_dir).expect("Failed to create bin directory");
        }

        // Download the binary using curl
        let status = Command::new("curl")
            .args(&[
                "-L",  // Follow redirects
                "-o", dda_binary.to_str().unwrap(),
                "https://snl.salk.edu/~sfdraeger/run_DDA_ASCII"
            ])
            .status()
            .expect("Failed to execute curl command");

        if !status.success() {
            panic!("Failed to download run_DDA_ASCII binary");
        }

        // Make it executable
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

        println!("cargo:warning=Successfully downloaded run_DDA_ASCII");
    } else {
        println!("cargo:warning=run_DDA_ASCII already exists, skipping download");
    }

    tauri_build::build()
}
