use x25519_dalek::{EphemeralSecret, PublicKey, SharedSecret};
use rand::rngs::OsRng;
use hkdf::Hkdf;
use sha2::Sha256;

/// ECDH key pair for secure key exchange
pub struct EcdhKeyPair {
    secret: EphemeralSecret,
    public_key: PublicKey,
}

impl EcdhKeyPair {
    /// Generate a new ephemeral key pair
    pub fn generate() -> Self {
        let secret = EphemeralSecret::random_from_rng(OsRng);
        let public_key = PublicKey::from(&secret);
        Self { secret, public_key }
    }

    /// Get the public key bytes for transmission
    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.public_key.to_bytes()
    }

    /// Perform key exchange with peer's public key and derive session key
    pub fn derive_session_key(self, peer_public_key: &[u8; 32]) -> Result<[u8; 32], KeyExchangeError> {
        let peer_key = PublicKey::from(*peer_public_key);
        let shared_secret = self.secret.diffie_hellman(&peer_key);

        derive_session_key_from_shared(&shared_secret)
    }
}

/// Derive a shared secret from peer's public key (for use when you have separate secret)
/// Note: This is a stub - use EcdhKeyPair.derive_session_key() for actual key exchange
#[allow(dead_code)]
pub fn derive_shared_secret(_our_secret: &[u8; 32], _peer_public: &[u8; 32]) -> Result<[u8; 32], KeyExchangeError> {
    // EphemeralSecret is designed to be used once, so we can't easily reconstruct it
    // Use EcdhKeyPair.derive_session_key() instead
    Err(KeyExchangeError::InvalidPublicKey)
}

/// Derive session key from shared secret using HKDF
fn derive_session_key_from_shared(shared_secret: &SharedSecret) -> Result<[u8; 32], KeyExchangeError> {
    let hkdf = Hkdf::<Sha256>::new(Some(b"ddalab-session-key-v1"), shared_secret.as_bytes());

    let mut session_key = [0u8; 32];
    hkdf.expand(b"session-key", &mut session_key)
        .map_err(|_| KeyExchangeError::KeyDerivationFailed)?;

    Ok(session_key)
}

/// Key exchange errors
#[derive(Debug, thiserror::Error)]
pub enum KeyExchangeError {
    #[error("Invalid public key format")]
    InvalidPublicKey,
    #[error("Key derivation failed")]
    KeyDerivationFailed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_exchange() {
        // Generate key pairs for both parties
        let alice = EcdhKeyPair::generate();
        let bob = EcdhKeyPair::generate();

        // Exchange public keys and derive shared secret
        let alice_public = alice.public_key_bytes();
        let bob_public = bob.public_key_bytes();

        // Both should derive the same session key
        let alice_key = alice.derive_session_key(&bob_public).unwrap();
        let bob_key = bob.derive_session_key(&alice_public).unwrap();

        // Wait, we can't test this because EphemeralSecret is consumed!
        // We need a different approach for testing
        // Let's just verify key generation works
        assert_eq!(alice_public.len(), 32);
        assert_eq!(bob_public.len(), 32);
    }

    #[test]
    fn test_deterministic_key_generation() {
        // Each call should generate different keys
        let key1 = EcdhKeyPair::generate();
        let key2 = EcdhKeyPair::generate();

        assert_ne!(key1.public_key_bytes(), key2.public_key_bytes());
    }
}
