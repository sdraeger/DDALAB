// API route handlers - Extracted from embedded_api.rs

pub mod dda;
pub mod edf;
pub mod files;
pub mod health;
pub mod history;
pub mod ica;

// Re-export all handler functions
pub use dda::*;
pub use edf::*;
pub use files::*;
pub use health::*;
pub use ica::*;
// history module is just aliases to dda functions, no need to re-export
