use anyhow::Result;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::collections::HashMap;
use tracing::{info, warn};

/// Server discovery service using mDNS
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

    /// Announce the server on the local network
    pub fn announce(
        &mut self,
        port: u16,
        institution: &str,
        auth_hash: &str,
        server_version: &str,
    ) -> Result<()> {
        let hostname_base = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "ddalab-server".to_string());

        // Hostname must end with .local. for mDNS
        let hostname = if hostname_base.ends_with(".local.") {
            hostname_base
        } else {
            format!("{}.local.", hostname_base)
        };

        let service_type = "_ddalab-broker._tcp.local.";
        let instance_name = format!("DDALAB Server @ {}", hostname.trim_end_matches(".local."));

        let mut properties = HashMap::new();
        properties.insert("version".to_string(), server_version.to_string());
        properties.insert("institution".to_string(), institution.to_string());
        properties.insert("auth_required".to_string(), "true".to_string());
        // SECURITY: Don't expose password hash via mDNS - authentication happens
        // during WebSocket handshake with password sent over encrypted channel
        let _ = auth_hash; // Parameter kept for API compatibility but not broadcast
        // Client expects "tls" property - we use "false" since we use app-layer encryption
        properties.insert("tls".to_string(), "false".to_string());
        properties.insert("encryption".to_string(), "aes256gcm".to_string());

        // Get local IP address - prefer IPv4 over IPv6, skip link-local
        let my_addrs: Vec<std::net::IpAddr> = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .map(|iface| iface.addr.ip())
            .filter(|addr| {
                if addr.is_loopback() {
                    return false;
                }
                // Skip IPv6 link-local (fe80::)
                if let std::net::IpAddr::V6(v6) = addr {
                    let segments = v6.segments();
                    if segments[0] == 0xfe80 {
                        return false;
                    }
                }
                true
            })
            .collect();

        // Prefer IPv4 addresses
        let address = my_addrs
            .iter()
            .find(|addr| addr.is_ipv4())
            .or_else(|| my_addrs.first())
            .copied()
            .unwrap_or_else(|| {
                warn!("No suitable addresses found, using localhost");
                std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1))
            });

        let service_info = ServiceInfo::new(
            service_type,
            &instance_name,
            &hostname,
            address,
            port,
            Some(properties),
        )?;

        self.mdns.register(service_info.clone())?;
        self.service_info = Some(service_info.clone());

        info!(
            "mDNS server announced: {} on port {} at {}",
            instance_name, port, address
        );

        Ok(())
    }

    /// Stop announcing the server
    pub fn unannounce(&self) -> Result<()> {
        if let Some(ref service_info) = self.service_info {
            self.mdns.unregister(service_info.get_fullname())?;
            info!("mDNS server unannounced");
        }
        Ok(())
    }

    /// Get the local IP addresses
    pub fn get_local_addresses() -> Vec<std::net::IpAddr> {
        if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .map(|iface| iface.addr.ip())
            .filter(|addr| !addr.is_loopback())
            .collect()
    }
}

impl Drop for BrokerDiscovery {
    fn drop(&mut self) {
        if let Err(e) = self.unannounce() {
            warn!("Failed to unannounce server on drop: {}", e);
        }
    }
}

/// Hash a pre-shared key using Argon2id for secure distribution via mDNS
/// Returns an Argon2 hash string that includes the salt (can be verified without knowing the salt)
pub fn hash_psk(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    argon2
        .hash_password(password.as_bytes(), &salt)
        .expect("Failed to hash PSK")
        .to_string()
}

/// Verify a password against an Argon2 PSK hash
/// The hash contains the embedded salt, so verification works correctly
pub fn verify_psk(password: &str, expected_hash: &str) -> bool {
    let parsed_hash = match PasswordHash::new(expected_hash) {
        Ok(h) => h,
        Err(_) => return false,
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_psk_with_argon2() {
        let password = "secure_broker_password_2024";
        let hash1 = hash_psk(password);
        let hash2 = hash_psk(password);

        // Each hash should be different (due to random salt)
        assert_ne!(hash1, hash2);

        // Hash should start with Argon2 identifier
        assert!(hash1.starts_with("$argon2"));

        // Both hashes should verify correctly
        assert!(verify_psk(password, &hash1));
        assert!(verify_psk(password, &hash2));
    }

    #[test]
    fn test_verify_psk() {
        let password = "test_password";
        let hash = hash_psk(password);

        assert!(verify_psk(password, &hash));
        assert!(!verify_psk("wrong_password", &hash));
    }

    #[test]
    fn test_verify_psk_invalid_hash() {
        // Should return false for invalid hash format
        assert!(!verify_psk("password", "not_a_valid_argon2_hash"));
        assert!(!verify_psk("password", ""));
    }

    #[test]
    fn test_get_local_addresses() {
        let addrs = BrokerDiscovery::get_local_addresses();
        // Should have at least no addresses (valid case) or some non-loopback addresses
        for addr in &addrs {
            assert!(!addr.is_loopback());
        }
    }
}
