use anyhow::Result;
use mdns_sd::{ServiceDaemon, ServiceInfo};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use tracing::{info, warn};

/// Broker discovery service using mDNS
pub struct BrokerDiscovery {
    mdns: ServiceDaemon,
    service_info: Option<ServiceInfo>,
}

impl BrokerDiscovery {
    /// Create a new discovery service
    pub fn new() -> Result<Self> {
        let mdns = ServiceDaemon::new()?;
        Ok(Self {
            mdns,
            service_info: None,
        })
    }

    /// Announce the broker on the local network
    pub fn announce(
        &mut self,
        port: u16,
        institution: &str,
        auth_hash: &str, // SHA256 hash of the pre-shared key
        use_tls: bool,
    ) -> Result<()> {
        let hostname_base = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "ddalab-broker".to_string());

        // Hostname must end with .local. for mDNS
        let hostname = if hostname_base.ends_with(".local.") {
            hostname_base
        } else {
            format!("{}.local.", hostname_base)
        };

        let service_type = "_ddalab-broker._tcp.local.";
        let instance_name = format!("DDALAB Broker @ {}", hostname.trim_end_matches(".local."));

        let mut properties = HashMap::new();
        properties.insert("version".to_string(), "1.0".to_string());
        properties.insert("institution".to_string(), institution.to_string());
        properties.insert("auth_required".to_string(), "true".to_string());
        properties.insert("auth_hash".to_string(), auth_hash.to_string());
        properties.insert("tls".to_string(), use_tls.to_string());

        // Get local IP address
        let my_addrs: Vec<std::net::IpAddr> = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .map(|iface| iface.addr.ip())
            .filter(|addr| !addr.is_loopback())
            .collect();

        // Create service info - use empty () for addresses if none available
        let addresses = my_addrs.first().copied().unwrap_or_else(|| {
            warn!("No non-loopback addresses found, using localhost");
            std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))
        });

        let service_info = ServiceInfo::new(
            service_type,
            &instance_name,
            &hostname,
            addresses,
            port,
            Some(properties),
        )?;

        self.mdns.register(service_info.clone())?;
        self.service_info = Some(service_info.clone());

        info!(
            "mDNS broker announced: {} on port {} (TLS: {})",
            instance_name, port, use_tls
        );

        Ok(())
    }

    /// Stop announcing the broker
    pub fn unannounce(&self) -> Result<()> {
        if let Some(ref service_info) = self.service_info {
            self.mdns.unregister(service_info.get_fullname())?;
            info!("mDNS broker unannounced");
        }
        Ok(())
    }
}

impl Drop for BrokerDiscovery {
    fn drop(&mut self) {
        if let Err(e) = self.unannounce() {
            warn!("Failed to unannounce broker on drop: {}", e);
        }
    }
}

/// Hash a pre-shared key for secure distribution
pub fn hash_psk(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_psk() {
        let password = "secure_broker_password_2024";
        let hash = hash_psk(password);

        // Hash should be deterministic
        assert_eq!(hash, hash_psk(password));

        // Different passwords should produce different hashes
        assert_ne!(hash, hash_psk("different_password"));

        // Hash should be 64 hex characters (SHA256)
        assert_eq!(hash.len(), 64);
    }
}
