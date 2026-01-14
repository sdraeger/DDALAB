use crate::api::crypto::EncryptionKey;
use crate::api::encryption_middleware::EncryptionState;
use crate::api::router::create_router_with_encryption;
use crate::api::{generate_session_token, ApiState};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::task::JoinHandle;

/// Result from starting the API server
#[derive(Debug)]
pub struct ApiServerResult {
    pub session_token: String,
    pub port: u16,
    pub handle: JoinHandle<()>,
    pub encryption_key: Option<Vec<u8>>,
    pub using_encryption: bool,
}

/// Configuration for the API server
#[derive(Debug, Clone)]
pub struct ApiServerConfig {
    pub port: u16,
    pub bind_address: String, // "127.0.0.1" for localhost, "0.0.0.0" for LAN
    pub use_https: bool,
    pub require_auth: bool,
    pub hostname: Option<String>, // For LAN cert generation
}

impl Default for ApiServerConfig {
    fn default() -> Self {
        Self {
            port: 8765,
            bind_address: "127.0.0.1".to_string(),
            use_https: true, // HTTPS by default for security (users can disable if needed)
            require_auth: true,
            hostname: None,
        }
    }
}

/// Start the API server with HTTPS support and HTTP+encryption fallback
pub async fn start_api_server(
    config: ApiServerConfig,
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
) -> anyhow::Result<ApiServerResult> {
    log::info!("Initializing API server...");
    log::info!("Data directory: {:?}", data_directory);
    log::info!("Port: {}", config.port);
    log::info!("HTTPS: {}", config.use_https);
    log::info!("Auth required: {}", config.require_auth);
    log::info!("Bind address: {}", config.bind_address);

    if let Some(ref path) = dda_binary_path {
        log::info!("DDA binary path: {:?}", path);
    }

    // Find available port
    let port_to_use = find_available_port(&config).await?;

    // Generate session token
    let session_token = generate_session_token();
    log::info!("Generated session token");

    let bind_addr = format!("{}:{}", config.bind_address, port_to_use);

    // Try HTTPS first if configured
    if config.use_https {
        match try_start_https_server(
            &config,
            &data_directory,
            &dda_binary_path,
            &session_token,
            &bind_addr,
            port_to_use,
        )
        .await
        {
            Ok(result) => return Ok(result),
            Err(e) => {
                log::warn!("HTTPS failed: {}. Falling back to HTTP with encryption.", e);
            }
        }
    }

    // Fallback to HTTP with encryption
    start_http_with_encryption(
        &config,
        data_directory,
        dda_binary_path,
        session_token,
        bind_addr,
        port_to_use,
    )
    .await
}

/// Find an available port, trying up to 3 consecutive ports
async fn find_available_port(config: &ApiServerConfig) -> anyhow::Result<u16> {
    let mut port_to_use = config.port;
    let mut attempts = 0;

    loop {
        let test_addr = format!("{}:{}", config.bind_address, port_to_use);
        match tokio::net::TcpListener::bind(&test_addr).await {
            Ok(listener) => {
                log::info!("Port {} is available", port_to_use);
                drop(listener);
                return Ok(port_to_use);
            }
            Err(e) => {
                log::warn!("Port {} is not available: {}", port_to_use, e);
                attempts += 1;
                if attempts >= 3 {
                    return Err(anyhow::anyhow!(
                        "No available ports found after trying {}, {}, and {}",
                        config.port,
                        config.port + 1,
                        config.port + 2
                    ));
                }
                port_to_use += 1;
            }
        }
    }
}

/// Create API state with common configuration
fn create_api_state(
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
    session_token: &str,
    require_auth: bool,
) -> Arc<ApiState> {
    log::info!("Creating API state and router...");
    let mut api_state = ApiState::new(data_directory);
    if let Some(binary_path) = dda_binary_path {
        api_state.set_dda_binary_path(binary_path);
    }
    api_state.set_session_token(session_token.to_string());
    api_state.set_require_auth(require_auth);

    // Initialize overview cache on startup
    api_state.initialize_overview_cache();

    Arc::new(api_state)
}

