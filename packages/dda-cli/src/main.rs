use clap::Parser;
use rayon::ThreadPoolBuilder;

mod cli;
mod commands;
mod dda_params;
mod exit_codes;
mod output;

use cli::Cli;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RayonMode {
    Desktop,
    Throughput,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let prefer_ui_responsiveness = matches!(&cli.command, cli::Command::Serve(_));
    configure_rayon_pool(prefer_ui_responsiveness);

    let log_level = match cli.verbose {
        0 => log::LevelFilter::Warn,
        1 => log::LevelFilter::Info,
        2 => log::LevelFilter::Debug,
        _ => log::LevelFilter::Trace,
    };
    env_logger::Builder::new()
        .filter_level(log_level)
        .format_timestamp(None)
        .init();

    let exit_code = match cli.command {
        cli::Command::Run(args) => commands::run::execute(args).await,
        cli::Command::Info(args) => commands::info::execute(args),
        cli::Command::Variants(args) => commands::variants::execute(args),
        cli::Command::Validate(args) => commands::validate::execute(args),
        cli::Command::Batch(args) => commands::batch::execute(args).await,
        cli::Command::Serve(args) => commands::serve::execute(args).await,
    };

    std::process::exit(exit_code);
}

fn configure_rayon_pool(prefer_ui_responsiveness: bool) {
    let available_threads = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1);
    let mode_override = std::env::var("DDALAB_RAYON_MODE").ok();
    let explicit_threads = std::env::var("DDALAB_RAYON_THREADS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0);
    let target_threads = resolve_rayon_thread_count(
        prefer_ui_responsiveness,
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
    prefer_ui_responsiveness: bool,
    available_threads: usize,
    mode_override: Option<&str>,
    explicit_threads: Option<usize>,
) -> usize {
    if let Some(explicit) = explicit_threads.filter(|value| *value > 0) {
        return explicit;
    }

    let mode = parse_rayon_mode(mode_override).unwrap_or_else(|| {
        if prefer_ui_responsiveness {
            RayonMode::Desktop
        } else {
            RayonMode::Throughput
        }
    });

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
    fn resolve_rayon_thread_count_prefers_desktop_for_sidecar() {
        assert_eq!(resolve_rayon_thread_count(true, 8, None, None), 6);
        assert_eq!(resolve_rayon_thread_count(true, 4, None, None), 3);
        assert_eq!(resolve_rayon_thread_count(true, 2, None, None), 2);
    }

    #[test]
    fn resolve_rayon_thread_count_prefers_throughput_for_cli_runs() {
        assert_eq!(resolve_rayon_thread_count(false, 8, None, None), 8);
        assert_eq!(resolve_rayon_thread_count(false, 1, None, None), 1);
    }

    #[test]
    fn resolve_rayon_thread_count_honors_mode_override() {
        assert_eq!(
            resolve_rayon_thread_count(true, 8, Some("throughput"), None),
            8
        );
        assert_eq!(
            resolve_rayon_thread_count(false, 8, Some("desktop"), None),
            6
        );
    }

    #[test]
    fn resolve_rayon_thread_count_honors_explicit_threads() {
        assert_eq!(
            resolve_rayon_thread_count(true, 8, Some("desktop"), Some(3)),
            3
        );
        assert_eq!(
            resolve_rayon_thread_count(false, 8, Some("throughput"), Some(5)),
            5
        );
    }
}
