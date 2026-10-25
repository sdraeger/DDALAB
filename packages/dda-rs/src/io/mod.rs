//! Synchronous random-access byte sources and the file sets recording readers consume.

mod ascii;
mod brainvision;
mod edf;
mod recording;
mod source;

pub use ascii::open_ascii;
pub use brainvision::open_brainvision;
pub use edf::open_edf;
pub use recording::*;
pub use source::*;
