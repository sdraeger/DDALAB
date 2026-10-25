use crate::cli::RunArgs;
use crate::dda_params;
use crate::exit_codes;
use crate::output;
use dda_rs::blocks::{
    check_block_support, merge_blocks, plan_blocks, run_block, validate_request, Block,
};
use dda_rs::document::{
    build_document, build_manifest, bundle_layout, encode_block, BundleLayout, BundleWriter,
    ResultDocument,
};
use dda_rs::io::{open_recording, ByteSource, ChannelInfo, FileSet, Reader, RecordingInfo};
use dda_rs::tiles::Sha256Stream;
use dda_rs::{ComputeDevice, DDARequest, DDAResult, PureRustProgress, TimeRange};
use std::collections::BTreeMap;
use std::fmt::Display;
use std::path::Path;

/// Bytes of a file hashed at a time.
const HASH_SLICE: usize = 4 << 20;

/// An exit code and the message to print.
pub type Failure = (i32, String);

fn input(error: impl Display) -> Failure {
    (exit_codes::INPUT_ERROR, error.to_string())
}

fn execution(error: impl Display) -> Failure {
    (exit_codes::EXECUTION_ERROR, error.to_string())
}

/// One analysis of one file. `request` holds everything but the time range, which `analyze` sets from
/// `start` and `end` in seconds or `start_sample` and `end_sample` (samples win), and the channels when it names none.
pub struct Job<'a> {
    pub file: &'a str,
    pub sample_rate_hz: Option<f64>,
    pub request: DDARequest,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub start_sample: Option<u64>,
    pub end_sample: Option<u64>,
    pub device: ComputeDevice,
    pub block_mb: u64,
    /// A directory to stream the result into as a bundle; the document returned is its manifest.
    pub bundle: Option<&'a Path>,
    pub progress: bool,
}

pub struct Analysis {
    pub document: ResultDocument,
    /// The recording's warnings, also in the document's diagnostics.
    pub warnings: Vec<String>,
}

fn is_bad(channel: &ChannelInfo) -> bool {
    channel
        .bids_status
        .as_deref()
        .is_some_and(|status| status.eq_ignore_ascii_case("bad"))
}

