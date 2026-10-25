use dda_rs::io::{BlockCache, ByteSource, FileSet, MemorySource, MmapSource};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

fn random_bytes(len: usize, seed: u64) -> Vec<u8> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    (0..len).map(|_| rng.gen()).collect()
}

fn read(src: &dyn ByteSource, offset: u64, n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    src.read_at(offset, &mut buf).unwrap();
    buf
}

#[test]
fn memory_source_reads_range() {
    let src = MemorySource(b"abcdef".to_vec());
    let mut buf = [0u8; 3];
    src.read_at(2, &mut buf).unwrap();
    assert_eq!(&buf, b"cde");
    assert_eq!(src.len(), 6);
}

#[test]
fn read_past_end_errors() {
    let src = MemorySource(b"abcdef".to_vec());
    let err = src.read_at(4, &mut [0u8; 3]).unwrap_err().to_string();
    assert!(err.contains("read past end"), "{err}");
    assert!(err.contains("offset 4 + 3 > 6"), "{err}");
    assert!(src.read_at(u64::MAX, &mut [0u8; 3]).is_err());
    src.read_at(6, &mut []).unwrap();
}

#[test]
fn block_cache_matches_inner() {
    // 1 MiB is a whole number of blocks; 10_000 ends in a short block.
    for (len, seed) in [(1usize << 20, 1u64), (10_000, 2)] {
        let data = random_bytes(len, seed);
        let cache = BlockCache::new(MemorySource(data.clone()), 4096, 4);
        assert_eq!(cache.len(), len as u64);
        let mut rng = ChaCha8Rng::seed_from_u64(seed + 100);
        for _ in 0..2000 {
            let offset = rng.gen_range(0..len);
            let n = rng.gen_range(0..=(len - offset).min(20_000));
            assert_eq!(read(&cache, offset as u64, n), &data[offset..offset + n]);
        }
        // spans blocks 0, 1 and 2
        let end = 12_200.min(len);
        assert_eq!(read(&cache, 4000, end - 4000), &data[4000..end]);
        // the last block
        assert_eq!(read(&cache, len as u64 - 10, 10), &data[len - 10..]);
        let err = cache
            .read_at(len as u64 - 10, &mut [0u8; 11])
            .unwrap_err()
            .to_string();
        assert!(err.contains("read past end"), "{err}");
    }
}

struct Counting(MemorySource, Arc<AtomicUsize>);

impl ByteSource for Counting {
    fn len(&self) -> u64 {
        self.0.len()
    }
    fn read_at(&self, offset: u64, buf: &mut [u8]) -> dda_rs::Result<()> {
        self.1.fetch_add(1, Ordering::SeqCst);
        self.0.read_at(offset, buf)
    }
}

#[test]
fn block_cache_evicts_least_recently_used() {
    let reads = Arc::new(AtomicUsize::new(0));
    let cache = BlockCache::new(
        Counting(MemorySource(random_bytes(100, 3)), reads.clone()),
        10,
        2,
    );
    let touch = |block: u64| read(&cache, block * 10, 1);
    let count = || reads.load(Ordering::SeqCst);
    touch(0);
    touch(1);
    assert_eq!(count(), 2);
    touch(0); // hit, makes block 1 the oldest
    assert_eq!(count(), 2);
    touch(2); // evicts block 1
    assert_eq!(count(), 3);
    touch(0); // still cached
    assert_eq!(count(), 3);
    touch(1); // reloaded
    assert_eq!(count(), 4);
}

#[test]
fn mmap_source_matches_file() {
    let data = random_bytes(5000, 4);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("data.bin");
    std::fs::write(&path, &data).unwrap();
    let src = MmapSource::open(&path).unwrap();
    assert_eq!(src.len(), 5000);
    assert_eq!(read(&src, 123, 4000), &data[123..4123]);
    let err = src.read_at(4990, &mut [0u8; 11]).unwrap_err().to_string();
    assert!(err.contains("read past end"), "{err}");

    let empty = dir.path().join("empty.bin");
    std::fs::write(&empty, b"").unwrap();
    assert_eq!(MmapSource::open(&empty).unwrap().len(), 0);
    assert!(MmapSource::open(&dir.path().join("missing.bin")).is_err());
}

#[test]
fn file_set_from_path_collects_bids_siblings() {
    let dir = tempfile::tempdir().unwrap();
    let vhdr = "BrainVision Data Exchange Header File Version 1.0\n\
                ; DataFile=ignored.eeg\n\
                [Common Infos]\n\
                DataFile=sub-01_task-x_ieeg.eeg\n\
                MarkerFile = sub-01_task-x_ieeg.vmrk\n\
                [Binary Infos]\n\
                DataFile=not-in-common-infos.eeg\n";
    for (name, body) in [
        ("sub-01_task-x_ieeg.vhdr", vhdr),
        ("sub-01_task-x_ieeg.eeg", "data"),
        ("sub-01_task-x_ieeg.vmrk", "markers"),
        ("sub-01_task-x_channels.tsv", "name\n"),
        ("sub-01_task-x_events.tsv", "onset\n"),
        ("sub-02_task-x_ieeg.vhdr", vhdr),
        ("sub-02_task-x_channels.tsv", "name\n"),
        ("ignored.eeg", "no"),
        ("not-in-common-infos.eeg", "no"),
    ] {
        std::fs::write(dir.path().join(name), body).unwrap();
    }
    let set = FileSet::from_path(&dir.path().join("sub-01_task-x_ieeg.vhdr")).unwrap();
    assert_eq!(set.primary, "sub-01_task-x_ieeg.vhdr");
    let keys: Vec<&str> = set.files.keys().map(String::as_str).collect();
    assert_eq!(
        keys,
        [
            "sub-01_task-x_channels.tsv",
            "sub-01_task-x_events.tsv",
            "sub-01_task-x_ieeg.eeg",
            "sub-01_task-x_ieeg.vhdr",
            "sub-01_task-x_ieeg.vmrk",
        ]
    );
    assert_eq!(
        read(set.source("sub-01_task-x_ieeg.eeg").unwrap().as_ref(), 0, 4),
        b"data"
    );
    assert!(set.source("sub-02_task-x_ieeg.vhdr").is_none());
}

#[test]
fn file_set_from_path_adds_modality_json_and_needs_the_primary() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
        "sub-01_task-x_eeg.edf",
        "sub-01_task-x_eeg.json",
        "plain.edf",
    ] {
        std::fs::write(dir.path().join(name), "x").unwrap();
    }
    let set = FileSet::from_path(&dir.path().join("sub-01_task-x_eeg.edf")).unwrap();
    assert_eq!(
        set.files.keys().map(String::as_str).collect::<Vec<_>>(),
        ["sub-01_task-x_eeg.edf", "sub-01_task-x_eeg.json"]
    );
    // no `_` in the name: no modality, only the primary
    let set = FileSet::from_path(&dir.path().join("plain.edf")).unwrap();
    assert_eq!(
        set.files.keys().map(String::as_str).collect::<Vec<_>>(),
        ["plain.edf"]
    );
    assert!(FileSet::from_path(&dir.path().join("absent.edf")).is_err());
}
