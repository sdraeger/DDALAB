// packages/ddalab-tauri/src/types/learn.ts

// ============================================================================
// Tutorial Types
// ============================================================================

export type TutorialStepType = "narrative" | "action" | "highlight" | "auto";

export interface TutorialStep {
  id: string;
  type: TutorialStepType;
  title: string;
  content?: string;
  target?: string;
  actionDescription?: string;
  completionCheck?: {
    storeKey: string;
    expectedValue: unknown;
  };
  autoAction?: {
    type: string;
    payload?: Record<string, unknown>;
  };
}

export interface TutorialDefinition {
  id: string;
  title: string;
  description: string;
  icon: string;
  estimatedMinutes: number;
  steps: TutorialStep[];
  requiredDataset?: string;
}

export interface TutorialProgress {
  currentStep: number;
  completed: boolean;
  lastAccessedAt: number;
}

// ============================================================================
// Sample Data Types
// ============================================================================

export interface SampleDataset {
  id: string;
  name: string;
  description: string;
  format: string;
  sizeBytes: number;
  url: string;
  channels: number;
  duration: string;
  sampleRate: number;
}

export interface SampleDataIndex {
  version: string;
  datasets: SampleDataset[];
}

export interface SampleDataStatus {
  downloaded: boolean;
  path: string | null;
  downloading: boolean;
  progress: number;
}

// ============================================================================
// Paper Recipe Types
// ============================================================================

export interface PaperCitation {
  authors: string;
  title: string;
  journal: string;
  year: number;
  doi?: string;
}

export interface PaperRecipeSteps {
  channels?: string[];
  variant?: string;
  parameters?: {
    tau?: number[];
    windowLength?: number;
    overlap?: number;
  };
  referenceResults?: {
    description: string;
  };
}

export interface PaperRecipe {
  id: string;
  citation: PaperCitation;
  description: string;
  dataset: {
    source: "sample-data" | "openneuro";
    id: string;
  };
  steps: PaperRecipeSteps;
}

export interface PaperRecipeIndex {
  version: string;
  recipes: PaperRecipe[];
}
