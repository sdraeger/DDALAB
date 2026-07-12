use crate::error::Result;
use memmap2::Mmap;
use std::fs::File;
use std::path::Path;

/// Open a file and map it into memory (read-only)
pub fn mmap_file(path: &Path) -> Result<Mmap> {
    let file = File::open(path)?;
    // SAFETY: DDA input files are treated as immutable while the returned map
    // is alive; mutating or truncating the file concurrently is unsupported.
    let mmap = unsafe { Mmap::map(&file)? };
    Ok(mmap)
}
