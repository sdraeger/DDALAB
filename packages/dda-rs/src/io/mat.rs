//! MATLAB MAT-files of version 5, as `save -v6` and `save -v7` write them (the second zlib-compressed): their variables
//! as numeric arrays, char arrays and structs. The file is walked through its byte source: a numeric array is a window
//! onto the bytes that hold it, read when asked for, so an uncompressed file's samples stream like any recording's. A
//! compressed variable is inflated into memory whole. Little-endian files only, which every MATLAB on x86 and ARM
//! writes. Version 7.3 files are HDF5 and are refused with a way out.

use super::{ByteSource, MemorySource};
use crate::error::{DDAError, Result};
use std::sync::Arc;

/// The most a compressed variable may inflate to: a file cannot claim more memory than this.
const MAX_INFLATED: usize = 1 << 31;
/// The most bytes a name, a dimension list or a char array may take; a larger char array reads as empty.
const MAX_SMALL: u64 = 1 << 24;
/// How deep structs may nest.
const MAX_DEPTH: usize = 32;

fn malformed(what: &str) -> DDAError {
    DDAError::UnsupportedFileType(format!("malformed MAT-file: {what}"))
}

/// How a numeric array stores its values (MAT data types 1 to 13).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Storage {
    I8,
    U8,
    I16,
    U16,
    I32,
    U32,
    F32,
    F64,
    I64,
    U64,
}

impl Storage {
    fn of(data_type: u32) -> Option<Self> {
        Some(match data_type {
            1 => Self::I8,
            2 => Self::U8,
            3 => Self::I16,
            4 => Self::U16,
            5 => Self::I32,
            6 => Self::U32,
            7 => Self::F32,
            9 => Self::F64,
            12 => Self::I64,
            13 => Self::U64,
            _ => return None,
        })
    }

    pub fn width(self) -> usize {
        match self {
            Self::I8 | Self::U8 => 1,
            Self::I16 | Self::U16 => 2,
            Self::I32 | Self::U32 | Self::F32 => 4,
            Self::F64 | Self::I64 | Self::U64 => 8,
        }
    }

    /// The value in the first `self.width()` bytes of `b`.
    pub fn decode(self, b: &[u8]) -> f64 {
        let n = self.width();
        let mut bytes = [0u8; 8];
        bytes[..n].copy_from_slice(&b[..n]);
        match self {
            Self::I8 => bytes[0] as i8 as f64,
            Self::U8 => bytes[0] as f64,
            Self::I16 => i16::from_le_bytes([bytes[0], bytes[1]]) as f64,
            Self::U16 => u16::from_le_bytes([bytes[0], bytes[1]]) as f64,
            Self::I32 => i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64,
            Self::U32 => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64,
            Self::F32 => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64,
            Self::F64 => f64::from_le_bytes(bytes),
            Self::I64 => i64::from_le_bytes(bytes) as f64,
            Self::U64 => u64::from_le_bytes(bytes) as f64,
        }
    }
}

/// Bytes `offset..offset + len` of `source`, a byte source of their own.
pub struct Window {
    source: Arc<dyn ByteSource>,
    offset: u64,
    len: u64,
}

impl ByteSource for Window {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> Result<()> {
        match offset.checked_add(buf.len() as u64) {
            Some(end) if end <= self.len => self.source.read_at(self.offset + offset, buf),
            _ => Err(DDAError::InvalidParameter(format!(
                "read past end of a MAT-file array: offset {offset} + {} > {}",
                buf.len(),
                self.len
            ))),
        }
    }
}

/// A variable's value. Arrays are column-major; a struct array holds `values[element][field]`.
pub enum Mat {
    Numeric {
        dims: Vec<usize>,
        storage: Storage,
        /// The real part as stored, little-endian.
        data: Arc<Window>,
    },
    Char(String),
    Struct {
        fields: Vec<String>,
        values: Vec<Vec<Mat>>,
    },
    /// An empty matrix, or a class this reader leaves out (cells, sparse arrays, objects, function handles).
    Empty,
}

impl Mat {
    /// The elements of a struct array, each as its fields by name.
    pub fn elements(&self) -> Vec<Vec<(&str, &Mat)>> {
        match self {
            Mat::Struct { fields, values } => values
                .iter()
                .map(|element| fields.iter().map(String::as_str).zip(element).collect())
                .collect(),
            _ => Vec::new(),
        }
    }

    /// The first value of a numeric array; `None` where it holds none or it cannot be read.
    pub fn number(&self) -> Option<f64> {
        match self {
            Mat::Numeric { storage, data, .. } => {
                let mut bytes = [0u8; 8];
                let first = &mut bytes[..storage.width()];
                data.read_at(0, first).ok()?;
                Some(storage.decode(first))
            }
            _ => None,
        }
    }

