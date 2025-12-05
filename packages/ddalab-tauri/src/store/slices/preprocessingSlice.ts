/**
 * Preprocessing Pipeline State Slice
 *
 * Manages the preprocessing pipeline state for each file:
 * Raw Data → Bad Channel Detection → Filtering → Re-reference → ICA → Artifact Removal → DDA-Ready
 */

import type { ImmerStateCreator } from "./types";
import type {
  PreprocessingPipeline,
  PipelinePreset,
  PipelineStep,
  PipelineStepType,
  PipelineStepStatus,
  BadChannelConfig,
  FilteringConfig,
  ReferenceConfig,
  ICAConfig,
  ArtifactRemovalConfig,
  ICAComponentInfo,
} from "@/types/preprocessing";
import {
  createDefaultPipeline,
  createDefaultPipelineStep,
  BUILT_IN_PRESETS,
} from "@/types/preprocessing";

// ============================================================================
// State Interface
// ============================================================================

export interface PreprocessingState {
  // Pipelines keyed by file ID
  pipelines: Record<string, PreprocessingPipeline>;
  // Currently active pipeline (for the selected file)
  activePipelineId: string | null;
  // Custom user presets (built-in presets are constants)
  customPresets: PipelinePreset[];
  // Preview mode - shows processed vs original comparison
  previewMode: boolean;
  // Which channel to preview (null = all)
  previewChannel: string | null;
}

// ============================================================================
// Actions Interface
// ============================================================================

export interface PreprocessingActions {
  // Pipeline lifecycle
  createPipeline: (fileId: string, name?: string, presetId?: string) => string;
  deletePipeline: (pipelineId: string) => void;
  duplicatePipeline: (pipelineId: string, newName?: string) => string | null;
  setActivePipeline: (pipelineId: string | null) => void;

  // Pipeline modification
  renamePipeline: (pipelineId: string, name: string) => void;
  applyPreset: (pipelineId: string, presetId: string) => void;

  // Step enable/disable
  setStepEnabled: (
    pipelineId: string,
    stepType: PipelineStepType,
    enabled: boolean,
  ) => void;
  setAllStepsEnabled: (pipelineId: string, enabled: boolean) => void;

  // Step configuration
  updateBadChannelConfig: (
    pipelineId: string,
    config: Partial<BadChannelConfig>,
  ) => void;
  updateFilteringConfig: (
    pipelineId: string,
    config: Partial<FilteringConfig>,
  ) => void;
  updateReferenceConfig: (
    pipelineId: string,
    config: Partial<ReferenceConfig>,
  ) => void;
  updateICAConfig: (pipelineId: string, config: Partial<ICAConfig>) => void;
  updateArtifactRemovalConfig: (
    pipelineId: string,
    config: Partial<ArtifactRemovalConfig>,
  ) => void;

  // Step status updates (called during processing)
  setStepStatus: (
    pipelineId: string,
    stepType: PipelineStepType,
    status: PipelineStepStatus,
    error?: string,
  ) => void;
  setStepResult: (
    pipelineId: string,
    stepType: PipelineStepType,
    result: unknown,
  ) => void;

  // ICA-specific actions
  setICAComponents: (
    pipelineId: string,
    components: ICAComponentInfo[],
  ) => void;
  toggleICAComponentRejection: (
    pipelineId: string,
    componentIndex: number,
  ) => void;
  setICAComponentClassification: (
    pipelineId: string,
    componentIndex: number,
    classification: ICAComponentInfo["classification"],
  ) => void;

  // Bad channel manual selection
  addManualBadChannel: (pipelineId: string, channel: string) => void;
  removeManualBadChannel: (pipelineId: string, channel: string) => void;

  // Pipeline execution
  setPipelineRunning: (pipelineId: string, running: boolean) => void;
  setPipelineProgress: (
    pipelineId: string,
    stepIndex: number,
    progress: number,
  ) => void;
  resetPipelineResults: (pipelineId: string) => void;

  // Presets
  saveAsPreset: (
    pipelineId: string,
    name: string,
    description?: string,
  ) => string;
  deleteCustomPreset: (presetId: string) => void;

  // Preview
  setPreviewMode: (enabled: boolean) => void;
  setPreviewChannel: (channel: string | null) => void;

  // Utilities
  getPipeline: (pipelineId: string) => PreprocessingPipeline | undefined;
  getPipelineForFile: (fileId: string) => PreprocessingPipeline | undefined;
  getAllPresets: () => PipelinePreset[];
}

// ============================================================================
// Combined Slice Type
// ============================================================================

export interface PreprocessingSlice extends PreprocessingActions {
  preprocessing: PreprocessingState;
}

// ============================================================================
// Default State
// ============================================================================

export const defaultPreprocessingState: PreprocessingState = {
  pipelines: {},
  activePipelineId: null,
  customPresets: [],
  previewMode: false,
  previewChannel: null,
};

// ============================================================================
// Slice Implementation
// ============================================================================

