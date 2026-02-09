pub mod annotation_commands;
pub mod api_commands; // Unified API commands (local and remote)
pub mod batch_ipc_commands; // Batch DDA analysis via IPC
pub mod bids_export_commands;
pub mod cli_commands; // CLI install/uninstall commands
pub mod comparison_commands; // Analysis group comparison
pub mod data_directory_commands;
pub mod dda_export_commands;
pub mod dda_ipc_commands; // DDA analysis via pure IPC (no HTTP)
pub mod debug_commands;
pub mod edf_commands; // EDF/neurophysiology data access via IPC
pub mod file_commands;
pub mod file_ipc_commands; // File operations via pure IPC (no HTTP)
pub mod gallery_commands;
pub mod ica_ipc_commands; // ICA analysis via pure IPC (no HTTP)
pub mod lsl_discovery; // LSL stream discovery
pub mod migration_commands;
pub mod native_updater_commands;
pub mod notification_commands;
pub mod nsg_commands;
pub mod openneuro_commands;
pub mod plugin_commands;
pub mod preference_commands;
pub mod python_commands; // Python/MNE environment detection
pub mod scan_commands; // BIDS directory scanner for DDA-compatible files
pub mod state_commands;
pub mod streaming_commands; // Real-time data streaming and DDA
pub mod update_commands;
pub mod visualization_commands; // Phase space and other visualization computations
pub mod window_commands;

pub use annotation_commands::*;
pub use api_commands::*;
pub use batch_ipc_commands::*;
pub use bids_export_commands::*;
pub use cli_commands::*;
pub use comparison_commands::*;
pub use data_directory_commands::*;
pub use dda_export_commands::*;
pub use dda_ipc_commands::*;
pub use debug_commands::*;
pub use edf_commands::*;
pub use file_commands::*;
pub use file_ipc_commands::*;
pub use gallery_commands::*;
pub use ica_ipc_commands::*;
pub use lsl_discovery::*;
pub use migration_commands::*;
pub use native_updater_commands::*;
pub use notification_commands::*;
pub use nsg_commands::*;
pub use openneuro_commands::*;
pub use plugin_commands::*;
pub use preference_commands::*;
pub use python_commands::*;
pub use scan_commands::*;
pub use state_commands::*;
pub use streaming_commands::*;
pub use update_commands::*;
pub use visualization_commands::*;
pub use window_commands::*;
