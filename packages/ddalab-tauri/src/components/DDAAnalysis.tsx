"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { ApiService } from "@/services/apiService";
import { DDAAnalysisRequest, DDAResult } from "@/types/api";
import { DDAResults } from "@/components/DDAResults";
import { CTChannelPairPicker } from "@/components/CTChannelPairPicker";
import { CDChannelPairPicker } from "@/components/CDChannelPairPicker";
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
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChannelSelector } from "@/components/ChannelSelector";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  BarChart3,
  AlertCircle,
  CheckCircle,
  Clock,
  Cpu,
  Brain,
  RefreshCw,
  Pencil,
  Trash2,
  Cloud,
  X,
} from "lucide-react";
import { TauriService, NotificationType } from "@/services/tauriService";
import { ParameterInput } from "@/components/dda/ParameterInput";
import { DelayPresetManager } from "@/components/dda/DelayPresetManager";
import { InfoTooltip } from "@/components/ui/info-tooltip";
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
import { Download, Upload } from "lucide-react";

interface DDAAnalysisProps {
  apiService: ApiService;
}

interface DDAParameters {
  variants: string[];
  windowLength: number;
  windowStep: number;
  // Delay configuration - list mode only
  delayConfig: {
    mode: "list";
    list?: number[];
  };
  // Legacy parameters for backward compatibility
  scaleMin: number;
  scaleMax: number;
  scaleNum: number;
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
  };
}