/// Try to start the HTTPS server with TLS certificates
async fn try_start_https_server(
    config: &ApiServerConfig,
    data_directory: &PathBuf,
    dda_binary_path: &Option<PathBuf>,
    session_token: &str,
    bind_addr: &str,
    port: u16,
) -> anyhow::Result<ApiServerResult> {
    use crate::utils::certs::{
        check_certificates, generate_lan_certs, generate_localhost_certs, get_certs_dir,
        load_tls_config,
    };

    let cert_dir = get_certs_dir()?;
    let cert_path = cert_dir.join("server.crt");
    let key_path = cert_dir.join("server.key");

    // Generate certificates if needed
    if !check_certificates(&cert_dir).unwrap_or(false) {
        log::info!("Certificates not found, generating new ones...");

        if config.bind_address == "0.0.0.0" {
            // LAN mode - include hostname/IP in certificate
            let hostname = config.hostname.as_deref().unwrap_or("localhost");
            let local_ip = local_ip_address::local_ip()
                .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)))
                .to_string();
            generate_lan_certs(&cert_dir, hostname, &local_ip).await?;
        } else {
            // Localhost only
            generate_localhost_certs(&cert_dir).await?;
        }
    }

    // Load TLS configuration
    let tls_config = load_tls_config(&cert_path, &key_path).await?;

    // Create state and router (no encryption middleware needed for HTTPS)
    let state = create_api_state(
        data_directory.clone(),
        dda_binary_path.clone(),
        session_token,
        config.require_auth,
    );
    let encryption_state = Arc::new(EncryptionState::default());
    let app = create_router_with_encryption(state, encryption_state);
    log::info!("Router created successfully");

    log::info!("Starting HTTPS server on https://{}", bind_addr);
    log::info!("Health endpoint: https://{}/api/health", bind_addr);
    log::info!(
        "Session token (first 8 chars): {}...",
        &session_token[..8.min(session_token.len())]
    );

    let token_to_return = session_token.to_string();
    let bind_addr_owned = bind_addr.to_string();

    // Start HTTPS server in background
    let server_handle = tokio::spawn(async move {
        let result = axum_server::bind_rustls(
            bind_addr_owned.parse().expect("Invalid bind address"),
            tls_config,
        )
        .serve(app.into_make_service())
        .await;

        if let Err(e) = result {
            log::error!("HTTPS server error: {}", e);
        }
        log::info!("HTTPS server stopped");
    });

    // Give the server a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    log::info!("HTTPS server started on port {}", port);

    Ok(ApiServerResult {
        session_token: token_to_return,
        port,
        handle: server_handle,
        encryption_key: None,
        using_encryption: false,
    })
}

/// Start HTTP server with application-layer AES-256-GCM encryption
async fn start_http_with_encryption(
    config: &ApiServerConfig,
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
    session_token: String,
    bind_addr: String,
    port: u16,
) -> anyhow::Result<ApiServerResult> {
    let encryption_key = EncryptionKey::random();
    let key_bytes = encryption_key.as_bytes().to_vec();

    log::warn!("Starting HTTP server with application-layer encryption");
    log::warn!("Install mkcert for native HTTPS: brew install mkcert (macOS) or choco install mkcert (Windows)");

    // Create state and router with encryption middleware
    let state = create_api_state(
        data_directory,
        dda_binary_path,
        &session_token,
        config.require_auth,
    );
    let encryption_state = Arc::new(EncryptionState::new(encryption_key));
    let app = create_router_with_encryption(state, encryption_state);
    log::info!("Router created successfully with encryption middleware");

    log::info!("Server listening on http://{}", bind_addr);
    log::info!("Health endpoint: http://{}/api/health", bind_addr);
    log::info!(
        "Session token (first 8 chars): {}...",
        &session_token[..8.min(session_token.len())]
    );

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;

    let server_handle = tokio::spawn(async move {
        let result = axum::serve(listener, app).await;

        if let Err(e) = result {
            log::error!("HTTP server error: {}", e);
        }
        log::info!("HTTP server stopped");
    });

    // Give the server a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    log::info!(
        "HTTP server started on port {} with encryption enabled",
        port
    );

    Ok(ApiServerResult {
        session_token,
        port,
        handle: server_handle,
        encryption_key: Some(key_bytes),
        using_encryption: true,
    })
}
