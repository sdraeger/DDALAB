use super::open;
use crate::cli::args::InspectArgs;
use crate::cli::{execution_error, input_error, output, Failure};
use crate::io::RecordingInfo;
use serde::Serialize;

#[derive(Serialize)]
struct Inspection {
    #[serde(flatten)]
    info: RecordingInfo,
    /// Indices into `channels` of the channels analysis requests count in.
    analysis_channels: Vec<usize>,
}

pub fn execute(args: InspectArgs) -> Result<(), Failure> {
    let reference = args.reference.parse().map_err(input_error)?;
    let (_, reader) = open(&args.file, args.sr, reference.as_ref()).map_err(input_error)?;
    let (annotations, scan_warnings) = reader
        .scan_annotations()
        .map_err(|error| execution_error(format!("{}: {error}", args.file)))?;
    let mut info = reader.info().clone();
    info.annotations = annotations;
    info.warnings.extend(scan_warnings);
    let inspection = Inspection {
        analysis_channels: info.analysis_channels(),
        info,
    };

    if args.json {
        return output::write_json(&inspection, false, None).map_err(execution_error);
    }
    print_table(&inspection);
    Ok(())
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
