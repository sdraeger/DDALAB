use std::path::{Path, PathBuf};
use tokio::process::Command;
use uuid::Uuid;
use crate::error::{DDAError, Result};
use crate::types::*;
use crate::parser::parse_dda_output;

/// DDA Binary Runner
///
/// Handles execution of the run_DDA_ASCII binary (APE/Cosmopolitan Libc format)
pub struct DDARunner {
    binary_path: PathBuf,
}

impl DDARunner {
    /// Create a new DDA runner with the specified binary path
    ///
    /// # Arguments
    /// * `binary_path` - Path to the run_DDA_ASCII binary
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
            .arg("-WS").arg(request.window_parameters.window_step.to_string())
            .arg("-SELECT").arg("1").arg("0").arg("0").arg("0")
            .arg("-MODEL").arg("1").arg("2").arg("10");

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

        // DDA binary creates output file with _ST suffix
        let output_file_stem = output_file.file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output file path".to_string()))?;
        let output_dir = output_file.parent()
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output directory".to_string()))?;

        let st_file_path = output_dir.join(format!("{}_ST", output_file_stem));
        let st_file_with_ext = output_file.to_str()
            .map(|s| PathBuf::from(format!("{}_ST", s)))
            .ok_or_else(|| DDAError::ExecutionFailed("Invalid output path".to_string()))?;

        let actual_output_file = if st_file_path.exists() {
            st_file_path
        } else if st_file_with_ext.exists() {
            st_file_with_ext
        } else {
            return Err(DDAError::ExecutionFailed(format!(
                "DDA output file not found. Tried: {:?}, {:?}",
                st_file_path, st_file_with_ext
            )));
        };

        log::info!("Reading DDA output from: {:?}", actual_output_file);

        // Read and parse DDA output
        let output_content = tokio::fs::read_to_string(&actual_output_file).await
            .map_err(|e| DDAError::IoError(e))?;

        log::info!("Output file size: {} bytes", output_content.len());

        // Parse the output file to extract Q matrix [channels × timepoints]
        let q_matrix = parse_dda_output(&output_content)?;

        // Clean up temporary files
        let _ = tokio::fs::remove_file(&output_file).await;
        let _ = tokio::fs::remove_file(&actual_output_file).await;

        if q_matrix.is_empty() {
            return Err(DDAError::ParseError("No data extracted from DDA output".to_string()));
        }

        let num_channels = q_matrix.len();
        let num_timepoints = q_matrix[0].len();

        log::info!("Q matrix dimensions: {} channels × {} timepoints", num_channels, num_timepoints);

        // Create channel labels
        let channels: Vec<String> = if let Some(ref channel_indices) = request.channels {
            channel_indices.iter()
                .map(|&idx| format!("Channel {}", idx + 1))
                .collect()
        } else {
            vec!["Channel 1".to_string()]
        };

        // Build result
        let result = DDAResult::new(
            analysis_id,
            request.file_path.clone(),
            channels,
            q_matrix,
            request.window_parameters.clone(),
            request.scale_parameters.clone(),
        );

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
