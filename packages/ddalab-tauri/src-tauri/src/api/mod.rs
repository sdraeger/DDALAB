// API module - Modular refactoring of embedded_api.rs

pub mod models;
pub mod auth;
pub mod state;
pub mod utils;
pub mod handlers;
pub mod router;
pub mod server;
pub mod overview_generator;

// Re-export commonly used types
pub use models::*;
pub use auth::{generate_session_token, auth_middleware};
pub use state::ApiState;
pub use utils::*;
pub use router::create_router;
pub use server::{ApiServerConfig, start_api_server};
