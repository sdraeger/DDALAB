pub mod engine;
pub mod error;
pub mod input_io;
pub mod mmap_utils;
pub mod network_motifs;
pub mod profiling;
pub mod types;
pub mod variants;

pub use engine::{
    inspect_ccd_conditioning_sets_on_matrix, profile_ccd_conditioning_subsets_on_matrix,
    run_request_on_matrix, run_request_on_matrix_with_progress,
    score_ccd_conditioning_subsets_on_matrix, CcdConditioningInspection,
    CcdConditioningSubsetProfile, CcdConditioningSubsetScore, NormalizationMode, PureRustOptions,
    PureRustProgress, PureRustRunner, SvdBackend,
};
pub use error::{DDAError, Result};
pub use input_io::{
    load_ascii_matrix_from_path, load_f64_matrix_from_path, run_request_on_ascii_file,
    run_request_on_ascii_file_with_progress, run_request_on_f64_matrix_file_with_progress,
};
pub use network_motifs::*;
pub use types::*;
pub use variants::*;
