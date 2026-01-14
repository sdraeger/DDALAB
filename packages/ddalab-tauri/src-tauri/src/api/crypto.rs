use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

/// 256-bit encryption key for AES-GCM
#[derive(Clone)]
pub struct EncryptionKey([u8; 32]);

impl EncryptionKey {
    /// Create a new random encryption key
    pub fn random() -> Self {
        let mut key = [0u8; 32];
        rand::rng().fill_bytes(&mut key);
        Self(key)
    }

    /// Create from existing bytes
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    /// Get the key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Encryption error types
#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Invalid encryption key")]
    InvalidKey,
    #[error("Invalid nonce length (expected 12 bytes)")]
    InvalidNonce,
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("Decryption failed - data may be corrupted or tampered")]
    DecryptionFailed,
}

/// Encrypt payload using AES-256-GCM
/// Returns binary format: nonce (12 bytes) || ciphertext (includes 16-byte auth tag)
pub fn encrypt_payload(key: &EncryptionKey, plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(&key.0).map_err(|_| CryptoError::InvalidKey)?;

    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt (ciphertext includes authentication tag)
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::EncryptionFailed)?;

    // Concatenate: nonce || ciphertext
    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce_bytes);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decrypt payload using AES-256-GCM
/// Expects binary format: nonce (12 bytes) || ciphertext
pub fn decrypt_payload(key: &EncryptionKey, data: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if data.len() < 12 {
        return Err(CryptoError::InvalidNonce);
    }

    let (nonce_bytes, ciphertext) = data.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&key.0).map_err(|_| CryptoError::InvalidKey)?;
    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = EncryptionKey::random();
        let plaintext = b"Hello, DDALAB! This is sensitive data.";

        let encrypted = encrypt_payload(&key, plaintext).unwrap();
        let decrypted = decrypt_payload(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_different_nonces() {
        let key = EncryptionKey::random();
        let plaintext = b"Same message";

        let encrypted1 = encrypt_payload(&key, plaintext).unwrap();
        let encrypted2 = encrypt_payload(&key, plaintext).unwrap();

        // Same plaintext produces different ciphertext due to random nonces
        assert_ne!(encrypted1, encrypted2);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = EncryptionKey::random();
        let plaintext = b"Original message";

        let mut encrypted = encrypt_payload(&key, plaintext).unwrap();

        // Tamper with ciphertext (after nonce)
        if encrypted.len() > 12 {
            encrypted[12] ^= 0xFF;
        }

        assert!(decrypt_payload(&key, &encrypted).is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = EncryptionKey::random();
        let key2 = EncryptionKey::random();
        let plaintext = b"Secret message";

        let encrypted = encrypt_payload(&key1, plaintext).unwrap();
        assert!(decrypt_payload(&key2, &encrypted).is_err());
    }
}
