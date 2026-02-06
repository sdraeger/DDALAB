/**
 * Analysis Coordinator Slice
 *
 * Central coordinator for all DDA analysis jobs. Provides:
 * - Single source of truth for analysis state
 * - File-scoped job tracking (results tied to specific files)
 * - Multi-file support (switch files while analysis runs)
 * - Single event listener (eliminates duplicate listeners)
 */

import type { DDAResult, DDAProgressPhase } from "@/types/api";
import type { ImmerStateCreator } from "./types";

// ============================================================================
// Types
// ============================================================================

export type AnalysisJobStatus = "pending" | "running" | "completed" | "error";

/**
 * Represents a single analysis job with its full lifecycle state
 */
export interface AnalysisJob {
  /** Unique analysis ID (from backend) */
  id: string;
  /** File path this analysis is for */
  filePath: string;
  /** Current job status */
  status: AnalysisJobStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current step description (e.g., "Computing eigenvalues...") */
  currentStep: string;
  /** Current phase from backend */
  phase: DDAProgressPhase;
  /** Timestamp when job was started */
  startedAt: number;
  /** Timestamp when job completed (if finished) */
  completedAt?: number;
  /** Analysis result (when completed) */
  result?: DDAResult;
  /** Error message (if failed) */
  error?: string;
  /** Estimated time remaining in seconds (from backend) */
  estimatedTimeRemaining?: number;
}

/**
 * Parallel/sequential analysis preference
 */
export type AnalysisQueuePreference = "parallel" | "sequential" | "ask";

/**
 * Interrupted analysis info (for restart functionality)
 */
export interface InterruptedAnalysis {
  filePath: string;
  fileName: string;
  progressAtInterrupt: number;
  interruptedAt: number;
  parameters: {
    variants: string[];
    windowLength: number;
    windowStep: number;
    delays: number[];
    channels: string[];
    startTime: number;
    endTime: number;
  };
}

export interface AnalysisState {
  /** Active jobs keyed by analysisId */
  jobs: Record<string, AnalysisJob>;
  /** Quick lookup: which job is running for a file? (filePath → analysisId) */
  fileToJob: Record<string, string>;
  /** Count of jobs with status "running" or "pending" for O(1) hasRunningJobs checks */
  runningJobCount: number;
  /** User preference for parallel vs sequential execution */
  queuePreference: AnalysisQueuePreference;
  /** Analyses that were interrupted (e.g., by app restart) */
  interruptedAnalyses: InterruptedAnalysis[];
  /** Whether the coordinator's event listener is initialized */
  isListenerInitialized: boolean;
  /** File path that's currently submitting (before job ID is known) */
  submittingForFile: string | null;
}

export interface AnalysisActions {
  /** Register a new job when analysis starts */
  registerJob: (job: Omit<AnalysisJob, "startedAt">) => void;
  /** Update job progress from event */
  updateJobProgress: (
    analysisId: string,
    updates: {
      progress?: number;
      currentStep?: string;
      phase?: DDAProgressPhase;
      estimatedTimeRemaining?: number;
    },
  ) => void;
  /** Mark job as completed with result */
  completeJob: (analysisId: string, result: DDAResult) => void;
  /** Mark job as failed with error */
  failJob: (analysisId: string, error: string) => void;
  /** Remove a job (e.g., after user dismisses it) */
  removeJob: (analysisId: string) => void;
  /** Get job for a specific file */
  getJobForFile: (filePath: string) => AnalysisJob | undefined;
  /** Get job by ID */
  getJobById: (analysisId: string) => AnalysisJob | undefined;
  /** Check if any job is running */
  hasRunningJobs: () => boolean;
  /** Get all running jobs */
  getRunningJobs: () => AnalysisJob[];
  /** Set queue preference */
  setQueuePreference: (preference: AnalysisQueuePreference) => void;
  /** Add interrupted analysis for potential restart */
  addInterruptedAnalysis: (analysis: InterruptedAnalysis) => void;
  /** Remove interrupted analysis (after restart or dismiss) */
  removeInterruptedAnalysis: (filePath: string) => void;
  /** Clear all interrupted analyses */
  clearInterruptedAnalyses: () => void;
  /** Mark listener as initialized */
  setListenerInitialized: (initialized: boolean) => void;
  /** Cancel a running job (sets status to error with cancellation message) */
  cancelJob: (analysisId: string) => void;
  /** Set the file that's currently submitting (before job ID is known) */
  setSubmittingForFile: (filePath: string | null) => void;
}

export interface AnalysisSlice extends AnalysisActions {
  analysis: AnalysisState;
}

// ============================================================================
// Default State
// ============================================================================

export const defaultAnalysisState: AnalysisState = {
  jobs: {},
  fileToJob: {},
  runningJobCount: 0,
  queuePreference: "ask",
  interruptedAnalyses: [],
  isListenerInitialized: false,
  submittingForFile: null,
};

