use crate::error::{DDAError, Result};
use crate::parser::parse_dda_output;
use crate::profiling::ProfileScope;
use crate::types::*;
use std::path::{Path, PathBuf};
use tokio::process::Command;
use uuid::Uuid;

/// DDA Binary Runner
///
/// Handles execution of the run_DDA_AsciiEdf binary (APE/Cosmopolitan Libc format)
pub struct DDARunner {
    binary_path: PathBuf,
}

impl DDARunner {
    /// Create a new DDA runner with the specified binary path
    ///
    /// # Arguments
    /// * `binary_path` - Path to the run_DDA_AsciiEdf binary
    ///
    /// # Returns
    /// A Result containing the DDARunner or an error if the binary doesn't exist
    pub fn new<P: AsRef<Path>>(binary_path: P) -> Result<Self> {
        let binary_path = binary_path.as_ref().to_path_buf();

        if !binary_path.exists() {
            return Err(DDAError::BinaryNotFound(binary_path.display().to_string()));
        }

        Ok(Self { binary_path })
    }

    /// Run DDA analysis with the given request parameters
    ///
    /// # Arguments
    /// * `request` - DDA analysis configuration
    /// * `start_bound` - Optional starting sample index. If None, uses time_range.start with file's sample rate
    /// * `end_bound` - Optional ending sample index. If None, uses time_range.end with file's sample rate
    /// * `edf_channel_names` - Optional list of EDF channel names for labeling
    ///
    /// # Returns
    /// DDAResult containing the processed Q matrix and metadata
    ///
    /// # Note
    /// When bounds are None, the entire file duration specified in time_range will be used
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
        log::info!(
            "Channel indices (0-based from frontend): {:?}",
            request.channels
        );
        log::info!("Time range: {:?}", request.time_range);
        log::info!("Window parameters: {:?}", request.window_parameters);
        log::info!("Delay parameters: {:?}", request.delay_parameters);

        // Create temporary output file
        let temp_dir = std::env::temp_dir();
        let output_file = temp_dir.join(format!("dda_output_{}.txt", analysis_id));

        // Use channel indices from request (convert to 1-based for DDA binary)
        let channel_indices: Vec<String> = if let Some(ref channels) = request.channels {
            channels.iter().map(|&idx| (idx + 1).to_string()).collect()
        } else {
            vec!["1".to_string()] // Default to first channel
        };

        log::info!(
            "Channel indices (1-based for DDA binary): {:?}",
            channel_indices
        );

        // Build DDA command - APE binary needs to run through sh on Unix systems (macOS/Linux)
        // APE (Actually Portable Executable) binaries have a shell script header for portability
        let mut command = if cfg!(target_os = "windows") {
            // Windows: run .exe directly
            Command::new(&self.binary_path)
        } else {
            // Unix (macOS/Linux): run through sh to handle APE polyglot format
            let mut cmd = Command::new("sh");
            cmd.arg(&self.binary_path);
            cmd
        };

        // Determine SELECT mask
        let select_mask = request
            .algorithm_selection
            .select_mask
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("1 0 0 0 0 0");

        // Parse SELECT mask to check which variants are enabled
        // Format: ST CT CD RESERVED DE SY
        let select_bits: Vec<&str> = select_mask.split_whitespace().collect();
        let st_enabled = select_bits.get(0).map(|&b| b == "1").unwrap_or(false);
        let ct_enabled = select_bits.get(1).map(|&b| b == "1").unwrap_or(false);
        let cd_enabled = select_bits.get(2).map(|&b| b == "1").unwrap_or(false);
        let _reserved = select_bits.get(3).map(|&b| b == "1").unwrap_or(false);
        let de_enabled = select_bits.get(4).map(|&b| b == "1").unwrap_or(false);
        let _sy_enabled = select_bits.get(5).map(|&b| b == "1").unwrap_or(false);
        let has_ct_pairs = ct_enabled
            && request
                .ct_channel_pairs
                .as_ref()
                .map(|p| !p.is_empty())
                .unwrap_or(false);
        let has_cd_pairs = cd_enabled
            && request
                .cd_channel_pairs
                .as_ref()
                .map(|p| !p.is_empty())
                .unwrap_or(false);

        // If ST is enabled with either CT or CD pairs, we need to run separate executions:
        // 1. First run: ST only (with all individual channels)
        // 2. Additional runs: CT only (one per pair) if has_ct_pairs
        // 3. Additional run: CD only (with directed pairs) if has_cd_pairs
        let run_st_separately = st_enabled && (has_ct_pairs || has_cd_pairs);

        // Determine SELECT mask for this first execution
        let first_select_mask = if run_st_separately {
            // First run will be ST-only, CT and CD will be run separately
            let mut bits = select_bits.clone();
            if bits.len() > 1 {
                bits[1] = "0"; // Disable CT for first run
            }
            if bits.len() > 2 && has_cd_pairs {
                bits[2] = "0"; // Disable CD for first run if CD pairs provided
            }
            bits.join(" ")
        } else {
            select_mask.to_string()
        };

        log::info!("First execution SELECT mask: {}", first_select_mask);
        if run_st_separately {
            if has_ct_pairs {
                log::info!(
                    "Will run CT separately for {} channel pairs",
                    request.ct_channel_pairs.as_ref().unwrap().len()
                );
            }
            if has_cd_pairs {
                log::info!(
                    "Will run CD separately for {} directed channel pairs",
                    request.cd_channel_pairs.as_ref().unwrap().len()
                );
            }
        }

