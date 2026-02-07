use clap::Parser;

mod cli;
mod commands;
mod exit_codes;
mod output;

use cli::Cli;

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

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
    };

    std::process::exit(exit_code);
}
