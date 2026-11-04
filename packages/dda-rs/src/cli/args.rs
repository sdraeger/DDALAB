use clap::{Args, Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "ddalab",
    version,
    about = "Delay Differential Analysis (DDA) command-line tool",
    long_about = "Run DDA analysis with the built-in Rust engine.\n\
                  All execution is handled inside dda-rs."
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,

    /// Increase verbosity (-v, -vv, -vvv)
    #[arg(short, long, action = clap::ArgAction::Count, global = true)]
    pub verbose: u8,
}

#[derive(Subcommand)]
pub enum Command {
    /// Run DDA analysis on a data file
    Run(RunArgs),
    /// Show backend information
    Info(InfoArgs),
    /// List available DDA analysis variants
    Variants(VariantsArgs),
    /// Validate a data file
    Validate(ValidateArgs),
    /// Run batch DDA analysis across multiple files
    Batch(BatchArgs),
    /// Show a recording's channels, annotations and warnings
    Inspect(InspectArgs),
    /// Write physical samples of a recording to a .npy file
    Samples(SamplesArgs),
    /// Serve DDALAB to AI agents over MCP on stdin and stdout (`claude mcp add ddalab -- ddalab mcp`)
    Mcp(McpArgs),
    /// Find the DDA model that separates labeled segments best, and train its classifier
    Classify(ClassifyArgs),
    /// Classify recordings, segment by segment, with a model `ddalab classify` trained
    Predict(PredictArgs),
    /// Run DDA live on a Lab Streaming Layer stream: results to stdout, LSL outlets and the web app
    Stream(StreamArgs),
}

#[derive(Args)]
pub struct StreamArgs {
    /// The LSL stream to read, by its name (or its type, with --by type)
    #[arg(long)]
    pub stream: String,

    /// What --stream names
    #[arg(long, value_parser = ["name", "type"], default_value = "name")]
    pub by: String,

    /// Seconds to wait for the stream
    #[arg(long, default_value_t = 10.0)]
    pub timeout: f64,

    #[command(flatten)]
    pub reference: ReferenceArgs,

    /// DDA variants to run live: ST, DE and SY on every channel, CT and CD on --ct-pairs and --cd-pairs
    #[arg(long, num_args = 1.., default_values_t = ["ST".to_string()])]
    pub variants: Vec<String>,

    /// CT channel pairs as "i,j"
    #[arg(long, num_args = 1..)]
    pub ct_pairs: Option<Vec<String>>,

    /// CD directed channel pairs as "i,j"
    #[arg(long, num_args = 1..)]
    pub cd_pairs: Option<Vec<String>>,

    /// Window length in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_LENGTH)]
    pub wl: u32,

    /// Samples between windows: a result every ws samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_STEP)]
    pub ws: u32,

    /// Delay values
    #[arg(long, num_args = 1.., default_values_t = crate::DEFAULT_DELAYS)]
    pub delays: Vec<i32>,

    /// Model term indices
    #[arg(long, num_args = 1.., default_values_t = crate::DEFAULT_MODEL_TERMS)]
    pub model: Vec<i32>,

    /// A report of `ddalab classify`: the class of the latest segment of its channels, every --every seconds
    #[arg(long)]
    pub classify: Option<String>,

    /// Seconds per classified segment, as `ddalab classify --segment` trained it
    #[arg(long, default_value_t = 10.0, requires = "classify")]
    pub segment: f64,

    /// Seconds between classifications
    #[arg(long, default_value_t = 1.0, requires = "classify")]
    pub every: f64,

    /// Publish the results as LSL streams: <stream>-<variant> with a value per row, and <stream>-class markers
    #[arg(long)]
    pub outlet: bool,

    /// Serve samples and results to the web app on ws://127.0.0.1:PORT, which prints the address with its token
    #[arg(long)]
    pub serve: Option<u16>,

    /// Stop after this many seconds of stream; default: until interrupted
    #[arg(long)]
    pub duration: Option<f64>,

    /// Leave out the JSON line per result on stdout
    #[arg(long)]
    pub quiet: bool,
}

/// Where the labels come from: a table, annotations, or a participants column.
#[derive(Args)]
#[command(group(clap::ArgGroup::new("labels").required(true).args(["samples", "classes", "participants"])))]
pub struct ClassifyArgs {
    /// A TSV of labeled stretches: the columns file and label, and optional start and end (seconds; default the
    /// whole recording) and group (default the subject, sub-<label> in the path, else the file)
    #[arg(long)]
    pub samples: Option<String>,

