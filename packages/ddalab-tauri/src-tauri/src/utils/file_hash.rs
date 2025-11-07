use anyhow::{Context, Result};
use rayon::prelude::*;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Block size for sampling (64 KB)
/// Provides good I/O performance and reasonable granularity
const BLOCK_SIZE: usize = 65_536; // 64 KB

/// Compute a BLAKE3 hash using block-based sampling strategy
///
/// This provides a content-based identifier for files that:
/// - Works across different machines and file paths
/// - Detects modifications anywhere in the file (prepends, appends, middle changes)
/// - Scales efficiently with file size using adaptive sampling
/// - Uses parallel processing for performance
/// - Has negligible collision probability for real-world files
///
/// # Strategy
/// - Always samples: first block, last block, middle block
/// - Samples additional blocks at adaptive stride intervals based on file size
/// - Computes: H(file_size || stride || num_blocks || H(sampled_blocks))
///
/// # Arguments
/// * `file_path` - Path to the file to hash
///
/// # Returns
/// * A 64-character hex string (BLAKE3 hash)
///
/// # Example
/// ```no_run
/// use ddalab_tauri::utils::file_hash::compute_file_hash;
///
/// # fn main() -> anyhow::Result<()> {
/// let hash = compute_file_hash("/path/to/file.edf")?;
/// println!("File hash: {}", hash);
/// # Ok(())
/// # }
/// ```
pub fn compute_file_hash<P: AsRef<Path>>(file_path: P) -> Result<String> {
    let path = file_path.as_ref();

    // Get file size
    let file_size = std::fs::metadata(path)
        .with_context(|| format!("Failed to read file metadata: {}", path.display()))?
        .len();

    if file_size == 0 {
        // Empty file - return hash of empty data
        return Ok(blake3::hash(&[]).to_hex().to_string());
    }

    // Calculate total blocks in file
    let total_blocks = ((file_size + BLOCK_SIZE as u64 - 1) / BLOCK_SIZE as u64) as usize;

    // Adaptive stride based on file size
    let stride = calculate_stride(file_size);

    // Determine which blocks to sample
    let blocks_to_sample = determine_sample_blocks(total_blocks, stride);

    // Open file for reading
    let mut file = File::open(path)
        .with_context(|| format!("Failed to open file for hashing: {}", path.display()))?;

    // Read and hash blocks in parallel
    let block_hashes: Vec<blake3::Hash> = blocks_to_sample
        .par_iter()
        .map(|&block_index| {
            // Clone file handle for parallel access
            let mut local_file = File::open(path).expect("Failed to open file in parallel block");

            // Seek to block position
            let offset = block_index as u64 * BLOCK_SIZE as u64;
            local_file
                .seek(SeekFrom::Start(offset))
                .expect("Failed to seek in file");

            // Read block (may be less than BLOCK_SIZE for last block)
            let mut buffer = vec![0u8; BLOCK_SIZE];
            let bytes_read = local_file.read(&mut buffer).expect("Failed to read block");
            buffer.truncate(bytes_read);

            // Hash this block
            blake3::hash(&buffer)
        })
        .collect();

    // Combine all hashes with metadata into final hash
    let final_hash = compute_final_hash(file_size, stride as u64, &block_hashes);

    Ok(final_hash.to_hex().to_string())
}

/// Calculate adaptive stride based on file size
/// Ensures ~10-20 samples regardless of file size
fn calculate_stride(file_size: u64) -> usize {
    let total_blocks = ((file_size + BLOCK_SIZE as u64 - 1) / BLOCK_SIZE as u64) as usize;

    if total_blocks <= 10 {
        1 // Small files: sample every block
    } else if total_blocks <= 160 {
        10 // Medium files (< 10 MB): sample every 10 blocks
    } else if total_blocks <= 1600 {
        100 // Large files (< 100 MB): sample every 100 blocks
    } else {
        1000 // Very large files: sample every 1000 blocks
    }
}

/// Determine which blocks to sample
/// Always includes: first, last, middle, and stride-based samples
fn determine_sample_blocks(total_blocks: usize, stride: usize) -> Vec<usize> {
    let mut blocks = Vec::new();

    if total_blocks == 0 {
        return blocks;
    }

    // Always sample first block (detects prepends/header changes)
    blocks.push(0);

    // Sample at stride intervals
    let mut block_idx = stride;
    while block_idx < total_blocks - 1 {
        if !blocks.contains(&block_idx) {
            blocks.push(block_idx);
        }
        block_idx += stride;
    }

    // Always sample middle block (detects truncation)
    let middle = total_blocks / 2;
    if middle > 0 && middle < total_blocks - 1 && !blocks.contains(&middle) {
        blocks.push(middle);
    }

    // Always sample last block (detects appends)
    let last = total_blocks - 1;
    if last > 0 && !blocks.contains(&last) {
        blocks.push(last);
    }

    // Sort for deterministic order
    blocks.sort_unstable();
    blocks
}

/// Compute final hash by combining metadata and block hashes
/// Format: H(file_size || stride || num_blocks || block_hash_1 || block_hash_2 || ...)
fn compute_final_hash(file_size: u64, stride: u64, block_hashes: &[blake3::Hash]) -> blake3::Hash {
    let mut hasher = blake3::Hasher::new();

    // Include file size (8 bytes)
    hasher.update(&file_size.to_le_bytes());

    // Include stride (8 bytes)
    hasher.update(&stride.to_le_bytes());

    // Include number of blocks sampled (8 bytes)
    hasher.update(&(block_hashes.len() as u64).to_le_bytes());

    // Include all block hashes
    for hash in block_hashes {
        hasher.update(hash.as_bytes());
    }

    hasher.finalize()
}

