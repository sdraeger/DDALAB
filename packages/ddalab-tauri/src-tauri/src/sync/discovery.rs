use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
pub async fn discover_brokers(timeout_secs: u64) -> Result<Vec<DiscoveredBroker>> {
    let mdns = ServiceDaemon::new()?;
    let service_type = "_ddalab-broker._tcp.local.";

    info!("Starting broker discovery (timeout: {}s)", timeout_secs);

    let receiver = mdns.browse(service_type)?;
    let mut brokers = Vec::new();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        if tokio::time::Instant::now() > deadline {
            break;
        }

        match tokio::time::timeout(Duration::from_secs(1), receiver.recv_async()).await {
            Ok(Ok(event)) => {
                if let ServiceEvent::ServiceResolved(info) = event {
                    debug!("Discovered service: {}", info.get_fullname());

                    let properties = info.get_properties();

                    let institution = properties
                        .get_property_val_str("institution")
                        .unwrap_or_else(|| "Unknown Institution".to_string());

                    let version = properties
                        .get_property_val_str("version")
                        .unwrap_or_else(|| "1.0".to_string());

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

                    // Get first IP address
                    let host = info
                        .get_addresses()
                        .iter()
                        .next()
                        .map(|addr| addr.to_string())
                        .unwrap_or_else(|| info.get_hostname().to_string());

                    let broker = DiscoveredBroker {
                        name: info.get_fullname().to_string(),
                        url: format!("{}://{}:{}", protocol, host, info.get_port()),
                        institution,
                        version,
                        auth_required,
                        auth_hash,
                        uses_tls,
                    };

                    info!(
                        "Found broker: {} at {} (TLS: {}, Auth: {})",
                        broker.institution, broker.url, broker.uses_tls, broker.auth_required
                    );

                    brokers.push(broker);
                }
            }
            _ => continue,
        }
    }

    info!("Discovery complete. Found {} broker(s)", brokers.len());
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
