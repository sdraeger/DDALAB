pub mod error;
pub mod network_motifs;
pub mod parser;
pub mod profiling;
pub mod runner;
pub mod types;
pub mod variants;

pub use error::{DDAError, Result};
pub use network_motifs::*;
pub use parser::{parse_dda_output, parse_dda_output_with_error, ParsedDDAOutput};
pub use runner::DDARunner;
pub use types::*;
pub use variants::*;
