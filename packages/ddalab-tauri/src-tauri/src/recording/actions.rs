use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "data")]
pub enum WorkflowAction {
    // ============================================================================
    // Data Loading & Management
    // ============================================================================
    LoadFile {
        path: String,
        file_type: FileType,
    },
    CloseFile {
        file_id: String,
    },
    SwitchActiveFile {
        file_id: String,
    },

    // ============================================================================
    // Channel Operations
    // ============================================================================
    SelectChannels {
        channel_indices: Vec<usize>,
    },
    DeselectChannels {
        channel_indices: Vec<usize>,
    },
    SelectAllChannels,
    ClearChannelSelection,
    FilterChannels {
        input_id: String,
        channel_indices: Vec<usize>,
    },

    // ============================================================================
    // Time Window Operations
    // ============================================================================
    SetTimeWindow {
        start: f64,
        end: f64,
    },
    SetChunkWindow {
        chunk_start: usize,
        chunk_size: usize,
    },

    // ============================================================================
    // Preprocessing
    // ============================================================================
    ApplyPreprocessing {
        input_id: String,
        preprocessing: PreprocessingConfig,
    },

    // ============================================================================
    // DDA Configuration & Execution
    // ============================================================================
    SetDDAParameters {
        window_length: usize,
        window_step: usize,
        ct_window_length: Option<usize>,
        ct_window_step: Option<usize>,
    },
    SelectDDAVariants {
        variants: Vec<String>,
    },
    SetDelayList {
        delays: Vec<i32>,
    },
    SetModelParameters {
        dm: u32,
        order: u32,
        nr_tau: u32,
        encoding: Vec<i32>,
    },
    RunDDAAnalysis {
        input_id: String,
        channel_selection: Vec<usize>,
        ct_channel_pairs: Option<Vec<[usize; 2]>>,
        cd_channel_pairs: Option<Vec<[usize; 2]>>,
    },

    // ============================================================================
    // Annotations
    // ============================================================================
    AddAnnotation {
        annotation_type: AnnotationType,
        details: AnnotationDetails,
    },
    RemoveAnnotation {
        annotation_id: String,
    },

    // ============================================================================
    // Data Transformations
    // ============================================================================
    TransformData {
        input_id: String,
        transform_type: TransformType,
    },

    // ============================================================================
    // Visualization & Export
    // ============================================================================
    GeneratePlot {
        result_id: String,
        plot_type: PlotType,
        options: PlotOptions,
    },
    ExportResults {
        result_id: String,
        format: ExportFormat,
        path: String,
    },
    ExportPlot {
        plot_type: PlotType,
        format: String,
        path: String,
    },

    // ============================================================================
    // Analysis Results Management
    // ============================================================================
    SaveAnalysisResult {
        result_id: String,
        name: String,
    },
    LoadAnalysisFromHistory {
        result_id: String,
    },
    CompareAnalyses {
        result_ids: Vec<String>,
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
    Decimate { factor: usize },
    Resample { target_rate: f64 },
    BaselineCorrection { start: f64, end: f64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PreprocessingConfig {
    pub highpass: Option<f64>,
    pub lowpass: Option<f64>,
    pub notch: Option<Vec<f64>>,
    pub rereferencing: Option<ReferencingScheme>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ReferencingScheme {
    AverageReference,
    LinkedMastoid,
    Laplacian,
    Custom { reference_channels: Vec<usize> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AnnotationType {
    TimeSeriesMarker,
    Region,
    Event,
    ArtifactMarker,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotationDetails {
    pub time: Option<f64>,
    pub start_time: Option<f64>,
    pub end_time: Option<f64>,
    pub label: String,
    pub description: Option<String>,
    pub channel: Option<String>,
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