    /// Recordings whose annotations (--classes) or subjects (--participants) give the labels
    #[arg(long, num_args = 1..)]
    pub files: Option<Vec<String>>,

    /// Classes from annotations: NAME takes the annotations whose text contains NAME, NAME=TEXT those containing TEXT,
    /// ignoring case. An annotation matching two classes goes to the first
    #[arg(long, num_args = 1.., requires = "files")]
    pub classes: Option<Vec<String>>,

    /// A class for stretches no annotation covers (more than a segment away from any): as many segments per recording
    /// as its annotated classes have, or --max-segments when it has none
    #[arg(long, requires = "classes")]
    pub rest: Option<String>,

    /// A BIDS participants.tsv: each recording is labeled with the --column value of its subject's row
    #[arg(long, requires_all = ["files", "column"])]
    pub participants: Option<String>,

    /// The participants.tsv column holding the class
    #[arg(long)]
    pub column: Option<String>,

    /// Seconds per segment: labeled stretches are cut into segments this long, and shorter events are lengthened
    #[arg(long, default_value_t = 10.0)]
    pub segment: f64,

    /// Most segments of one labeled stretch, evenly spaced
    #[arg(long, default_value_t = 20)]
    pub max_segments: usize,

    /// Channels by label. Default: the analysis channels of the first recording that BIDS does not mark bad. Every
    /// recording must have them
    #[arg(long, num_args = 1..)]
    pub channels: Option<Vec<String>>,

    /// Sampling rate in Hz for text files, which store none
    #[arg(long)]
    pub sr: Option<f64>,

    #[command(flatten)]
    pub reference: ReferenceArgs,

    /// Window length in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_LENGTH)]
    pub wl: u32,

    /// Window step in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_STEP)]
    pub ws: u32,

    /// Embedding dimension
    #[arg(long, default_value_t = crate::DEFAULT_MODEL_DIMENSION)]
    pub dm: u32,

    /// Polynomial order: the terms searched are the monomials up to it
    #[arg(long, default_value_t = crate::DEFAULT_POLYNOMIAL_ORDER)]
    pub order: u32,

    /// Model terms per structure
    #[arg(long, default_value_t = 3)]
    pub terms: usize,

    /// The two delays the term search runs at
    #[arg(long, num_args = 2, default_values_t = crate::DEFAULT_DELAYS)]
    pub delays: Vec<i32>,

    /// The smallest and largest delay of the delay search
    #[arg(long, num_args = 2, default_values_t = [1, 20])]
    pub delay_range: Vec<i32>,

    /// Folds of the grouped cross-validation (at most the number of groups)
    #[arg(long, default_value_t = 5)]
    pub folds: usize,

    /// Shrinkage of the LDA covariance toward a scaled identity, 0 to 1
    #[arg(long, default_value_t = 0.1)]
    pub shrinkage: f64,

    /// Skip the nested cross-validation, which scores the whole search without the optimism of choosing on the
    /// same folds
    #[arg(long)]
    pub no_nested: bool,

    /// Structures the report ranks
    #[arg(long, default_value_t = 20)]
    pub top: usize,

    /// The report JSON, with the trained model `ddalab predict` reads
    #[arg(short, long)]
    pub output: String,

    /// No progress on stderr
    #[arg(long)]
    pub quiet: bool,
}

#[derive(Args)]
pub struct PredictArgs {
    /// A report of `ddalab classify` (or its `model` alone)
    #[arg(long)]
    pub model: String,

    /// Recordings to classify; the model's reference and channels apply
    #[arg(long, num_args = 1.., required = true)]
    pub files: Vec<String>,

    /// Seconds per segment
    #[arg(long, default_value_t = 10.0)]
    pub segment: f64,

    /// Sampling rate in Hz for text files, which store none
    #[arg(long)]
    pub sr: Option<f64>,

    /// Output JSON (default: stdout)
    #[arg(short, long)]
    pub output: Option<String>,
}

#[derive(Args)]
pub struct McpArgs {
    /// Also give the agent annotation text and raw samples. HIPAA mode, the default, keeps both from the model
    /// provider: use this only for recordings without patient data
    #[arg(long = "no-hipaa", action = clap::ArgAction::SetFalse)]
    pub hipaa: bool,
}

