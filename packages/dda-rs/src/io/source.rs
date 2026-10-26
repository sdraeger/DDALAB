use crate::error::{DDAError, Result};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::ops::Range;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use std::path::Path;

/// Random-access bytes. `read_at` fills `buf` from `offset` or errors if the range passes `len()`.
pub trait ByteSource: Send + Sync {
    fn len(&self) -> u64;
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()>;
}

/// The range `offset..offset + n` as indices, or the out-of-range error naming `name`.
fn checked_range(name: &str, offset: u64, n: usize, len: u64) -> Result<Range<usize>> {
    match offset.checked_add(n as u64) {
        Some(end) if end <= len => Ok(offset as usize..end as usize),
        _ => Err(DDAError::InvalidParameter(format!(
            "read past end of {name}: offset {offset} + {n} > {len}"
        ))),
    }
}

fn read_slice(name: &str, data: &[u8], offset: u64, buf: &mut [u8]) -> Result<()> {
    buf.copy_from_slice(&data[checked_range(name, offset, buf.len(), data.len() as u64)?]);
    Ok(())
}

pub struct MemorySource(pub Vec<u8>);

impl ByteSource for MemorySource {
    fn len(&self) -> u64 {
        self.0.len() as u64
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        read_slice("memory", &self.0, offset, buf)
    }
}

/// A read-only memory map; the file must not change while it is open (see `mmap_file`).
#[cfg(not(target_arch = "wasm32"))]
pub struct MmapSource {
    map: Option<memmap2::Mmap>,
    name: String,
}

#[cfg(not(target_arch = "wasm32"))]
impl MmapSource {
    pub fn open(path: &Path) -> Result<Self> {
        // An empty file cannot be mapped.
        let map = match std::fs::metadata(path)?.len() {
            0 => None,
            _ => Some(crate::mmap_utils::mmap_file(path)?),
        };
        Ok(Self {
            map,
            name: path.display().to_string(),
        })
    }