        // Determine file type based on extension
        let is_ascii_file = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("ascii") || ext.eq_ignore_ascii_case("txt"))
            .unwrap_or(false);

        let file_type_flag = if is_ascii_file { "-ASCII" } else { "-EDF" };

        log::info!("Using file type flag: {}", file_type_flag);

        // For ASCII files, create a temporary file without header
        // The DDA binary expects pure numeric data and will fail if there are letters
        let actual_input_file = if is_ascii_file {
            let temp_ascii_file = temp_dir.join(format!("dda_input_{}.ascii", analysis_id));

            // Read the original file and strip header if present
            let content = tokio::fs::read_to_string(&file_path)
                .await
                .map_err(|e| DDAError::IoError(e))?;

            let lines: Vec<&str> = content.lines().collect();
            if lines.is_empty() {
                return Err(DDAError::ParseError("ASCII file is empty".to_string()));
            }

            // Check if first line contains non-numeric characters (header)
            let first_line = lines[0];
            let has_header = first_line.chars().any(|c| c.is_alphabetic());

            let data_lines = if has_header {
                log::info!("Detected header in ASCII file, stripping it for DDA binary");
                &lines[1..]
            } else {
                &lines[..]
            };

            // Write data without header to temp file
            let data_content = data_lines.join("\n");
            tokio::fs::write(&temp_ascii_file, data_content)
                .await
                .map_err(|e| DDAError::IoError(e))?;

            log::info!(
                "Created temporary headerless ASCII file: {:?}",
                temp_ascii_file
            );
            temp_ascii_file
        } else {
            file_path.clone()
        };

        // Add DDA parameters for first execution
        command
            .arg("-DATA_FN")
            .arg(&actual_input_file)
            .arg("-OUT_FN")
            .arg(output_file.to_str().unwrap())
            .arg(file_type_flag);

        // Add channel list - use individual channels for first run when running ST separately
        command.arg("-CH_list");
        if run_st_separately {
            // Use all individual channels for ST
            for ch in &channel_indices {
                command.arg(ch);
            }
            log::info!(
                "Using {} individual channels for ST variant",
                channel_indices.len()
            );
        } else if cd_enabled && has_cd_pairs {
            // CD-DDA: use directed channel pairs as flat list (e.g., 1 2 1 3 1 4)
            let pairs = request.cd_channel_pairs.as_ref().unwrap();
            for pair in pairs {
                command.arg((pair[0] + 1).to_string()); // from channel (1-based)
                command.arg((pair[1] + 1).to_string()); // to channel (1-based)
            }
            log::info!(
                "CD-DDA: using {} directed channel pairs (flat list format)",
                pairs.len()
            );
        } else if ct_enabled && has_ct_pairs {
            // CT is enabled without ST - use first pair
            let pairs = request.ct_channel_pairs.as_ref().unwrap();
            let first_pair = &pairs[0];
            command.arg((first_pair[0] + 1).to_string());
            command.arg((first_pair[1] + 1).to_string());
            log::info!(
                "CT only - processing first pair (1-based): [{}, {}]",
                first_pair[0] + 1,
                first_pair[1] + 1
            );
            if pairs.len() > 1 {
                log::info!(
                    "Will process {} additional CT pairs in separate executions",
                    pairs.len() - 1
                );
            }
        } else {
            // Standard case - use individual channels
            for ch in &channel_indices {
                command.arg(ch);
            }
            log::info!(
                "Using {} individual channels for enabled variants",
                channel_indices.len()
            );
        }

        // Add base parameters (matching dda-py BASE_PARAMS or using expert mode values)
        let model_params = request.model_parameters.as_ref();
        let dm = model_params.map(|m| m.dm).unwrap_or(4);
        let order = model_params.map(|m| m.order).unwrap_or(4);
        let nr_tau = model_params.map(|m| m.nr_tau).unwrap_or(2);

        command
            .arg("-dm")
            .arg(dm.to_string())
            .arg("-order")
            .arg(order.to_string())
            .arg("-nr_tau")
            .arg(nr_tau.to_string())
            .arg("-WL")
            .arg(request.window_parameters.window_length.to_string())
            .arg("-WS")
            .arg(request.window_parameters.window_step.to_string());

        // Add SELECT mask for first execution
        command.arg("-SELECT");
        for bit in first_select_mask.split_whitespace() {
            command.arg(bit);
        }

        command.arg("-MODEL").arg("1").arg("2").arg("10");

        // Add CT-specific window parameters if provided, or if DE is enabled (required for DE)
        let needs_ct_params = ct_enabled || has_ct_pairs || cd_enabled || de_enabled;
        if needs_ct_params {
            let ct_wl = request.window_parameters.ct_window_length.unwrap_or(2); // Default to 2 if not provided
            let ct_ws = request.window_parameters.ct_window_step.unwrap_or(2); // Default to 2 if not provided
            command.arg("-WL_CT").arg(ct_wl.to_string());
            command.arg("-WS_CT").arg(ct_ws.to_string());
        } else if request.window_parameters.ct_window_length.is_some()
            || request.window_parameters.ct_window_step.is_some()
        {
            // If CT parameters are explicitly provided but CT not enabled, still use them
            if let Some(ct_wl) = request.window_parameters.ct_window_length {
                command.arg("-WL_CT").arg(ct_wl.to_string());
            }
            if let Some(ct_ws) = request.window_parameters.ct_window_step {
                command.arg("-WS_CT").arg(ct_ws.to_string());
            }
        }

        // Add delay values directly from delay_parameters
        command.arg("-TAU");
        log::info!("Using delay values: {:?}", request.delay_parameters.delays);
        for delay in &request.delay_parameters.delays {
            command.arg(delay.to_string());
        }

        // Add time bounds (sample indices) only if provided
        // If not provided, the binary processes the entire file
        if let (Some(start), Some(end)) = (start_bound, end_bound) {
            command
                .arg("-StartEnd")
                .arg(start.to_string())
                .arg(end.to_string());
        }

        // Add sampling rate range if sampling rate > 1000 Hz
        // This is required for high-frequency data to enable proper frequency analysis
        if let Some(sr) = request.sampling_rate {
            if sr > 1000.0 {
                let sr_half = (sr / 2.0) as u32;
                let sr_full = sr as u32;
                command
                    .arg("-SR")
                    .arg(sr_half.to_string())
                    .arg(sr_full.to_string());
                log::info!(
                    "High-frequency data detected ({}Hz), adding -SR {} {}",
                    sr,
                    sr_half,
                    sr_full
                );
            }
        }

        log::info!("Executing DDA command: {:?}", command);

        // Execute DDA binary asynchronously
        let start_time = std::time::Instant::now();

        let output = command
            .output()
            .await
            .map_err(|e| DDAError::ExecutionFailed(format!("Failed to execute binary: {}", e)))?;

        let binary_time = start_time.elapsed();
        log::info!(
            "DDA binary execution completed in {:.2}s",
            binary_time.as_secs_f64()
        );

        if !output.status.success() {
            let stdout_str = String::from_utf8_lossy(&output.stdout);
            let stderr_str = String::from_utf8_lossy(&output.stderr);

            log::error!("DDA binary failed with status: {}", output.status);
            log::error!("stdout: {}", stdout_str);
            log::error!("stderr: {}", stderr_str);

            return Err(DDAError::ExecutionFailed(format!(
                "Binary failed with status: {}. stderr: {}",
                output.status, stderr_str
            )));
        }

        log::info!("DDA binary execution completed successfully");

        // Determine which variants are enabled from the ORIGINAL SELECT mask (not the modified first_select_mask)
        // Format: ST CT CD RESERVED DE SY
        let select_bits: Vec<&str> = select_mask.split_whitespace().collect();
        let mut enabled_variants: Vec<&str> = Vec::new();

        // Map each bit to its variant (skip RESERVED at index 3)
        if select_bits.get(0) == Some(&"1") {
            enabled_variants.push("ST");
        }
        if select_bits.get(1) == Some(&"1") {
            enabled_variants.push("CT");
        }
        if select_bits.get(2) == Some(&"1") {
            enabled_variants.push("CD");
        }
        // Skip index 3 (RESERVED)
        if select_bits.get(4) == Some(&"1") {
            enabled_variants.push("DE");
        }
        if select_bits.get(5) == Some(&"1") {
            enabled_variants.push("SY");
        }

        if enabled_variants.is_empty() {
            return Err(DDAError::ExecutionFailed(
                "No variants enabled in SELECT mask".to_string(),
            ));
        }

        log::info!(
            "Enabled variants (from original request): {:?}",
            enabled_variants
        );

        // Determine which variants were actually produced in this first execution
        let first_execution_variants: Vec<&str> = if run_st_separately {
            // When running ST separately, the first execution includes ST + any non-CT/CD variants (DE, SY)
            // Parse the first_select_mask to determine which variants were actually enabled
            let first_bits: Vec<&str> = first_select_mask.split_whitespace().collect();
            let mut variants_in_first_run = Vec::new();

            if first_bits.get(0) == Some(&"1") {
                variants_in_first_run.push("ST");
            }
            // Skip CT (position 1) and CD (position 2) as they're handled separately
            // Skip RESERVED (position 3)
            if first_bits.get(4) == Some(&"1") {
                variants_in_first_run.push("DE");
            }
            if first_bits.get(5) == Some(&"1") {
                variants_in_first_run.push("SY");
            }

            log::info!(
                "First execution will process variants: {:?}",
                variants_in_first_run
            );
            variants_in_first_run
        } else {
            enabled_variants.clone()
        };

        // DDA binary creates output files with variant suffixes (_ST, _CT, _CD, _DE)
        let output_file_stem = output_file
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output file path".to_string()))?;
        let output_dir = output_file
            .parent()
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output directory".to_string()))?;

        // Read all variants from first execution
        let mut variant_matrices: Vec<(String, Vec<Vec<f64>>)> = Vec::new();

        for variant in &first_execution_variants {
            // Each variant has a specific output file suffix:
            // ST: _DDA_ST, CT: _DDA_CT, CD: _CD_DDA_ST, DE: _DE, SY: _SY
            let suffix = match *variant {
                "ST" => "_DDA_ST",
                "CT" => "_DDA_CT",
                "CD" => "_CD_DDA_ST",
                "DE" => "_DE",
                "SY" => "_SY",
                _ => {
                    log::warn!("Unknown variant: {}, skipping", variant);
                    continue;
                }
            };

            let variant_file_with_suffix = output_file
                .to_str()
                .map(|s| PathBuf::from(format!("{}{}", s, suffix)))
                .ok_or_else(|| DDAError::ExecutionFailed("Invalid output path".to_string()))?;

            // Also try legacy format for backward compatibility
            let variant_file_legacy = output_file
                .to_str()
                .map(|s| PathBuf::from(format!("{}_{}", s, variant)))
                .ok_or_else(|| DDAError::ExecutionFailed("Invalid output path".to_string()))?;

            let actual_output_file = if variant_file_with_suffix.exists() {
                variant_file_with_suffix.clone()
            } else if variant_file_legacy.exists() {
                log::info!(
                    "Found variant {} with legacy suffix format: {:?}",
                    variant,
                    variant_file_legacy
                );
                variant_file_legacy.clone()
            } else {
                log::warn!(
                    "Output file not found for variant {}. Tried: {:?}, {:?}",
                    variant,
                    variant_file_with_suffix,
                    variant_file_legacy
                );
                continue; // Skip missing variants
            };

            log::info!(
                "Reading DDA output for variant {} from: {:?}",
                variant,
                actual_output_file
            );

            // Read and parse DDA output
            let output_content = tokio::fs::read_to_string(&actual_output_file)
                .await
                .map_err(|e| DDAError::IoError(e))?;

            log::info!(
                "Output file size for {}: {} bytes",
                variant,
                output_content.len()
            );

            // Parse the output file to extract Q matrix [channels × timepoints]
            // Stride values from DDA_SPEC.yaml:
            // ST/CT: 4 (3 coefficients + 1 error)
            // CD: 2 (1 coefficient + 1 error)
            // DE/SY: 1 (single value per measure)
            let stride = match *variant {
                "CD" => Some(2),
                "DE" => Some(1),
                "SY" => Some(1),
                _ => None, // Default stride=4 for ST, CT
            };
            let q_matrix = parse_dda_output(&output_content, stride)?;

            if !q_matrix.is_empty() {
                let num_channels = q_matrix.len();
                let num_timepoints = q_matrix[0].len();
                log::info!(
                    "Q matrix dimensions for {}: {} channels × {} timepoints",
                    variant,
                    num_channels,
                    num_timepoints
                );

                variant_matrices.push((variant.to_string(), q_matrix));
            } else {
                log::warn!("No data extracted from DDA output for variant {}", variant);
            }
        }

        // Handle CT separately if we ran ST separately
        if run_st_separately && has_ct_pairs {
            let num_pairs = request.ct_channel_pairs.as_ref().unwrap().len();
            log::info!("Now processing CT variant with {} channel pairs", num_pairs);

            let pairs = request.ct_channel_pairs.as_ref().unwrap();
            let mut combined_ct_matrix: Vec<Vec<f64>> = Vec::new();

            // Process all CT pairs sequentially (parallel processing causes excessive memory consumption)
            let _profile = ProfileScope::new(format!("ct_pair_processing_{}_pairs", num_pairs));
            log::info!("⏭️ Processing {} CT pairs sequentially", num_pairs);

            // Process all CT pairs
            for (pair_idx, pair) in pairs.iter().enumerate() {
                let pair_output_file =
                    temp_dir.join(format!("dda_output_{}_pair{}.txt", analysis_id, pair_idx));

                // Build command for this pair
                let mut pair_command = if cfg!(target_os = "windows") {
                    Command::new(&self.binary_path)
                } else {
                    let mut cmd = Command::new("sh");
                    cmd.arg(&self.binary_path);
                    cmd
                };

                pair_command
                    .arg("-DATA_FN")
                    .arg(&actual_input_file)
                    .arg("-OUT_FN")
                    .arg(pair_output_file.to_str().unwrap())
                    .arg(file_type_flag)
                    .arg("-CH_list")
                    .arg((pair[0] + 1).to_string())
                    .arg((pair[1] + 1).to_string())
                    .arg("-dm")
                    .arg(dm.to_string())
                    .arg("-order")
                    .arg(order.to_string())
                    .arg("-nr_tau")
                    .arg(nr_tau.to_string())
                    .arg("-WL")
                    .arg(request.window_parameters.window_length.to_string())
                    .arg("-WS")
                    .arg(request.window_parameters.window_step.to_string());

                // Add SELECT mask - CT only (0 1 0 0 0 0)
                // Format: ST CT CD RESERVED DE SY
                pair_command
                    .arg("-SELECT")
                    .arg("0")
                    .arg("1")
                    .arg("0")
                    .arg("0")
                    .arg("0")
                    .arg("0");

                pair_command.arg("-MODEL").arg("1").arg("2").arg("10");

                // Add CT-specific window parameters if provided
                if let Some(ct_wl) = request.window_parameters.ct_window_length {
                    pair_command.arg("-WL_CT").arg(ct_wl.to_string());
                }
                if let Some(ct_ws) = request.window_parameters.ct_window_step {
                    pair_command.arg("-WS_CT").arg(ct_ws.to_string());
                }

                // Add delay values directly from delay_parameters
                pair_command.arg("-TAU");
                for delay in &request.delay_parameters.delays {
                    pair_command.arg(delay.to_string());
                }

                // Add time bounds only if provided
                if let (Some(start), Some(end)) = (start_bound, end_bound) {
                    pair_command
                        .arg("-StartEnd")
                        .arg(start.to_string())
                        .arg(end.to_string());
                }

                // Add sampling rate range if > 1000 Hz
                if let Some(sr) = request.sampling_rate {
                    if sr > 1000.0 {
                        let sr_half = (sr / 2.0) as u32;
                        let sr_full = sr as u32;
                        pair_command
                            .arg("-SR")
                            .arg(sr_half.to_string())
                            .arg(sr_full.to_string());
                    }
                }

                log::info!(
                    "Executing DDA for CT pair {} (1-based): [{}, {}]",
                    pair_idx,
                    pair[0] + 1,
                    pair[1] + 1
                );

                // Execute
                let pair_output = pair_command.output().await.map_err(|e| {
                    DDAError::ExecutionFailed(format!(
                        "Failed to execute binary for pair {}: {}",
                        pair_idx, e
                    ))
                })?;

                if !pair_output.status.success() {
                    log::error!("DDA binary failed for CT pair {}", pair_idx);
                    continue;
                }

                // Read the CT output for this pair
                let pair_output_file_stem = pair_output_file
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| {
                    DDAError::ExecutionFailed("Invalid pair output path".to_string())
                })?;

                let pair_ct_file_path =
                    output_dir.join(format!("{}_{}_CT", pair_output_file_stem, ""));
                let pair_ct_file_with_ext = pair_output_file
                    .to_str()
                    .map(|s| PathBuf::from(format!("{}_CT", s)))
                    .ok_or_else(|| {
                        DDAError::ExecutionFailed("Invalid pair output path".to_string())
                    })?;

                let actual_pair_ct_file = if pair_ct_file_path.exists() {
                    pair_ct_file_path.clone()
                } else if pair_ct_file_with_ext.exists() {
                    pair_ct_file_with_ext.clone()
                } else {
                    log::warn!("CT output file not found for pair {}. Skipping.", pair_idx);
                    continue;
                };

                let pair_content = tokio::fs::read_to_string(&actual_pair_ct_file)
                    .await
                    .map_err(|e| DDAError::IoError(e))?;

                // CT uses default stride=4
                let pair_q_matrix = parse_dda_output(&pair_content, None)?;

                // Append this pair's channel to the combined CT matrix
                if !pair_q_matrix.is_empty() {
                    log::info!(
                        "Adding CT pair {} results: {} channels × {} timepoints",
                        pair_idx,
                        pair_q_matrix.len(),
                        pair_q_matrix[0].len()
                    );
                    combined_ct_matrix.extend(pair_q_matrix);
                }

                // Clean up pair output files
                let _ = tokio::fs::remove_file(&actual_pair_ct_file).await;
                let _ = tokio::fs::remove_file(&pair_output_file).await;
            }

            // Add the combined CT matrix to variant_matrices
            if !combined_ct_matrix.is_empty() {
                let num_channels = combined_ct_matrix.len();
                let num_timepoints = combined_ct_matrix[0].len();
                log::info!(
                    "Combined CT Q matrix dimensions: {} channels × {} timepoints",
                    num_channels,
                    num_timepoints
                );
                variant_matrices.push(("CT".to_string(), combined_ct_matrix));
            } else {
                log::warn!("No CT data extracted from any pair");
            }
        }

        // Handle CD separately if we ran ST separately
        if run_st_separately && has_cd_pairs {
            let pairs = request.cd_channel_pairs.as_ref().unwrap();
            let num_pairs = pairs.len();
            log::info!(
                "Now processing CD variant with {} directed channel pairs",
                num_pairs
            );

            let cd_output_file = temp_dir.join(format!("dda_output_{}_cd.txt", analysis_id));

            // Build command for CD with all directed pairs as flat list
            let mut cd_command = if cfg!(target_os = "windows") {
                Command::new(&self.binary_path)
            } else {
                let mut cmd = Command::new("sh");
                cmd.arg(&self.binary_path);
                cmd
            };

            cd_command
                .arg("-DATA_FN")
                .arg(&actual_input_file)
                .arg("-OUT_FN")
                .arg(cd_output_file.to_str().unwrap())
                .arg(file_type_flag)
                .arg("-CH_list");

            // Add all directed channel pairs as flat list: from1 to1 from2 to2 ...
            for pair in pairs.iter() {
                cd_command.arg((pair[0] + 1).to_string()); // from channel (1-based)
                cd_command.arg((pair[1] + 1).to_string()); // to channel (1-based)
            }

            cd_command
                .arg("-dm")
                .arg(dm.to_string())
                .arg("-order")
                .arg(order.to_string())
                .arg("-nr_tau")
                .arg(nr_tau.to_string())
                .arg("-WL")
                .arg(request.window_parameters.window_length.to_string())
                .arg("-WS")
                .arg(request.window_parameters.window_step.to_string());

            // Add SELECT mask - CD only (0 0 1 0 0 0)
            // CD now works independently, no longer requires ST+CT
            // Format: ST CT CD RESERVED DE SY
            cd_command
                .arg("-SELECT")
                .arg("0") // ST
                .arg("0") // CT
                .arg("1") // CD
                .arg("0") // RESERVED
                .arg("0") // DE
                .arg("0"); // SY

            cd_command.arg("-MODEL").arg("1").arg("2").arg("10");

            // Add CT-specific window parameters (required for CD)
            let ct_wl = request.window_parameters.ct_window_length.unwrap_or(2);
            let ct_ws = request.window_parameters.ct_window_step.unwrap_or(2);
            cd_command.arg("-WL_CT").arg(ct_wl.to_string());
            cd_command.arg("-WS_CT").arg(ct_ws.to_string());

            // Add delay values directly from delay_parameters
            cd_command.arg("-TAU");
            for delay in &request.delay_parameters.delays {
                cd_command.arg(delay.to_string());
            }

            // Add time bounds only if provided
            if let (Some(start), Some(end)) = (start_bound, end_bound) {
                cd_command
                    .arg("-StartEnd")
                    .arg(start.to_string())
                    .arg(end.to_string());
            }

            // Add sampling rate range if > 1000 Hz
            if let Some(sr) = request.sampling_rate {
                if sr > 1000.0 {
                    let sr_half = (sr / 2.0) as u32;
                    let sr_full = sr as u32;
                    cd_command
                        .arg("-SR")
                        .arg(sr_half.to_string())
                        .arg(sr_full.to_string());
                }
            }

            log::info!(
                "Executing DDA for CD variant with {} directed pairs",
                num_pairs
            );
            log::debug!("CD command: {:?}", cd_command);

            // Execute
            let cd_output = cd_command.output().await.map_err(|e| {
                DDAError::ExecutionFailed(format!("Failed to execute binary for CD: {}", e))
            })?;

            if !cd_output.status.success() {
                let stderr = String::from_utf8_lossy(&cd_output.stderr);
                log::error!("DDA binary failed for CD variant: {}", stderr);
            } else {
                // Read the CD output - look for _CD_DDA_ST suffix
                let cd_file_with_special_suffix = cd_output_file
                    .to_str()
                    .map(|s| PathBuf::from(format!("{}_CD_DDA_ST", s)))
                    .ok_or_else(|| {
                        DDAError::ExecutionFailed("Invalid CD output path".to_string())
                    })?;

                if cd_file_with_special_suffix.exists() {
                    log::info!("Found CD output file: {:?}", cd_file_with_special_suffix);

                    let cd_content = tokio::fs::read_to_string(&cd_file_with_special_suffix)
                        .await
                        .map_err(|e| DDAError::IoError(e))?;

                    // CD uses stride=1: each column after window bounds is one directed pair
                    let cd_q_matrix = crate::parser::parse_dda_output(&cd_content, Some(1))?;

                    let num_channels = cd_q_matrix.len();
                    let num_timepoints = cd_q_matrix.get(0).map(|r| r.len()).unwrap_or(0);
                    log::info!(
                        "CD Q matrix dimensions: {} channels × {} timepoints",
                        num_channels,
                        num_timepoints
                    );

                    variant_matrices.push(("CD".to_string(), cd_q_matrix));

                    // Clean up CD output files
                    let _ = tokio::fs::remove_file(&cd_file_with_special_suffix).await;
                } else {
                    log::warn!(
                        "CD output file not found at: {:?}",
                        cd_file_with_special_suffix
                    );
                }

                let _ = tokio::fs::remove_file(&cd_output_file).await;
            }
        }

        // Clean up temporary files
        let _ = tokio::fs::remove_file(&output_file).await;
        for variant in &enabled_variants {
            let variant_path = output_dir.join(format!("{}_{}", output_file_stem, variant));
            let _ = tokio::fs::remove_file(&variant_path).await;

            // Clean up CD special file naming (_CD_DDA_ST)
            if *variant == "CD" {
                if let Some(cd_path) = output_file
                    .to_str()
                    .map(|s| PathBuf::from(format!("{}_{}_DDA_ST", s, variant)))
                {
                    let _ = tokio::fs::remove_file(&cd_path).await;
                }
            }
        }

        // Clean up temporary ASCII file if we created one
        if is_ascii_file && actual_input_file != file_path {
            let _ = tokio::fs::remove_file(&actual_input_file).await;
        }

        if variant_matrices.is_empty() {
            return Err(DDAError::ParseError(
                "No data extracted from any DDA variant".to_string(),
            ));
        }

        // Use the first variant's matrix as the primary result (for backward compatibility)
        let (primary_variant_name, primary_q_matrix) = variant_matrices
            .first()
            .ok_or_else(|| DDAError::ExecutionFailed("No variant results available".to_string()))?;

        log::info!(
            "Using {} as primary variant, {} total variants processed",
            primary_variant_name,
            variant_matrices.len()
        );

        // Create channel labels
        let channels: Vec<String> = if let Some(ref channel_indices) = request.channels {
            channel_indices
                .iter()
                .map(|&idx| format!("Channel {}", idx + 1))
                .collect()
        } else {
            vec!["Channel 1".to_string()]
        };

        // Map variant short names to display names
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

        // Build variant results for all variants with appropriate channel labels
        let variant_results: Vec<crate::types::VariantResult> = variant_matrices
            .iter()
            .map(|(variant_id, q_matrix)| {
                // Generate variant-specific channel labels
                let channel_labels = if variant_id == "CD" && request.cd_channel_pairs.is_some() {
                    // For CD, generate directed pair labels like "LAT2 → LPT1"
                    let pairs = request.cd_channel_pairs.as_ref().unwrap();
                    Some(
                        pairs
                            .iter()
                            .map(|pair| {
                                if let Some(names) = edf_channel_names {
                                    let from_name =
                                        names.get(pair[0]).map(|s| s.as_str()).unwrap_or("?");
                                    let to_name =
                                        names.get(pair[1]).map(|s| s.as_str()).unwrap_or("?");
                                    format!("{} → {}", from_name, to_name)
                                } else {
                                    format!("Ch{} → Ch{}", pair[0] + 1, pair[1] + 1)
                                }
                            })
                            .collect(),
                    )
                } else if variant_id == "CT" && request.ct_channel_pairs.is_some() {
                    // For CT, generate pair labels like "LAT2 ⟷ LPT1"
                    let pairs = request.ct_channel_pairs.as_ref().unwrap();
                    Some(
                        pairs
                            .iter()
                            .map(|pair| {
                                if let Some(names) = edf_channel_names {
                                    let ch1_name =
                                        names.get(pair[0]).map(|s| s.as_str()).unwrap_or("?");
                                    let ch2_name =
                                        names.get(pair[1]).map(|s| s.as_str()).unwrap_or("?");
                                    format!("{} ⟷ {}", ch1_name, ch2_name)
                                } else {
                                    format!("Ch{} ⟷ Ch{}", pair[0] + 1, pair[1] + 1)
                                }
                            })
                            .collect(),
                    )
                } else if let Some(names) = edf_channel_names {
                    // For ST/DE/SY, use EDF channel names
                    let channel_indices = request.channels.as_ref();
                    if let Some(indices) = channel_indices {
                        let mut labels: Vec<String> = indices
                            .iter()
                            .filter_map(|&idx| names.get(idx).cloned())
                            .collect();

                        // CRITICAL FIX: Truncate labels to match q_matrix row count
                        // DE and SY variants may output fewer channels than input channels
                        let num_channels = q_matrix.len();
                        if labels.len() > num_channels {
                            log::warn!(
                                "Variant {} has {} channel labels but only {} data rows. Truncating labels to match data.",
                                variant_id, labels.len(), num_channels
                            );
                            labels.truncate(num_channels);
                        }

                        Some(labels)
                    } else {
                        let mut labels = names.to_vec();
                        let num_channels = q_matrix.len();
                        if labels.len() > num_channels {
                            labels.truncate(num_channels);
                        }
                        Some(labels)
                    }
                } else {
                    // Fallback to None, will use default labels
                    None
                };

                crate::types::VariantResult {
                    variant_id: variant_id.clone(),
                    variant_name: variant_display_names(variant_id),
                    q_matrix: q_matrix.clone(),
                    channel_labels,
                }
            })
            .collect();

        // Build result with primary variant and all variant results
        let result = DDAResult::new(
            analysis_id,
            request.file_path.clone(),
            channels,
            primary_q_matrix.clone(),
            request.window_parameters.clone(),
            request.delay_parameters.clone(),
        )
        .with_variant_results(variant_results);

        Ok(result)
    }

    /// Run DDA analysis for a single variant with specific channels
    ///
    /// This is a more focused version of `run()` that executes only one variant
    /// with its own channel configuration. Used when variant_configs are provided.
    ///
    /// # Arguments
    /// * `request` - Base DDA analysis configuration
    /// * `variant_id` - Variant to run ("ST", "CT", "CD", "DE", "SY")
    /// * `channels` - Channel indices specific to this variant (0-based)
    /// * `ct_pairs` - CT channel pairs (only for CT variant)
    /// * `cd_pairs` - CD directed pairs (only for CD variant)
    /// * `start_bound` - Optional starting sample index
    /// * `end_bound` - Optional ending sample index
    /// * `edf_channel_names` - Optional list of EDF channel names for labeling
    ///
    /// # Returns
    /// VariantResult for the requested variant
    pub async fn run_single_variant(
        &self,
        request: &DDARequest,
        variant_id: &str,
        channels: &[usize],
        ct_pairs: Option<&[[usize; 2]]>,
        cd_pairs: Option<&[[usize; 2]]>,
        start_bound: Option<u64>,
        end_bound: Option<u64>,
        edf_channel_names: Option<&[String]>,
    ) -> Result<crate::types::VariantResult> {
        let analysis_id = Uuid::new_v4().to_string();

        // Validate input file exists
        let file_path = PathBuf::from(&request.file_path);
        if !file_path.exists() {
            return Err(DDAError::FileNotFound(request.file_path.clone()));
        }

        log::info!(
            "Running single variant {} with {} channels",
            variant_id,
            channels.len()
        );

        // Create temporary output file
        let temp_dir = std::env::temp_dir();
        let output_file = temp_dir.join(format!("dda_output_{}_{}.txt", analysis_id, variant_id));

        // Convert channel indices to 1-based
        let channel_indices: Vec<String> =
            channels.iter().map(|&idx| (idx + 1).to_string()).collect();

        // Determine file type
        let is_ascii_file = file_path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("ascii") || ext.eq_ignore_ascii_case("txt"))
            .unwrap_or(false);

        let file_type_flag = if is_ascii_file { "-ASCII" } else { "-EDF" };

        // Handle ASCII files (strip header)
        let actual_input_file = if is_ascii_file {
            let temp_ascii_file =
                temp_dir.join(format!("dda_input_{}_{}.ascii", analysis_id, variant_id));
            let content = tokio::fs::read_to_string(&file_path)
                .await
                .map_err(|e| DDAError::IoError(e))?;
            let lines: Vec<&str> = content.lines().collect();
            if lines.is_empty() {
                return Err(DDAError::ParseError("ASCII file is empty".to_string()));
            }
            let has_header = lines[0].chars().any(|c| c.is_alphabetic());
            let data_lines = if has_header { &lines[1..] } else { &lines[..] };
            tokio::fs::write(&temp_ascii_file, data_lines.join("\n"))
                .await
                .map_err(|e| DDAError::IoError(e))?;
            temp_ascii_file
        } else {
            file_path.clone()
        };

        // Build command
        let mut command = if cfg!(target_os = "windows") {
            Command::new(&self.binary_path)
        } else {
            let mut cmd = Command::new("sh");
            cmd.arg(&self.binary_path);
            cmd
        };

        command
            .arg("-DATA_FN")
            .arg(&actual_input_file)
            .arg("-OUT_FN")
            .arg(output_file.to_str().unwrap())
            .arg(file_type_flag)
            .arg("-CH_list");

        // Add channels based on variant type
        match variant_id {
            "CT" => {
                // CT: use first pair (will run multiple times for multiple pairs)
                if let Some(pairs) = ct_pairs {
                    if !pairs.is_empty() {
                        command.arg((pairs[0][0] + 1).to_string());
                        command.arg((pairs[0][1] + 1).to_string());
                    }
                }
            }
            "CD" => {
                // CD: flat list of directed pairs
                if let Some(pairs) = cd_pairs {
                    for pair in pairs {
                        command.arg((pair[0] + 1).to_string());
                        command.arg((pair[1] + 1).to_string());
                    }
                }
            }
            _ => {
                // ST, DE, SY: individual channels
                for ch in &channel_indices {
                    command.arg(ch);
                }
            }
        }

        // Model parameters
        let model_params = request.model_parameters.as_ref();
        let dm = model_params.map(|m| m.dm).unwrap_or(4);
        let order = model_params.map(|m| m.order).unwrap_or(4);
        let nr_tau = model_params.map(|m| m.nr_tau).unwrap_or(2);

        command
            .arg("-dm")
            .arg(dm.to_string())
            .arg("-order")
            .arg(order.to_string())
            .arg("-nr_tau")
            .arg(nr_tau.to_string())
            .arg("-WL")
            .arg(request.window_parameters.window_length.to_string())
            .arg("-WS")
            .arg(request.window_parameters.window_step.to_string());

        // SELECT mask for single variant
        let select_mask = match variant_id {
            "ST" => "1 0 0 0 0 0",
            "CT" => "0 1 0 0 0 0",
            "CD" => "0 0 1 0 0 0",
            "DE" => "0 0 0 0 1 0",
            "SY" => "0 0 0 0 0 1",
            _ => {
                return Err(DDAError::ExecutionFailed(format!(
                    "Unknown variant: {}",
                    variant_id
                )))
            }
        };

        command.arg("-SELECT");
        for bit in select_mask.split_whitespace() {
            command.arg(bit);
        }

        command.arg("-MODEL").arg("1").arg("2").arg("10");

        // CT/CD window parameters
        if matches!(variant_id, "CT" | "CD" | "DE") {
            let ct_wl = request.window_parameters.ct_window_length.unwrap_or(2);
            let ct_ws = request.window_parameters.ct_window_step.unwrap_or(2);
            command.arg("-WL_CT").arg(ct_wl.to_string());
            command.arg("-WS_CT").arg(ct_ws.to_string());
        }

        // Delay values directly from delay_parameters
        command.arg("-TAU");
        for delay in &request.delay_parameters.delays {
            command.arg(delay.to_string());
        }

        // Time bounds
        if let (Some(start), Some(end)) = (start_bound, end_bound) {
            command
                .arg("-StartEnd")
                .arg(start.to_string())
                .arg(end.to_string());
        }

        // Add sampling rate range if > 1000 Hz
        if let Some(sr) = request.sampling_rate {
            if sr > 1000.0 {
                let sr_half = (sr / 2.0) as u32;
                let sr_full = sr as u32;
                command
                    .arg("-SR")
                    .arg(sr_half.to_string())
                    .arg(sr_full.to_string());
            }
        }

        log::info!("Executing single variant command: {:?}", command);

        // Execute
        let output = command
            .output()
            .await
            .map_err(|e| DDAError::ExecutionFailed(format!("Failed to execute: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("DDA binary failed for {}: {}", variant_id, stderr);
            return Err(DDAError::ExecutionFailed(format!(
                "Binary failed: {}",
                stderr
            )));
        }

        // Determine output file suffix
        let suffix = match variant_id {
            "ST" => "_ST",
            "CT" => "_CT",
            "CD" => "_CD_DDA_ST",
            "DE" => "_DE",
            "SY" => "_SY",
            _ => {
                return Err(DDAError::ExecutionFailed(format!(
                    "Unknown variant: {}",
                    variant_id
                )))
            }
        };

        let variant_output_file =
            PathBuf::from(format!("{}{}", output_file.to_str().unwrap(), suffix));

        // For DE and SY with single channels, the binary might produce _ST files instead
        let actual_output_file =
            if !variant_output_file.exists() && matches!(variant_id, "DE" | "SY") {
                let fallback_file = PathBuf::from(format!("{}_ST", output_file.to_str().unwrap()));
                if fallback_file.exists() {
                    log::info!("Using fallback _ST file for {} variant", variant_id);
                    fallback_file
                } else {
                    return Err(DDAError::ExecutionFailed(format!(
                        "Output file not found for {}: {:?} (also tried {:?})",
                        variant_id, variant_output_file, fallback_file
                    )));
                }
            } else if !variant_output_file.exists() {
                return Err(DDAError::ExecutionFailed(format!(
                    "Output file not found for {}: {:?}",
                    variant_id, variant_output_file
                )));
            } else {
                variant_output_file
            };

        // Parse output
        let output_content = tokio::fs::read_to_string(&actual_output_file)
            .await
            .map_err(|e| DDAError::IoError(e))?;

        let stride = match variant_id {
            "CD" => Some(2),
            "DE" => Some(1),
            "SY" => Some(1),
            _ => None,
        };
        let q_matrix = parse_dda_output(&output_content, stride)?;

        // Generate channel labels
        let channel_labels = match variant_id {
            "CD" => {
                if let Some(pairs) = cd_pairs {
                    Some(
                        pairs
                            .iter()
                            .map(|pair| {
                                if let Some(names) = edf_channel_names {
                                    let from_name =
                                        names.get(pair[0]).map(|s| s.as_str()).unwrap_or("?");
                                    let to_name =
                                        names.get(pair[1]).map(|s| s.as_str()).unwrap_or("?");
                                    format!("{} → {}", from_name, to_name)
                                } else {
                                    format!("Ch{} → Ch{}", pair[0] + 1, pair[1] + 1)
                                }
                            })
                            .collect(),
                    )
                } else {
                    None
                }
            }
            "CT" => {
                if let Some(pairs) = ct_pairs {
                    Some(
                        pairs
                            .iter()
                            .map(|pair| {
                                if let Some(names) = edf_channel_names {
                                    let ch1 = names.get(pair[0]).map(|s| s.as_str()).unwrap_or("?");
                                    let ch2 = names.get(pair[1]).map(|s| s.as_str()).unwrap_or("?");
                                    format!("{} ⟷ {}", ch1, ch2)
                                } else {
                                    format!("Ch{} ⟷ Ch{}", pair[0] + 1, pair[1] + 1)
                                }
                            })
                            .collect(),
                    )
                } else {
                    None
                }
            }
            _ => {
                if let Some(names) = edf_channel_names {
                    let mut labels: Vec<String> = channels
                        .iter()
                        .filter_map(|&idx| names.get(idx).cloned())
                        .collect();
                    // Truncate to match matrix size
                    if labels.len() > q_matrix.len() {
                        labels.truncate(q_matrix.len());
                    }
                    Some(labels)
                } else {
                    None
                }
            }
        };

        // Cleanup
        let _ = tokio::fs::remove_file(&actual_output_file).await;
        let _ = tokio::fs::remove_file(&output_file).await;
        if is_ascii_file && actual_input_file != file_path {
            let _ = tokio::fs::remove_file(&actual_input_file).await;
        }

        let variant_name = match variant_id {
            "ST" => "Single Timeseries (ST)".to_string(),
            "CT" => "Cross-Timeseries (CT)".to_string(),
            "CD" => "Cross-Dynamical (CD)".to_string(),
            "DE" => "Dynamical Ergodicity (DE)".to_string(),
            "SY" => "Synchronization (SY)".to_string(),
            _ => variant_id.to_string(),
        };

        Ok(crate::types::VariantResult {
            variant_id: variant_id.to_string(),
            variant_name,
            q_matrix,
            channel_labels,
        })
    }

    /// Get the path to the DDA binary
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
}
