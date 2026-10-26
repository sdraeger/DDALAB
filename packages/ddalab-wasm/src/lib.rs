//! The `extern "C"` ABI of dda-rs for `wasm32-unknown-unknown`: one single-threaded instance per Web Worker.
//!
//! Buffers cross as `(ptr, len)`. The host writes its inputs into `ddalab_alloc` buffers and frees them after the
//! call. A function returning data returns `(ptr << 32) | len` of a buffer the host copies and frees with
//! `ddalab_free`. JSON replies are `{"ok": ...}` or `{"error": "<message>"}`. A binary reply that failed is that
//! error JSON. Its first eight bytes `{"error"` cannot start a tile (`DDT1`) or a framed reply (a u32 length),
//! and start f32 samples only if the first sample is 4.5e30.
//!
//! Display channels are the analysis channels: the `Signal` channels at the recording rate, in recording order.
//! Request channel indices count in this list. Host imports must not throw or call back into the module: a failed
//! read returns a nonzero status. Ids are never reused: a closed or finished id names nothing.

use dda_rs::blocks::{block_of, plan_blocks, run_block, validate_request};
use dda_rs::document::{build_manifest, bundle_layout, encode_block};
use dda_rs::io::{open_recording, BlockCache, BlockPool, ByteSource, FileSet, Reader};
use dda_rs::tiles::{encode_tile, raw_tile, PyramidBuilder, Sha256Stream, Tile};
use dda_rs::{DDAError, DDARequest, PureRustProgress, Result, VariantMetadata, ENGINE_VERSION};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock, Mutex};

#[link(wasm_import_module = "host")]
extern "C" {
    /// Fills `len` bytes at `ptr` from `offset` of file `file_id`; 0 means it did.
    fn host_read(file_id: u32, offset: f64, ptr: u32, len: u32) -> i32;
    /// Receives a `PureRustProgress` as JSON.
    fn host_progress(ptr: u32, len: u32);
}

/// Values by id. Ids count up from 1 and are never reused; 0 never names a value.
struct Table<T> {
    last: u32,
    items: BTreeMap<u32, T>,
}

impl<T> Table<T> {
    const fn new() -> Self {
        Table {
            last: 0,
            items: BTreeMap::new(),
        }
    }

    fn insert(&mut self, value: T) -> u32 {
        self.last += 1;
        self.items.insert(self.last, value);
        self.last
    }

    fn get(&mut self, id: u32) -> Option<&mut T> {
        self.items.get_mut(&id)
    }

    fn take(&mut self, id: u32) -> Option<T> {
        self.items.remove(&id)
    }
}

struct Pyramid {
    /// The recording handle it was built from; closing the recording drops the pyramid.
    handle: u32,
    reader: Arc<dyn Reader>,
    channels: Vec<usize>,
    builder: PyramidBuilder,
    next_row: u64,
}

static RECORDINGS: Mutex<Table<Arc<dyn Reader>>> = Mutex::new(Table::new());
static PYRAMIDS: Mutex<Table<Pyramid>> = Mutex::new(Table::new());
static HASHES: Mutex<Table<Sha256Stream>> = Mutex::new(Table::new());

fn invalid(message: String) -> DDAError {
    DDAError::InvalidParameter(message)
}

/// A file the host reads.
struct HostFile {
    file_id: u32,
    len: u64,
    name: String,
}

impl ByteSource for HostFile {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        if offset.saturating_add(buf.len() as u64) > self.len {
            return Err(invalid(format!(
                "read past end of {}: offset {offset} + {} > {}",
                self.name,
                buf.len(),
                self.len
            )));
        }
        let status = unsafe {
            host_read(
                self.file_id,
                offset as f64,
                buf.as_mut_ptr() as u32,
                buf.len() as u32,
            )
        };
        match status {
            0 => Ok(()),
            _ => Err(DDAError::IoError(std::io::Error::other(format!(
                "host read failed for {} at offset {offset} (status {status})",
                self.name
            )))),
        }
    }
}

