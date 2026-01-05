//! Shareable content type definitions and serialization
//!
//! Each content type has a corresponding data structure that can be
//! serialized to JSON for storage and transmission.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::types::ShareableContentType;

/// Annotation shared content - user annotations on time series or results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedAnnotation {
    /// Original file path (for context, not for access)
    pub source_file: String,
    /// Channel name if channel-specific, None for global
    pub channel: Option<String>,
    /// Position on x-axis (time in seconds or sample index)
    pub position: f64,
    /// User-provided label
    pub label: String,
    /// Optional detailed description
    pub description: Option<String>,
    /// Hex color code
    pub color: String,
    /// When annotation was created
    pub created_at: DateTime<Utc>,
}

/// Workflow shared content - recorded analysis workflow
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedWorkflow {
    /// Workflow name
    pub name: String,
    /// User description
    pub description: Option<String>,
    /// Workflow version
    pub version: String,
    /// Serialized workflow nodes (actions)
    pub nodes: Vec<WorkflowNodeData>,
    /// Edges defining dependencies
    pub edges: Vec<WorkflowEdgeData>,
    /// When workflow was created
    pub created_at: DateTime<Utc>,
    /// When workflow was last modified
    pub modified_at: DateTime<Utc>,
}

/// Serialized workflow node
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNodeData {
    pub id: String,
    pub action_type: String,
    pub action_data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub description: Option<String>,
    pub tags: Vec<String>,
}

/// Serialized workflow edge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEdgeData {
    pub source: String,
    pub target: String,
    pub dependency_type: String,
}

/// Parameter set shared content - saved DDA configurations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedParameterSet {
    /// Display name for this parameter preset
    pub name: String,
    /// User description of when to use these parameters
    pub description: Option<String>,
    /// DDA variants to run
    pub variants: Vec<String>,
    /// Window length in samples
    pub window_length: u32,
    /// Window step in samples
    pub window_step: u32,
    /// Delay configuration
    pub delay_config: DelayConfig,
    /// Cross-target parameters (optional)
    pub ct_parameters: Option<CTParameters>,
    /// Additional variant-specific parameters
    pub additional_parameters: Option<serde_json::Value>,
    /// When parameter set was created
    pub created_at: DateTime<Utc>,
}

/// Delay configuration for parameter sets
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum DelayConfig {
    Range { min: u32, max: u32, num: u32 },
    List { delays: Vec<u32> },
}

/// Cross-target analysis parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CTParameters {
    pub ct_delay_min: u32,
    pub ct_delay_max: u32,
    pub ct_delay_step: u32,
    pub ct_window_min: u32,
    pub ct_window_max: u32,
    pub ct_window_step: u32,
}

/// Data segment shared content - time-windowed raw data excerpt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedDataSegment {
    /// Original source file (for reference)
    pub source_file: String,
    /// File hash for integrity verification
    pub source_file_hash: String,
    /// Start time in seconds
    pub start_time: f64,
    /// End time in seconds
    pub end_time: f64,
    /// Sample rate in Hz
    pub sample_rate: f64,
    /// Channel names included in segment
    pub channels: Vec<String>,
    /// Number of samples per channel
    pub sample_count: u64,
    /// Actual data stored as base64-encoded binary or reference to blob storage
    pub data_reference: DataReference,
    /// When segment was created
    pub created_at: DateTime<Utc>,
}

/// Reference to actual data content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DataReference {
    /// Data is stored inline as base64
    Inline { base64_data: String },
    /// Data is stored in blob storage
    BlobReference { blob_id: String, size_bytes: u64 },
}

/// Union type for any shareable content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "content_type", rename_all = "snake_case")]
pub enum ShareableContent {
    DdaResult {
        /// Reference to existing DDA result ID
        result_id: String,
    },
    Annotation(SharedAnnotation),
    Workflow(SharedWorkflow),
    ParameterSet(SharedParameterSet),
    DataSegment(SharedDataSegment),
}