/// The SHA-256 of `source`, hex.
fn sha256(source: &dyn ByteSource) -> dda_rs::Result<String> {
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
                Ok::<_, dda_rs::DDAError>((BundleWriter::create(dir, &layout)?, layout))
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

/// Opens `job.file` and runs the request on it: block by block when `check_block_support` allows and the device is
/// the CPU, otherwise over the whole recording in memory. A recording that fails to open or a selection that does not fit it
/// is an input error; a failed run or write an execution error. A failure after the file opened ends with the recording's
/// warnings, each after a space, as the Python batch words it (a truncated file explains a short one).
pub async fn analyze(job: Job<'_>) -> Result<Analysis, Failure> {
    let file = job.file;
    if !Path::new(file).exists() {
        return Err(input(format!("Input file not found: {file}")));
    }
    let files = FileSet::from_path(Path::new(file)).map_err(|e| input(format!("{file}: {e}")))?;
    let reader =
        open_recording(&files, job.sample_rate_hz).map_err(|e| input(format!("{file}: {e}")))?;
    let warnings = reader.info().warnings.clone();
    analyze_open(job, &files, &*reader)
        .await
        .map_err(|(code, message)| {
            let message = warnings
                .iter()
                .fold(message, |text, w| format!("{text} {w}"));
            (code, message)
        })
}

async fn analyze_open(
    job: Job<'_>,
    files: &FileSet,
    reader: &dyn Reader,
) -> Result<Analysis, Failure> {
    let file = job.file;
    let info = reader.info();
    let analysis = info.analysis_channels();
    let mut request = job.request;

    // The channels count the analysis channels; the default is every one BIDS does not mark bad.
    let channels = match request.channels.take().filter(|c| !c.is_empty()) {
        Some(channels) => channels,
        None => (0..analysis.len())
            .filter(|&i| !is_bad(&info.channels[analysis[i]]))
            .collect(),
    };
    if channels.is_empty() {
        return Err(input(format!("{file} has no analysis channel to run on")));
    }
    request.channels = Some(channels);
    validate_request(&request, analysis.len()).map_err(|e| input(format!("{file}: {e}")))?;

    // Seconds become samples as `_start_sample` of the Python readers does.
    let total = info.sample_count;
    let sample = |seconds: Option<f64>, samples: Option<u64>| {
        samples.or(seconds.map(|s| (s * info.sample_rate_hz + 1e-6).floor().max(0.0) as u64))
    };
    let first = sample(job.start, job.start_sample).unwrap_or(0);
    let last = sample(job.end, job.end_sample)
        .unwrap_or(u64::MAX)
        .min(total.saturating_sub(1));
    if first >= total {
        return Err(input(format!(
            "start sample {first} is not inside the {total} samples of {file}"
        )));
    }
    if last < first {
        return Err(input(format!(
            "end sample {last} is before start sample {first}"
        )));
    }
    request.time_range = TimeRange {
        start: first as f64,
        end: last as f64,
    };
    dda_params::pure_rust_matrix_support_reason(&request).map_err(|reason| {
        execution(format!(
            "Pure Rust DDA cannot execute this request: {reason}"
        ))
    })?;

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
    let mut sink;
    let windows;
    if job.device == ComputeDevice::Cpu && check_block_support(&request).is_ok() {
        let budget = usize::try_from(job.block_mb.saturating_mul(1 << 20)).unwrap_or(usize::MAX);
        let blocks = plan_blocks(&request, info, budget).map_err(execution)?;
        windows = blocks.last().map_or(0, |block| block.w1);
        sink = Sink::new(job.bundle, &request, info, windows)?;
        for block in &blocks {
            let mut on_progress = |p: &PureRustProgress| report(block.w0 + p.window_index, windows);
            let part =
                run_block(reader, &request, block, Some(&mut on_progress)).map_err(execution)?;
            sink.add(block, part)?;
        }
    } else {
        // A window may read the row after `last`, a real one when the file has it, as `run_block` reads it.
        // shortcut: reads from row 0, which costs memory for the rows before a late start; upgrade if whole runs of long recordings need it.
        let end = (last + 2).min(total);
        let rows = reader
            .read_rows(&analysis, 0, end as usize)
            .map_err(execution)?;
        let labels: Vec<String> = analysis
            .iter()
            .map(|&c| info.channels[c].label.clone())
            .collect();
        let result = dda_params::execute_request_on_matrix_with_progress_on_device(
            &request,
            &rows,
            Some(&labels),
            job.device,
            |p| report(p.window_index, p.total_windows),
        )
        .await
        .map_err(execution)?;
        windows = result
            .variant_results
            .iter()
            .flatten()
            .filter_map(|variant| variant.q_matrix.first())
            .map(Vec::len)
            .max()
            .unwrap_or(0);
        sink = Sink::new(job.bundle, &request, info, windows)?;
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

    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let decorate = |document: &mut ResultDocument| {
        document.reproduction.compute_device = job.device.to_string();
    };
    let document = match sink.bundle {
        Some((writer, layout)) => {
            let mut manifest = build_manifest(
                info,
                &request,
                &layout,
                windows,
                input_sha256,
                id,
                created_at,
            );
            decorate(&mut manifest);
            writer.finish(&manifest).map_err(execution)?;
            manifest
        }
        None => {
            let result = merge_blocks(sink.parts).map_err(execution)?;
            let mut document =
                build_document(&result, info, &request, input_sha256, id, created_at);
            decorate(&mut document);
            document
        }
    };
    Ok(Analysis {
        document,
        warnings: info.warnings.clone(),
    })
}

pub async fn execute(args: RunArgs) -> i32 {
    let selection = match dda_params::prepare_selection(
        args.channels.clone(),
        &args.variants,
        args.ct_pairs.as_deref(),
        args.cd_pairs.as_deref(),
        args.variant_configs.as_deref(),
    ) {
        Ok(selection) => selection,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };
    let dda_params::PreparedSelection {
        variants: normalized_variants,
        channels: effective_channels,
        ct_pairs: effective_ct_pairs,
        cd_pairs: effective_cd_pairs,
        variant_configs,
    } = selection;

    // Validate shared params; an empty channel selection means the recording's good channels.
    if let Err(msg) = dda_params::validate_params_except_channels(
        &normalized_variants,
        &args.delays,
        args.wl,
        args.ws,
        &effective_ct_pairs,
        &effective_cd_pairs,
    ) {
        eprintln!("Error: {}", msg);
        return exit_codes::INPUT_ERROR;
    }

    // Build DDARequest; `analyze` sets the time range
    let request = match dda_params::build_dda_request(dda_params::RequestConfig {
        file_path: &args.file,
        channels: &effective_channels,
        variants: &normalized_variants,
        window_length: args.wl,
        window_step: args.ws,
        delays: &args.delays,
        model_terms: args.model.clone(),
        dm: args.dm,
        order: args.order,
        nr_tau: args.nr_tau,
        ct_window_length: args.ct_wl,
        ct_window_step: args.ct_ws,
        ct_channel_pairs: effective_ct_pairs,
        cd_channel_pairs: effective_cd_pairs,
        sampling_rate: args.sr,
        start: None,
        end: None,
        highpass: args.highpass,
        lowpass: args.lowpass,
        variant_configs,
    }) {
        Ok(r) => r,
        Err(msg) => {
            eprintln!("Error: {}", msg);
            return exit_codes::INPUT_ERROR;
        }
    };

    if !args.quiet {
        eprintln!("Running DDA analysis on {}...", args.file);
        eprintln!("  Variants: {}", normalized_variants.join(", "));
        eprintln!("  Window: length={}, step={}", args.wl, args.ws);
        if args.highpass.is_some() || args.lowpass.is_some() {
            eprintln!(
                "  Preprocessing: highpass={:?}, lowpass={:?}",
                args.highpass, args.lowpass
            );
        }
    }

    let analysis = match analyze(Job {
        file: &args.file,
        sample_rate_hz: args.sr,
        request,
        start: args.start,
        end: args.end,
        start_sample: args.start_sample,
        end_sample: args.end_sample,
        device: args.device,
        block_mb: args.block_mb,
        bundle: args.bundle.as_deref().map(Path::new),
        progress: !args.quiet,
    })
    .await
    {
        Ok(analysis) => analysis,
        Err((code, message)) => {
            eprintln!("Error: {message}");
            return code;
        }
    };
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
            if let Err(error) =
                output::write_json(&analysis.document, args.compact, args.output.as_deref())
            {
                eprintln!("Error: {}", error);
                return exit_codes::EXECUTION_ERROR;
            }
            if let (false, Some(path)) = (args.quiet, &args.output) {
                eprintln!("Results written to {}", path);
            }
        }
    }
    exit_codes::SUCCESS
}

