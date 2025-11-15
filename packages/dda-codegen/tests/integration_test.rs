use std::process::Command;
use std::fs;
use std::path::Path;

/// Integration test: Verify code generation pipeline
#[test]
fn test_code_generation_pipeline() {
    // Get repo root (packages/dda-codegen -> packages -> root)
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    // 1. Run code generator
    let output = Command::new("cargo")
        .args(&["run", "--manifest-path", "packages/dda-codegen/Cargo.toml", "--release", "--", "--languages", "rust,python,typescript"])
        .current_dir(repo_root)
        .output()
        .expect("Failed to run code generator");

    assert!(
        output.status.success(),
        "Code generator failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    // 2. Verify Rust files were generated
    let rust_variants = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("dda-rs/src/generated/variants.rs");
    assert!(rust_variants.exists(), "Rust variants.rs not generated");

    let rust_cli = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("dda-rs/src/generated/cli.rs");
    assert!(rust_cli.exists(), "Rust cli.rs not generated");

    let rust_mod = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("dda-rs/src/generated/mod.rs");
    assert!(rust_mod.exists(), "Rust mod.rs not generated");

    // 3. Verify Python files were generated
    let python_variants = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("dda-py/src/dda_py/generated/variants.py");

    // Python directory might not exist yet, that's ok
    if python_variants.parent().unwrap().exists() {
        assert!(python_variants.exists(), "Python variants.py not generated");
    }

    // 4. Verify TypeScript files were generated
    let ts_variants = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("ddalab-tauri/src/types/generated/variants.ts");
    assert!(ts_variants.exists(), "TypeScript variants.ts not generated");

    // 5. Verify generated files contain expected content
    let rust_content = fs::read_to_string(&rust_variants).expect("Failed to read Rust variants.rs");
    assert!(rust_content.contains("AUTO-GENERATED from DDA_SPEC.yaml"));
    assert!(rust_content.contains("pub struct VariantMetadata"));
    assert!(rust_content.contains("VARIANT_REGISTRY"));

    let ts_content = fs::read_to_string(&ts_variants).expect("Failed to read TypeScript variants.ts");
    assert!(ts_content.contains("AUTO-GENERATED from DDA_SPEC.yaml"));
    assert!(ts_content.contains("export interface VariantMetadata"));
    assert!(ts_content.contains("VARIANT_REGISTRY"));

    // 6. Verify Rust code compiles
    let compile_output = Command::new("cargo")
        .args(&["test", "--lib", "generated"])
        .current_dir(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("dda-rs"),
        )
        .output()
        .expect("Failed to run Rust tests");

    assert!(
        compile_output.status.success(),
        "Generated Rust code failed to compile:\n{}",
        String::from_utf8_lossy(&compile_output.stderr)
    );
}

/// Test: Verify variant metadata is correctly generated
#[test]
fn test_variant_metadata_generation() {
    // Get repo root
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    let rust_variants = repo_root.join("packages/dda-rs/src/generated/variants.rs");

    if !rust_variants.exists() {
        // Run code generator first
        let _ = Command::new("cargo")
            .args(&["run", "--manifest-path", "packages/dda-codegen/Cargo.toml", "--release", "--", "--languages", "rust"])
            .current_dir(repo_root)
            .output()
            .expect("Failed to run code generator");
    }

    let content = fs::read_to_string(&rust_variants).expect("Failed to read generated file");

    // Check all expected variants are present
    for variant in &["ST", "CT", "CD", "DE", "SY"] {
        assert!(
            content.contains(&format!("\"{}\"", variant)),
            "Variant {} not found in generated code",
            variant
        );
    }

    // Check RESERVED is excluded
    assert!(
        !content.contains("RESERVED") || content.contains("pub const RESERVED: usize = 3;"),
        "RESERVED should only appear in select_mask_positions module"
    );

    // Check helper functions are generated
    assert!(content.contains("pub fn generate_select_mask"));
    assert!(content.contains("pub fn parse_select_mask"));

    // Check tests are generated
    assert!(content.contains("#[cfg(test)]"));
    assert!(content.contains("test_variant_registry_size"));
    assert!(content.contains("test_variant_lookup_by_abbrev"));
}

/// Test: Verify dry run works without writing files
#[test]
fn test_dry_run_mode() {
    // Get repo root
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    let rust_variants = repo_root.join("packages/dda-rs/src/generated/variants.rs");

    // Get current modification time (if file exists)
    let original_mtime = if rust_variants.exists() {
        fs::metadata(&rust_variants).unwrap().modified().ok()
    } else {
        None
    };

    // Run in dry-run mode
    let output = Command::new("cargo")
        .args(&["run", "--manifest-path", "packages/dda-codegen/Cargo.toml", "--release", "--", "--dry-run", "--languages", "rust"])
        .current_dir(repo_root)
        .output()
        .expect("Failed to run code generator in dry-run mode");

    assert!(
        output.status.success(),
        "Dry run failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    // Verify file was not modified (if it existed before)
    if original_mtime.is_some() && rust_variants.exists() {
        let current_mtime = fs::metadata(&rust_variants).unwrap().modified().ok();
        assert_eq!(
            original_mtime, current_mtime,
            "File was modified in dry-run mode"
        );
    }
}

/// Test: Verify CLI constants are correctly generated
#[test]
fn test_cli_generation() {
    // Get repo root
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();

    let rust_cli = repo_root.join("packages/dda-rs/src/generated/cli.rs");

    if !rust_cli.exists() {
        // Run code generator first
        let _ = Command::new("cargo")
            .args(&["run", "--manifest-path", "packages/dda-codegen/Cargo.toml", "--release", "--", "--languages", "rust"])
            .current_dir(repo_root)
            .output()
            .expect("Failed to run code generator");
    }

    let content = fs::read_to_string(&rust_cli).expect("Failed to read CLI file");

    // Check binary name constant
    assert!(content.contains("pub const BINARY_NAME"));
    assert!(content.contains("run_DDA_AsciiEdf"));

    // Check shell wrapper flag
    assert!(content.contains("pub const REQUIRES_SHELL_WRAPPER"));

    // Check FileType enum
    assert!(content.contains("pub enum FileType"));
    assert!(content.contains("EDF"));
    assert!(content.contains("ASCII"));

    // Check tests
    assert!(content.contains("test_binary_name"));
    assert!(content.contains("test_file_type_flags"));
}