    /// A char array as its text, or a numeric scalar as its number printed (integers without a fraction).
    pub fn text(&self) -> Option<String> {
        match self {
            Mat::Char(text) => Some(text.clone()),
            _ => self.number().map(|v| {
                if v.fract() == 0.0 && v.abs() < 1e15 {
                    format!("{}", v as i64)
                } else {
                    format!("{v}")
                }
            }),
        }
    }
}

/// A run of data elements in `source`, from `at` to `end`; elements other than compressed ones take a multiple of 8
/// bytes.
struct Elements<'a> {
    source: &'a Arc<dyn ByteSource>,
    at: u64,
    end: u64,
}

/// A data element: its type and where its data lie in the source.
struct Element {
    data_type: u32,
    start: u64,
    len: u64,
}

impl<'a> Elements<'a> {
    fn new(source: &'a Arc<dyn ByteSource>, start: u64, len: u64) -> Self {
        Self {
            source,
            at: start,
            end: start + len,
        }
    }

    fn done(&self) -> bool {
        self.at + 8 > self.end
    }

    fn next(&mut self) -> Result<Element> {
        if self.done() {
            return Err(malformed("a data element is cut short"));
        }
        let mut tag = [0u8; 8];
        self.source.read_at(self.at, &mut tag)?;
        let first = u32::from_le_bytes([tag[0], tag[1], tag[2], tag[3]]);
        if first >> 16 != 0 {
            // Small data element: type and size in one word, up to 4 bytes of data in the next.
            let len = (first >> 16) as u64;
            if len > 4 {
                return Err(malformed("a small data element claims more than 4 bytes"));
            }
            let element = Element {
                data_type: first & 0xffff,
                start: self.at + 4,
                len,
            };
            self.at += 8;
            return Ok(element);
        }
        let len = u32::from_le_bytes([tag[4], tag[5], tag[6], tag[7]]) as u64;
        let start = self.at + 8;
        if start + len > self.end {
            return Err(malformed("a data element passes the end of its array"));
        }
        let used = if first == 15 {
            len
        } else {
            len.next_multiple_of(8)
        };
        self.at = (start + used).min(self.end).max(start + len);
        Ok(Element {
            data_type: first,
            start,
            len,
        })
    }

    /// The bytes of `element`, which must be small.
    fn bytes(&self, element: &Element) -> Result<Vec<u8>> {
        if element.len > MAX_SMALL {
            return Err(malformed("a name or dimension list is too long"));
        }
        let mut bytes = vec![0u8; element.len as usize];
        self.source.read_at(element.start, &mut bytes)?;
        Ok(bytes)
    }
}

/// A file's variables, by name, in file order.
pub fn read_mat(source: &Arc<dyn ByteSource>) -> Result<Vec<(String, Mat)>> {
    let mut header = [0u8; 128];
    if source.len() < 128 {
        return Err(malformed("shorter than its 128-byte header"));
    }
    source.read_at(0, &mut header)?;
    if header.starts_with(b"MATLAB 7.3") {
        return Err(DDAError::UnsupportedFileType(
            "MAT-files of version 7.3 (HDF5) are not supported; save the file again as version 7 (in EEGLAB, \
             pop_saveset with 'version', '7')"
                .to_string(),
        ));
    }
    match &header[126..128] {
        b"IM" => {}
        b"MI" => {
            return Err(DDAError::UnsupportedFileType(
                "big-endian MAT-files are not supported".to_string(),
            ))
        }
        _ => return Err(malformed("its header has no byte-order mark")),
    }
    let mut elements = Elements::new(source, 128, source.len() - 128);
    let mut variables = Vec::new();
    while !elements.done() {
        let element = elements.next()?;
        match element.data_type {
            14 => variables.push(matrix(source, &element, 0)?),
            15 => {
                if element.len > MAX_INFLATED as u64 {
                    return Err(malformed("a compressed variable is too large"));
                }
                let mut compressed = vec![0u8; element.len as usize];
                source.read_at(element.start, &mut compressed)?;
                let inflated = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(
                    &compressed,
                    MAX_INFLATED,
                )
                .map_err(|_| malformed("a compressed variable does not inflate"))?;
                drop(compressed);
                let memory: Arc<dyn ByteSource> = Arc::new(MemorySource(inflated));
                let mut inner = Elements::new(&memory, 0, memory.len());
                let first = inner.next()?;
                if first.data_type == 14 {
                    variables.push(matrix(&memory, &first, 0)?);
                }
            }
            _ => {}
        }
    }
    Ok(variables)
}

/// The elements a value of `dims` holds, refused past what `len` bytes could hold at 8 bytes each.
fn count(dims: &[usize], len: u64) -> Result<usize> {
    dims.iter()
        .try_fold(1usize, |n, &d| n.checked_mul(d))
        .filter(|&n| n as u64 <= len / 8 + 1)
        .ok_or_else(|| malformed("an array claims more elements than the file holds"))
}

