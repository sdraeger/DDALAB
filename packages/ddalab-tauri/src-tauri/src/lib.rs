// Library exports for testing

pub mod api; // Modular API with server startup, handlers, auth, etc.
pub mod db;
pub mod edf;
pub mod file_readers;
pub mod file_writers; // File format writers from IntermediateData
pub mod ica; // Independent Component Analysis
pub mod intermediate_format; // Universal intermediate data format
pub mod models;
pub mod nsg;
pub mod profiling;
pub mod streaming; // Real-time data streaming and DDA processing
pub mod sync;
pub mod text_reader;
pub mod utils;
