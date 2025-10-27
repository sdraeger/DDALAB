use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Annotation file format for sharing annotations between users
/// This format is JSON-based, human-readable, and portable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationFile {
    /// Format version for future compatibility
    pub version: String,
    /// Original file path (for reference, not used for matching)
    pub file_path: String,
    /// File hash (SHA-256) for verification that annotations match the data file
    pub file_hash: Option<String>,
    /// Sample rate of the original file (for validation)
    pub sample_rate: Option<f64>,
    /// Duration of the original file in seconds (for validation)
    pub duration: Option<f64>,
    /// Global annotations (visible on all channels)
    #[serde(default)]
    pub global_annotations: Vec<AnnotationEntry>,
    /// Channel-specific annotations
    #[serde(default)]
    pub channel_annotations: HashMap<String, Vec<AnnotationEntry>>,
    /// Metadata about the annotation file
    #[serde(default)]
    pub metadata: AnnotationMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnotationEntry {
    /// Unique identifier
    pub id: String,
    /// Position in seconds (time-based coordinate)
    pub position: f64,
    /// Label text
    pub label: String,
    /// Optional description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Color (hex format: #RRGGBB)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Creation timestamp (ISO 8601 format)
    pub created_at: String,
    /// Last update timestamp (ISO 8601 format)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AnnotationMetadata {
    /// Creator/author name
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Export timestamp
    pub exported_at: String,
    /// Application version
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    /// Optional notes about the annotation set
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl AnnotationFile {
    /// Create a new annotation file
    pub fn new(file_path: String) -> Self {
        Self {
            version: "1.0".to_string(),
            file_path,
            file_hash: None,
            sample_rate: None,
            duration: None,
            global_annotations: Vec::new(),
            channel_annotations: HashMap::new(),
            metadata: AnnotationMetadata {
                author: None,
                exported_at: chrono::Utc::now().to_rfc3339(),
                app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
                notes: None,
            },
        }
    }

    /// Export to JSON file
    pub fn save_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let json = serde_json::to_string_pretty(self)
            .context("Failed to serialize annotations to JSON")?;
        std::fs::write(path, json).context("Failed to write annotation file")?;
        Ok(())
    }

    /// Import from JSON file
    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let json = std::fs::read_to_string(path).context("Failed to read annotation file")?;
        let annotation_file: AnnotationFile =
            serde_json::from_str(&json).context("Failed to parse annotation file")?;
        Ok(annotation_file)
    }

    /// Validate that this annotation file matches the current data file
    pub fn validate_compatibility(
        &self,
        current_sample_rate: Option<f64>,
        current_duration: Option<f64>,
    ) -> Result<Vec<String>> {
        let mut warnings = Vec::new();

        // Check sample rate
        if let (Some(expected), Some(actual)) = (self.sample_rate, current_sample_rate) {
            let diff = (expected - actual).abs();
            if diff > 0.01 {
                warnings.push(format!(
                    "Sample rate mismatch: annotation file expects {:.2} Hz, current file has {:.2} Hz",
                    expected, actual
                ));
            }
        }

        // Check duration
        if let (Some(expected), Some(actual)) = (self.duration, current_duration) {
            let diff = (expected - actual).abs();
            if diff > 1.0 {
                // Allow 1 second tolerance
                warnings.push(format!(
                    "Duration mismatch: annotation file expects {:.2}s, current file has {:.2}s",
                    expected, actual
                ));
            }
        }

        Ok(warnings)
    }

    /// Get total annotation count
    pub fn total_count(&self) -> usize {
        self.global_annotations.len()
            + self
                .channel_annotations
                .values()
                .map(|v| v.len())
                .sum::<usize>()
    }
}

/// Convert time-based position to DDA plot position
/// DDA analysis returns one value per window, so we need to map time positions
/// to window indices
pub fn time_to_dda_position(
    time_seconds: f64,
    _window_length: usize,
    window_step: usize,
    sample_rate: f64,
) -> f64 {
    // Convert time to sample index
    let sample_index = time_seconds * sample_rate;

    // Calculate which window this sample falls into
    // Window center = window_start + window_length / 2
    // window_start = window_index * window_step
    let window_index = sample_index / window_step as f64;

    window_index
}

/// Convert DDA plot position back to time
pub fn dda_position_to_time(
    window_index: f64,
    window_length: usize,
    window_step: usize,
    sample_rate: f64,
) -> f64 {
    // Calculate the center of the window in samples
    let sample_index = window_index * window_step as f64 + (window_length as f64 / 2.0);

    // Convert to time
    sample_index / sample_rate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_to_dda_position() {
        // Example: 256 Hz sample rate, window_length=64 (0.25s), window_step=10
        let sample_rate = 256.0;
        let window_length = 64;
        let window_step = 10;

        // At time = 1.0 second
        let time = 1.0;
        let window_pos = time_to_dda_position(time, window_length, window_step, sample_rate);

        // Expected: sample 256 / window_step 10 = window index 25.6
        assert!((window_pos - 25.6).abs() < 0.01);
    }

    #[test]
    fn test_dda_position_to_time() {
        let sample_rate = 256.0;
        let window_length = 64;
        let window_step = 10;

        // Window index 25
        let window_index = 25.0;
        let time = dda_position_to_time(window_index, window_length, window_step, sample_rate);

        // Expected: (25 * 10 + 64/2) / 256 = (250 + 32) / 256 = 1.1015625
        assert!((time - 1.1015625).abs() < 0.01);
    }

    #[test]
    fn test_annotation_file_serialization() {
        let mut ann_file = AnnotationFile::new("/path/to/file.edf".to_string());
        ann_file.sample_rate = Some(256.0);
        ann_file.duration = Some(30.0);

        ann_file.global_annotations.push(AnnotationEntry {
            id: "ann1".to_string(),
            position: 5.0,
            label: "Event A".to_string(),
            description: Some("Important event".to_string()),
            color: Some("#FF0000".to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: None,
        });

        // Test serialization
        let json = serde_json::to_string_pretty(&ann_file).unwrap();
        assert!(json.contains("Event A"));
        assert!(json.contains("1.0"));

        // Test deserialization
        let parsed: AnnotationFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.global_annotations.len(), 1);
        assert_eq!(parsed.global_annotations[0].label, "Event A");
    }
}
