/// Embedded NSG resources - bundled at compile time
///
/// This module embeds NSG wrapper scripts and binaries into the Tauri application
/// so they don't need to be hardcoded or read from the filesystem at runtime.
///
/// Resources are included using Rust's `include_str!` and `include_bytes!` macros,
/// which embed file contents directly into the binary at compile time.

/// Python wrapper script for NSG (PY_EXPANSE tool)
/// This is the main entry point that NSG executes
pub const WRAPPER_SCRIPT: &str = include_str!("../../../../../nsg_wrapper/run_dda_nsg.py");

/// DDA Python module for backward compatibility
/// Contains DDARunner class for executing DDA binary
pub const DDA_PY_MODULE: &str = include_str!("../../../../../nsg_wrapper/dda.py");

/// Linux x86_64 dda-rs binary for NSG Expanse
/// Cross-compiled Rust binary that handles parallelization natively
///
/// **IMPORTANT**: This binary must be built separately before compiling the Tauri app:
///
/// ```bash
/// cd packages/dda-rs
/// ./build-linux.sh --release
/// ```
///
/// Or use the convenience script from repo root:
/// ```bash
/// ./build-nsg-binaries.sh
/// ```
///
/// If you don't need NSG parallelization, you can skip building this binary.
/// The app will fall back to the Python wrapper which works for serial execution.
///
/// To check if binary exists:
/// ```bash
/// ls -lh packages/dda-rs/target/x86_64-unknown-linux-gnu/release/dda-rs
/// ```

// DEVELOPMENT NOTE: Comment out the include_bytes! line below if you haven't built
// the Linux binary yet. This allows the app to compile for development/testing.
// Uncomment before building for production NSG deployment with parallelization.

// pub const DDA_RS_LINUX: &[u8] = include_bytes!("../../../../dda-rs/target/x86_64-unknown-linux-gnu/release/dda-rs");

// Placeholder - uncomment the line above and comment this out once binary is built
pub const DDA_RS_LINUX: &[u8] = &[];

/// Minimal Python wrapper for dda-rs execution on NSG
/// This replaces run_dda_nsg.py when using the Rust binary
pub const DDA_RS_WRAPPER: &str = r#"#!/usr/bin/env python3
"""
Minimal Python wrapper for dda-rs on NSG Expanse
Calls the dda-rs Rust binary which handles parallelization natively
"""
import json
import subprocess
import sys
import os

def main():
    # Read parameters
    with open('params.json', 'r') as f:
        params = json.load(f)

    print(f"[NSG] Starting dda-rs with parameters from params.json")
    print(f"[NSG] Input file: {params.get('input_file')}")

    # Ensure dda-rs binary is executable
    os.chmod('./dda-rs-linux', 0o755)

    # Call dda-rs binary with JSON params
    # The binary will:
    # - Parse params.json
    # - Execute DDA analysis with parallelization
    # - Save results to dda_results.json
    result = subprocess.run(
        ['./dda-rs-linux', '--params', 'params.json'],
        capture_output=True,
        text=True
    )

    print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)

    if result.returncode != 0:
        print(f"[NSG ERROR] dda-rs failed with exit code {result.returncode}")
        sys.exit(result.returncode)

    print("[NSG] dda-rs completed successfully")
    sys.exit(0)

if __name__ == '__main__':
    main()
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wrapper_script_embedded() {
        // Verify the wrapper script is not empty
        assert!(
            !WRAPPER_SCRIPT.is_empty(),
            "Wrapper script should be embedded"
        );
        assert!(
            WRAPPER_SCRIPT.contains("#!/usr/bin/env python3"),
            "Wrapper should be Python script"
        );
    }

    #[test]
    fn test_dda_module_embedded() {
        // Verify the DDA module is not empty
        assert!(!DDA_PY_MODULE.is_empty(), "DDA module should be embedded");
        assert!(
            DDA_PY_MODULE.contains("class DDARunner"),
            "Should contain DDARunner class"
        );
    }

    #[test]
    fn test_dda_rs_wrapper_valid() {
        // Verify the dda-rs wrapper is valid Python
        assert!(DDA_RS_WRAPPER.contains("#!/usr/bin/env python3"));
        assert!(DDA_RS_WRAPPER.contains("params.json"));
        assert!(DDA_RS_WRAPPER.contains("dda-rs-linux"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_linux_binary_embedded() {
        // On macOS (where we build), verify the Linux binary is embedded
        // Note: This will fail if the binary hasn't been built yet
        if std::path::Path::new(
            "../../../../../dda-rs/target/x86_64-unknown-linux-gnu/release/dda-rs",
        )
        .exists()
        {
            assert!(
                !DDA_RS_LINUX.is_empty(),
                "Linux binary should be embedded on macOS"
            );
        }
    }
}
