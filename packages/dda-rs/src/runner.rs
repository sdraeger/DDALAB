use std::path::{Path, PathBuf};
use tokio::process::Command;
use uuid::Uuid;
use crate::error::{DDAError, Result};
use crate::types::*;
use crate::parser::parse_dda_output;

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
    ///
    /// # Returns
    /// DDAResult containing the processed Q matrix and metadata
    pub async fn run(&self, request: &DDARequest, start_bound: u64, end_bound: u64) -> Result<DDAResult> {
        let analysis_id = Uuid::new_v4().to_string();

        // Validate input file exists
        let file_path = PathBuf::from(&request.file_path);
        if !file_path.exists() {
            return Err(DDAError::FileNotFound(request.file_path.clone()));
        }

        log::info!("Starting DDA analysis for file: {}", request.file_path);
        log::info!("Channel indices: {:?}", request.channels);
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
            vec!["1".to_string()]  // Default to first channel
        };

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

        // Add DDA parameters
        command
            .arg("-DATA_FN").arg(&request.file_path)
            .arg("-OUT_FN").arg(output_file.to_str().unwrap())
            .arg("-EDF")
            .arg("-CH_list");

        // Add channel indices as separate arguments (not comma-separated)
        for ch in &channel_indices {
            command.arg(ch);
        }

        // Add base parameters (matching dda-py BASE_PARAMS)
        command
            .arg("-dm").arg("4")
            .arg("-order").arg("4")
            .arg("-nr_tau").arg("2")
            .arg("-WL").arg(request.window_parameters.window_length.to_string())
            .arg("-WS").arg(request.window_parameters.window_step.to_string());

        // Add SELECT mask (defaults to "1 0 0 0" if not specified)
        let select_mask = request.algorithm_selection.select_mask
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("1 0 0 0");

        command.arg("-SELECT");
        for bit in select_mask.split_whitespace() {
            command.arg(bit);
        }

        command.arg("-MODEL").arg("1").arg("2").arg("10");

        // Add CT-specific parameters if provided
        if let Some(ct_wl) = request.window_parameters.ct_window_length {
            command.arg("-WL_CT").arg(ct_wl.to_string());
        }
        if let Some(ct_ws) = request.window_parameters.ct_window_step {
            command.arg("-WS_CT").arg(ct_ws.to_string());
        }

        // Add CT channel pairs if provided
        if let Some(ref pairs) = request.ct_channel_pairs {
            if !pairs.is_empty() {
                command.arg("-CH_list");
                for pair in pairs {
                    // Convert to 1-based indices for the binary
                    command.arg((pair[0] + 1).to_string());
                    command.arg((pair[1] + 1).to_string());
                }
                log::info!("CT channel pairs (1-based): {:?}", pairs.iter()
                    .map(|p| [p[0] + 1, p[1] + 1])
                    .collect::<Vec<_>>());
            }
        }

        // Generate delay values from scale parameters
        let delay_min = request.scale_parameters.scale_min as i32;
        let delay_max = request.scale_parameters.scale_max as i32;
        command.arg("-TAU");
        for delay in delay_min..=delay_max {
            command.arg(delay.to_string());
        }

        // Add time bounds (sample indices)
        command.arg("-StartEnd").arg(start_bound.to_string()).arg(end_bound.to_string());

        log::info!("Executing DDA command: {:?}", command);

        // Execute DDA binary asynchronously
        let start_time = std::time::Instant::now();
        let output = command.output().await
            .map_err(|e| DDAError::ExecutionFailed(format!("Failed to execute binary: {}", e)))?;

        log::info!("DDA binary execution completed in {:.2}s", start_time.elapsed().as_secs_f64());

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

        // Determine which variants are enabled from SELECT mask
        let select_bits: Vec<&str> = select_mask.split_whitespace().collect();
        let variant_names = ["ST", "CT", "CD", "DE"];
        let enabled_variants: Vec<&str> = variant_names.iter()
            .zip(select_bits.iter())
            .filter_map(|(variant, &bit)| if bit == "1" { Some(*variant) } else { None })
            .collect();

        if enabled_variants.is_empty() {
            return Err(DDAError::ExecutionFailed("No variants enabled in SELECT mask".to_string()));
        }

        log::info!("Enabled variants: {:?}", enabled_variants);

        // DDA binary creates output files with variant suffixes (_ST, _CT, _CD, _DE)
        let output_file_stem = output_file.file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output file path".to_string()))?;
        let output_dir = output_file.parent()
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output directory".to_string()))?;

        // Read all enabled variants
        let mut variant_matrices: Vec<(String, Vec<Vec<f64>>)> = Vec::new();

        for variant in &enabled_variants {
            let variant_file_path = output_dir.join(format!("{}_{}", output_file_stem, variant));
            let variant_file_with_ext = output_file.to_str()
                .map(|s| PathBuf::from(format!("{}_{}", s, variant)))
                .ok_or_else(|| DDAError::ExecutionFailed("Invalid output path".to_string()))?;

            let actual_output_file = if variant_file_path.exists() {
                variant_file_path.clone()
            } else if variant_file_with_ext.exists() {
                variant_file_with_ext.clone()
            } else {
                log::warn!("Output file not found for variant {}. Tried: {:?}, {:?}", variant, variant_file_path, variant_file_with_ext);
                continue; // Skip missing variants
            };

            log::info!("Reading DDA output for variant {} from: {:?}", variant, actual_output_file);

            // Read and parse DDA output
            let output_content = tokio::fs::read_to_string(&actual_output_file).await
                .map_err(|e| DDAError::IoError(e))?;

            log::info!("Output file size for {}: {} bytes", variant, output_content.len());

            // Parse the output file to extract Q matrix [channels × timepoints]
            let q_matrix = parse_dda_output(&output_content)?;

            if !q_matrix.is_empty() {
                let num_channels = q_matrix.len();
                let num_timepoints = q_matrix[0].len();
                log::info!("Q matrix dimensions for {}: {} channels × {} timepoints", variant, num_channels, num_timepoints);

                variant_matrices.push((variant.to_string(), q_matrix));
            } else {
                log::warn!("No data extracted from DDA output for variant {}", variant);
            }
        }

        // Clean up temporary files
        let _ = tokio::fs::remove_file(&output_file).await;
        for variant in &enabled_variants {
            let variant_path = output_dir.join(format!("{}_{}", output_file_stem, variant));
            let _ = tokio::fs::remove_file(&variant_path).await;
        }

        if variant_matrices.is_empty() {
            return Err(DDAError::ParseError("No data extracted from any DDA variant".to_string()));
        }

        // Use the first variant's matrix as the primary result (for backward compatibility)
        let (primary_variant_name, primary_q_matrix) = variant_matrices.first()
            .ok_or_else(|| DDAError::ExecutionFailed("No variant results available".to_string()))?;

        log::info!("Using {} as primary variant, {} total variants processed", primary_variant_name, variant_matrices.len());

        // Create channel labels
        let channels: Vec<String> = if let Some(ref channel_indices) = request.channels {
            channel_indices.iter()
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

        // Build variant results for all variants
        let variant_results: Vec<crate::types::VariantResult> = variant_matrices.iter()
            .map(|(variant_id, q_matrix)| crate::types::VariantResult {
                variant_id: variant_id.clone(),
                variant_name: variant_display_names(variant_id),
                q_matrix: q_matrix.clone(),
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
        ).with_variant_results(variant_results);

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