#[cfg(test)]
mod tests {
    use crate::cli::RunArgs;
    use crate::dda_params;
    use dda_rs::{format_select_mask, generate_select_mask};

    fn make_test_args() -> RunArgs {
        RunArgs {
            file: "/tmp/test.edf".to_string(),
            channels: Some(vec![0, 1, 2]),
            variants: vec!["ST".to_string()],
            wl: 200,
            ws: 100,
            ct_wl: None,
            ct_ws: None,
            delays: vec![7, 10],
            model: None,
            dm: 4,
            order: 4,
            nr_tau: 2,
            ct_pairs: None,
            cd_pairs: None,
            variant_configs: None,
            highpass: None,
            lowpass: None,
            start: None,
            end: None,
            start_sample: None,
            end_sample: None,
            sr: None,
            binary: None,
            output: None,
            bundle: None,
            block_mb: crate::cli::DEFAULT_BLOCK_MB,
            compact: false,
            quiet: false,
            device: dda_rs::ComputeDevice::Cpu,
        }
    }

    fn build_test_request(args: &RunArgs, file_path: &str) -> dda_rs::DDARequest {
        let ct_channel_pairs = args
            .ct_pairs
            .as_ref()
            .map(|pairs| crate::cli::parse_pairs(pairs))
            .transpose()
            .unwrap();
        let cd_channel_pairs = args
            .cd_pairs
            .as_ref()
            .map(|pairs| crate::cli::parse_pairs(pairs))
            .transpose()
            .unwrap();
        dda_params::build_dda_request(dda_params::RequestConfig {
            file_path,
            channels: args.channels.as_deref().unwrap_or_default(),
            variants: &args.variants,
            window_length: args.wl,
            window_step: args.ws,
            delays: &args.delays,
            model_terms: args.model.clone(),
            dm: args.dm,
            order: args.order,
            nr_tau: args.nr_tau,
            ct_window_length: args.ct_wl,
            ct_window_step: args.ct_ws,
            ct_channel_pairs,
            cd_channel_pairs,
            sampling_rate: args.sr,
            start: args.start,
            end: args.end,
            highpass: args.highpass,
            lowpass: args.lowpass,
            variant_configs: None,
        })
        .unwrap()
    }