export const createPreprocessingSlice: ImmerStateCreator<PreprocessingSlice> = (
  set,
  get,
) => ({
  preprocessing: defaultPreprocessingState,

  // Pipeline lifecycle
  createPipeline: (fileId, name, presetId) => {
    const pipeline = createDefaultPipeline(fileId, name);

    set((state) => {
      // Apply preset if specified
      if (presetId) {
        const preset = [
          ...BUILT_IN_PRESETS,
          ...state.preprocessing.customPresets,
        ].find((p) => p.id === presetId);
        if (preset) {
          pipeline.steps = {
            badChannelDetection: {
              ...preset.steps.badChannelDetection,
              status: "idle",
            },
            filtering: {
              ...preset.steps.filtering,
              status: "idle",
            },
            rereference: {
              ...preset.steps.rereference,
              status: "idle",
            },
            ica: {
              ...preset.steps.ica,
              status: "idle",
            },
            artifactRemoval: {
              ...preset.steps.artifactRemoval,
              status: "idle",
            },
          };
        }
      }

      state.preprocessing.pipelines[pipeline.id] = pipeline;
      state.preprocessing.activePipelineId = pipeline.id;
    });

    return pipeline.id;
  },

  deletePipeline: (pipelineId) => {
    set((state) => {
      delete state.preprocessing.pipelines[pipelineId];
      if (state.preprocessing.activePipelineId === pipelineId) {
        state.preprocessing.activePipelineId = null;
      }
    });
  },

  duplicatePipeline: (pipelineId, newName) => {
    const pipeline = get().preprocessing.pipelines[pipelineId];
    if (!pipeline) return null;

    const now = new Date().toISOString();
    const newPipeline: PreprocessingPipeline = {
      ...structuredClone(pipeline),
      id: crypto.randomUUID(),
      name: newName ?? `${pipeline.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      isRunning: false,
      currentStepIndex: -1,
      totalProgress: 0,
    };

    // Reset step statuses
    Object.values(newPipeline.steps).forEach((step) => {
      step.status = "idle";
      delete step.error;
      delete step.lastRun;
      delete step.duration;
    });

    set((state) => {
      state.preprocessing.pipelines[newPipeline.id] = newPipeline;
    });

    return newPipeline.id;
  },

  setActivePipeline: (pipelineId) => {
    set((state) => {
      state.preprocessing.activePipelineId = pipelineId;
    });
  },

  renamePipeline: (pipelineId, name) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.name = name;
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  applyPreset: (pipelineId, presetId) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      const preset = [
        ...BUILT_IN_PRESETS,
        ...state.preprocessing.customPresets,
      ].find((p) => p.id === presetId);

      if (pipeline && preset) {
        pipeline.steps = {
          badChannelDetection: {
            ...preset.steps.badChannelDetection,
            status: "idle",
          },
          filtering: {
            ...preset.steps.filtering,
            status: "idle",
          },
          rereference: {
            ...preset.steps.rereference,
            status: "idle",
          },
          ica: {
            ...preset.steps.ica,
            status: "idle",
          },
          artifactRemoval: {
            ...preset.steps.artifactRemoval,
            status: "idle",
          },
        };
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  // Step enable/disable
  setStepEnabled: (pipelineId, stepType, enabled) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        const stepKey = stepTypeToKey(stepType);
        pipeline.steps[stepKey].enabled = enabled;
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  setAllStepsEnabled: (pipelineId, enabled) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        Object.values(pipeline.steps).forEach((step) => {
          step.enabled = enabled;
        });
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  // Step configuration updates
  updateBadChannelConfig: (pipelineId, config) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.steps.badChannelDetection.config = {
          ...pipeline.steps.badChannelDetection.config,
          ...config,
        };
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  updateFilteringConfig: (pipelineId, config) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.steps.filtering.config = {
          ...pipeline.steps.filtering.config,
          ...config,
        };
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  updateReferenceConfig: (pipelineId, config) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.steps.rereference.config = {
          ...pipeline.steps.rereference.config,
          ...config,
        };
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  updateICAConfig: (pipelineId, config) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.steps.ica.config = {
          ...pipeline.steps.ica.config,
          ...config,
        };
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  updateArtifactRemovalConfig: (pipelineId, config) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.steps.artifactRemoval.config = {
          ...pipeline.steps.artifactRemoval.config,
          ...config,
        };
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  // Step status updates
  setStepStatus: (pipelineId, stepType, status, error) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        const stepKey = stepTypeToKey(stepType);
        pipeline.steps[stepKey].status = status;
        if (error !== undefined) {
          pipeline.steps[stepKey].error = error;
        } else {
          delete pipeline.steps[stepKey].error;
        }
        if (status === "completed") {
          pipeline.steps[stepKey].lastRun = new Date().toISOString();
        }
      }
    });
  },

  setStepResult: (pipelineId, stepType, result) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        const stepKey = stepTypeToKey(stepType);
        (pipeline.steps[stepKey] as any).result = result;
      }
    });
  },

  // ICA-specific actions
  setICAComponents: (pipelineId, components) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline?.steps.ica.result) {
        pipeline.steps.ica.result.components = components;
      }
    });
  },

  toggleICAComponentRejection: (pipelineId, componentIndex) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        const rejected = pipeline.steps.ica.rejectedComponents;
        const idx = rejected.indexOf(componentIndex);
        if (idx >= 0) {
          rejected.splice(idx, 1);
        } else {
          rejected.push(componentIndex);
          rejected.sort((a, b) => a - b);
        }
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  setICAComponentClassification: (
    pipelineId,
    componentIndex,
    classification,
  ) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline?.steps.ica.result) {
        const component = pipeline.steps.ica.result.components[componentIndex];
        if (component) {
          component.classification = classification;
        }
      }
    });
  },

  // Bad channel manual selection
  addManualBadChannel: (pipelineId, channel) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        const manualBad =
          pipeline.steps.badChannelDetection.config.manualBadChannels;
        if (!manualBad.includes(channel)) {
          manualBad.push(channel);
        }
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  removeManualBadChannel: (pipelineId, channel) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        const manualBad =
          pipeline.steps.badChannelDetection.config.manualBadChannels;
        const idx = manualBad.indexOf(channel);
        if (idx >= 0) {
          manualBad.splice(idx, 1);
        }
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  // Pipeline execution
  setPipelineRunning: (pipelineId, running) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.isRunning = running;
        if (!running) {
          pipeline.currentStepIndex = -1;
        }
      }
    });
  },

  setPipelineProgress: (pipelineId, stepIndex, progress) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        pipeline.currentStepIndex = stepIndex;
        pipeline.totalProgress = progress;
      }
    });
  },

  resetPipelineResults: (pipelineId) => {
    set((state) => {
      const pipeline = state.preprocessing.pipelines[pipelineId];
      if (pipeline) {
        Object.values(pipeline.steps).forEach((step) => {
          step.status = "idle";
          delete step.error;
          delete step.lastRun;
          delete step.duration;
          delete (step as any).result;
        });
        pipeline.steps.ica.rejectedComponents = [];
        pipeline.totalProgress = 0;
        pipeline.currentStepIndex = -1;
        pipeline.updatedAt = new Date().toISOString();
      }
    });
  },

  // Presets
  saveAsPreset: (pipelineId, name, description) => {
    const pipeline = get().preprocessing.pipelines[pipelineId];
    if (!pipeline) return "";

    const preset: PipelinePreset = {
      id: crypto.randomUUID(),
      name,
      description: description ?? "",
      isBuiltIn: false,
      category: "custom",
      steps: {
        badChannelDetection: {
          type: "bad_channel_detection",
          enabled: pipeline.steps.badChannelDetection.enabled,
          config: structuredClone(pipeline.steps.badChannelDetection.config),
        },
        filtering: {
          type: "filtering",
          enabled: pipeline.steps.filtering.enabled,
          config: structuredClone(pipeline.steps.filtering.config),
        },
        rereference: {
          type: "rereference",
          enabled: pipeline.steps.rereference.enabled,
          config: structuredClone(pipeline.steps.rereference.config),
        },
        ica: {
          type: "ica",
          enabled: pipeline.steps.ica.enabled,
          config: structuredClone(pipeline.steps.ica.config),
          rejectedComponents: [],
        },
        artifactRemoval: {
          type: "artifact_removal",
          enabled: pipeline.steps.artifactRemoval.enabled,
          config: structuredClone(pipeline.steps.artifactRemoval.config),
        },
      },
    };

    set((state) => {
      state.preprocessing.customPresets.push(preset);
    });

    return preset.id;
  },

  deleteCustomPreset: (presetId) => {
    set((state) => {
      const idx = state.preprocessing.customPresets.findIndex(
        (p) => p.id === presetId,
      );
      if (idx >= 0) {
        state.preprocessing.customPresets.splice(idx, 1);
      }
    });
  },

  // Preview
  setPreviewMode: (enabled) => {
    set((state) => {
      state.preprocessing.previewMode = enabled;
    });
  },

  setPreviewChannel: (channel) => {
    set((state) => {
      state.preprocessing.previewChannel = channel;
    });
  },

  // Utilities
  getPipeline: (pipelineId) => {
    return get().preprocessing.pipelines[pipelineId];
  },

  getPipelineForFile: (fileId) => {
    const pipelines = Object.values(get().preprocessing.pipelines);
    return pipelines.find((p) => p.fileId === fileId);
  },

  getAllPresets: () => {
    return [...BUILT_IN_PRESETS, ...get().preprocessing.customPresets];
  },
});

// ============================================================================
// Utility Functions
// ============================================================================

type StepKey = keyof PreprocessingPipeline["steps"];

function stepTypeToKey(stepType: PipelineStepType): StepKey {
  const mapping: Record<PipelineStepType, StepKey> = {
    bad_channel_detection: "badChannelDetection",
    filtering: "filtering",
    rereference: "rereference",
    ica: "ica",
    artifact_removal: "artifactRemoval",
  };
  return mapping[stepType];
}
