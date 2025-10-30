use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum WorkflowAction {
    LoadFile {
        path: String,
        file_type: FileType,
    },
    SetDDAParameters {
        lag: u32,
        dimension: u32,
        window_size: u32,
        window_offset: u32,
    },
    RunDDAAnalysis {
        input_id: String,
        channel_selection: Vec<usize>,
    },
    ExportResults {
        result_id: String,
        format: ExportFormat,
        path: String,
    },
    GeneratePlot {
        result_id: String,
        plot_type: PlotType,
        options: PlotOptions,
    },
    FilterChannels {
        input_id: String,
        channel_indices: Vec<usize>,
    },
    TransformData {
        input_id: String,
        transform_type: TransformType,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileType {
    EDF,
    ASCII,
    CSV,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    CSV,
    JSON,
    MAT,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PlotType {
    Heatmap,
    TimeSeries,
    StatisticalSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlotOptions {
    pub title: Option<String>,
    pub colormap: Option<String>,
    pub normalize: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransformType {
    Normalize,
    BandpassFilter { low_freq: f64, high_freq: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowNode {
    pub id: String,
    pub action: WorkflowAction,
    pub timestamp: DateTime<Utc>,
    pub metadata: NodeMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeMetadata {
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub user_notes: Option<String>,
}

impl WorkflowNode {
    pub fn new(id: String, action: WorkflowAction) -> Self {
        Self {
            id,
            action,
            timestamp: Utc::now(),
            metadata: NodeMetadata {
                description: None,
                tags: Vec::new(),
                user_notes: None,
            },
        }
    }

    pub fn with_metadata(mut self, metadata: NodeMetadata) -> Self {
        self.metadata = metadata;
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEdge {
    pub source: String,
    pub target: String,
    pub dependency_type: DependencyType,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DependencyType {
    DataDependency,
    ParameterDependency,
    OrderDependency,
}
