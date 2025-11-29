/**
 * Preprocessing Pipeline Types
 *
 * Defines the complete type system for the preprocessing pipeline:
 * Raw Data → Bad Channel Detection → Filtering → Re-reference → ICA → Artifact Removal → DDA-Ready
 *
 * Design Principles:
 * - Non-destructive: Original data is never modified
 * - Reversible: Each step can be toggled on/off
 * - Persistent: Configuration saved per-file
 * - Previewable: See effects before applying
 * - Exportable: Save processed data to new file
 */

// ============================================================================
// Pipeline Step Base Types
// ============================================================================

export type PipelineStepType =
  | "bad_channel_detection"
  | "filtering"
  | "rereference"
  | "ica"
  | "artifact_removal";

export type PipelineStepStatus =
  | "idle"
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "skipped";

export interface PipelineStepBase {
  type: PipelineStepType;
  enabled: boolean;
  status: PipelineStepStatus;
  error?: string;
  lastRun?: string; // ISO timestamp
  duration?: number; // ms
}

// ============================================================================
// Bad Channel Detection Step
// ============================================================================

export type BadChannelMethod =
  | "variance" // High variance threshold
  | "correlation" // Low correlation with neighbors
  | "flat" // Flat/constant signal detection
  | "noise" // High-frequency noise detection
  | "combined"; // Multiple methods

export interface BadChannelConfig {
  method: BadChannelMethod;
  varianceThreshold: number; // Standard deviations (e.g., 3.5)
  correlationThreshold: number; // Minimum correlation (e.g., 0.4)
  flatThreshold: number; // Variance below this = flat (e.g., 1e-6)
  noiseThreshold: number; // High-freq power ratio (e.g., 0.3)
  autoDetect: boolean;
  manualBadChannels: string[]; // User-marked bad channels
}

export interface BadChannelResult {
  detectedBadChannels: string[];
  channelScores: Record<string, number>; // Channel name -> score
  method: BadChannelMethod;
}

export interface BadChannelDetectionStep extends PipelineStepBase {
  type: "bad_channel_detection";
  config: BadChannelConfig;
  result?: BadChannelResult;
}

// ============================================================================
// Filtering Step
// ============================================================================

export type FilterType =
  | "highpass"
  | "lowpass"
  | "bandpass"
  | "bandstop"
  | "notch";
export type FilterDesign = "butterworth" | "chebyshev1" | "chebyshev2" | "fir";

export interface FilterConfig {
  type: FilterType;
  design: FilterDesign;
  order: number; // Filter order (e.g., 4)
  highpassFreq?: number; // Hz
  lowpassFreq?: number; // Hz
  notchFreqs?: number[]; // Hz (e.g., [50, 60, 100, 120])
  notchWidth?: number; // Hz (bandwidth around notch)
  zeroPhase: boolean; // Forward-backward filtering
}

export interface FilteringConfig {
  filters: FilterConfig[];
  applyOrder: "sequential" | "parallel"; // Apply filters in sequence or merge
}

export interface FilteringStep extends PipelineStepBase {
  type: "filtering";
  config: FilteringConfig;
}

// ============================================================================
// Re-reference Step
// ============================================================================

export type ReferenceType =
  | "none" // No re-referencing
  | "average" // Average reference
  | "linked_mastoid" // Linked mastoids (A1+A2)/2
  | "single" // Single electrode reference
  | "bipolar" // Bipolar montage
  | "laplacian" // Surface Laplacian
  | "custom"; // Custom reference scheme

export interface ReferenceConfig {
  type: ReferenceType;
  referenceChannels?: string[]; // For single/linked reference
  excludeChannels?: string[]; // Channels to exclude from average
  bipolarPairs?: Array<[string, string]>; // For bipolar montage
  neighborRadius?: number; // For Laplacian (in electrode units)
}

export interface RereferenceStep extends PipelineStepBase {
  type: "rereference";
  config: ReferenceConfig;
}

// ============================================================================
// ICA Step
// ============================================================================

export type ICAAlgorithm = "fastica" | "infomax" | "jade" | "sobi";
export type ICANonlinearity = "logcosh" | "exp" | "cube";

export interface ICAConfig {
  algorithm: ICAAlgorithm;
  nComponents?: number; // Number of components (undefined = auto)
  maxIterations: number;
  tolerance: number;
  nonlinearity: ICANonlinearity;
  randomSeed?: number;
  // Artifact classification
  autoClassify: boolean;
  eyeBlinkThreshold?: number;
  muscleThreshold?: number;
  heartbeatThreshold?: number;
}

