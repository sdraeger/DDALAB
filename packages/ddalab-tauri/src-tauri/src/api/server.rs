use std::sync::Arc;
use std::path::PathBuf;
use crate::api::{ApiState, generate_session_token, create_router};

/// Configuration for the API server
#[derive(Debug, Clone)]
pub struct ApiServerConfig {
    pub port: u16,
    pub bind_address: String,  // "127.0.0.1" for localhost, "0.0.0.0" for LAN
    pub use_https: bool,
    pub require_auth: bool,
    pub hostname: Option<String>,  // For LAN cert generation
}

impl Default for ApiServerConfig {
    fn default() -> Self {
        Self {
            port: 8765,
            bind_address: "127.0.0.1".to_string(),
            use_https: true,  // HTTPS enabled by default
            require_auth: true,
            hostname: None,
        }
    }
}

/// Start the API server with HTTPS support
pub async fn start_api_server(
    config: ApiServerConfig,
    data_directory: PathBuf,
    dda_binary_path: Option<PathBuf>,
) -> anyhow::Result<String> {  // Returns session token
    log::info!("🚀 Initializing API server...");
    log::info!("📁 Data directory: {:?}", data_directory);
    log::info!("🔌 Port: {}", config.port);
    log::info!("🔒 HTTPS: {}", config.use_https);
    log::info!("🔐 Auth required: {}", config.require_auth);
    log::info!("🌐 Bind address: {}", config.bind_address);

    if let Some(ref path) = dda_binary_path {
        log::info!("🔧 DDA binary path: {:?}", path);
    }

    // Find available port
    let mut port_to_use = config.port;
    let mut attempts = 0;
    let test_listener = loop {
        let test_addr = format!("{}:{}", config.bind_address, port_to_use);
        match tokio::net::TcpListener::bind(&test_addr).await {
            Ok(listener) => {
                log::info!("✅ Port {} is available", port_to_use);
                break listener;
            }
            Err(e) => {
                log::warn!("⚠️ Port {} is not available: {}", port_to_use, e);
                attempts += 1;
                if attempts >= 3 {
                    return Err(anyhow::anyhow!(
                        "No available ports found after trying {}, {}, and {}",
                        config.port, config.port + 1, config.port + 2
                    ));
                }
                port_to_use += 1;
            }
        }
    };
    drop(test_listener);

    // Generate session token
    let session_token = generate_session_token();
    log::info!("🔑 Generated session token");

    // Create API state
    log::info!("🏗️  Creating API state and router...");
    let mut api_state = ApiState::new(data_directory);
    if let Some(binary_path) = dda_binary_path {
        api_state.set_dda_binary_path(binary_path);
    }
    api_state.set_session_token(session_token.clone());
    api_state.set_require_auth(config.require_auth);

    let state = Arc::new(api_state);
    let app = create_router(state);
    log::info!("✅ Router created successfully");

    let bind_addr = format!("{}:{}", config.bind_address, port_to_use);

    if config.use_https {
        // Setup TLS
        use crate::utils::certs::{get_certs_dir, check_certificates, generate_localhost_certs, generate_lan_certs, load_tls_config};

        let cert_dir = get_certs_dir()?;
        let cert_path = cert_dir.join("server.crt");
        let key_path = cert_dir.join("server.key");

        // Generate certificates if needed
        if !check_certificates(&cert_dir).unwrap_or(false) {
            log::info!("🔐 Certificates not found, generating new ones...");

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

        log::info!("🌐 Starting HTTPS server on https://{}", bind_addr);
        log::info!("🎯 Health endpoint: https://{}/api/health", bind_addr);
        log::info!("🔑 Session token (first 8 chars): {}...", &session_token[..8.min(session_token.len())]);

        // Return session token BEFORE starting the server (which blocks)
        let token_to_return = session_token.clone();

        // Start HTTPS server in background
        tokio::spawn(async move {
            let result = axum_server::bind_rustls(bind_addr.parse().expect("Invalid bind address"), tls_config)
                .serve(app.into_make_service())
                .await;

            if let Err(e) = result {
                log::error!("❌ HTTPS server error: {}", e);
            }
            log::info!("🛑 HTTPS server stopped");
        });

        // Give the server a moment to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        Ok(token_to_return)
    } else {
        // HTTP mode (not recommended)
        log::warn!("⚠️ Starting HTTP server (INSECURE)");
        log::info!("🌐 Server listening on http://{}", bind_addr);
        log::info!("🎯 Health endpoint: http://{}/api/health", bind_addr);

        let token_to_return = session_token.clone();

        let listener = tokio::net::TcpListener::bind(&bind_addr).await?;

        tokio::spawn(async move {
            let result = axum::serve(listener, app).await;

            if let Err(e) = result {
                log::error!("❌ HTTP server error: {}", e);
            }
            log::info!("🛑 HTTP server stopped");
        });

        // Give the server a moment to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        Ok(token_to_return)
    }
}