fn reply(bytes: Vec<u8>) -> u64 {
    let len = bytes.len() as u64;
    let ptr = Box::into_raw(bytes.into_boxed_slice()) as *mut u8 as u32 as u64;
    (ptr << 32) | len
}

fn json_reply(result: Result<Value>) -> u64 {
    let value = match result {
        Ok(ok) => json!({ "ok": ok }),
        Err(error) => json!({ "error": error.to_string() }),
    };
    reply(value.to_string().into_bytes())
}

fn binary_reply(result: Result<Vec<u8>>) -> u64 {
    match result {
        Ok(bytes) => reply(bytes),
        Err(error) => json_reply(Err(error)),
    }
}

/// The `len` bytes the host wrote at `ptr`.
unsafe fn input<'a>(ptr: u32, len: u32) -> &'a [u8] {
    match len {
        0 => &[],
        _ => std::slice::from_raw_parts(ptr as *const u8, len as usize),
    }
}

fn parse<'a, T: Deserialize<'a>>(bytes: &'a [u8], what: &str) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|e| invalid(format!("{what} JSON: {e}")))
}

/// `x` as a row or tile index; JavaScript numbers are exact integers up to 2^53.
fn index(x: f64, what: &str) -> Result<u64> {
    match x >= 0.0 && x <= 2f64.powi(53) && x.fract() == 0.0 {
        true => Ok(x as u64),
        false => Err(invalid(format!(
            "{what} {x} is not a whole number in 0..=2^53"
        ))),
    }
}

/// The `rows * channels` values of a read, or an error where their f32 bytes pass isize::MAX (2^31 - 1 on wasm32),
/// which no allocation holds.
fn values(rows: u32, channels: usize) -> Result<usize> {
    let fits = |n: &usize| {
        n.checked_mul(4)
            .is_some_and(|bytes| bytes <= isize::MAX as usize)
    };
    (rows as usize)
        .checked_mul(channels)
        .filter(fits)
        .ok_or_else(|| {
            invalid(format!(
                "{rows} rows of {channels} channels pass this platform's isize::MAX bytes of f32"
            ))
        })
}

fn recording(handle: u32) -> Result<Arc<dyn Reader>> {
    let reader = RECORDINGS.lock().unwrap().get(handle).cloned();
    reader.ok_or_else(|| invalid(format!("no open recording {handle}")))
}

/// The request in `bytes`, checked by `validate_request` against the `n` display channels.
fn request(bytes: &[u8], n: usize) -> Result<DDARequest> {
    let request: DDARequest = parse(bytes, "request")?;
    validate_request(&request, n)?;
    Ok(request)
}

/// `[u32 count]([u32 len][encode_tile bytes])*`.
fn frame(tiles: Vec<Tile>, reader: &dyn Reader) -> Vec<u8> {
    let mut out = (tiles.len() as u32).to_le_bytes().to_vec();
    for tile in tiles {
        let bytes = encode_tile(&tile, reader.info().raw_type);
        out.extend((bytes.len() as u32).to_le_bytes());
        out.extend(bytes);
    }
    out
}

#[no_mangle]
pub extern "C" fn ddalab_alloc(len: u32) -> u32 {
    Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8 as u32
}

/// # Safety
/// `ptr` and `len` must come from `ddalab_alloc` or a reply, freed once.
#[no_mangle]
pub unsafe extern "C" fn ddalab_free(ptr: u32, len: u32) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
        ptr as *mut u8,
        len as usize,
    )));
}

