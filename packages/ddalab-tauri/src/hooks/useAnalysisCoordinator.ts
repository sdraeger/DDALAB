"use client";

/**
 * Analysis Coordinator Hook
 *
 * Central coordinator for all DDA analysis jobs. Features:
 * - Single event listener for "dda-progress" (eliminates duplicate listeners)
 * - File-scoped job tracking (results tied to specific files)
 * - Multi-file support (switch files while analysis runs)
 * - Graceful error handling with visibility
 */

import { useEffect, useCallback } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useShallow } from "zustand/shallow";
import { useAppStore } from "@/store/appStore";
import { tauriBackendService } from "@/services/tauriBackendService";
import { TauriService, NotificationType } from "@/services/tauriService";
import { loggers } from "@/lib/logger";
import type { DDAProgressEvent, DDAAnalysisRequest } from "@/types/api";
import { mapStatusToPhase } from "@/types/api";
import type { AnalysisJob } from "@/store/slices/analysisSlice";

// Module-level flag to prevent multiple listeners across hot reloads
let globalListenerInitialized = false;

// Module-level buffer for events that arrive before job registration
// This handles the race condition where backend emits events before the invoke returns
const pendingEventBuffer = new Map<string, DDAProgressEvent[]>();

// Module-level tracking of pending analysis submissions by file path
// When startAnalysis is called, we add the filePath here; when first event arrives, we associate the ID
const pendingSubmissionsByFile = new Set<string>();

/**
 * Register that we're about to start an analysis for a file.
 * This helps associate incoming events with the correct file.
 */
export function registerPendingSubmission(filePath: string) {
  pendingSubmissionsByFile.add(filePath);
}

/**
 * Clear pending submission tracking for a file.
 */
export function clearPendingSubmission(filePath: string) {
  pendingSubmissionsByFile.delete(filePath);
}

/**
 * Buffer an event for a job that hasn't been registered yet.
 */
function bufferEvent(analysisId: string, event: DDAProgressEvent) {
  const events = pendingEventBuffer.get(analysisId) || [];
  events.push(event);
  pendingEventBuffer.set(analysisId, events);

  // Clean up old buffered events after 30 seconds to prevent memory leaks
  setTimeout(() => {
    pendingEventBuffer.delete(analysisId);
  }, 30000);
}

/**
 * Process any buffered events for a newly registered job.
 */
export function processBufferedEvents(analysisId: string) {
  const events = pendingEventBuffer.get(analysisId);
  if (!events || events.length === 0) return;

  pendingEventBuffer.delete(analysisId);

  const store = useAppStore.getState();
  const { updateJobProgress, completeJob, failJob, setDDARunning } = store;

  loggers.dda.debug("Processing buffered events", {
    analysisId,
    count: events.length,
  });

  // Process events in order
  for (const payload of events) {
    const phase = mapStatusToPhase(payload.status);

    switch (payload.status) {
      case "completed":
        // Fetch the result and complete the job
        tauriBackendService
          .getDDAResult(analysisId)
          .then((result) => {
            if (!result) {
              failJob(analysisId, "Completed but result is unavailable");
              setDDARunning(false);
              return;
            }
            completeJob(analysisId, result);
            setDDARunning(false);

            const variantCount = result.results?.variants?.length || 1;
            TauriService.createNotification(
              "DDA Analysis Complete",
              `Analysis completed with ${variantCount} variant(s)`,
              NotificationType.Success,
              "view-analysis",
              { analysisId: result.id },
            ).catch(() => {});
          })
          .catch(() => {
            failJob(analysisId, "Completed but failed to fetch result");
            setDDARunning(false);
          });
        break;

      case "error":
        failJob(analysisId, payload.message || "Analysis failed");
        setDDARunning(false);
        break;

      default:
        updateJobProgress(analysisId, {
          progress: payload.progress,
          currentStep: payload.message,
          phase,
        });
        break;
    }
  }
}

/**
 * Hook to initialize the global analysis event listener.
 * Should be called once at app root level (e.g., in DashboardLayout).
 *
 * This replaces all the scattered "dda-progress" listeners throughout the app.
 */
