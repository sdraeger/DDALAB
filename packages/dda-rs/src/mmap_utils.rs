use crate::error::{DDAError, Result};
use memmap2::Mmap;
use std::fs::File;
use std::path::Path;

/// Open a file and map it into memory (read-only)
pub fn mmap_file(path: &Path) -> Result<Mmap> {
    let file = File::open(path).map_err(DDAError::IoError)?;
    let mmap = unsafe { Mmap::map(&file).map_err(DDAError::IoError)? };
    Ok(mmap)
}
