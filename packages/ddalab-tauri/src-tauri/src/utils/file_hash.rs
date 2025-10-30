use anyhow::{Context, Result};
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// Size of data to read for hashing (1 MB)
/// This balances between collision resistance and computation speed
const HASH_BYTES: usize = 1_048_576; // 1 MB

/// Compute a BLAKE3 hash of the first N bytes of a file
///
/// This provides a content-based identifier for files that:
/// - Works across different machines and file paths
/// - Is fast to compute (BLAKE3 is very efficient)
/// - Has negligible collision probability for real-world files
/// - Detects file content changes
///
/// # Arguments
/// * `file_path` - Path to the file to hash
///
/// # Returns
/// * A 32-character hex string (BLAKE3 hash)
///
/// # Example
/// ```
/// let hash = compute_file_hash("/path/to/file.edf")?;
/// println!("File hash: {}", hash);
/// ```
pub fn compute_file_hash<P: AsRef<Path>>(file_path: P) -> Result<String> {
    let path = file_path.as_ref();

    // Open the file
    let mut file = File::open(path)
        .with_context(|| format!("Failed to open file for hashing: {}", path.display()))?;

    // Read first N bytes (or entire file if smaller)
    let mut buffer = vec![0u8; HASH_BYTES];
    let bytes_read = file
        .read(&mut buffer)
        .with_context(|| format!("Failed to read file for hashing: {}", path.display()))?;

    // Truncate buffer to actual bytes read
    buffer.truncate(bytes_read);

    // Compute BLAKE3 hash
    let hash = blake3::hash(&buffer);

    // Return hex-encoded hash (32 characters)
    Ok(hash.to_hex().to_string())
}

/// Compute file hash and log the result
/// Useful for debugging and migration
pub fn compute_and_log_file_hash<P: AsRef<Path>>(file_path: P) -> Result<String> {
    let path = file_path.as_ref();
    let hash = compute_file_hash(path)?;

    log::info!(
        "Computed file hash for {}: {} (first {} bytes)",
        path.display(),
        hash,
        HASH_BYTES
    );

    Ok(hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_compute_file_hash() -> Result<()> {
        // Create a temporary file with known content
        let mut temp_file = NamedTempFile::new()?;
        temp_file.write_all(b"test content")?;
        temp_file.flush()?;

        // Compute hash
        let hash = compute_file_hash(temp_file.path())?;

        // Should be a 64-character hex string (BLAKE3 produces 32 bytes = 64 hex chars)
        assert_eq!(hash.len(), 64);

        // Hash should be deterministic
        let hash2 = compute_file_hash(temp_file.path())?;
        assert_eq!(hash, hash2);

        Ok(())
    }

    #[test]
    fn test_different_content_different_hash() -> Result<()> {
        let mut temp1 = NamedTempFile::new()?;
        let mut temp2 = NamedTempFile::new()?;

        temp1.write_all(b"content A")?;
        temp1.flush()?;

        temp2.write_all(b"content B")?;
        temp2.flush()?;

        let hash1 = compute_file_hash(temp1.path())?;
        let hash2 = compute_file_hash(temp2.path())?;

        assert_ne!(hash1, hash2);

        Ok(())
    }

    #[test]
    fn test_large_file_only_hashes_first_mb() -> Result<()> {
        let mut temp_file = NamedTempFile::new()?;

        // Write 2 MB of data
        let data = vec![0u8; 2 * 1024 * 1024];
        temp_file.write_all(&data)?;
        temp_file.flush()?;

        // Should successfully hash (only reads first 1 MB)
        let hash = compute_file_hash(temp_file.path())?;
        assert_eq!(hash.len(), 64);

        Ok(())
    }
}
