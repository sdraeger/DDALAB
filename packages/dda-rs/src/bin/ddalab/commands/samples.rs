use super::open_reader;
use crate::cli::SamplesArgs;
use crate::exit_codes;
use dda_rs::document::npy_header;
use dda_rs::io::Reader;
use std::io::Write;

/// Bytes of samples read at a time.
const CHUNK_BYTES: usize = 8 << 20;

pub fn execute(args: SamplesArgs) -> i32 {
    let reader = match open_reader(&args.file, args.sr) {
        Ok(reader) => reader,
        Err(code) => return code,
    };
    let info = reader.info();
    let analysis = info.analysis_channels();
    let mut channels = Vec::new();
    for &index in &args.channels {
        match analysis.get(index) {
            Some(&channel) => channels.push(channel),
            None => {
                eprintln!(
                    "Error: channel {index} is out of range: {} has {} analysis channels",
                    args.file,
                    analysis.len()
                );
                return exit_codes::INPUT_ERROR;
            }
        }
    }
    let end = args.start_sample.checked_add(args.count as u64);
    if !end.is_some_and(|end| end <= info.sample_count) {
        eprintln!(
            "Error: {} samples from sample {} exceeds the {} samples of {}",
            args.count, args.start_sample, info.sample_count, args.file
        );
        return exit_codes::INPUT_ERROR;
    }

    // A failure removes the output only once this command has created it.
    let file = match std::fs::File::create(&args.output) {
        Ok(file) => file,
        Err(error) => {
            eprintln!("Error: {}: {error}", args.output);
            return exit_codes::EXECUTION_ERROR;
        }
    };
    if let Err(error) = write_npy(file, &*reader, &channels, &args) {
        eprintln!("Error: {}: {error}", args.output);
        let _ = std::fs::remove_file(&args.output);
        return exit_codes::EXECUTION_ERROR;
    }
    exit_codes::SUCCESS
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