/// Re-referencing, for the commands that read a recording.
#[derive(Args, Clone, Default)]
pub struct ReferenceArgs {
    /// Re-reference the analysis channels: average, bipolar, laplacian, or a montage TSV with the columns channel,
    /// source and weight. The derived channels replace the analysis channels, so --channels counts them
    #[arg(long)]
    pub reference: Option<String>,

    /// Electrode positions for --reference laplacian, a TSV with the columns name, x, y and z. Default: the
    /// subject's *_electrodes.tsv beside the recording
    #[arg(long, requires = "reference")]
    pub electrodes: Option<String>,
}

/// Default `--block-mb`.
pub const DEFAULT_BLOCK_MB: u64 = 512;

#[derive(Args)]
pub struct RunArgs {
    /// Input data file path (EDF, BDF, BrainVision .vhdr, ASCII/TXT/CSV)
    #[arg(long)]
    pub file: String,

    /// 0-based indices into the analysis channels (`ddalab inspect` shows the list).
    /// Defaults to every analysis channel BIDS channels.tsv does not mark bad.
    #[arg(long, num_args = 1..)]
    pub channels: Option<Vec<usize>>,

    /// Variants to run.
    /// Accepts abbreviations (ST, CT, CD, DE, SY) and app IDs
    /// (single_timeseries, cross_timeseries, cross_dynamical,
    ///  dynamical_ergodicity, synchronization).
    #[arg(long, default_values_t = vec!["ST".to_string()], num_args = 1..)]
    pub variants: Vec<String>,

    /// Window length in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_LENGTH)]
    pub wl: u32,

    /// Window step in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_STEP)]
    pub ws: u32,

    /// Channels per CT and DE group when no pairs are given (default: every selected channel)
    #[arg(long)]
    pub ct_wl: Option<u32>,

    /// Channel stride between CT and DE groups (default: --ct-wl)
    #[arg(long)]
    pub ct_ws: Option<u32>,

    /// Delay values (tau)
    #[arg(
        long,
        default_values_t = vec![crate::DEFAULT_DELAYS[0], crate::DEFAULT_DELAYS[1]],
        num_args = 1..
    )]
    pub delays: Vec<i32>,

    /// Model term indices (for -MODEL), e.g. 1 2 10
    /// Defaults to backend defaults when omitted.
    #[arg(long, num_args = 1..)]
    pub model: Option<Vec<i32>>,

    /// Model dimension
    #[arg(long, default_value_t = crate::DEFAULT_MODEL_DIMENSION)]
    pub dm: u32,

    /// Polynomial order
    #[arg(long, default_value_t = crate::DEFAULT_POLYNOMIAL_ORDER)]
    pub order: u32,

    /// Number of tau values
    #[arg(long, default_value_t = crate::DEFAULT_NUM_TAU)]
    pub nr_tau: u32,

    /// CT channel pairs as "i,j" (e.g., "0,1" "0,2")
    #[arg(long, num_args = 1..)]
    pub ct_pairs: Option<Vec<String>>,

    /// CD directed channel pairs as "i,j" (e.g., "0,1" "1,0")
    #[arg(long, num_args = 1..)]
    pub cd_pairs: Option<Vec<String>>,

    /// Path to variant config JSON (app-compatible shape)
    /// Example:
    /// {"single_timeseries":{"selectedChannels":[0,1]},
    ///  "cross_timeseries":{"ctChannelPairs":[[0,1]]},
    ///  "cross_dynamical":{"cdChannelPairs":[[1,0]]}}
    #[arg(long)]
    pub variant_configs: Option<String>,

    /// Optional high-pass preprocessing cutoff (Hz)
    #[arg(long)]
    pub highpass: Option<f64>,

    /// Optional low-pass preprocessing cutoff (Hz)
    #[arg(long)]
    pub lowpass: Option<f64>,

    /// Start time in seconds
    #[arg(long)]
    pub start: Option<f64>,

    /// End time in seconds
    #[arg(long)]
    pub end: Option<f64>,

    /// Start sample index (alternative to --start)
    #[arg(long)]
    pub start_sample: Option<u64>,

    /// End sample index (alternative to --end)
    #[arg(long)]
    pub end_sample: Option<u64>,

    /// Sampling rate in Hz
    #[arg(long)]
    pub sr: Option<f64>,

    #[command(flatten)]
    pub reference: ReferenceArgs,

    /// Legacy native DDA binary path (ignored; native backend disabled)
    #[arg(long, env = "DDA_BINARY_PATH")]
    pub binary: Option<String>,

    /// Result document file (default: stdout)
    #[arg(short, long, conflicts_with = "bundle")]
    pub output: Option<String>,

    /// Write a bundle directory instead of one document: `manifest.json` and one .npy file per array
    #[arg(long)]
    pub bundle: Option<String>,

    /// Memory budget for the samples one block of windows reads, in MiB
    #[arg(long, default_value_t = DEFAULT_BLOCK_MB)]
    pub block_mb: u64,

    /// Compact JSON output (no indentation)
    #[arg(long, default_value_t = false)]
    pub compact: bool,

    /// Suppress progress messages on stderr
    #[arg(long, default_value_t = false)]
    pub quiet: bool,

    /// Compute device: cpu, cuda, or cuda:N (a non-cpu device runs the recording whole)
    #[arg(long, default_value = "cpu")]
    pub device: crate::ComputeDevice,
}