/// The name and value of the miMATRIX element `matrix_element` of `source`.
fn matrix(
    source: &Arc<dyn ByteSource>,
    matrix_element: &Element,
    depth: usize,
) -> Result<(String, Mat)> {
    if matrix_element.len == 0 {
        return Ok((String::new(), Mat::Empty));
    }
    if depth > MAX_DEPTH {
        return Err(malformed("structs nest too deep"));
    }
    let mut elements = Elements::new(source, matrix_element.start, matrix_element.len);
    let flags = elements.next()?;
    let class = *elements
        .bytes(&flags)?
        .first()
        .ok_or_else(|| malformed("an array has no flags"))?;
    let dims = elements.next()?;
    let dims: Vec<usize> = elements
        .bytes(&dims)?
        .as_chunks::<4>()
        .0
        .iter()
        .map(|d| i32::from_le_bytes(*d).max(0) as usize)
        .collect();
    let name = elements.next()?;
    let name = String::from_utf8_lossy(&elements.bytes(&name)?).into_owned();
    let value = match class {
        2 => {
            let width = elements.next()?;
            let width = elements
                .bytes(&width)?
                .get(..4)
                .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]]) as usize)
                .filter(|&w| w > 0)
                .ok_or_else(|| malformed("a struct has no field name length"))?;
            let names = elements.next()?;
            let fields: Vec<String> = elements
                .bytes(&names)?
                .chunks(width)
                .map(|f| {
                    let end = f.iter().position(|&b| b == 0).unwrap_or(f.len());
                    String::from_utf8_lossy(&f[..end]).into_owned()
                })
                .collect();
            let n = if fields.is_empty() {
                0
            } else {
                count(&dims, matrix_element.len)?
            };
            let values = (0..n)
                .map(|_| {
                    fields
                        .iter()
                        .map(|_| {
                            let value = elements.next()?;
                            if value.data_type != 14 {
                                return Err(malformed(
                                    "a struct field holds something other than an array",
                                ));
                            }
                            Ok(matrix(source, &value, depth + 1)?.1)
                        })
                        .collect::<Result<Vec<_>>>()
                })
                .collect::<Result<Vec<_>>>()?;
            Mat::Struct { fields, values }
        }
        4 => {
            let text = elements.next()?;
            if text.len > MAX_SMALL {
                Mat::Empty
            } else {
                let bytes = elements.bytes(&text)?;
                let units: Vec<u32> = match text.data_type {
                    3 | 4 | 17 => bytes
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|c| u16::from_le_bytes(*c) as u32)
                        .collect(),
                    5 | 6 | 18 => bytes
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .map(|c| u32::from_le_bytes(*c))
                        .collect(),
                    _ => bytes.iter().map(|&b| b as u32).collect(),
                };
                Mat::Char(char_text(&units, &dims, text.data_type == 16))
            }
        }
        6..=15 => {
            let values = elements.next()?;
            let storage = Storage::of(values.data_type)
                .ok_or_else(|| malformed("a numeric array has an unknown storage type"))?;
            Mat::Numeric {
                dims,
                storage,
                data: Arc::new(Window {
                    source: source.clone(),
                    offset: values.start,
                    len: values.len,
                }),
            }
        }
        _ => Mat::Empty,
    };
    Ok((name, value))
}

/// The text of a char array: its rows (column-major in `units`) joined by newlines, each with trailing spaces cut.
/// UTF-8 storage decodes as such; other storage holds one code point (or UTF-16 unit) per element.
fn char_text(units: &[u32], dims: &[usize], utf8: bool) -> String {
    if utf8 {
        let bytes: Vec<u8> = units.iter().map(|&u| u as u8).collect();
        return String::from_utf8_lossy(&bytes).into_owned();
    }
    let rows = dims.first().copied().unwrap_or(1).max(1);
    if rows == 1 {
        return units.iter().filter_map(|&u| char::from_u32(u)).collect();
    }
    (0..rows)
        .map(|r| {
            let row: String = units
                .iter()
                .skip(r)
                .step_by(rows)
                .filter_map(|&u| char::from_u32(u))
                .collect();
            row.trim_end().to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(bytes: Vec<u8>) -> Arc<dyn ByteSource> {
        Arc::new(MemorySource(bytes))
    }

    #[test]
    fn version_7_3_is_refused_with_a_way_out() {
        let mut bytes = b"MATLAB 7.3 MAT-file, Platform: GLNXA64".to_vec();
        bytes.resize(512, 0);
        let error = read_mat(&source(bytes)).err().unwrap().to_string();
        assert!(error.contains("version 7.3"), "{error}");
    }

    #[test]
    fn a_short_or_unmarked_file_is_malformed() {
        assert!(read_mat(&source(b"MATLAB 5.0".to_vec())).is_err());
        assert!(read_mat(&source(vec![0u8; 200])).is_err());
    }

    #[test]
    fn storage_decodes_little_endian() {
        assert_eq!(Storage::I16.decode(&(-3i16).to_le_bytes()), -3.0);
        assert_eq!(Storage::F32.decode(&1.5f32.to_le_bytes()), 1.5);
        assert_eq!(Storage::U8.decode(&[200]), 200.0);
    }
}
