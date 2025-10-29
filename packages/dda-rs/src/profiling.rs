use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::Instant;

/// Profiling/benchmarking infrastructure for performance measurement
pub struct ProfileScope {
    label: String,
    start: Instant,
}

impl ProfileScope {
    pub fn new(label: impl Into<String>) -> Self {
        Self {
            label: label.into(),
            start: Instant::now(),
        }
    }
}

impl Drop for ProfileScope {
    fn drop(&mut self) {
        let elapsed = self.start.elapsed();

        log::info!(
            "[PROFILE] {} - {:.3}ms",
            self.label,
            elapsed.as_secs_f64() * 1000.0
        );

        // Also write to file
        if let Err(e) = write_profile_log(&self.label, elapsed.as_secs_f64() * 1000.0) {
            log::warn!("Failed to write profile log: {}", e);
        }
    }
}

fn get_profile_log_path() -> PathBuf {
    let app_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("DDALAB");

    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("performance_profile.log")
}

fn write_profile_log(label: &str, duration_ms: f64) -> std::io::Result<()> {
    let log_path = get_profile_log_path();
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;

    let timestamp = chrono::Utc::now().to_rfc3339();
    writeln!(file, "{} | {} | {:.3}ms", timestamp, label, duration_ms)?;

    Ok(())
}

/// Macro for easy profiling
#[macro_export]
macro_rules! profile_scope {
    ($label:expr) => {
        let _profile_scope = $crate::profiling::ProfileScope::new($label);
    };
}

/// Helper to get profile log location for user
pub fn get_profile_log_location() -> String {
    get_profile_log_path()
        .to_str()
        .unwrap_or("Unknown")
        .to_string()
}
