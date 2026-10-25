use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use std::time::Instant;

// shortcut: wasm32-unknown-unknown has no clock (elapsed() is always MAX, the engine never throttles progress by time and the host throttles by step count), add a host clock import when the browser needs timed progress or profiling
#[cfg(target_arch = "wasm32")]
pub(crate) use no_clock::Instant;

#[cfg(target_arch = "wasm32")]
mod no_clock {
    use std::time::Duration;

    #[derive(Clone, Copy)]
    pub struct Instant;

    impl Instant {
        pub fn now() -> Self {
            Self
        }
        pub fn elapsed(&self) -> Duration {
            Duration::MAX
        }
    }

    impl std::ops::Sub<Duration> for Instant {
        type Output = Self;
        fn sub(self, _: Duration) -> Self {
            self
        }
    }
}

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

    #[cfg(not(target_arch = "wasm32"))]
    let timestamp = chrono::Utc::now().to_rfc3339();
    #[cfg(target_arch = "wasm32")]
    let timestamp = String::new();
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