#[no_mangle]
pub extern "C" fn ddalab_version() -> u64 {
    json_reply(Ok(json!({
        "engine_version": ENGINE_VERSION,
        "git_commit": option_env!("DDALAB_GIT_COMMIT"),
        "variants": VariantMetadata::active_variants().collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct OpenRequest {
    primary: String,
    files: Vec<OpenFile>,
    sample_rate_hz: Option<f64>,
    /// MiB of 4 MiB blocks this instance caches for all its open files together: 64 when absent, at least one block.
    /// Each open sets it.
    cache_mb: Option<u32>,
}

#[derive(Deserialize)]
struct OpenFile {
    name: String,
    file_id: u32,
    len: u64,
}

/// The file blocks of every recording this instance holds open, under one capacity: a recording not read for a while
/// gives way to the one being read. A closed recording's blocks go with it.
static BLOCKS: LazyLock<Arc<BlockPool>> = LazyLock::new(|| Arc::new(BlockPool::new(16)));

fn open(bytes: &[u8]) -> Result<Value> {
    let opened: OpenRequest = parse(bytes, "open")?;
    BLOCKS.set_capacity((opened.cache_mb.unwrap_or(64) / 4).max(1) as usize);
    let files = opened.files.into_iter().map(|f| {
        let source = HostFile {
            file_id: f.file_id,
            len: f.len,
            name: f.name.clone(),
        };
        let cached: Arc<dyn ByteSource> =
            Arc::new(BlockCache::in_pool(source, 4 << 20, BLOCKS.clone()));
        (f.name, cached)
    });
    let files = FileSet {
        primary: opened.primary,
        files: files.collect(),
    };
    let reader: Arc<dyn Reader> = open_recording(&files, opened.sample_rate_hz)?.into();
    let info = reader.info();
    let mut reply = json!({ "info": info, "analysis_channels": info.analysis_channels() });
    reply["handle"] = RECORDINGS.lock().unwrap().insert(reader).into();
    Ok(reply)
}

/// # Safety
/// `ptr` and `len` name a buffer the host wrote.
#[no_mangle]
pub unsafe extern "C" fn ddalab_open(ptr: u32, len: u32) -> u64 {
    json_reply(open(input(ptr, len)))
}

/// Also drops the pyramids built from `handle`.
#[no_mangle]
pub extern "C" fn ddalab_close(handle: u32) {
    RECORDINGS.lock().unwrap().take(handle);
    let mut pyramids = PYRAMIDS.lock().unwrap();
    pyramids.items.retain(|_, pyramid| pyramid.handle != handle);
}

#[no_mangle]
pub extern "C" fn ddalab_annotations(handle: u32) -> u64 {
    json_reply(recording(handle).and_then(|reader| {
        let (annotations, warnings) = reader.scan_annotations()?;
        Ok(json!({ "annotations": annotations, "warnings": warnings }))
    }))
}

#[no_mangle]
pub extern "C" fn ddalab_raw_tile(handle: u32, level: u32, tile: f64) -> u64 {
    binary_reply((|| {
        let reader = recording(handle)?;
        let info = reader.info();
        let tile = raw_tile(
            &*reader,
            &info.analysis_channels(),
            level,
            index(tile, "tile index")?,
        )?;
        Ok(encode_tile(&tile, info.raw_type))
    })())
}

#[no_mangle]
pub extern "C" fn ddalab_read_raw(handle: u32, row0: f64, rows: u32) -> u64 {
    binary_reply((|| {
        let reader = recording(handle)?;
        let info = reader.info();
        let channels = info.analysis_channels();
        let row0 = index(row0, "row0")?;
        // Checked here so a bad range cannot size the buffer.
        if row0.saturating_add(rows.into()) > info.sample_count {
            return Err(invalid(format!(
                "rows {row0}..{row0}+{rows} pass the {} rows of the recording",
                info.sample_count
            )));
        }
        let mut out = vec![0f32; values(rows, channels.len())?];
        reader.read_raw_f32(&channels, row0, rows as usize, &mut out)?;
        Ok(out.iter().flat_map(|v| v.to_le_bytes()).collect())
    })())
}

fn plan(handle: u32, request_json: &[u8], budget_mb: u32) -> Result<Value> {
    let reader = recording(handle)?;
    let info = reader.info();
    let n = info.analysis_channels().len();
    let request = request(request_json, n)?;
    let budget = usize::try_from(u64::from(budget_mb) << 20).unwrap_or(usize::MAX);
    let blocks = plan_blocks(&request, info, budget)?;
    let windows = blocks.last().map_or(0, |block| block.w1);
    let layout = bundle_layout(&request, info, windows)?;
    Ok(json!({ "blocks": blocks, "layout": layout, "windows": windows }))
}

/// # Safety
/// `req_ptr` and `req_len` name a buffer the host wrote.
#[no_mangle]
pub unsafe extern "C" fn ddalab_plan(
    handle: u32,
    req_ptr: u32,
    req_len: u32,
    budget_mb: u32,
) -> u64 {
    json_reply(plan(handle, input(req_ptr, req_len), budget_mb))
}

/// Calls `host_progress` on every `max(total_steps / 100, 1)`th step.
fn report_progress(p: &PureRustProgress) {
    if p.step_index.is_multiple_of((p.total_steps / 100).max(1)) {
        let json = serde_json::to_vec(p).unwrap_or_default();
        unsafe { host_progress(json.as_ptr() as u32, json.len() as u32) };
    }
}

fn run(handle: u32, request_json: &[u8], w0: u32, w1: u32) -> Result<Vec<u8>> {
    let reader = recording(handle)?;
    let info = reader.info();
    let n = info.analysis_channels().len();
    let request = request(request_json, n)?;
    // The last block of any plan ends at the request's window count.
    let windows = plan_blocks(&request, info, usize::MAX)?
        .last()
        .map_or(0, |block| block.w1);
    let block = block_of(&request, info.sample_count, w0 as usize, w1 as usize)?;
    let result = run_block(&*reader, &request, &block, Some(&mut report_progress))?;
    let chunks = encode_block(&bundle_layout(&request, info, windows)?, &block, &result);
    let header = json!({ "chunks": chunks
        .iter()
        .map(|(array, offset, bytes)| json!({ "array": array, "offset": offset, "len": bytes.len() }))
        .collect::<Vec<_>>() })
    .to_string();
    let mut out = (header.len() as u32).to_le_bytes().to_vec();
    out.extend(header.into_bytes());
    for (_, _, bytes) in chunks {
        out.extend(bytes);
    }
    Ok(out)
}

/// `[u32 header_len][header JSON {"chunks":[{"array","offset","len"}]}][chunk bytes...]`: the block's bytes of
/// each bundle array and their file offsets. Progress numbers windows and steps within the block.
///
/// # Safety
/// `req_ptr` and `req_len` name a buffer the host wrote.
#[no_mangle]
pub unsafe extern "C" fn ddalab_run_block(
    handle: u32,
    req_ptr: u32,
    req_len: u32,
    w0: u32,
    w1: u32,
) -> u64 {
    binary_reply(run(handle, input(req_ptr, req_len), w0, w1))
}

#[derive(Deserialize)]
struct Extras {
    id: String,
    created_at_iso: String,
    input_sha256: BTreeMap<String, String>,
    windows: usize,
}

fn manifest(handle: u32, request_json: &[u8], extras: &[u8]) -> Result<Value> {
    let reader = recording(handle)?;
    let info = reader.info();
    let request = request(request_json, info.analysis_channels().len())?;
    let extras: Extras = parse(extras, "extras")?;
    let layout = bundle_layout(&request, info, extras.windows)?;
    let document = build_manifest(
        info,
        &request,
        &layout,
        extras.windows,
        extras.input_sha256,
        extras.id,
        extras.created_at_iso,
    );
    serde_json::to_value(document).map_err(|e| invalid(e.to_string()))
}

/// # Safety
/// Both `(ptr, len)` pairs name buffers the host wrote.
#[no_mangle]
pub unsafe extern "C" fn ddalab_manifest(
    handle: u32,
    req_ptr: u32,
    req_len: u32,
    extras_ptr: u32,
    extras_len: u32,
) -> u64 {
    let extras = input(extras_ptr, extras_len);
    json_reply(manifest(handle, input(req_ptr, req_len), extras))
}

#[no_mangle]
pub extern "C" fn ddalab_sha256_new() -> u32 {
    HASHES.lock().unwrap().insert(Sha256Stream::new())
}

/// `{"ok":null}`, or an error for an unknown or finished `id`.
///
/// # Safety
/// `ptr` and `len` name a buffer the host wrote.
#[no_mangle]
pub unsafe extern "C" fn ddalab_sha256_update(id: u32, ptr: u32, len: u32) -> u64 {
    let mut hashes = HASHES.lock().unwrap();
    json_reply(match hashes.get(id) {
        Some(hash) => {
            hash.update(input(ptr, len));
            Ok(Value::Null)
        }
        None => Err(invalid(format!("no hash {id}"))),
    })
}

/// `{"ok":"<hex>"}`; the stream ends.
#[no_mangle]
pub extern "C" fn ddalab_sha256_hex(id: u32) -> u64 {
    let hash = HASHES.lock().unwrap().take(id);
    json_reply(match hash {
        Some(hash) => Ok(hash.hex().into()),
        None => Err(invalid(format!("no hash {id}"))),
    })
}

/// 0 when `handle` is not open or the recording has no display channel.
#[no_mangle]
pub extern "C" fn ddalab_pyramid_new(handle: u32) -> u32 {
    let Ok(reader) = recording(handle) else {
        return 0;
    };
    let channels = reader.info().analysis_channels();
    if channels.is_empty() {
        return 0;
    }
    let builder = PyramidBuilder::new(channels.len(), reader.info().sample_count);
    PYRAMIDS.lock().unwrap().insert(Pyramid {
        handle,
        reader,
        channels,
        builder,
        next_row: 0,
    })
}

/// The pyramid `id` when `row0..row0 + rows` are the rows it expects next.
fn expecting(pyramids: &mut Table<Pyramid>, id: u32, row0: u64, rows: u32) -> Result<&mut Pyramid> {
    let pyramid = pyramids
        .get(id)
        .ok_or_else(|| invalid(format!("no pyramid {id}")))?;
    let total = pyramid.reader.info().sample_count;
    if row0 != pyramid.next_row || row0.saturating_add(rows.into()) > total {
        return Err(invalid(format!(
            "pyramid {id} expects rows from {} of {total}, got {row0}..{row0}+{rows}",
            pyramid.next_row
        )));
    }
    Ok(pyramid)
}

/// Reads rows `row0..row0 + rows`, which must follow the rows pushed before, and returns the tiles they completed.
#[no_mangle]
pub extern "C" fn ddalab_pyramid_push(id: u32, row0: f64, rows: u32) -> u64 {
    binary_reply((|| {
        let row0 = index(row0, "row0")?;
        // The read runs outside the lock.
        let (reader, channels) = {
            let mut pyramids = PYRAMIDS.lock().unwrap();
            let pyramid = expecting(&mut pyramids, id, row0, rows)?;
            (pyramid.reader.clone(), pyramid.channels.clone())
        };
        let mut raw = vec![0f32; values(rows, channels.len())?];
        reader.read_raw_f32(&channels, row0, rows as usize, &mut raw)?;
        let mut pyramids = PYRAMIDS.lock().unwrap();
        let pyramid = expecting(&mut pyramids, id, row0, rows)?;
        let tiles = pyramid.builder.push_rows(&raw, rows as usize);
        pyramid.next_row += u64::from(rows);
        Ok(frame(tiles, &*reader))
    })())
}

/// Ends pyramid `id` without its last tiles.
#[no_mangle]
pub extern "C" fn ddalab_pyramid_drop(id: u32) {
    PYRAMIDS.lock().unwrap().take(id);
}

/// The partial last tile of each level, once every row was pushed; the pyramid ends.
#[no_mangle]
pub extern "C" fn ddalab_pyramid_finish(id: u32) -> u64 {
    binary_reply((|| {
        let mut pyramids = PYRAMIDS.lock().unwrap();
        let pyramid = pyramids
            .get(id)
            .ok_or_else(|| invalid(format!("no pyramid {id}")))?;
        let total = pyramid.reader.info().sample_count;
        if pyramid.next_row != total {
            return Err(invalid(format!(
                "pyramid {id} still expects rows {}..{total}",
                pyramid.next_row
            )));
        }
        let pyramid = pyramids.take(id).unwrap();
        Ok(frame(pyramid.builder.finish(), &*pyramid.reader))
    })())
}