export interface ICAComponentInfo {
  index: number;
  varianceExplained: number;
  topography?: number[]; // Scalp projection weights
  timeSeries?: number[]; // Sample of component time series
  spectrum?: { freq: number; power: number }[];
  classification?: {
    type:
      | "brain"
      | "eye_blink"
      | "eye_movement"
      | "muscle"
      | "heartbeat"
      | "line_noise"
      | "unknown";
    confidence: number;
  };
  isRejected: boolean;
}

export interface ICAResult {
  mixingMatrix: number[][];
  unmixingMatrix: number[][];
  components: ICAComponentInfo[];
  meanVector: number[];
  whiteningMatrix?: number[][];
}

export interface ICAStep extends PipelineStepBase {
  type: "ica";
  config: ICAConfig;
  result?: ICAResult;
  rejectedComponents: number[]; // User-selected components to remove
}

// ============================================================================
// Artifact Removal Step
// ============================================================================

export type ArtifactType =
  | "threshold" // Amplitude threshold
  | "gradient" // Rapid change detection
  | "muscle" // High-frequency muscle artifact
  | "eye_blink" // Eye blink detection
  | "jump" // Signal discontinuity
  | "flat"; // Flat signal segments

export interface ArtifactDetectionConfig {
  type: ArtifactType;
  enabled: boolean;
  threshold: number;
  windowSize?: number; // samples
  minDuration?: number; // samples
}

export type ArtifactAction = "mark" | "interpolate" | "reject_epoch" | "zero";

export interface ArtifactRemovalConfig {
  detectors: ArtifactDetectionConfig[];
  action: ArtifactAction;
  epochPadding: number; // Samples before/after artifact to include
  interpolationMethod?: "linear" | "spline" | "neighbor";
}

export interface ArtifactSegment {
  start: number; // Sample index
  end: number; // Sample index
  channel?: string; // If channel-specific
  type: ArtifactType;
  severity: number;
}

export interface ArtifactRemovalResult {
  detectedArtifacts: ArtifactSegment[];
  percentClean: number; // Percentage of clean data
  channelArtifactCounts: Record<string, number>;
}

export interface ArtifactRemovalStep extends PipelineStepBase {
  type: "artifact_removal";
  config: ArtifactRemovalConfig;
  result?: ArtifactRemovalResult;
}

// ============================================================================
// Complete Pipeline Types
// ============================================================================

export type PipelineStep =
  | BadChannelDetectionStep
  | FilteringStep
  | RereferenceStep
  | ICAStep
  | ArtifactRemovalStep;

export interface PreprocessingPipeline {
  id: string;
  fileId: string; // Associated file path or ID
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  steps: {
    badChannelDetection: BadChannelDetectionStep;
    filtering: FilteringStep;
    rereference: RereferenceStep;
    ica: ICAStep;
    artifactRemoval: ArtifactRemovalStep;
  };
  isRunning: boolean;
  currentStepIndex: number;
  totalProgress: number; // 0-100
}

// ============================================================================
// Pipeline Presets
// ============================================================================

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  category: "eeg" | "meg" | "ecog" | "lfp" | "custom";
  steps: {
    badChannelDetection: Omit<
      BadChannelDetectionStep,
      "status" | "lastRun" | "duration" | "error" | "result"
    >;
    filtering: Omit<FilteringStep, "status" | "lastRun" | "duration" | "error">;
    rereference: Omit<
      RereferenceStep,
      "status" | "lastRun" | "duration" | "error"
    >;
    ica: Omit<ICAStep, "status" | "lastRun" | "duration" | "error" | "result">;
    artifactRemoval: Omit<
      ArtifactRemovalStep,
      "status" | "lastRun" | "duration" | "error" | "result"
    >;
  };
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_BAD_CHANNEL_CONFIG: BadChannelConfig = {
  method: "combined",
  varianceThreshold: 3.5,
  correlationThreshold: 0.4,
  flatThreshold: 1e-6,
  noiseThreshold: 0.3,
  autoDetect: true,
  manualBadChannels: [],
};

export const DEFAULT_FILTERING_CONFIG: FilteringConfig = {
  filters: [
    {
      type: "highpass",
      design: "butterworth",
      order: 4,
      highpassFreq: 0.5,
      zeroPhase: true,
    },
    {
      type: "lowpass",
      design: "butterworth",
      order: 4,
      lowpassFreq: 70,
      zeroPhase: true,
    },
    {
      type: "notch",
      design: "butterworth",
      order: 4,
      notchFreqs: [50, 60],
      notchWidth: 2,
      zeroPhase: true,
    },
  ],
  applyOrder: "sequential",
};

