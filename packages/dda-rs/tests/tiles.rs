mod support;

use dda_rs::io::{open_edf, ChannelInfo, ChannelKind, RawType, Reader, RecordingInfo};
use dda_rs::tiles::*;
use dda_rs::Result;
use support::{edf_bytes, memory_file_set, EdfSpec};

/// Row-major `[row][channel]` raw values behind the `Reader` interface.
struct Samples {
    info: RecordingInfo,
    values: Vec<f32>,
}

impl Samples {
    fn new(channels: usize, values: Vec<f32>) -> Self {
        let channel = ChannelInfo {
            label: "x".into(),
            unit: "V".into(),
            sample_rate_hz: 100.0,
            gain: 1.0,
            offset: 0.0,
            kind: ChannelKind::Signal,
            bids_status: None,
            bids_type: None,
        };
        let rows = (values.len() / channels) as u64;
        let info = RecordingInfo {
            format: "test".into(),
            channels: vec![channel; channels],
            sample_rate_hz: 100.0,
            sample_count: rows,
            duration_s: rows as f64 / 100.0,
            raw_type: RawType::F32,
            annotations: vec![],
            warnings: vec![],
            input_files: vec![],
        };
        Samples { info, values }
    }

    /// Seeded noise with a fraction. Min and max differ per bucket and per channel.
    fn noise(channels: usize, rows: usize) -> Self {
        let mut x = 0x9E37_79B9_7F4A_7C15u64;
        let values = (0..rows * channels)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                (x % 20001) as f32 / 10.0 - 1000.0
            })
            .collect();
        Samples::new(channels, values)
    }
}

impl Reader for Samples {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, _: &[usize], _: u64, _: usize) -> Result<Vec<Vec<f64>>> {
        unimplemented!()
    }

    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()> {
        let n = self.info.channels.len();
        for r in 0..rows {
            for (k, &c) in channels.iter().enumerate() {
                out[r * channels.len() + k] = self.values[(row0 as usize + r) * n + c];
            }
        }
        Ok(())
    }
}

/// Min and max of `reader`'s channel `channel` over the rows `lo..=hi`.
fn extrema(reader: &dyn Reader, channel: usize, lo: u64, hi: u64) -> (f32, f32) {
    let mut out = vec![0f32; (hi - lo + 1) as usize];
    reader
        .read_raw_f32(&[channel], lo, out.len(), &mut out)
        .unwrap();
    out.iter()
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(a, b), &v| {
            (a.min(v), b.max(v))
        })
}

/// Asserts every bucket of `tile` equals the extrema over its inclusive row range.
fn assert_matches_brute_force(reader: &dyn Reader, channels: &[usize], tile: &Tile) {
    let rows = reader.info().sample_count;
    let b_size = bucket_size(tile.level);
    for b in 0..tile.buckets {
        let first = (tile.index * TILE_BUCKETS as u64 + b as u64) * b_size;
        let last = (first + b_size).min(rows - 1);
        for (k, &c) in channels.iter().enumerate() {
            let want = extrema(reader, c, first, last);
            let got = (
                tile.min[b * channels.len() + k],
                tile.max[b * channels.len() + k],
            );
            assert_eq!(
                got, want,
                "level {} tile {} bucket {b} channel {c}",
                tile.level, tile.index
            );
        }
    }
}

fn open_edf_fixture(spec: &EdfSpec) -> Box<dyn Reader> {
    open_edf(&memory_file_set("rec.edf", edf_bytes(spec)), "rec.edf").unwrap()
}

#[test]
fn bucket_overlaps_next_first_row() {
    let values = (0..130).map(|r| if r < 64 { 0.0 } else { 100.0 }).collect();
    let reader = Samples::new(1, values);
    let tile = raw_tile(&reader, &[0], 0, 0).unwrap();
    assert_eq!(tile.buckets, 3);
    assert_eq!((tile.min[0], tile.max[0]), (0.0, 100.0));
    assert_eq!((tile.min[1], tile.max[1]), (100.0, 100.0));
}

#[test]
fn raw_tile_matches_brute_force() {
    // 81920 rows: two tiles at level 0 (1280 buckets), one at level 1. 300000 rows: five, two and one tiles at levels 0 to 2.
    let spec = EdfSpec {
        rates_per_record: vec![8192; 2],
        records: 10,
        ..EdfSpec::default()
    };
    let readers: [(Box<dyn Reader>, u32); 2] = [
        (open_edf_fixture(&spec), 2),
        (Box::new(Samples::noise(2, 300_000)), 3),
    ];
    for (reader, levels) in readers {
        let rows = reader.info().sample_count;
        assert_eq!(level_count(rows), levels);
        for level in 0..levels {
            for index in 0..rows
                .div_ceil(bucket_size(level))
                .div_ceil(TILE_BUCKETS as u64)
            {
                let tile = raw_tile(reader.as_ref(), &[1, 0], level, index).unwrap();
                assert_eq!((tile.level, tile.index, tile.channels), (level, index, 2));
                assert_matches_brute_force(reader.as_ref(), &[1, 0], &tile);
            }
        }
        let tiles_at_top = rows
            .div_ceil(bucket_size(levels - 1))
            .div_ceil(TILE_BUCKETS as u64);
        assert_eq!(tiles_at_top, 1);
        assert!(raw_tile(reader.as_ref(), &[0], levels, 0).is_err());
        assert!(raw_tile(reader.as_ref(), &[0], 0, 5).is_err());
        assert!(raw_tile(reader.as_ref(), &[], 0, 0).is_err());
    }
}

