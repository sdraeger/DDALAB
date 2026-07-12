use crate::cli::BatchArgs;
use crate::dda_params;
use crate::exit_codes;
use crate::output;
use std::path::Path;
use std::time::Instant;

const BIDS_EXTENSIONS: &[&str] = &["edf", "set", "vhdr", "fif", "csv", "txt"];
const BIDS_MAX_DEPTH: usize = 6;

pub async fn execute(args: BatchArgs) -> i32 {
    let selection = match dda_params::prepare_selection(
        args.channels.clone(),
        &args.variants,
        args.ct_pairs.as_deref(),
        args.cd_pairs.as_deref(),
        args.variant_configs.as_deref(),
    ) {
        Ok(selection) => selection,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };
    let dda_params::PreparedSelection {
        variants: normalized_variants,
        channels: effective_channels,
        ct_pairs: effective_ct_pairs,
        cd_pairs: effective_cd_pairs,
        variant_configs,
    } = selection;

    // Resolve file list
    let files = match resolve_files(&args) {
        Ok(f) => f,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    if files.is_empty() {
        eprintln!("Error: No matching files found");
        return exit_codes::INPUT_ERROR;
    }

    // Dry-run mode: print file list and exit
    if args.dry_run {
        for f in &files {
            println!("{}", f);
        }
        if !args.quiet {
            eprintln!("Found {} file(s)", files.len());
        }
        return exit_codes::SUCCESS;
    }

    // Validate shared params
    if let Err(msg) = dda_params::validate_common_params(
        &effective_channels,
        &normalized_variants,
        &args.delays,
        args.wl,
        args.ws,
        &effective_ct_pairs,
        &effective_cd_pairs,
    ) {
        eprintln!("Error: {}", msg);
        return exit_codes::INPUT_ERROR;
    }

    // Create output directory if specified
    if let Some(ref dir) = args.output_dir {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("Error: Failed to create output directory '{}': {}", dir, e);
            return exit_codes::EXECUTION_ERROR;
        }
    }

    let total = files.len();
    let mut succeeded = 0usize;
    let mut failed = 0usize;
    let start_time = Instant::now();

    for (i, file_path) in files.iter().enumerate() {
        if !args.quiet {
            eprintln!("[{}/{}] {}...", i + 1, total, file_path);
        }

        let outcome: Result<(), String> = async {
            dda_params::validate_file(file_path).map_err(|error| format!("Error: {}", error))?;
            let request = dda_params::build_dda_request(dda_params::RequestConfig {
                file_path,
                channels: &effective_channels,
                variants: &normalized_variants,
                window_length: args.wl,
                window_step: args.ws,
                delays: &args.delays,
                model_terms: args.model.clone(),
                dm: args.dm,
                order: args.order,
                nr_tau: args.nr_tau,
                ct_window_length: args.ct_wl,
                ct_window_step: args.ct_ws,
                ct_channel_pairs: effective_ct_pairs.clone(),
                cd_channel_pairs: effective_cd_pairs.clone(),
                sampling_rate: args.sr,
                start: None,
                end: None,
                highpass: args.highpass,
                lowpass: args.lowpass,
                variant_configs: variant_configs.clone(),
            })
            .map_err(|error| format!("Error building request: {}", error))?;
            let result = dda_params::execute_request(&request, None, None)
                .await
                .map_err(|error| format!("DDA execution failed: {}", error))?;

            if let Some(dir) = &args.output_dir {
                let json = output::to_json(&result, args.compact)
                    .map_err(|error| format!("Error serializing result: {}", error))?;
                let stem = Path::new(file_path)
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("output");
                let out_path = Path::new(dir).join(format!("{}_dda.json", stem));
                output::write_output(&json, out_path.to_str())
                    .map_err(|error| format!("Error writing output: {}", error))?;
            } else {
                let json = output::to_json(&result, true)
                    .map_err(|error| format!("Error serializing result: {}", error))?;
                output::write_output(&json, None)
                    .map_err(|error| format!("Error writing to stdout: {}", error))?;
            }
            if !args.quiet {
                eprintln!("  Backend: pure-rust");
            }
            Ok(())
        }
        .await;

        match outcome {
            Ok(()) => succeeded += 1,
            Err(error) => {
                eprintln!("  {}", error);
                failed += 1;
                if !args.continue_on_error {
                    break;
                }
            }
        }
    }

    let elapsed = start_time.elapsed();

    if !args.quiet {
        eprintln!(
            "Batch complete: {}/{} succeeded, {}/{} failed, {:.1}s",
            succeeded,
            total,
            failed,
            total,
            elapsed.as_secs_f64()
        );
    }

    if failed == 0 {
        exit_codes::SUCCESS
    } else if succeeded > 0 {
        exit_codes::PARTIAL_FAILURE
    } else {
        exit_codes::EXECUTION_ERROR
    }
}