export function useAnalysisEventListener() {
  useEffect(
    () => {
      // Only initialize once globally (survives hot reload)
      if (globalListenerInitialized) {
        return;
      }

      // Check if we're in a Tauri environment
      if (typeof window === "undefined" || !("__TAURI__" in window)) {
        return;
      }

      let unlistenRef: UnlistenFn | null = null;
      let isMounted = true;

      const setupListener = async () => {
        try {
          const unlistenFn = await listen<DDAProgressEvent>(
            "dda-progress",
            (event) => {
              // Guard against events after unmount
              if (!isMounted) return;

              // Get latest store actions - this ensures we always use current state
              const store = useAppStore.getState();
              const {
                getJobById,
                updateJobProgress,
                completeJob,
                failJob,
                setDDARunning,
              } = store;

              const { payload } = event;
              // Backend uses camelCase: analysisId, status, progress, message
              const job = getJobById(payload.analysisId);
              const phase = mapStatusToPhase(payload.status);

              // Log progress for debugging
              loggers.dda.debug("Progress event received", {
                analysisId: payload.analysisId,
                status: payload.status,
                phase,
                progress: payload.progress,
                hasJob: !!job,
              });

              // If no job registered for this ID, buffer the event
              // This handles the race condition where events arrive before job registration
              if (!job) {
                loggers.dda.debug("Buffering event for pending job", {
                  analysisId: payload.analysisId,
                  status: payload.status,
                });
                bufferEvent(payload.analysisId, payload);
                return;
              }

              // Route based on status (mapped to phase)
              switch (payload.status) {
                case "completed":
                  // The result comes with the completion event
                  // But we also need to fetch the full result from backend
                  // since the event may not contain all data
                  tauriBackendService
                    .getDDAResult(payload.analysisId)
                    .then((result) => {
                      if (!isMounted) return;
                      if (!result) {
                        loggers.dda.error("Completed result is null");
                        failJob(
                          payload.analysisId,
                          "Completed but result is unavailable",
                        );
                        setDDARunning(false);
                        return;
                      }

                      completeJob(payload.analysisId, result);
                      setDDARunning(false);

                      // Send native notification
                      const variantCount =
                        result.results?.variants?.length || 1;
                      TauriService.createNotification(
                        "DDA Analysis Complete",
                        `Analysis completed with ${variantCount} variant(s)`,
                        NotificationType.Success,
                        "view-analysis",
                        { analysisId: result.id },
                      ).catch((err) => {
                        loggers.dda.error("Failed to create notification", {
                          err,
                        });
                      });
                    })
                    .catch((err) => {
                      if (!isMounted) return;
                      loggers.dda.error("Failed to fetch completed result", {
                        err,
                      });
                      // Mark as completed anyway with what we have
                      failJob(
                        payload.analysisId,
                        "Completed but failed to fetch result",
                      );
                      setDDARunning(false);
                    });
                  break;

                case "error":
                  failJob(
                    payload.analysisId,
                    payload.message || "Analysis failed",
                  );
                  setDDARunning(false);

                  // Send error notification
                  TauriService.createNotification(
                    "DDA Analysis Failed",
                    payload.message || "Analysis failed. Please try again.",
                    NotificationType.Error,
                  ).catch((err) => {
                    loggers.dda.error("Failed to create error notification", {
                      err,
                    });
                  });
                  break;

                default:
                  // Update progress for running states
                  updateJobProgress(payload.analysisId, {
                    progress: payload.progress,
                    currentStep: payload.message,
                    phase,
                  });
                  break;
              }
            },
          );

          if (isMounted) {
            unlistenRef = unlistenFn;
            globalListenerInitialized = true;
            loggers.dda.info("Analysis coordinator event listener initialized");
          } else {
            // Component unmounted during setup - clean up immediately
            try {
              unlistenFn();
            } catch {
              // Ignore cleanup errors during race condition
            }
          }
        } catch (error) {
          loggers.dda.error("Failed to setup analysis event listener", {
            error,
          });
        }
      };

      setupListener();

      // NOTE: We intentionally do NOT cleanup the listener on unmount.
      // The listener should survive across hot reloads and re-renders.
      // It will be cleaned up when the page fully reloads.
      // The module-level flag prevents re-initialization.
      return () => {
        isMounted = false;
        // Don't cleanup - let the listener survive hot reloads
      };
    },
    [
      // Empty dependency array - only run once on mount
      // We use module-level flag to prevent re-initialization
    ],
  );
}

