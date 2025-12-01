mod users;

pub use users::UserCommands;

use clap::{Parser, Subcommand};

/// DDALAB Server - Institutional DDA Analysis Server
#[derive(Parser)]
#[command(name = "ddalab-server")]
#[command(author, version, about, long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Run the server (default)
    Serve,

    /// User management commands
    #[command(subcommand)]
    User(UserCommands),

    /// Show recent audit logs
    Audit {
        /// Number of entries to show
        #[arg(short, long, default_value = "50")]
        limit: i64,

        /// Filter by user email
        #[arg(short, long)]
        user: Option<String>,
    },
}
