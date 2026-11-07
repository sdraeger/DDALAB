use super::open;
use crate::cli::args::SamplesArgs;
use crate::cli::{execution_error, input_error, Failure};
use crate::document::npy_header;
use crate::io::Reader;
use std::io::Write;

/// Bytes of samples read at a time.
const CHUNK_BYTES: usize = 8 << 20;

pub fn execute(args: SamplesArgs) -> Result<(), Failure> {
    let reference = args.reference.parse().map_err(input_error)?;
    let (_, reader) = open(&args.file, args.sr, reference.as_ref()).map_err(input_error)?;
    let info = reader.info();
    let analysis = info.analysis_channels();
    let mut channels = Vec::new();
    for &index in &args.channels {
        match analysis.get(index) {
            Some(&channel) => channels.push(channel),
            None => {
                return Err(input_error(format!(
                    "channel {index} is out of range: {} has {} analysis channels",
                    args.file,
                    analysis.len()
                )));
            }
        }
    }
    let end = args.start_sample.checked_add(args.count as u64);
    if !end.is_some_and(|end| end <= info.sample_count) {
        return Err(input_error(format!(
            "{} samples from sample {} exceeds the {} samples of {}",
            args.count, args.start_sample, info.sample_count, args.file
        )));
    }

    // A failure removes the output only once this command has created it.
    let file = std::fs::File::create(&args.output)
        .map_err(|error| execution_error(format!("{}: {error}", args.output)))?;
    write_npy(file, &*reader, &channels, &args).map_err(|error| {
        let _ = std::fs::remove_file(&args.output);
        execution_error(format!("{}: {error}", args.output))
    })
}

/// `args.count` rows from `args.start_sample` of `channels` (indices into the reader's channels) as an `(count, channels)` array.
fn write_npy(
    file: std::fs::File,
    reader: &dyn Reader,
    channels: &[usize],
    args: &SamplesArgs,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut out = std::io::BufWriter::new(file);
    out.write_all(&npy_header(&[args.count, channels.len()]))?;
    let chunk_rows = (CHUNK_BYTES / (8 * channels.len())).max(1);
    let mut done = 0;
    while done < args.count {
        let rows = chunk_rows.min(args.count - done);
        for row in reader.read_rows(channels, args.start_sample + done as u64, rows)? {
            for value in row {
                out.write_all(&value.to_le_bytes())?;
            }
        }
        done += rows;
    }
    out.flush()?;
    Ok(())
}