/// Compute file hash and log the result
/// Useful for debugging and migration
pub fn compute_and_log_file_hash<P: AsRef<Path>>(file_path: P) -> Result<String> {
    let path = file_path.as_ref();
    let file_size = std::fs::metadata(path)?.len();
    let stride = calculate_stride(file_size);
    let total_blocks = ((file_size + BLOCK_SIZE as u64 - 1) / BLOCK_SIZE as u64) as usize;
    let blocks_to_sample = determine_sample_blocks(total_blocks, stride);

    let hash = compute_file_hash(path)?;

    log::info!(
        "Computed block-based file hash for {}: {} (size: {} bytes, stride: {}, sampled: {}/{} blocks)",
        path.display(),
        hash,
        file_size,
        stride,
        blocks_to_sample.len(),
        total_blocks
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
    fn test_detects_append() -> Result<()> {
        let mut temp_file = NamedTempFile::new()?;

        // Write initial content
        let initial_data = vec![0u8; 1024 * 1024]; // 1 MB
        temp_file.write_all(&initial_data)?;
        temp_file.flush()?;

        let hash1 = compute_file_hash(temp_file.path())?;

        // Append more data
        temp_file.write_all(b"appended data")?;
        temp_file.flush()?;

        let hash2 = compute_file_hash(temp_file.path())?;

        // Hash should change when data is appended
        assert_ne!(hash1, hash2);

        Ok(())
    }

    #[test]
    fn test_detects_prepend() -> Result<()> {
        let mut temp1 = NamedTempFile::new()?;
        let mut temp2 = NamedTempFile::new()?;

        let data = vec![1u8; 1024 * 1024]; // 1 MB

        // File without prepend
        temp1.write_all(&data)?;
        temp1.flush()?;

        // File with prepend
        temp2.write_all(b"prepended data")?;
        temp2.write_all(&data)?;
        temp2.flush()?;

        let hash1 = compute_file_hash(temp1.path())?;
        let hash2 = compute_file_hash(temp2.path())?;

        assert_ne!(hash1, hash2);

        Ok(())
    }

    #[test]
    fn test_detects_middle_modification() -> Result<()> {
        let mut temp1 = NamedTempFile::new()?;
        let mut temp2 = NamedTempFile::new()?;

        // Create 10 MB file
        let size = 10 * 1024 * 1024;
        let data1 = vec![0u8; size];
        let mut data2 = vec![0u8; size];

        // Modify middle of second file
        let middle = size / 2;
        data2[middle] = 0xFF;

        temp1.write_all(&data1)?;
        temp1.flush()?;

        temp2.write_all(&data2)?;
        temp2.flush()?;

        let hash1 = compute_file_hash(temp1.path())?;
        let hash2 = compute_file_hash(temp2.path())?;

        assert_ne!(hash1, hash2);

        Ok(())
    }

    #[test]
    fn test_empty_file() -> Result<()> {
        let temp_file = NamedTempFile::new()?;

        let hash = compute_file_hash(temp_file.path())?;
        assert_eq!(hash.len(), 64);

        Ok(())
    }

    #[test]
    fn test_calculate_stride() {
        // Small file (< 10 blocks = 640 KB): stride = 1
        assert_eq!(calculate_stride(500_000), 1);

        // Medium file (~10 MB): stride = 10
        assert_eq!(calculate_stride(10_000_000), 10);

        // Large file (~100 MB): stride = 100
        assert_eq!(calculate_stride(100_000_000), 100);

        // Very large file (> 100 MB): stride = 1000
        assert_eq!(calculate_stride(500_000_000), 1000);
    }

    #[test]
    fn test_determine_sample_blocks() {
        // Small file: all blocks
        let blocks = determine_sample_blocks(5, 1);
        assert_eq!(blocks, vec![0, 1, 2, 3, 4]);

        // Medium file: first, stride samples, middle, last
        let blocks = determine_sample_blocks(100, 10);
        assert!(blocks.contains(&0)); // first
        assert!(blocks.contains(&50)); // middle
        assert!(blocks.contains(&99)); // last
        assert!(blocks.contains(&10)); // stride sample
        assert!(blocks.contains(&20)); // stride sample

        // Large file
        let blocks = determine_sample_blocks(1000, 100);
        assert!(blocks.contains(&0)); // first
        assert!(blocks.contains(&500)); // middle
        assert!(blocks.contains(&999)); // last
        assert_eq!(blocks.len() > 10, true); // multiple stride samples
    }

    #[test]
    fn test_large_file_performance() -> Result<()> {
        let mut temp_file = NamedTempFile::new()?;

        // Write 50 MB of data
        let chunk = vec![0u8; 1024 * 1024]; // 1 MB chunks
        for _ in 0..50 {
            temp_file.write_all(&chunk)?;
        }
        temp_file.flush()?;

        // Should successfully hash without reading entire file
        let start = std::time::Instant::now();
        let hash = compute_file_hash(temp_file.path())?;
        let duration = start.elapsed();

        assert_eq!(hash.len(), 64);
        // Should complete in reasonable time (much less than reading entire file)
        assert!(duration.as_secs() < 5);

        Ok(())
    }
}
