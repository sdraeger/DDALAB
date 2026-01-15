use crate::error::{DDAError, Result};
use crate::types::{DDARequest, DDAResult};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

/// Variant suffix patterns used by the DDA binary.
/// Maps variant ID to possible file suffixes (checked in order).
/// IMPORTANT: More specific patterns must come before less specific ones
/// (e.g., _CD_DDA_ST before _ST to avoid false matches).
const VARIANT_SUFFIXES: &[(&str, &[&str])] = &[
    ("CD", &["_CD_DDA_ST", "_CD"]), // Must check CD first (contains _ST)
    ("CT", &["_DDA_CT", "_CT"]),    // Must check _DDA_CT before _CT
    ("ST", &["_DDA_ST", "_ST"]),    // Check after CD
    ("DE", &["_DE"]),
    ("SY", &["_SY"]),
];

/// Scans a directory and returns a set of file paths.
fn scan_directory(dir: &Path) -> HashSet<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_file())
                .collect()
        })
        .unwrap_or_default()
}

/// Finds new files created in a directory by comparing before/after snapshots.
fn find_new_files(before: &HashSet<PathBuf>, after: &HashSet<PathBuf>) -> Vec<PathBuf> {
    after.difference(before).cloned().collect()
}

/// Identifies the variant type from a filename based on known suffix patterns.
fn identify_variant(filename: &str) -> Option<&'static str> {
    for (variant_id, suffixes) in VARIANT_SUFFIXES {
        for suffix in *suffixes {
            if filename.ends_with(suffix) {
                return Some(variant_id);
            }
        }
    }
    None
}

/// Gets the stride value for parsing a variant's output.
fn get_variant_stride(variant_id: &str) -> Option<usize> {
    match variant_id {
        "CD" => Some(2),
        "DE" | "SY" => Some(1),
        _ => None,
    }
}

/// Output from executing the DDA binary.
pub struct BinaryOutput {
    pub success: bool,
    pub stdout_lines: Vec<String>,
    pub stderr: String,
    pub new_files: Vec<PathBuf>,
}

/// DDA Binary Runner
///
/// Handles execution of the run_DDA_AsciiEdf binary (APE/Cosmopolitan Libc format)
pub struct DDARunner {
    binary_path: PathBuf,
}

impl DDARunner {
    /// Create a new DDA runner with the specified binary path
    pub fn new<P: AsRef<Path>>(binary_path: P) -> Result<Self> {
        let binary_path = binary_path.as_ref().to_path_buf();

        if !binary_path.exists() {
            return Err(DDAError::BinaryNotFound(binary_path.display().to_string()));
        }

        Ok(Self { binary_path })
    }

    /// Create a new DDA runner by auto-discovering the binary location.
    pub fn discover() -> Result<Self> {
        use crate::variants::find_binary;

        match find_binary(None) {
            Some(path) => Ok(Self { binary_path: path }),
            None => Err(DDAError::BinaryNotFound(format!(
                "DDA binary '{}' not found. Set $DDA_BINARY_PATH or $DDA_HOME, \
                 or install to one of: ~/.local/bin, ~/bin, /usr/local/bin, /opt/dda/bin",
                crate::variants::BINARY_NAME
            ))),
        }
    }

    /// Create a DDA runner with optional binary path.
    pub fn try_new<P: AsRef<Path>>(binary_path: Option<P>) -> Result<Self> {
        match binary_path {
            Some(path) => Self::new(path),
            None => Self::discover(),
        }
    }

    /// Execute the DDA binary with stdout streaming and directory scanning.
    /// Returns the captured output and list of new files created.
    async fn execute_binary(
        &self,
        args: Vec<String>,
        work_dir: &Path,
        timeout_secs: u64,
    ) -> Result<BinaryOutput> {
        // Snapshot directory before execution
        let files_before = scan_directory(work_dir);

        // Build command
        let mut cmd = if cfg!(target_os = "windows") {
            Command::new(&self.binary_path)
        } else {
            let mut c = Command::new("sh");
            c.arg(&self.binary_path);
            c
        };

        for arg in &args {
            cmd.arg(arg);
        }

        // Pipe stdout and stderr for capture
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| DDAError::ExecutionFailed(format!("Failed to spawn binary: {}", e)))?;