export const DEFAULT_REFERENCE_CONFIG: ReferenceConfig = {
  type: "average",
  excludeChannels: [],
};

export const DEFAULT_ICA_CONFIG: ICAConfig = {
  algorithm: "fastica",
  maxIterations: 1000,
  tolerance: 1e-4,
  nonlinearity: "logcosh",
  autoClassify: true,
  eyeBlinkThreshold: 0.8,
  muscleThreshold: 0.7,
  heartbeatThreshold: 0.7,
};

export const DEFAULT_ARTIFACT_REMOVAL_CONFIG: ArtifactRemovalConfig = {
  detectors: [
    { type: "threshold", enabled: true, threshold: 100, windowSize: 256 },
    { type: "gradient", enabled: true, threshold: 50, windowSize: 10 },
    { type: "flat", enabled: true, threshold: 1e-6, minDuration: 100 },
  ],
  action: "interpolate",
  epochPadding: 50,
  interpolationMethod: "spline",
};

// ============================================================================
// Factory Functions
// ============================================================================

export function createDefaultBadChannelStep(): BadChannelDetectionStep {
  return {
    type: "bad_channel_detection",
    enabled: true,
    status: "idle",
    config: { ...DEFAULT_BAD_CHANNEL_CONFIG },
  };
}

export function createDefaultFilteringStep(): FilteringStep {
  return {
    type: "filtering",
    enabled: true,
    status: "idle",
    config: { ...DEFAULT_FILTERING_CONFIG },
  };
}

export function createDefaultRereferenceStep(): RereferenceStep {
  return {
    type: "rereference",
    enabled: true,
    status: "idle",
    config: { ...DEFAULT_REFERENCE_CONFIG },
  };
}

export function createDefaultICAStep(): ICAStep {
  return {
    type: "ica",
    enabled: true,
    status: "idle",
    config: { ...DEFAULT_ICA_CONFIG },
    rejectedComponents: [],
  };
}

export function createDefaultArtifactRemovalStep(): ArtifactRemovalStep {
  return {
    type: "artifact_removal",
    enabled: true,
    status: "idle",
    config: { ...DEFAULT_ARTIFACT_REMOVAL_CONFIG },
  };
}

export function createDefaultPipelineStep(
  type: PipelineStepType,
): PipelineStep {
  switch (type) {
    case "bad_channel_detection":
      return createDefaultBadChannelStep();
    case "filtering":
      return createDefaultFilteringStep();
    case "rereference":
      return createDefaultRereferenceStep();
    case "ica":
      return createDefaultICAStep();
    case "artifact_removal":
      return createDefaultArtifactRemovalStep();
    default:
      throw new Error(`Unknown pipeline step type: ${type}`);
  }
}

export function createDefaultPipeline(
  fileId: string,
  name?: string,
): PreprocessingPipeline {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    fileId,
    name: name ?? "Default Pipeline",
    createdAt: now,
    updatedAt: now,
    steps: {
      badChannelDetection: createDefaultBadChannelStep(),
      filtering: createDefaultFilteringStep(),
      rereference: createDefaultRereferenceStep(),
      ica: createDefaultICAStep(),
      artifactRemoval: createDefaultArtifactRemovalStep(),
    },
    isRunning: false,
    currentStepIndex: -1,
    totalProgress: 0,
  };
}

// ============================================================================
// Built-in Presets
// ============================================================================

