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
    /// (TAL onset s, duration s, text), stored in the record that contains the onset.
    pub annotations: Vec<(f64, f64, String)>,
    pub plus_d: bool,
    /// The timekeeping onset of the first record: where sample 0 sits relative to the header start time.
    pub first_onset_s: f64,
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
            first_onset_s: 0.0,
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
            let start = spec.first_onset_s + r as f64 * spec.record_duration_s;
            let mut tal = format!("+{start}\x14\x14\x00").into_bytes();
            for (onset, duration, text) in &spec.annotations {
                let record = ((*onset - spec.first_onset_s) / spec.record_duration_s) as usize;
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

pub struct BrainVisionSpec {
    /// The `.vhdr`, `.eeg` and `.vmrk` are named `<stem>.<ext>`.
    pub stem: String,
    pub labels: Vec<String>,
    /// `INT_16`, `UINT_16`, `INT_32` or `IEEE_FLOAT_32`.
    pub binary_format: &'static str,
    pub vectorized: bool,
    pub rate_hz: f64,
    pub samples: usize,
    /// The resolution text and unit bytes written for every channel.
    pub resolution: String,
    pub unit: Vec<u8>,
    /// `Mk2` onward, each as `<type>,<description>,<position>,<points>,<channel>`; `Mk1` is a `New Segment`.
    pub markers: Vec<String>,
    pub crlf: bool,
    /// Zero bytes after the last complete frame.
    pub tail_bytes: usize,
    pub data_points: Option<usize>,
    pub ascii: bool,
}

impl Default for BrainVisionSpec {
    fn default() -> Self {
        BrainVisionSpec {
            stem: "sub-01_ieeg".into(),
            labels: vec!["Fp1".into(), "Fp2".into(), "Cz".into()],
            binary_format: "INT_16",
            vectorized: false,
            rate_hz: 500.0,
            samples: 600,
            resolution: "0.1".into(),
            unit: "\u{b5}V".as_bytes().to_vec(),
            markers: vec![],
            crlf: false,
            tail_bytes: 0,
            data_points: None,
            ascii: false,
        }
    }
}

/// The value stored for `channel` at `sample`: a ramp in `-1000..=1000`, shifted by 33000 for `UINT_16`
/// (so values pass 32767), times 1000 for `INT_32` and times 0.25 for `IEEE_FLOAT_32`.
pub fn brainvision_stored(spec: &BrainVisionSpec, channel: usize, sample: usize) -> f64 {
    let ramp = ((sample * 37 + channel * 1001) % 2001) as f64 - 1000.0;
    match spec.binary_format {
        "INT_16" => ramp,
        "UINT_16" => ramp + 33000.0,
        "INT_32" => ramp * 1000.0,
        "IEEE_FLOAT_32" => ramp * 0.25,
        other => panic!("unknown BinaryFormat {other}"),
    }
}

/// The `.vhdr`, `.eeg` and `.vmrk` of a recording, as `(name, bytes)`.
pub fn brainvision_files(spec: &BrainVisionSpec) -> Vec<(String, Vec<u8>)> {
    let eol: &[u8] = if spec.crlf { b"\r\n" } else { b"\n" };
    let join = |lines: Vec<Vec<u8>>| -> Vec<u8> {
        lines
            .into_iter()
            .flat_map(|line| line.into_iter().chain(eol.iter().copied()))
            .collect()
    };
    let text = |lines: Vec<String>| -> Vec<Vec<u8>> {
        lines.into_iter().map(String::into_bytes).collect()
    };

    let mut head: Vec<String> = vec![
        "Brain Vision Data Exchange Header File Version 1.0".into(),
        "; comment".into(),
        "[Common Infos]".into(),
        "Codepage=UTF-8".into(),
        format!("DataFile={}.eeg", spec.stem),
        format!("MarkerFile={}.vmrk", spec.stem),
        format!("DataFormat={}", if spec.ascii { "ASCII" } else { "BINARY" }),
        format!(
            "DataOrientation={}",
            if spec.vectorized {
                "VECTORIZED"
            } else {
                "MULTIPLEXED"
            }
        ),
        format!("NumberOfChannels={}", spec.labels.len()),
        format!("SamplingInterval={}", 1e6 / spec.rate_hz),
    ];
    head.extend(spec.data_points.map(|n| format!("DataPoints={n}")));
    if !spec.ascii {
        head.extend([
            "".into(),
            "[Binary Infos]".into(),
            format!("BinaryFormat={}", spec.binary_format),
        ]);
    }
    head.extend(["".into(), "[Channel Infos]".into()]);
    let mut vhdr = text(head);
    for (i, label) in spec.labels.iter().enumerate() {
        let prefix = format!("Ch{}={label},,{},", i + 1, spec.resolution);
        vhdr.push([prefix.as_bytes(), &spec.unit].concat());
    }

    let mut vmrk = vec![
        "Brain Vision Data Exchange Marker File, Version 1.0".to_string(),
        "[Common Infos]".into(),
        format!("DataFile={}.eeg", spec.stem),
        "[Marker Infos]".into(),
        "Mk1=New Segment,,1,1,0,20200101120000000000".into(),
    ];
    vmrk.extend(
        spec.markers
            .iter()
            .enumerate()
            .map(|(i, marker)| format!("Mk{}={marker}", i + 2)),
    );

    let width = spec.labels.len();
    let stored_bytes = |channel, sample| {
        let value = brainvision_stored(spec, channel, sample);
        match spec.binary_format {
            "INT_16" => (value as i16).to_le_bytes().to_vec(),
            "UINT_16" => (value as u16).to_le_bytes().to_vec(),
            "INT_32" => (value as i32).to_le_bytes().to_vec(),
            _ => (value as f32).to_le_bytes().to_vec(),
        }
    };
    // (channel, sample) in file order.
    let order: Vec<(usize, usize)> = if spec.vectorized {
        (0..width)
            .flat_map(|c| (0..spec.samples).map(move |s| (c, s)))
            .collect()
    } else {
        (0..spec.samples)
            .flat_map(|s| (0..width).map(move |c| (c, s)))
            .collect()
    };
    let mut eeg: Vec<u8> = order
        .into_iter()
        .flat_map(|(c, s)| stored_bytes(c, s))
        .collect();
    eeg.resize(eeg.len() + spec.tail_bytes, 0);

    vec![
        (format!("{}.vhdr", spec.stem), join(vhdr)),
        (format!("{}.eeg", spec.stem), eeg),
        (format!("{}.vmrk", spec.stem), join(text(vmrk))),
    ]
}

/// The files of `tests/fixtures`, as `examples/make_fixtures.rs` writes them: an EDF+ with two annotations and a
/// channel at a quarter of the rate, a BDF, a BrainVision triple, a CSV whose time column sets the rate and an EDF
/// of 8 records cut 600 bytes short (7 complete records and a warning).
pub fn fixture_files() -> Vec<(String, Vec<u8>)> {
    let edf = EdfSpec {
        labels: vec!["Fp1".into(), "Fp2".into(), "Resp".into()],
        units: vec!["uV".into(), "uV".into(), "mV".into()],
        rates_per_record: vec![256, 256, 64],
        records: 30,
        seed: 12,
        annotations: vec![
            (2.5, 1.0, "eyes closed".into()),
            (20.0, 0.0, "spike".into()),
        ],
        ..EdfSpec::default()
    };
    let bdf = EdfSpec {
        bdf: true,
        labels: vec!["A1".into(), "A2".into()],
        rates_per_record: vec![512, 512],
        records: 8,
        digital: (-8388608, 8388607),
        physical: (-262144.0, 262143.0),
        seed: 34,
        ..EdfSpec::default()
    };
    let brainvision = BrainVisionSpec {
        stem: "fixture".into(),
        labels: vec!["Fp1".into(), "Fp2".into(), "Cz".into(), "Pz".into()],
        samples: 3000,
        markers: vec!["Stimulus,S  1,1001,1,0".into()],
        ..BrainVisionSpec::default()
    };
    let noise = EdfSpec {
        seed: 56,
        ..EdfSpec::default()
    };
    let mut csv = "time,C3,C4,O1\n".to_string();
    for i in 0..500u64 {
        let values: Vec<String> = (0..3)
            .map(|c| format!("{:.1}", f64::from(digital_value(&noise, c, i)) * 0.1))
            .collect();
        csv += &format!("{:.3},{}\n", i as f64 / 250.0, values.join(","));
    }

    let mut files = vec![
        ("fixture.edf".to_string(), edf_bytes(&edf)),
        ("fixture.bdf".to_string(), edf_bytes(&bdf)),
    ];
    files.extend(brainvision_files(&brainvision));
    files.push(("fixture.csv".to_string(), csv.into_bytes()));
    let mut truncated = edf_bytes(&EdfSpec {
        records: 8,
        seed: 78,
        ..EdfSpec::default()
    });
    truncated.truncate(truncated.len() - 600);
    files.push(("fixture_truncated.edf".to_string(), truncated));
    files
}

pub fn write_fixtures(dir: &std::path::Path) -> std::io::Result<()> {
    for (name, bytes) in fixture_files() {
        std::fs::write(dir.join(name), bytes)?;
    }
    Ok(())
}