    fn bytes(&self) -> &[u8] {
        self.map.as_deref().unwrap_or_default()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl ByteSource for MmapSource {
    fn len(&self) -> u64 {
        self.bytes().len() as u64
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        read_slice(&self.name, self.bytes(), offset, buf)
    }
}

/// A block by its cache and its index in that cache's source.
type BlockKey = (u64, u64);
type Lru = (HashMap<BlockKey, Arc<Vec<u8>>>, VecDeque<BlockKey>);

/// The blocks of any number of `BlockCache`s under one capacity: the least recently used block of any of them goes
/// first. A source not read for a while gives way to the ones being read.
pub struct BlockPool {
    capacity_blocks: AtomicUsize,
    /// Blocks by key, and the keys from least to most recently used.
    lru: Mutex<Lru>,
}

impl BlockPool {
    pub fn new(capacity_blocks: usize) -> Self {
        let pool = Self {
            capacity_blocks: AtomicUsize::new(1),
            lru: Mutex::default(),
        };
        pool.set_capacity(capacity_blocks);
        pool
    }

    /// Blocks past the new capacity go, least recently used first.
    pub fn set_capacity(&self, capacity_blocks: usize) {
        assert!(capacity_blocks > 0, "capacity must be positive");
        self.capacity_blocks
            .store(capacity_blocks, Ordering::Relaxed);
        self.evict(&mut self.lru.lock().unwrap());
    }

    /// Blocks held now.
    pub fn len(&self) -> usize {
        self.lru.lock().unwrap().1.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn evict(&self, (blocks, order): &mut Lru) {
        while order.len() > self.capacity_blocks.load(Ordering::Relaxed) {
            if let Some(oldest) = order.pop_front() {
                blocks.remove(&oldest);
            }
        }
    }

    fn get(&self, key: BlockKey) -> Option<Arc<Vec<u8>>> {
        let (blocks, order) = &mut *self.lru.lock().unwrap();
        let block = blocks.get(&key)?.clone();
        order.retain(|&k| k != key);
        order.push_back(key);
        Some(block)
    }

    fn insert(&self, key: BlockKey, block: Arc<Vec<u8>>) {
        let lru = &mut *self.lru.lock().unwrap();
        if lru.0.insert(key, block).is_none() {
            lru.1.push_back(key);
            self.evict(lru);
        }
    }

    /// Drops every block of cache `id`.
    fn forget(&self, id: u64) {
        let (blocks, order) = &mut *self.lru.lock().unwrap();
        blocks.retain(|&(cache, _), _| cache != id);
        order.retain(|&(cache, _)| cache != id);
    }
}

/// The next id of a `BlockCache`: each cache has one of its own.
static NEXT_CACHE: AtomicU64 = AtomicU64::new(0);

/// Caches the most recently used blocks of `block_size` bytes (the last block of the source may be short) in a
/// `BlockPool`: one of its own (`new`) or one shared with other caches (`in_pool`).
pub struct BlockCache<S: ByteSource> {
    inner: S,
    block_size: usize,
    id: u64,
    pool: Arc<BlockPool>,
}

impl<S: ByteSource> BlockCache<S> {
    pub fn new(inner: S, block_size: usize, capacity_blocks: usize) -> Self {
        Self::in_pool(inner, block_size, Arc::new(BlockPool::new(capacity_blocks)))
    }

    pub fn in_pool(inner: S, block_size: usize, pool: Arc<BlockPool>) -> Self {
        assert!(block_size > 0, "block size must be positive");
        Self {
            inner,
            block_size,
            id: NEXT_CACHE.fetch_add(1, Ordering::Relaxed),
            pool,
        }
    }

    fn block(&self, index: u64) -> Result<Arc<Vec<u8>>> {
        if let Some(block) = self.pool.get((self.id, index)) {
            return Ok(block);
        }
        // Read outside the lock; a racing reader of the same block inserts identical bytes.
        let start = index * self.block_size as u64;
        let mut block = vec![0u8; (self.inner.len() - start).min(self.block_size as u64) as usize];
        self.inner.read_at(start, &mut block)?;
        let block = Arc::new(block);
        self.pool.insert((self.id, index), block.clone());
        Ok(block)
    }
}

impl<S: ByteSource> Drop for BlockCache<S> {
    fn drop(&mut self) {
        self.pool.forget(self.id);
    }
}

impl<S: ByteSource> ByteSource for BlockCache<S> {
    fn len(&self) -> u64 {
        self.inner.len()
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        let end = match offset.checked_add(buf.len() as u64) {
            Some(end) if end <= self.len() => end,
            _ => return self.inner.read_at(offset, buf), // reports the error with the inner source's name
        };
        let block_size = self.block_size as u64;
        let mut pos = offset;
        while pos < end {
            let index = pos / block_size;
            let block = self.block(index)?;
            let from = (pos - index * block_size) as usize;
            let n = (block.len() - from).min((end - pos) as usize);
            let at = (pos - offset) as usize;
            buf[at..at + n].copy_from_slice(&block[from..from + n]);
            pos += n as u64;
        }
        Ok(())
    }
}

/// The files of one recording, by base name. Readers look files up by name and ignore extra entries.
pub struct FileSet {
    pub primary: String,
    pub files: BTreeMap<String, Arc<dyn ByteSource>>,
}

impl FileSet {
    pub fn source(&self, name: &str) -> Option<&Arc<dyn ByteSource>> {
        self.files.get(name)
    }

    /// The BIDS sidecars of a recording named `<prefix>_<modality>.<ext>`:
    /// `<prefix>_channels.tsv`, `<prefix>_events.tsv` and `<prefix>_<modality>.json`.
    /// `None` when the stem has no `_`.
    pub fn sidecar_names(primary: &str) -> Option<[String; 3]> {
        let stem = Path::new(primary).file_stem()?.to_str()?;
        let (prefix, modality) = stem.rsplit_once('_')?;
        Some([
            format!("{prefix}_channels.tsv"),
            format!("{prefix}_events.tsv"),
            format!("{prefix}_{modality}.json"),
        ])
    }

    /// The primary file plus the siblings in its directory that belong to it:
    /// its `sidecar_names`; for a `.vhdr`, the `DataFile` and `MarkerFile` it names; for a `.set`, the `.fdt` of its
    /// stem.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn from_path(path: &Path) -> Result<FileSet> {
        let primary = path
            .file_name()
            .ok_or_else(|| {
                DDAError::InvalidParameter(format!("not a file path: {}", path.display()))
            })?
            .to_string_lossy()
            .into_owned();
        let mut names = vec![primary.clone()];
        names.extend(Self::sidecar_names(&primary).into_iter().flatten());
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("vhdr"))
        {
            names.extend(vhdr_files(&String::from_utf8_lossy(&std::fs::read(path)?)));
        }
        // An EEGLAB dataset's samples are in the .fdt of its stem, as pop_saveset names it.
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("set"))
        {
            names.extend(
                path.with_extension("fdt")
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned()),
            );
        }

        let dir = path.parent().unwrap_or(Path::new(""));
        let mut files = BTreeMap::new();
        for name in names {
            let sibling = dir.join(&name);
            // The primary must open; siblings are optional.
            if name == primary || sibling.is_file() {
                files.insert(
                    name,
                    Arc::new(MmapSource::open(&sibling)?) as Arc<dyn ByteSource>,
                );
            }
        }
        Ok(FileSet { primary, files })
    }
}

/// Base names of the `DataFile` and `MarkerFile` entries in the `[Common Infos]` section of a `.vhdr`.
#[cfg(not(target_arch = "wasm32"))]
fn vhdr_files(text: &str) -> Vec<String> {
    let mut in_common = false;
    let mut names = Vec::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with(';'))
    {
        if let Some(section) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            in_common = section.trim().eq_ignore_ascii_case("Common Infos");
        } else if let Some((key, value)) = line.split_once('=').filter(|_| in_common) {
            let key = key.trim();
            if key.eq_ignore_ascii_case("DataFile") || key.eq_ignore_ascii_case("MarkerFile") {
                // Keep the base name so a header cannot point outside its directory.
                names.extend(value.trim().rsplit(['/', '\\']).next().map(str::to_string));
            }
        }
    }
    names
}
