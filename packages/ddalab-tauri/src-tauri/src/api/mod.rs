// API module - Modular refactoring of embedded_api.rs

pub mod auth;
pub mod handlers;
pub mod models;
pub mod overview_generator;
pub mod router;
pub mod server;
pub mod state;
pub mod utils;

// Re-export commonly used types
pub use auth::{auth_middleware, generate_session_token};
pub use models::*;
pub use router::create_router;
pub use server::{start_api_server, ApiServerConfig};
pub use state::ApiState;
pub use utils::*;
