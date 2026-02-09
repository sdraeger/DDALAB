import type {
  TutorialProgress,
  SampleDataStatus,
  PaperRecipe,
  SampleDataset,
} from "@/types/learn";
import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface LearnState {
  tutorialProgress: Record<string, TutorialProgress>;
  sampleDatasets: Record<string, SampleDataStatus>;
  sampleDataIndex: SampleDataset[] | null;
  recipesIndex: PaperRecipe[] | null;
  activeTutorialId: string | null;
  activeRecipeId: string | null;
}

export interface LearnActions {
  setTutorialProgress: (tutorialId: string, progress: TutorialProgress) => void;
  clearTutorialProgress: (tutorialId: string) => void;
  setSampleDataStatus: (
    datasetId: string,
    status: Partial<SampleDataStatus>,
  ) => void;
  setSampleDataIndex: (datasets: SampleDataset[]) => void;
  setRecipesIndex: (recipes: PaperRecipe[]) => void;
  setActiveTutorialId: (id: string | null) => void;
  setActiveRecipeId: (id: string | null) => void;
}

export interface LearnSlice extends LearnActions {
  learn: LearnState;
}

// ============================================================================
// Default State
// ============================================================================

export const defaultLearnState: LearnState = {
  tutorialProgress: {},
  sampleDatasets: {},
  sampleDataIndex: null,
  recipesIndex: null,
  activeTutorialId: null,
  activeRecipeId: null,
};

// ============================================================================
// Slice Creator
// ============================================================================

export const createLearnSlice: ImmerStateCreator<LearnSlice> = (set) => ({
  learn: defaultLearnState,

  setTutorialProgress: (tutorialId, progress) =>
    set((state) => {
      state.learn.tutorialProgress[tutorialId] = progress;
    }),

  clearTutorialProgress: (tutorialId) =>
    set((state) => {
      delete state.learn.tutorialProgress[tutorialId];
    }),

  setSampleDataStatus: (datasetId, status) =>
    set((state) => {
      const current = state.learn.sampleDatasets[datasetId] ?? {
        downloaded: false,
        path: null,
        downloading: false,
        progress: 0,
      };
      state.learn.sampleDatasets[datasetId] = { ...current, ...status };
    }),

  setSampleDataIndex: (datasets) =>
    set((state) => {
      state.learn.sampleDataIndex = datasets;
    }),

  setRecipesIndex: (recipes) =>
    set((state) => {
      state.learn.recipesIndex = recipes;
    }),

  setActiveTutorialId: (id) =>
    set((state) => {
      state.learn.activeTutorialId = id;
    }),

  setActiveRecipeId: (id) =>
    set((state) => {
      state.learn.activeRecipeId = id;
    }),
});