#[derive(Args)]
pub struct InfoArgs {
    /// Legacy native DDA binary path (ignored; native backend disabled)
    #[arg(long, env = "DDA_BINARY_PATH")]
    pub binary: Option<String>,

    /// Output as JSON
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args)]
pub struct VariantsArgs {
    /// Output as JSON
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args)]
pub struct ValidateArgs {
    /// Input data file path
    #[arg(long)]
    pub file: String,

    /// Output as JSON
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args)]
pub struct InspectArgs {
    /// Recording path (EDF, BDF, BrainVision .vhdr, ASCII/CSV)
    #[arg(long)]
    pub file: String,

    /// Sampling rate in Hz for text files, which store none
    #[arg(long)]
    pub sr: Option<f64>,

    #[command(flatten)]
    pub reference: ReferenceArgs,

    /// Output as JSON
    #[arg(long, default_value_t = false)]
    pub json: bool,
}

#[derive(Args)]
pub struct SamplesArgs {
    /// Recording path (EDF, BDF, BrainVision .vhdr, ASCII/CSV)
    #[arg(long)]
    pub file: String,

    /// 0-based channel indices in the analysis channel list (`ddalab inspect` shows it)
    #[arg(long, num_args = 1.., required = true)]
    pub channels: Vec<usize>,

    /// First sample to write
    #[arg(long, default_value_t = 0)]
    pub start_sample: u64,

    /// Number of samples to write per channel
    #[arg(long)]
    pub count: usize,

    /// Sampling rate in Hz for text files, which store none
    #[arg(long)]
    pub sr: Option<f64>,

    #[command(flatten)]
    pub reference: ReferenceArgs,

    /// Output .npy file: little-endian f64, shape (count, channels), SI units
    #[arg(short, long)]
    pub output: String,
}

#[derive(Args)]
pub struct BatchArgs {
    /// Glob pattern to match input files (e.g., "data/*.edf")
    #[arg(long, group = "input")]
    pub glob: Option<String>,

    /// Explicit list of input file paths
    #[arg(long, num_args = 1.., group = "input")]
    pub files: Option<Vec<String>>,

    /// BIDS directory to auto-discover compatible data files
    #[arg(long, group = "input")]
    pub bids_dir: Option<String>,

    /// 0-based indices into the analysis channels (`ddalab inspect` shows the list).
    /// Defaults to every analysis channel BIDS channels.tsv does not mark bad.
    #[arg(long, num_args = 1..)]
    pub channels: Option<Vec<usize>>,

    /// Variants to run.
    /// Accepts abbreviations (ST, CT, CD, DE, SY) and app IDs
    /// (single_timeseries, cross_timeseries, cross_dynamical,
    ///  dynamical_ergodicity, synchronization).
    #[arg(long, default_values_t = vec!["ST".to_string()], num_args = 1..)]
    pub variants: Vec<String>,

    /// Window length in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_LENGTH)]
    pub wl: u32,

    /// Window step in samples
    #[arg(long, default_value_t = crate::DEFAULT_WINDOW_STEP)]
    pub ws: u32,

    /// Channels per CT and DE group when no pairs are given (default: every selected channel)
    #[arg(long)]
    pub ct_wl: Option<u32>,

    /// Channel stride between CT and DE groups (default: --ct-wl)
    #[arg(long)]
    pub ct_ws: Option<u32>,