/**
 * Hook to access the analysis coordinator state and actions.
 * Use this for global analysis state (all jobs, running status, etc.)
 */
export function useAnalysisCoordinator() {
  // Only subscribe to job IDs/statuses we care about — not entire job objects
  const runningJobs = useAppStore(
    useShallow((state) => {
      const running: AnalysisJob[] = [];
      for (const job of Object.values(state.analysis.jobs)) {
        if (job.status === "running" || job.status === "pending") {
          running.push(job);
        }
      }
      return running;
    }),
  );
  const allJobs = useAppStore(
    useShallow((state) => Object.values(state.analysis.jobs)),
  );
  const queuePreference = useAppStore(
    (state) => state.analysis.queuePreference,
  );
  const interruptedAnalyses = useAppStore(
    useShallow((state) => state.analysis.interruptedAnalyses),
  );

  const registerJob = useAppStore((state) => state.registerJob);
  const removeJob = useAppStore((state) => state.removeJob);
  const cancelJob = useAppStore((state) => state.cancelJob);
  const setQueuePreference = useAppStore((state) => state.setQueuePreference);
  const addInterruptedAnalysis = useAppStore(
    (state) => state.addInterruptedAnalysis,
  );
  const removeInterruptedAnalysis = useAppStore(
    (state) => state.removeInterruptedAnalysis,
  );
  const clearInterruptedAnalyses = useAppStore(
    (state) => state.clearInterruptedAnalyses,
  );
  const setDDARunning = useAppStore((state) => state.setDDARunning);
  const setSubmittingForFile = useAppStore(
    (state) => state.setSubmittingForFile,
  );

  const isRunning = runningJobs.length > 0;

  const startAnalysis = useCallback(
    async (
      filePath: string,
      request: DDAAnalysisRequest,
      channelNames: string[],
    ): Promise<{ success: boolean; analysisId?: string; error?: string }> => {
      try {
        loggers.dda.info("Starting analysis via coordinator", {
          filePath,
          variants: request.variants,
        });

        // Set submitting state IMMEDIATELY for UI feedback before async invoke
        setSubmittingForFile(filePath);
        setDDARunning(true);
        registerPendingSubmission(filePath);

        const result = await tauriBackendService.submitDDAAnalysis(request);

        clearPendingSubmission(filePath);

        registerJob({
          id: result.id,
          filePath,
          status: "running",
          progress: 0,
          currentStep: "Starting analysis...",
          phase: "initializing",
        });

        // Clear submitting state now that job is registered
        setSubmittingForFile(null);

        loggers.dda.info("Analysis registered", {
          analysisId: result.id,
          filePath,
        });

        processBufferedEvents(result.id);

        return { success: true, analysisId: result.id };
      } catch (error) {
        clearPendingSubmission(filePath);
        setSubmittingForFile(null);
        setDDARunning(false);
        const errorMessage =
          error instanceof Error ? error.message : "Failed to start analysis";
        loggers.dda.error("Failed to start analysis", { error });
        return { success: false, error: errorMessage };
      }
    },
    [registerJob, setDDARunning, setSubmittingForFile],
  );

  const cancelAnalysis = useCallback(
    async (analysisId: string): Promise<boolean> => {
      try {
        const result = await tauriBackendService.cancelDDA();
        if (result.success) {
          cancelJob(analysisId);
          loggers.dda.info("Analysis cancelled via coordinator", {
            analysisId,
          });
          return true;
        }
        return false;
      } catch (error) {
        loggers.dda.error("Failed to cancel analysis", { error });
        return false;
      }
    },
    [cancelJob],
  );

  return {
    // State
    allJobs,
    isRunning,
    runningJobs,
    queuePreference,
    interruptedAnalyses,

    // Actions
    startAnalysis,
    cancelAnalysis,
    removeJob,
    setQueuePreference,
    addInterruptedAnalysis,
    removeInterruptedAnalysis,
    clearInterruptedAnalyses,
  };
}

/**
 * Hook to access analysis state for a specific file.
 * Use this in components that display analysis for a particular file.
 *
 * @param filePath - The file path to get analysis state for
 */
