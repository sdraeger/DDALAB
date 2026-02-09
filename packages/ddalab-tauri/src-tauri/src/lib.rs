//! # DDALAB Tauri Backend
//!
//! This crate provides the Rust backend for the DDALAB desktop application,
//! implementing Delay Differential Analysis (DDA) for neurophysiology data.
//!
//! ## Architecture
//!
//! The backend is organized into several key modules:
//!
//! - [`file_readers`] - Support for multiple neurophysiology file formats (EDF, BrainVision, XDF, etc.)
//! - [`file_writers`] - Export data to various formats
//! - [`streaming`] - Real-time data acquisition and processing
//! - [`ica`] - Independent Component Analysis for artifact removal
//! - [`sync`] - Multi-device synchronization
//! - [`nsg`] - Neuroscience Gateway (NSG) integration for HPC job submission
//!
//! ## File Format Support
//!
//! Supported input formats:
//! - EDF/EDF+ (European Data Format)
//! - BrainVision (.vhdr/.vmrk/.eeg)
//! - EEGLAB (.set)
//! - FIF/FIFF (Neuromag/Elekta)
//! - NIfTI (.nii/.nii.gz)
//! - XDF (Lab Streaming Layer)
//! - CSV/ASCII
//! - NWB (optional, requires `nwb-support` feature)
//!
//! ## Features
//!
//! - `lsl-support` - Enable Lab Streaming Layer integration
//! - `nwb-support` - Enable NWB file format support
//!
//! ## Example
//!
//! ```rust,ignore
//! use ddalab_tauri::file_readers::FileReaderFactory;
//! use std::path::Path;
//!
//! // Load a file
//! let reader = FileReaderFactory::create_reader(Path::new("data.edf"))?;
//! let data = FileReaderFactory::to_intermediate_data(&*reader, None)?;
//!
//! // Process with DDA...
//! ```

pub mod api;
pub mod db;
pub mod edf;
pub mod file_readers;
pub mod file_writers; // File format writers from IntermediateData
pub mod gallery; // Static site gallery generator
pub mod ica; // Independent Component Analysis
pub mod intermediate_format; // Universal intermediate data format
pub mod models;
pub mod nsg;
pub mod plugins; // WASM plugin system
pub mod profiling;
pub mod signal_processing; // Digital signal processing (filters, preprocessing)
pub mod streaming; // Real-time data streaming and DDA processing
pub mod sync;
pub mod tasks; // Task management with cancellation support
pub mod text_reader;
pub mod utils;
