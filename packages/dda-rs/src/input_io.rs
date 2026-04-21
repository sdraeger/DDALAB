use crate::engine::{run_request_on_matrix_with_progress, PureRustProgress};
use crate::error::{DDAError, Result};
use crate::types::{DDARequest, DDAResult};
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

const PARALLEL_BATCH_MIN_LEN: usize = 4;

pub fn run_request_on_ascii_file<P: AsRef<Path>>(
    request: &DDARequest,
    path: P,
    start_bound: Option<u64>,
    end_bound: Option<u64>,
) -> Result<DDAResult> {
    run_request_on_ascii_file_with_progress(request, path, start_bound, end_bound, |_| {})
}

pub fn run_request_on_ascii_file_with_progress<P: AsRef<Path>, F>(
    request: &DDARequest,
    path: P,
    start_bound: Option<u64>,
    end_bound: Option<u64>,
    on_progress: F,
) -> Result<DDAResult>
where
    F: FnMut(&PureRustProgress),
{
    let samples = load_ascii_matrix_from_path(path)?;
    let mut adjusted_request = request.clone();
    if let (Some(start), Some(end)) = (start_bound, end_bound) {
        adjusted_request.time_range.start = start as f64;
        adjusted_request.time_range.end = end as f64;
    }
    run_request_on_matrix_with_progress(&adjusted_request, &samples, None, on_progress)
}

pub fn run_request_on_f64_matrix_file_with_progress<P: AsRef<Path>, F>(
    request: &DDARequest,
    path: P,
    rows: usize,
    cols: usize,
    channel_labels: Option<&[String]>,
    on_progress: F,
) -> Result<DDAResult>
where
    F: FnMut(&PureRustProgress),
{
    let samples = load_f64_matrix_from_path(path, rows, cols)?;
    run_request_on_matrix_with_progress(request, &samples, channel_labels, on_progress)
}

pub fn load_ascii_matrix_from_path<P: AsRef<Path>>(path: P) -> Result<Vec<Vec<f64>>> {
    let file = File::open(path.as_ref()).map_err(DDAError::IoError)?;
    let reader = BufReader::new(file);
    let mut rows = Vec::new();
    let mut expected_columns = None;

    for (line_idx, line) in reader.lines().enumerate() {
        let line = line.map_err(DDAError::IoError)?;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let row = trimmed
            .split(|c: char| c == ',' || c.is_ascii_whitespace())
            .filter(|token| !token.is_empty())
            .map(parse_ascii_token)
            .collect::<Result<Vec<_>>>()?;

        if row.is_empty() {
            continue;
        }

        match expected_columns {
            Some(expected) if expected != row.len() => {
                return Err(DDAError::ParseError(format!(
                    "ASCII row {} has {} columns but previous rows have {}",
                    line_idx + 1,
                    row.len(),
                    expected
                )));
            }
            None => expected_columns = Some(row.len()),
            _ => {}
        }

        rows.push(row);
    }

    if rows.is_empty() {
        return Err(DDAError::ParseError(
            "No numeric rows found in ASCII input".to_string(),
        ));
    }

    Ok(rows)
}

pub fn load_f64_matrix_from_path<P: AsRef<Path>>(
    path: P,
    rows: usize,
    cols: usize,
) -> Result<Vec<Vec<f64>>> {
    if rows == 0 || cols == 0 {
        return Err(DDAError::InvalidParameter(
            "Raw matrix input requires non-zero rows and columns".to_string(),
        ));
    }
    let mmap = crate::mmap_utils::mmap_file(path.as_ref())?;
    let expected_len = rows
        .checked_mul(cols)
        .and_then(|value| value.checked_mul(std::mem::size_of::<f64>()))
        .ok_or_else(|| {
            DDAError::InvalidParameter("Raw matrix dimensions overflow usize".to_string())
        })?;
    if mmap.len() != expected_len {
        return Err(DDAError::ParseError(format!(
            "Raw matrix file has {} bytes but {} were expected for a {}x{} f64 matrix",
            mmap.len(),
            expected_len,
            rows,
            cols
        )));
    }

    let row_byte_width = cols * std::mem::size_of::<f64>();
    let decode_row = |row_bytes: &[u8]| -> Result<Vec<f64>> {
        row_bytes
            .chunks_exact(std::mem::size_of::<f64>())
            .map(|chunk| {
                let bytes: [u8; 8] = chunk.try_into().map_err(|_| {
                    DDAError::ParseError("Could not decode raw matrix bytes".to_string())
                })?;
                Ok(f64::from_le_bytes(bytes))
            })
            .collect()
    };

    let rows_result: Vec<Result<Vec<f64>>> = if rows >= PARALLEL_BATCH_MIN_LEN {
        mmap.par_chunks_exact(row_byte_width)
            .map(decode_row)
            .collect()
    } else {
        mmap.chunks_exact(row_byte_width).map(decode_row).collect()
    };
    rows_result.into_iter().collect()
}

fn parse_ascii_token(token: &str) -> Result<f64> {
    if token.eq_ignore_ascii_case("nan") {
        return Ok(f64::NAN);
    }
    token.parse::<f64>().map_err(|_| {
        DDAError::ParseError(format!("Failed to parse ASCII numeric token '{}'", token))
    })
}
