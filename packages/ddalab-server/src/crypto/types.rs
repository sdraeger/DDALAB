use serde::{Deserialize, Serialize};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

/// Encrypted request body
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedRequest {
    /// Base64-encoded nonce (12 bytes)
    pub nonce: String,
    /// Base64-encoded ciphertext (includes auth tag)
    pub ciphertext: String,
}

impl EncryptedRequest {
    /// Create from raw bytes
    pub fn from_bytes(nonce: &[u8], ciphertext: &[u8]) -> Self {
        Self {
            nonce: BASE64.encode(nonce),
            ciphertext: BASE64.encode(ciphertext),
        }
    }

    /// Get nonce bytes
    pub fn nonce_bytes(&self) -> Result<Vec<u8>, base64::DecodeError> {
        BASE64.decode(&self.nonce)
    }

    /// Get ciphertext bytes
    pub fn ciphertext_bytes(&self) -> Result<Vec<u8>, base64::DecodeError> {
        BASE64.decode(&self.ciphertext)
    }
}

/// Encrypted response body
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedResponse {
    /// Base64-encoded nonce (12 bytes)
    pub nonce: String,
    /// Base64-encoded ciphertext (includes auth tag)
    pub ciphertext: String,
}

impl EncryptedResponse {
    /// Create from raw bytes
    pub fn from_bytes(nonce: &[u8], ciphertext: &[u8]) -> Self {
        Self {
            nonce: BASE64.encode(nonce),
            ciphertext: BASE64.encode(ciphertext),
        }
    }

    /// Get nonce bytes
    pub fn nonce_bytes(&self) -> Result<Vec<u8>, base64::DecodeError> {
        BASE64.decode(&self.nonce)
    }

    /// Get ciphertext bytes
    pub fn ciphertext_bytes(&self) -> Result<Vec<u8>, base64::DecodeError> {
        BASE64.decode(&self.ciphertext)
    }
}

/// Key exchange request (client -> server)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyExchangeRequest {
    /// Client's ECDH public key (base64 encoded, 32 bytes)
    pub client_public_key: String,
}

impl KeyExchangeRequest {
    /// Create from public key bytes
    pub fn from_public_key(public_key: &[u8; 32]) -> Self {
        Self {
            client_public_key: BASE64.encode(public_key),
        }
    }

    /// Get public key bytes
    pub fn public_key_bytes(&self) -> Result<[u8; 32], KeyExchangeDecodeError> {
        let bytes = BASE64.decode(&self.client_public_key)
            .map_err(|_| KeyExchangeDecodeError::InvalidBase64)?;

        if bytes.len() != 32 {
            return Err(KeyExchangeDecodeError::InvalidKeyLength);
        }

        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }
}

/// Key exchange response (server -> client)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyExchangeResponse {
    /// Server's ECDH public key (base64 encoded, 32 bytes)
    pub server_public_key: String,
    /// Session ID for tracking the encrypted session
    pub session_id: String,
}

impl KeyExchangeResponse {
    /// Create from public key bytes
    pub fn from_public_key(public_key: &[u8; 32], session_id: String) -> Self {
        Self {
            server_public_key: BASE64.encode(public_key),
            session_id,
        }
    }

    /// Get public key bytes
    pub fn public_key_bytes(&self) -> Result<[u8; 32], KeyExchangeDecodeError> {
        let bytes = BASE64.decode(&self.server_public_key)
            .map_err(|_| KeyExchangeDecodeError::InvalidBase64)?;

        if bytes.len() != 32 {
            return Err(KeyExchangeDecodeError::InvalidKeyLength);
        }

        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }
}

/// Server public key response (for initial key exchange)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerPublicKeyResponse {
    /// Server's ECDH public key (base64 encoded, 32 bytes)
    pub public_key: String,
    /// Key ID for session tracking
    pub key_id: String,
}

/// Key exchange decode errors
#[derive(Debug, thiserror::Error)]
pub enum KeyExchangeDecodeError {
    #[error("Invalid base64 encoding")]
    InvalidBase64,
    #[error("Invalid key length (expected 32 bytes)")]
    InvalidKeyLength,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypted_request_roundtrip() {
        let nonce = vec![1u8; 12];
        let ciphertext = vec![2u8; 100];

        let req = EncryptedRequest::from_bytes(&nonce, &ciphertext);

        assert_eq!(req.nonce_bytes().unwrap(), nonce);
        assert_eq!(req.ciphertext_bytes().unwrap(), ciphertext);
    }

    #[test]
    fn test_key_exchange_request_roundtrip() {
        let public_key = [42u8; 32];

        let req = KeyExchangeRequest::from_public_key(&public_key);
        let decoded = req.public_key_bytes().unwrap();

        assert_eq!(decoded, public_key);
    }

    #[test]
    fn test_key_exchange_response_roundtrip() {
        let public_key = [42u8; 32];
        let session_id = "test-session-123".to_string();

        let resp = KeyExchangeResponse::from_public_key(&public_key, session_id.clone());
        let decoded = resp.public_key_bytes().unwrap();

        assert_eq!(decoded, public_key);
        assert_eq!(resp.session_id, session_id);
    }

    #[test]
    fn test_serialization() {
        let req = EncryptedRequest::from_bytes(&[1u8; 12], &[2u8; 50]);
        let json = serde_json::to_string(&req).unwrap();
        let deserialized: EncryptedRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(req.nonce, deserialized.nonce);
        assert_eq!(req.ciphertext, deserialized.ciphertext);
    }
}
