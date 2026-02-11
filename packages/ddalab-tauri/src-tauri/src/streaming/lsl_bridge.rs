use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::{Child, Command};

const DEFAULT_PORT: u16 = 17424;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LslStreamInfo {
    pub name: String,
    pub stream_type: String,
    pub channel_count: i32,
    pub sample_rate: f64,
    pub source_id: String,
    pub hostname: String,
}
const HEALTH_POLL_INTERVAL_MS: u64 = 200;
const HEALTH_POLL_MAX_ATTEMPTS: u32 = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BridgeState {
    Stopped,
    Starting,
    Running { port: u16 },
    Error { message: String },
}

pub struct LslBridgeManager {
    process: Option<Child>,
    port: u16,
    state: BridgeState,
    script_path: Option<PathBuf>,
}

impl LslBridgeManager {
    pub fn new() -> Self {
        Self {
            process: None,
            port: DEFAULT_PORT,
            state: BridgeState::Stopped,
            script_path: None,
        }
    }

    pub fn set_script_path(&mut self, path: PathBuf) {
        self.script_path = Some(path);
    }

    fn resolve_script_path(&self) -> Result<PathBuf, String> {
        if let Some(ref path) = self.script_path {
            if path.exists() {
                return Ok(path.clone());
            }
        }

        let candidates = [
            PathBuf::from("resources/python/lsl_bridge.py"),
            PathBuf::from("../Resources/python/lsl_bridge.py"),
        ];

        for candidate in &candidates {
            if candidate.exists() {
                return Ok(candidate.clone());
            }
        }

        Err("LSL bridge script not found. Ensure resources/python/lsl_bridge.py exists.".into())
    }

    fn resolve_python() -> Result<String, String> {
        if which::which("python3").is_ok() {
            return Ok("python3".into());
        }
        if which::which("python").is_ok() {
            return Ok("python".into());
        }
        Err("Python not found on PATH. Install Python 3 with pylsl and websockets.".into())
    }

    /// Percent-encode a string for use in URL query parameters.
    fn encode_param(s: &str) -> String {
        let mut encoded = String::with_capacity(s.len());
        for byte in s.bytes() {
            match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    encoded.push(byte as char);
                }
                _ => {
                    encoded.push_str(&format!("%{:02X}", byte));
                }
            }
        }
        encoded
    }

    pub async fn start(&mut self) -> Result<BridgeState, String> {
        if matches!(self.state, BridgeState::Running { .. }) {
            return Ok(self.state.clone());
        }

        self.state = BridgeState::Starting;

        let python = Self::resolve_python()?;
        let script = self.resolve_script_path()?;

        log::info!(
            "Starting LSL bridge: {} {} --port {}",
            python,
            script.display(),
            self.port
        );

        let child = Command::new(&python)
            .arg(script.as_os_str())
            .arg("--port")
            .arg(self.port.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn LSL bridge: {}", e))?;

        self.process = Some(child);

        let url = format!("http://127.0.0.1:{}/health", self.port);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|e| format!("HTTP client error: {}", e))?;

        for attempt in 0..HEALTH_POLL_MAX_ATTEMPTS {
            tokio::time::sleep(tokio::time::Duration::from_millis(HEALTH_POLL_INTERVAL_MS)).await;

            if let Some(ref mut child) = self.process {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        let msg =
                            format!("LSL bridge exited during startup with status: {}", status);
                        log::error!("{}", msg);
                        self.process = None;
                        self.state = BridgeState::Error {
                            message: msg.clone(),
                        };
                        return Err(msg);
                    }
                    Err(e) => {
                        log::warn!("Error checking bridge process status: {}", e);
                    }
                    _ => {}
                }
            }

            match client.get(&url).send().await {
                Ok(resp) if resp.status().is_success() => {
                    log::info!("LSL bridge healthy after {} attempts", attempt + 1);
                    self.state = BridgeState::Running { port: self.port };
                    return Ok(self.state.clone());
                }
                _ => {
                    log::debug!("Health check attempt {} failed, retrying...", attempt + 1);
                }
            }
        }

        self.stop().await.ok();
        let msg = "LSL bridge failed to start: health check timed out. \
                   Ensure pylsl and websockets are installed (pip install pylsl websockets)."
            .to_string();
        self.state = BridgeState::Error {
            message: msg.clone(),
        };
        Err(msg)
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        if let Some(mut child) = self.process.take() {
            log::info!("Stopping LSL bridge");

            // Send SIGTERM on Unix for graceful shutdown
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }

            match tokio::time::timeout(tokio::time::Duration::from_secs(3), child.wait()).await {
                Ok(_) => {
                    log::info!("LSL bridge exited gracefully");
                }
                Err(_) => {
                    log::warn!("LSL bridge did not exit gracefully, killing");
                    child.kill().await.ok();
                }
            }
        }

        self.state = BridgeState::Stopped;
        Ok(())
    }

    pub async fn discover(&self, timeout: f64) -> Result<Vec<LslStreamInfo>, String> {
        let port = match &self.state {
            BridgeState::Running { port } => *port,
            _ => return Err("LSL bridge is not running".into()),
        };

        let url = format!("http://127.0.0.1:{}/discover?timeout={}", port, timeout);

        let resp = reqwest::get(&url)
            .await
            .map_err(|e| format!("Discovery request failed: {}", e))?;

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse discovery response: {}", e))
    }

    pub async fn discover_by_type(
        &self,
        stream_type: &str,
        timeout: f64,
    ) -> Result<Vec<LslStreamInfo>, String> {
        let port = match &self.state {
            BridgeState::Running { port } => *port,
            _ => return Err("LSL bridge is not running".into()),
        };

        let url = format!(
            "http://127.0.0.1:{}/discover?timeout={}&type={}",
            port, timeout, stream_type
        );

        let resp = reqwest::get(&url)
            .await
            .map_err(|e| format!("Discovery request failed: {}", e))?;

        resp.json()
            .await
            .map_err(|e| format!("Failed to parse discovery response: {}", e))
    }

    pub async fn health(&self) -> bool {
        let port = match &self.state {
            BridgeState::Running { port } => *port,
            _ => return false,
        };

        let url = format!("http://127.0.0.1:{}/health", port);
        matches!(reqwest::get(&url).await, Ok(resp) if resp.status().is_success())
    }

    pub fn get_stream_url(
        &self,
        name: &str,
        stream_type: &str,
        source_id: &str,
    ) -> Result<String, String> {
        let port = match &self.state {
            BridgeState::Running { port } => *port,
            _ => return Err("LSL bridge is not running".into()),
        };

        let mut params = Vec::new();
        if !name.is_empty() {
            params.push(format!("name={}", Self::encode_param(name)));
        }
        if !stream_type.is_empty() {
            params.push(format!("type={}", Self::encode_param(stream_type)));
        }
        if !source_id.is_empty() {
            params.push(format!("source_id={}", Self::encode_param(source_id)));
        }

        let query = params.join("&");
        Ok(format!("ws://127.0.0.1:{}/stream?{}", port, query))
    }

    pub fn state(&self) -> &BridgeState {
        &self.state
    }
}

impl Drop for LslBridgeManager {
    fn drop(&mut self) {
        if let Some(mut child) = self.process.take() {
            #[cfg(unix)]
            if let Some(pid) = child.id() {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
            // kill_on_drop(true) handles the final cleanup
            let _ = child.start_kill();
        }
    }
}
