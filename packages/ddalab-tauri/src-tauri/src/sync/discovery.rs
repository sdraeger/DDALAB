use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::IpAddr;
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

                    let version = properties
                        .get_property_val_str("version")
                        .unwrap_or("1.0");

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
                        .filter(|ip| {
                            // Skip loopback and link-local addresses
                            if ip.is_loopback() {
                                return false;
                            }
                            if let IpAddr::V6(ipv6) = ip {
                                // Skip IPv6 link-local (fe80::)
                                if ipv6.segments()[0] == 0xfe80 {
                                    return false;
                                }
                            }
                            true
                        })
                        // Prefer IPv4 over IPv6
                        .min_by_key(|ip| if ip.is_ipv4() { 0 } else { 1 })
                        .map(|ip| ip.to_string())
                        .unwrap_or_else(|| info.get_hostname().to_string());

                    let hostname = info.get_hostname();

                    // Use hostname as deduplication key
                    let key = hostname.to_string();

                    let broker = DiscoveredBroker {
                        name: info.get_fullname().to_string(),
                        url: format!("{}://{}:{}", protocol, host, info.get_port()),
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
    info!("Discovery complete. Found {} unique broker(s)", brokers.len());
    Ok(brokers)
}

/// Verify a password against a broker's auth hash
pub fn verify_password(password: &str, auth_hash: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let computed_hash = hex::encode(hasher.finalize());

    computed_hash == auth_hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verify_password() {
        let password = "test_password_123";
        let mut hasher = Sha256::new();
        hasher.update(password.as_bytes());
        let auth_hash = hex::encode(hasher.finalize());

        assert!(verify_password(password, &auth_hash));
        assert!(!verify_password("wrong_password", &auth_hash));
    }
}