    /// Delay values (tau)
    #[arg(
        long,
        default_values_t = vec![crate::DEFAULT_DELAYS[0], crate::DEFAULT_DELAYS[1]],
        num_args = 1..
    )]
    pub delays: Vec<i32>,

    /// Model term indices (for -MODEL), e.g. 1 2 10
    /// Defaults to backend defaults when omitted.
    #[arg(long, num_args = 1..)]
    pub model: Option<Vec<i32>>,

    /// Model dimension
    #[arg(long, default_value_t = crate::DEFAULT_MODEL_DIMENSION)]
    pub dm: u32,

    /// Polynomial order
    #[arg(long, default_value_t = crate::DEFAULT_POLYNOMIAL_ORDER)]
    pub order: u32,

    /// Number of tau values
    #[arg(long, default_value_t = crate::DEFAULT_NUM_TAU)]
    pub nr_tau: u32,

    /// CT channel pairs as "i,j" (e.g., "0,1" "0,2")
    #[arg(long, num_args = 1..)]
    pub ct_pairs: Option<Vec<String>>,

    /// CD directed channel pairs as "i,j" (e.g., "0,1" "1,0")
    #[arg(long, num_args = 1..)]
    pub cd_pairs: Option<Vec<String>>,

    /// Path to variant config JSON (app-compatible shape)
    #[arg(long)]
    pub variant_configs: Option<String>,

    /// Optional high-pass preprocessing cutoff (Hz)
    #[arg(long)]
    pub highpass: Option<f64>,

    /// Optional low-pass preprocessing cutoff (Hz)
    #[arg(long)]
    pub lowpass: Option<f64>,

    /// Sampling rate in Hz
    #[arg(long)]
    pub sr: Option<f64>,

    #[command(flatten)]
    pub reference: ReferenceArgs,

    /// Legacy native DDA binary path (ignored; native backend disabled)
    #[arg(long, env = "DDA_BINARY_PATH")]
    pub binary: Option<String>,

    /// Output directory for the result documents `<stem>.<sha8>.dda.json`
    /// (default: each document is inlined in the manifest on stdout)
    #[arg(long)]
    pub output_dir: Option<String>,

    /// Memory budget for the samples one block of windows reads, in MiB
    #[arg(long, default_value_t = DEFAULT_BLOCK_MB)]
    pub block_mb: u64,

    /// Continue processing remaining files after a failure
    #[arg(long, default_value_t = false)]
    pub continue_on_error: bool,

    /// List matched files without running analysis
    #[arg(long, default_value_t = false)]
    pub dry_run: bool,

    /// Compact JSON output (no indentation)
    #[arg(long, default_value_t = false)]
    pub compact: bool,

    /// Suppress progress messages on stderr
    #[arg(long, default_value_t = false)]
    pub quiet: bool,

    /// Compute device: cpu, cuda, or cuda:N (a non-cpu device runs the recording whole)
    #[arg(long, default_value = "cpu")]
    pub device: crate::ComputeDevice,
}

/// Parse a channel pair string "i,j" into [usize; 2].
pub fn parse_pair(s: &str) -> Result<[usize; 2], String> {
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid pair format '{}': expected 'i,j' where i and j are integers",
            s
        ));
    }
    let a = parts[0].trim().parse::<usize>().map_err(|_| {
        format!(
            "Invalid pair '{}': '{}' is not a valid integer",
            s, parts[0]
        )
    })?;
    let b = parts[1].trim().parse::<usize>().map_err(|_| {
        format!(
            "Invalid pair '{}': '{}' is not a valid integer",
            s, parts[1]
        )
    })?;
    Ok([a, b])
}

/// Parse a list of pair strings into Vec<[usize; 2]>.
pub fn parse_pairs(pairs: &[String]) -> Result<Vec<[usize; 2]>, String> {
    pairs.iter().map(|s| parse_pair(s)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pair_valid() {
        assert_eq!(parse_pair("0,1").unwrap(), [0, 1]);
        assert_eq!(parse_pair("3,7").unwrap(), [3, 7]);
        assert_eq!(parse_pair("0, 1").unwrap(), [0, 1]);
    }

    #[test]
    fn test_parse_pair_invalid() {
        assert!(parse_pair("abc").is_err());
        assert!(parse_pair("0,1,2").is_err());
        assert!(parse_pair("0").is_err());
        assert!(parse_pair("a,b").is_err());
    }

    #[test]
    fn test_parse_pairs() {
        let pairs = vec!["0,1".to_string(), "2,3".to_string()];
        let result = parse_pairs(&pairs).unwrap();
        assert_eq!(result, vec![[0, 1], [2, 3]]);
    }
}
