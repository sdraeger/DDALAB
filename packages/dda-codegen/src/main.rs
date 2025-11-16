use anyhow::{Context, Result};
use chrono::Utc;
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tera::{Context as TeraContext, Tera};

#[derive(Parser, Debug)]
#[command(name = "dda-codegen")]
#[command(about = "Generate DDA language bindings from DDA_SPEC.yaml", long_about = None)]
struct Args {
    /// Path to DDA_SPEC.yaml
    #[arg(short, long, default_value = "DDA_SPEC.yaml")]
    spec: PathBuf,

    /// Output directory root
    #[arg(short, long, default_value = "packages")]
    output: PathBuf,

    /// Languages to generate (comma-separated: rust,python,typescript,julia)
    #[arg(short, long, default_value = "rust,python,typescript,julia")]
    languages: String,

    /// Custom Python output directory (overrides default packages/dda-py path)
    #[arg(long)]
    python_output: Option<PathBuf>,

    /// Custom Julia output directory (overrides default absolute path)
    #[arg(long)]
    julia_output: Option<PathBuf>,

    /// Dry run - don't write files
    #[arg(long)]
    dry_run: bool,

    /// Verbose logging
    #[arg(short, long)]
    verbose: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct DDASpec {
    metadata: Metadata,
    variants: HashMap<String, VariantSpec>,
    cli: CliSpec,
    output: OutputSpec,
    #[serde(default)]
    wrapper_guidelines: Option<serde_yaml::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
struct Metadata {
    spec_version: String,
    binary_name: String,
    description: String,
    #[serde(default)]
    supported_platforms: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct VariantSpec {
    name: String,
    description: String,
    #[serde(default)]
    output_suffix: Option<String>,
    #[serde(default)]
    stride: Option<u32>,
    #[serde(default)]
    dependencies: Vec<String>,
    #[serde(default)]
    required_params: Vec<String>,
    #[serde(default)]
    channel_format: Option<String>,
    #[serde(default)]
    notes: Vec<String>,
    #[serde(default)]
    position: Option<u32>,
    #[serde(default)]
    usage: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct CliSpec {
    invocation: String,
    shell_wrapper: bool,
    description: String,
    arguments: Vec<CliArgument>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct CliArgument {
    name: String,
    #[serde(default)]
    flag: Option<String>,
    #[serde(default)]
    flags: Option<Vec<String>>,
    #[serde(rename = "type", default)]
    arg_type: Option<String>,
    #[serde(default)]
    required: serde_yaml::Value,
    description: String,
    #[serde(default)]
    default: Option<serde_yaml::Value>,
    #[serde(default)]
    validation: Vec<String>,
    #[serde(default)]
    mutually_exclusive: Option<bool>,
    #[serde(default)]
    format: Option<serde_yaml::Value>,
    #[serde(default)]
    notes: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OutputSpec {
    file_structure: FileStructure,
    data_format: DataFormat,
}

#[derive(Debug, Deserialize, Serialize)]
struct FileStructure {
    info_file: InfoFileSpec,
    variant_files: HashMap<String, VariantFileSpec>,
}

#[derive(Debug, Deserialize, Serialize)]
struct InfoFileSpec {
    suffix: String,
    format: String,
    description: String,
    contents: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
struct VariantFileSpec {
    suffix: String,
    format: String,
    description: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct DataFormat {
    description: String,
    columns: DataColumns,
    parsing: ParsingSpec,
}

#[derive(Debug, Deserialize, Serialize)]
struct DataColumns {
    window_bounds: WindowBoundsSpec,
    data_columns: DataColumnsSpec,
}

#[derive(Debug, Deserialize, Serialize)]
struct WindowBoundsSpec {
    positions: Vec<u32>,
    description: String,
    #[serde(rename = "type")]
    col_type: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct DataColumnsSpec {
    position: String,
    description: String,
    #[serde(rename = "type")]
    col_type: String,
    format: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ParsingSpec {
    description: String,
    steps: HashMap<u32, String>,
    stride_by_variant: HashMap<String, u32>,
    result_dimensions: HashMap<String, DimensionSpec>,
}

#[derive(Debug, Deserialize, Serialize)]
struct DimensionSpec {
    rows: String,
    cols: String,
}

fn main() -> Result<()> {
    let args = Args::parse();

    env_logger::Builder::from_default_env()
        .filter_level(if args.verbose {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        })
        .init();

    log::info!("DDA Code Generator v0.1.0");
    log::info!("Reading spec from: {:?}", args.spec);

    // Load the spec
    let spec_content = fs::read_to_string(&args.spec)
        .with_context(|| format!("Failed to read spec file: {:?}", args.spec))?;
    let spec: DDASpec = serde_yaml::from_str(&spec_content)
        .context("Failed to parse DDA_SPEC.yaml")?;

    log::info!("Loaded spec version: {}", spec.metadata.spec_version);
    log::info!("Binary name: {}", spec.metadata.binary_name);
    log::info!("Variants: {}", spec.variants.len());

    // Parse languages
    let languages: Vec<&str> = args.languages.split(',').map(|s| s.trim()).collect();
    log::info!("Generating code for: {:?}", languages);

    // Initialize Tera template engine
    let template_dir = "packages/dda-codegen/templates/**/*.tera";
    let mut tera = Tera::new(template_dir)
        .with_context(|| format!("Failed to load templates from: {}", template_dir))?;

    // Add custom filters
    tera.register_filter("snake_case", snake_case_filter);
    tera.register_filter("camel_case", camel_case_filter);
    tera.register_filter("pascal_case", pascal_case_filter);
    tera.register_filter("upper_snake_case", upper_snake_case_filter);

    // Generate code for each language
    for lang in &languages {
        log::info!("Generating {} code...", lang);
        generate_language_code(&spec, lang, &args, &tera)?;
    }

    log::info!("✅ Code generation complete!");
    Ok(())
}

fn generate_language_code(
    spec: &DDASpec,
    lang: &str,
    args: &Args,
    tera: &Tera,
) -> Result<()> {
    // Determine output directory based on language and custom overrides
    let output_dir = match lang {
        "rust" => args.output.join("dda-rs/src/generated"),
        "python" => {
            if let Some(ref custom_path) = args.python_output {
                // For external repos, output directly to src/dda_py (main package)
                custom_path.join("src/dda_py")
            } else {
                // For local monorepo, keep in generated subfolder for isolation
                args.output.join("dda-py/src/dda_py/generated")
            }
        }
        "typescript" => args.output.join("ddalab-tauri/src/types/generated"),
        "julia" => {
            if let Some(ref custom_path) = args.julia_output {
                custom_path.join("src/generated")
            } else {
                PathBuf::from("/Users/simon/Desktop/DelayDifferentialAnalysis.jl/src/generated")
            }
        }
        _ => anyhow::bail!("Unsupported language: {}", lang),
    };

    log::debug!("Output directory for {}: {:?}", lang, output_dir);

    if !args.dry_run {
        fs::create_dir_all(&output_dir)
            .with_context(|| format!("Failed to create output directory: {:?}", output_dir))?;
    }

    // Build context
    let mut context = TeraContext::new();
    context.insert("spec", &spec);
    context.insert("metadata", &spec.metadata);
    context.insert("variants", &spec.variants);
    context.insert("cli", &spec.cli);
    context.insert("output_spec", &spec.output);
    context.insert("timestamp", &Utc::now().to_rfc3339());
    context.insert("language", lang);

    // Sort variants by select_mask_position for consistent output
    #[derive(Serialize)]
    struct VariantEntry {
        abbrev: String,
        variant: VariantSpec,
    }

    let mut sorted_variants: Vec<VariantEntry> = spec.variants.iter()
        .filter(|(k, _)| k.as_str() != "RESERVED")
        .map(|(k, v)| VariantEntry {
            abbrev: k.clone(),
            variant: v.clone(),
        })
        .collect();
    sorted_variants.sort_by(|a, b| a.abbrev.cmp(&b.abbrev));
    context.insert("sorted_variants", &sorted_variants);

    // Generate variant registry/constants
    let template_name = format!("{}/variants.tera", lang);
    if tera.get_template_names().any(|n| n == template_name) {
        log::debug!("Rendering template: {}", template_name);
        let output = tera.render(&template_name, &context)
            .with_context(|| format!("Failed to render template: {}", template_name))?;

        let file_name = match lang {
            "rust" => "variants.rs",
            "python" => "variants.py",
            "typescript" => "variants.ts",
            "julia" => "variants.jl",
            _ => "variants.txt",
        };

        let output_file = output_dir.join(file_name);
        if args.dry_run {
            log::info!("Would write: {:?}", output_file);
            log::debug!("Content preview:\n{}", &output[..output.len().min(500)]);
        } else {
            fs::write(&output_file, output)
                .with_context(|| format!("Failed to write file: {:?}", output_file))?;
            log::info!("✓ Generated: {:?}", output_file);
        }
    }

    // Generate CLI constants/helpers
    let cli_template_name = format!("{}/cli.tera", lang);
    if tera.get_template_names().any(|n| n == cli_template_name) {
        log::debug!("Rendering template: {}", cli_template_name);
        let output = tera.render(&cli_template_name, &context)
            .with_context(|| format!("Failed to render template: {}", cli_template_name))?;

        let file_name = match lang {
            "rust" => "cli.rs",
            "python" => "cli.py",
            "typescript" => "cli.ts",
            "julia" => "cli.jl",
            _ => "cli.txt",
        };

        let output_file = output_dir.join(file_name);
        if args.dry_run {
            log::info!("Would write: {:?}", output_file);
        } else {
            fs::write(&output_file, output)
                .with_context(|| format!("Failed to write file: {:?}", output_file))?;
            log::info!("✓ Generated: {:?}", output_file);
        }
    }

    // Generate mod.rs for Rust
    if lang == "rust" {
        let mod_content = "// AUTO-GENERATED - Do not edit\n\npub mod variants;\npub mod cli;\n";
        let mod_file = output_dir.join("mod.rs");
        if !args.dry_run {
            fs::write(&mod_file, mod_content)?;
            log::info!("✓ Generated: {:?}", mod_file);
        }
    }

    // Generate __init__.py for Python
    if lang == "python" {
        let init_template_name = format!("{}/__init__.tera", lang);
        if tera.get_template_names().any(|n| n == init_template_name) {
            log::debug!("Rendering template: {}", init_template_name);
            let output = tera.render(&init_template_name, &context)
                .with_context(|| format!("Failed to render template: {}", init_template_name))?;

            let init_file = output_dir.join("__init__.py");
            if args.dry_run {
                log::info!("Would write: {:?}", init_file);
            } else {
                fs::write(&init_file, output)
                    .with_context(|| format!("Failed to write file: {:?}", init_file))?;
                log::info!("✓ Generated: {:?}", init_file);
            }
        }
    }

    // Generate parser.jl for Julia
    if lang == "julia" {
        let parser_template_name = format!("{}/parser.jl.tera", lang);
        if tera.get_template_names().any(|n| n == parser_template_name) {
            log::debug!("Rendering template: {}", parser_template_name);
            let output = tera.render(&parser_template_name, &context)
                .with_context(|| format!("Failed to render template: {}", parser_template_name))?;

            let parser_file = output_dir.join("parser.jl");
            if args.dry_run {
                log::info!("Would write: {:?}", parser_file);
            } else {
                fs::write(&parser_file, output)
                    .with_context(|| format!("Failed to write file: {:?}", parser_file))?;
                log::info!("✓ Generated: {:?}", parser_file);
            }
        }
    }

    Ok(())
}

// Custom Tera filters
fn snake_case_filter(value: &tera::Value, _: &HashMap<String, tera::Value>) -> tera::Result<tera::Value> {
    if let Some(s) = value.as_str() {
        let snake = s
            .chars()
            .enumerate()
            .flat_map(|(i, c)| {
                if c.is_uppercase() && i > 0 {
                    vec!['_', c.to_lowercase().next().unwrap()]
                } else {
                    vec![c.to_lowercase().next().unwrap()]
                }
            })
            .collect::<String>()
            .replace(" ", "_")
            .replace("-", "_");
        Ok(tera::Value::String(snake))
    } else {
        Err("snake_case filter expects a string".into())
    }
}

fn camel_case_filter(value: &tera::Value, _: &HashMap<String, tera::Value>) -> tera::Result<tera::Value> {
    if let Some(s) = value.as_str() {
        let mut result = String::new();
        let mut capitalize_next = false;
        for (i, c) in s.chars().enumerate() {
            if c == '_' || c == ' ' || c == '-' {
                capitalize_next = true;
            } else if i == 0 {
                result.push(c.to_lowercase().next().unwrap());
            } else if capitalize_next {
                result.push(c.to_uppercase().next().unwrap());
                capitalize_next = false;
            } else {
                result.push(c);
            }
        }
        Ok(tera::Value::String(result))
    } else {
        Err("camel_case filter expects a string".into())
    }
}

fn pascal_case_filter(value: &tera::Value, _: &HashMap<String, tera::Value>) -> tera::Result<tera::Value> {
    if let Some(s) = value.as_str() {
        let mut result = String::new();
        let mut capitalize_next = true;
        for c in s.chars() {
            if c == '_' || c == ' ' || c == '-' {
                capitalize_next = true;
            } else if capitalize_next {
                result.push(c.to_uppercase().next().unwrap());
                capitalize_next = false;
            } else {
                result.push(c);
            }
        }
        Ok(tera::Value::String(result))
    } else {
        Err("pascal_case filter expects a string".into())
    }
}

fn upper_snake_case_filter(value: &tera::Value, _: &HashMap<String, tera::Value>) -> tera::Result<tera::Value> {
    if let Some(s) = value.as_str() {
        let upper = s
            .chars()
            .enumerate()
            .flat_map(|(i, c)| {
                if c.is_uppercase() && i > 0 {
                    vec!['_', c]
                } else {
                    vec![c.to_uppercase().next().unwrap()]
                }
            })
            .collect::<String>()
            .replace(" ", "_")
            .replace("-", "_");
        Ok(tera::Value::String(upper))
    } else {
        Err("upper_snake_case filter expects a string".into())
    }
}