    #[test]
    fn test_build_request_defaults() {
        let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();
        let args = make_test_args();

        let request = build_test_request(&args, tmp.path().to_str().unwrap());
        assert_eq!(request.window_parameters.window_length, 200);
        assert_eq!(request.window_parameters.window_step, 100);
        assert_eq!(request.delay_parameters.delays, vec![7, 10]);
        assert!(request.model_parameters.is_some());
        let model = request.model_parameters.unwrap();
        assert_eq!(model.dm, 4);
        assert_eq!(model.order, 4);
        assert_eq!(model.nr_tau, 2);
    }

    #[test]
    fn test_build_request_with_ct_pairs() {
        let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();
        let mut args = make_test_args();
        args.variants = vec!["CT".to_string()];
        args.ct_pairs = Some(vec!["0,1".to_string(), "0,2".to_string()]);

        let request = build_test_request(&args, tmp.path().to_str().unwrap());
        let pairs = request.ct_channel_pairs.unwrap();
        assert_eq!(pairs, vec![[0, 1], [0, 2]]);
        assert_eq!(request.window_parameters.ct_window_length, None);
        assert_eq!(request.window_parameters.ct_window_step, None);
    }

    #[test]
    fn test_validate_invalid_variant() {
        let tmp = tempfile::Builder::new().suffix(".edf").tempfile().unwrap();
        let args = make_test_args();

        let result = dda_params::validate_common_params(
            args.channels.as_deref().unwrap(),
            &["INVALID".to_string()],
            &args.delays,
            args.wl,
            args.ws,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unknown variant"));

        // Also test file validation separately
        let _ = tmp; // keep tempfile alive
    }

    #[test]
    fn test_validate_ct_without_pairs() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["CT".to_string()],
            &[7, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("--ct-pairs"));
    }

    #[test]
    fn test_validate_cd_without_pairs() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["CD".to_string()],
            &[7, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("--cd-pairs"));
    }

    #[test]
    fn test_validate_delay_out_of_range() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[1, 200],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("out of range"));
    }

    #[test]
    fn test_validate_negative_delay() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[-1, 10],
            200,
            100,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("non-negative"));
    }

    #[test]
    fn test_validate_ws_greater_than_wl() {
        let result = dda_params::validate_common_params(
            &[0, 1, 2],
            &["ST".to_string()],
            &[7, 10],
            100,
            200,
            &None,
            &None,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not exceed"));
    }

    #[test]
    fn test_compute_bounds_sample_based() {
        let (start, end) = dda_params::compute_bounds(None, None, Some(0), Some(6000), None);
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(6000));
    }

    #[test]
    fn test_compute_bounds_time_based() {
        let (start, end) =
            dda_params::compute_bounds(Some(0.0), Some(10.0), None, None, Some(256.0));
        assert_eq!(start, Some(0));
        assert_eq!(end, Some(2560));
    }

    #[test]
    fn test_compute_bounds_none() {
        let (start, end) = dda_params::compute_bounds(None, None, None, None, None);
        assert_eq!(start, None);
        assert_eq!(end, None);
    }

    #[test]
    fn test_select_mask_generation() {
        let variants = ["ST".to_string(), "CD".to_string()];
        let variant_refs: Vec<&str> = variants.iter().map(|s| s.as_str()).collect();
        let mask = generate_select_mask(&variant_refs);
        let mask_str = format_select_mask(&mask);
        assert_eq!(mask_str, "1 0 1 0 0 0");
    }
}