        // Capture stdout lines (may contain progress info like ETA)
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        let stdout_handle = tokio::spawn(async move {
            let mut lines = Vec::new();
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                let mut line_reader = reader.lines();
                while let Ok(Some(line)) = line_reader.next_line().await {
                    log::debug!("DDA stdout: {}", line);
                    lines.push(line);
                }
            }
            lines
        });

        let stderr_handle = tokio::spawn(async move {
            let mut output = String::new();
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                let mut line_reader = reader.lines();
                while let Ok(Some(line)) = line_reader.next_line().await {
                    log::debug!("DDA stderr: {}", line);
                    output.push_str(&line);
                    output.push('\n');
                }
            }
            output
        });

        // Wait for process with timeout
        let status = timeout(Duration::from_secs(timeout_secs), child.wait())
            .await
            .map_err(|_| DDAError::ExecutionFailed("DDA binary execution timed out".to_string()))?
            .map_err(|e| DDAError::ExecutionFailed(format!("Failed to wait for binary: {}", e)))?;

        // Collect stdout/stderr
        let stdout_lines = stdout_handle.await.unwrap_or_default();
        let stderr_output = stderr_handle.await.unwrap_or_default();

        // Snapshot directory after execution
        let files_after = scan_directory(work_dir);
        let new_files = find_new_files(&files_before, &files_after);

        log::debug!("Binary created {} new files", new_files.len());
        for f in &new_files {
            log::debug!("  New file: {:?}", f.file_name());
        }

        Ok(BinaryOutput {
            success: status.success(),
            stdout_lines,
            stderr: stderr_output,
            new_files,
        })
    }

    /// Build common DDA arguments.
    fn build_common_args(
        &self,
        input_file: &Path,
        output_file: &Path,
        file_type_flag: &str,
        channels: &[String],
        request: &DDARequest,
        select_mask: &str,
        start_bound: Option<u64>,
        end_bound: Option<u64>,
    ) -> Result<Vec<String>> {
        let input_path_str = input_file.to_str().ok_or_else(|| {
            DDAError::InvalidParameter(format!("Input path not valid UTF-8: {:?}", input_file))
        })?;

        let output_path_str = output_file.to_str().ok_or_else(|| {
            DDAError::InvalidParameter(format!("Output path not valid UTF-8: {:?}", output_file))
        })?;

        let mut args = vec![
            "-DATA_FN".to_string(),
            input_path_str.to_string(),
            "-OUT_FN".to_string(),
            output_path_str.to_string(),
            file_type_flag.to_string(),
            "-CH_list".to_string(),
        ];

        args.extend(channels.iter().cloned());

        let model = request.model_parameters.as_ref();
        args.extend([
            "-dm".to_string(),
            model.map(|m| m.dm).unwrap_or(4).to_string(),
            "-order".to_string(),
            model.map(|m| m.order).unwrap_or(4).to_string(),
            "-nr_tau".to_string(),
            model.map(|m| m.nr_tau).unwrap_or(2).to_string(),
            "-WL".to_string(),
            request.window_parameters.window_length.to_string(),
            "-WS".to_string(),
            request.window_parameters.window_step.to_string(),
        ]);

        args.push("-SELECT".to_string());
        args.extend(select_mask.split_whitespace().map(String::from));

        args.extend([
            "-MODEL".to_string(),
            "1".to_string(),
            "2".to_string(),
            "10".to_string(),
        ]);

        if let Some(ct_wl) = request.window_parameters.ct_window_length {
            args.extend(["-WL_CT".to_string(), ct_wl.to_string()]);
        }
        if let Some(ct_ws) = request.window_parameters.ct_window_step {
            args.extend(["-WS_CT".to_string(), ct_ws.to_string()]);
        }

        args.push("-TAU".to_string());
        args.extend(
            request
                .delay_parameters
                .delays
                .iter()
                .map(|d| d.to_string()),
        );

        if let (Some(start), Some(end)) = (start_bound, end_bound) {
            args.extend(["-StartEnd".to_string(), start.to_string(), end.to_string()]);
        }

        if let Some(sr) = request.sampling_rate {
            if sr > 1000.0 {
                args.extend([
                    "-SR".to_string(),
                    ((sr / 2.0) as u32).to_string(),
                    (sr as u32).to_string(),
                ]);
            }
        }

        Ok(args)
    }

    /// Process output files and extract variant results.
    async fn process_output_files(
        &self,
        new_files: &[PathBuf],
        enabled_variants: &[&str],
    ) -> Vec<(String, Vec<Vec<f64>>, Vec<f64>)> {
        let mut results = Vec::new();

        for variant_id in enabled_variants {
            // Find file matching this variant
            let variant_file = new_files.iter().find(|f| {
                f.file_name()
                    .and_then(|n| n.to_str())
                    .map(|name| identify_variant(name) == Some(variant_id))
                    .unwrap_or(false)
            });

            if let Some(file_path) = variant_file {
                // Use spawn_blocking for mmap and parsing operations
                let file_path_clone = file_path.clone();
                let variant_id_owned = variant_id.to_string();

                let result = tokio::task::spawn_blocking(move || {
                    match crate::mmap_utils::mmap_file(&file_path_clone) {
                        Ok(mmap) => {
                            let stride = get_variant_stride(&variant_id_owned);
                            // Parse directly from mmap byte slice
                            match crate::parser::parse_dda_output_from_bytes(&mmap, stride) {
                                Ok(parsed) => {
                                    if !parsed.q_matrix.is_empty() {
                                        Some((
                                            variant_id_owned,
                                            parsed.q_matrix,
                                            parsed.error_values,
                                        ))
                                    } else {
                                        None
                                    }
                                }
                                Err(e) => {
                                    log::warn!(
                                        "Failed to parse variant file {:?}: {}",
                                        file_path_clone,
                                        e
                                    );
                                    None
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Failed to mmap variant file {:?}: {}", file_path_clone, e);
                            None
                        }
                    }
                })
                .await;

                if let Ok(Some(res)) = result {
                    results.push(res);
                }

                // Clean up the file
                let _ = std::fs::remove_file(file_path);
            }
        }

        results
    }

    /// Run DDA analysis with the given request parameters
    pub async fn run(
        &self,
        request: &DDARequest,
        start_bound: Option<u64>,
        end_bound: Option<u64>,
        edf_channel_names: Option<&[String]>,
    ) -> Result<DDAResult> {
        let analysis_id = Uuid::new_v4().to_string();

        // Validate input file exists
        let file_path = PathBuf::from(&request.file_path);
        if !file_path.exists() {
            return Err(DDAError::FileNotFound(request.file_path.clone()));
        }

        log::info!("Starting DDA analysis for file: {}", request.file_path);

        // Create temporary directory for this run (automatically cleaned up on drop)
        let temp_dir = tempfile::tempdir().map_err(DDAError::IoError)?;

        // Use channel indices from request (convert to 1-based for DDA binary)
        let channel_indices: Vec<String> = if let Some(ref channels) = request.channels {
            channels.iter().map(|&idx| (idx + 1).to_string()).collect()
        } else {
            vec!["1".to_string()]
        };

        // Determine SELECT mask from request or default
        let select_mask = request
            .algorithm_selection
            .select_mask
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("1 0 0 0 0 0");

        // Parse SELECT mask to check which variants are enabled
        let select_bits: Vec<&str> = select_mask.split_whitespace().collect();
        let st_enabled = select_bits.first().map(|&b| b == "1").unwrap_or(false);
        let ct_enabled = select_bits.get(1).map(|&b| b == "1").unwrap_or(false);
        let cd_enabled = select_bits.get(2).map(|&b| b == "1").unwrap_or(false);
        let de_enabled = select_bits.get(4).map(|&b| b == "1").unwrap_or(false);
        let sy_enabled = select_bits.get(5).map(|&b| b == "1").unwrap_or(false);

        // Determine file type based on extension
        let is_ascii_file = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("ascii") || ext.eq_ignore_ascii_case("txt"))
            .unwrap_or(false);

        let file_type_flag = if is_ascii_file { "-ASCII" } else { "-EDF" };

        // For ASCII files, create a temporary file without header
        let actual_input_file = if is_ascii_file {
            let temp_ascii_file = temp_dir
                .path()
                .join(format!("dda_input_{}.ascii", analysis_id));

            // Use blocking IO for file streaming to avoid loading full file into memory
            let file_path_clone = file_path.clone();
            let temp_ascii_file_clone = temp_ascii_file.clone();

            tokio::task::spawn_blocking(move || -> Result<()> {
                use std::fs::File;
                use std::io::{BufRead, BufReader, BufWriter, Write};

                let input = File::open(&file_path_clone).map_err(DDAError::IoError)?;
                let mut reader = BufReader::new(input);

                // Read first line to check for header
                let mut first_line = String::new();
                let bytes_read = reader
                    .read_line(&mut first_line)
                    .map_err(DDAError::IoError)?;

                if bytes_read == 0 {
                    return Err(DDAError::ParseError("ASCII file is empty".to_string()));
                }

                let output = File::create(&temp_ascii_file_clone).map_err(DDAError::IoError)?;
                let mut writer = BufWriter::new(output);

                let has_header = first_line.chars().any(|c| c.is_alphabetic());

                if !has_header {
                    writer
                        .write_all(first_line.as_bytes())
                        .map_err(DDAError::IoError)?;
                }

                // Stream the rest of the file
                std::io::copy(&mut reader, &mut writer).map_err(DDAError::IoError)?;
                writer.flush().map_err(DDAError::IoError)?;

                Ok(())
            })
            .await
            .map_err(|e| DDAError::ExecutionFailed(format!("Task failed: {}", e)))??;

            temp_ascii_file
        } else {
            file_path.clone()
        };

        let mut variant_matrices: Vec<(String, Vec<Vec<f64>>, Vec<f64>)> = Vec::new();

        // --- Execution Group 1: Single Channel Variants (ST, DE, SY) ---
        if st_enabled || de_enabled || sy_enabled {
            let output_file = temp_dir
                .path()
                .join(format!("dda_output_{}_group1.txt", analysis_id));

            let mask_st = if st_enabled { "1" } else { "0" };
            let mask_de = if de_enabled { "1" } else { "0" };
            let mask_sy = if sy_enabled { "1" } else { "0" };
            let group1_mask = format!("{} 0 0 0 {} {}", mask_st, mask_de, mask_sy);

            let args = self.build_common_args(
                &actual_input_file,
                &output_file,
                file_type_flag,
                &channel_indices,
                request,
                &group1_mask,
                start_bound,
                end_bound,
            )?;

            log::info!("Executing DDA (ST/DE/SY) with directory scanning");
            let output = self.execute_binary(args, temp_dir.path(), 14400).await?;

            if !output.success {
                log::warn!("Group 1 binary failed: {}", output.stderr);
            }

            // Log any stdout (may contain progress/ETA info)
            for line in &output.stdout_lines {
                log::info!("DDA output: {}", line);
            }

            // Process new files using directory scanning
            let mut enabled: Vec<&str> = Vec::new();
            if st_enabled {
                enabled.push("ST");
            }
            if de_enabled {
                enabled.push("DE");
            }
            if sy_enabled {
                enabled.push("SY");
            }

            let results = self.process_output_files(&output.new_files, &enabled).await;
            variant_matrices.extend(results);
        }

        // --- Execution Group 2: CT (Cross-Timeseries) ---
        if ct_enabled {
            if let Some(pairs) = &request.ct_channel_pairs {
                if !pairs.is_empty() {
                    log::info!("Processing {} CT pairs sequentially", pairs.len());

                    let mut combined_ct_matrix = Vec::new();
                    let mut ct_error_values = Vec::new();

                    for (pair_idx, pair) in pairs.iter().enumerate() {
                        let pair_output_file = temp_dir.path().join(format!(
                            "dda_output_{}_ct_pair{}.txt",
                            analysis_id, pair_idx
                        ));

                        let pair_channels =
                            vec![(pair[0] + 1).to_string(), (pair[1] + 1).to_string()];

                        let mut args = self.build_common_args(
                            &actual_input_file,
                            &pair_output_file,
                            file_type_flag,
                            &pair_channels,
                            request,
                            "0 1 0 0 0 0",
                            start_bound,
                            end_bound,
                        )?;

                        // Add CT-specific window params
                        let ct_wl = request.window_parameters.ct_window_length.unwrap_or(2);
                        let ct_ws = request.window_parameters.ct_window_step.unwrap_or(2);
                        if request.window_parameters.ct_window_length.is_none() {
                            args.extend(["-WL_CT".to_string(), ct_wl.to_string()]);
                        }
                        if request.window_parameters.ct_window_step.is_none() {
                            args.extend(["-WS_CT".to_string(), ct_ws.to_string()]);
                        }

                        let output = self.execute_binary(args, temp_dir.path(), 3600).await?;

                        for line in &output.stdout_lines {
                            log::info!("DDA CT pair {} output: {}", pair_idx, line);
                        }

                        if output.success {
                            let results =
                                self.process_output_files(&output.new_files, &["CT"]).await;
                            for (_, matrix, errors) in results {
                                combined_ct_matrix.extend(matrix);
                                if ct_error_values.is_empty() {
                                    ct_error_values = errors;
                                }
                            }
                        }
                    }

                    if !combined_ct_matrix.is_empty() {
                        variant_matrices.push((
                            "CT".to_string(),
                            combined_ct_matrix,
                            ct_error_values,
                        ));
                    }
                }
            }
        }

        // --- Execution Group 3: CD (Cross-Dynamical) ---
        if cd_enabled {
            if let Some(pairs) = &request.cd_channel_pairs {
                if !pairs.is_empty() {
                    log::info!("Processing {} CD pairs sequentially", pairs.len());

                    let mut combined_cd_matrix = Vec::new();
                    let mut cd_error_values = Vec::new();

                    for (pair_idx, pair) in pairs.iter().enumerate() {
                        let pair_output_file = temp_dir.path().join(format!(
                            "dda_output_{}_cd_pair{}.txt",
                            analysis_id, pair_idx
                        ));

                        let pair_channels =
                            vec![(pair[0] + 1).to_string(), (pair[1] + 1).to_string()];

                        let mut args = self.build_common_args(
                            &actual_input_file,
                            &pair_output_file,
                            file_type_flag,
                            &pair_channels,
                            request,
                            "0 0 1 0 0 0",
                            start_bound,
                            end_bound,
                        )?;

                        // Add CT window params (CD uses them)
                        let ct_wl = request.window_parameters.ct_window_length.unwrap_or(2);
                        let ct_ws = request.window_parameters.ct_window_step.unwrap_or(2);
                        if request.window_parameters.ct_window_length.is_none() {
                            args.extend(["-WL_CT".to_string(), ct_wl.to_string()]);
                        }
                        if request.window_parameters.ct_window_step.is_none() {
                            args.extend(["-WS_CT".to_string(), ct_ws.to_string()]);
                        }

                        let output = self.execute_binary(args, temp_dir.path(), 3600).await?;

                        for line in &output.stdout_lines {
                            log::info!("DDA CD pair {} output: {}", pair_idx, line);
                        }

                        if output.success {
                            let results =
                                self.process_output_files(&output.new_files, &["CD"]).await;
                            for (_, matrix, errors) in results {
                                combined_cd_matrix.extend(matrix);
                                if cd_error_values.is_empty() {
                                    cd_error_values = errors;
                                }
                            }
                        }
                    }

                    if !combined_cd_matrix.is_empty() {
                        variant_matrices.push((
                            "CD".to_string(),
                            combined_cd_matrix,
                            cd_error_values,
                        ));
                    }
                }
            }
        }

        // --- Result Construction ---
        if variant_matrices.is_empty() {
            return Err(DDAError::ParseError("No data extracted".to_string()));
        }

        let (_, primary_q_matrix, primary_error_values) = variant_matrices
            .first()
            .ok_or_else(|| DDAError::ExecutionFailed("No results".to_string()))?;

        let channels: Vec<String> = if let Some(ref channel_indices) = request.channels {
            channel_indices
                .iter()
                .map(|&idx| format!("Channel {}", idx + 1))
                .collect()
        } else {
            vec!["Channel 1".to_string()]
        };

        let variant_display_names = |id: &str| -> String {
            match id {
                "ST" => "Single Timeseries (ST)".to_string(),
                "CT" => "Cross-Timeseries (CT)".to_string(),
                "CD" => "Cross-Dynamical (CD)".to_string(),
                "DE" => "Dynamical Ergodicity (DE)".to_string(),
                "SY" => "Synchronization (SY)".to_string(),
                _ => id.to_string(),
            }
        };

        let variant_results: Vec<crate::types::VariantResult> = variant_matrices
            .iter()
            .map(|(id, q, err)| {
                let channel_labels = if id == "CD" {
                    request.cd_channel_pairs.as_ref().map(|pairs| {
                        pairs
                            .iter()
                            .map(|p| {
                                if let Some(names) = edf_channel_names {
                                    format!(
                                        "{} -> {}",
                                        names.get(p[0]).unwrap_or(&"?".into()),
                                        names.get(p[1]).unwrap_or(&"?".into())
                                    )
                                } else {
                                    format!("Ch{} -> Ch{}", p[0] + 1, p[1] + 1)
                                }
                            })
                            .collect()
                    })
                } else if id == "CT" {
                    request.ct_channel_pairs.as_ref().map(|pairs| {
                        pairs
                            .iter()
                            .map(|p| {
                                if let Some(names) = edf_channel_names {
                                    format!(
                                        "{} <-> {}",
                                        names.get(p[0]).unwrap_or(&"?".into()),
                                        names.get(p[1]).unwrap_or(&"?".into())
                                    )
                                } else {
                                    format!("Ch{} <-> Ch{}", p[0] + 1, p[1] + 1)
                                }
                            })
                            .collect()
                    })
                } else if let Some(names) = edf_channel_names {
                    let indices = request.channels.as_ref();
                    if let Some(idxs) = indices {
                        let mut l: Vec<String> =
                            idxs.iter().filter_map(|&i| names.get(i).cloned()).collect();
                        if l.len() > q.len() {
                            l.truncate(q.len());
                        }
                        Some(l)
                    } else {
                        let mut l = names.to_vec();
                        if l.len() > q.len() {
                            l.truncate(q.len());
                        }
                        Some(l)
                    }
                } else {
                    None
                };

                crate::types::VariantResult {
                    variant_id: id.clone(),
                    variant_name: variant_display_names(id),
                    q_matrix: q.clone(),
                    channel_labels,
                    error_values: if err.is_empty() {
                        None
                    } else {
                        Some(err.clone())
                    },
                }
            })
            .collect();

        Ok(DDAResult::new(
            analysis_id,
            request.file_path.clone(),
            channels,
            primary_q_matrix.clone(),
            request.window_parameters.clone(),
            request.delay_parameters.clone(),
        )
        .with_variant_results(variant_results)
        .with_error_values(primary_error_values.clone()))
    }

    pub fn binary_path(&self) -> &Path {
        &self.binary_path
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runner_creation_invalid_path() {
        let result = DDARunner::new("/nonexistent/binary");
        assert!(result.is_err());
    }

    #[test]
    fn test_identify_variant() {
        assert_eq!(identify_variant("output_ST"), Some("ST"));
        assert_eq!(identify_variant("output_DDA_ST"), Some("ST"));
        assert_eq!(identify_variant("output_CT"), Some("CT"));
        assert_eq!(identify_variant("output_DDA_CT"), Some("CT"));
        assert_eq!(identify_variant("output_CD_DDA_ST"), Some("CD"));
        assert_eq!(identify_variant("output_CD"), Some("CD"));
        assert_eq!(identify_variant("output_DE"), Some("DE"));
        assert_eq!(identify_variant("output_SY"), Some("SY"));
        assert_eq!(identify_variant("random_file"), None);
    }

    #[test]
    fn test_scan_directory() {
        let temp_dir = tempfile::tempdir().unwrap();

        // Create some test files
        std::fs::write(temp_dir.path().join("file1.txt"), "test").unwrap();
        std::fs::write(temp_dir.path().join("file2.txt"), "test").unwrap();

        let files = scan_directory(temp_dir.path());
        assert_eq!(files.len(), 2);
    }

    #[test]
    fn test_find_new_files() {
        let before: HashSet<PathBuf> = [PathBuf::from("/a"), PathBuf::from("/b")]
            .into_iter()
            .collect();
        let after: HashSet<PathBuf> = [
            PathBuf::from("/a"),
            PathBuf::from("/b"),
            PathBuf::from("/c"),
        ]
        .into_iter()
        .collect();

        let new_files = find_new_files(&before, &after);
        assert_eq!(new_files.len(), 1);
        assert!(new_files.contains(&PathBuf::from("/c")));
    }
}
