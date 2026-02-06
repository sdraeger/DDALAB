use aes_gcm::aead::generic_array::{typenum, GenericArray};
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};
use std::path::Path;
use zeroize::Zeroize;

/// Secure string that zeros its contents on drop
/// Prevents credentials from lingering in memory
#[derive(Debug)]
pub struct SecureString(Vec<u8>);

impl SecureString {
    pub fn from_string(s: String) -> Self {
        Self(s.into_bytes())
    }

    pub fn as_str(&self) -> Result<&str> {
        std::str::from_utf8(&self.0).context("Invalid UTF-8 in SecureString")
    }

    pub fn into_string(mut self) -> String {
        // SAFETY: We're moving out of self, so Drop won't run
        let s = std::mem::take(&mut self.0);
        std::mem::forget(self);
        String::from_utf8(s).unwrap_or_default()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Drop for SecureString {
    fn drop(&mut self) {
        // Zero out memory before dropping using zeroize crate
        // This provides proper volatile semantics and compiler barrier guarantees
        self.0.zeroize();
    }
}

impl Clone for SecureString {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl PartialEq for SecureString {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl PartialEq<String> for SecureString {
    fn eq(&self, other: &String) -> bool {
        self.as_str().map(|s| s == other).unwrap_or(false)
    }
}

impl PartialEq<&str> for SecureString {
    fn eq(&self, other: &&str) -> bool {
        self.as_str().map(|s| s == *other).unwrap_or(false)
    }
}

impl std::ops::Index<std::ops::Range<usize>> for SecureString {
    type Output = [u8];

    fn index(&self, range: std::ops::Range<usize>) -> &Self::Output {
        &self.0[range]
    }
}

/// Secure secrets database with AES-256-GCM encryption
/// Uses machine-specific key derivation combined with a per-installation random salt
pub struct SecretsDatabase {
    conn: Mutex<Connection>,
    cipher: Aes256Gcm,
}

impl SecretsDatabase {
    /// Create or open the secrets database
    pub fn new(db_path: &Path) -> Result<Self> {
        let conn = Connection::open(db_path).context("Failed to open secrets database")?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;",
        )
        .context("Failed to set SQLite pragmas")?;

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
        )
        .context("Failed to create secrets table")?;

        // Create metadata table for storing the installation salt
        conn.execute(
            "CREATE TABLE IF NOT EXISTS secrets_metadata (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL
            )",
            [],
        )
        .context("Failed to create secrets_metadata table")?;

        // Get or generate the installation-specific random salt
        let installation_salt = Self::get_or_create_installation_salt(&conn)?;

        // Derive encryption key from machine-specific identifier + random salt
        let encryption_key = Self::derive_encryption_key(&installation_salt)?;
        let cipher = Aes256Gcm::new(&encryption_key);

        let db = Self {
            conn: Mutex::new(conn),
            cipher,
        };

        // Migrate old v1 credentials to v2 if needed
        if let Err(e) = db.migrate_v1_to_v2() {
            log::warn!("[SECRETS_DB] Failed to migrate v1 credentials: {}", e);
            // Don't fail initialization if migration fails
        }

        Ok(db)
    }

    /// Get existing installation salt or generate a new one
    /// The salt is stored in the database and persists across restarts
    fn get_or_create_installation_salt(conn: &Connection) -> Result<Vec<u8>> {
        let salt_key = "installation_salt";

        // Try to retrieve existing salt
        let existing_salt: Option<Vec<u8>> = conn
            .query_row(
                "SELECT value FROM secrets_metadata WHERE key = ?1",
                params![salt_key],
                |row| row.get(0),
            )
            .ok();

        if let Some(salt) = existing_salt {
            if salt.len() == 32 {
                log::debug!("[SECRETS_DB] Using existing installation salt");
                return Ok(salt);
            }
        }

        // Generate new random salt (32 bytes = 256 bits)
        let mut salt = vec![0u8; 32];
        OsRng.fill_bytes(&mut salt);

        // Store the salt
        conn.execute(
            "INSERT OR REPLACE INTO secrets_metadata (key, value) VALUES (?1, ?2)",
            params![salt_key, &salt],
        )
        .context("Failed to store installation salt")?;

        log::info!("[SECRETS_DB] Generated new installation salt");
        Ok(salt)
    }

    /// Derive a 256-bit encryption key from machine-specific data + installation salt
    /// This strengthens key derivation by combining:
    /// 1. Machine-unique identifier (ties secrets to this machine)
    /// 2. Per-installation random salt (prevents rainbow table attacks)
    /// 3. Application-specific context (domain separation)
    fn derive_encryption_key(installation_salt: &[u8]) -> Result<GenericArray<u8, typenum::U32>> {
        // Get machine-specific identifier
        let machine_id =
            machine_uid::get().map_err(|e| anyhow::anyhow!("Failed to get machine ID: {}", e))?;

        // Application-specific context for domain separation
        let app_context = b"ddalab-secrets-v2";

        // Derive key using SHA-256 with all inputs
        // Order: app_context || machine_id || installation_salt
        let mut hasher = Sha256::new();
        hasher.update(app_context);
        hasher.update(machine_id.as_bytes());
        hasher.update(installation_salt);
        let hash = hasher.finalize();

        Ok(*GenericArray::from_slice(&hash))
    }

    /// Store an encrypted secret
    pub fn set_secret(&self, key: &str, value: &str) -> Result<()> {
        // Generate random nonce
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

        // Encrypt the value
        let encrypted = self
            .cipher
            .encrypt(&nonce, value.as_bytes())
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        let now = chrono::Utc::now().timestamp();

        // Store encrypted value and nonce
        self.conn.lock().execute(
            "INSERT OR REPLACE INTO secrets (key, encrypted_value, nonce, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![key, encrypted, nonce.as_slice(), now],
        )
        .context("Failed to store secret")?;

        log::info!("[SECRETS_DB] Stored encrypted secret: {}", key);
        Ok(())
    }

    /// Retrieve and decrypt a secret (returns SecureString that zeros memory on drop)
    pub fn get_secret(&self, key: &str) -> Result<Option<SecureString>> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT encrypted_value, nonce FROM secrets WHERE key = ?1")
            .context("Failed to prepare query")?;

        let result = stmt.query_row(params![key], |row| {
            let encrypted: Vec<u8> = row.get(0)?;
            let nonce_bytes: Vec<u8> = row.get(1)?;
            Ok((encrypted, nonce_bytes))
        });

        match result {
            Ok((encrypted, nonce_bytes)) => {
                let nonce = Nonce::from_slice(&nonce_bytes);

                // Decrypt the value
                let mut decrypted = self
                    .cipher
                    .decrypt(nonce, encrypted.as_ref())
                    .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

                // Validate UTF-8 before wrapping in SecureString
                let _validate = std::str::from_utf8(&decrypted)
                    .context("Decrypted value is not valid UTF-8")?;

                log::info!("[SECRETS_DB] Retrieved encrypted secret: {}", key);

                // Wrap in SecureString for automatic zeroing
                let secure_string = SecureString(decrypted);

                // Zero out the decrypted vec since we've moved it
                Ok(Some(secure_string))
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
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT 1 FROM secrets WHERE key = ?1")
            .context("Failed to prepare query")?;

        let exists = stmt
            .exists(params![key])
            .context("Failed to check secret existence")?;

        Ok(exists)
    }

    /// Delete a secret
    pub fn delete_secret(&self, key: &str) -> Result<()> {
        self.conn
            .lock()
            .execute("DELETE FROM secrets WHERE key = ?1", params![key])
            .context("Failed to delete secret")?;

        log::info!("[SECRETS_DB] Deleted secret: {}", key);
        Ok(())
    }

    /// List all secret keys (without values)
    pub fn list_keys(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT key FROM secrets ORDER BY key")
            .context("Failed to prepare query")?;

        let keys = stmt
            .query_map([], |row| row.get(0))
            .context("Failed to query keys")?
            .collect::<std::result::Result<Vec<String>, _>>()
            .context("Failed to collect keys")?;

        Ok(keys)
    }

    pub fn save_nsg_credentials(
        &self,
        username: &str,
        password: &str,
        app_key: &str,
    ) -> Result<()> {
        let credentials_json = serde_json::json!({
            "username": username,
            "password": password,
            "app_key": app_key
        });

        let credentials_str = serde_json::to_string(&credentials_json)
            .context("Failed to serialize NSG credentials")?;

        self.set_secret("nsg_credentials", &credentials_str)
            .context("Failed to store NSG credentials")?;

        log::info!("[SECRETS_DB] Stored NSG credentials for user: {}", username);
        Ok(())
    }

    pub fn get_nsg_credentials(
        &self,
    ) -> Result<Option<(SecureString, SecureString, SecureString)>> {
        let credentials_secure = self
            .get_secret("nsg_credentials")
            .context("Failed to retrieve NSG credentials")?;

        match credentials_secure {
            Some(secure_str) => {
                let json_str = secure_str.as_str()?;
                let credentials: serde_json::Value =
                    serde_json::from_str(json_str).context("Failed to parse NSG credentials")?;

                let username_str = credentials["username"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Missing username in NSG credentials"))?
                    .to_string();

                let password_str = credentials["password"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Missing password in NSG credentials"))?
                    .to_string();

                let app_key_str = credentials["app_key"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Missing app_key in NSG credentials"))?
                    .to_string();

                log::info!(
                    "[SECRETS_DB] Retrieved NSG credentials for user: {}",
                    username_str
                );

                // Wrap sensitive strings in SecureString for automatic zeroing
                Ok(Some((
                    SecureString::from_string(username_str),
                    SecureString::from_string(password_str),
                    SecureString::from_string(app_key_str),
                )))
            }
            None => {
                log::info!("[SECRETS_DB] No NSG credentials found");
                Ok(None)
            }
        }
    }

    pub fn delete_nsg_credentials(&self) -> Result<()> {
        self.delete_secret("nsg_credentials")
            .context("Failed to delete NSG credentials")?;

        log::info!("[SECRETS_DB] Deleted NSG credentials");
        Ok(())
    }

    pub fn has_nsg_credentials(&self) -> Result<bool> {
        self.has_secret("nsg_credentials")
            .context("Failed to check NSG credentials existence")
    }

    /// Migrate secrets encrypted with v1 key to v2
    /// This is needed after the security upgrade that changed the encryption key derivation
    fn migrate_v1_to_v2(&self) -> Result<()> {
        // Check if migration is needed
        let migration_key = "migrated_v1_to_v2";
        if self.has_secret(migration_key).unwrap_or(false) {
            return Ok(());
        }

        // Try to get v1 encryption key
        let machine_id =
            machine_uid::get().map_err(|e| anyhow::anyhow!("Failed to get machine ID: {}", e))?;

        let v1_app_salt = b"ddalab-secrets-v1";
        let mut hasher = Sha256::new();
        hasher.update(machine_id.as_bytes());
        hasher.update(v1_app_salt);
        let v1_hash = hasher.finalize();
        let v1_key = GenericArray::from_slice(&v1_hash);
        let v1_cipher = Aes256Gcm::new(v1_key);

        // Get all encrypted secrets
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare("SELECT key, encrypted_value, nonce FROM secrets")
            .context("Failed to prepare migration query")?;

        let secrets: Vec<(String, Vec<u8>, Vec<u8>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .context("Failed to query secrets")?
            .collect::<std::result::Result<Vec<_>, _>>()
            .context("Failed to collect secrets")?;

        drop(stmt);
        drop(conn);

        let mut migrated_count = 0;

        for (key, encrypted_value, nonce_bytes) in secrets {
            // Skip the migration marker itself
            if key == migration_key {
                continue;
            }

            // Try to decrypt with v1 key
            let nonce = Nonce::from_slice(&nonce_bytes);
            if let Ok(decrypted) = v1_cipher.decrypt(nonce, encrypted_value.as_ref()) {
                // Successfully decrypted with v1 key - re-encrypt with v2
                if let Ok(decrypted_str) = std::str::from_utf8(&decrypted) {
                    // Re-save with current v2 cipher
                    if let Err(e) = self.set_secret(&key, decrypted_str) {
                        log::warn!("[SECRETS_DB] Failed to re-encrypt {}: {}", key, e);
                    } else {
                        migrated_count += 1;
                    }
                }
            }
            // If v1 decryption fails, secret is either already v2 or corrupted - skip it
        }

        // Mark migration as complete
        self.set_secret(migration_key, "completed")
            .context("Failed to mark migration as complete")?;

        Ok(())
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
        assert!(value.is_some());
        assert_eq!(value.as_ref().unwrap().as_str().unwrap(), "test_value");

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
        assert_eq!(retrieved.as_str().unwrap(), api_key);
    }
}