#[test]
fn pyramid_equals_raw_tiles() {
    let channels = 3;
    for rows in [
        1u64,
        64,
        65,
        1000,
        64 * 1024,
        64 * 1024 + 1,
        64 * 1024 * 4 + 5000,
    ] {
        let reader = Samples::noise(channels, rows as usize);
        let all: Vec<usize> = (0..channels).collect();
        let mut builder = PyramidBuilder::new(channels, rows);
        let mut tiles = Vec::new();
        let mut raw = vec![0f32; 777 * channels];
        for row0 in (0..rows).step_by(777) {
            let n = (rows - row0).min(777) as usize;
            reader
                .read_raw_f32(&all, row0, n, &mut raw[..n * channels])
                .unwrap();
            tiles.extend(builder.push_rows(&raw[..n * channels], n));
        }
        tiles.extend(builder.finish());
        let mut want = 0;
        for level in 0..level_count(rows) {
            let count = rows
                .div_ceil(bucket_size(level))
                .div_ceil(TILE_BUCKETS as u64);
            want += count;
            for index in 0..count {
                let got = tiles
                    .iter()
                    .filter(|t| (t.level, t.index) == (level, index))
                    .collect::<Vec<_>>();
                assert_eq!(got.len(), 1, "rows {rows} level {level} tile {index}");
                assert_eq!(
                    *got[0],
                    raw_tile(&reader, &all, level, index).unwrap(),
                    "rows {rows} level {level} tile {index}"
                );
            }
        }
        assert_eq!(tiles.len() as u64, want, "rows {rows}");
    }
}

#[test]
fn last_tile_partial() {
    let reader = Samples::noise(1, 1000);
    let tile = raw_tile(&reader, &[0], 0, 0).unwrap();
    assert_eq!(tile.buckets, 16);
    assert_eq!((tile.min.len(), tile.max.len()), (16, 16));
    assert_matches_brute_force(&reader, &[0], &tile);
    // One row past a bucket boundary: the last bucket is that single row.
    let reader = Samples::noise(1, 65);
    let tile = raw_tile(&reader, &[0], 0, 0).unwrap();
    assert_eq!(tile.buckets, 2);
    assert_eq!(
        (tile.min[1], tile.max[1]),
        (reader.values[64], reader.values[64])
    );
}

#[test]
fn encode_decode_round_trip_i16() {
    let spec = EdfSpec {
        rates_per_record: vec![1000; 2],
        records: 3,
        ..EdfSpec::default()
    };
    let reader = open_edf_fixture(&spec);
    let tile = raw_tile(reader.as_ref(), &[0, 1], 0, 0).unwrap();
    let bytes = encode_tile(&tile, RawType::I16);
    assert_eq!(&bytes[..4], b"DDT1");
    assert_eq!(bytes.len(), 32 + 2 * tile.buckets * 2 * 2);
    assert_eq!(decode_tile(&bytes).unwrap(), tile);
}

#[test]
fn encode_decode_round_trip_every_type() {
    let integers = Tile {
        level: 2,
        index: 7,
        channels: 2,
        buckets: 2,
        min: vec![-8_000_000.0, -1.0, 0.0, 5.0],
        max: vec![3.0, 8_388_607.0, 9.0, 12.0],
    };
    let fractions = Tile {
        min: vec![-0.125, 1e-3, f32::MIN, 0.5],
        max: vec![1.5, 3e9, f32::MAX, 0.75],
        ..integers.clone()
    };
    for raw_type in [RawType::I24, RawType::I32] {
        assert_eq!(
            decode_tile(&encode_tile(&integers, raw_type)).unwrap(),
            integers
        );
    }
    for raw_type in [RawType::F32, RawType::F64] {
        assert_eq!(
            decode_tile(&encode_tile(&fractions, raw_type)).unwrap(),
            fractions
        );
    }
}

#[test]
fn decode_rejects_malformed() {
    let tile = Tile {
        level: 0,
        index: 0,
        channels: 1,
        buckets: 1,
        min: vec![1.0],
        max: vec![2.0],
    };
    let good = encode_tile(&tile, RawType::I16);
    assert!(decode_tile(&good[..good.len() - 1]).is_err());
    assert!(decode_tile(&good[..16]).is_err());
    let mut bad = good.clone();
    bad[0] = b'X';
    assert!(decode_tile(&bad).is_err());
    let mut bad = good.clone();
    bad[24] = 9;
    assert!(decode_tile(&bad).is_err());
    let mut bad = good;
    bad[16..24].fill(0xFF);
    assert!(decode_tile(&bad).is_err());
}

#[test]
fn level_count_small_and_large() {
    assert_eq!(level_count(1), 1);
    assert_eq!(level_count(64 * 1024), 1);
    assert_eq!(level_count(64 * 1024 + 1), 2);
    assert_eq!(level_count(64 * 1024 * 4), 2);
    assert_eq!(level_count(64 * 1024 * 4 + 1), 3);
    assert_eq!(bucket_size(0), 64);
    assert_eq!(bucket_size(3), 64 * 64);
}

#[test]
fn sha256_known_vector() {
    let mut hash = Sha256Stream::new();
    hash.update(b"a");
    hash.update(b"bc");
    assert_eq!(
        hash.hex(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
