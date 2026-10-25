//! Synchronous random-access byte sources and the file sets recording readers consume.

mod edf;
mod recording;
mod source;

pub use edf::open_edf;
pub use recording::*;
pub use source::*;
