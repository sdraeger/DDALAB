use super::run::{analyze, Job};
use crate::cli::args::BatchArgs;
use crate::cli::dda_params;
use crate::cli::exit_codes;
use crate::cli::output;
use crate::io::discover_bids_recordings;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Instant;

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

    // Validate shared params; an empty channel selection means each recording's good channels.
    if let Err(msg) = dda_params::validate_params(
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

    // Recording paths in the manifest start with the BIDS directory's own name, as `ds003029/sub-01/...`.
    let root = args.bids_dir.as_deref().map(Path::new);
    let dataset_name = root.and_then(|root| {
        let resolved = std::fs::canonicalize(root).ok()?;
        resolved.file_name().map(PathBuf::from)
    });
    let in_dataset = |path: &str| match (
        &dataset_name,
        root.and_then(|root| Path::new(path).strip_prefix(root).ok()),
    ) {
        (Some(name), Some(rest)) => name.join(rest).display().to_string(),
        _ => path.to_string(),
    };
    let total = files.len();
    let mut results: Vec<Value> = Vec::new();
    let mut succeeded = 0usize;
    let mut failed = 0usize;
    let start_time = Instant::now();

    for (i, file_path) in files.iter().enumerate() {
        if !args.quiet {
            eprintln!("[{}/{}] {}...", i + 1, total, file_path);
        }

        let outcome: Result<(Vec<String>, Option<String>, Value), String> = async {
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
            let analysis = analyze(Job {
                file: file_path,
                sample_rate_hz: args.sr,
                request,
                start: None,
                end: None,
                start_sample: None,
                end_sample: None,
                device: args.device,
                block_mb: args.block_mb,
                bundle: None,
                progress: false,
            })
            .await
            .map_err(|(_, message)| message)?;
            if !args.quiet {
                eprintln!("  Backend: pure-rust ({})", args.device);
            }

            // With --output-dir the document is in its file and the manifest keeps the row and window counts.
            let document = &analysis.document;
            let Some(dir) = &args.output_dir else {
                let inline = serde_json::to_value(document).map_err(|e| e.to_string())?;
                return Ok((analysis.warnings, None, inline));
            };
            let path = Path::new(dir).join(output_name(file_path));
            output::write_json(document, args.compact, path.to_str())
                .map_err(|error| format!("Error writing output: {}", error))?;
            let rows: serde_json::Map<String, Value> = document
                .variants
                .iter()
                .map(|v| (v.id.clone(), json!(v.row_labels.len())))
                .collect();
            let counts = json!({"rows": rows, "windows": document.window_centers_seconds.len()});
            Ok((
                analysis.warnings,
                Some(path.to_string_lossy().into_owned()),
                counts,
            ))
        }
        .await;

        let input_path = in_dataset(file_path);
        let resolved = match root {
            Some(_) => input_path.clone(),
            None => canonical(file_path),
        };
        match outcome {
            Ok((warnings, output_path, result)) => {
                succeeded += 1;
                results.push(json!({
                    "inputPath": input_path,
                    "resolvedDatasetPath": resolved,
                    "status": "ok",
                    "warnings": warnings,
                    "outputPath": output_path,
                    "result": result,
                }));
            }
            Err(error) => {
                eprintln!("  {}", error);
                failed += 1;
                results.push(json!({
                    "inputPath": input_path,
                    "resolvedDatasetPath": resolved,
                    "status": "error",
                    "warnings": [],
                    "error": error,
                    "outputPath": null,
                }));
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

    let with_warnings = results
        .iter()
        .filter(|r| r["warnings"].as_array().is_some_and(|w| !w.is_empty()))
        .count();
    let manifest = json!({
        "matchedFiles": total,
        "processedFiles": results.len(),
        "succeeded": succeeded,
        "failed": failed,
        "withWarnings": with_warnings,
        "results": results,
    });
    if let Err(error) = output::write_json(&manifest, args.compact, None) {
        eprintln!("Error: {}", error);
        return exit_codes::EXECUTION_ERROR;
    }

    if failed == 0 {
        exit_codes::SUCCESS
    } else if succeeded > 0 {
        exit_codes::PARTIAL_FAILURE
    } else {
        exit_codes::EXECUTION_ERROR
    }
}

/// The absolute path with links resolved, as Python's `Path.resolve()`; `path` itself when it cannot be resolved.
fn canonical(path: &str) -> String {
    std::fs::canonicalize(path).map_or_else(
        |_| path.to_string(),
        |resolved| resolved.to_string_lossy().into_owned(),
    )
}

/// `<stem>.<sha8>.dda.json` as the Python batch names a result: the stem of `file` with every character
/// other than letters, digits, `-`, `_` and `.` replaced by `_` and `.` and `_` trimmed from its ends ("dataset" when
/// nothing is left), and the first 8 hex digits of the SHA-1 of the file's resolved path.
fn output_name(file: &str) -> String {
    let stem = Path::new(file)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let safe: String = stem
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || "-_.".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe = safe.trim_matches(['.', '_']);
    let safe = if safe.is_empty() { "dataset" } else { safe };
    format!(
        "{safe}.{}.dda.json",
        sha1_prefix(canonical(file).as_bytes())
    )
}

/// The first 8 hex digits of the SHA-1 of `data` (the `sha2` crate has no SHA-1; the digest only names files).
fn sha1_prefix(data: &[u8]) -> String {
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    let mut message = data.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend((data.len() as u64 * 8).to_be_bytes());
    for chunk in message.chunks_exact(64) {
        let mut w = [0u32; 80];
        for i in 0..80 {
            w[i] = match i {
                0..=15 => u32::from_be_bytes(chunk[4 * i..4 * i + 4].try_into().unwrap()),
                _ => (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1),
            };
        }
        let [mut a, mut b, mut c, mut d, mut e] = h;
        for (i, wi) in w.into_iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            (a, b, c, d, e) = (next, a, b.rotate_left(30), c, d);
        }
        for (word, more) in h.iter_mut().zip([a, b, c, d, e]) {
            *word = word.wrapping_add(more);
        }
    }
    format!("{:08x}", h[0])
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
    let recordings = discover_bids_recordings(root)
        .map_err(|error| format!("Cannot read BIDS directory {}: {}", dir, error))?;
    Ok(recordings
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
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
            block_mb: crate::cli::args::DEFAULT_BLOCK_MB,
            continue_on_error: false,
            dry_run: false,
            compact: false,
            quiet: false,
            device: crate::ComputeDevice::Cpu,
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
        fs::write(sub_dir.join("sub-01_task-x_eeg.edf"), "").unwrap();
        fs::write(sub_dir.join("sub-01_task-x_eeg.vhdr"), "").unwrap();
        fs::write(sub_dir.join("sub-01_task-x_eeg.csv"), "").unwrap(); // not a BIDS recording
        fs::write(sub_dir.join("sub-01_task-x_eeg.xyz"), "").unwrap(); // unsupported

        let result = resolve_bids_dir(tmp.path().to_str().unwrap()).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result[0].ends_with("sub-01_task-x_eeg.edf"));
        assert!(result[1].ends_with("sub-01_task-x_eeg.vhdr"));
    }

    #[test]
    fn test_resolve_bids_dir_skips_hidden() {
        let tmp = tempfile::tempdir().unwrap();
        let hidden_dir = tmp.path().join(".hidden");
        fs::create_dir_all(&hidden_dir).unwrap();
        fs::write(hidden_dir.join("sub-01_task-x_eeg.edf"), "").unwrap();

        let result = resolve_bids_dir(tmp.path().to_str().unwrap()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_sha1_prefix_matches_python_hashlib() {
        // hashlib.sha1(data).hexdigest()[:8]; the lengths straddle the padding boundaries of 56 and 64 bytes.
        for (len, want) in [
            (0, "da39a3ee"),
            (55, "c1c8bbdc"),
            (56, "c2db330f"),
            (64, "0098ba82"),
            (119, "ee971065"),
            (120, "f34c1488"),
        ] {
            assert_eq!(sha1_prefix(&vec![b'a'; len]), want, "{len} bytes");
        }
        assert_eq!(sha1_prefix(b"abc"), "a9993e36");
    }

    #[test]
    fn test_output_name_sanitizes_the_stem_and_hashes_the_resolved_path() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("_sub 01.task+x_ieeg.vhdr");
        fs::write(&file, "").unwrap();
        let resolved = fs::canonicalize(&file).unwrap();
        let name = output_name(file.to_str().unwrap());
        assert_eq!(
            name,
            format!(
                "sub_01.task_x_ieeg.{}.dda.json",
                sha1_prefix(resolved.to_str().unwrap().as_bytes())
            )
        );
        assert_eq!(
            output_name("/nonexistent/_.edf"),
            format!("dataset.{}.dda.json", sha1_prefix(b"/nonexistent/_.edf"))
        );
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
