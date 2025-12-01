use super::types::DDAJob;
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::{debug, error, info};

/// Run DDA analysis for a job
///
/// The `progress_callback` is called with (progress_percent, message) and should return
/// `true` to continue or `false` to cancel.
pub async fn run_dda_analysis<F>(job: &DDAJob, mut progress_callback: F) -> Result<PathBuf>
where
    F: FnMut(u8, Option<String>) -> bool,
{
    // Get DDA binary path from environment or use default
    let dda_binary = std::env::var("DDA_BINARY_PATH")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("dda")); // Assume in PATH

    if !dda_binary.exists() && dda_binary.to_string_lossy() != "dda" {
        return Err(anyhow!("DDA binary not found at {:?}", dda_binary));
    }

    let input_path = job.input_path();
    if !input_path.exists() {
        return Err(anyhow!("Input file not found: {:?}", input_path));
    }

    // Create output directory
    let output_dir = std::env::var("DDA_OUTPUT_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp/ddalab-jobs"));

    tokio::fs::create_dir_all(&output_dir).await?;

    let output_path = output_dir.join(format!("{}.json", job.id));

    // Build DDA command
    let mut cmd = Command::new(&dda_binary);

    // Input file
    cmd.arg("-i").arg(input_path);

    // Output file
    cmd.arg("-o").arg(&output_path);

    // Channels
    if !job.parameters.channels.is_empty() {
        cmd.arg("-c").arg(job.parameters.channels.join(","));
    }

    // CT pairs
    for (c1, c2) in &job.parameters.ct_pairs {
        cmd.arg("--ct").arg(format!("{},{}", c1, c2));
    }

    // CD pairs
    for (c1, c2) in &job.parameters.cd_pairs {
        cmd.arg("--cd").arg(format!("{},{}", c1, c2));
    }

    // Parameters
    cmd.arg("-w").arg(job.parameters.time_window.to_string());
    cmd.arg("-d").arg(job.parameters.delta.to_string());
    cmd.arg("-m").arg(job.parameters.embedding_dim.to_string());
    cmd.arg("-s").arg(job.parameters.svd_dimensions.to_string());

    if job.parameters.downsample > 1 {
        cmd.arg("--downsample")
            .arg(job.parameters.downsample.to_string());
    }

    if let Some(start) = job.parameters.start_time {
        cmd.arg("--start").arg(start.to_string());
    }

    if let Some(end) = job.parameters.end_time {
        cmd.arg("--end").arg(end.to_string());
    }

    // Enable progress output
    cmd.arg("--progress");

    // Configure stdio
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    info!(
        "Starting DDA analysis for job {}: {:?}",
        job.id,
        cmd.as_std()
    );

    // Start process
    let mut child = cmd.spawn().map_err(|e| anyhow!("Failed to spawn DDA: {}", e))?;

    // Read progress from stderr (DDA typically outputs progress to stderr)
    let stderr = child.stderr.take().ok_or_else(|| anyhow!("No stderr"))?;
    let mut stderr_reader = BufReader::new(stderr).lines();

    // Process output lines for progress
    let mut last_progress: u8 = 0;
    while let Ok(Some(line)) = stderr_reader.next_line().await {
        debug!("DDA output: {}", line);

        // Parse progress from DDA output
        // Expecting format like: "Progress: 45%" or "[45%]" or "45/100"
        if let Some(progress) = parse_progress(&line) {
            last_progress = progress;
            if !progress_callback(progress, Some(line.clone())) {
                // Cancelled - kill process
                info!("Job {} cancelled, killing DDA process", job.id);
                let _ = child.kill().await;
                return Err(anyhow!("Job cancelled"));
            }
        } else if line.contains("Processing") || line.contains("Analyzing") {
            // Status messages
            if !progress_callback(last_progress, Some(line.clone())) {
                let _ = child.kill().await;
                return Err(anyhow!("Job cancelled"));
            }
        }
    }

    // Wait for process to complete
    let status = child.wait().await?;

    if !status.success() {
        let exit_code = status.code().unwrap_or(-1);
        return Err(anyhow!("DDA exited with code {}", exit_code));
    }

    // Verify output file exists
    if !output_path.exists() {
        return Err(anyhow!("DDA completed but output file not found"));
    }

    // Clean up input file if requested
    if job.delete_input_after {
        match &job.file_source {
            super::types::FileSource::UploadedTemp(p) => {
                if let Err(e) = tokio::fs::remove_file(p).await {
                    error!("Failed to delete temp file {:?}: {}", p, e);
                } else {
                    info!("Deleted temp input file for job {}", job.id);
                }
            }
            _ => {} // Don't delete server-side or persistent files
        }
    }

    info!("Job {} completed, results at {:?}", job.id, output_path);

    Ok(output_path)
}

/// Parse progress percentage from DDA output line
fn parse_progress(line: &str) -> Option<u8> {
    // Try various formats

    // Format: "Progress: 45%"
    if let Some(idx) = line.find("Progress:") {
        let rest = &line[idx + 9..];
        if let Some(pct_idx) = rest.find('%') {
            if let Ok(val) = rest[..pct_idx].trim().parse::<u8>() {
                return Some(val.min(100));
            }
        }
    }

    // Format: "[45%]" or "(45%)"
    if let Some(start) = line.find('[').or_else(|| line.find('(')) {
        let end_char = if line.chars().nth(start) == Some('[') {
            ']'
        } else {
            ')'
        };
        if let Some(end) = line[start..].find(end_char) {
            let inner = &line[start + 1..start + end];
            if let Some(pct_idx) = inner.find('%') {
                if let Ok(val) = inner[..pct_idx].trim().parse::<u8>() {
                    return Some(val.min(100));
                }
            }
        }
    }

    // Format: "45/100" or "45 / 100"
    if let Some(slash_idx) = line.find('/') {
        let before = line[..slash_idx].trim();
        let after = line[slash_idx + 1..].trim();

        // Get last number before slash
        let num_str: String = before.chars().rev().take_while(|c| c.is_ascii_digit()).collect();
        let num_str: String = num_str.chars().rev().collect();

        // Get first number after slash
        let denom_str: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();

        if let (Ok(num), Ok(denom)) = (num_str.parse::<u32>(), denom_str.parse::<u32>()) {
            if denom > 0 {
                return Some(((num as f64 / denom as f64) * 100.0).min(100.0) as u8);
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_progress() {
        assert_eq!(parse_progress("Progress: 45%"), Some(45));
        assert_eq!(parse_progress("Progress: 100%"), Some(100));
        assert_eq!(parse_progress("[45%]"), Some(45));
        assert_eq!(parse_progress("(45%)"), Some(45));
        assert_eq!(parse_progress("Processing 45/100 channels"), Some(45));
        assert_eq!(parse_progress("50 / 100"), Some(50));
        assert_eq!(parse_progress("No progress here"), None);
    }
}