export function DDAAnalysis({ apiService }: DDAAnalysisProps) {
  // OPTIMIZED: Use granular selectors to prevent unnecessary re-renders
  // Select only the specific properties we need, not entire objects
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const storedAnalysisParameters = useAppStore(
    (state) => state.dda.analysisParameters,
  );
  const currentAnalysis = useAppStore((state) => state.dda.currentAnalysis);
  const isWorkflowRecording = useAppStore(
    (state) => state.workflowRecording.isRecording,
  );
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis);
  const addAnalysisToHistory = useAppStore(
    (state) => state.addAnalysisToHistory,
  );
  const updateAnalysisParameters = useAppStore(
    (state) => state.updateAnalysisParameters,
  );
  const setDDARunning = useAppStore((state) => state.setDDARunning);
  const incrementActionCount = useAppStore(
    (state) => state.incrementActionCount,
  );
  const isServerReady = useAppStore((state) => state.ui.isServerReady);

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

  // Tab state for navigation
  const [activeTab, setActiveTab] = useState("parameters");

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
    delayConfig: {
      mode: "list",
      list: [7, 10], // Default delays
    },
    scaleMin: 1,
    scaleMax: 20,
    scaleNum: 2,
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
    parallelCores: 1, // Default to serial execution
    nsgResourceConfig: {
      runtimeHours: 1.0,
      cores: 4, // Default to 4 cores for NSG
      nodes: 1,
    },
    expertMode: false, // Default to simple mode
    modelParameters: undefined,
  });

  // Use local parameters directly - no need to merge with store
  const parameters = localParameters;

  const [localIsRunning, setLocalIsRunning] = useState(false); // Local UI state for this component
  const [results, setResults] = useState<DDAResult | null>(null);
  const [analysisName, setAnalysisName] = useState("");

  // Derive state from mutation and progress events
  const progress =
    progressEvent?.progress_percent ||
    (submitAnalysisMutation.isPending ? 50 : 0);
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
  const [autoLoadingResults, setAutoLoadingResults] = useState(false);
  const [resultsFromPersistence, setResultsFromPersistence] = useState(false);
  const [renamingAnalysisId, setRenamingAnalysisId] = useState<string | null>(
    null,
  );
  const [newAnalysisName, setNewAnalysisName] = useState("");

  // NSG submission state
  const [hasNsgCredentials, setHasNsgCredentials] = useState(false);
  const [isSubmittingToNsg, setIsSubmittingToNsg] = useState(false);
  const [nsgError, setNsgError] = useState<string | null>(null);
  const [nsgSubmissionPhase, setNsgSubmissionPhase] = useState<string>("");

  // Import/Export state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importValidation, setImportValidation] = useState<{
    warnings: string[];
    errors: string[];
  } | null>(null);

  // Derive history state from TanStack Query
  const historyError = historyErrorObj
    ? (historyErrorObj as Error).message
    : null;
  const analysisHistoryFromQuery = historyData || [];

  // Calculate estimated time using useMemo to avoid re-running on every render
  const estimatedTime = useMemo(() => {
    const channelCount = parameters.selectedChannels.length;
    const timeRange = parameters.timeEnd - parameters.timeStart;
    const windowCount = Math.floor(timeRange / parameters.windowStep);
    const variantCount = parameters.variants.length;

    // Rough estimate: base time + channels * windows * variants * scale points
    const baseTime = 2; // seconds
    const perOperationTime = 0.01; // seconds per operation
    const totalOperations =
      channelCount * windowCount * variantCount * parameters.scaleNum;
    const estimated = baseTime + totalOperations * perOperationTime;

    return Math.round(estimated);
  }, [
    parameters.selectedChannels.length,
    parameters.timeEnd,
    parameters.timeStart,
    parameters.windowStep,
    parameters.variants.length,
    parameters.scaleNum,
  ]);

  // Preview analysis from history in dedicated window
  const previewAnalysis = useCallback(
    async (analysis: DDAResult) => {
      try {
        // Validate analysis object
        if (!analysis || !analysis.id) {
          console.error("Invalid analysis object:", analysis);
          return;
        }

        console.log("Preview analysis - Using ID for lookup:", analysis.id);

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
          console.warn("No analysis data returned for ID:", analysis.id);
        }
      } catch (error) {
        console.error("Failed to load analysis preview:", error);
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
            console.error("[DDAAnalysis] Error deleting analysis:", error);
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
        console.error("[DDAAnalysis] Error in delete handler:", error);
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
            console.error("[DDAAnalysis] Error renaming analysis:", error);
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
      const isNSGResult = (currentAnalysis as any).source === "nsg";

      if (!isNSGResult) {
        setResults(currentAnalysis);
        setResultsFromPersistence(true);
      } else {
        console.log("[DDAAnalysis] Skipping local results sync for NSG result");
      }
    }
  }, [currentAnalysis, results]);

  // Check for NSG credentials on mount
  useEffect(() => {
    const checkNsgCredentials = async () => {
      if (!TauriService.isTauri()) return;
      try {
        const hasCreds = await TauriService.hasNSGCredentials();
        setHasNsgCredentials(hasCreds);
      } catch (error) {
        console.error("Failed to check NSG credentials:", error);
      }
    };

    checkNsgCredentials();
  }, []);

  // Listen for NSG results being loaded
  useEffect(() => {
    const handleNSGResults = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { jobId, resultsData } = customEvent.detail;

      console.log("[DDAAnalysis] Received NSG results:", {
        jobId,
        resultsData,
      });

      // For NSG results: ONLY update the global store (main Results tab)
      // Do NOT set local results (prevents showing in DDA Analysis → Results sub-tab)
      if (resultsData) {
        setCurrentAnalysis(resultsData);
        console.log(
          "[DDAAnalysis] NSG results loaded to global store (main Results tab only)",
        );
      }
    };

    window.addEventListener("load-nsg-results", handleNSGResults);

    return () => {
      window.removeEventListener("load-nsg-results", handleNSGResults);
    };
  }, [setCurrentAnalysis]);

  const availableVariants = [
    {
      id: "single_timeseries",
      name: "Single Timeseries (ST)",
      description: "Standard temporal dynamics analysis",
    },
    {
      id: "cross_timeseries",
      name: "Cross Timeseries (CT)",
      description: "Inter-channel relationship analysis",
    },
    {
      id: "cross_dynamical",
      name: "Cross Dynamical (CD)",
      description: "Dynamic coupling pattern analysis",
    },
    {
      id: "dynamical_ergodicity",
      name: "Dynamical Ergodicity (DE)",
      description: "Temporal stationarity assessment",
    },
  ];

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

        console.log(
          "[DDAAnalysis] Updating time range - file duration:",
          fileDuration,
          "seconds",
        );

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
        console.warn(
          "[DDAAnalysis] File loaded but duration not available yet:",
          selectedFile.file_path,
        );
      }
    }
  }, [selectedFile?.file_path, selectedFile?.duration]); // Depend on both file path and duration

  const runAnalysis = async () => {
    if (!selectedFile || parameters.selectedChannels.length === 0) {
      // Can't use setError directly anymore, error comes from mutation
      console.error("Please select a file and at least one channel");
      return;
    }

    // Sync local parameters to store when running analysis
    updateAnalysisParameters({
      variants: parameters.variants,
      windowLength: parameters.windowLength,
      windowStep: parameters.windowStep,
      scaleMin: parameters.scaleMin,
      scaleMax: parameters.scaleMax,
      scaleNum: parameters.scaleNum,
    });

    // Convert CT channel pairs from names to indices
    const ctChannelPairs: [number, number][] | undefined =
      parameters.ctChannelPairs.length > 0 && selectedFile
        ? parameters.ctChannelPairs
            .map(([ch1, ch2]) => {
              const idx1 = selectedFile!.channels.indexOf(ch1);
              const idx2 = selectedFile!.channels.indexOf(ch2);
              return [idx1, idx2] as [number, number];
            })
            .filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1)
        : undefined;

    // Convert CD channel pairs from names to indices (directed pairs)
    const cdChannelPairs: [number, number][] | undefined =
      parameters.cdChannelPairs.length > 0 && selectedFile
        ? parameters.cdChannelPairs
            .map(([from, to]) => {
              const fromIdx = selectedFile!.channels.indexOf(from);
              const toIdx = selectedFile!.channels.indexOf(to);
              return [fromIdx, toIdx] as [number, number];
            })
            .filter(([fromIdx, toIdx]) => fromIdx !== -1 && toIdx !== -1)
        : undefined;

    // Prepare the analysis request
    const request: DDAAnalysisRequest = {
      file_path: selectedFile.file_path,
      channels: parameters.selectedChannels,
      start_time: parameters.timeStart,
      end_time: parameters.timeEnd,
      variants: parameters.variants,
      window_length: parameters.windowLength,
      window_step: parameters.windowStep,
      scale_min: parameters.scaleMin,
      scale_max: parameters.scaleMax,
      scale_num: parameters.scaleNum,
      ct_window_length: parameters.ctWindowLength,
      ct_window_step: parameters.ctWindowStep,
      ct_channel_pairs: ctChannelPairs,
      cd_channel_pairs: cdChannelPairs,
    };

    // Convert channel names to indices for comparison
    const channelIndices = parameters.selectedChannels.map((ch) =>
      typeof ch === "string" ? selectedFile!.channels.indexOf(ch) : ch,
    );

    console.log("📋 [LOCAL] DDA Analysis Parameters:");
    console.log(`   File: ${selectedFile.file_path}`);
    console.log(`   Sample rate: ${selectedFile.sample_rate} Hz`);
    console.log(`   Channels (names): [${request.channels.join(", ")}]`);
    console.log(`   Channels (indices): [${channelIndices.join(", ")}]`);
    console.log(
      `   Time range: ${request.start_time} - ${request.end_time} seconds`,
    );
    console.log(
      `   Window: length=${request.window_length}, step=${request.window_step}`,
    );
    console.log(
      `   Scale: min=${request.scale_min}, max=${request.scale_max}, num=${request.scale_num}`,
    );
    if (ctChannelPairs && ctChannelPairs.length > 0) {
      console.log(
        `   CT channel pairs: ${ctChannelPairs
          .map(([a, b]) => `[${a}, ${b}]`)
          .join(", ")}`,
      );
    }
    if (cdChannelPairs && cdChannelPairs.length > 0) {
      console.log(
        `   CD channel pairs (directed): ${cdChannelPairs
          .map(([from, to]) => `[${from} → ${to}]`)
          .join(", ")}`,
      );
    }

    // Record DDA parameters if recording is active
    if (isWorkflowRecording) {
      try {
        const paramAction = createSetDDAParametersAction(
          parameters.scaleMin, // lag (using scaleMin as proxy)
          4, // dimension (default)
          parameters.windowLength,
          parameters.windowStep,
        );
        await recordAction(paramAction);
        incrementActionCount();
        console.log("[WORKFLOW] Recorded DDA parameters");
      } catch (error) {
        console.error("[WORKFLOW] Failed to record DDA parameters:", error);
      }
    }

    // Submit analysis using mutation
    setLocalIsRunning(true);
    setDDARunning(true);

    submitAnalysisMutation.mutate(request, {
      onSuccess: (result) => {
        // Add custom name to result if provided
        const resultWithName = analysisName.trim()
          ? { ...result, name: analysisName.trim() }
          : result;

        setResults(resultWithName);
        setCurrentAnalysis(resultWithName);
        addAnalysisToHistory(resultWithName);
        setLocalIsRunning(false);
        setDDARunning(false);
        setAnalysisName(""); // Clear name after successful analysis
        setResultsFromPersistence(false); // Mark as fresh analysis, not from persistence

        // Record DDA analysis execution if recording is active
        if (isWorkflowRecording && selectedFile) {
          // Convert channel names to their actual indices in the file's channel list
          const channelIndices = parameters.selectedChannels
            .map((channelName) => selectedFile!.channels.indexOf(channelName))
            .filter((idx) => idx !== -1); // Remove any channels not found

          console.log(
            "[WORKFLOW] Recording DDA analysis with channel indices:",
            channelIndices,
          );
          const analysisAction = createRunDDAAnalysisAction(
            result.id,
            channelIndices,
          );
          recordAction(analysisAction)
            .then(() => {
              incrementActionCount();
              console.log("[WORKFLOW] Recorded DDA analysis execution");
            })
            .catch((error) => {
              console.error("[WORKFLOW] Failed to record DDA analysis:", error);
            });
        }

        // Save to history asynchronously (non-blocking)
        saveToHistoryMutation.mutate(resultWithName, {
          onError: (err) => {
            console.error("Background save to history failed:", err);
          },
        });
      },
      onError: (err) => {
        console.error("❌ DDA analysis failed:", err);
        setLocalIsRunning(false);
        setDDARunning(false);

        // Extract detailed error message for logging
        let errorMessage = "Analysis failed";
        if (err instanceof Error) {
          errorMessage = err.message;
          console.error("📤 Error name:", err.name);
          console.error("📤 Error message:", err.message);
          console.error("📤 Error stack:", err.stack);
        } else {
          console.error("📤 Non-Error object thrown:", err);
        }

        console.error("📤 Analysis request parameters:", {
          file_path: selectedFile?.file_path,
          channels: parameters.selectedChannels,
          time_range: [parameters.timeStart, parameters.timeEnd],
          variants: parameters.variants,
        });
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

    if (!selectedFile || parameters.selectedChannels.length === 0) {
      setNsgError("Please select a file and at least one channel");
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
      const request = {
        file_path: selectedFile!.file_path,
        channels:
          parameters.selectedChannels.length > 0
            ? parameters.selectedChannels.map((ch) => {
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
          scale_min: parameters.scaleMin,
          scale_max: parameters.scaleMax,
          scale_num: parameters.scaleNum,
          delay_list: parameters.delayConfig.list,
        },
        model_parameters:
          parameters.expertMode && parameters.modelParameters
            ? parameters.modelParameters
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

      console.log("📋 [NSG] DDA Analysis Parameters:");
      console.log(`   File: ${selectedFile.file_path}`);
      console.log(`   Sample rate: ${selectedFile.sample_rate} Hz`);
      console.log(
        `   Channels (indices): [${request.channels?.join(", ") || ""}]`,
      );
      console.log(`   Channels (names): [${channelNames.join(", ")}]`);
      console.log(
        `   Time range: ${request.time_range.start} - ${request.time_range.end} seconds`,
      );
      console.log(
        `   Window: length=${request.window_parameters.window_length}, step=${request.window_parameters.window_step}`,
      );
      console.log(
        `   Scale: min=${request.scale_parameters.scale_min}, max=${request.scale_parameters.scale_max}, num=${request.scale_parameters.scale_num}`,
      );

      setNsgSubmissionPhase("Creating job in database...");

      // Create NSG job with PY_EXPANSE tool (resource params not used by NSG)
      const jobId = await TauriService.createNSGJob(
        "PY_EXPANSE",
        request,
        selectedFile.file_path,
      );

      console.log("[NSG] Job created with ID:", jobId);

      setNsgSubmissionPhase(
        "Uploading file to NSG (this may take a few minutes for large files)...",
      );

      // Submit the job to NSG
      await TauriService.submitNSGJob(jobId);

      console.log("[NSG] Job submitted successfully");

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
      console.error("[NSG] Submission error:", error);
      console.error("[NSG] Error details:", {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        error,
      });
      setNsgError(
        error instanceof Error ? error.message : "Failed to submit job to NSG",
      );
      setNsgSubmissionPhase("");
      setIsSubmittingToNsg(false);
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
      delayConfig: {
        mode: "list",
        list: [7, 10], // Default delays
      },
      scaleMin: 1,
      scaleMax: 20,
      scaleNum: 2,
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
      parallelCores: 1,
      nsgResourceConfig: {
        runtimeHours: 1.0,
        cores: 4,
        nodes: 1,
      },
      expertMode: false,
      modelParameters: undefined,
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
          console.warn("[Export] Failed to compute file hash:", error);
          // Continue with empty hash
        }
      }

      const config = exportDDAConfig(
        {
          variants: parameters.variants,
          windowLength: parameters.windowLength,
          windowStep: parameters.windowStep,
          delayConfig: parameters.delayConfig,
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
      console.error("[Export] Failed to export configuration:", error);
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
      console.error("[Import] Failed to import configuration:", error);
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
    <div className="h-full flex flex-col overflow-hidden">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex items-center justify-between flex-shrink-0 pb-4">
          <TabsList>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
          </TabsList>

          <div className="flex items-center space-x-2">
            <Input
              placeholder="Analysis name (optional)"
              value={analysisName}
              onChange={(e) => setAnalysisName(e.target.value)}
              disabled={localIsRunning}
              className="w-48"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleImportConfig}
              disabled={localIsRunning}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportConfig}
              disabled={localIsRunning}
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={resetParameters}>
              Reset
            </Button>
            <Button
              onClick={runAnalysis}
              disabled={
                localIsRunning || parameters.selectedChannels.length === 0
              }
              className="min-w-[120px]"
            >
              {localIsRunning ? (
                <>
                  <Cpu className="h-4 w-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Run DDA
                </>
              )}
            </Button>
            {TauriService.isTauri() && hasNsgCredentials && (
              <Button
                onClick={submitToNSG}
                disabled={
                  isSubmittingToNsg ||
                  localIsRunning ||
                  parameters.selectedChannels.length === 0
                }
                variant="outline"
                className="min-w-[140px]"
              >
                {isSubmittingToNsg ? (
                  <>
                    <Cloud className="h-4 w-4 mr-2 animate-pulse" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Cloud className="h-4 w-4 mr-2" />
                    Submit to NSG
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

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

        <TabsContent
          value="parameters"
          className="flex-1 min-h-0 space-y-4 overflow-y-auto"
        >
          {/* Analysis Status - only show for active/recent analysis, not restored from persistence */}
          {(localIsRunning ||
            autoLoadingResults ||
            (results && !resultsFromPersistence)) && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {localIsRunning ? (
                        <Cpu className="h-4 w-4 animate-spin text-blue-600" />
                      ) : autoLoadingResults ? (
                        <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                      ) : results ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span className="text-sm font-medium">
                        {localIsRunning
                          ? analysisStatus
                          : autoLoadingResults
                            ? "Loading previous analysis results..."
                            : analysisStatus}
                      </span>
                    </div>
                    {localIsRunning && (
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>~{estimatedTime}s estimated</span>
                      </div>
                    )}
                  </div>

                  {localIsRunning && (
                    <Progress value={progress} className="w-full" />
                  )}

                  {error && (
                    <div className="flex items-center space-x-2 text-red-600">
                      <AlertCircle className="h-4 w-4" />
                      <span className="text-sm">{error}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Algorithm Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Algorithm Selection</CardTitle>
                <CardDescription>
                  Choose DDA variants to compute
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {availableVariants.map((variant) => (
                  <div key={variant.id} className="flex items-start space-x-3">
                    <Checkbox
                      checked={parameters.variants.includes(variant.id)}
                      onCheckedChange={(checked) => {
                        const newVariants = checked
                          ? [...parameters.variants, variant.id]
                          : parameters.variants.filter((v) => v !== variant.id);
                        setLocalParameters((prev) => ({
                          ...prev,
                          variants: newVariants,
                        }));
                      }}
                      disabled={localIsRunning}
                    />
                    <div className="flex-1 min-w-0">
                      <Label className="text-sm font-medium">
                        {variant.name}
                      </Label>
                      <p className="text-xs text-muted-foreground mt-1">
                        {variant.description}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Time Range */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Time Range</CardTitle>
                <CardDescription>Analysis time window</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-sm">Start Time (s)</Label>
                  <Input
                    type="number"
                    value={parameters.timeStart}
                    onChange={(e) =>
                      setLocalParameters((prev) => ({
                        ...prev,
                        timeStart: Math.max(0, parseFloat(e.target.value) || 0),
                      }))
                    }
                    disabled={localIsRunning}
                    min="0"
                    max={selectedFile?.duration}
                    step="0.1"
                  />
                </div>
                <div>
                  <Label className="text-sm">End Time (s)</Label>
                  <Input
                    type="number"
                    value={parameters.timeEnd}
                    onChange={(e) => {
                      const inputValue = parseFloat(e.target.value) || 0;
                      const maxDuration = selectedFile?.duration || Infinity;
                      setLocalParameters((prev) => ({
                        ...prev,
                        timeEnd: Math.min(
                          maxDuration,
                          Math.max(prev.timeStart + 0.1, inputValue),
                        ),
                      }));
                    }}
                    disabled={localIsRunning}
                    min={parameters.timeStart + 1}
                    max={selectedFile?.duration}
                    step="0.1"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Duration:{" "}
                  {(parameters.timeEnd - parameters.timeStart).toFixed(1)}s
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Window Parameters */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Window Parameters</CardTitle>
                  <InfoTooltip
                    content={
                      <div className="space-y-1">
                        <p className="font-semibold">Window Parameters</p>
                        <p>
                          <strong>Window Length:</strong> Number of data points
                          in each analysis window
                        </p>
                        <p>
                          <strong>Window Step:</strong> Number of points to
                          shift between consecutive windows
                        </p>
                        <p className="text-xs mt-2">
                          Smaller steps = higher temporal resolution but longer
                          computation time
                        </p>
                      </div>
                    }
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ParameterInput
                  label="Window Length"
                  value={parameters.windowLength}
                  onChange={(value) =>
                    setLocalParameters((prev) => ({
                      ...prev,
                      windowLength: value,
                    }))
                  }
                  sampleRate={selectedFile?.sample_rate || 256}
                  disabled={localIsRunning}
                  min={50}
                  max={500}
                  tooltip="Number of samples in each analysis window"
                />
                <ParameterInput
                  label="Window Step"
                  value={parameters.windowStep}
                  onChange={(value) =>
                    setLocalParameters((prev) => ({
                      ...prev,
                      windowStep: value,
                    }))
                  }
                  sampleRate={selectedFile?.sample_rate || 256}
                  disabled={localIsRunning}
                  min={1}
                  max={50}
                  tooltip="Shift between consecutive windows (smaller = more overlap)"
                />
              </CardContent>
            </Card>

            {/* CT-Specific Parameters */}
            {parameters.variants.includes("cross_timeseries") && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">CT Parameters</CardTitle>
                    <InfoTooltip
                      content={
                        <div className="space-y-1">
                          <p className="font-semibold">
                            Cross-Timeseries Parameters
                          </p>
                          <p>
                            Optional custom window settings for information flow
                            across time series. If not set, uses standard window
                            parameters.
                          </p>
                        </div>
                      }
                    />
                  </div>
                  <CardDescription>
                    Cross-Timeseries specific settings (optional)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm mb-2 block">
                      CT Window Length (optional)
                    </Label>
                    {parameters.ctWindowLength === undefined ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setLocalParameters((prev) => ({
                            ...prev,
                            ctWindowLength: prev.windowLength,
                          }))
                        }
                        disabled={localIsRunning}
                      >
                        Set Custom CT Window Length
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <ParameterInput
                          label=""
                          value={parameters.ctWindowLength}
                          onChange={(value) =>
                            setLocalParameters((prev) => ({
                              ...prev,
                              ctWindowLength: value,
                            }))
                          }
                          sampleRate={selectedFile?.sample_rate || 256}
                          disabled={localIsRunning}
                          min={10}
                          max={1000}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLocalParameters((prev) => ({
                              ...prev,
                              ctWindowLength: undefined,
                            }))
                          }
                          disabled={localIsRunning}
                        >
                          Use Standard Window Length
                        </Button>
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-sm mb-2 block">
                      CT Window Step (optional)
                    </Label>
                    {parameters.ctWindowStep === undefined ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setLocalParameters((prev) => ({
                            ...prev,
                            ctWindowStep: prev.windowStep,
                          }))
                        }
                        disabled={localIsRunning}
                      >
                        Set Custom CT Window Step
                      </Button>
                    ) : (
                      <div className="space-y-2">
                        <ParameterInput
                          label=""
                          value={parameters.ctWindowStep}
                          onChange={(value) =>
                            setLocalParameters((prev) => ({
                              ...prev,
                              ctWindowStep: value,
                            }))
                          }
                          sampleRate={selectedFile?.sample_rate || 256}
                          disabled={localIsRunning}
                          min={1}
                          max={100}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLocalParameters((prev) => ({
                              ...prev,
                              ctWindowStep: undefined,
                            }))
                          }
                          disabled={localIsRunning}
                        >
                          Use Standard Window Step
                        </Button>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Label className="text-sm">
                        Channel Pairs ({parameters.ctChannelPairs.length})
                      </Label>
                      {parameters.ctChannelPairs.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLocalParameters((prev) => ({
                              ...prev,
                              ctChannelPairs: [],
                            }))
                          }
                          disabled={localIsRunning}
                        >
                          Clear All
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Click two channels below to create a pair
                    </p>

                    {/* Display existing pairs */}
                    {parameters.ctChannelPairs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3 p-2 bg-muted/50 rounded-md">
                        {parameters.ctChannelPairs.map(([ch1, ch2], idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="cursor-pointer hover:bg-destructive/80"
                            onClick={() => {
                              setLocalParameters((prev) => ({
                                ...prev,
                                ctChannelPairs: prev.ctChannelPairs.filter(
                                  (_, i) => i !== idx,
                                ),
                              }));
                            }}
                          >
                            {ch1} ⟷ {ch2} ×
                          </Badge>
                        ))}
                      </div>
                    )}

                    {/* Channel pair picker */}
                    {selectedFile && (
                      <CTChannelPairPicker
                        channels={selectedFile.channels}
                        onPairAdded={(ch1, ch2) => {
                          setLocalParameters((prev) => ({
                            ...prev,
                            ctChannelPairs: [
                              ...prev.ctChannelPairs,
                              [ch1, ch2],
                            ],
                          }));
                        }}
                        disabled={localIsRunning}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* CD-Specific Parameters */}
            {parameters.variants.includes("cross_dynamical") && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">CD Parameters</CardTitle>
                  <CardDescription>
                    Cross-Dynamical specific settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-sm font-semibold">
                      Channel Pairs (Directed)
                    </Label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Select directed channel pairs for Cross-Dynamical analysis
                      (From → To)
                    </p>

                    {/* Display current pairs */}
                    {parameters.cdChannelPairs.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {parameters.cdChannelPairs.map(([from, to], idx) => (
                          <Badge
                            key={idx}
                            variant="secondary"
                            className="cursor-pointer hover:bg-destructive/20"
                            onClick={() => {
                              if (!localIsRunning) {
                                setLocalParameters((prev) => ({
                                  ...prev,
                                  cdChannelPairs: prev.cdChannelPairs.filter(
                                    (_, i) => i !== idx,
                                  ),
                                }));
                              }
                            }}
                          >
                            {from} → {to}
                            <X className="ml-1 h-3 w-3" />
                          </Badge>
                        ))}
                      </div>
                    )}

                    {parameters.cdChannelPairs.length === 0 && (
                      <p className="text-sm text-amber-600 mb-2">
                        No directed pairs selected. Please add at least one
                        pair.
                      </p>
                    )}

                    {/* Channel pair picker */}
                    {selectedFile && (
                      <CDChannelPairPicker
                        channels={selectedFile.channels}
                        onPairAdded={(from, to) => {
                          setLocalParameters((prev) => ({
                            ...prev,
                            cdChannelPairs: [
                              ...prev.cdChannelPairs,
                              [from, to],
                            ],
                          }));
                        }}
                        disabled={localIsRunning}
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Expert Mode Toggle */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      Configuration Mode
                    </CardTitle>
                    <CardDescription>
                      {parameters.expertMode
                        ? "Advanced settings for delays and MODEL parameters"
                        : "Simple mode uses default settings (delays: [7, 10], MODEL: 1 2 10)"}
                    </CardDescription>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-sm font-medium">Expert Mode</span>
                    <input
                      type="checkbox"
                      checked={parameters.expertMode}
                      onChange={(e) => {
                        const expertMode = e.target.checked;
                        setLocalParameters((prev) => ({
                          ...prev,
                          expertMode,
                          modelParameters: expertMode
                            ? { dm: 4, order: 4, nr_tau: 2 }
                            : undefined,
                        }));
                      }}
                      disabled={localIsRunning}
                      className="w-4 h-4"
                    />
                  </label>
                </div>
              </CardHeader>
            </Card>

            {/* Delay Parameters - Only in Expert Mode */}
            {parameters.expertMode && (
              <DelayPresetManager
                value={parameters.delayConfig}
                onChange={(config) => {
                  setLocalParameters((prev) => ({
                    ...prev,
                    delayConfig: config,
                    // Sync legacy params for backward compatibility
                    scaleMin: config.list?.[0] || 1,
                    scaleMax: config.list?.[config.list.length - 1] || 20,
                    scaleNum: config.list?.length || 0,
                  }));
                }}
                disabled={localIsRunning}
                sampleRate={selectedFile?.sample_rate || 256}
              />
            )}

            {/* MODEL Parameters - Only in Expert Mode */}
            {parameters.expertMode && parameters.modelParameters && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">MODEL Parameters</CardTitle>
                  <CardDescription>
                    Advanced DDA algorithm parameters (defaults: dm=4, order=4,
                    nr_tau=2)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="dm" className="text-sm">
                        Embedding Dimension (dm)
                      </Label>
                      <Input
                        id="dm"
                        type="number"
                        min="1"
                        max="10"
                        value={parameters.modelParameters.dm}
                        onChange={(e) => {
                          const dm = parseInt(e.target.value) || 4;
                          setLocalParameters((prev) => ({
                            ...prev,
                            modelParameters: {
                              ...prev.modelParameters!,
                              dm,
                            },
                          }));
                        }}
                        disabled={localIsRunning}
                      />
                    </div>
                    <div>
                      <Label htmlFor="order" className="text-sm">
                        Polynomial Order
                      </Label>
                      <Input
                        id="order"
                        type="number"
                        min="1"
                        max="10"
                        value={parameters.modelParameters.order}
                        onChange={(e) => {
                          const order = parseInt(e.target.value) || 4;
                          setLocalParameters((prev) => ({
                            ...prev,
                            modelParameters: {
                              ...prev.modelParameters!,
                              order,
                            },
                          }));
                        }}
                        disabled={localIsRunning}
                      />
                    </div>
                    <div>
                      <Label htmlFor="nr_tau" className="text-sm">
                        Number of Tau (nr_tau)
                      </Label>
                      <Input
                        id="nr_tau"
                        type="number"
                        min="1"
                        max="10"
                        value={parameters.modelParameters.nr_tau}
                        onChange={(e) => {
                          const nr_tau = parseInt(e.target.value) || 2;
                          setLocalParameters((prev) => ({
                            ...prev,
                            modelParameters: {
                              ...prev.modelParameters!,
                              nr_tau,
                            },
                          }));
                        }}
                        disabled={localIsRunning}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Channel Selection */}
          <ChannelSelector
            channels={selectedFile.channels}
            selectedChannels={parameters.selectedChannels}
            onSelectionChange={(channels) => {
              setLocalParameters((prev) => ({
                ...prev,
                selectedChannels: channels,
              }));
            }}
            label="Channel Selection"
            description="Select channels for DDA analysis"
            variant="default"
            maxHeight="max-h-40"
          />

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
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
