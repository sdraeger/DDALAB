use anyhow::Result;
use argon2::{password_hash::PasswordHash, password_hash::PasswordVerifier, Argon2};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tracing::{debug, info};

/// A discovered broker on the local network
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredBroker {
    pub name: String,
    pub url: String,
    pub institution: String,
    pub version: String,
    pub auth_required: bool,
    /// Deprecated: auth_hash is no longer broadcast via mDNS for security.
    /// Authentication happens during WebSocket connection with password sent over encrypted channel.
    #[serde(default)]
    pub auth_hash: String,
    pub uses_tls: bool,
}

/// Discover DDALAB brokers on the local network
///
/// This uses an optimized discovery strategy:
/// - Returns immediately after finding brokers (no need to wait for full timeout)
/// - Uses shorter polling intervals for faster response
/// - Deduplicates brokers by hostname
pub async fn discover_brokers(timeout_secs: u64) -> Result<Vec<DiscoveredBroker>> {
    let mdns = ServiceDaemon::new()?;
    let service_type = "_ddalab-broker._tcp.local.";

    info!("Starting broker discovery (timeout: {}s)", timeout_secs);

    let receiver = mdns.browse(service_type)?;
    // Use HashMap to deduplicate by hostname
    let mut brokers_map: HashMap<String, DiscoveredBroker> = HashMap::new();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);
    let start = tokio::time::Instant::now();

    // After finding first broker, wait a bit more for others on same network
    let mut found_first_broker = false;
    let grace_period = Duration::from_millis(500); // 500ms grace period after first broker

    loop {
        let now = tokio::time::Instant::now();

        // Check if we should stop
        if now > deadline {
            break;
        }

        // If we found brokers and grace period passed, return early
        if found_first_broker && now > start + grace_period {
            break;
        }

        // Use shorter timeout for more responsive discovery
        match tokio::time::timeout(Duration::from_millis(300), receiver.recv_async()).await {
            Ok(Ok(event)) => {
                if let ServiceEvent::ServiceResolved(info) = event {
                    if !found_first_broker {
                        found_first_broker = true;
                        debug!("First broker found, starting grace period");
                    }
                    debug!("Discovered service: {}", info.get_fullname());

                    let properties = info.get_properties();

                    let institution = properties
                        .get_property_val_str("institution")
                        .unwrap_or("Unknown Institution");

                    let version = properties.get_property_val_str("version").unwrap_or("1.0");

                    let auth_required = properties
                        .get_property_val_str("auth_required")
                        .map(|s| s == "true")
                        .unwrap_or(false);

                    let auth_hash = properties
                        .get_property_val_str("auth_hash")
                        .unwrap_or_default();

                    let uses_tls = properties
                        .get_property_val_str("tls")
                        .map(|s| s == "true")
                        .unwrap_or(false);

                    let protocol = if uses_tls { "wss" } else { "ws" };

                    // Get best IP address (prefer IPv4, avoid loopback and link-local)
                    let host = info
                        .get_addresses()
                        .iter()
                        .filter(|scoped_ip| {
                            // ScopedIp derefs to IpAddr, so we can use methods directly
                            // Skip loopback and link-local addresses
                            if scoped_ip.is_loopback() {
                                return false;
                            }
                            // Check if it's IPv6 link-local
                            if scoped_ip.is_ipv6() {
                                // For IPv6, we need to check the address manually
                                // Skip link-local (fe80::) - best effort check via string
                                let addr_str = scoped_ip.to_string();
                                if addr_str.starts_with("fe80:") {
                                    return false;
                                }
                            }
                            true
                        })
                        // Prefer IPv4 over IPv6
                        .min_by_key(|scoped_ip| if scoped_ip.is_ipv4() { 0 } else { 1 })
                        .map(|scoped_ip| scoped_ip.to_string())
                        .unwrap_or_else(|| info.get_hostname().to_string());

                    let hostname = info.get_hostname();

                    // Use hostname as deduplication key
                    let key = hostname.to_string();

                    let broker = DiscoveredBroker {
                        name: info.get_fullname().to_string(),
                        url: format!("{}://{}:{}/ws", protocol, host, info.get_port()),
                        institution: institution.to_string(),
                        version: version.to_string(),
                        auth_required,
                        auth_hash: auth_hash.to_string(),
                        uses_tls,
                    };

                    info!(
                        "Found broker: {} at {} (TLS: {}, Auth: {})",
                        broker.institution, broker.url, broker.uses_tls, broker.auth_required
                    );

                    // Only keep the first (best) broker for each hostname
                    brokers_map.entry(key).or_insert(broker);
                }
            }
            _ => continue,
        }
    }

    let brokers: Vec<DiscoveredBroker> = brokers_map.into_values().collect();
    info!(
        "Discovery complete. Found {} unique broker(s)",
        brokers.len()
    );

    // Shutdown the mDNS daemon to clean up resources
    // Note: mdns-sd library produces harmless "sending on closed channel" errors
    // during shutdown which can be safely ignored (internal library issue)
    let _ = mdns.shutdown();

    Ok(brokers)
}

/// Verify a password against an Argon2 auth hash (used by Tauri command)
pub fn verify_password(password: &str, auth_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(auth_hash) {
        Ok(h) => h,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}