fn resolve_files(args: &BatchArgs) -> Result<Vec<String>, String> {
    if let Some(ref pattern) = args.glob {
        resolve_glob(pattern)
    } else if let Some(ref files) = args.files {
        Ok(files.clone())
    } else if let Some(ref dir) = args.bids_dir {
        resolve_bids_dir(dir)
    } else {
        Err("One of --glob, --files, or --bids-dir must be specified".to_string())
    }
}

fn resolve_glob(pattern: &str) -> Result<Vec<String>, String> {
    let paths =
        glob::glob(pattern).map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?;

    let mut files: Vec<String> = Vec::new();
    for entry in paths {
        match entry {
            Ok(path) => {
                if path.is_file() {
                    if let Some(s) = path.to_str() {
                        files.push(s.to_string());
                    }
                }
            }
            Err(e) => {
                eprintln!("Warning: glob error: {}", e);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn resolve_bids_dir(dir: &str) -> Result<Vec<String>, String> {
    let root = Path::new(dir);
    if !root.is_dir() {
        return Err(format!("BIDS directory not found: {}", dir));
    }

    let mut files: Vec<String> = Vec::new();
    walk_bids_dir(root, 0, &mut files);
    files.sort();
    Ok(files)
}

fn walk_bids_dir(dir: &Path, depth: usize, files: &mut Vec<String>) {
    if depth > BIDS_MAX_DEPTH {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip hidden directories/files
        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            walk_bids_dir(&path, depth + 1, files);
        } else if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if BIDS_EXTENSIONS.contains(&ext) {
                    if let Some(s) = path.to_str() {
                        files.push(s.to_string());
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_batch_args() -> BatchArgs {
        BatchArgs {
            glob: None,
            files: None,
            bids_dir: None,
            channels: Some(vec![0, 1, 2]),
            variants: vec!["ST".to_string()],
            wl: 200,
            ws: 100,
            ct_wl: None,
            ct_ws: None,
            delays: vec![7, 10],
            model: None,
            dm: 4,
            order: 4,
            nr_tau: 2,
            ct_pairs: None,
            cd_pairs: None,
            variant_configs: None,
            highpass: None,
            lowpass: None,
            sr: None,
            binary: None,
            output_dir: None,
            continue_on_error: false,
            dry_run: false,
            compact: false,
            quiet: false,
        }
    }

    #[test]
    fn test_resolve_files_no_input() {
        let args = make_batch_args();
        let result = resolve_files(&args);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must be specified"));
    }

    #[test]
    fn test_resolve_files_explicit_list() {
        let mut args = make_batch_args();
        args.files = Some(vec!["/tmp/a.edf".to_string(), "/tmp/b.edf".to_string()]);
        let result = resolve_files(&args).unwrap();
        assert_eq!(result, vec!["/tmp/a.edf", "/tmp/b.edf"]);
    }

    #[test]
    fn test_resolve_glob_no_matches() {
        let result = resolve_glob("/nonexistent_dir_12345/*.edf").unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_resolve_bids_dir_nonexistent() {
        let result = resolve_bids_dir("/nonexistent_dir_12345");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_bids_dir_with_files() {
        let tmp = tempfile::tempdir().unwrap();
        let sub_dir = tmp.path().join("sub-01").join("eeg");
        fs::create_dir_all(&sub_dir).unwrap();
        fs::write(sub_dir.join("test.edf"), "").unwrap();
        fs::write(sub_dir.join("test.csv"), "").unwrap();
        fs::write(sub_dir.join("test.xyz"), "").unwrap(); // unsupported

        let result = resolve_bids_dir(tmp.path().to_str().unwrap()).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|f| f.ends_with("test.edf")));
        assert!(result.iter().any(|f| f.ends_with("test.csv")));
    }

    #[test]
    fn test_resolve_bids_dir_skips_hidden() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden_dir = tmp.path().join(".hidden");
        fs::create_dir_all(&hidden_dir).unwrap();
        fs::write(hidden_dir.join("secret.edf"), "").unwrap();

        let result = resolve_bids_dir(tmp.path().to_str().unwrap()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_resolve_glob_with_temp_files() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.edf"), "").unwrap();
        fs::write(tmp.path().join("b.edf"), "").unwrap();
        fs::write(tmp.path().join("c.txt"), "").unwrap();

        let pattern = format!("{}/*.edf", tmp.path().to_str().unwrap());
        let result = resolve_glob(&pattern).unwrap();
        assert_eq!(result.len(), 2);
    }
}
