//! Writes every extrema tile of a recording's analysis channels, level by level, as
//! `[u32 count]([u32 len][encode_tile bytes])*`: the native oracle the wasm ABI's tiles are compared with.
//! `cargo run --release --example dump_tiles -- <recording> <out>`

use dda_rs::io::{open_recording, FileSet};
use dda_rs::tiles::{bucket_size, encode_tile, level_count, raw_tile, TILE_BUCKETS};
use std::path::Path;

fn main() -> dda_rs::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let [_, recording, out] = args.as_slice() else {
        panic!("usage: dump_tiles <recording> <out>");
    };
    let reader = open_recording(&FileSet::from_path(Path::new(recording))?, None)?;
    let info = reader.info();
    let channels = info.analysis_channels();
    let rows = info.sample_count;
    let mut tiles = Vec::new();
    for level in 0..level_count(rows) {
        let count = rows
            .div_ceil(bucket_size(level))
            .div_ceil(TILE_BUCKETS as u64);
        for index in 0..count {
            let tile = raw_tile(&*reader, &channels, level, index)?;
            tiles.push(encode_tile(&tile, info.raw_type));
        }
    }
    let mut bytes = (tiles.len() as u32).to_le_bytes().to_vec();
    for tile in tiles {
        bytes.extend((tile.len() as u32).to_le_bytes());
        bytes.extend(tile);
    }
    std::fs::write(out, bytes)?;
    Ok(())
}
