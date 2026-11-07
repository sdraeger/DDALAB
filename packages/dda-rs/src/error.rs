use thiserror::Error;

#[derive(Error, Debug)]
#[non_exhaustive]
pub enum DDAError {
    #[error("Input file not found: {0}")]
    FileNotFound(String),

    #[error("Unsupported file type: {0}")]
    UnsupportedFileType(String),

    /// A file of a supported type whose content does not parse: a truncated or corrupt header.
    #[error("Malformed file: {0}")]
    MalformedFile(String),

    #[error("DDA execution failed: {0}")]
    ExecutionFailed(String),

    #[error("Failed to parse DDA output: {0}")]
    ParseError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Invalid parameter: {0}")]
    InvalidParameter(String),
}

pub type Result<T> = std::result::Result<T, DDAError>;
