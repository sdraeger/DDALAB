pub mod error;
pub mod generated;
pub mod network_motifs;
pub mod parser;
pub mod profiling;
pub mod runner;
pub mod types;

pub use error::{DDAError, Result};
pub use generated::variants::*;
pub use network_motifs::*;
pub use runner::DDARunner;
pub use types::*;
