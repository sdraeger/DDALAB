pub mod blocks;
#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
pub mod ccd_stats;
pub mod document;
pub mod engine;
pub mod error;
pub mod input_io;
pub mod io;
pub mod mmap_utils;
pub mod network_motifs;
pub mod profiling;
pub mod tiles;
pub mod types;
pub mod variants;

/// The dda-rs version, as result documents record it.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub use ccd_stats::*;
pub use engine::{
    available_cuda_devices, inspect_ccd_conditioning_sets_on_matrix,
    profile_ccd_conditioning_subsets_on_matrix, run_request_on_matrix,
    run_request_on_matrix_with_progress, score_ccd_conditioning_subsets_on_matrix,
    CcdConditioningInspection, CcdConditioningSubsetProfile, CcdConditioningSubsetScore,
    ComputeDevice, CudaDeviceInfo, NormalizationMode, PureRustOptions, PureRustProgress,
    PureRustRunner, SvdBackend,
};
pub use error::{DDAError, Result};
pub use input_io::{
    load_ascii_matrix_from_path, run_request_on_ascii_file, run_request_on_ascii_file_with_progress,
};
#[cfg(not(target_arch = "wasm32"))]
pub use io::MmapSource;
pub use io::{BlockCache, ByteSource, FileSet, MemorySource};
pub use network_motifs::*;
pub use types::*;
pub use variants::*;
