//! Min/max tiles for drawing long recordings: level `L` splits the rows into buckets of
//! `bucket_size(L) = 64 * 4^L` rows and keeps each bucket's per-channel minimum and maximum.
//! Bucket `b` covers rows `[b*B, min((b+1)*B, rows - 1)]` inclusive. Neighbors share one row and the drawn
//! line has no gap. A tile holds up to `TILE_BUCKETS` consecutive buckets; the top level has a single tile.

use crate::error::{DDAError, Result};
use crate::io::{RawType, Reader};
use sha2::{Digest, Sha256};
use std::mem;

pub const BASE_BUCKET: u64 = 64;
pub const FANOUT: u64 = 4;
pub const TILE_BUCKETS: usize = 1024;

const MAGIC: &[u8; 4] = b"DDT1";
const HEADER: usize = 32;
/// The order is the type tag in the tile header.
const RAW_TYPES: [RawType; 5] = [
    RawType::I16,
    RawType::I24,
    RawType::I32,
    RawType::F32,
    RawType::F64,
];
/// Values read from the reader at once while building a tile.
const CHUNK_VALUES: usize = 1 << 18;

/// Rows per bucket at `level`; `level` must be below `level_count` of the recording (from level 29 on the size overflows `u64`).
pub fn bucket_size(level: u32) -> u64 {
    BASE_BUCKET * FANOUT.pow(level)
}

/// The smallest `n` for which level `n - 1` holds all `rows` in one tile.
pub fn level_count(rows: u64) -> u32 {
    let mut n = 1;
    while (TILE_BUCKETS as u64).saturating_mul(bucket_size(n - 1)) < rows {
        n += 1;
    }
    n
}

fn tile_count(rows: u64, level: u32) -> u64 {
    rows.div_ceil(bucket_size(level))
        .div_ceil(TILE_BUCKETS as u64)
}

/// Bucket-major `[buckets][channels]`. A NaN sample is skipped; a bucket of only NaN keeps `(inf, -inf)`.
#[derive(Clone, Debug, PartialEq)]
pub struct Tile {
    pub level: u32,
    pub index: u64,
    pub channels: usize,
    pub buckets: usize,
    pub min: Vec<f32>,
    pub max: Vec<f32>,
}

impl Tile {
    fn fold_row(&mut self, bucket: usize, row: &[f32]) {
        let n = self.channels;
        fold(
            &mut self.min[bucket * n..(bucket + 1) * n],
            &mut self.max[bucket * n..(bucket + 1) * n],
            row,
            row,
        );
    }
}

fn fold(min: &mut [f32], max: &mut [f32], lo: &[f32], hi: &[f32]) {
    for c in 0..min.len() {
        min[c] = min[c].min(lo[c]);
        max[c] = max[c].max(hi[c]);
    }
}

/// Tile `index` of `level`, read straight from the file; the oracle the pyramid must match.
pub fn raw_tile(reader: &dyn Reader, channels: &[usize], level: u32, index: u64) -> Result<Tile> {
    let rows = reader.info().sample_count;
    if channels.is_empty() || level >= level_count(rows) || index >= tile_count(rows, level) {
        return Err(DDAError::InvalidParameter(format!(
            "tile {index} of level {level} does not exist for {} channels and {rows} rows",
            channels.len()
        )));
    }
    let (n, b_size) = (channels.len(), bucket_size(level));
    let first = index * TILE_BUCKETS as u64;
    let buckets = (rows.div_ceil(b_size) - first).min(TILE_BUCKETS as u64) as usize;
    let start = first * b_size;
    let end = (start + buckets as u64 * b_size).min(rows - 1);
    let mut tile = Tile {
        level,
        index,
        channels: n,
        buckets,
        min: vec![f32::INFINITY; buckets * n],
        max: vec![f32::NEG_INFINITY; buckets * n],
    };
    let chunk_rows = (CHUNK_VALUES / n).max(1);
    let mut raw =
        vec![0f32; chunk_rows.min(usize::try_from(end - start + 1).unwrap_or(usize::MAX)) * n];
    let mut row0 = start;
    while row0 <= end {
        let count = (end + 1 - row0).min(chunk_rows as u64) as usize;
        reader.read_raw_f32(channels, row0, count, &mut raw[..count * n])?;
        for (i, row) in raw[..count * n].chunks_exact(n).enumerate() {
            let offset = row0 + i as u64 - start;
            let b = (offset / b_size) as usize;
            if b < buckets {
                tile.fold_row(b, row);
            }
            // The first row of a bucket also ends the one before it.
            if b > 0 && offset.is_multiple_of(b_size) {
                tile.fold_row(b - 1, row);
            }
        }
        row0 += count as u64;
    }
    Ok(tile)
}

