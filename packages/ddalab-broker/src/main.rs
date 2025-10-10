use axum::{
    routing::{get, post},
    Router,
};
use ddalab_broker::{
    discovery::BrokerDiscovery, handle_websocket, BrokerState, PostgresShareStore, UserRegistry,
};
use sqlx::postgres::PgPoolOptions;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::time;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ddalab_broker=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("🚀 Starting DDALAB Sync Broker");

    // Load configuration from environment
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://ddalab:ddalab_password@localhost:5432/ddalab_broker".to_string());
    let bind_addr = env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());
    let heartbeat_timeout = env::var("HEARTBEAT_TIMEOUT_SECONDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(300); // 5 minutes default

    // Discovery configuration
    let institution_name = env::var("INSTITUTION_NAME")
        .unwrap_or_else(|_| "Default Institution".to_string());
    let broker_password = env::var("BROKER_PASSWORD")
        .unwrap_or_else(|_| "default_password".to_string());
    let use_tls = env::var("USE_TLS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(false);

    // Version check configuration
    let check_for_updates = env::var("CHECK_FOR_UPDATES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(true);

    // Connect to database
    info!("Connecting to database...");
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await?;

    // Initialize share store
    let share_store = PostgresShareStore::new(pool.clone());
    share_store.initialize().await?;
    info!("✅ Database schema initialized");

    // Create user registry
    let registry = UserRegistry::new();

    // Create broker state
    let state = BrokerState {
        registry: registry.clone(),
        share_store: Arc::new(share_store),
    };

    // Spawn background task to cleanup stale connections
    {
        let registry = registry.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let before_count = registry.get_all_connections().len();
                registry.cleanup_stale(heartbeat_timeout);
                let after_count = registry.get_all_connections().len();
                if before_count != after_count {
                    info!(
                        "Cleaned up {} stale connections ({} -> {})",
                        before_count - after_count,
                        before_count,
                        after_count
                    );
                }
            }
        });
    }

    // Build router
    let app = Router::new()
        .route("/ws", get(handle_websocket))
        .route("/health", get(health_check))
        .route("/api/shares/{token}", get(get_share_info))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr: SocketAddr = bind_addr.parse()?;
    info!("🎧 Listening on {}", addr);
    info!("📡 WebSocket endpoint: ws://{}/ws", addr);

    // Check for updates (non-blocking)
    if check_for_updates {
        ddalab_broker::version_check::spawn_update_check();
    }

    // Initialize and start mDNS discovery announcement
    let port = addr.port();
    let mut discovery = BrokerDiscovery::new()?;
    let auth_hash = ddalab_broker::discovery::hash_psk(&broker_password);

    match discovery.announce(port, &institution_name, &auth_hash, use_tls) {
        Ok(_) => {
            info!("🔍 mDNS discovery announcement started");
            info!("   Institution: {}", institution_name);
            info!("   Port: {}", port);
            info!("   TLS: {}", use_tls);
        }
        Err(e) => {
            warn!("Failed to start mDNS discovery: {}", e);
            warn!("Broker will continue without network discovery");
        }
    }

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service())
        .await?;

    // Clean up mDNS announcement on shutdown
    if let Err(e) = discovery.unannounce() {
        warn!("Failed to unannounce mDNS service: {}", e);
    }

    Ok(())
}

/// Health check endpoint
async fn health_check() -> &'static str {
    "OK"
}

/// Get information about a share (HTTP endpoint)
async fn get_share_info(
    axum::extract::Path(token): axum::extract::Path<String>,
    axum::extract::State(state): axum::extract::State<BrokerState>,
) -> Result<axum::Json<ddalab_broker::SharedResultInfo>, axum::http::StatusCode> {
    use ddalab_broker::traits::SharedResultStore;

    // Get share metadata
    let metadata = state
        .share_store
        .get_shared_result(&token)
        .await
        .map_err(|e| {
            warn!("Share not found: {}", e);
            axum::http::StatusCode::NOT_FOUND
        })?;

    // Check if owner is online
    let owner_online = state.registry.is_online(&metadata.owner_user_id);
    let download_url = if owner_online {
        state
            .registry
            .get_connection(&metadata.owner_user_id)
            .map(|conn| format!("{}/api/results/{}", conn.endpoint, metadata.result_id))
            .unwrap_or_default()
    } else {
        String::new()
    };

    Ok(axum::Json(ddalab_broker::SharedResultInfo {
        metadata,
        download_url,
        owner_online,
    }))
}
