use axum::{
    http::{header, HeaderValue, Method},
    middleware,
    routing::{delete, get, post},
    Router,
};
use clap::Parser;
use ddalab_server::{
    audit_middleware,
    auth::auth_middleware,
    cli::{Cli, Commands},
    config::ServerConfig,
    handlers::{
        add_team_member, cancel_job, create_share, create_team, debug_auth_hash, delete_team,
        download_job_results, get_job_status, get_queue_stats, get_share, get_team, health_check,
        job_progress_stream, key_exchange, list_institution_teams, list_jobs, list_my_teams,
        list_server_files, list_user_shares, login, logout, remove_team_member, revoke_share,
        server_info, submit_server_file_job, upload_and_submit_job, validate_session,
    },
    state::ServerState,
    storage::{AuditStore, PostgresAuditStore, PostgresShareStore, PostgresUserStore, UserStore},
    sync::{handle_websocket, hash_psk, BrokerDiscovery},
    AuditMiddlewareState,
};
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

const VERSION: &str = env!("CARGO_PKG_VERSION");

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ddalab_server=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Parse CLI arguments
    let cli = Cli::parse();

    // Load configuration
    let config = ServerConfig::from_env()?;

    // Connect to database
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    // Initialize storage layers
    let user_store = PostgresUserStore::new(pool.clone());
    user_store.initialize().await?;

    let audit_store = PostgresAuditStore::new(pool.clone());
    audit_store.initialize().await?;

    let share_store = PostgresShareStore::new(pool.clone());
    share_store.initialize().await?;

    // Handle CLI commands
    match cli.command {
        Some(Commands::User(cmd)) => {
            return cmd.execute(pool).await.map_err(|e| e.into());
        }
        Some(Commands::Audit { limit, user }) => {
            let entries = if let Some(email) = user {
                // Get user by email first
                let user = user_store.get_user_by_email(&email).await?;
                audit_store.for_user(user.id, limit).await?
            } else {
                audit_store.recent(limit).await?
            };

            println!(
                "{:<20} {:<30} {:<20} {:<15} {:<8}",
                "Timestamp", "User", "Action", "Resource", "Success"
            );
            println!("{}", "-".repeat(95));

            for entry in entries {
                println!(
                    "{:<20} {:<30} {:<20} {:<15} {:<8}",
                    entry.timestamp.format("%Y-%m-%d %H:%M:%S"),
                    entry.user_email.as_deref().unwrap_or("-"),
                    entry.action.as_str(),
                    entry
                        .resource_type
                        .as_ref()
                        .map(|t| format!(
                            "{}:{}",
                            t,
                            entry.resource_id.as_deref().unwrap_or("")
                        ))
                        .unwrap_or_else(|| "-".to_string()),
                    if entry.success { "Yes" } else { "No" }
                );
            }

            return Ok(());
        }
        Some(Commands::Serve) | None => {
            // Continue to run server
        }
    }

    // Server mode
    info!("🚀 Starting DDALAB Server v{}", VERSION);
    info!("📋 Configuration loaded:");
    info!("   Port: {}", config.port);
    info!("   Bind address: {}", config.bind_addr);
    info!("   Institution: {}", config.institution_name);
    info!("   Authentication required: {}", config.require_auth);
    info!("   Encryption enabled: {}", config.enable_encryption);
    info!("   mDNS discovery: {}", config.enable_mdns);
    info!("   Max concurrent jobs: {}", config.max_concurrent_jobs);
    info!("   Job output directory: {:?}", config.job_output_directory);
    info!("   Upload directory: {:?}", config.upload_directory);
    info!("✅ Database connected and schema initialized");

    // Create server state
    let state = Arc::new(ServerState::new(
        config.clone(),
        Arc::new(share_store),
        Arc::new(user_store),
        pool.clone(),
    ));

    // Create audit middleware state
    let audit_middleware_state = AuditMiddlewareState {
        audit_store: Arc::new(audit_store),
        session_manager: state.auth_state.session_manager.clone(),
    };

    // Spawn background task to cleanup stale connections
    {
        let registry = state.registry.clone();
        let heartbeat_timeout = config.heartbeat_timeout_seconds;
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let removed = registry.cleanup_stale(heartbeat_timeout);
                if removed > 0 {
                    info!("Cleaned up {} stale connections", removed);
                }
            }
        });
    }

    // Spawn background task to cleanup expired sessions
    {
        let session_manager = state.auth_state.session_manager.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(300)); // Every 5 minutes
            loop {
                interval.tick().await;
                let cleaned = session_manager.cleanup_expired();
                if cleaned > 0 {
                    info!("Cleaned up {} expired sessions", cleaned);
                }
            }
        });
    }

    // Spawn background task to cleanup rate limiter entries
    {
        let rate_limiter = state.auth_state.rate_limiter.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(120)); // Every 2 minutes
            loop {
                interval.tick().await;
                let cleaned = rate_limiter.cleanup();
                if cleaned > 0 {
                    info!("Cleaned up {} rate limiter entries", cleaned);
                }
            }
        });
    }

    // Create WebSocket sync state with authentication config
    let password_hash = hash_psk(&config.broker_password);
    let sync_state = ddalab_server::sync::websocket::SyncState {
        registry: state.registry.clone(),
        share_store: state.share_store.clone(),
        session_manager: state.auth_state.session_manager.clone(),
        institution: config.institution_name.clone(),
        server_version: VERSION.to_string(),
        password_hash: if config.require_auth {
            Some(password_hash.clone())
        } else {
            None
        },
        require_auth: config.require_auth,
    };

    // Build router
    let public_routes = Router::new()
        .route("/health", get(health_check))
        .route("/info", get(server_info))
        .route("/auth/login", post(login))
        .route("/auth/key-exchange", post(key_exchange));

    let protected_routes = Router::new()
        .route("/auth/logout", post(logout))
        .route("/auth/session", get(validate_session))
        .route("/debug/auth-hash", get(debug_auth_hash))
        .route("/api/shares", post(create_share))
        .route("/api/shares/{token}", get(get_share))
        .route("/api/shares/{token}", delete(revoke_share))
        .route("/api/shares/user/{user_id}", get(list_user_shares))
        // Team management routes
        .route("/api/teams", post(create_team))
        .route("/api/teams/me", get(list_my_teams))
        .route("/api/teams/{team_id}", get(get_team))
        .route("/api/teams/{team_id}", delete(delete_team))
        .route("/api/teams/{team_id}/members", post(add_team_member))
        .route(
            "/api/teams/{team_id}/members/{member_id}",
            delete(remove_team_member),
        )
        .route(
            "/api/teams/institution/{institution_id}",
            get(list_institution_teams),
        )
        // Job management routes
        .route("/api/jobs", get(list_jobs))
        .route("/api/jobs/submit", post(submit_server_file_job))
        // Note: /api/jobs/upload is in upload_routes with larger body limit
        .route("/api/jobs/stats", get(get_queue_stats))
        .route("/api/jobs/progress", get(job_progress_stream))
        .route("/api/jobs/{job_id}", get(get_job_status))
        .route("/api/jobs/{job_id}/cancel", post(cancel_job))
        .route("/api/jobs/{job_id}/download", get(download_job_results))
        .route("/api/files", get(list_server_files))
        .layer(middleware::from_fn_with_state(
            state.auth_state.clone(),
            auth_middleware,
        ));

    let ws_routes = Router::new()
        .route("/ws", get(handle_websocket))
        .with_state(sync_state);

    // CORS configuration - configurable via CORS_ORIGINS env var
    let cors_origins: Vec<HeaderValue> = config
        .cors_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();
    info!("   CORS origins: {:?}", config.cors_origins);
    let cors = CorsLayer::new()
        .allow_origin(cors_origins)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::ACCEPT])
        .allow_credentials(true);

    // SECURITY: Limit request body size to prevent DoS
    const MAX_API_BODY_SIZE: usize = 1024 * 1024; // 1MB for regular API requests
    let max_upload_size = config.max_upload_size as usize;

    // Create upload route with larger body limit (separate from other routes)
    let upload_routes = Router::new()
        .route("/api/jobs/upload", post(upload_and_submit_job))
        .layer(RequestBodyLimitLayer::new(max_upload_size))
        .layer(middleware::from_fn_with_state(
            state.auth_state.clone(),
            auth_middleware,
        ))
        .with_state(state.clone());

    let app = Router::new()
        .merge(public_routes)
        .merge(upload_routes) // Upload routes first with larger limit
        .merge(protected_routes)
        .merge(ws_routes)
        .layer(middleware::from_fn_with_state(
            audit_middleware_state,
            audit_middleware,
        ))
        .layer(RequestBodyLimitLayer::new(MAX_API_BODY_SIZE))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state.clone());

    // Start server
    let addr: SocketAddr = config.bind_address().parse()?;
    info!("🎧 Listening on http://{}", addr);
    info!("📡 WebSocket endpoint: ws://{}/ws", addr);
    info!("🔑 Health endpoint: http://{}/health", addr);

    // Initialize mDNS discovery
    let mut discovery: Option<BrokerDiscovery> = None;
    if config.enable_mdns {
        match BrokerDiscovery::new() {
            Ok(mut disc) => {
                // Reuse password_hash computed earlier
                match disc.announce(
                    config.port,
                    &config.institution_name,
                    &password_hash,
                    VERSION,
                ) {
                    Ok(_) => {
                        info!("🔍 mDNS discovery announcement started");
                        info!("   Institution: {}", config.institution_name);
                        info!("   Port: {}", config.port);
                        discovery = Some(disc);
                    }
                    Err(e) => {
                        warn!("Failed to start mDNS discovery: {}", e);
                        warn!("Server will continue without network discovery");
                    }
                }
            }
            Err(e) => {
                warn!("Failed to initialize mDNS: {}", e);
                warn!("Server will continue without network discovery");
            }
        }
    }

    // Run server
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;

    // Clean up mDNS announcement on shutdown
    if let Some(disc) = discovery {
        if let Err(e) = disc.unannounce() {
            warn!("Failed to unannounce mDNS service: {}", e);
        }
    }

    Ok(())
}