struct Level {
    /// The buckets closed so far in the tile being filled.
    tile: Tile,
    /// The bucket being filled: rows at level 0, child buckets above.
    open_min: Vec<f32>,
    open_max: Vec<f32>,
    open_children: u64,
}

/// Builds every level's tiles in one pass over the rows, which arrive in order and in any chunk size.
pub struct PyramidBuilder {
    channels: usize,
    rows: u64,
    seen: u64,
    levels: Vec<Level>,
}

impl PyramidBuilder {
    pub fn new(channels: usize, rows: u64) -> Self {
        assert!(channels > 0, "a pyramid needs at least one channel");
        let levels = (0..level_count(rows))
            .map(|level| Level {
                tile: Tile {
                    level,
                    index: 0,
                    channels,
                    buckets: 0,
                    min: Vec::new(),
                    max: Vec::new(),
                },
                open_min: vec![f32::INFINITY; channels],
                open_max: vec![f32::NEG_INFINITY; channels],
                open_children: 0,
            })
            .collect();
        PyramidBuilder {
            channels,
            rows,
            seen: 0,
            levels,
        }
    }

    /// Feeds the next `rows` rows (`[row][channel]`, as `Reader::read_raw_f32` returns them) and returns the tiles that became full.
    pub fn push_rows(&mut self, raw: &[f32], rows: usize) -> Vec<Tile> {
        assert_eq!(
            raw.len(),
            rows * self.channels,
            "raw must hold rows * channels values"
        );
        assert!(
            self.seen + rows as u64 <= self.rows,
            "more rows than the pyramid was built for"
        );
        let mut done = Vec::new();
        for row in raw.chunks_exact(self.channels) {
            let a = self.seen;
            self.seen += 1;
            let open = &mut self.levels[0];
            // Row `a` is the last row of the bucket before it and the first of its own.
            if a > 0 && a.is_multiple_of(BASE_BUCKET) {
                fold(&mut open.open_min, &mut open.open_max, row, row);
                self.close(0, &mut done);
            }
            let open = &mut self.levels[0];
            fold(&mut open.open_min, &mut open.open_max, row, row);
            if a + 1 == self.rows {
                self.close(0, &mut done);
            }
        }
        done
    }

    /// The partial last tile of each level, after all `rows` rows were pushed.
    pub fn finish(self) -> Vec<Tile> {
        assert_eq!(self.seen, self.rows, "finish before all rows were pushed");
        self.levels
            .into_iter()
            .map(|l| l.tile)
            .filter(|t| t.buckets > 0)
            .collect()
    }

