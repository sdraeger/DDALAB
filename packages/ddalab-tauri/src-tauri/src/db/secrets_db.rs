use rusqlite::{Connection, params};
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use aes_gcm::aead::generic_array::{GenericArray, typenum};
use sha2::{Sha256, Digest};
use std::path::Path;
use std::sync::Mutex;
use anyhow::{Result, Context};

/// Secure secrets database with AES-256-GCM encryption
/// Uses machine-specific key derivation to avoid password prompts
pub struct SecretsDatabase {
    conn: Mutex<Connection>,
    cipher: Aes256Gcm,
}

impl SecretsDatabase {
    /// Create or open the secrets database
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path)
            .context("Failed to open secrets database")?;

        // Create secrets table if it doesn't exist
        conn.execute(
            "CREATE TABLE IF NOT EXISTS secrets (
                key TEXT PRIMARY KEY,
                encrypted_value BLOB NOT NULL,
                nonce BLOB NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        ).context("Failed to create secrets table")?;

        // Derive encryption key from machine-specific identifier
        let encryption_key = Self::derive_encryption_key()?;
        let cipher = Aes256Gcm::new(&encryption_key);

        Ok(Self { conn: Mutex::new(conn), cipher })
    }

    /// Derive a 256-bit encryption key from machine-specific data
    /// This avoids password prompts while still providing encryption at rest
    fn derive_encryption_key() -> Result<GenericArray<u8, typenum::U32>> {
        // Get machine-specific identifier
        let machine_id = machine_uid::get()
            .map_err(|e| anyhow::anyhow!("Failed to get machine ID: {}", e))?;

        // Add application-specific salt
        let app_salt = b"ddalab-secrets-v1";

        // Derive key using SHA-256
        let mut hasher = Sha256::new();
        hasher.update(machine_id.as_bytes());
        hasher.update(app_salt);
        let hash = hasher.finalize();

        Ok(*GenericArray::from_slice(&hash))
    }

    /// Store an encrypted secret
    pub fn set_secret(&self, key: &str, value: &str) -> Result<()> {
        // Generate random nonce
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

        // Encrypt the value
        let encrypted = self.cipher
            .encrypt(&nonce, value.as_bytes())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        let now = chrono::Utc::now().timestamp();

        // Store encrypted value and nonce
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Failed to lock database: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO secrets (key, encrypted_value, nonce, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![key, encrypted, nonce.as_slice(), now],
        ).context("Failed to store secret")?;

        log::info!("[SECRETS_DB] Stored encrypted secret: {}", key);
        Ok(())
    }

    /// Retrieve and decrypt a secret
    pub fn get_secret(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Failed to lock database: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT encrypted_value, nonce FROM secrets WHERE key = ?1"
        ).context("Failed to prepare query")?;

        let result = stmt.query_row(params![key], |row| {
            let encrypted: Vec<u8> = row.get(0)?;
            let nonce_bytes: Vec<u8> = row.get(1)?;
            Ok((encrypted, nonce_bytes))
        });

        match result {
            Ok((encrypted, nonce_bytes)) => {
                let nonce = Nonce::from_slice(&nonce_bytes);

                // Decrypt the value
                let decrypted = self.cipher
                    .decrypt(nonce, encrypted.as_ref())
                    .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

                let value = String::from_utf8(decrypted)
                    .context("Decrypted value is not valid UTF-8")?;

                log::info!("[SECRETS_DB] Retrieved encrypted secret: {}", key);
                Ok(Some(value))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                log::info!("[SECRETS_DB] No secret found for key: {}", key);
                Ok(None)
            }
            Err(e) => Err(anyhow::anyhow!("Database query failed: {}", e)),
        }
    }

    /// Check if a secret exists
    pub fn has_secret(&self, key: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Failed to lock database: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT 1 FROM secrets WHERE key = ?1"
        ).context("Failed to prepare query")?;

        let exists = stmt.exists(params![key])
            .context("Failed to check secret existence")?;

        Ok(exists)
    }

    /// Delete a secret
    pub fn delete_secret(&self, key: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Failed to lock database: {}", e))?;
        conn.execute(
            "DELETE FROM secrets WHERE key = ?1",
            params![key],
        ).context("Failed to delete secret")?;

        log::info!("[SECRETS_DB] Deleted secret: {}", key);
        Ok(())
    }

    /// List all secret keys (without values)
    pub fn list_keys(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("Failed to lock database: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT key FROM secrets ORDER BY key"
        ).context("Failed to prepare query")?;

        let keys = stmt.query_map([], |row| row.get(0))
            .context("Failed to query keys")?
            .collect::<std::result::Result<Vec<String>, _>>()
            .context("Failed to collect keys")?;

        Ok(keys)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_encrypt_decrypt() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("secrets.db");

        let db = SecretsDatabase::new(&db_path).unwrap();

        // Store a secret
        db.set_secret("test_key", "test_value").unwrap();

        // Retrieve it
        let value = db.get_secret("test_key").unwrap();
        assert_eq!(value, Some("test_value".to_string()));

        // Check existence
        assert!(db.has_secret("test_key").unwrap());
        assert!(!db.has_secret("nonexistent").unwrap());

        // Delete it
        db.delete_secret("test_key").unwrap();
        let value = db.get_secret("test_key").unwrap();
        assert_eq!(value, None);
    }

    #[test]
    fn test_openneuro_key_storage() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("secrets.db");

        let db = SecretsDatabase::new(&db_path).unwrap();

        let api_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";

        // Store OpenNeuro API key
        db.set_secret("openneuro_api_key", api_key).unwrap();

        // Retrieve it
        let retrieved = db.get_secret("openneuro_api_key").unwrap().unwrap();
        assert_eq!(retrieved, api_key);
    }
}
