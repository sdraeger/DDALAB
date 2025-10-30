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
    /// * `start_bound` - Starting sample index for analysis (based on time_range.start)
    /// * `end_bound` - Maximum sample index for analysis (with safety margin)
    /// * `edf_channel_names` - Optional list of EDF channel names for labeling
    ///
    /// # Returns
    /// DDAResult containing the processed Q matrix and metadata
    pub async fn run(
        &self,
        request: &DDARequest,
        start_bound: u64,
        end_bound: u64,
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
        log::info!("Scale parameters: {:?}", request.scale_parameters);

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
            .unwrap_or("1 0 0 0");

        // Parse SELECT mask to check which variants are enabled
        let select_bits: Vec<&str> = select_mask.split_whitespace().collect();
        let st_enabled = select_bits.get(0).map(|&b| b == "1").unwrap_or(false);
        let ct_enabled = select_bits.get(1).map(|&b| b == "1").unwrap_or(false);
        let has_ct_pairs = ct_enabled
            && request
                .ct_channel_pairs
                .as_ref()
                .map(|p| !p.is_empty())
                .unwrap_or(false);

        // If both ST and CT are enabled with CT pairs, we need to run separate executions:
        // 1. First run: ST only (with all individual channels)
        // 2. Additional runs: CT only (one per pair)
        let run_st_separately = st_enabled && has_ct_pairs;

        // Determine SELECT mask for this first execution
        let first_select_mask = if run_st_separately {
            // First run will be ST-only, CT will be run separately
            let mut bits = select_bits.clone();
            if bits.len() > 1 {
                bits[1] = "0"; // Disable CT for first run
            }
            bits.join(" ")
        } else {
            select_mask.to_string()
        };

        log::info!("First execution SELECT mask: {}", first_select_mask);
        if run_st_separately {
            log::info!(
                "Will run CT separately for {} channel pairs",
                request.ct_channel_pairs.as_ref().unwrap().len()
            );
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

        // Add base parameters (matching dda-py BASE_PARAMS)
        command
            .arg("-dm")
            .arg("4")
            .arg("-order")
            .arg("4")
            .arg("-nr_tau")
            .arg("2")
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

        // Add CT-specific window parameters if provided
        if let Some(ct_wl) = request.window_parameters.ct_window_length {
            command.arg("-WL_CT").arg(ct_wl.to_string());
        }
        if let Some(ct_ws) = request.window_parameters.ct_window_step {
            command.arg("-WS_CT").arg(ct_ws.to_string());
        }

        // Generate delay values from scale parameters
        let delay_min = request.scale_parameters.scale_min as i32;
        let delay_max = request.scale_parameters.scale_max as i32;
        command.arg("-TAU");
        for delay in delay_min..=delay_max {
            command.arg(delay.to_string());
        }

        // Add time bounds (sample indices)
        command
            .arg("-StartEnd")
            .arg(start_bound.to_string())
            .arg(end_bound.to_string());

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
        let select_bits: Vec<&str> = select_mask.split_whitespace().collect();
        let variant_names = ["ST", "CT", "CD", "DE"];
        let enabled_variants: Vec<&str> = variant_names
            .iter()
            .zip(select_bits.iter())
            .filter_map(|(variant, &bit)| if bit == "1" { Some(*variant) } else { None })
            .collect();

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
            // First run only produced ST (CT was disabled)
            vec!["ST"]
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
            let variant_file_path = output_dir.join(format!("{}_{}", output_file_stem, variant));
            let variant_file_with_ext = output_file
                .to_str()
                .map(|s| PathBuf::from(format!("{}_{}", s, variant)))
                .ok_or_else(|| DDAError::ExecutionFailed("Invalid output path".to_string()))?;

            let actual_output_file = if variant_file_path.exists() {
                variant_file_path.clone()
            } else if variant_file_with_ext.exists() {
                variant_file_with_ext.clone()
            } else {
                log::warn!(
                    "Output file not found for variant {}. Tried: {:?}, {:?}",
                    variant,
                    variant_file_path,
                    variant_file_with_ext
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
            let q_matrix = parse_dda_output(&output_content)?;

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
                    .arg("4")
                    .arg("-order")
                    .arg("4")
                    .arg("-nr_tau")
                    .arg("2")
                    .arg("-WL")
                    .arg(request.window_parameters.window_length.to_string())
                    .arg("-WS")
                    .arg(request.window_parameters.window_step.to_string());

                // Add SELECT mask - CT only (0 1 0 0)
                pair_command
                    .arg("-SELECT")
                    .arg("0")
                    .arg("1")
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

                // Add delay values
                let delay_min = request.scale_parameters.scale_min as i32;
                let delay_max = request.scale_parameters.scale_max as i32;
                pair_command.arg("-TAU");
                for delay in delay_min..=delay_max {
                    pair_command.arg(delay.to_string());
                }

                // Add time bounds
                pair_command
                    .arg("-StartEnd")
                    .arg(start_bound.to_string())
                    .arg(end_bound.to_string());

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

                let pair_q_matrix = parse_dda_output(&pair_content)?;

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

        // Clean up temporary files
        let _ = tokio::fs::remove_file(&output_file).await;
        for variant in &enabled_variants {
            let variant_path = output_dir.join(format!("{}_{}", output_file_stem, variant));
            let _ = tokio::fs::remove_file(&variant_path).await;
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
                "CD" => "Cross-Delay (CD)".to_string(),
                "DE" => "Delay Evolution (DE)".to_string(),
                _ => id.to_string(),
            }
        };

        // Build variant results for all variants with appropriate channel labels
        let variant_results: Vec<crate::types::VariantResult> = variant_matrices
            .iter()
            .map(|(variant_id, q_matrix)| {
                // Generate variant-specific channel labels
                let channel_labels = if variant_id == "CT" && request.ct_channel_pairs.is_some() {
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
                    // For ST/CD/DE, use EDF channel names
                    let channel_indices = request.channels.as_ref();
                    if let Some(indices) = channel_indices {
                        Some(
                            indices
                                .iter()
                                .filter_map(|&idx| names.get(idx).cloned())
                                .collect(),
                        )
                    } else {
                        Some(names.to_vec())
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
            request.scale_parameters.clone(),
        )
        .with_variant_results(variant_results);

        Ok(result)
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
