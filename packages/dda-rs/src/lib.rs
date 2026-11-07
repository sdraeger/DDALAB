pub mod blocks;
pub mod ccd_stats;
#[cfg(not(target_arch = "wasm32"))]
pub mod classify;
#[cfg(not(target_arch = "wasm32"))]
pub mod cli;
pub mod document;
pub mod engine;
pub mod error;
pub mod io;
#[cfg(not(target_arch = "wasm32"))]
pub mod lsl;
pub mod profiling;
pub mod tiles;
pub mod types;
pub mod variants;

/// The dda-rs version, as result documents record it.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub use ccd_stats::*;
pub use engine::{
    available_cuda_devices, available_gpu_devices, inspect_ccd_conditioning_sets_on_matrix,
    profile_ccd_conditioning_subsets_on_matrix, run_request_on_matrix,
    run_request_on_matrix_with_progress, score_ccd_conditioning_subsets_on_matrix,
    CcdConditioningInspection, CcdConditioningSubsetProfile, CcdConditioningSubsetScore,
    ComputeDevice, CudaDeviceInfo, GpuDeviceInfo, NormalizationMode, PureRustOptions,
    PureRustProgress, PureRustRunner, SvdBackend,
};
pub use error::{DDAError, Result};
#[cfg(not(target_arch = "wasm32"))]
pub use io::FileSource;
pub use io::{BlockCache, ByteSource, FileSet, MemorySource};
pub use types::*;
pub use variants::*;