export const BUILT_IN_PRESETS: PipelinePreset[] = [
  {
    id: "eeg-standard",
    name: "Standard EEG",
    description:
      "Standard preprocessing for scalp EEG (0.5-70 Hz, average reference, ICA artifact removal)",
    isBuiltIn: true,
    category: "eeg",
    steps: {
      badChannelDetection: {
        type: "bad_channel_detection",
        enabled: true,
        config: DEFAULT_BAD_CHANNEL_CONFIG,
      },
      filtering: {
        type: "filtering",
        enabled: true,
        config: DEFAULT_FILTERING_CONFIG,
      },
      rereference: {
        type: "rereference",
        enabled: true,
        config: { type: "average", excludeChannels: [] },
      },
      ica: {
        type: "ica",
        enabled: true,
        config: DEFAULT_ICA_CONFIG,
        rejectedComponents: [],
      },
      artifactRemoval: {
        type: "artifact_removal",
        enabled: true,
        config: DEFAULT_ARTIFACT_REMOVAL_CONFIG,
      },
    },
  },
  {
    id: "eeg-erp",
    name: "ERP Analysis",
    description:
      "Optimized for event-related potentials (0.1-30 Hz, average reference)",
    isBuiltIn: true,
    category: "eeg",
    steps: {
      badChannelDetection: {
        type: "bad_channel_detection",
        enabled: true,
        config: DEFAULT_BAD_CHANNEL_CONFIG,
      },
      filtering: {
        type: "filtering",
        enabled: true,
        config: {
          filters: [
            {
              type: "highpass",
              design: "butterworth",
              order: 4,
              highpassFreq: 0.1,
              zeroPhase: true,
            },
            {
              type: "lowpass",
              design: "butterworth",
              order: 4,
              lowpassFreq: 30,
              zeroPhase: true,
            },
            {
              type: "notch",
              design: "butterworth",
              order: 4,
              notchFreqs: [50, 60],
              notchWidth: 2,
              zeroPhase: true,
            },
          ],
          applyOrder: "sequential",
        },
      },
      rereference: {
        type: "rereference",
        enabled: true,
        config: { type: "average", excludeChannels: [] },
      },
      ica: {
        type: "ica",
        enabled: true,
        config: DEFAULT_ICA_CONFIG,
        rejectedComponents: [],
      },
      artifactRemoval: {
        type: "artifact_removal",
        enabled: true,
        config: {
          ...DEFAULT_ARTIFACT_REMOVAL_CONFIG,
          action: "reject_epoch",
        },
      },
    },
  },
  {
    id: "eeg-minimal",
    name: "Minimal Preprocessing",
    description:
      "Light preprocessing (1-100 Hz, no ICA) for exploratory analysis",
    isBuiltIn: true,
    category: "eeg",
    steps: {
      badChannelDetection: {
        type: "bad_channel_detection",
        enabled: false,
        config: DEFAULT_BAD_CHANNEL_CONFIG,
      },
      filtering: {
        type: "filtering",
        enabled: true,
        config: {
          filters: [
            {
              type: "highpass",
              design: "butterworth",
              order: 2,
              highpassFreq: 1,
              zeroPhase: true,
            },
            {
              type: "lowpass",
              design: "butterworth",
              order: 2,
              lowpassFreq: 100,
              zeroPhase: true,
            },
          ],
          applyOrder: "sequential",
        },
      },
      rereference: {
        type: "rereference",
        enabled: false,
        config: { type: "none" },
      },
      ica: {
        type: "ica",
        enabled: false,
        config: DEFAULT_ICA_CONFIG,
        rejectedComponents: [],
      },
      artifactRemoval: {
        type: "artifact_removal",
        enabled: false,
        config: DEFAULT_ARTIFACT_REMOVAL_CONFIG,
      },
    },
  },
  {
    id: "dda-optimized",
    name: "DDA Optimized",
    description: "Preprocessing optimized for Delay Differential Analysis",
    isBuiltIn: true,
    category: "custom",
    steps: {
      badChannelDetection: {
        type: "bad_channel_detection",
        enabled: true,
        config: {
          ...DEFAULT_BAD_CHANNEL_CONFIG,
          varianceThreshold: 4.0, // More conservative for DDA
        },
      },
      filtering: {
        type: "filtering",
        enabled: true,
        config: {
          filters: [
            {
              type: "highpass",
              design: "butterworth",
              order: 4,
              highpassFreq: 0.5,
              zeroPhase: true,
            },
            {
              type: "lowpass",
              design: "butterworth",
              order: 4,
              lowpassFreq: 50,
              zeroPhase: true,
            }, // Lower cutoff for DDA
          ],
          applyOrder: "sequential",
        },
      },
      rereference: {
        type: "rereference",
        enabled: true,
        config: { type: "average", excludeChannels: [] },
      },
      ica: {
        type: "ica",
        enabled: true,
        config: {
          ...DEFAULT_ICA_CONFIG,
          autoClassify: true,
        },
        rejectedComponents: [],
      },
      artifactRemoval: {
        type: "artifact_removal",
        enabled: true,
        config: {
          ...DEFAULT_ARTIFACT_REMOVAL_CONFIG,
          action: "interpolate", // Maintain continuous data for DDA
        },
      },
    },
  },
];
