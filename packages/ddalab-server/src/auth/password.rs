use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

/// Hash a password using Argon2id
pub fn hash_password(password: &str) -> Result<String, PasswordError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|_| PasswordError::HashingFailed)?;

    Ok(hash.to_string())
}

/// Verify a password against a stored hash
pub fn verify_password(password: &str, hash: &str) -> Result<bool, PasswordError> {
    let parsed_hash = PasswordHash::new(hash).map_err(|_| PasswordError::InvalidHash)?;

    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

/// Password errors
#[derive(Debug, thiserror::Error)]
pub enum PasswordError {
    #[error("Password hashing failed")]
    HashingFailed,
    #[error("Invalid hash format")]
    InvalidHash,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify() {
        let password = "secure_password_123";
        let hash = hash_password(password).unwrap();

        // Correct password should verify
        assert!(verify_password(password, &hash).unwrap());

        // Wrong password should not verify
        assert!(!verify_password("wrong_password", &hash).unwrap());
    }

    #[test]
    fn test_different_hashes() {
        let password = "same_password";

        // Each hash should be different (due to random salt)
        let hash1 = hash_password(password).unwrap();
        let hash2 = hash_password(password).unwrap();

        assert_ne!(hash1, hash2);

        // But both should verify correctly
        assert!(verify_password(password, &hash1).unwrap());
        assert!(verify_password(password, &hash2).unwrap());
    }
}