export function useAnalysisForFile(filePath: string | undefined) {
  const registerJob = useAppStore((state) => state.registerJob);
  const cancelJob = useAppStore((state) => state.cancelJob);
  const removeJob = useAppStore((state) => state.removeJob);
  const setDDARunning = useAppStore((state) => state.setDDARunning);
  const setSubmittingForFile = useAppStore(
    (state) => state.setSubmittingForFile,
  );

  // Single targeted selector: only re-renders when THIS file's job changes
  const job = useAppStore((state): AnalysisJob | undefined => {
    if (!filePath) return undefined;
    const jobId = state.analysis.fileToJob[filePath];
    return jobId ? state.analysis.jobs[jobId] : undefined;
  });

  // Check if this file is currently submitting (before job ID is known)
  const isSubmitting = useAppStore(
    (state) => state.analysis.submittingForFile === filePath,
  );

  // Derived convenience values - include isSubmitting for immediate UI feedback
  const isRunning =
    job?.status === "running" || job?.status === "pending" || isSubmitting;
  const isCompleted = job?.status === "completed";
  const hasError = job?.status === "error";
  const progress = job?.progress ?? 0;
  // Show "Starting analysis..." during submission phase before job is registered
  const currentStep =
    job?.currentStep ?? (isSubmitting ? "Starting analysis..." : "");
  const result = job?.result;
  const error = job?.error;

  /**
   * Start analysis for this file.
   */
  const startAnalysis = useCallback(
    async (
      request: DDAAnalysisRequest,
      channelNames: string[],
    ): Promise<{ success: boolean; analysisId?: string; error?: string }> => {
      if (!filePath) {
        return { success: false, error: "No file selected" };
      }

      try {
        // Set submitting state IMMEDIATELY for UI feedback before async invoke
        setSubmittingForFile(filePath);
        setDDARunning(true);

        // Track pending submission so events can be buffered
        registerPendingSubmission(filePath);

        const ddaResult = await tauriBackendService.submitDDAAnalysis(request);

        clearPendingSubmission(filePath);

        registerJob({
          id: ddaResult.id,
          filePath,
          status: "running",
          progress: 0,
          currentStep: "Starting analysis...",
          phase: "initializing",
        });

        // Clear submitting state now that job is registered
        setSubmittingForFile(null);

        // Process any buffered events that arrived during the invoke
        processBufferedEvents(ddaResult.id);

        return { success: true, analysisId: ddaResult.id };
      } catch (err) {
        if (filePath) clearPendingSubmission(filePath);
        setSubmittingForFile(null);
        setDDARunning(false);
        const errorMessage =
          err instanceof Error ? err.message : "Failed to start analysis";
        return { success: false, error: errorMessage };
      }
    },
    [filePath, registerJob, setDDARunning, setSubmittingForFile],
  );

  /**
   * Cancel the current analysis for this file.
   */
  const cancel = useCallback(async (): Promise<boolean> => {
    if (!job) return false;
    try {
      const result = await tauriBackendService.cancelDDA();
      if (result.success) {
        cancelJob(job.id);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [job, cancelJob]);

  /**
   * Clear/dismiss the job (remove from tracking).
   */
  const dismiss = useCallback(() => {
    if (job) {
      removeJob(job.id);
    }
  }, [job, removeJob]);

  return {
    // Current job state
    job,

    // Convenience flags
    isRunning,
    isCompleted,
    hasError,

    // Progress info
    progress,
    currentStep,

    // Results
    result,
    error,

    // Actions
    startAnalysis,
    cancel,
    dismiss,
  };
}

/**
 * Hook to check if a specific file has a running analysis.
 * Lightweight version for use in tab indicators, etc.
 *
 * @param filePath - The file path to check
 */
export function useFileHasRunningAnalysis(
  filePath: string | undefined,
): boolean {
  return useAppStore((state) => {
    if (!filePath) return false;
    const jobId = state.analysis.fileToJob[filePath];
    if (!jobId) return false;
    const job = state.analysis.jobs[jobId];
    return job?.status === "running" || job?.status === "pending";
  });
}

/**
 * Hook to check if a specific file has completed (unseen) results.
 * Useful for showing badges on tabs.
 *
 * @param filePath - The file path to check
 */
export function useFileHasCompletedAnalysis(
  filePath: string | undefined,
): boolean {
  return useAppStore((state) => {
    if (!filePath) return false;
    const jobId = state.analysis.fileToJob[filePath];
    if (!jobId) return false;
    const job = state.analysis.jobs[jobId];
    return job?.status === "completed";
  });
}