impl ShareableContent {
    /// Returns the content type enum value
    pub fn content_type(&self) -> ShareableContentType {
        match self {
            ShareableContent::DdaResult { .. } => ShareableContentType::DdaResult,
            ShareableContent::Annotation(_) => ShareableContentType::Annotation,
            ShareableContent::Workflow(_) => ShareableContentType::Workflow,
            ShareableContent::ParameterSet(_) => ShareableContentType::ParameterSet,
            ShareableContent::DataSegment(_) => ShareableContentType::DataSegment,
        }
    }

    /// Returns a descriptive title for the content
    pub fn default_title(&self) -> String {
        match self {
            ShareableContent::DdaResult { result_id } => format!("DDA Result {}", result_id),
            ShareableContent::Annotation(a) => a.label.clone(),
            ShareableContent::Workflow(w) => w.name.clone(),
            ShareableContent::ParameterSet(p) => p.name.clone(),
            ShareableContent::DataSegment(d) => {
                format!("Data Segment ({:.1}s - {:.1}s)", d.start_time, d.end_time)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shareable_content_serialization() {
        let annotation = SharedAnnotation {
            source_file: "/path/to/file.edf".to_string(),
            channel: Some("Fp1".to_string()),
            position: 10.5,
            label: "Artifact".to_string(),
            description: Some("Eye blink".to_string()),
            color: "#FF0000".to_string(),
            created_at: Utc::now(),
        };

        let content = ShareableContent::Annotation(annotation);
        let json = serde_json::to_string(&content).unwrap();
        let deserialized: ShareableContent = serde_json::from_str(&json).unwrap();

        assert_eq!(content.content_type(), deserialized.content_type());
    }

    #[test]
    fn test_delay_config_serialization() {
        let range = DelayConfig::Range {
            min: 1,
            max: 50,
            num: 10,
        };
        let json = serde_json::to_string(&range).unwrap();
        assert!(json.contains("\"mode\":\"range\""));

        let list = DelayConfig::List {
            delays: vec![1, 5, 10, 20],
        };
        let json = serde_json::to_string(&list).unwrap();
        assert!(json.contains("\"mode\":\"list\""));
    }

    #[test]
    fn test_parameter_set_serialization() {
        let params = SharedParameterSet {
            name: "Test Config".to_string(),
            description: Some("For testing".to_string()),
            variants: vec!["ST".to_string(), "CT".to_string()],
            window_length: 1000,
            window_step: 100,
            delay_config: DelayConfig::Range {
                min: 1,
                max: 50,
                num: 10,
            },
            ct_parameters: None,
            additional_parameters: None,
            created_at: Utc::now(),
        };

        let json = serde_json::to_string(&params).unwrap();
        let deserialized: SharedParameterSet = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.name, "Test Config");
        assert_eq!(deserialized.variants.len(), 2);
    }

    #[test]
    fn test_workflow_serialization() {
        let workflow = SharedWorkflow {
            name: "Test Workflow".to_string(),
            description: None,
            version: "1.0.0".to_string(),
            nodes: vec![],
            edges: vec![],
            created_at: Utc::now(),
            modified_at: Utc::now(),
        };

        let content = ShareableContent::Workflow(workflow);
        let json = serde_json::to_string(&content).unwrap();
        let deserialized: ShareableContent = serde_json::from_str(&json).unwrap();

        if let ShareableContent::Workflow(w) = deserialized {
            assert_eq!(w.name, "Test Workflow");
            assert_eq!(w.version, "1.0.0");
        } else {
            panic!("Expected Workflow variant");
        }
    }

    #[test]
    fn test_data_reference_serialization() {
        let inline = DataReference::Inline {
            base64_data: "SGVsbG8gV29ybGQ=".to_string(),
        };
        let json = serde_json::to_string(&inline).unwrap();
        assert!(json.contains("\"type\":\"inline\""));

        let blob_ref = DataReference::BlobReference {
            blob_id: "abc123".to_string(),
            size_bytes: 1024,
        };
        let json = serde_json::to_string(&blob_ref).unwrap();
        assert!(json.contains("\"type\":\"blob_reference\""));
    }
}
