// API module - Modular refactoring of embedded_api.rs

pub mod auth;
pub mod crypto;
pub mod encryption_middleware;
pub mod handlers;
pub mod models;
pub mod overview_generator;
pub mod router;
pub mod server;
pub mod state;
pub mod utils;

// Re-export commonly used types
pub use auth::{auth_middleware, generate_session_token};
pub use crypto::{decrypt_payload, encrypt_payload, CryptoError, EncryptionKey};
pub use encryption_middleware::{encryption_middleware, EncryptionState, ENCRYPTED_CONTENT_TYPE};
pub use models::*;
pub use router::{create_router, create_router_with_encryption};
pub use server::{start_api_server, ApiServerConfig, ApiServerResult};
pub use state::ApiState;
pub use utils::*;
