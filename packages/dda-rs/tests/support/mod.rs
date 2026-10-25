//! Fixture writers shared by the integration tests; each test binary uses a subset.
#![allow(dead_code)]

use dda_rs::io::{ByteSource, FileSet, MemorySource};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

pub struct EdfSpec {
    pub bdf: bool,
    /// One entry per signal; the annotation channel follows them when `annotations` is not empty or `plus_d` is set.
    pub labels: Vec<String>,
    pub units: Vec<String>,
    pub rates_per_record: Vec<usize>,
    pub record_duration_s: f64,
    pub records: usize,
    pub digital: (i32, i32),
    pub physical: (f64, f64),
    pub seed: u64,
    /// (onset s, duration s, text), stored in the record that contains the onset.
    pub annotations: Vec<(f64, f64, String)>,
    pub plus_d: bool,
}

impl Default for EdfSpec {
    fn default() -> Self {
        EdfSpec {
            bdf: false,
            labels: vec!["Fp1".into(), "Fp2".into()],
            units: vec!["uV".into(), "uV".into()],
            rates_per_record: vec![256, 256],
            record_duration_s: 1.0,
            records: 4,
            digital: (-32768, 32767),
            physical: (-3276.8, 3276.7),
            seed: 1,
            annotations: vec![],
            plus_d: false,
        }
    }
}

fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

/// Digital sample `sample` of signal `channel`. Samples 0 and 1 are the digital minimum and maximum;
/// the rest are a ramp of slope `3 * (channel + 1)` from mid-range plus seeded noise of at most 8 counts, wrapped into the digital range.
pub fn digital_value(spec: &EdfSpec, channel: usize, sample: u64) -> i32 {
    let (dmin, dmax) = spec.digital;
    match sample {
        0 => return dmin,
        1 => return dmax,
        _ => {}
    }
    let span = dmax as i64 - dmin as i64 + 1;
    let noise = (splitmix64(spec.seed ^ ((channel as u64) << 48) ^ sample) % 17) as i64 - 8;
    let ramp = span / 2 + sample as i64 * 3 * (channel as i64 + 1) + noise;
    (dmin as i64 + ramp.rem_euclid(span)) as i32
}

fn put(buf: &mut Vec<u8>, text: &str, width: usize) {
    assert!(
        text.len() <= width,
        "{text:?} does not fit in {width} bytes"
    );
    buf.extend_from_slice(text.as_bytes());
    buf.resize(buf.len() + width - text.len(), b' ');
}

/// An EDF, EDF+, BDF or BDF+ file holding `digital_value` samples.
pub fn edf_bytes(spec: &EdfSpec) -> Vec<u8> {
    let bps = if spec.bdf { 3 } else { 2 };
    let plus = !spec.annotations.is_empty() || spec.plus_d;
    // Per record: the timekeeping TAL, then the TALs of the annotations that start in it.
    let tals: Vec<Vec<u8>> = (0..spec.records)
        .map(|r| {
            let mut tal =
                format!("+{}\x14\x14\x00", r as f64 * spec.record_duration_s).into_bytes();
            for (onset, duration, text) in &spec.annotations {
                let record = (*onset / spec.record_duration_s) as usize;
                if record.min(spec.records - 1) == r {
                    let duration = if *duration > 0.0 {
                        format!("\x15{duration}")
                    } else {
                        String::new()
                    };
                    tal.extend(format!("+{onset}{duration}\x14{text}\x14\x00").into_bytes());
                }
            }
            tal
        })
        .collect();
    let ann_spr = tals.iter().map(Vec::len).max().unwrap_or(0).div_ceil(bps);

    let mut labels = spec.labels.clone();
    let mut units = spec.units.clone();
    let mut sprs = spec.rates_per_record.clone();
    let ((dmin, dmax), (pmin, pmax)) = (spec.digital, spec.physical);
    let mut ranges = vec![(dmin, dmax, pmin, pmax); labels.len()];
    if plus {
        let full = if spec.bdf {
            (-8388608, 8388607)
        } else {
            (-32768, 32767)
        };
        labels.push(
            if spec.bdf {
                "BDF Annotations"
            } else {
                "EDF Annotations"
            }
            .into(),
        );
        units.push(String::new());
        sprs.push(ann_spr);
        ranges.push((full.0, full.1, -1.0, 1.0));
    }
    let ns = labels.len();

    let mut out = Vec::new();
    if spec.bdf {
        out.push(0xFF);
        put(&mut out, "BIOSEMI", 7);
    } else {
        put(&mut out, "0", 8);
    }
    put(&mut out, "X X X X", 80);
    put(&mut out, "Startdate 01-JAN-2020 X X X", 80);
    put(&mut out, "01.01.20", 8);
    put(&mut out, "00.00.00", 8);
    put(&mut out, &(256 * (ns + 1)).to_string(), 8);
    let prefix = if spec.bdf { "BDF" } else { "EDF" };
    let reserved = match (plus, spec.plus_d, spec.bdf) {
        (true, true, _) => format!("{prefix}+D"),
        (true, false, _) => format!("{prefix}+C"),
        (false, _, true) => "24BIT".to_string(),
        (false, _, false) => String::new(),
    };
    put(&mut out, &reserved, 44);
    put(&mut out, &spec.records.to_string(), 8);
    put(&mut out, &spec.record_duration_s.to_string(), 8);
    put(&mut out, &ns.to_string(), 4);
    for (width, column) in [
        (16, labels),
        (80, vec![String::new(); ns]),
        (8, units),
        (8, ranges.iter().map(|r| r.2.to_string()).collect()),
        (8, ranges.iter().map(|r| r.3.to_string()).collect()),
        (8, ranges.iter().map(|r| r.0.to_string()).collect()),
        (8, ranges.iter().map(|r| r.1.to_string()).collect()),
        (80, vec![String::new(); ns]),
        (8, sprs.iter().map(usize::to_string).collect()),
        (32, vec![String::new(); ns]),
    ] {
        for cell in &column {
            put(&mut out, cell, width);
        }
    }

    for r in 0..spec.records {
        for (c, &spr) in spec.rates_per_record.iter().enumerate() {
            for j in 0..spr {
                let value = digital_value(spec, c, (r * spr + j) as u64);
                out.extend_from_slice(&value.to_le_bytes()[..bps]);
            }
        }
        if plus {
            out.extend_from_slice(&tals[r]);
            out.resize(out.len() + ann_spr * bps - tals[r].len(), 0);
        }
    }
    out
}

/// A `MemorySource` that counts its `read_at` calls.
pub struct CountingSource(pub MemorySource, pub Arc<AtomicUsize>);

impl ByteSource for CountingSource {
    fn len(&self) -> u64 {
        self.0.len()
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> dda_rs::Result<()> {
        self.1.fetch_add(1, Ordering::SeqCst);
        self.0.read_at(offset, buf)
    }
}

/// A file set holding `bytes` as `name`, and the counter of reads through it.
pub fn counting_file_set(name: &str, bytes: Vec<u8>) -> (FileSet, Arc<AtomicUsize>) {
    let reads = Arc::new(AtomicUsize::new(0));
    let source = CountingSource(MemorySource(bytes), reads.clone());
    let files = FileSet {
        primary: name.to_string(),
        files: BTreeMap::from([(name.to_string(), Arc::new(source) as Arc<dyn ByteSource>)]),
    };
    (files, reads)
}

pub fn memory_file_set(name: &str, bytes: Vec<u8>) -> FileSet {
    FileSet {
        primary: name.to_string(),
        files: BTreeMap::from([(
            name.to_string(),
            Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>,
        )]),
    }
}
