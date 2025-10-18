// API route handlers - Extracted from embedded_api.rs

pub mod health;
pub mod files;
pub mod edf;
pub mod dda;
pub mod history;

// Re-export all handler functions
pub use health::*;
pub use files::*;
pub use edf::*;
pub use dda::*;
// history module is just aliases to dda functions, no need to re-export
