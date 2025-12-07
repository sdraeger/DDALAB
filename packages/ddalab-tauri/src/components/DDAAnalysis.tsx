"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { flushSync } from "react-dom";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import {
  useDDASelectors,
  useUISelectors,
  useWorkflowSelectors,
} from "@/hooks/useStoreSelectors";
import { ApiService } from "@/services/apiService";
import { DDAAnalysisRequest, DDAResult } from "@/types/api";
import { useWorkflow } from "@/hooks/useWorkflow";
import {
  createSetDDAParametersAction,
  createRunDDAAnalysisAction,
} from "@/types/workflow";
import {
  useSubmitDDAAnalysis,
  useDDAProgress,
  useSaveDDAToHistory,
  useDDAHistory,
  useDeleteAnalysis,
  useRenameAnalysis,
} from "@/hooks/useDDAAnalysis";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Brain, CheckCircle, Cloud, Server } from "lucide-react";
import { TauriService, NotificationType } from "@/services/tauriService";
import { loggers } from "@/lib/logger";
import { WindowSizeSelector } from "@/components/dda/WindowSizeSelector";
import { DelayPresetManager } from "@/components/dda/DelayPresetManager";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { CompactChannelConfigGroup } from "@/components/dda/CompactChannelConfig";
import { ModelBuilder } from "@/components/dda/ModelBuilder";
import {
  exportDDAConfig,
  serializeDDAConfig,
  importDDAConfig,
  configToLocalParameters,
  generateExportFilename,
} from "@/utils/ddaConfigExport";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";
import { SensitivityAnalysisDialog } from "@/components/analysis/SensitivityAnalysisDialog";
import { toast } from "@/components/ui/toaster";
import { useSync } from "@/hooks/useSync";
import { AnalysisToolbar } from "@/components/dda/AnalysisToolbar";
import { AnalysisProgressOverlay } from "@/components/dda/AnalysisProgressOverlay";
import { AnalysisStatusCard } from "@/components/dda/AnalysisStatusCard";
import {
  VariantSelector,
  DDA_VARIANTS,
} from "@/components/dda/VariantSelector";

interface DDAAnalysisProps {
  apiService: ApiService;
}

interface DDAParameters {
  variants: string[];
  windowLength: number;
  windowStep: number;
  // Delay configuration - explicit list of delays
  delays: number[];
  timeStart: number;
  timeEnd: number;
  selectedChannels: string[];
  preprocessing: {
    highpass?: number;
    lowpass?: number;
    notch?: number[];
  };
  // CT-specific parameters
  ctWindowLength?: number;
  ctWindowStep?: number;
  ctChannelPairs: [string, string][]; // Pairs of channel names
  // CD-specific parameters
  cdChannelPairs: [string, string][]; // Directed pairs of channel names (from -> to)
  // Per-variant channel configurations (NEW - scalable approach)
  variantChannelConfigs: {
    [variantId: string]: {
      selectedChannels?: string[];
      ctChannelPairs?: [string, string][];
      cdChannelPairs?: [string, string][];
    };
  };
  // Parallelization
  parallelCores?: number; // Number of CPU cores to use (1 = serial, >1 = parallel)
  // NSG-specific resource configuration
  nsgResourceConfig?: {
    runtimeHours?: number; // Max runtime in hours
    cores?: number; // Number of CPU cores
    nodes?: number; // Number of compute nodes
  };
  // Expert mode parameters
  expertMode: boolean;
  modelParameters?: {
    dm: number; // Embedding dimension (default: 4)
    order: number; // Polynomial order (default: 4)
    nr_tau: number; // Number of tau values (default: 2)
    encoding?: number[]; // Selected polynomial terms (e.g., [1, 2, 10] for EEG)
  };
}

