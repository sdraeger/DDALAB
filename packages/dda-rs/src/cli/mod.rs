// The `ddalab` command line. The binary's `main` and the Python wheel's console script both run `main_with_args`.
use clap::Parser;
use rayon::ThreadPoolBuilder;
use std::ffi::OsString;

pub mod args;
pub mod commands;
pub mod dda_params;
pub mod exit_codes;
pub mod output;

use args::{Cli, Command};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RayonMode {
    Desktop,
    Throughput,
}

/// Runs `ddalab` with `args` (the program name first) and returns its exit code. Help, the version and usage errors
/// print as clap prints them and return clap's code instead of ending the process.
pub fn main_with_args<I, T>(args: I) -> i32
where
    I: IntoIterator<Item = T>,
    T: Into<OsString> + Clone,
{
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return error.exit_code();
        }
    };
    configure_rayon_pool();

    let log_level = match cli.verbose {
        0 => log::LevelFilter::Warn,
        1 => log::LevelFilter::Info,
        2 => log::LevelFilter::Debug,
        _ => log::LevelFilter::Trace,
    };
    // A second run in the same process (the Python library) keeps the first logger.
    let _ = env_logger::Builder::new()
        .filter_level(log_level)
        .format_timestamp(None)
        .try_init();

    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Error: cannot start the async runtime: {error}");
            return exit_codes::EXECUTION_ERROR;
        }
    };
    runtime.block_on(async {
        match cli.command {
            Command::Run(args) => commands::run::execute(args).await,
            Command::Info(args) => commands::info::execute(args),
            Command::Variants(args) => commands::variants::execute(args),
            Command::Validate(args) => commands::validate::execute(args),
            Command::Batch(args) => commands::batch::execute(args).await,
            Command::Inspect(args) => commands::inspect::execute(args),
            Command::Samples(args) => commands::samples::execute(args),
        }
    })
}

fn configure_rayon_pool() {
    let available_threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    let mode_override = std::env::var("DDALAB_RAYON_MODE").ok();
    let explicit_threads = std::env::var("DDALAB_RAYON_THREADS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0);
    let target_threads = resolve_rayon_thread_count(
        available_threads,
        mode_override.as_deref(),
        explicit_threads,
    );

    let _ = ThreadPoolBuilder::new()
        .num_threads(target_threads)
        .thread_name(|index| format!("ddalab-rayon-{index}"))
        .build_global();
}

fn resolve_rayon_thread_count(
    available_threads: usize,
    mode_override: Option<&str>,
    explicit_threads: Option<usize>,
) -> usize {
    if let Some(explicit) = explicit_threads.filter(|value| *value > 0) {
        return explicit;
    }

    let mode = parse_rayon_mode(mode_override).unwrap_or(RayonMode::Throughput);

    let target_threads = match mode {
        RayonMode::Desktop => {
            let reserved_threads = if available_threads >= 6 {
                2
            } else if available_threads >= 3 {
                1
            } else {
                0
            };
            available_threads.saturating_sub(reserved_threads)
        }
        RayonMode::Throughput => available_threads,
    };

    target_threads.max(1)
}

fn parse_rayon_mode(raw: Option<&str>) -> Option<RayonMode> {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("desktop") | Some("ui") | Some("responsive") => Some(RayonMode::Desktop),
        Some("throughput") | Some("max") | Some("benchmark") => Some(RayonMode::Throughput),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_rayon_mode, resolve_rayon_thread_count, RayonMode};

    #[test]
    fn parse_rayon_mode_accepts_known_aliases() {
        assert_eq!(parse_rayon_mode(Some("desktop")), Some(RayonMode::Desktop));
        assert_eq!(parse_rayon_mode(Some("UI")), Some(RayonMode::Desktop));
        assert_eq!(
            parse_rayon_mode(Some("throughput")),
            Some(RayonMode::Throughput)
        );
        assert_eq!(
            parse_rayon_mode(Some("benchmark")),
            Some(RayonMode::Throughput)
        );
        assert_eq!(parse_rayon_mode(Some("unknown")), None);
    }

    #[test]
    fn resolve_rayon_thread_count_defaults_to_throughput() {
        assert_eq!(resolve_rayon_thread_count(8, None, None), 8);
        assert_eq!(resolve_rayon_thread_count(1, None, None), 1);
    }

    #[test]
    fn resolve_rayon_thread_count_honors_mode_override() {
        assert_eq!(resolve_rayon_thread_count(8, Some("desktop"), None), 6);
        assert_eq!(resolve_rayon_thread_count(4, Some("desktop"), None), 3);
        assert_eq!(resolve_rayon_thread_count(2, Some("desktop"), None), 2);
        assert_eq!(resolve_rayon_thread_count(8, Some("throughput"), None), 8);
    }

    #[test]
    fn resolve_rayon_thread_count_honors_explicit_threads() {
        assert_eq!(resolve_rayon_thread_count(8, Some("desktop"), Some(3)), 3);
        assert_eq!(
            resolve_rayon_thread_count(8, Some("throughput"), Some(5)),
            5
        );
    }
}
