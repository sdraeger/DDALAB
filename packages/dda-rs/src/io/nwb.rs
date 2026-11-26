//! Pure-Rust NWB 2.x (`.nwb` / HDF5) reader over `ByteSource` with zero C dependencies.
//!
//! Implements a focused HDF5 reader (superblock v0–v3, object headers v1–v2 with continuations,
//! v1 symbol-table groups and v2 compact link groups, contiguous/compact/chunked datasets via
//! B-tree v1 / single-chunk / implicit indexing, and Deflate + Shuffle + Fletcher32 filters via
//! `miniz_oxide`) to open NWB `ElectricalSeries` recordings directly in native CLI, Python, and
//! browser WebAssembly builds.

use super::recording::*;
use super::{ByteSource, FileSet};
use crate::error::{DDAError, Result};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

const HDF5_SIGNATURE: [u8; 8] = [0x89, b'H', b'D', b'F', b'\r', b'\n', 0x1a, b'\n'];
const UNDEF_ADDR_64: u64 = u64::MAX;
const UNDEF_ADDR_32: u64 = u32::MAX as u64;

// Object header message types.
const MSG_DATASPACE: u16 = 0x0001;
const MSG_DATATYPE: u16 = 0x0003;
const MSG_LINK: u16 = 0x0006;
const MSG_DATA_LAYOUT: u16 = 0x0008;
const MSG_FILTER_PIPELINE: u16 = 0x000B;
const MSG_ATTRIBUTE: u16 = 0x000C;
const MSG_CONTINUATION: u16 = 0x0010;
const MSG_SYMBOL_TABLE: u16 = 0x0011;

// HDF5 filter IDs.
const FILTER_DEFLATE: u16 = 1;
const FILTER_SHUFFLE: u16 = 2;
const FILTER_FLETCHER32: u16 = 3;

const MAX_CHUNK_CACHE: usize = 8;

fn malformed(msg: impl Into<String>) -> DDAError {
    DDAError::ParseError(msg.into())
}

fn nwb_si_unit(unit: &str) -> (&str, f64) {
    match unit.trim().to_ascii_lowercase().as_str() {
        "v" | "volt" | "volts" => ("V", 1.0),
        "mv" | "millivolt" | "millivolts" => ("V", 1e-3),
        "uv" | "µv" | "μv" | "microvolt" | "microvolts" => ("V", 1e-6),
        "nv" | "nanovolt" | "nanovolts" => ("V", 1e-9),
        "" => ("V", 1.0),
        _ => (unit.trim(), 1.0),
    }
}

fn unsupported(msg: impl Into<String>) -> DDAError {
    DDAError::UnsupportedFileType(msg.into())
}

#[derive(Debug, Clone, Copy)]
struct H5Config {
    offset_size: usize,
    length_size: usize,
    base_addr: u64,
}

impl H5Config {
    fn undef_addr(self) -> u64 {
        if self.offset_size == 4 {
            UNDEF_ADDR_32
        } else {
            UNDEF_ADDR_64
        }
    }

    fn is_undef(self, addr: u64) -> bool {
        addr == self.undef_addr() || addr == UNDEF_ADDR_64
    }

    fn read_u_var(bytes: &[u8], width: usize) -> Result<u64> {
        if bytes.len() < width {
            return Err(malformed("truncated HDF5 integer field"));
        }
        Ok(match width {
            1 => bytes[0] as u64,
            2 => u16::from_le_bytes([bytes[0], bytes[1]]) as u64,
            4 => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as u64,
            8 => u64::from_le_bytes([
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ]),
            _ => return Err(unsupported(format!("unsupported HDF5 integer width {width}"))),
        })
    }

    fn read_offset(self, bytes: &[u8]) -> Result<u64> {
        Self::read_u_var(bytes, self.offset_size)
    }

    fn read_length(self, bytes: &[u8]) -> Result<u64> {
        Self::read_u_var(bytes, self.length_size)
    }