export const DDAAnalysis = memo(function DDAAnalysis({
  apiService,
}: DDAAnalysisProps) {
  // File manager state (keep separate for derived value optimization)
  const selectedFile = useAppStore(
    useShallow((state) => state.fileManager.selectedFile),
  );

  // Consolidated DDA selectors
  const {
    currentAnalysis,
    analysisParameters: storedAnalysisParameters,
    isRunning: ddaRunning,
    setCurrentAnalysis,
    addAnalysisToHistory,
    updateAnalysisParameters,
    setDDARunning,
  } = useDDASelectors();

  // Consolidated UI selectors
  const { isServerReady, expertMode: appExpertMode } = useUISelectors();

  // Consolidated workflow selectors
  const { isRecording: isWorkflowRecording, incrementActionCount } =
    useWorkflowSelectors();

  const { recordAction } = useWorkflow();

  // TanStack Query: Submit DDA analysis mutation
  const submitAnalysisMutation = useSubmitDDAAnalysis(apiService);
  const saveToHistoryMutation = useSaveDDAToHistory(apiService);

  // TanStack Query: Fetch analysis history (only when server is ready and authenticated)
  const {
    data: historyData,
    isLoading: historyLoading,
    error: historyErrorObj,
    refetch: refetchHistory,
  } = useDDAHistory(
    apiService,
    isServerReady && !!apiService.getSessionToken(),
  );

  // TanStack Query: Delete and rename mutations with optimistic updates
  const deleteAnalysisMutation = useDeleteAnalysis(apiService);
  const renameAnalysisMutation = useRenameAnalysis(apiService);

  // Track progress from Tauri events for the current analysis
  const progressEvent = useDDAProgress(
    submitAnalysisMutation.data?.id,
    submitAnalysisMutation.isPending,
  );

  // Store ALL parameters locally for instant UI updates - only sync to store when running analysis
  const [localParameters, setLocalParameters] = useState<DDAParameters>({
    variants: storedAnalysisParameters.variants,
    windowLength: storedAnalysisParameters.windowLength,
    windowStep: storedAnalysisParameters.windowStep,
    delays: storedAnalysisParameters.delays || [7, 10], // Default delays if not set
    timeStart: 0,
    timeEnd: selectedFile?.duration || 30,
    selectedChannels: [],
    preprocessing: {
      highpass: 0.5,
      lowpass: 70,
      notch: [50],
    },
    ctWindowLength: undefined,
    ctWindowStep: undefined,
    ctChannelPairs: [],
    cdChannelPairs: [],
    variantChannelConfigs: {}, // Initialize empty per-variant configs
    parallelCores: 1, // Default to serial execution
    nsgResourceConfig: {
      runtimeHours: 1.0,
      cores: 4, // Default to 4 cores for NSG
      nodes: 1,
    },
    expertMode: false, // Deprecated - now controlled by app-level setting
    modelParameters: {
      dm: 4,
      order: 4,
      nr_tau: 2,
      encoding: [1, 2, 10], // EEG Standard preset as default
    },
  });

  // Use local parameters directly - no need to merge with store
  const parameters = localParameters;

  const [localIsRunning, setLocalIsRunning] = useState(false); // Local UI state for this component
  const [results, setResults] = useState<DDAResult | null>(null);
  const [analysisName, setAnalysisName] = useState("");
  const [isCancelling, setIsCancelling] = useState(false); // Track cancellation in progress
  const analysisStartTimeRef = useRef<number | null>(null); // Track when analysis started
  const minProgressDisplayTimeRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Derive state from mutation and progress events
  // Use localIsRunning as the primary indicator since it's set synchronously
  const progress =
    progressEvent?.progress_percent ||
    (localIsRunning || submitAnalysisMutation.isPending ? 50 : 0);
  const analysisStatus =
    progressEvent?.current_step ||
    (submitAnalysisMutation.isPending
      ? "Running DDA analysis..."
      : submitAnalysisMutation.isSuccess
        ? "Analysis completed successfully!"
        : "");
  const error = submitAnalysisMutation.error
    ? (submitAnalysisMutation.error as Error).message
    : null;
  const [previewingAnalysis, setPreviewingAnalysis] =
    useState<DDAResult | null>(null);
  const [saveStatus, setSaveStatus] = useState<{
    type: "success" | "error" | null;
    message: string;
  }>({ type: null, message: "" });
  const [channelValidationError, setChannelValidationError] = useState<
    string | null
  >(null);
  const [autoLoadingResults, setAutoLoadingResults] = useState(false);
  const [resultsFromPersistence, setResultsFromPersistence] = useState(false);
  const [renamingAnalysisId, setRenamingAnalysisId] = useState<string | null>(
    null,
  );
  const [newAnalysisName, setNewAnalysisName] = useState("");

  // Register searchable items for this component
  useSearchableItems(
    [
      createActionItem(
        "dda-run-analysis",
        "Run DDA Analysis",
        () => {
          // Focus on run button or trigger analysis
          document.getElementById("dda-run-button")?.focus();
        },
        {
          description: `Run Delay Differential Analysis${selectedFile ? ` on ${selectedFile.file_name}` : ""}`,
          keywords: [
            "run",
            "dda",
            "analysis",
            "delay",
            "differential",
            "start",
            "execute",
          ],
          category: "DDA Analysis",
        },
      ),
      ...(currentAnalysis
        ? [
            createActionItem(
              `dda-result-${currentAnalysis.id}`,
              `DDA Result: ${currentAnalysis.created_at}`,
              () => {
                // Current analysis is already displayed
              },
              {
                description: `View current DDA analysis result`,
                keywords: ["result", "dda", "current", "analysis"],
                category: "DDA Results",
              },
            ),
          ]
        : []),
    ],
    [selectedFile?.file_path, currentAnalysis?.id],
  );

  // NSG submission state
  const [hasNsgCredentials, setHasNsgCredentials] = useState(false);
  const [isSubmittingToNsg, setIsSubmittingToNsg] = useState(false);
  const [nsgError, setNsgError] = useState<string | null>(null);
  const [nsgSubmissionPhase, setNsgSubmissionPhase] = useState<string>("");

  // Server submission state
  const { isConnected: isServerConnected } = useSync();
  const [isSubmittingToServer, setIsSubmittingToServer] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSubmissionPhase, setServerSubmissionPhase] =
    useState<string>("");

  // Import/Export state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importValidation, setImportValidation] = useState<{
    warnings: string[];
    errors: string[];
  } | null>(null);

  // Sensitivity analysis state
  const [showSensitivityDialog, setShowSensitivityDialog] = useState(false);

  // Reset confirmation state
  const [showResetConfirmDialog, setShowResetConfirmDialog] = useState(false);

  // Derive history state from TanStack Query
  const historyError = historyErrorObj
    ? (historyErrorObj as Error).message
    : null;
  const analysisHistoryFromQuery = historyData || [];

  // Calculate estimated time using useMemo to avoid re-running on every render
  const estimatedTime = useMemo(() => {
    // Count total unique channels from variant configs
    const allChannels = new Set<string>();
    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];
      if (config) {
        if (config.selectedChannels) {
          config.selectedChannels.forEach((ch) => allChannels.add(ch));
        }
        if (config.ctChannelPairs) {
          config.ctChannelPairs.forEach(([ch1, ch2]) => {
            allChannels.add(ch1);
            allChannels.add(ch2);
          });
        }
        if (config.cdChannelPairs) {
          config.cdChannelPairs.forEach(([from, to]) => {
            allChannels.add(from);
            allChannels.add(to);
          });
        }
      }
    });

    const channelCount = allChannels.size;
    const timeRange = parameters.timeEnd - parameters.timeStart;
    const windowCount = Math.floor(timeRange / parameters.windowStep);
    const variantCount = parameters.variants.length;

    // Rough estimate: base time + channels * windows * variants * delay points
    const baseTime = 2; // seconds
    const perOperationTime = 0.01; // seconds per operation
    const totalOperations =
      channelCount * windowCount * variantCount * parameters.delays.length;
    const estimated = baseTime + totalOperations * perOperationTime;

    return Math.round(estimated);
  }, [
    parameters.variantChannelConfigs,
    parameters.timeEnd,
    parameters.timeStart,
    parameters.windowStep,
    parameters.variants,
    parameters.delays.length,
  ]);

  // Preview analysis from history in dedicated window
  const previewAnalysis = useCallback(
    async (analysis: DDAResult) => {
      try {
        // Validate analysis object
        if (!analysis || !analysis.id) {
          loggers.dda.error("Invalid analysis object", { analysis });
          return;
        }

        loggers.dda.debug("Preview analysis - Using ID for lookup", {
          id: analysis.id,
        });

        // Get full analysis data from history (in case the list only has metadata)
        const fullAnalysis = await apiService.getAnalysisFromHistory(
          analysis.id,
        );
        if (fullAnalysis) {
          // Import TauriService dynamically to avoid SSR issues
          const { TauriService } = await import("@/services/tauriService");
          const tauriService = TauriService.getInstance();

          // Open analysis preview in dedicated window
          await tauriService.openAnalysisPreviewWindow(fullAnalysis);

          // Still set the previewing analysis for the blue notification
          setPreviewingAnalysis(fullAnalysis);
        } else {
          loggers.dda.warn("No analysis data returned for ID", {
            id: analysis.id,
          });
        }
      } catch (error) {
        loggers.dda.error("Failed to load analysis preview", { error });
      }
    },
    [apiService],
  );

  // Delete analysis from history with optimistic update
  const handleDeleteAnalysis = useCallback(
    async (analysisId: string, event: React.MouseEvent) => {
      event.stopPropagation(); // Prevent triggering preview

      try {
        // Use Tauri dialog API instead of browser confirm
        const { ask } = await import("@tauri-apps/plugin-dialog");
        const confirmed = await ask(
          "Are you sure you want to delete this analysis from history?",
          {
            title: "Delete Analysis",
            kind: "warning",
          },
        );

        if (!confirmed) {
          return;
        }

        // Clear preview if deleting the currently previewed analysis
        if (previewingAnalysis?.id === analysisId) {
          setPreviewingAnalysis(null);
        }

        // Use mutation with optimistic update - UI updates immediately
        deleteAnalysisMutation.mutate(analysisId, {
          onError: async (error) => {
            loggers.dda.error("Error deleting analysis", { error });
            const { message } = await import("@tauri-apps/plugin-dialog");
            await message(
              (error as Error).message || "Failed to delete analysis",
              {
                title: "Delete Failed",
                kind: "error",
              },
            );
          },
        });
      } catch (error) {
        loggers.dda.error("Error in delete handler", { error });
      }
    },
    [deleteAnalysisMutation, previewingAnalysis],
  );

  // Start renaming an analysis
  const handleStartRename = useCallback(
    (analysis: DDAResult, event: React.MouseEvent) => {
      event.stopPropagation(); // Prevent triggering preview
      setRenamingAnalysisId(analysis.id);
      setNewAnalysisName(analysis.name || "");
    },
    [],
  );

  // Submit rename with optimistic update
  const handleSubmitRename = useCallback(
    async (analysisId: string, event?: React.MouseEvent) => {
      if (event) event.stopPropagation();

      // Validate and sanitize the input
      const trimmedName = newAnalysisName.trim();

      if (!trimmedName) {
        setRenamingAnalysisId(null);
        return;
      }

      // Validation: max length 200 characters
      if (trimmedName.length > 200) {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message("Analysis name must be 200 characters or less", {
          title: "Invalid Name",
          kind: "error",
        });
        return;
      }

      // Sanitize: remove control characters and null bytes
      const sanitizedName = trimmedName
        .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
        .replace(/\0/g, ""); // Remove null bytes

      if (!sanitizedName) {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message("Analysis name contains only invalid characters", {
          title: "Invalid Name",
          kind: "error",
        });
        return;
      }

      // Exit edit mode immediately for instant feedback
      setRenamingAnalysisId(null);
      setNewAnalysisName("");

      // Use mutation with optimistic update - UI updates immediately
      renameAnalysisMutation.mutate(
        { analysisId, newName: sanitizedName },
        {
          onError: async (error) => {
            loggers.dda.error("Error renaming analysis", { error });
            const { message } = await import("@tauri-apps/plugin-dialog");
            await message(
              (error as Error).message || "Failed to rename analysis",
              {
                title: "Rename Failed",
                kind: "error",
              },
            );
          },
        },
      );
    },
    [renameAnalysisMutation, newAnalysisName],
  );

  // Cancel rename
  const handleCancelRename = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setRenamingAnalysisId(null);
    setNewAnalysisName("");
  }, []);

  // Note: Analysis history is loaded by DashboardLayout on app startup
  // This component only refreshes when the user clicks the Refresh button
  // or after saving a new analysis

  // Sync local results with current analysis from store
  // Track when results are loaded from persistence vs fresh analysis
  // Skip NSG results - they should only show in main Results tab
  useEffect(() => {
    if (currentAnalysis && !results) {
      // Check if this is an NSG result (has source: 'nsg' marker)
      const isNSGResult = currentAnalysis.source === "nsg";

      if (!isNSGResult) {
        setResults(currentAnalysis);
        setResultsFromPersistence(true);
      } else {
        loggers.dda.debug("Skipping local results sync for NSG result");
      }
    }
  }, [currentAnalysis, results]);

  // Auto-populate parameters when loading an analysis from history
  useEffect(() => {
    if (currentAnalysis?.parameters && selectedFile?.channels) {
      const params = currentAnalysis.parameters;
      const fileChannels = selectedFile.channels;

      loggers.dda.debug("Auto-populating parameters from loaded analysis", {
        variants: params.variants,
        hasVariantConfigs: !!params.variant_configs,
        topLevelChannels: currentAnalysis.channels,
        paramsChannels: params.channels,
        windowLength: params.window_length,
        windowStep: params.window_step,
      });

      // NEW: Build per-variant channel configs from variant_configs (if available)
      const newVariantChannelConfigs: typeof localParameters.variantChannelConfigs =
        {};

      if (params.variant_configs) {
        loggers.dda.debug("Loading from variant_configs", {
          variant_configs: params.variant_configs,
        });

        // Iterate through each variant in variant_configs
        Object.entries(params.variant_configs).forEach(
          ([variantId, config]) => {
            newVariantChannelConfigs[variantId] = {};

            // Convert channel indices to channel names
            if (
              config.selectedChannels &&
              Array.isArray(config.selectedChannels)
            ) {
              newVariantChannelConfigs[variantId].selectedChannels =
                config.selectedChannels.map(
                  (idx) => fileChannels[idx] || `Channel ${idx}`,
                );
            }

            // Convert ctChannelPairs (for CT) from indices to names
            if (config.ctChannelPairs && Array.isArray(config.ctChannelPairs)) {
              newVariantChannelConfigs[variantId].ctChannelPairs =
                config.ctChannelPairs.map(
                  ([idx1, idx2]) =>
                    [
                      fileChannels[idx1] || `Channel ${idx1}`,
                      fileChannels[idx2] || `Channel ${idx2}`,
                    ] as [string, string],
                );
            }

            // Convert cdChannelPairs (for CD) from indices to names
            if (config.cdChannelPairs && Array.isArray(config.cdChannelPairs)) {
              newVariantChannelConfigs[variantId].cdChannelPairs =
                config.cdChannelPairs.map(
                  ([idx1, idx2]) =>
                    [
                      fileChannels[idx1] || `Channel ${idx1}`,
                      fileChannels[idx2] || `Channel ${idx2}`,
                    ] as [string, string],
                );
            }
          },
        );

        loggers.dda.debug("Populated variantChannelConfigs", {
          configs: newVariantChannelConfigs,
        });
      }

      // FALLBACK: Use top-level channels from DDAResult or params.channels (legacy)
      const channelNames = currentAnalysis.channels || params.channels || [];

      loggers.dda.debug("Checking for CT/CD pairs", {
        hasCTPairs: !!params.ct_channel_pairs,
        ctPairsLength: params.ct_channel_pairs?.length,
        ctPairsValue: params.ct_channel_pairs,
        hasCDPairs: !!params.cd_channel_pairs,
        cdPairsLength: params.cd_channel_pairs?.length,
        cdPairsValue: params.cd_channel_pairs,
      });

      // FALLBACK: Convert CT channel pairs from indices to names (legacy format)
      let ctPairs: [string, string][] = [];
      if (params.ct_channel_pairs && Array.isArray(params.ct_channel_pairs)) {
        ctPairs = params.ct_channel_pairs.map(([idx1, idx2]) => {
          // If the pair contains numbers (indices), convert to channel names
          if (typeof idx1 === "number" && typeof idx2 === "number") {
            return [fileChannels[idx1] || "", fileChannels[idx2] || ""] as [
              string,
              string,
            ];
          }
          // Otherwise assume they're already channel names
          return [String(idx1), String(idx2)] as [string, string];
        });
        loggers.dda.debug("Converted CT pairs", { ctPairs });
      }

      // FALLBACK: Convert CD channel pairs from indices to names (legacy format)
      let cdPairs: [string, string][] = [];
      if (params.cd_channel_pairs && Array.isArray(params.cd_channel_pairs)) {
        cdPairs = params.cd_channel_pairs.map(([idx1, idx2]) => {
          // If the pair contains numbers (indices), convert to channel names
          if (typeof idx1 === "number" && typeof idx2 === "number") {
            return [fileChannels[idx1] || "", fileChannels[idx2] || ""] as [
              string,
              string,
            ];
          }
          // Otherwise assume they're already channel names
          return [String(idx1), String(idx2)] as [string, string];
        });
        loggers.dda.debug("Converted CD pairs", { cdPairs });
      }

      // LEGACY FALLBACK: If no variant_configs, build from legacy format
      if (
        !params.variant_configs &&
        params.variants &&
        params.variants.length > 0
      ) {
        loggers.dda.debug("Building variantChannelConfigs from legacy format");

        params.variants.forEach((variantId) => {
          newVariantChannelConfigs[variantId] = {};

          // For ST, DE, SY: Use top-level channels
          if (
            variantId === "single_timeseries" ||
            variantId === "dynamical_ergodicity" ||
            variantId === "synchronization"
          ) {
            if (channelNames.length > 0) {
              newVariantChannelConfigs[variantId].selectedChannels =
                channelNames;
            }
          }

          // For CT: Use ct_channel_pairs or generate defaults
          if (variantId === "cross_timeseries") {
            if (ctPairs.length > 0) {
              newVariantChannelConfigs[variantId].ctChannelPairs = ctPairs;
            } else if (channelNames.length >= 2) {
              // Generate default pairs from first N channels (sequential pairs)
              const defaultPairs: [string, string][] = [];
              const maxPairs = Math.min(4, Math.floor(channelNames.length / 2)); // Max 4 pairs
              for (let i = 0; i < maxPairs * 2; i += 2) {
                if (i + 1 < channelNames.length) {
                  defaultPairs.push([channelNames[i], channelNames[i + 1]]);
                }
              }
              if (defaultPairs.length > 0) {
                newVariantChannelConfigs[variantId].ctChannelPairs =
                  defaultPairs;
                loggers.dda.debug("Generated default CT pairs", {
                  pairs: defaultPairs,
                });
              }
            }
          }

          // For CD: Use cd_channel_pairs or generate defaults
          if (variantId === "cross_dynamical") {
            if (cdPairs.length > 0) {
              newVariantChannelConfigs[variantId].cdChannelPairs = cdPairs;
            } else if (channelNames.length >= 2) {
              // Generate default directed pairs (same as CT for simplicity)
              const defaultPairs: [string, string][] = [];
              const maxPairs = Math.min(4, Math.floor(channelNames.length / 2)); // Max 4 pairs
              for (let i = 0; i < maxPairs * 2; i += 2) {
                if (i + 1 < channelNames.length) {
                  defaultPairs.push([channelNames[i], channelNames[i + 1]]);
                }
              }
              if (defaultPairs.length > 0) {
                newVariantChannelConfigs[variantId].cdChannelPairs =
                  defaultPairs;
                loggers.dda.debug("Generated default CD pairs", {
                  pairs: defaultPairs,
                });
              }
            }
          }
        });

        loggers.dda.debug("Built variantChannelConfigs from legacy", {
          configs: newVariantChannelConfigs,
        });
      }

      // Cast to any for backwards compatibility with legacy stored parameters
      const legacyParams = params as any;
      setLocalParameters((prev) => ({
        ...prev,
        variants: params.variants || prev.variants,
        windowLength: params.window_length || prev.windowLength,
        windowStep: params.window_step || prev.windowStep,
        delays: params.delay_list || legacyParams.delays || prev.delays,
        timeStart: params.start_time ?? prev.timeStart,
        timeEnd: params.end_time ?? prev.timeEnd,
        selectedChannels: channelNames,
        ctWindowLength: params.ct_window_length || prev.ctWindowLength,
        ctWindowStep: params.ct_window_step || prev.ctWindowStep,
        ctChannelPairs: ctPairs.length > 0 ? ctPairs : prev.ctChannelPairs,
        cdChannelPairs: cdPairs.length > 0 ? cdPairs : prev.cdChannelPairs,
        // NEW: Set per-variant configs if available, otherwise keep previous
        variantChannelConfigs:
          Object.keys(newVariantChannelConfigs).length > 0
            ? newVariantChannelConfigs
            : prev.variantChannelConfigs,
        // Note: expertMode is now controlled at app level, not per-analysis
        modelParameters:
          params.model_dimension ||
          params.polynomial_order ||
          params.model_params
            ? {
                dm: params.model_dimension || 4,
                order: params.polynomial_order || 4,
                nr_tau: params.nr_tau || 2,
                encoding: params.model_params || [1, 2, 10],
              }
            : prev.modelParameters,
      }));
    }
  }, [currentAnalysis?.id, selectedFile?.channels]); // Only re-run when analysis ID or file channels change

  // Check for NSG credentials on mount
  useEffect(() => {
    const checkNsgCredentials = async () => {
      if (!TauriService.isTauri()) return;
      try {
        const hasCreds = await TauriService.hasNSGCredentials();
        setHasNsgCredentials(hasCreds);
      } catch (error) {
        loggers.nsg.error("Failed to check NSG credentials", { error });
      }
    };

    checkNsgCredentials();
  }, []);

  // Listen for NSG results being loaded
  useEffect(() => {
    const handleNSGResults = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { jobId, resultsData } = customEvent.detail;

      loggers.dda.debug("Received NSG results", { jobId, resultsData });

      // For NSG results: ONLY update the global store (main Results tab)
      // Do NOT set local results (prevents showing in DDA Analysis → Results sub-tab)
      if (resultsData) {
        setCurrentAnalysis(resultsData);
        loggers.dda.debug(
          "NSG results loaded to global store (main Results tab only)",
        );
      }
    };

    window.addEventListener("load-nsg-results", handleNSGResults);

    return () => {
      window.removeEventListener("load-nsg-results", handleNSGResults);
    };
  }, [setCurrentAnalysis]);

  // Use shared DDA_VARIANTS from VariantSelector component
  const availableVariants = DDA_VARIANTS;

  // Initialize with file data - run when file changes or duration is loaded
  useEffect(() => {
    if (selectedFile) {
      const fileDuration = selectedFile.duration;

      // Only update if we have a valid duration (> 0)
      if (fileDuration && fileDuration > 0) {
        const defaultChannels = selectedFile.channels.slice(
          0,
          Math.min(8, selectedFile.channels.length),
        );
        // Calculate default window length as 1/4 second (0.25 * sampling_rate)
        const defaultWindowLength = Math.round(0.25 * selectedFile.sample_rate);

        loggers.dda.debug("Updating time range", { fileDuration });

        setLocalParameters((prev) => ({
          ...prev,
          selectedChannels: defaultChannels,
          timeStart: 0,
          timeEnd: fileDuration,
        }));

        // Update window length based on sampling rate
        setLocalParameters((prev) => ({
          ...prev,
          windowLength: defaultWindowLength,
        }));
      } else {
        loggers.dda.warn("File loaded but duration not available yet", {
          filePath: selectedFile.file_path,
        });
      }
    }
  }, [selectedFile?.file_path, selectedFile?.duration]); // Depend on both file path and duration

  // Real-time validation of channel configuration
  useEffect(() => {
    // Only validate if variants are selected
    if (parameters.variants.length === 0) {
      setChannelValidationError(null);
      return;
    }

    // Check each selected variant has channel configuration
    const missingConfigVariants: string[] = [];

    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];

      // Check if this variant has any channels configured
      let hasChannels = false;

      if (config) {
        // Check single channels (for ST, DE, SY)
        if (config.selectedChannels && config.selectedChannels.length > 0) {
          hasChannels = true;
        }
        // Check CT pairs
        if (config.ctChannelPairs && config.ctChannelPairs.length > 0) {
          hasChannels = true;
        }
        // Check CD pairs
        if (config.cdChannelPairs && config.cdChannelPairs.length > 0) {
          hasChannels = true;
        }
      }

      if (!hasChannels) {
        const variant = availableVariants.find((v) => v.id === variantId);
        missingConfigVariants.push(variant?.name || variantId);
      }
    });

    if (missingConfigVariants.length > 0) {
      if (missingConfigVariants.length === parameters.variants.length) {
        setChannelValidationError(
          "Please configure channels for at least one variant before running analysis",
        );
      } else {
        setChannelValidationError(
          `Missing channel configuration for: ${missingConfigVariants.join(", ")}`,
        );
      }
    } else {
      setChannelValidationError(null);
    }
  }, [
    parameters.variants,
    parameters.variantChannelConfigs,
    availableVariants,
  ]);

  const runAnalysis = async () => {
    if (!selectedFile) {
      loggers.dda.error("Please select a file");
      return;
    }

    // Extract all channels from variant configurations
    const allChannels = new Set<string>();

    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];

      if (config) {
        // Add single channels (for ST, DE, SY)
        if (config.selectedChannels) {
          config.selectedChannels.forEach((ch) => allChannels.add(ch));
        }
        // Add channels from CT pairs
        if (config.ctChannelPairs) {
          config.ctChannelPairs.forEach(([ch1, ch2]) => {
            allChannels.add(ch1);
            allChannels.add(ch2);
          });
        }
        // Add channels from CD pairs
        if (config.cdChannelPairs) {
          config.cdChannelPairs.forEach(([from, to]) => {
            allChannels.add(from);
            allChannels.add(to);
          });
        }
      }
    });

    if (allChannels.size === 0) {
      setChannelValidationError(
        "Please configure channels for at least one variant before running analysis",
      );
      // Scroll to channel configuration section
      document
        .querySelector('[data-section="channel-config"]')
        ?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    // Clear any previous validation error
    setChannelValidationError(null);

    // Sync local parameters to store when running analysis
    updateAnalysisParameters({
      variants: parameters.variants,
      windowLength: parameters.windowLength,
      windowStep: parameters.windowStep,
      delays: parameters.delays,
    });

    // Get CT channel pairs from variant config
    const ctConfig = parameters.variantChannelConfigs["cross_timeseries"];
    const ctChannelPairs: [number, number][] | undefined =
      ctConfig?.ctChannelPairs &&
      ctConfig.ctChannelPairs.length > 0 &&
      selectedFile
        ? ctConfig.ctChannelPairs
            .map(([ch1, ch2]) => {
              const idx1 = selectedFile!.channels.indexOf(ch1);
              const idx2 = selectedFile!.channels.indexOf(ch2);
              return [idx1, idx2] as [number, number];
            })
            .filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1)
        : undefined;

    // Get CD channel pairs from variant config
    const cdConfig = parameters.variantChannelConfigs["cross_dynamical"];
    const cdChannelPairs: [number, number][] | undefined =
      cdConfig?.cdChannelPairs &&
      cdConfig.cdChannelPairs.length > 0 &&
      selectedFile
        ? cdConfig.cdChannelPairs
            .map(([from, to]) => {
              const fromIdx = selectedFile!.channels.indexOf(from);
              const toIdx = selectedFile!.channels.indexOf(to);
              return [fromIdx, toIdx] as [number, number];
            })
            .filter(([fromIdx, toIdx]) => fromIdx !== -1 && toIdx !== -1)
        : undefined;

    // Convert channel names to indices BEFORE creating the request
    const channelNames = Array.from(allChannels);
    const channelIndices = channelNames
      .map((ch) => selectedFile!.channels.indexOf(ch))
      .filter((idx) => idx !== -1);

    // Build variant_configs from variantChannelConfigs
    const variantConfigs: { [variantId: string]: any } = {};

    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];
      if (!config) return;

      const variantConfig: any = {};

      // Handle individual channels (ST, DE, SY)
      if (config.selectedChannels && config.selectedChannels.length > 0) {
        variantConfig.selectedChannels = config.selectedChannels
          .map((ch) => selectedFile!.channels.indexOf(ch))
          .filter((idx) => idx !== -1);
      }

      // Handle CT channel pairs
      if (config.ctChannelPairs && config.ctChannelPairs.length > 0) {
        variantConfig.ctChannelPairs = config.ctChannelPairs
          .map(([ch1, ch2]) => {
            const idx1 = selectedFile!.channels.indexOf(ch1);
            const idx2 = selectedFile!.channels.indexOf(ch2);
            return [idx1, idx2] as [number, number];
          })
          .filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1);
      }

      // Handle CD directed pairs
      if (config.cdChannelPairs && config.cdChannelPairs.length > 0) {
        variantConfig.cdChannelPairs = config.cdChannelPairs
          .map(([from, to]) => {
            const fromIdx = selectedFile!.channels.indexOf(from);
            const toIdx = selectedFile!.channels.indexOf(to);
            return [fromIdx, toIdx] as [number, number];
          })
          .filter(([fromIdx, toIdx]) => fromIdx !== -1 && toIdx !== -1);
      }

      // Only add to variantConfigs if there's actual configuration
      if (Object.keys(variantConfig).length > 0) {
        variantConfigs[variantId] = variantConfig;
      }
    });

    // Prepare the analysis request
    const request: DDAAnalysisRequest = {
      file_path: selectedFile.file_path,
      channels: channelIndices.map((idx) => idx.toString()), // API service expects numeric strings
      start_time: parameters.timeStart,
      end_time: parameters.timeEnd,
      variants: parameters.variants,
      window_length: parameters.windowLength,
      window_step: parameters.windowStep,
      delay_list: parameters.delays,
      ct_window_length: parameters.ctWindowLength,
      ct_window_step: parameters.ctWindowStep,
      ct_channel_pairs: ctChannelPairs,
      cd_channel_pairs: cdChannelPairs,
      // NEW: Per-variant channel configuration
      variant_configs:
        Object.keys(variantConfigs).length > 0 ? variantConfigs : undefined,
    };

    loggers.dda.info("LOCAL DDA Analysis Parameters", {
      file: selectedFile.file_path,
      sampleRate: selectedFile.sample_rate,
      channelNames,
      channelIndices: request.channels,
      timeRange: { start: request.start_time, end: request.end_time },
      window: { length: request.window_length, step: request.window_step },
      delays: request.delay_list,
      ctChannelPairs: ctChannelPairs || [],
      cdChannelPairs: cdChannelPairs || [],
      variantConfigs: request.variant_configs,
    });

    // Record DDA parameters if recording is active
    if (isWorkflowRecording) {
      try {
        const paramAction = createSetDDAParametersAction(
          parameters.delays[0] || 1, // lag (using first delay)
          4, // dimension (default)
          parameters.windowLength,
          parameters.windowStep,
        );
        await recordAction(paramAction);
        incrementActionCount();
        loggers.dda.debug("Recorded DDA parameters to workflow");
      } catch (error) {
        loggers.dda.error("Failed to record DDA parameters to workflow", {
          error,
        });
      }
    }

    // Submit analysis using mutation
    // Use flushSync to ensure the progress bar renders immediately before the async operation
    loggers.dda.debug("Starting analysis, showing progress bar");
    analysisStartTimeRef.current = Date.now();
    flushSync(() => {
      setLocalIsRunning(true);
      setDDARunning(true);
    });

    // Helper to hide progress with minimum display time
    const hideProgressBar = (callback: () => void) => {
      const elapsed = Date.now() - (analysisStartTimeRef.current || 0);
      const minDisplayTime = 500; // Show progress bar for at least 500ms
      const remainingTime = Math.max(0, minDisplayTime - elapsed);

      if (remainingTime > 0) {
        minProgressDisplayTimeRef.current = setTimeout(() => {
          setLocalIsRunning(false);
          setDDARunning(false);
          callback();
        }, remainingTime);
      } else {
        setLocalIsRunning(false);
        setDDARunning(false);
        callback();
      }
    };

    submitAnalysisMutation.mutate(request, {
      onSuccess: (result) => {
        // Ensure channels are properly set in the result
        // The backend may return empty or generic channel names, so we use the actual names
        const resultWithChannels = {
          ...result,
          channels: channelNames, // Use the actual channel names, not the indices
          name: analysisName.trim() || result.name,
        };

        loggers.dda.info("Analysis complete", {
          id: resultWithChannels.id,
          filePath: resultWithChannels.file_path,
        });

        // Hide progress bar with minimum display time, then update results
        hideProgressBar(() => {
          setResults(resultWithChannels);
          setCurrentAnalysis(resultWithChannels);
          addAnalysisToHistory(resultWithChannels);
          setAnalysisName(""); // Clear name after successful analysis
          setResultsFromPersistence(false); // Mark as fresh analysis, not from persistence

          // Record DDA analysis execution if recording is active
          if (isWorkflowRecording && selectedFile) {
            // Convert channel names to their actual indices in the file's channel list
            const channelIndices = parameters.selectedChannels
              .map((channelName) => selectedFile!.channels.indexOf(channelName))
              .filter((idx) => idx !== -1); // Remove any channels not found

            loggers.dda.debug("Recording DDA analysis with channel indices", {
              channelIndices,
            });
            const analysisAction = createRunDDAAnalysisAction(
              result.id,
              channelIndices,
            );
            recordAction(analysisAction)
              .then(() => {
                incrementActionCount();
                loggers.dda.debug("Recorded DDA analysis execution");
              })
              .catch((error) => {
                loggers.dda.error("Failed to record DDA analysis", { error });
              });
          }

          // Save to history asynchronously (non-blocking)
          saveToHistoryMutation.mutate(resultWithChannels, {
            onError: (err) => {
              loggers.dda.error("Background save to history failed", {
                error: err,
              });
            },
          });
        });
      },
      onError: (err) => {
        loggers.dda.error("DDA analysis failed", {
          error: err,
          errorName: err instanceof Error ? err.name : undefined,
          errorMessage: err instanceof Error ? err.message : String(err),
          request: {
            file_path: selectedFile?.file_path,
            channels: parameters.selectedChannels,
            time_range: [parameters.timeStart, parameters.timeEnd],
            variants: parameters.variants,
          },
        });
        // Hide progress bar with minimum display time for errors too
        hideProgressBar(() => {});
      },
    });
  };

  const submitToNSG = async () => {
    if (!TauriService.isTauri()) {
      setNsgError(
        "NSG submission is only available in the Tauri desktop application",
      );
      return;
    }

    // Extract all channels from variant configurations
    const allChannels = new Set<string>();
    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];
      if (config) {
        if (config.selectedChannels) {
          config.selectedChannels.forEach((ch) => allChannels.add(ch));
        }
        if (config.ctChannelPairs) {
          config.ctChannelPairs.forEach(([ch1, ch2]) => {
            allChannels.add(ch1);
            allChannels.add(ch2);
          });
        }
        if (config.cdChannelPairs) {
          config.cdChannelPairs.forEach(([from, to]) => {
            allChannels.add(from);
            allChannels.add(to);
          });
        }
      }
    });

    if (!selectedFile || allChannels.size === 0) {
      setNsgError(
        "Please select a file and configure channels for at least one variant",
      );
      return;
    }

    if (!hasNsgCredentials) {
      setNsgError("Please configure NSG credentials in Settings first");
      return;
    }

    try {
      setIsSubmittingToNsg(true);
      setNsgError(null);
      setNsgSubmissionPhase("Preparing job parameters...");

      // Build DDA request parameters in the format expected by Rust DDARequest struct
      // Note: selectedFile is guaranteed to be non-null by the check above
      const channelArray = Array.from(allChannels);
      const request = {
        file_path: selectedFile!.file_path,
        channels:
          channelArray.length > 0
            ? channelArray.map((ch) => {
                const channelIndex = selectedFile!.channels.indexOf(ch);
                return channelIndex >= 0 ? channelIndex : 0;
              })
            : null,
        time_range: {
          start: parameters.timeStart,
          end: parameters.timeEnd,
        },
        preprocessing_options: {
          highpass: parameters.preprocessing.highpass || null,
          lowpass: parameters.preprocessing.lowpass || null,
        },
        algorithm_selection: {
          enabled_variants: parameters.variants,
          select_mask: null,
        },
        window_parameters: {
          window_length: parameters.windowLength,
          window_step: parameters.windowStep,
          ct_window_length: parameters.ctWindowLength || null,
          ct_window_step: parameters.ctWindowStep || null,
        },
        scale_parameters: {
          delay_list: parameters.delays,
        },
        model_dimension:
          appExpertMode && parameters.modelParameters
            ? parameters.modelParameters.dm
            : undefined,
        polynomial_order:
          appExpertMode && parameters.modelParameters
            ? parameters.modelParameters.order
            : undefined,
        nr_tau:
          appExpertMode && parameters.modelParameters
            ? parameters.modelParameters.nr_tau
            : undefined,
        model_params:
          appExpertMode && parameters.modelParameters?.encoding
            ? parameters.modelParameters.encoding
            : undefined,
        ct_channel_pairs:
          parameters.ctChannelPairs?.length > 0
            ? parameters.ctChannelPairs.map((pair) => {
                const idx0 = selectedFile.channels.indexOf(pair[0]);
                const idx1 = selectedFile.channels.indexOf(pair[1]);
                return [idx0 >= 0 ? idx0 : 0, idx1 >= 0 ? idx1 : 0];
              })
            : null,
        parallel_cores: parameters.nsgResourceConfig?.cores || 4, // Use NSG cores setting
        resource_config: parameters.nsgResourceConfig,
      };

      // Map channel indices back to names for display
      const channelNames =
        request.channels?.map(
          (idx) => selectedFile.channels[idx] || `Unknown(${idx})`,
        ) || [];

      loggers.nsg.info("NSG DDA Analysis Parameters", {
        file: selectedFile.file_path,
        sampleRate: selectedFile.sample_rate,
        channelIndices: request.channels,
        channelNames,
        timeRange: request.time_range,
        window: request.window_parameters,
        delays: request.scale_parameters.delay_list,
      });

      setNsgSubmissionPhase("Creating job in database...");

      // Create NSG job with PY_EXPANSE tool (resource params not used by NSG)
      const jobId = await TauriService.createNSGJob(
        "PY_EXPANSE",
        request,
        selectedFile.file_path,
      );

      loggers.nsg.info("Job created", { jobId });

      setNsgSubmissionPhase(
        "Uploading file to NSG (this may take a few minutes for large files)...",
      );

      // Submit the job to NSG
      await TauriService.submitNSGJob(jobId);

      loggers.nsg.info("Job submitted successfully");

      setNsgSubmissionPhase("");
      setIsSubmittingToNsg(false);

      // Show native notification instead of alert dialog
      await TauriService.createNotification(
        "NSG Job Submitted",
        `Job successfully submitted to Neuroscience Gateway. Job ID: ${jobId.substring(
          0,
          8,
        )}...`,
        NotificationType.Success,
        "navigate_nsg_manager",
        { jobId },
      );
    } catch (error) {
      loggers.nsg.error("Submission error", {
        error,
        message: error instanceof Error ? error.message : String(error),
      });
      setNsgError(
        error instanceof Error ? error.message : "Failed to submit job to NSG",
      );
      setNsgSubmissionPhase("");
      setIsSubmittingToNsg(false);
    }
  };

  const submitToServer = async () => {
    if (!TauriService.isTauri()) {
      setServerError(
        "Server submission is only available in the Tauri desktop application",
      );
      return;
    }

    if (!isServerConnected) {
      setServerError(
        "Not connected to a remote server. Connect in Settings → Sync first.",
      );
      return;
    }

    // Extract all channels from variant configurations
    const allChannels = new Set<string>();
    parameters.variants.forEach((variantId) => {
      const config = parameters.variantChannelConfigs[variantId];
      if (config) {
        if (config.selectedChannels) {
          config.selectedChannels.forEach((ch) => allChannels.add(ch));
        }
        if (config.ctChannelPairs) {
          config.ctChannelPairs.forEach(([ch1, ch2]) => {
            allChannels.add(ch1);
            allChannels.add(ch2);
          });
        }
        if (config.cdChannelPairs) {
          config.cdChannelPairs.forEach(([from, to]) => {
            allChannels.add(from);
            allChannels.add(to);
          });
        }
      }
    });

    if (!selectedFile || allChannels.size === 0) {
      setServerError(
        "Please select a file and configure channels for at least one variant",
      );
      return;
    }

    try {
      setIsSubmittingToServer(true);
      setServerError(null);
      setServerSubmissionPhase("Preparing job parameters...");

      const { invoke } = await import("@tauri-apps/api/core");

      // Get CT channel pairs from variant config
      const ctConfig = parameters.variantChannelConfigs["cross_timeseries"];
      const ctPairs: [string, string][] = ctConfig?.ctChannelPairs || [];

      // Get CD channel pairs from variant config
      const cdConfig = parameters.variantChannelConfigs["cross_dynamical"];
      const cdPairs: [string, string][] = cdConfig?.cdChannelPairs || [];

      // Build DDA parameters for server submission
      const jobParameters = {
        channels: Array.from(allChannels),
        ct_pairs: ctPairs,
        cd_pairs: cdPairs,
        time_window:
          parameters.windowLength / (selectedFile?.sample_rate || 256),
        delta: parameters.windowStep / (selectedFile?.sample_rate || 256),
        embedding_dim: parameters.modelParameters?.dm || 4,
        svd_dimensions: 3,
        downsample: 1,
        start_time: parameters.timeStart,
        end_time: parameters.timeEnd,
      };

      loggers.api.info("SERVER DDA Analysis Parameters", {
        file: selectedFile.file_path,
        channels: Array.from(allChannels),
        timeRange: { start: parameters.timeStart, end: parameters.timeEnd },
      });

      setServerSubmissionPhase("Submitting job to server...");

      // Submit job to remote server
      const response = await invoke<{
        job_id: string;
        status: string;
        message: string;
      }>("job_submit_server_file", {
        serverPath: selectedFile.file_path,
        parameters: jobParameters,
      });

      loggers.api.info("Server job submitted successfully", { response });

      setServerSubmissionPhase("");
      setIsSubmittingToServer(false);

      // Show success notification
      await TauriService.createNotification(
        "Server Job Submitted",
        `Job successfully submitted to remote server. Job ID: ${response.job_id.substring(0, 8)}...`,
        NotificationType.Success,
      );

      toast.success(
        "Job Submitted",
        `Analysis submitted to server. Job ID: ${response.job_id.substring(0, 8)}...`,
      );
    } catch (error) {
      loggers.api.error("Server submission error", { error });
      setServerError(
        error instanceof Error
          ? error.message
          : "Failed to submit job to server",
      );
      setServerSubmissionPhase("");
      setIsSubmittingToServer(false);
    }
  };

  const resetParameters = () => {
    // Calculate default window length based on sampling rate (0.25 seconds)
    const defaultWindowLength = selectedFile
      ? Math.round(0.25 * selectedFile.sample_rate)
      : 64; // Fallback for 256 Hz: 0.25 * 256 = 64

    setLocalParameters({
      variants: ["single_timeseries"],
      windowLength: defaultWindowLength,
      windowStep: 10,
      delays: [7, 10], // Default delays
      timeStart: 0,
      timeEnd: selectedFile?.duration || 30,
      selectedChannels: selectedFile?.channels.slice(0, 8) || [],
      preprocessing: {
        highpass: 0.5,
        lowpass: 70,
        notch: [50],
      },
      ctWindowLength: undefined,
      ctWindowStep: undefined,
      ctChannelPairs: [],
      cdChannelPairs: [],
      variantChannelConfigs: {}, // Reset per-variant configs
      parallelCores: 1,
      nsgResourceConfig: {
        runtimeHours: 1.0,
        cores: 4,
        nodes: 1,
      },
      expertMode: false, // Deprecated - controlled at app level
      modelParameters: {
        dm: 4,
        order: 4,
        nr_tau: 2,
        encoding: [1, 2, 10], // EEG Standard preset as default
      },
    });
  };

  const handleChannelToggle = (channel: string, checked: boolean) => {
    setLocalParameters((prev) => ({
      ...prev,
      selectedChannels: checked
        ? [...prev.selectedChannels, channel]
        : prev.selectedChannels.filter((ch) => ch !== channel),
    }));
  };

  // Handle cancellation of running analysis
  const handleCancelAnalysis = useCallback(async () => {
    setIsCancelling(true);
    try {
      const result = await apiService.cancelDDAAnalysis();
      if (result.success) {
        loggers.dda.info("Analysis cancelled", {
          analysisId: result.cancelled_analysis_id,
        });
        toast.info("Analysis Cancelled", "DDA analysis was cancelled");
        setLocalIsRunning(false);
        setDDARunning(false);
      } else {
        loggers.dda.warn("Failed to cancel", { message: result.message });
        toast.error(
          "Cancel Failed",
          result.message || "Could not cancel analysis",
        );
      }
    } catch (error) {
      loggers.dda.error("Error cancelling", { error });
      toast.error(
        "Cancel Error",
        error instanceof Error ? error.message : "Failed to cancel analysis",
      );
    } finally {
      setIsCancelling(false);
    }
  }, [apiService, setDDARunning]);

  const handleExportConfig = async () => {
    if (!selectedFile) return;

    try {
      // Compute file hash for verification
      let fileHash = "";
      if (TauriService.isTauri()) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          fileHash = await invoke<string>("compute_file_hash", {
            filePath: selectedFile.file_path,
          });
        } catch (error) {
          loggers.export.warn("Failed to compute file hash", { error });
          // Continue with empty hash
        }
      }

      const config = exportDDAConfig(
        {
          variants: parameters.variants,
          windowLength: parameters.windowLength,
          windowStep: parameters.windowStep,
          delays: parameters.delays,
          // Only export channels for selected variants
          stChannels: parameters.variants.includes("single_timeseries")
            ? parameters.selectedChannels
            : undefined,
          ctChannelPairs: parameters.variants.includes("cross_timeseries")
            ? parameters.ctChannelPairs.map(([source, target]) => ({
                source,
                target,
              }))
            : undefined,
          cdChannelPairs: parameters.variants.includes("cross_dynamical")
            ? parameters.cdChannelPairs.map(([source, target]) => ({
                source,
                target,
              }))
            : undefined,
          ctDelayMin: parameters.ctWindowLength,
          ctDelayMax: parameters.ctWindowStep,
        },
        selectedFile,
        {
          analysisName: analysisName || "DDA Analysis",
          description: `DDA configuration for ${selectedFile.file_name}`,
          analysisId: results?.id,
        },
      );

      // Set the computed hash
      config.source_file.file_hash = fileHash;

      const jsonContent = serializeDDAConfig(config);
      const filename = generateExportFilename(
        analysisName || "analysis",
        selectedFile.file_name,
      );

      if (TauriService.isTauri()) {
        // Use Tauri dialog plugin directly for .ddalab files
        const { save } = await import("@tauri-apps/plugin-dialog");
        const filePath = await save({
          defaultPath: filename,
          filters: [
            {
              name: "DDALAB Config",
              extensions: ["ddalab"],
            },
            {
              name: "JSON",
              extensions: ["json"],
            },
          ],
        });

        if (filePath) {
          // Write the file
          const { writeTextFile } = await import("@tauri-apps/plugin-fs");
          await writeTextFile(filePath, jsonContent);

          await TauriService.createNotification(
            "Configuration Exported",
            `Saved to ${filePath}`,
            NotificationType.Success,
          );
        }
      } else {
        // Browser fallback - download file
        const blob = new Blob([jsonContent], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      loggers.export.error("Failed to export configuration", { error });
      if (TauriService.isTauri()) {
        await TauriService.createNotification(
          "Export Failed",
          error instanceof Error ? error.message : "Unknown error",
          NotificationType.Error,
        );
      }
    }
  };

  const handleImportConfig = async () => {
    try {
      let fileContent: string;

      if (TauriService.isTauri()) {
        // Use Tauri dialog plugin
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          title: "Import DDA Configuration",
          filters: [
            {
              name: "DDALAB Config",
              extensions: ["ddalab", "json"],
            },
          ],
        });

        if (!selected || typeof selected !== "string") {
          return; // User cancelled
        }

        // Read file content
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        fileContent = await readTextFile(selected);
      } else {
        // Browser fallback - file input
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".ddalab,.json";

        const file = await new Promise<File | null>((resolve) => {
          input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files;
            resolve(files?.[0] || null);
          };
          input.click();
        });

        if (!file) return;

        fileContent = await file.text();
      }

      const { config, validation } = importDDAConfig(fileContent, selectedFile);

      setImportValidation({
        warnings: validation.warnings,
        errors: validation.errors,
      });

      if (validation.valid) {
        // Apply configuration
        const importedParams = configToLocalParameters(config);
        setLocalParameters((prev) => ({
          ...prev,
          ...importedParams,
          timeEnd: selectedFile?.duration || prev.timeEnd,
        }));

        setAnalysisName(config.analysis_name);
        setShowImportDialog(true);
      } else {
        // Show errors
        setShowImportDialog(true);
      }
    } catch (error) {
      loggers.dda.error("Failed to import configuration", { error });
      setImportValidation({
        warnings: [],
        errors: [
          error instanceof Error ? error.message : "Failed to parse file",
        ],
      });
      setShowImportDialog(true);
    }
  };

  if (!selectedFile) {
    return (
      <Card className="h-full flex items-center justify-center">
        <CardContent>
          <div className="text-center">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No File Selected</h3>
            <p className="text-muted-foreground">
              Select an EDF file from the file manager to start DDA analysis
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      <AnalysisProgressOverlay
        isVisible={ddaRunning || localIsRunning}
        progress={progress}
        statusMessage={analysisStatus}
        estimatedTime={estimatedTime}
        isCancelling={isCancelling}
        onCancel={handleCancelAnalysis}
      />

      <div className="flex-1 flex flex-col min-h-0">
        <AnalysisToolbar
          analysisName={analysisName}
          onAnalysisNameChange={setAnalysisName}
          isRunning={ddaRunning || localIsRunning}
          isSubmittingToServer={isSubmittingToServer}
          isSubmittingToNsg={isSubmittingToNsg}
          isServerConnected={isServerConnected}
          hasNsgCredentials={hasNsgCredentials}
          hasSelectedFile={!!selectedFile}
          variants={parameters.variants}
          variantChannelConfigs={parameters.variantChannelConfigs}
          onRun={runAnalysis}
          onSubmitToServer={submitToServer}
          onSubmitToNsg={submitToNSG}
          onImport={handleImportConfig}
          onExport={handleExportConfig}
          onSensitivity={() => setShowSensitivityDialog(true)}
          onReset={() => setShowResetConfirmDialog(true)}
        />

        {serverSubmissionPhase && (
          <Alert className="mt-4 flex-shrink-0">
            <Server className="h-4 w-4 animate-pulse" />
            <AlertDescription>{serverSubmissionPhase}</AlertDescription>
          </Alert>
        )}

        {serverError && (
          <Alert variant="destructive" className="mt-4 flex-shrink-0">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {nsgSubmissionPhase && (
          <Alert className="mt-4 flex-shrink-0">
            <Cloud className="h-4 w-4 animate-pulse" />
            <AlertDescription>{nsgSubmissionPhase}</AlertDescription>
          </Alert>
        )}

        {nsgError && (
          <Alert variant="destructive" className="mt-4 flex-shrink-0">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{nsgError}</AlertDescription>
          </Alert>
        )}

        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
          {/* Analysis Status - only show for active/recent analysis, not restored from persistence */}
          {(localIsRunning ||
            autoLoadingResults ||
            (results && !resultsFromPersistence)) && (
            <AnalysisStatusCard
              state={
                localIsRunning
                  ? "running"
                  : autoLoadingResults
                    ? "loading"
                    : results
                      ? "completed"
                      : "error"
              }
              statusMessage={analysisStatus}
              progress={progress}
              estimatedTime={estimatedTime}
              error={error}
            />
          )}

          <div className="space-y-3">
            {/* Algorithm Selection */}
            <VariantSelector
              selectedVariants={parameters.variants}
              onVariantsChange={(newVariants) =>
                setLocalParameters((prev) => ({
                  ...prev,
                  variants: newVariants,
                }))
              }
              disabled={ddaRunning || localIsRunning}
            />

            {/* Time Range & Window Parameters - Combined for compactness */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">
                  Time Range & Window Settings
                </CardTitle>
                <CardDescription className="text-xs">
                  Analysis window configuration
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm">Start Time (s)</Label>
                  <Input
                    type="number"
                    value={parameters.timeStart}
                    onChange={(e) => {
                      const inputValue = parseFloat(e.target.value) || 0;
                      const clampedValue = Math.max(0, inputValue);
                      if (inputValue !== clampedValue) {
                        toast.warning(
                          "Value Adjusted",
                          `Start time cannot be negative. Set to ${clampedValue.toFixed(1)}s`,
                        );
                      }
                      setLocalParameters((prev) => ({
                        ...prev,
                        timeStart: clampedValue,
                      }));
                    }}
                    disabled={ddaRunning || localIsRunning}
                    min="0"
                    max={selectedFile?.duration}
                    step="0.1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Valid range: 0 - {selectedFile?.duration?.toFixed(1) || "?"}
                    s
                  </p>
                </div>
                <div>
                  <Label className="text-sm">End Time (s)</Label>
                  <Input
                    type="number"
                    value={parameters.timeEnd}
                    onChange={(e) => {
                      const inputValue = parseFloat(e.target.value) || 0;
                      const maxDuration = selectedFile?.duration || Infinity;
                      const minValue = parameters.timeStart + 0.1;
                      const clampedValue = Math.min(
                        maxDuration,
                        Math.max(minValue, inputValue),
                      );
                      if (inputValue !== clampedValue) {
                        if (inputValue > maxDuration) {
                          toast.warning(
                            "Value Adjusted",
                            `End time cannot exceed file duration. Set to ${clampedValue.toFixed(1)}s`,
                          );
                        } else if (inputValue < minValue) {
                          toast.warning(
                            "Value Adjusted",
                            `End time must be at least 0.1s after start. Set to ${clampedValue.toFixed(1)}s`,
                          );
                        }
                      }
                      setLocalParameters((prev) => ({
                        ...prev,
                        timeEnd: clampedValue,
                      }));
                    }}
                    disabled={ddaRunning || localIsRunning}
                    min={parameters.timeStart + 0.1}
                    max={selectedFile?.duration}
                    step="0.1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Valid range: {(parameters.timeStart + 0.1).toFixed(1)} -{" "}
                    {selectedFile?.duration?.toFixed(1) || "?"}s
                  </p>
                </div>
                <div className="text-xs text-muted-foreground">
                  Duration:{" "}
                  {(parameters.timeEnd - parameters.timeStart).toFixed(1)}s
                </div>

                {/* Window Parameters - Using improved WindowSizeSelector */}
                <div className="pt-4 mt-4 border-t">
                  <WindowSizeSelector
                    windowLength={parameters.windowLength}
                    windowStep={parameters.windowStep}
                    sampleRate={selectedFile?.sample_rate || 256}
                    duration={parameters.timeEnd - parameters.timeStart}
                    disabled={ddaRunning || localIsRunning}
                    onWindowLengthChange={(value) =>
                      setLocalParameters((prev) => ({
                        ...prev,
                        windowLength: value,
                      }))
                    }
                    onWindowStepChange={(value) =>
                      setLocalParameters((prev) => ({
                        ...prev,
                        windowStep: value,
                      }))
                    }
                  />
                </div>
              </CardContent>
            </Card>

            {/* Model Configuration Info */}
            <Card>
              <CardHeader className="pb-3 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm">
                      Model Configuration
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {appExpertMode
                        ? "Expert mode: Configure delays & MODEL parameters below"
                        : "Using EEG Standard preset (delays: [7, 10], MODEL: 1 2 10)"}
                    </CardDescription>
                  </div>
                  {!appExpertMode && (
                    <div className="text-xs text-muted-foreground">
                      Enable Expert Mode in Settings for advanced options
                    </div>
                  )}
                </div>
              </CardHeader>
            </Card>

            {/* Delay Parameters - Only in Expert Mode */}
            {appExpertMode && (
              <DelayPresetManager
                delays={parameters.delays}
                onChange={(delays) => {
                  setLocalParameters((prev) => ({
                    ...prev,
                    delays,
                  }));
                }}
                disabled={ddaRunning || localIsRunning}
                sampleRate={selectedFile?.sample_rate || 256}
              />
            )}

            {/* MODEL Parameters - Only in Expert Mode */}
            {appExpertMode && parameters.modelParameters && (
              <ModelBuilder
                numDelays={parameters.modelParameters.nr_tau}
                polynomialOrder={parameters.modelParameters.order}
                selectedTerms={
                  parameters.modelParameters.encoding || [1, 2, 10]
                }
                onTermsChange={(terms) => {
                  setLocalParameters((prev) => ({
                    ...prev,
                    modelParameters: {
                      ...prev.modelParameters!,
                      encoding: terms,
                    },
                  }));
                }}
                tauValues={parameters.delays}
              />
            )}
          </div>

          {/* Per-Variant Channel Configuration */}
          {parameters.variants.length > 0 && (
            <Card
              data-section="channel-config"
              className={channelValidationError ? "border-destructive" : ""}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Channel Configuration</CardTitle>
                <CardDescription className="text-xs">
                  Configure channels for each enabled variant
                </CardDescription>
              </CardHeader>
              <CardContent>
                {channelValidationError && (
                  <Alert variant="destructive" className="mb-4">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      {channelValidationError}
                    </AlertDescription>
                  </Alert>
                )}
                <CompactChannelConfigGroup
                  variants={availableVariants}
                  selectedVariants={parameters.variants}
                  channels={selectedFile.channels}
                  disabled={ddaRunning || localIsRunning}
                  channelConfigs={parameters.variantChannelConfigs}
                  onConfigChange={(variantId, config) => {
                    // Real-time validation is handled by useEffect
                    setLocalParameters((prev) => ({
                      ...prev,
                      variantChannelConfigs: {
                        ...prev.variantChannelConfigs,
                        [variantId]: config,
                      },
                    }));
                  }}
                />
              </CardContent>
            </Card>
          )}

          {/* Analysis Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Analysis Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <Label className="text-muted-foreground">Channels</Label>
                  <p className="font-medium">
                    {parameters.selectedChannels.length}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Time Range</Label>
                  <p className="font-medium">
                    {(parameters.timeEnd - parameters.timeStart).toFixed(1)}s
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Variants</Label>
                  <p className="font-medium">{parameters.variants.length}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Est. Time</Label>
                  <p className="font-medium">{estimatedTime}s</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Import Validation Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {importValidation?.errors.length
                ? "Import Failed"
                : "Configuration Imported"}
            </DialogTitle>
            <DialogDescription>
              {importValidation?.errors.length
                ? "The configuration could not be applied due to validation errors"
                : "Configuration has been successfully loaded"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {importValidation?.errors && importValidation.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-2">Errors:</div>
                  <ul className="list-disc pl-4 space-y-1">
                    {importValidation.errors.map((error, idx) => (
                      <li key={idx} className="text-sm">
                        {error}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {importValidation?.warnings &&
              importValidation.warnings.length > 0 && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="font-semibold mb-2">Warnings:</div>
                    <ul className="list-disc pl-4 space-y-1">
                      {importValidation.warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm">
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

            {importValidation &&
              !importValidation.errors.length &&
              !importValidation.warnings.length && (
                <Alert>
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription>
                    Configuration imported successfully with no issues.
                  </AlertDescription>
                </Alert>
              )}
          </div>

          <DialogFooter>
            <Button onClick={() => setShowImportDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sensitivity Analysis Dialog */}
      {selectedFile && (
        <SensitivityAnalysisDialog
          open={showSensitivityDialog}
          onOpenChange={setShowSensitivityDialog}
          apiService={apiService}
          baseConfig={{
            file_path: selectedFile.file_path,
            channels:
              parameters.selectedChannels.length > 0
                ? parameters.selectedChannels
                : Object.values(parameters.variantChannelConfigs)
                    .flatMap((config) => config?.selectedChannels || [])
                    .filter((ch, idx, arr) => arr.indexOf(ch) === idx),
            start_time: parameters.timeStart,
            end_time: parameters.timeEnd,
            variants: parameters.variants,
            window_length: parameters.windowLength,
            window_step: parameters.windowStep,
            delay_list: parameters.delays,
          }}
        />
      )}

      {/* Reset Confirmation Dialog */}
      <Dialog
        open={showResetConfirmDialog}
        onOpenChange={setShowResetConfirmDialog}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset All Parameters?</DialogTitle>
            <DialogDescription>
              This will reset all DDA analysis parameters to their default
              values, including:
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1 py-2">
            <li>Selected variants and channel configurations</li>
            <li>Window length and step size</li>
            <li>Time range settings</li>
            <li>Scale parameters</li>
            <li>Delay list configuration</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            This action cannot be undone.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowResetConfirmDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                resetParameters();
                setShowResetConfirmDialog(false);
                toast.success(
                  "Parameters Reset",
                  "All analysis parameters have been reset to defaults.",
                );
              }}
            >
              Reset All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
