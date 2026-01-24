pub mod annotation_commands;
pub mod api_commands; // Unified API commands (local and remote)
pub mod bids_export_commands;
pub mod data_directory_commands;
pub mod dda_export_commands;
pub mod debug_commands;
pub mod file_commands;
pub mod lsl_discovery; // LSL stream discovery
pub mod migration_commands;
pub mod native_updater_commands;
pub mod notification_commands;
pub mod nsg_commands;
pub mod openneuro_commands;
pub mod preference_commands;
pub mod state_commands;
pub mod streaming_commands; // Real-time data streaming and DDA
pub mod update_commands;
pub mod visualization_commands; // Phase space and other visualization computations
pub mod window_commands;

pub use annotation_commands::*;
pub use api_commands::*;
pub use bids_export_commands::*;
pub use data_directory_commands::*;
pub use dda_export_commands::*;
pub use debug_commands::*;
pub use file_commands::*;
pub use lsl_discovery::*;
pub use migration_commands::*;
pub use native_updater_commands::*;
pub use notification_commands::*;
pub use nsg_commands::*;
pub use openneuro_commands::*;
pub use preference_commands::*;
pub use state_commands::*;
pub use streaming_commands::*;
pub use update_commands::*;
pub use visualization_commands::*;
pub use window_commands::*;