    /// Ends the open bucket of level `l` and feeds it to the parent, which ends its own once it has `FANOUT` children or this was the last bucket.
    fn close(&mut self, l: usize, done: &mut Vec<Tile>) {
        let n = self.channels;
        let b_size = bucket_size(l as u32);
        let level = &mut self.levels[l];
        let lo = mem::replace(&mut level.open_min, vec![f32::INFINITY; n]);
        let hi = mem::replace(&mut level.open_max, vec![f32::NEG_INFINITY; n]);
        level.open_children = 0;
        level.tile.min.extend_from_slice(&lo);
        level.tile.max.extend_from_slice(&hi);
        level.tile.buckets += 1;
        let bucket = level.tile.index * TILE_BUCKETS as u64 + level.tile.buckets as u64 - 1;
        let last = bucket + 1 == self.rows.div_ceil(b_size);
        if level.tile.buckets == TILE_BUCKETS {
            let next = Tile {
                index: level.tile.index + 1,
                buckets: 0,
                min: Vec::new(),
                max: Vec::new(),
                ..level.tile
            };
            done.push(mem::replace(&mut level.tile, next));
        }
        if let Some(parent) = self.levels.get_mut(l + 1) {
            fold(&mut parent.open_min, &mut parent.open_max, &lo, &hi);
            parent.open_children += 1;
            if parent.open_children == FANOUT || last {
                self.close(l + 1, done);
            }
        }
    }
}

fn width(raw_type: RawType) -> usize {
    if raw_type == RawType::I16 {
        2
    } else {
        4
    }
}

/// A 32-byte header (`DDT1`, level u32, index u64, channels u32, buckets u32, type tag u8, zero padding),
/// then every bucket's minimum, then every bucket's maximum, little-endian in the source type.
pub fn encode_tile(tile: &Tile, raw_type: RawType) -> Vec<u8> {
    let tag = RAW_TYPES.iter().position(|&t| t == raw_type).unwrap() as u8;
    let mut out = Vec::with_capacity(HEADER + 2 * tile.min.len() * width(raw_type));
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&tile.level.to_le_bytes());
    out.extend_from_slice(&tile.index.to_le_bytes());
    out.extend_from_slice(&(tile.channels as u32).to_le_bytes());
    out.extend_from_slice(&(tile.buckets as u32).to_le_bytes());
    out.push(tag);
    out.resize(HEADER, 0);
    for &v in tile.min.iter().chain(&tile.max) {
        match raw_type {
            RawType::I16 => out.extend_from_slice(&(v as i16).to_le_bytes()),
            RawType::I24 | RawType::I32 => out.extend_from_slice(&(v as i32).to_le_bytes()),
            RawType::F32 | RawType::F64 => out.extend_from_slice(&v.to_le_bytes()),
        }
    }
    out
}

pub fn decode_tile(bytes: &[u8]) -> Result<Tile> {
    let bad = |what: &str| DDAError::ParseError(format!("tile: {what}"));
    if bytes.len() < HEADER || &bytes[..4] != MAGIC {
        return Err(bad("missing DDT1 header"));
    }
    let u32_at = |at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let raw_type = *RAW_TYPES
        .get(bytes[24] as usize)
        .ok_or_else(|| bad("unknown type tag"))?;
    let (channels, buckets) = (u32_at(16) as usize, u32_at(20) as usize);
    let count = channels.checked_mul(buckets);
    let size = count
        .and_then(|n| n.checked_mul(2 * width(raw_type)))
        .and_then(|n| n.checked_add(HEADER));
    if size != Some(bytes.len()) {
        return Err(bad("length does not match channels and buckets"));
    }
    let values: Vec<f32> = bytes[HEADER..]
        .chunks_exact(width(raw_type))
        .map(|b| match raw_type {
            RawType::I16 => i16::from_le_bytes([b[0], b[1]]) as f32,
            RawType::I24 | RawType::I32 => i32::from_le_bytes(b.try_into().unwrap()) as f32,
            RawType::F32 | RawType::F64 => f32::from_le_bytes(b.try_into().unwrap()),
        })
        .collect();
    let (min, max) = values.split_at(count.unwrap());
    Ok(Tile {
        level: u32_at(4),
        index: u64::from_le_bytes(bytes[8..16].try_into().unwrap()),
        channels,
        buckets,
        min: min.to_vec(),
        max: max.to_vec(),
    })
}

/// Incremental SHA-256 for content hashes.
#[derive(Default)]
pub struct Sha256Stream(Sha256);

impl Sha256Stream {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub fn hex(self) -> String {
        self.0
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }
}