    fn file_offset(self, addr: u64) -> Result<u64> {
        self.base_addr
            .checked_add(addr)
            .ok_or_else(|| malformed("HDF5 address overflow"))
    }
}

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn remaining(&self) -> usize {
        self.data.len().saturating_sub(self.pos)
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let end = self
            .pos
            .checked_add(n)
            .ok_or_else(|| malformed("cursor overflow"))?;
        if end > self.data.len() {
            return Err(malformed("unexpected end of HDF5 structure"));
        }
        let s = &self.data[self.pos..end];
        self.pos = end;
        Ok(s)
    }

    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }

    fn u16_le(&mut self) -> Result<u16> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    fn u32_le(&mut self) -> Result<u32> {
        let b = self.take(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn u64_le(&mut self) -> Result<u64> {
        let b = self.take(8)?;
        Ok(u64::from_le_bytes([
            b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
        ]))
    }

    fn offset(&mut self, cfg: H5Config) -> Result<u64> {
        let b = self.take(cfg.offset_size)?;
        cfg.read_offset(b)
    }

    fn length(&mut self, cfg: H5Config) -> Result<u64> {
        let b = self.take(cfg.length_size)?;
        cfg.read_length(b)
    }

    fn skip(&mut self, n: usize) -> Result<()> {
        let _ = self.take(n)?;
        Ok(())
    }
}

#[derive(Debug, Clone)]
enum H5Dtype {
    Int {
        size: usize,
        signed: bool,
        big_endian: bool,
    },
    Float {
        size: usize,
        big_endian: bool,
    },
    FixedString {
        size: usize,
    },
    VarString,
    Other {
        size: usize,
    },
}

impl H5Dtype {
    fn elem_size(&self, cfg: H5Config) -> usize {
        match *self {
            Self::Int { size, .. }
            | Self::Float { size, .. }
            | Self::FixedString { size }
            | Self::Other { size } => size,
            Self::VarString => 4 + cfg.offset_size + 4,
        }
    }

    fn raw_type(&self) -> RawType {
        match *self {
            Self::Int { size: 2, signed: true, .. } => RawType::I16,
            Self::Int { size: 4, signed: true, .. } => RawType::I32,
            Self::Float { size: 4, .. } => RawType::F32,
            Self::Float { size: 8, .. } => RawType::F64,
            _ => RawType::F64,
        }
    }

    fn decode_f64(&self, bytes: &[u8]) -> f64 {
        match *self {
            Self::Float {
                size: 4,
                big_endian,
            } => {
                let arr = [bytes[0], bytes[1], bytes[2], bytes[3]];
                (if big_endian {
                    f32::from_be_bytes(arr)
                } else {
                    f32::from_le_bytes(arr)
                }) as f64
            }
            Self::Float {
                size: 8,
                big_endian,
            } => {
                let arr = [
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ];
                if big_endian {
                    f64::from_be_bytes(arr)
                } else {
                    f64::from_le_bytes(arr)
                }
            }
            Self::Int {
                size: 1,
                signed: true,
                ..
            } => bytes[0] as i8 as f64,
            Self::Int {
                size: 1,
                signed: false,
                ..
            } => bytes[0] as f64,
            Self::Int {
                size: 2,
                signed: true,
                big_endian,
            } => {
                let arr = [bytes[0], bytes[1]];
                (if big_endian {
                    i16::from_be_bytes(arr)
                } else {
                    i16::from_le_bytes(arr)
                }) as f64
            }
            Self::Int {
                size: 2,
                signed: false,
                big_endian,
            } => {
                let arr = [bytes[0], bytes[1]];
                (if big_endian {
                    u16::from_be_bytes(arr)
                } else {
                    u16::from_le_bytes(arr)
                }) as f64
            }
            Self::Int {
                size: 4,
                signed: true,
                big_endian,
            } => {
                let arr = [bytes[0], bytes[1], bytes[2], bytes[3]];
                (if big_endian {
                    i32::from_be_bytes(arr)
                } else {
                    i32::from_le_bytes(arr)
                }) as f64
            }
            Self::Int {
                size: 4,
                signed: false,
                big_endian,
            } => {
                let arr = [bytes[0], bytes[1], bytes[2], bytes[3]];
                (if big_endian {
                    u32::from_be_bytes(arr)
                } else {
                    u32::from_le_bytes(arr)
                }) as f64
            }
            Self::Int {
                size: 8,
                signed: true,
                big_endian,
            } => {
                let arr = [
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ];
                (if big_endian {
                    i64::from_be_bytes(arr)
                } else {
                    i64::from_le_bytes(arr)
                }) as f64
            }
            Self::Int {
                size: 8,
                signed: false,
                big_endian,
            } => {
                let arr = [
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ];
                (if big_endian {
                    u64::from_be_bytes(arr)
                } else {
                    u64::from_le_bytes(arr)
                }) as f64
            }
            _ => f64::NAN,
        }
    }
}

#[derive(Debug, Clone)]
enum DataLayout {
    Compact(Vec<u8>),
    Contiguous {
        addr: u64,
        size: u64,
    },
    ChunkedV3 {
        btree_addr: u64,
        chunk_dims: Vec<u64>,
    },
    ChunkedSingle {
        addr: u64,
        size: u64,
        chunk_dims: Vec<u64>,
    },
    ChunkedImplicit {
        addr: u64,
        chunk_dims: Vec<u64>,
    },
}

#[derive(Debug, Clone)]
struct FilterSpec {
    id: u16,
    client_data: Vec<u32>,
}

#[derive(Debug, Clone)]
enum AttrValue {
    String(String),
    Float(f64),
    Other,
}

#[derive(Debug, Clone)]
struct ObjectHeader {
    dims: Option<Vec<u64>>,
    dtype: Option<H5Dtype>,
    layout: Option<DataLayout>,
    filters: Vec<FilterSpec>,
    attributes: HashMap<String, AttrValue>,
    symbol_table: Option<(u64, u64)>,
    links: BTreeMap<String, LinkTarget>,
}

#[derive(Debug, Clone)]
enum LinkTarget {
    Hard(u64),
    Soft(String),
}

#[derive(Debug, Clone, Copy)]
struct ChunkLoc {
    addr: u64,
    byte_size: u32,
}

struct H5File {
    source: Arc<dyn ByteSource>,
    cfg: H5Config,
    root_addr: u64,
}

impl H5File {
    fn open(source: Arc<dyn ByteSource>, name: &str) -> Result<Self> {
        let len = source.len();
        if len < 48 {
            return Err(unsupported(format!(
                "{name} is too small ({len} bytes) to be an HDF5/NWB file"
            )));
        }

        // HDF5 superblock may sit at offset 0, 512, 1024, 2048, ...
        let mut sb_off = None;
        let mut sig = [0u8; 8];
        let mut probe = 0u64;
        while probe + 48 <= len && probe <= 65536 {
            source.read_at(probe, &mut sig)?;
            if sig == HDF5_SIGNATURE {
                sb_off = Some(probe);
                break;
            }
            probe = if probe == 0 { 512 } else { probe * 2 };
        }
        let sb_off = sb_off.ok_or_else(|| {
            unsupported(format!(
                "{name} does not contain a valid HDF5 superblock signature"
            ))
        })?;

        let mut sb = [0u8; 128];
        let read_len = sb.len().min((len - sb_off) as usize);
        source.read_at(sb_off, &mut sb[..read_len])?;
        let version = sb[8];

        match version {
            0 | 1 => {
                let offset_size = sb[13] as usize;
                let length_size = sb[14] as usize;
                let mut cur = Cursor::new(&sb[..read_len]);
                cur.skip(if version == 0 { 24 } else { 28 })?;
                let tmp = H5Config {
                    offset_size,
                    length_size,
                    base_addr: 0,
                };
                let base_addr = cur.offset(tmp)?;
                let _free_space = cur.offset(tmp)?;
                let _eof = cur.offset(tmp)?;
                let _driver = cur.offset(tmp)?;
                // Root Group Symbol Table Entry: link_name_offset + object_header_addr
                let _link_name_off = cur.offset(tmp)?;
                let root_addr = cur.offset(tmp)?;
                let cfg = H5Config {
                    offset_size,
                    length_size,
                    base_addr,
                };
                Ok(Self {
                    source,
                    cfg,
                    root_addr,
                })
            }
            2 | 3 => {
                let offset_size = sb[9] as usize;
                let length_size = sb[10] as usize;
                let mut cur = Cursor::new(&sb[..read_len]);
                cur.skip(12)?;
                let tmp = H5Config {
                    offset_size,
                    length_size,
                    base_addr: 0,
                };
                let base_addr = cur.offset(tmp)?;
                let _ext_addr = cur.offset(tmp)?;
                let _eof = cur.offset(tmp)?;
                let root_addr = cur.offset(tmp)?;
                let cfg = H5Config {
                    offset_size,
                    length_size,
                    base_addr,
                };
                Ok(Self {
                    source,
                    cfg,
                    root_addr,
                })
            }
            _ => Err(unsupported(format!(
                "{name}: unsupported HDF5 superblock version {version}"
            ))),
        }
    }

    fn read_bytes(&self, addr: u64, len: usize) -> Result<Vec<u8>> {
        let off = self.cfg.file_offset(addr)?;
        let mut buf = vec![0u8; len];
        if len > 0 {
            self.source.read_at(off, &mut buf)?;
        }
        Ok(buf)
    }

    fn read_object(&self, addr: u64) -> Result<ObjectHeader> {
        let mut probe = [0u8; 16];
        let off = self.cfg.file_offset(addr)?;
        self.source.read_at(off, &mut probe)?;

        let mut hdr = ObjectHeader {
            dims: None,
            dtype: None,
            layout: None,
            filters: Vec::new(),
            attributes: HashMap::new(),
            symbol_table: None,
            links: BTreeMap::new(),
        };

        if &probe[0..4] == b"OHDR" {
            self.parse_ohdr_v2(addr, &mut hdr, 0)?;
        } else if probe[0] == 1 {
            let header_size = u32::from_le_bytes([probe[8], probe[9], probe[10], probe[11]]) as usize;
            let body = self.read_bytes(addr + 16, header_size)?;
            self.parse_messages_v1(&body, &mut hdr, 0)?;
        } else {
            return Err(malformed(format!(
                "unrecognized HDF5 object header at offset {addr:#x}"
            )));
        }
        Ok(hdr)
    }

    fn parse_messages_v1(&self, body: &[u8], hdr: &mut ObjectHeader, depth: usize) -> Result<()> {
        if depth > 16 {
            return Err(malformed("HDF5 object header continuation depth exceeded"));
        }
        let mut cur = Cursor::new(body);
        while cur.remaining() >= 8 {
            let msg_type = cur.u16_le()?;
            let msg_size = cur.u16_le()? as usize;
            let _flags = cur.u8()?;
            cur.skip(3)?;
            if msg_size > cur.remaining() {
                break;
            }
            let payload = cur.take(msg_size)?;
            if msg_type == MSG_CONTINUATION {
                let mut mc = Cursor::new(payload);
                let cont_addr = mc.offset(self.cfg)?;
                let cont_len = mc.length(self.cfg)? as usize;
                let cont = self.read_bytes(cont_addr, cont_len)?;
                self.parse_messages_v1(&cont, hdr, depth + 1)?;
            } else {
                self.apply_message(msg_type, payload, hdr)?;
            }
        }
        Ok(())
    }

    fn parse_ohdr_v2(&self, addr: u64, hdr: &mut ObjectHeader, depth: usize) -> Result<()> {
        if depth > 16 {
            return Err(malformed("HDF5 OHDR continuation depth exceeded"));
        }
        // Read prefix (up to 40 bytes covers all optional fields).
        let max_prefix = 48usize.min((self.source.len() - self.cfg.file_offset(addr)?) as usize);
        let prefix = self.read_bytes(addr, max_prefix)?;
        let mut cur = Cursor::new(&prefix);
        let magic = cur.take(4)?;
        if magic != b"OHDR" {
            return Err(malformed("expected OHDR signature"));
        }
        let version = cur.u8()?;
        if version != 2 {
            return Err(unsupported(format!("unsupported OHDR version {version}")));
        }
        let flags = cur.u8()?;
        if (flags & 0x20) != 0 {
            cur.skip(16)?; // access/mod/change/birth timestamps
        }
        if (flags & 0x10) != 0 {
            cur.skip(4)?; // max compact / min dense attr counts
        }
        let size_width = 1usize << (flags & 0x03);
        let chunk0_size = H5Config::read_u_var(cur.take(size_width)?, size_width)? as usize;
        let has_creation_order = (flags & 0x04) != 0;
        let msg_start = addr + cur.pos as u64;
        // chunk0_size does not include the trailing 4-byte checksum.
        let chunk_bytes = self.read_bytes(msg_start, chunk0_size)?;
        self.parse_messages_v2(&chunk_bytes, has_creation_order, hdr, depth)?;
        Ok(())
    }

    fn parse_messages_v2(
        &self,
        body: &[u8],
        has_creation_order: bool,
        hdr: &mut ObjectHeader,
        depth: usize,
    ) -> Result<()> {
        if depth > 16 {
            return Err(malformed("HDF5 OCHK continuation depth exceeded"));
        }
        let mut cur = Cursor::new(body);
        while cur.remaining() >= 4 {
            let msg_type = cur.u8()? as u16;
            let msg_size = cur.u16_le()? as usize;
            let _msg_flags = cur.u8()?;
            if has_creation_order {
                if cur.remaining() < 2 {
                    break;
                }
                cur.skip(2)?;
            }
            if msg_size > cur.remaining() {
                break;
            }
            let payload = cur.take(msg_size)?;
            if msg_type == MSG_CONTINUATION {
                let mut mc = Cursor::new(payload);
                let cont_addr = mc.offset(self.cfg)?;
                let cont_len = mc.length(self.cfg)? as usize;
                if cont_len >= 8 {
                    let cont = self.read_bytes(cont_addr, cont_len)?;
                    if &cont[0..4] == b"OCHK" {
                        // Strip 4-byte OCHK magic and trailing 4-byte checksum.
                        self.parse_messages_v2(
                            &cont[4..cont.len() - 4],
                            has_creation_order,
                            hdr,
                            depth + 1,
                        )?;
                    }
                }
            } else {
                self.apply_message(msg_type, payload, hdr)?;
            }
        }
        Ok(())
    }

    fn apply_message(&self, msg_type: u16, payload: &[u8], hdr: &mut ObjectHeader) -> Result<()> {
        match msg_type {
            MSG_DATASPACE => {
                hdr.dims = Some(self.parse_dataspace(payload)?);
            }
            MSG_DATATYPE => {
                hdr.dtype = Some(parse_datatype(payload)?);
            }
            MSG_DATA_LAYOUT => {
                hdr.layout = Some(self.parse_data_layout(payload)?);
            }
            MSG_FILTER_PIPELINE => {
                hdr.filters = parse_filter_pipeline(payload)?;
            }
            MSG_ATTRIBUTE => {
                if let Ok((name, val)) = self.parse_attribute(payload) {
                    hdr.attributes.insert(name, val);
                }
            }
            MSG_SYMBOL_TABLE => {
                let mut c = Cursor::new(payload);
                let btree_addr = c.offset(self.cfg)?;
                let heap_addr = c.offset(self.cfg)?;
                hdr.symbol_table = Some((btree_addr, heap_addr));
            }
            MSG_LINK => {
                if let Ok((name, target)) = self.parse_link_message(payload) {
                    hdr.links.insert(name, target);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn parse_dataspace(&self, payload: &[u8]) -> Result<Vec<u64>> {
        let mut c = Cursor::new(payload);
        let version = c.u8()?;
        let rank = c.u8()? as usize;
        let _flags = c.u8()?;
        match version {
            1 => {
                c.skip(5)?;
            }
            2 => {
                let _ds_type = c.u8()?;
            }
            _ => return Err(unsupported(format!("unsupported dataspace version {version}"))),
        }
        let mut dims = Vec::with_capacity(rank);
        for _ in 0..rank {
            dims.push(c.length(self.cfg)?);
        }
        Ok(dims)
    }

    fn parse_data_layout(&self, payload: &[u8]) -> Result<DataLayout> {
        let mut c = Cursor::new(payload);
        let version = c.u8()?;
        let class = c.u8()?;
        match (version, class) {
            (3 | 4, 0) => {
                let size = c.u16_le()? as usize;
                let data = c.take(size)?.to_vec();
                Ok(DataLayout::Compact(data))
            }
            (3 | 4, 1) => {
                let addr = c.offset(self.cfg)?;
                let size = c.length(self.cfg)?;
                Ok(DataLayout::Contiguous { addr, size })
            }
            (3, 2) => {
                let ndims = c.u8()? as usize;
                let btree_addr = c.offset(self.cfg)?;
                let mut dims = Vec::with_capacity(ndims);
                for _ in 0..ndims {
                    dims.push(c.u32_le()? as u64);
                }
                Ok(DataLayout::ChunkedV3 {
                    btree_addr,
                    chunk_dims: dims,
                })
            }
            (4, 2) => {
                let flags = c.u8()?;
                let ndims = c.u8()? as usize;
                let dim_enc_size = c.u8()? as usize;
                let mut chunk_dims = Vec::with_capacity(ndims);
                for _ in 0..ndims {
                    let b = c.take(dim_enc_size)?;
                    chunk_dims.push(H5Config::read_u_var(b, dim_enc_size)?);
                }
                let idx_type = c.u8()?;
                match idx_type {
                    1 => {
                        // Single chunk
                        let size = if (flags & 0x02) != 0 {
                            let s = c.length(self.cfg)?;
                            let _filter_mask = c.u32_le()?;
                            s
                        } else {
                            0
                        };
                        let addr = c.offset(self.cfg)?;
                        Ok(DataLayout::ChunkedSingle {
                            addr,
                            size,
                            chunk_dims,
                        })
                    }
                    2 => {
                        // Implicit (uncompressed chunks laid out contiguously)
                        let addr = c.offset(self.cfg)?;
                        Ok(DataLayout::ChunkedImplicit { addr, chunk_dims })
                    }
                    other => Err(unsupported(format!(
                        "unsupported HDF5 v4 chunk indexing type {other} (try repacking with h5repack -L / standard chunking)"
                    ))),
                }
            }
            _ => Err(unsupported(format!(
                "unsupported HDF5 data layout version={version} class={class}"
            ))),
        }
    }

    fn parse_link_message(&self, payload: &[u8]) -> Result<(String, LinkTarget)> {
        let mut c = Cursor::new(payload);
        let version = c.u8()?;
        if version != 1 {
            return Err(unsupported(format!("unsupported link version {version}")));
        }
        let flags = c.u8()?;
        let link_type = if (flags & 0x08) != 0 { c.u8()? } else { 0 };
        if (flags & 0x04) != 0 {
            c.skip(8)?; // creation order
        }
        if (flags & 0x10) != 0 {
            c.skip(1)?; // charset
        }
        let name_len_width = 1usize << (flags & 0x03);
        let name_len = H5Config::read_u_var(c.take(name_len_width)?, name_len_width)? as usize;
        let name = String::from_utf8_lossy(c.take(name_len)?).into_owned();
        let target = match link_type {
            0 => LinkTarget::Hard(c.offset(self.cfg)?),
            1 => {
                let len = c.u16_le()? as usize;
                let s = String::from_utf8_lossy(c.take(len)?).into_owned();
                LinkTarget::Soft(s)
            }
            _ => return Err(unsupported(format!("unsupported HDF5 link type {link_type}"))),
        };
        Ok((name, target))
    }

    fn parse_attribute(&self, payload: &[u8]) -> Result<(String, AttrValue)> {
        let mut c = Cursor::new(payload);
        let version = c.u8()?;
        let _flags = c.u8()?;
        let name_size = c.u16_le()? as usize;
        let dtype_size = c.u16_le()? as usize;
        let dspace_size = c.u16_le()? as usize;
        if version == 3 {
            let _encoding = c.u8()?;
        }
        let pad8 = |n: usize| (n + 7) & !7;
        let name_bytes = c.take(if version == 1 { pad8(name_size) } else { name_size })?;
        let name = String::from_utf8_lossy(&name_bytes[..name_size])
            .trim_end_matches('\0')
            .to_string();
        let dtype_bytes = c.take(if version == 1 {
            pad8(dtype_size)
        } else {
            dtype_size
        })?;
        let dspace_bytes = c.take(if version == 1 {
            pad8(dspace_size)
        } else {
            dspace_size
        })?;
        let dtype = parse_datatype(&dtype_bytes[..dtype_size])?;
        let _dims = self.parse_dataspace(&dspace_bytes[..dspace_size])?;
        let raw = c.take(c.remaining())?;

        let value = match dtype {
            H5Dtype::Float { size, .. } | H5Dtype::Int { size, .. } if raw.len() >= size => {
                AttrValue::Float(dtype.decode_f64(&raw[..size]))
            }
            H5Dtype::FixedString { size } if raw.len() >= size => {
                let s = String::from_utf8_lossy(&raw[..size])
                    .trim_end_matches(['\0', ' '])
                    .to_string();
                AttrValue::String(s)
            }
            H5Dtype::VarString if raw.len() >= 4 + self.cfg.offset_size + 4 => {
                match self.read_vlen_string(raw) {
                    Ok(s) => AttrValue::String(s),
                    Err(_) => AttrValue::Other,
                }
            }
            _ => AttrValue::Other,
        };
        Ok((name, value))
    }

    fn read_vlen_string(&self, entry: &[u8]) -> Result<String> {
        let mut c = Cursor::new(entry);
        let _len = c.u32_le()?;
        let gcol_addr = c.offset(self.cfg)?;
        let obj_idx = c.u32_le()?;
        if self.cfg.is_undef(gcol_addr) {
            return Ok(String::new());
        }
        // Global Heap collection header: "GCOL"(4), version(1), reserved(3), collection_size(length_size)
        let prefix = self.read_bytes(gcol_addr, 8 + self.cfg.length_size)?;
        if &prefix[0..4] != b"GCOL" {
            return Err(malformed("expected GCOL global heap signature"));
        }
        let col_size = self.cfg.read_length(&prefix[8..8 + self.cfg.length_size])? as usize;
        let col = self.read_bytes(gcol_addr, col_size)?;
        let mut gc = Cursor::new(&col);
        gc.skip(8 + self.cfg.length_size)?;
        while gc.remaining() >= 8 + self.cfg.length_size {
            let id = gc.u16_le()?;
            let _refcount = gc.u16_le()?;
            gc.skip(4)?;
            let obj_size = gc.length(self.cfg)? as usize;
            if id == 0 {
                break;
            }
            let padded = (obj_size + 7) & !7;
            if padded > gc.remaining() {
                break;
            }
            let data = gc.take(padded)?;
            if id as u32 == obj_idx {
                return Ok(String::from_utf8_lossy(&data[..obj_size])
                    .trim_end_matches('\0')
                    .to_string());
            }
        }
        Ok(String::new())
    }

    /// Lists direct children (name -> object header address) of a group at `group_addr`.
    fn list_group(&self, group_addr: u64) -> Result<BTreeMap<String, u64>> {
        let hdr = self.read_object(group_addr)?;
        let mut children = BTreeMap::new();

        // v2 compact links
        for (name, target) in hdr.links {
            match target {
                LinkTarget::Hard(addr) => {
                    children.insert(name, addr);
                }
                LinkTarget::Soft(path) => {
                    if let Ok(Some(addr)) = self.resolve_path(&path) {
                        children.insert(name, addr);
                    }
                }
            }
        }

        // v1 symbol table
        if let Some((btree_addr, heap_addr)) = hdr.symbol_table {
            let heap_data = self.read_local_heap(heap_addr)?;
            self.walk_group_btree(btree_addr, &heap_data, &mut children, 0)?;
        }

        Ok(children)
    }

    fn read_local_heap(&self, heap_addr: u64) -> Result<Vec<u8>> {
        let header_len = 8 + 2 * self.cfg.length_size + self.cfg.offset_size;
        let buf = self.read_bytes(heap_addr, header_len)?;
        if &buf[0..4] != b"HEAP" {
            return Err(malformed("expected HEAP local heap signature"));
        }
        let mut c = Cursor::new(&buf[8..]);
        let data_size = c.length(self.cfg)? as usize;
        let _free_list = c.length(self.cfg)?;
        let data_addr = c.offset(self.cfg)?;
        self.read_bytes(data_addr, data_size)
    }

    fn walk_group_btree(
        &self,
        node_addr: u64,
        heap_data: &[u8],
        out: &mut BTreeMap<String, u64>,
        depth: usize,
    ) -> Result<()> {
        if depth > 32 || self.cfg.is_undef(node_addr) {
            return Ok(());
        }
        let prefix_len = 8 + 2 * self.cfg.offset_size;
        let prefix = self.read_bytes(node_addr, prefix_len)?;
        if &prefix[0..4] != b"TREE" {
            return Err(malformed("expected TREE B-tree v1 signature"));
        }
        let node_type = prefix[4];
        let node_level = prefix[5];
        let entries_used = u16::from_le_bytes([prefix[6], prefix[7]]) as usize;
        if node_type != 0 {
            return Err(malformed("expected group B-tree (node_type 0)"));
        }
        // Key(0) Child(0) Key(1) Child(1) ... Key(N-1) Child(N-1) Key(N)
        let entry_bytes = entries_used * (self.cfg.length_size + self.cfg.offset_size)
            + self.cfg.length_size;
        let body = self.read_bytes(node_addr + prefix_len as u64, entry_bytes)?;
        let mut c = Cursor::new(&body);
        for _ in 0..entries_used {
            let _key = c.length(self.cfg)?;
            let child_addr = c.offset(self.cfg)?;
            if node_level > 0 {
                self.walk_group_btree(child_addr, heap_data, out, depth + 1)?;
            } else {
                self.read_snod(child_addr, heap_data, out)?;
            }
        }
        Ok(())
    }

    fn read_snod(
        &self,
        snod_addr: u64,
        heap_data: &[u8],
        out: &mut BTreeMap<String, u64>,
    ) -> Result<()> {
        let head = self.read_bytes(snod_addr, 8)?;
        if &head[0..4] != b"SNOD" {
            return Err(malformed("expected SNOD symbol table node signature"));
        }
        let num_symbols = u16::from_le_bytes([head[6], head[7]]) as usize;
        let entry_size = 2 * self.cfg.offset_size + 24;
        let body = self.read_bytes(snod_addr + 8, num_symbols * entry_size)?;
        let mut c = Cursor::new(&body);
        for _ in 0..num_symbols {
            let name_off = c.offset(self.cfg)? as usize;
            let obj_addr = c.offset(self.cfg)?;
            c.skip(24)?;
            if name_off < heap_data.len() {
                let slice = &heap_data[name_off..];
                let nul = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
                let name = String::from_utf8_lossy(&slice[..nul]).into_owned();
                if !name.is_empty() && !self.cfg.is_undef(obj_addr) {
                    out.insert(name, obj_addr);
                }
            }
        }
        Ok(())
    }

    fn resolve_path(&self, path: &str) -> Result<Option<u64>> {
        let mut cur = self.root_addr;
        for part in path.split('/').filter(|p| !p.is_empty()) {
            let children = self.list_group(cur)?;
            match children.get(part) {
                Some(&addr) => cur = addr,
                None => return Ok(None),
            }
        }
        Ok(Some(cur))
    }

    fn walk_chunk_btree(
        &self,
        node_addr: u64,
        ndims: usize,
        out: &mut BTreeMap<(u64, u64), ChunkLoc>,
        depth: usize,
    ) -> Result<()> {
        if depth > 32 || self.cfg.is_undef(node_addr) {
            return Ok(());
        }
        let prefix_len = 8 + 2 * self.cfg.offset_size;
        let prefix = self.read_bytes(node_addr, prefix_len)?;
        if &prefix[0..4] != b"TREE" {
            return Err(malformed("expected TREE chunk B-tree signature"));
        }
        let node_type = prefix[4];
        let node_level = prefix[5];
        let entries_used = u16::from_le_bytes([prefix[6], prefix[7]]) as usize;
        if node_type != 1 {
            return Err(malformed("expected raw data chunk B-tree (node_type 1)"));
        }
        let key_bytes = 8 + ndims * 8;
        let body_len = entries_used * (key_bytes + self.cfg.offset_size) + key_bytes;
        let body = self.read_bytes(node_addr + prefix_len as u64, body_len)?;
        let mut c = Cursor::new(&body);
        for _ in 0..entries_used {
            let chunk_size = c.u32_le()?;
            let _filter_mask = c.u32_le()?;
            let mut coords = Vec::with_capacity(ndims);
            for _ in 0..ndims {
                coords.push(c.u64_le()?);
            }
            let child_addr = c.offset(self.cfg)?;
            if node_level > 0 {
                self.walk_chunk_btree(child_addr, ndims, out, depth + 1)?;
            } else {
                let row = coords.first().copied().unwrap_or(0);
                let col = coords.get(1).copied().unwrap_or(0);
                out.insert(
                    (row, col),
                    ChunkLoc {
                        addr: child_addr,
                        byte_size: chunk_size,
                    },
                );
            }
        }
        Ok(())
    }

    /// Reads an entire small 1D dataset as `f64` values (for `timestamps`, `start_time`, `stop_time`, `electrodes`).
    fn read_1d_f64(&self, addr: u64, limit: usize) -> Result<Vec<f64>> {
        let obj = self.read_object(addr)?;
        let dtype = obj
            .dtype
            .as_ref()
            .ok_or_else(|| malformed("dataset missing datatype"))?;
        let dims = obj
            .dims
            .as_ref()
            .ok_or_else(|| malformed("dataset missing dataspace"))?;
        let total = dims.iter().copied().product::<u64>() as usize;
        let n = total.min(limit);
        let elem = dtype.elem_size(self.cfg);
        if n == 0 || elem == 0 {
            return Ok(Vec::new());
        }
        let raw = self.read_small_dataset_bytes(&obj, n * elem, elem)?;
        let count = (raw.len() / elem).min(n);
        Ok((0..count)
            .map(|i| dtype.decode_f64(&raw[i * elem..(i + 1) * elem]))
            .collect())
    }

    /// Reads an entire small 1D string dataset (for electrode labels/locations).
    fn read_1d_strings(&self, addr: u64, limit: usize) -> Result<Vec<String>> {
        let obj = self.read_object(addr)?;
        let dtype = obj
            .dtype
            .as_ref()
            .ok_or_else(|| malformed("string dataset missing datatype"))?;
        let dims = obj
            .dims
            .as_ref()
            .ok_or_else(|| malformed("string dataset missing dataspace"))?;
        let total = dims.iter().copied().product::<u64>() as usize;
        let n = total.min(limit);
        let elem = dtype.elem_size(self.cfg);
        if n == 0 || elem == 0 {
            return Ok(Vec::new());
        }
        let raw = self.read_small_dataset_bytes(&obj, n * elem, elem)?;
        let count = (raw.len() / elem).min(n);
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let slice = &raw[i * elem..(i + 1) * elem];
            let s = match *dtype {
                H5Dtype::FixedString { .. } => String::from_utf8_lossy(slice)
                    .trim_end_matches(['\0', ' '])
                    .to_string(),
                H5Dtype::VarString => self.read_vlen_string(slice).unwrap_or_default(),
                H5Dtype::Int { .. } | H5Dtype::Float { .. } => {
                    format!("{}", dtype.decode_f64(slice) as i64)
                }
                _ => String::new(),
            };
            out.push(s);
        }
        Ok(out)
    }

    fn read_small_dataset_bytes(
        &self,
        obj: &ObjectHeader,
        max_bytes: usize,
        elem_size: usize,
    ) -> Result<Vec<u8>> {
        match obj.layout.as_ref() {
            Some(DataLayout::Compact(data)) => Ok(data[..data.len().min(max_bytes)].to_vec()),
            Some(DataLayout::Contiguous { addr, size }) => {
                if self.cfg.is_undef(*addr) {
                    return Ok(vec![0u8; max_bytes]);
                }
                let n = (*size as usize).min(max_bytes);
                self.read_bytes(*addr, n)
            }
            Some(DataLayout::ChunkedSingle { addr, size, .. }) => {
                if self.cfg.is_undef(*addr) {
                    return Ok(vec![0u8; max_bytes]);
                }
                let raw_size = if *size > 0 { *size as usize } else { max_bytes };
                let raw = self.read_bytes(*addr, raw_size)?;
                let decoded = apply_filters_reverse(raw, &obj.filters, elem_size)?;
                Ok(decoded[..decoded.len().min(max_bytes)].to_vec())
            }
            Some(DataLayout::ChunkedV3 {
                btree_addr,
                chunk_dims,
            }) => {
                let mut chunks = BTreeMap::new();
                self.walk_chunk_btree(*btree_addr, chunk_dims.len(), &mut chunks, 0)?;
                let mut out = Vec::with_capacity(max_bytes);
                for loc in chunks.values() {
                    if out.len() >= max_bytes {
                        break;
                    }
                    let raw = self.read_bytes(loc.addr, loc.byte_size as usize)?;
                    let decoded = apply_filters_reverse(raw, &obj.filters, elem_size)?;
                    out.extend_from_slice(&decoded);
                }
                out.truncate(max_bytes);
                Ok(out)
            }
            Some(DataLayout::ChunkedImplicit { addr, .. }) => {
                if self.cfg.is_undef(*addr) {
                    return Ok(vec![0u8; max_bytes]);
                }
                self.read_bytes(*addr, max_bytes)
            }
            None => Err(malformed("dataset missing data layout")),
        }
    }
}

fn parse_datatype(payload: &[u8]) -> Result<H5Dtype> {
    if payload.len() < 8 {
        return Err(malformed("truncated HDF5 datatype message"));
    }
    let class = payload[0] & 0x0F;
    let class_bits =
        (payload[1] as u32) | ((payload[2] as u32) << 8) | ((payload[3] as u32) << 16);
    let size = u32::from_le_bytes([payload[4], payload[5], payload[6], payload[7]]) as usize;
    Ok(match class {
        0 => H5Dtype::Int {
            size,
            signed: (class_bits & 0x08) != 0,
            big_endian: (class_bits & 0x01) != 0,
        },
        1 => H5Dtype::Float {
            size,
            big_endian: (class_bits & 0x01) != 0,
        },
        3 => H5Dtype::FixedString { size },
        9 if (class_bits & 0x0F) == 1 => H5Dtype::VarString,
        _ => H5Dtype::Other { size },
    })
}

fn parse_filter_pipeline(payload: &[u8]) -> Result<Vec<FilterSpec>> {
    let mut c = Cursor::new(payload);
    let version = c.u8()?;
    let n_filters = c.u8()? as usize;
    if version == 1 {
        c.skip(6)?;
    } else if version != 2 {
        return Err(unsupported(format!(
            "unsupported HDF5 filter pipeline version {version}"
        )));
    }
    let mut filters = Vec::with_capacity(n_filters);
    for _ in 0..n_filters {
        let id = c.u16_le()?;
        let name_len = if version == 1 || id >= 256 {
            c.u16_le()? as usize
        } else {
            0
        };
        let _flags = c.u16_le()?;
        let n_cd = c.u16_le()? as usize;
        if name_len > 0 {
            let skip_len = if version == 1 {
                (name_len + 7) & !7
            } else {
                name_len
            };
            c.skip(skip_len)?;
        }
        let mut client_data = Vec::with_capacity(n_cd);
        for _ in 0..n_cd {
            client_data.push(c.u32_le()?);
        }
        if version == 1 && (n_cd % 2 == 1) {
            c.skip(4)?;
        }
        filters.push(FilterSpec { id, client_data });
    }
    Ok(filters)
}

fn apply_filters_reverse(
    mut buf: Vec<u8>,
    filters: &[FilterSpec],
    elem_size: usize,
) -> Result<Vec<u8>> {
    for f in filters.iter().rev() {
        match f.id {
            FILTER_DEFLATE => {
                buf = miniz_oxide::inflate::decompress_to_vec_zlib(&buf).map_err(|e| {
                    malformed(format!("HDF5 deflate decompression failed: {e:?}"))
                })?;
            }
            FILTER_SHUFFLE => {
                let width = f
                    .client_data
                    .first()
                    .copied()
                    .unwrap_or(elem_size as u32) as usize;
                if width > 1 && buf.len() >= width {
                    let count = buf.len() / width;
                    let mut out = vec![0u8; buf.len()];
                    for i in 0..count {
                        for b in 0..width {
                            out[i * width + b] = buf[b * count + i];
                        }
                    }
                    // Copy any remainder bytes verbatim.
                    let done = count * width;
                    if done < buf.len() {
                        out[done..].copy_from_slice(&buf[done..]);
                    }
                    buf = out;
                }
            }
            FILTER_FLETCHER32 => {
                if buf.len() >= 4 {
                    buf.truncate(buf.len() - 4);
                }
            }
            other => {
                return Err(unsupported(format!(
                    "unsupported HDF5 compression filter id {other} (supported: deflate/gzip, shuffle, fletcher32)"
                )));
            }
        }
    }
    Ok(buf)
}

enum Storage {
    Compact(Vec<u8>),
    Contiguous {
        addr: u64,
    },
    Chunked {
        chunk_rows: u64,
        chunk_cols: u64,
        chunks: BTreeMap<(u64, u64), ChunkLoc>,
        filters: Vec<FilterSpec>,
        cache: Mutex<Vec<((u64, u64), Arc<Vec<u8>>)>>,
    },
}

pub struct NwbReader {
    info: RecordingInfo,
    source: Arc<dyn ByteSource>,
    cfg: H5Config,
    dtype: H5Dtype,
    elem_size: usize,
    n_channels: usize,
    storage: Storage,
}

fn inspect_nwb_container(
    h5: &H5File,
    prefix: &str,
    group_addr: u64,
    candidates: &mut Vec<(bool, String, u64, u64)>,
) -> Result<()> {
    for (child_name, child_addr) in h5.list_group(group_addr)? {
        let Ok(child_hdr) = h5.read_object(child_addr) else {
            continue;
        };
        let is_es = matches!(
            child_hdr.attributes.get("neurodata_type"),
            Some(AttrValue::String(s)) if s == "ElectricalSeries"
        );
        let Ok(sub) = h5.list_group(child_addr) else {
            continue;
        };
        if let Some(&data_addr) = sub.get("data") {
            if let Ok(data_hdr) = h5.read_object(data_addr) {
                let is_2d_numeric = data_hdr
                    .dims
                    .as_ref()
                    .is_some_and(|d| d.len() == 2 && d[0] > 0 && d[1] > 0)
                    && matches!(
                        data_hdr.dtype,
                        Some(H5Dtype::Int { .. } | H5Dtype::Float { .. })
                    );
                if is_2d_numeric {
                    candidates.push((
                        is_es,
                        format!("{prefix}/{child_name}"),
                        child_addr,
                        data_addr,
                    ));
                }
            }
        }
    }
    Ok(())
}

fn find_electrical_series(h5: &H5File) -> Result<(String, u64, u64)> {
    // Search `/acquisition` first, then `/processing/<module>`.
    let mut candidates: Vec<(bool, String, u64, u64)> = Vec::new();
    if let Some(acq) = h5.resolve_path("/acquisition")? {
        inspect_nwb_container(h5, "/acquisition", acq, &mut candidates)?;
    }
    if candidates.is_empty() {
        if let Some(proc_addr) = h5.resolve_path("/processing")? {
            for (mod_name, mod_addr) in h5.list_group(proc_addr)? {
                let _ = inspect_nwb_container(
                    h5,
                    &format!("/processing/{mod_name}"),
                    mod_addr,
                    &mut candidates,
                );
            }
        }
    }
    // Prefer explicit neurodata_type == "ElectricalSeries".
    candidates.sort_by_key(|(is_es, name, _, _)| (!*is_es, name.clone()));
    candidates
        .into_iter()
        .next()
        .map(|(_, path, group_addr, data_addr)| (path, group_addr, data_addr))
        .ok_or_else(|| {
            unsupported(
                "NWB file contains no 2-D numeric ElectricalSeries under /acquisition or /processing"
                    .to_string(),
            )
        })
}

fn resolve_sample_rate(h5: &H5File, series_group: u64, series_path: &str) -> Result<f64> {
    let children = h5.list_group(series_group)?;
    if let Some(&st_addr) = children.get("starting_time") {
        let st_hdr = h5.read_object(st_addr)?;
        if let Some(AttrValue::Float(rate)) = st_hdr.attributes.get("rate") {
            if rate.is_finite() && *rate > 0.0 {
                return Ok(*rate);
            }
        }
    }
    if let Some(&ts_addr) = children.get("timestamps") {
        let ts = h5.read_1d_f64(ts_addr, 64)?;
        let mut dts: Vec<f64> = ts
            .windows(2)
            .map(|w| w[1] - w[0])
            .filter(|&d| d.is_finite() && d > 0.0)
            .collect();
        if !dts.is_empty() {
            dts.sort_by(|a, b| a.total_cmp(b));
            let median_dt = dts[dts.len() / 2];
            if median_dt > 0.0 {
                return Ok(1.0 / median_dt);
            }
        }
    }
    Err(unsupported(format!(
        "NWB series {series_path} has neither starting_time.rate nor valid timestamps"
    )))
}

fn resolve_electrode_labels(h5: &H5File, series_group: u64, n_channels: usize) -> Vec<String> {
    let default_labels = || (0..n_channels).map(|i| format!("ch{i}")).collect::<Vec<_>>();
    let Ok(Some(elec_group)) = h5.resolve_path("/general/extracellular_ephys/electrodes") else {
        return default_labels();
    };
    let Ok(elec_children) = h5.list_group(elec_group) else {
        return default_labels();
    };
    let table_labels = ["label", "location", "id"]
        .iter()
        .find_map(|col| elec_children.get(*col))
        .and_then(|&addr| h5.read_1d_strings(addr, 4096).ok())
        .filter(|v| !v.is_empty());
    let Some(table_labels) = table_labels else {
        return default_labels();
    };

    // If the series has an `electrodes` index dataset, slice the table with it.
    let indices: Option<Vec<usize>> = h5
        .list_group(series_group)
        .ok()
        .and_then(|c| c.get("electrodes").copied())
        .and_then(|addr| h5.read_1d_f64(addr, n_channels).ok())
        .filter(|v| v.len() == n_channels)
        .map(|v| v.into_iter().map(|x| x.max(0.0) as usize).collect());

    (0..n_channels)
        .map(|i| {
            let idx = indices.as_ref().map_or(i, |v| v[i]);
            table_labels
                .get(idx)
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or_else(|| format!("ch{i}"))
        })
        .collect()
}

fn read_intervals(h5: &H5File) -> Vec<Annotation> {
    let mut anns = Vec::new();
    let Ok(Some(intervals)) = h5.resolve_path("/intervals") else {
        return anns;
    };
    let Ok(tables) = h5.list_group(intervals) else {
        return anns;
    };
    for (table_name, table_addr) in tables {
        let Ok(cols) = h5.list_group(table_addr) else {
            continue;
        };
        let (Some(&start_addr), Some(&stop_addr)) = (cols.get("start_time"), cols.get("stop_time"))
        else {
            continue;
        };
        let (Ok(starts), Ok(stops)) = (
            h5.read_1d_f64(start_addr, 10_000),
            h5.read_1d_f64(stop_addr, 10_000),
        ) else {
            continue;
        };
        let labels = ["label", "tags", "condition", "trial_type"]
            .iter()
            .find_map(|k| cols.get(*k))
            .and_then(|&addr| h5.read_1d_strings(addr, starts.len()).ok());
        for (i, (&s, &e)) in starts.iter().zip(&stops).enumerate() {
            if s.is_finite() && e.is_finite() {
                let label = labels
                    .as_ref()
                    .and_then(|v| v.get(i))
                    .filter(|l| !l.is_empty())
                    .cloned()
                    .unwrap_or_else(|| format!("{table_name}_{i}"));
                anns.push(Annotation {
                    onset_s: s,
                    duration_s: (e - s).max(0.0),
                    label,
                    source: format!("NWB:{table_name}"),
                });
            }
        }
    }
    anns
}

pub fn open_nwb(files: &FileSet, name: &str) -> Result<Box<dyn Reader>> {
    let source = files
        .source(name)
        .ok_or_else(|| DDAError::FileNotFound(name.to_string()))?
        .clone();
    let h5 = H5File::open(source.clone(), name)?;
    let (series_path, series_group, data_addr) = find_electrical_series(&h5)?;
    let data_hdr = h5.read_object(data_addr)?;
    let dims = data_hdr
        .dims
        .as_ref()
        .ok_or_else(|| malformed(format!("{name}: {series_path}/data missing dataspace")))?;
    let dtype = data_hdr
        .dtype
        .clone()
        .ok_or_else(|| malformed(format!("{name}: {series_path}/data missing datatype")))?;
    let elem_size = dtype.elem_size(h5.cfg);
    let sample_count = dims[0];
    let n_channels = dims[1] as usize;
    let sample_rate_hz = resolve_sample_rate(&h5, series_group, &series_path)?;

    let conversion = match data_hdr.attributes.get("conversion") {
        Some(AttrValue::Float(v)) if v.is_finite() && *v != 0.0 => *v,
        _ => 1.0,
    };
    let offset = match data_hdr.attributes.get("offset") {
        Some(AttrValue::Float(v)) if v.is_finite() => *v,
        _ => 0.0,
    };
    let raw_unit = match data_hdr.attributes.get("unit") {
        Some(AttrValue::String(s)) => s.as_str(),
        _ => "volts",
    };
    let (si_u, si_factor) = nwb_si_unit(raw_unit);
    let gain = conversion * si_factor;
    let scaled_offset = offset * si_factor;

    let storage = match data_hdr.layout.clone() {
        Some(DataLayout::Compact(bytes)) => Storage::Compact(bytes),
        Some(DataLayout::Contiguous { addr, .. }) => {
            if h5.cfg.is_undef(addr) {
                return Err(unsupported(format!(
                    "{name}: {series_path}/data has unallocated contiguous storage"
                )));
            }
            Storage::Contiguous { addr }
        }
        Some(DataLayout::ChunkedV3 {
            btree_addr,
            chunk_dims,
        }) => {
            if chunk_dims.len() < 2 {
                return Err(malformed("chunked 2-D dataset has fewer than 2 chunk dims"));
            }
            let mut chunks = BTreeMap::new();
            h5.walk_chunk_btree(btree_addr, chunk_dims.len(), &mut chunks, 0)?;
            Storage::Chunked {
                chunk_rows: chunk_dims[0],
                chunk_cols: chunk_dims[1],
                chunks,
                filters: data_hdr.filters.clone(),
                cache: Mutex::new(Vec::new()),
            }
        }
        Some(DataLayout::ChunkedSingle {
            addr,
            size,
            chunk_dims,
        }) => {
            let chunk_rows = chunk_dims.first().copied().unwrap_or(sample_count);
            let chunk_cols = chunk_dims.get(1).copied().unwrap_or(n_channels as u64);
            let byte_size = if size > 0 {
                size as u32
            } else {
                (chunk_rows * chunk_cols * elem_size as u64) as u32
            };
            let mut chunks = BTreeMap::new();
            chunks.insert((0, 0), ChunkLoc { addr, byte_size });
            Storage::Chunked {
                chunk_rows,
                chunk_cols,
                chunks,
                filters: data_hdr.filters.clone(),
                cache: Mutex::new(Vec::new()),
            }
        }
        Some(DataLayout::ChunkedImplicit { addr, chunk_dims }) => {
            let chunk_rows = chunk_dims.first().copied().unwrap_or(sample_count);
            let chunk_cols = chunk_dims.get(1).copied().unwrap_or(n_channels as u64);
            let row_chunks = sample_count.div_ceil(chunk_rows);
            let col_chunks = (n_channels as u64).div_ceil(chunk_cols);
            let chunk_bytes = chunk_rows * chunk_cols * elem_size as u64;
            let mut chunks = BTreeMap::new();
            let mut cur_addr = addr;
            for rc in 0..row_chunks {
                for cc in 0..col_chunks {
                    chunks.insert(
                        (rc * chunk_rows, cc * chunk_cols),
                        ChunkLoc {
                            addr: cur_addr,
                            byte_size: chunk_bytes as u32,
                        },
                    );
                    cur_addr += chunk_bytes;
                }
            }
            Storage::Chunked {
                chunk_rows,
                chunk_cols,
                chunks,
                filters: data_hdr.filters.clone(),
                cache: Mutex::new(Vec::new()),
            }
        }
        None => {
            return Err(malformed(format!(
                "{name}: {series_path}/data missing data layout"
            )));
        }
    };

    let labels = resolve_electrode_labels(&h5, series_group, n_channels);
    let channels: Vec<ChannelInfo> = labels
        .into_iter()
        .map(|label| ChannelInfo {
            label,
            unit: si_u.to_string(),
            sample_rate_hz,
            gain,
            offset: scaled_offset,
            kind: ChannelKind::Signal,
            bids_status: None,
            bids_type: None,
        })
        .collect();

    let annotations = read_intervals(&h5);
    let raw_type = dtype.raw_type();
    let info = RecordingInfo {
        reference: None,
        format: "NWB".to_string(),
        channels,
        sample_rate_hz,
        sample_count,
        duration_s: sample_count as f64 / sample_rate_hz,
        raw_type,
        annotations,
        warnings: Vec::new(),
        input_files: vec![name.to_string()],
    };

    Ok(Box::new(NwbReader {
        info,
        source,
        cfg: h5.cfg,
        dtype,
        elem_size,
        n_channels,
        storage,
    }))
}

impl NwbReader {
    fn check_request(&self, channels: &[usize], row0: u64, rows: usize) -> Result<u64> {
        for &c in channels {
            if c >= self.n_channels {
                return Err(DDAError::InvalidParameter(format!(
                    "channel index {c} out of range (recording has {} channels)",
                    self.n_channels
                )));
            }
        }
        let end = row0
            .checked_add(rows as u64)
            .ok_or_else(|| DDAError::InvalidParameter("row range overflow".to_string()))?;
        if end > self.info.sample_count {
            return Err(DDAError::InvalidParameter(format!(
                "requested rows {row0}..{end} exceed sample count {}",
                self.info.sample_count
            )));
        }
        Ok(end)
    }

    fn read_chunk(
        &self,
        key: (u64, u64),
        loc: ChunkLoc,
        filters: &[FilterSpec],
        cache: &Mutex<Vec<((u64, u64), Arc<Vec<u8>>)>>,
    ) -> Result<Arc<Vec<u8>>> {
        if let Ok(guard) = cache.lock() {
            if let Some((_, data)) = guard.iter().find(|(k, _)| *k == key) {
                return Ok(data.clone());
            }
        }
        let off = self.cfg.file_offset(loc.addr)?;
        let mut raw = vec![0u8; loc.byte_size as usize];
        self.source.read_at(off, &mut raw)?;
        let decoded = Arc::new(apply_filters_reverse(raw, filters, self.elem_size)?);
        if let Ok(mut guard) = cache.lock() {
            if guard.len() >= MAX_CHUNK_CACHE {
                guard.remove(0);
            }
            guard.push((key, decoded.clone()));
        }
        Ok(decoded)
    }

    fn decode(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        mut emit: impl FnMut(usize, usize, f64),
    ) -> Result<()> {
        let end = self.check_request(channels, row0, rows)?;
        if rows == 0 || channels.is_empty() {
            return Ok(());
        }
        let frame_bytes = self.n_channels * self.elem_size;
        match &self.storage {
            Storage::Compact(bytes) => {
                for r in 0..rows {
                    let row_off = (row0 as usize + r) * frame_bytes;
                    for (k, &ch) in channels.iter().enumerate() {
                        let off = row_off + ch * self.elem_size;
                        let val = self.dtype.decode_f64(&bytes[off..off + self.elem_size]);
                        emit(r, k, val);
                    }
                }
            }
            Storage::Contiguous { addr } => {
                let start_off = self.cfg.file_offset(*addr)? + row0 * frame_bytes as u64;
                let mut buf = vec![0u8; rows * frame_bytes];
                self.source.read_at(start_off, &mut buf)?;
                for r in 0..rows {
                    let row_off = r * frame_bytes;
                    for (k, &ch) in channels.iter().enumerate() {
                        let off = row_off + ch * self.elem_size;
                        let val = self.dtype.decode_f64(&buf[off..off + self.elem_size]);
                        emit(r, k, val);
                    }
                }
            }
            Storage::Chunked {
                chunk_rows,
                chunk_cols,
                chunks,
                filters,
                cache,
            } => {
                let first_rc = row0 / *chunk_rows;
                let last_rc = (end - 1) / *chunk_rows;
                let col_groups: Vec<u64> = {
                    let mut set = std::collections::BTreeSet::new();
                    for &ch in channels {
                        set.insert((ch as u64) / *chunk_cols);
                    }
                    set.into_iter().collect()
                };
                for rc in first_rc..=last_rc {
                    let c_row0 = rc * *chunk_rows;
                    let r_start = row0.max(c_row0);
                    let r_end = end.min(c_row0 + *chunk_rows);
                    for &cc in &col_groups {
                        let c_col0 = cc * *chunk_cols;
                        let key = (c_row0, c_col0);
                        let chunk_data = match chunks.get(&key) {
                            Some(&loc) => Some(self.read_chunk(key, loc, filters, cache)?),
                            None => None,
                        };
                        let chunk_stride = (*chunk_cols as usize) * self.elem_size;
                        for (k, &ch) in channels.iter().enumerate() {
                            let ch_u = ch as u64;
                            if ch_u < c_col0 || ch_u >= c_col0 + *chunk_cols {
                                continue;
                            }
                            let rel_c = (ch_u - c_col0) as usize;
                            for r in r_start..r_end {
                                let rel_r = (r - c_row0) as usize;
                                let val = match &chunk_data {
                                    Some(data) => {
                                        let off = rel_r * chunk_stride + rel_c * self.elem_size;
                                        if off + self.elem_size <= data.len() {
                                            self.dtype.decode_f64(&data[off..off + self.elem_size])
                                        } else {
                                            0.0
                                        }
                                    }
                                    None => 0.0,
                                };
                                emit((r - row0) as usize, k, val);
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

impl Reader for NwbReader {
    fn info(&self) -> &RecordingInfo {
        &self.info
    }

    fn read_rows(&self, channels: &[usize], row0: u64, rows: usize) -> Result<Vec<Vec<f64>>> {
        let mut out = vec![vec![0.0; channels.len()]; rows];
        self.decode(channels, row0, rows, |r, k, raw| {
            let ch = &self.info.channels[channels[k]];
            out[r][k] = raw * ch.gain + ch.offset;
        })?;
        Ok(out)
    }

    fn read_raw_f32(
        &self,
        channels: &[usize],
        row0: u64,
        rows: usize,
        out: &mut [f32],
    ) -> Result<()> {
        if out.len() != rows * channels.len() {
            return Err(DDAError::InvalidParameter(format!(
                "output holds {} values, but {rows} rows of {} channels need {}",
                out.len(),
                channels.len(),
                rows * channels.len()
            )));
        }
        self.decode(channels, row0, rows, |r, k, raw| {
            out[r * channels.len() + k] = raw as f32;
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemorySource;

    /// Minimal HDF5 v2 writer for unit-testing NWB ElectricalSeries (both contiguous and deflate+shuffle chunked).
    struct MiniH5 {
        buf: Vec<u8>,
    }

    impl MiniH5 {
        fn new() -> Self {
            // Reserve 48 bytes for v2 superblock (8 sig + 4 meta + 4*8 addrs + 4 checksum).
            Self { buf: vec![0u8; 48] }
        }

        fn push_raw(&mut self, data: &[u8]) -> u64 {
            let off = self.buf.len() as u64;
            self.buf.extend_from_slice(data);
            off
        }

        fn push_ohdr_v2(&mut self, messages: &[(u8, Vec<u8>)]) -> u64 {
            let off = self.buf.len() as u64;
            let mut body = Vec::new();
            for (ty, payload) in messages {
                body.push(*ty);
                body.extend_from_slice(&(payload.len() as u16).to_le_bytes());
                body.push(0u8); // flags
                body.extend_from_slice(payload);
            }
            self.buf.extend_from_slice(b"OHDR");
            self.buf.push(2); // version
            self.buf.push(0x01); // flags: 2-byte chunk0 size
            self.buf.extend_from_slice(&(body.len() as u16).to_le_bytes());
            self.buf.extend_from_slice(&body);
            self.buf.extend_from_slice(&0u32.to_le_bytes()); // checksum placeholder
            off
        }

        fn msg_link(name: &str, target: u64) -> (u8, Vec<u8>) {
            let mut p = Vec::new();
            p.push(1); // version
            p.push(0); // flags: hard link, 1-byte name len
            p.push(name.len() as u8);
            p.extend_from_slice(name.as_bytes());
            p.extend_from_slice(&target.to_le_bytes());
            (MSG_LINK as u8, p)
        }

        fn msg_dataspace(dims: &[u64]) -> (u8, Vec<u8>) {
            let mut p = Vec::new();
            p.push(2); // version
            p.push(dims.len() as u8);
            p.push(0); // flags
            p.push(if dims.is_empty() { 0 } else { 1 }); // scalar or simple
            for &d in dims {
                p.extend_from_slice(&d.to_le_bytes());
            }
            (MSG_DATASPACE as u8, p)
        }

        fn dtype_f64() -> Vec<u8> {
            let mut p = vec![0u8; 20];
            p[0] = (1 << 4) | 1; // v1, class 1 (float)
            p[1] = 0x20; // LE IEEE
            p[4..8].copy_from_slice(&8u32.to_le_bytes());
            p
        }

        fn dtype_i16() -> Vec<u8> {
            let mut p = vec![0u8; 12];
            p[0] = (1 << 4) | 0; // v1, class 0 (int)
            p[1] = 0x08; // LE, signed
            p[4..8].copy_from_slice(&2u32.to_le_bytes());
            p
        }

        fn dtype_fixed_str(size: usize) -> Vec<u8> {
            let mut p = vec![0u8; 8];
            p[0] = (1 << 4) | 3; // v1, class 3 (string)
            p[4..8].copy_from_slice(&(size as u32).to_le_bytes());
            p
        }

        fn msg_attr_f64(name: &str, val: f64) -> (u8, Vec<u8>) {
            let dt = Self::dtype_f64();
            let ds = Self::msg_dataspace(&[]).1;
            let mut p = Vec::new();
            p.push(2); // version
            p.push(0); // flags
            p.extend_from_slice(&(name.len() as u16 + 1).to_le_bytes());
            p.extend_from_slice(&(dt.len() as u16).to_le_bytes());
            p.extend_from_slice(&(ds.len() as u16).to_le_bytes());
            p.extend_from_slice(name.as_bytes());
            p.push(0);
            p.extend_from_slice(&dt);
            p.extend_from_slice(&ds);
            p.extend_from_slice(&val.to_le_bytes());
            (MSG_ATTRIBUTE as u8, p)
        }

        fn msg_attr_str(name: &str, val: &str) -> (u8, Vec<u8>) {
            let dt = Self::dtype_fixed_str(val.len());
            let ds = Self::msg_dataspace(&[]).1;
            let mut p = Vec::new();
            p.push(2);
            p.push(0);
            p.extend_from_slice(&(name.len() as u16 + 1).to_le_bytes());
            p.extend_from_slice(&(dt.len() as u16).to_le_bytes());
            p.extend_from_slice(&(ds.len() as u16).to_le_bytes());
            p.extend_from_slice(name.as_bytes());
            p.push(0);
            p.extend_from_slice(&dt);
            p.extend_from_slice(&ds);
            p.extend_from_slice(val.as_bytes());
            (MSG_ATTRIBUTE as u8, p)
        }

        fn msg_layout_contiguous(addr: u64, size: u64) -> (u8, Vec<u8>) {
            let mut p = Vec::new();
            p.push(3); // version
            p.push(1); // contiguous
            p.extend_from_slice(&addr.to_le_bytes());
            p.extend_from_slice(&size.to_le_bytes());
            (MSG_DATA_LAYOUT as u8, p)
        }

        fn msg_layout_single_chunk(addr: u64, filtered_size: u64, chunk_dims: &[u64]) -> (u8, Vec<u8>) {
            let mut p = Vec::new();
            p.push(4); // version
            p.push(2); // chunked
            p.push(0x02); // SINGLE_INDEX_WITH_FILTER
            p.push(chunk_dims.len() as u8);
            p.push(4); // 4-byte chunk dims
            for &d in chunk_dims {
                p.extend_from_slice(&(d as u32).to_le_bytes());
            }
            p.push(1); // single chunk index type
            p.extend_from_slice(&filtered_size.to_le_bytes());
            p.extend_from_slice(&0u32.to_le_bytes()); // filter mask
            p.extend_from_slice(&addr.to_le_bytes());
            (MSG_DATA_LAYOUT as u8, p)
        }

        fn msg_filter_shuffle_deflate(elem_size: u32) -> (u8, Vec<u8>) {
            let mut p = Vec::new();
            p.push(2); // v2
            p.push(2); // 2 filters: shuffle then deflate
            // Filter 1: Shuffle (id=2)
            p.extend_from_slice(&FILTER_SHUFFLE.to_le_bytes());
            p.extend_from_slice(&0u16.to_le_bytes()); // flags
            p.extend_from_slice(&1u16.to_le_bytes()); // 1 client datum
            p.extend_from_slice(&elem_size.to_le_bytes());
            // Filter 2: Deflate (id=1)
            p.extend_from_slice(&FILTER_DEFLATE.to_le_bytes());
            p.extend_from_slice(&0u16.to_le_bytes());
            p.extend_from_slice(&1u16.to_le_bytes());
            p.extend_from_slice(&6u32.to_le_bytes());
            (MSG_FILTER_PIPELINE as u8, p)
        }

        fn finish(mut self, root_addr: u64) -> Vec<u8> {
            let eof = self.buf.len() as u64;
            self.buf[0..8].copy_from_slice(&HDF5_SIGNATURE);
            self.buf[8] = 2; // superblock v2
            self.buf[9] = 8; // offset size
            self.buf[10] = 8; // length size
            self.buf[11] = 0;
            self.buf[12..20].copy_from_slice(&0u64.to_le_bytes()); // base_addr
            self.buf[20..28].copy_from_slice(&UNDEF_ADDR_64.to_le_bytes()); // ext_addr
            self.buf[28..36].copy_from_slice(&eof.to_le_bytes());
            self.buf[36..44].copy_from_slice(&root_addr.to_le_bytes());
            self.buf
        }
    }

    fn build_nwb(compressed: bool) -> Vec<u8> {
        let mut h5 = MiniH5::new();
        // 8 samples x 2 channels of i16, conversion = 1e-6 V
        let mut raw_samples = Vec::new();
        for s in 0..8i16 {
            raw_samples.extend_from_slice(&(s * 10).to_le_bytes());
            raw_samples.extend_from_slice(&(-s * 5).to_le_bytes());
        }

        let data_addr = if compressed {
            // Apply shuffle (width 2) then zlib deflate
            let count = raw_samples.len() / 2;
            let mut shuffled = vec![0u8; raw_samples.len()];
            for i in 0..count {
                shuffled[i] = raw_samples[2 * i];
                shuffled[count + i] = raw_samples[2 * i + 1];
            }
            let z = miniz_oxide::deflate::compress_to_vec_zlib(&shuffled, 6);
            let payload_off = h5.push_raw(&z);
            h5.push_ohdr_v2(&[
                MiniH5::msg_dataspace(&[8, 2]),
                (MSG_DATATYPE as u8, MiniH5::dtype_i16()),
                MiniH5::msg_filter_shuffle_deflate(2),
                MiniH5::msg_layout_single_chunk(payload_off, z.len() as u64, &[8, 2]),
                MiniH5::msg_attr_f64("conversion", 1e-6),
                MiniH5::msg_attr_str("unit", "volts"),
            ])
        } else {
            let payload_off = h5.push_raw(&raw_samples);
            h5.push_ohdr_v2(&[
                MiniH5::msg_dataspace(&[8, 2]),
                (MSG_DATATYPE as u8, MiniH5::dtype_i16()),
                MiniH5::msg_layout_contiguous(payload_off, raw_samples.len() as u64),
                MiniH5::msg_attr_f64("conversion", 1e-6),
                MiniH5::msg_attr_str("unit", "volts"),
            ])
        };

        let st_off = h5.push_raw(&0.0f64.to_le_bytes());
        let st_addr = h5.push_ohdr_v2(&[
            MiniH5::msg_dataspace(&[]),
            (MSG_DATATYPE as u8, MiniH5::dtype_f64()),
            MiniH5::msg_layout_contiguous(st_off, 8),
            MiniH5::msg_attr_f64("rate", 500.0),
        ]);

        let es_addr = h5.push_ohdr_v2(&[
            MiniH5::msg_attr_str("neurodata_type", "ElectricalSeries"),
            MiniH5::msg_link("data", data_addr),
            MiniH5::msg_link("starting_time", st_addr),
        ]);
        let acq_addr = h5.push_ohdr_v2(&[MiniH5::msg_link("ElectricalSeries", es_addr)]);

        // Electrode labels: ["ECoG1", "ECoG2"]
        let label_off = h5.push_raw(b"ECoG1ECoG2");
        let label_ds = h5.push_ohdr_v2(&[
            MiniH5::msg_dataspace(&[2]),
            (MSG_DATATYPE as u8, MiniH5::dtype_fixed_str(5)),
            MiniH5::msg_layout_contiguous(label_off, 10),
        ]);
        let elec_grp = h5.push_ohdr_v2(&[MiniH5::msg_link("label", label_ds)]);
        let ecephys_grp = h5.push_ohdr_v2(&[MiniH5::msg_link("electrodes", elec_grp)]);
        let gen_grp = h5.push_ohdr_v2(&[MiniH5::msg_link("extracellular_ephys", ecephys_grp)]);

        let root_addr = h5.push_ohdr_v2(&[
            MiniH5::msg_link("acquisition", acq_addr),
            MiniH5::msg_link("general", gen_grp),
        ]);
        h5.finish(root_addr)
    }

    #[test]
    fn nwb_reads_contiguous_and_deflate_shuffled_electrical_series() {
        for compressed in [false, true] {
            let bytes = build_nwb(compressed);
            let mut files = BTreeMap::new();
            files.insert(
                "sub-01_ieeg.nwb".to_string(),
                Arc::new(MemorySource(bytes)) as Arc<dyn ByteSource>,
            );
            let set = FileSet {
                primary: "sub-01_ieeg.nwb".to_string(),
                files,
            };
            let reader = open_nwb(&set, "sub-01_ieeg.nwb").unwrap();
            let info = reader.info();
            assert_eq!(info.format, "NWB");
            assert_eq!(info.sample_rate_hz, 500.0);
            assert_eq!(info.sample_count, 8);
            assert_eq!(info.channels[0].label, "ECoG1");
            assert_eq!(info.channels[1].label, "ECoG2");
            assert_eq!(info.channels[0].unit, "V");

            let rows = reader.read_rows(&[0, 1], 2, 4).unwrap();
            assert_eq!(rows.len(), 4);
            for (i, row) in rows.iter().enumerate() {
                let s = (i + 2) as f64;
                assert!((row[0] - s * 10e-6).abs() < 1e-12, "compressed={compressed} row {i}");
                assert!((row[1] - (-s * 5e-6)).abs() < 1e-12, "compressed={compressed} row {i}");
            }
        }
    }
}
