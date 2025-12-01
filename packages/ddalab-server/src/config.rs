use std::env;
use std::path::PathBuf;

/// Server configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Port to listen on
    pub port: u16,
    /// Bind address (0.0.0.0 for LAN, 127.0.0.1 for localhost)
    pub bind_addr: String,
    /// PostgreSQL database URL
    pub database_url: String,
    /// Institution name for mDNS announcement
    pub institution_name: String,
    /// Pre-shared key password for broker authentication
    pub broker_password: String,
    /// Enable mDNS discovery announcement
    pub enable_mdns: bool,
    /// mDNS service name
    pub mdns_service_name: String,
    /// Path to DDA binary
    pub dda_binary_path: Option<PathBuf>,
    /// Directory for data storage
    pub data_directory: PathBuf,
    /// Enable server-side DDA analysis
    pub enable_server_side_analysis: bool,
    /// Require authentication for API access
    pub require_auth: bool,
    /// Enable application-layer encryption
    pub enable_encryption: bool,
    /// Session timeout in seconds
    pub session_timeout_seconds: u64,
    /// Heartbeat timeout in seconds (for stale connection cleanup)
    pub heartbeat_timeout_seconds: i64,
    /// Maximum concurrent DDA jobs
    pub max_concurrent_jobs: usize,
    /// Directory for job output files
    pub job_output_directory: PathBuf,
    /// Directory for uploaded files
    pub upload_directory: PathBuf,
    /// Maximum upload file size in bytes (default 500MB)
    pub max_upload_size: u64,
    /// Base directory for server-side files users can reference
    pub server_files_directory: Option<PathBuf>,
    /// CORS allowed origins (comma-separated in env var)
    pub cors_origins: Vec<String>,
}

impl ServerConfig {
    /// Load configuration from environment variables
    pub fn from_env() -> Result<Self, ConfigError> {
        dotenvy::dotenv().ok();

        // SECURITY: Require explicit password and database URL - no defaults
        let broker_password = env::var("BROKER_PASSWORD")
            .map_err(|_| ConfigError::MissingEnvVar("BROKER_PASSWORD".to_string()))?;

        if broker_password.len() < 8 {
            return Err(ConfigError::InvalidValue(
                "BROKER_PASSWORD must be at least 8 characters".to_string(),
            ));
        }

        let database_url = env::var("DATABASE_URL")
            .map_err(|_| ConfigError::MissingEnvVar("DATABASE_URL".to_string()))?;

        Ok(Self {
            port: env::var("DDALAB_PORT")
                .unwrap_or_else(|_| "8080".to_string())
                .parse()
                .map_err(|_| ConfigError::InvalidPort)?,
            bind_addr: env::var("DDALAB_BIND_ADDR")
                .unwrap_or_else(|_| "0.0.0.0".to_string()),
            database_url,
            institution_name: env::var("INSTITUTION_NAME")
                .unwrap_or_else(|_| "DDALAB Server".to_string()),
            broker_password,
            enable_mdns: env::var("ENABLE_MDNS")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(true),
            mdns_service_name: env::var("MDNS_SERVICE_NAME")
                .unwrap_or_else(|_| "_ddalab-server._tcp.local.".to_string()),
            dda_binary_path: env::var("DDA_BINARY_PATH")
                .ok()
                .map(PathBuf::from),
            data_directory: env::var("DATA_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/app/data")),
            enable_server_side_analysis: env::var("ENABLE_SERVER_SIDE_ANALYSIS")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(true),
            require_auth: env::var("REQUIRE_AUTH")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(true),
            enable_encryption: env::var("ENABLE_ENCRYPTION")
                .map(|v| v.to_lowercase() == "true")
                .unwrap_or(true),
            session_timeout_seconds: env::var("SESSION_TIMEOUT_SECONDS")
                .unwrap_or_else(|_| "3600".to_string())
                .parse()
                .unwrap_or(3600),
            heartbeat_timeout_seconds: env::var("HEARTBEAT_TIMEOUT_SECONDS")
                .unwrap_or_else(|_| "300".to_string())
                .parse()
                .unwrap_or(300),
            max_concurrent_jobs: env::var("MAX_CONCURRENT_JOBS")
                .unwrap_or_else(|_| "2".to_string())
                .parse()
                .unwrap_or(2),
            job_output_directory: env::var("JOB_OUTPUT_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/tmp/ddalab-jobs")),
            upload_directory: env::var("UPLOAD_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("/tmp/ddalab-uploads")),
            max_upload_size: env::var("MAX_UPLOAD_SIZE")
                .unwrap_or_else(|_| "524288000".to_string()) // 500MB default
                .parse()
                .unwrap_or(524288000),
            server_files_directory: env::var("SERVER_FILES_DIRECTORY")
                .ok()
                .map(PathBuf::from),
            cors_origins: env::var("CORS_ORIGINS")
                .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_else(|_| vec![
                    "http://localhost:3000".to_string(),
                    "http://localhost:3003".to_string(),
                    "http://127.0.0.1:3000".to_string(),
                    "http://127.0.0.1:3003".to_string(),
                    "tauri://localhost".to_string(),
                    "https://tauri.localhost".to_string(),
                ]),
        })
    }

    /// Get the full bind address (addr:port)
    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.bind_addr, self.port)
    }

    /// Check if the server is configured for LAN access
    pub fn is_lan_mode(&self) -> bool {
        self.bind_addr == "0.0.0.0"
    }
}

/// Configuration errors
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("Invalid port number")]
    InvalidPort,
    #[error("Missing required environment variable: {0}")]
    MissingEnvVar(String),
    #[error("Invalid configuration value: {0}")]
    InvalidValue(String),
}
