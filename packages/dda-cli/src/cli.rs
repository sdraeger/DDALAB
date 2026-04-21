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
    #[command(hide = true)]
    Serve(ServeArgs),
}

#[derive(Args)]
pub struct RunArgs {
    /// Input data file path (EDF, ASCII/TXT/CSV)
    #[arg(long)]
    pub file: String,

    /// 0-based channel indices
    /// Optional when --variant-configs provides per-variant channels/pairs.
    #[arg(long, num_args = 1..)]
    pub channels: Option<Vec<usize>>,

    /// Variants to run.
    /// Accepts abbreviations (ST, CT, CD, DE, SY) and app IDs
    /// (single_timeseries, cross_timeseries, cross_dynamical,
    ///  dynamical_ergodicity, synchronization).
    #[arg(long, default_values_t = vec!["ST".to_string()], num_args = 1..)]
    pub variants: Vec<String>,

    /// Window length in samples
    #[arg(long, default_value_t = dda_rs::DEFAULT_WINDOW_LENGTH)]
    pub wl: u32,

    /// Window step in samples
    #[arg(long, default_value_t = dda_rs::DEFAULT_WINDOW_STEP)]
    pub ws: u32,

    /// CT-specific window length
    #[arg(long)]
    pub ct_wl: Option<u32>,

    /// CT-specific window step
    #[arg(long)]
    pub ct_ws: Option<u32>,

    /// Delay values (tau)
    #[arg(
        long,
        default_values_t = vec![dda_rs::DEFAULT_DELAYS[0], dda_rs::DEFAULT_DELAYS[1]],
        num_args = 1..
    )]
    pub delays: Vec<i32>,

    /// Model term indices (for -MODEL), e.g. 1 2 10
    /// Defaults to backend defaults when omitted.
    #[arg(long, num_args = 1..)]
    pub model: Option<Vec<i32>>,

    /// Model dimension
    #[arg(long, default_value_t = dda_rs::DEFAULT_MODEL_DIMENSION)]
    pub dm: u32,

    /// Polynomial order
    #[arg(long, default_value_t = dda_rs::DEFAULT_POLYNOMIAL_ORDER)]
    pub order: u32,

    /// Number of tau values
    #[arg(long, default_value_t = dda_rs::DEFAULT_NUM_TAU)]
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

    /// Legacy native DDA binary path (ignored; native backend disabled)
    #[arg(long, env = "DDA_BINARY_PATH")]
    pub binary: Option<String>,

    /// Output file (default: stdout)
    #[arg(short, long)]
    pub output: Option<String>,

    /// Compact JSON output (no indentation)
    #[arg(long, default_value_t = false)]
    pub compact: bool,

    /// Suppress progress messages on stderr
    #[arg(long, default_value_t = false)]
    pub quiet: bool,
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

    /// 0-based channel indices
    /// Optional when --variant-configs provides per-variant channels/pairs.
    #[arg(long, num_args = 1..)]
    pub channels: Option<Vec<usize>>,

    /// Variants to run.
    /// Accepts abbreviations (ST, CT, CD, DE, SY) and app IDs
    /// (single_timeseries, cross_timeseries, cross_dynamical,
    ///  dynamical_ergodicity, synchronization).
    #[arg(long, default_values_t = vec!["ST".to_string()], num_args = 1..)]
    pub variants: Vec<String>,

    /// Window length in samples
    #[arg(long, default_value_t = dda_rs::DEFAULT_WINDOW_LENGTH)]
    pub wl: u32,

    /// Window step in samples
    #[arg(long, default_value_t = dda_rs::DEFAULT_WINDOW_STEP)]
    pub ws: u32,

    /// CT-specific window length
    #[arg(long)]
    pub ct_wl: Option<u32>,

    /// CT-specific window step
    #[arg(long)]
    pub ct_ws: Option<u32>,

    /// Delay values (tau)
    #[arg(
        long,
        default_values_t = vec![dda_rs::DEFAULT_DELAYS[0], dda_rs::DEFAULT_DELAYS[1]],
        num_args = 1..
    )]
    pub delays: Vec<i32>,

    /// Model term indices (for -MODEL), e.g. 1 2 10
    /// Defaults to backend defaults when omitted.
    #[arg(long, num_args = 1..)]
    pub model: Option<Vec<i32>>,

    /// Model dimension
    #[arg(long, default_value_t = dda_rs::DEFAULT_MODEL_DIMENSION)]
    pub dm: u32,

    /// Polynomial order
    #[arg(long, default_value_t = dda_rs::DEFAULT_POLYNOMIAL_ORDER)]
    pub order: u32,

    /// Number of tau values
    #[arg(long, default_value_t = dda_rs::DEFAULT_NUM_TAU)]
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

    /// Legacy native DDA binary path (ignored; native backend disabled)
    #[arg(long, env = "DDA_BINARY_PATH")]
    pub binary: Option<String>,

    /// Output directory for per-file JSON results (default: JSONL to stdout)
    #[arg(long)]
    pub output_dir: Option<String>,

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
}

#[derive(Args)]
pub struct ServeArgs {
    /// Legacy native DDA binary path (ignored; native backend disabled)
    #[arg(long, env = "DDA_BINARY_PATH")]
    pub binary: Option<String>,

    /// Legacy no-op flag retained for compatibility
    #[arg(long, default_value_t = false)]
    pub disable_native_fallback: bool,

    /// Maximum number of columns to include in preview responses
    #[arg(long, default_value_t = 2048)]
    pub preview_columns: usize,
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
