use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rand::RngCore;

/// 256-bit encryption key for AES-GCM
#[derive(Clone)]
pub struct EncryptionKey([u8; 32]);

impl EncryptionKey {
    /// Create a new encryption key from bytes
    pub fn new(key: [u8; 32]) -> Self {
        Self(key)
    }

    /// Create a random encryption key
    pub fn random() -> Self {
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        Self(key)
    }

    /// Get the key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// Encrypt payload using AES-256-GCM
///
/// Returns (nonce, ciphertext, tag) tuple
pub fn encrypt_payload(
    key: &EncryptionKey,
    plaintext: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), EncryptionError> {
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|_| EncryptionError::InvalidKey)?;

    // Generate random 12-byte nonce
    let mut nonce_bytes = [0u8; 12];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt (ciphertext includes authentication tag)
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| EncryptionError::EncryptionFailed)?;

    Ok((nonce_bytes.to_vec(), ciphertext))
}

/// Decrypt payload using AES-256-GCM
pub fn decrypt_payload(
    key: &EncryptionKey,
    nonce: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, EncryptionError> {
    if nonce.len() != 12 {
        return Err(EncryptionError::InvalidNonce);
    }

    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|_| EncryptionError::InvalidKey)?;

    let nonce = Nonce::from_slice(nonce);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| EncryptionError::DecryptionFailed)
}

/// Encryption/decryption errors
#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    #[error("Invalid encryption key")]
    InvalidKey,
    #[error("Invalid nonce length (expected 12 bytes)")]
    InvalidNonce,
    #[error("Encryption failed")]
    EncryptionFailed,
    #[error("Decryption failed - data may be corrupted or tampered")]
    DecryptionFailed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = EncryptionKey::random();
        let plaintext = b"Hello, DDALAB! This is sensitive data.";

        let (nonce, ciphertext) = encrypt_payload(&key, plaintext).unwrap();
        let decrypted = decrypt_payload(&key, &nonce, &ciphertext).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_different_nonces() {
        let key = EncryptionKey::random();
        let plaintext = b"Same message";

        let (nonce1, cipher1) = encrypt_payload(&key, plaintext).unwrap();
        let (nonce2, cipher2) = encrypt_payload(&key, plaintext).unwrap();

        // Same plaintext should produce different ciphertexts due to random nonces
        assert_ne!(nonce1, nonce2);
        assert_ne!(cipher1, cipher2);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = EncryptionKey::random();
        let plaintext = b"Original message";

        let (nonce, mut ciphertext) = encrypt_payload(&key, plaintext).unwrap();

        // Tamper with ciphertext
        if !ciphertext.is_empty() {
            ciphertext[0] ^= 0xFF;
        }

        // Decryption should fail
        let result = decrypt_payload(&key, &nonce, &ciphertext);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = EncryptionKey::random();
        let key2 = EncryptionKey::random();
        let plaintext = b"Secret message";

        let (nonce, ciphertext) = encrypt_payload(&key1, plaintext).unwrap();

        // Decryption with wrong key should fail
        let result = decrypt_payload(&key2, &nonce, &ciphertext);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_plaintext() {
        let key = EncryptionKey::random();
        let plaintext = b"";

        let (nonce, ciphertext) = encrypt_payload(&key, plaintext).unwrap();
        let decrypted = decrypt_payload(&key, &nonce, &ciphertext).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_large_plaintext() {
        let key = EncryptionKey::random();
        let plaintext: Vec<u8> = (0..10000).map(|i| (i % 256) as u8).collect();

        let (nonce, ciphertext) = encrypt_payload(&key, &plaintext).unwrap();
        let decrypted = decrypt_payload(&key, &nonce, &ciphertext).unwrap();

        assert_eq!(decrypted, plaintext);
    }
}
