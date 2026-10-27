use super::open_reader;
use crate::cli::args::InspectArgs;
use crate::cli::exit_codes;
use crate::cli::output;
use crate::io::RecordingInfo;
use serde::Serialize;

#[derive(Serialize)]
struct Inspection {
    #[serde(flatten)]
    info: RecordingInfo,
    /// Indices into `channels` of the channels analysis requests count in.
    analysis_channels: Vec<usize>,
}

pub fn execute(args: InspectArgs) -> i32 {
    let reader = match open_reader(&args.file, args.sr) {
        Ok(reader) => reader,
        Err(code) => return code,
    };
    let (annotations, scan_warnings) = match reader.scan_annotations() {
        Ok(scan) => scan,
        Err(error) => {
            eprintln!("Error: {}: {error}", args.file);
            return exit_codes::EXECUTION_ERROR;
        }
    };
    let mut info = reader.info().clone();
    info.annotations = annotations;
    info.warnings.extend(scan_warnings);
    let inspection = Inspection {
        analysis_channels: info.analysis_channels(),
        info,
    };

    if args.json {
        if let Err(error) = output::write_json(&inspection, false, None) {
            eprintln!("Error: {error}");
            return exit_codes::EXECUTION_ERROR;
        }
    } else {
        print_table(&inspection);
    }
    exit_codes::SUCCESS
}

fn print_table(inspection: &Inspection) {
    let info = &inspection.info;
    println!(
        "{}: {} Hz, {} samples, {} s, stored as {:?}",
        info.format, info.sample_rate_hz, info.sample_count, info.duration_s, info.raw_type
    );
    println!("files: {}", info.input_files.join(", "));
    println!(
        "{:>5} {:>8}  {:<24} {:<6} {:>10}  {:<10} bids",
        "index", "analysis", "label", "unit", "rate_hz", "kind"
    );
    for (index, channel) in info.channels.iter().enumerate() {
        let analysis = inspection
            .analysis_channels
            .iter()
            .position(|&i| i == index)
            .map_or("-".to_string(), |a| a.to_string());
        let bids: Vec<&str> = [channel.bids_status.as_deref(), channel.bids_type.as_deref()]
            .into_iter()
            .flatten()
            .collect();
        println!(
            "{:>5} {:>8}  {:<24} {:<6} {:>10}  {:<10} {}",
            index,
            analysis,
            channel.label,
            channel.unit,
            channel.sample_rate_hz,
            format!("{:?}", channel.kind),
            bids.join(" ")
        );
    }
    println!(
        "annotations: {} (--json lists them)",
        info.annotations.len()
    );
    for warning in &info.warnings {
        println!("warning: {warning}");
    }
}