// ============================================================================
// Slice Implementation
// ============================================================================

export const createAnalysisSlice: ImmerStateCreator<AnalysisSlice> = (
  set,
  get,
) => ({
  analysis: defaultAnalysisState,

  registerJob: (job) => {
    const fullJob: AnalysisJob = {
      ...job,
      startedAt: Date.now(),
    };

    set((state) => {
      // Store job by ID
      state.analysis.jobs[job.id] = fullJob;
      // Map file to job for quick lookup
      state.analysis.fileToJob[job.filePath] = job.id;
      // Increment running count if job is running or pending
      if (job.status === "running" || job.status === "pending") {
        state.analysis.runningJobCount++;
      }
    });
  },

  updateJobProgress: (analysisId, updates) => {
    set((state) => {
      const job = state.analysis.jobs[analysisId];
      if (job) {
        if (updates.progress !== undefined) {
          job.progress = updates.progress;
        }
        if (updates.currentStep !== undefined) {
          job.currentStep = updates.currentStep;
        }
        if (updates.phase !== undefined) {
          job.phase = updates.phase;
        }
        if (updates.estimatedTimeRemaining !== undefined) {
          job.estimatedTimeRemaining = updates.estimatedTimeRemaining;
        }
      }
    });
  },

  completeJob: (analysisId, result) => {
    set((state) => {
      const job = state.analysis.jobs[analysisId];
      if (job) {
        // Decrement running count if job was running or pending
        if (job.status === "running" || job.status === "pending") {
          state.analysis.runningJobCount--;
        }
        job.status = "completed";
        job.progress = 100;
        job.phase = "completed";
        job.completedAt = Date.now();
        job.result = Object.freeze(result);
        job.currentStep = "Analysis complete";
      }
    });
  },

  failJob: (analysisId, error) => {
    set((state) => {
      const job = state.analysis.jobs[analysisId];
      if (job) {
        // Decrement running count if job was running or pending
        if (job.status === "running" || job.status === "pending") {
          state.analysis.runningJobCount--;
        }
        job.status = "error";
        job.phase = "error" as DDAProgressPhase;
        job.completedAt = Date.now();
        job.error = error;
        job.currentStep = "Analysis failed";
      }
    });
  },

  removeJob: (analysisId) => {
    set((state) => {
      const job = state.analysis.jobs[analysisId];
      if (job) {
        // Decrement running count if job was running or pending
        if (job.status === "running" || job.status === "pending") {
          state.analysis.runningJobCount--;
        }
        // Remove from fileToJob mapping
        delete state.analysis.fileToJob[job.filePath];
        // Remove job
        delete state.analysis.jobs[analysisId];
      }
    });
  },

  getJobForFile: (filePath) => {
    const { analysis } = get();
    const jobId = analysis.fileToJob[filePath];
    return jobId ? analysis.jobs[jobId] : undefined;
  },

  getJobById: (analysisId) => {
    return get().analysis.jobs[analysisId];
  },

  hasRunningJobs: () => {
    const { analysis } = get();
    return analysis.runningJobCount > 0;
  },

  getRunningJobs: () => {
    const { analysis } = get();
    return Object.values(analysis.jobs).filter(
      (job) => job.status === "running" || job.status === "pending",
    );
  },

  setQueuePreference: (preference) => {
    set((state) => {
      state.analysis.queuePreference = preference;
    });
  },

  addInterruptedAnalysis: (analysis) => {
    set((state) => {
      // Avoid duplicates - replace if same file
      const existing = state.analysis.interruptedAnalyses.findIndex(
        (a) => a.filePath === analysis.filePath,
      );
      if (existing >= 0) {
        state.analysis.interruptedAnalyses[existing] = analysis;
      } else {
        state.analysis.interruptedAnalyses.push(analysis);
      }
    });
  },

  removeInterruptedAnalysis: (filePath) => {
    set((state) => {
      state.analysis.interruptedAnalyses =
        state.analysis.interruptedAnalyses.filter(
          (a) => a.filePath !== filePath,
        );
    });
  },

  clearInterruptedAnalyses: () => {
    set((state) => {
      state.analysis.interruptedAnalyses = [];
    });
  },

  setListenerInitialized: (initialized) => {
    set((state) => {
      state.analysis.isListenerInitialized = initialized;
    });
  },

  cancelJob: (analysisId) => {
    set((state) => {
      const job = state.analysis.jobs[analysisId];
      if (job && (job.status === "running" || job.status === "pending")) {
        // Decrement running count since job was running or pending
        state.analysis.runningJobCount--;
        job.status = "error";
        job.completedAt = Date.now();
        job.error = "Analysis cancelled by user";
        job.currentStep = "Cancelled";
      }
    });
  },

  setSubmittingForFile: (filePath) => {
    set((state) => {
      state.analysis.submittingForFile = filePath;
    });
  },
});
