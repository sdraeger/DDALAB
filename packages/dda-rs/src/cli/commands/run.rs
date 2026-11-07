use super::open;
use crate::blocks::{
    check_block_support, merge_blocks, plan_blocks, run_block, validate_request, Block,
};
use crate::cli::args::{RangeArgs, RunArgs};
use crate::cli::{execution_error as execution, input_error as input, output, Failure};
use crate::document::{
    build_document, build_manifest, bundle_layout, encode_block, BundleLayout, BundleWriter,
    Provenance, ResultDocument,
};
use crate::io::{ByteSource, FileSet, Reader, RecordingInfo, Reference};
use crate::tiles::Sha256Stream;
use crate::{
    run_request_on_device, ComputeDevice, DDARequest, DDAResult, PureRustProgress, TimeRange,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Bytes of a file hashed at a time.
const HASH_SLICE: usize = 4 << 20;

/// One analysis of one recording: `request.file_path` read at `request.sampling_rate` (for text files). `analyze`
/// sets the request's time range from `range` and, when it names none, its channels.
pub struct Job {
    pub request: DDARequest,
    pub range: RangeArgs,
    /// The reference the recording opens with (`--reference`).
    pub reference: Option<Reference>,
    pub device: ComputeDevice,
    pub block_mb: u64,
    /// A directory to stream the result into as a bundle; the document returned is its manifest.
    pub bundle: Option<PathBuf>,
    pub progress: bool,
}

impl Job {
    /// The job `ddalab run` runs for `args`; a refusal is the message to print.
    pub fn of(args: &RunArgs) -> Result<Job, String> {
        Ok(Job {
            request: args.dda.request(&args.file)?,
            range: args.range.clone(),
            reference: args.dda.reference.parse()?,
            device: args.device,
            block_mb: args.block_mb,
            bundle: args.bundle.as_ref().map(PathBuf::from),
            progress: !args.quiet,
        })
    }
}

pub struct Analysis {
    pub document: ResultDocument,
    /// The recording's warnings, also in the document's diagnostics.
    pub warnings: Vec<String>,
}

/// The SHA-256 of `source`, hex.
fn sha256(source: &dyn ByteSource) -> crate::Result<String> {
    let mut hash = Sha256Stream::new();
    let mut slice = vec![0u8; HASH_SLICE];
    let mut offset = 0;
    while offset < source.len() {
        let n = slice.len().min((source.len() - offset) as usize);
        source.read_at(offset, &mut slice[..n])?;
        hash.update(&slice[..n]);
        offset += n as u64;
    }
    Ok(hash.hex())
}

/// Finished blocks go into the bundle files, or are kept to merge into one document.
struct Sink {
    parts: Vec<DDAResult>,
    bundle: Option<(BundleWriter, BundleLayout)>,
}

impl Sink {
    fn new(
        bundle: Option<&Path>,
        request: &DDARequest,
        info: &RecordingInfo,
        windows: usize,
    ) -> Result<Self, Failure> {
        let bundle = bundle
            .map(|dir| {
                let layout = bundle_layout(request, info, windows)?;
                Ok::<_, crate::DDAError>((BundleWriter::create(dir, &layout)?, layout))
            })
            .transpose()
            .map_err(execution)?;
        Ok(Self {
            parts: Vec::new(),
            bundle,
        })
    }

    fn add(&mut self, block: &Block, part: DDAResult) -> Result<(), Failure> {
        match &mut self.bundle {
            Some((writer, layout)) => writer
                .write(encode_block(layout, block, &part))
                .map_err(execution),
            None => {
                self.parts.push(part);
                Ok(())
            }
        }
    }
}

impl RangeArgs {
    /// The first and last sample of this range on `info`'s recording `file`: samples win over seconds, which become
    /// samples as `_start_sample` of the Python readers does; the end defaults to the last sample.
    fn samples(&self, info: &RecordingInfo, file: &str) -> Result<(u64, u64), String> {
        let total = info.sample_count;
        let sample = |seconds: Option<f64>, samples: Option<u64>| {
            samples.or(seconds.map(|s| (s * info.sample_rate_hz + 1e-6).floor().max(0.0) as u64))
        };
        let first = sample(self.start, self.start_sample).unwrap_or(0);
        let last = sample(self.end, self.end_sample)
            .unwrap_or(u64::MAX)
            .min(total.saturating_sub(1));
        if first >= total {
            return Err(format!(
                "start sample {first} is not inside the {total} samples of {file}"
            ));
        }
        if last < first {
            return Err(format!("end sample {last} is before start sample {first}"));
        }
        Ok((first, last))
    }
}

/// Opens the job's recording and runs the request on it: block by block when `check_block_support` allows and the
/// device is the CPU, otherwise over the whole recording in memory. A recording that fails to open or a selection that
/// does not fit it is an input error; a failed run or write an execution error. A failure after the file opened ends
/// with the recording's warnings, each after a space, as the Python batch words it (a truncated file explains a short
/// one).
pub fn analyze(job: Job) -> Result<Analysis, Failure> {
    let file = job.request.file_path.clone();
    if !Path::new(&file).exists() {
        return Err(input(format!("Input file not found: {file}")));
    }
    let (files, reader) =
        open(&file, job.request.sampling_rate, job.reference.as_ref()).map_err(input)?;
    let warnings = reader.info().warnings.clone();
    analyze_open(job, &files, &*reader).map_err(|(code, message)| {
        let message = warnings
            .iter()
            .fold(message, |text, w| format!("{text} {w}"));
        (code, message)
    })
}

/// `analyze` on a recording already open: `files` holds the bytes its input files are hashed from.
pub fn analyze_open(job: Job, files: &FileSet, reader: &dyn Reader) -> Result<Analysis, Failure> {
    let mut request = job.request;
    let file = request.file_path.clone();
    let info = reader.info();
    let analysis = info.analysis_channels();

    // The channels count the analysis channels; the default is every one BIDS does not mark bad.
    let channels = match request.channels.take().filter(|c| !c.is_empty()) {
        Some(channels) => channels,
        None => (0..analysis.len())
            .filter(|&i| !info.channels[analysis[i]].is_bad())
            .collect(),
    };
    if channels.is_empty() {
        return Err(input(format!("{file} has no analysis channel to run on")));
    }
    request.channels = Some(channels);
    validate_request(&request, analysis.len()).map_err(|e| input(format!("{file}: {e}")))?;
    let (first, last) = job.range.samples(info, &file).map_err(input)?;
    request.time_range = TimeRange {
        start: first as f64,
        end: last as f64,
    };

    let mut input_sha256 = BTreeMap::new();
    for name in &info.input_files {
        if let Some(source) = files.source(name) {
            let hash = sha256(source.as_ref()).map_err(|e| execution(format!("{name}: {e}")))?;
            input_sha256.insert(name.clone(), hash);
        }
    }

    let report = |done: usize, of: usize| {
        if job.progress {
            eprint!("\r  window {done}/{of}");
        }
    };
    let bundle = job.bundle.as_deref();
    let mut sink;
    let windows;
    if job.device == ComputeDevice::Cpu && check_block_support(&request).is_ok() {
        let budget = usize::try_from(job.block_mb.saturating_mul(1 << 20)).unwrap_or(usize::MAX);
        let blocks = plan_blocks(&request, info, budget).map_err(execution)?;
        windows = blocks.last().map_or(0, |block| block.w1);
        sink = Sink::new(bundle, &request, info, windows)?;
        for block in &blocks {
            let mut on_progress = |p: &PureRustProgress| report(block.w0 + p.window_index, windows);
            let part =
                run_block(reader, &request, block, Some(&mut on_progress)).map_err(execution)?;
            sink.add(block, part)?;
        }
    } else {
        // A window may read the row after `last`, a real one when the file has it, as `run_block` reads it.
        // shortcut: reads from row 0, which costs memory for the rows before a late start; upgrade if whole runs of long recordings need it.
        let end = (last + 2).min(info.sample_count);
        let rows = reader
            .read_rows(&analysis, 0, end as usize)
            .map_err(execution)?;
        let labels: Vec<String> = analysis
            .iter()
            .map(|&c| info.channels[c].label.clone())
            .collect();
        let mut on_progress = |p: &PureRustProgress| report(p.window_index, p.total_windows);
        let result = run_request_on_device(
            &request,
            &rows,
            Some(&labels),
            job.device,
            Some(&mut on_progress),
        )
        .map_err(|e| execution(format!("Pure Rust DDA failed: {e}")))?;
        windows = result
            .variant_results
            .iter()
            .flatten()
            .filter_map(|variant| variant.q_matrix.first())
            .map(Vec::len)
            .max()
            .unwrap_or(0);
        sink = Sink::new(bundle, &request, info, windows)?;
        let whole = Block {
            w0: 0,
            w1: windows,
            row0: 0,
            row1: end,
        };
        sink.add(&whole, result)?;
    }
    if job.progress {
        eprintln!();
    }

    let provenance = Provenance {
        id: uuid::Uuid::new_v4().to_string(),
        created_at_iso: chrono::Utc::now().to_rfc3339(),
        input_sha256,
        compute_device: job.device.to_string(),
    };
    let document = match sink.bundle {
        Some((writer, _)) => {
            let manifest =
                build_manifest(info, &request, windows, provenance).map_err(execution)?;
            writer.finish(&manifest).map_err(execution)?;
            manifest
        }
        None => {
            let result = merge_blocks(sink.parts).map_err(execution)?;
            build_document(result, info, &request, provenance)
        }
    };
    Ok(Analysis {
        document,
        warnings: info.warnings.clone(),
    })
}

pub fn execute(args: RunArgs) -> Result<(), Failure> {
    let job = Job::of(&args).map_err(input)?;
    if !args.quiet {
        eprintln!("Running DDA analysis on {}...", args.file);
        let variants = &job.request.algorithm_selection.enabled_variants;
        eprintln!("  Variants: {}", variants.join(", "));
        eprintln!("  Window: length={}, step={}", args.dda.wl, args.dda.ws);
    }
    let analysis = analyze(job)?;
    if !args.quiet {
        eprintln!("  Backend: pure-rust ({})", args.device);
    }
    match &args.bundle {
        Some(dir) => {
            if !args.quiet {
                eprintln!("Bundle written to {dir}");
            }
        }
        None => {
            output::write_json(&analysis.document, args.compact, args.output.as_deref())
                .map_err(execution)?;
            if let (false, Some(path)) = (args.quiet, &args.output) {
                eprintln!("Results written to {}", path);
            }
        }
    }
    Ok(())
}
