//! The heap `open_ascii` holds at its peak. A binary of its own: the counting allocator sees every allocation of the
//! process, and one test keeps others from allocating meanwhile.
mod support;

use dda_rs::io::open_ascii;
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use support::memory_file_set;

/// Counts live heap bytes and their high-water mark. A reallocation counts as a new allocation before the old one
/// is freed, as a copying allocator (wasm32's) holds both.
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let live = LIVE.fetch_add(layout.size(), SeqCst) + layout.size();
        PEAK.fetch_max(live, SeqCst);
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), SeqCst);
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

#[test]
fn open_ascii_peak_near_file_size() {
    // 200,000 rows of a time column and 8 channels at about 9 bytes a cell: 8 bytes a value is about the file's size.
    let (rows, channels) = (200_000, 8);
    let cell = |i: usize, c: usize| {
        format!(
            "{:.3}",
            ((i * 37 + c * 1001) % 20001) as f64 / 10.0 - 1000.0
        )
    };
    let mut text = String::from("time,c1,c2,c3,c4,c5,c6,c7,c8\n");
    for i in 0..rows {
        let values: Vec<String> = (0..channels).map(|c| cell(i, c)).collect();
        text += &format!("{:.4},{}\n", i as f64 / 250.0, values.join(","));
    }
    let size = text.len();
    let files = memory_file_set("big.csv", text.into_bytes());

    let before = LIVE.load(SeqCst);
    PEAK.store(before, SeqCst);
    let reader = open_ascii(&files, "big.csv", None).unwrap();
    let peak = PEAK.load(SeqCst) - before;

    let info = reader.info();
    assert_eq!(info.sample_count, rows as u64);
    assert_eq!(info.channels.len(), channels);
    assert_eq!(info.sample_rate_hz, 250.0);
    // Lines cross the 1 MiB reads of the parse.
    let all: Vec<usize> = (0..channels).collect();
    for (i, row) in reader.read_rows(&all, 0, rows).unwrap().iter().enumerate() {
        let want: Vec<f64> = all.iter().map(|&c| cell(i, c).parse().unwrap()).collect();
        assert_eq!(*row, want, "row {i}");
    }
    let data = rows * (channels + 1) * 8;
    assert!(
        peak <= size + size / 4,
        "peak {peak} bytes for a {size}-byte file holding {data} bytes of samples"
    );
}
