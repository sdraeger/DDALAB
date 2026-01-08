"use client";

import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { TauriService, NotificationType } from "@/services/tauriService";
import { ApiService } from "@/services/apiService";
import { loggers } from "@/lib/logger";
import { toast } from "@/components/ui/toaster";
import { DDA_ANALYSIS } from "@/lib/constants";
import type { DDAAnalysisRequest, DDAResult, EDFFileInfo } from "@/types/api";

interface DDAParameters {
  variants: string[];
  windowLength: number;
  windowStep: number;
  delays: number[];
  timeStart: number;
  timeEnd: number;
  selectedChannels: string[];
  preprocessing: {
    highpass?: number;
    lowpass?: number;
    notch?: number[];
  };
  ctWindowLength?: number;
  ctWindowStep?: number;
  ctChannelPairs: [string, string][];
  cdChannelPairs: [string, string][];
  variantChannelConfigs: {
    [variantId: string]: {
      selectedChannels?: string[];
      ctChannelPairs?: [string, string][];
      cdChannelPairs?: [string, string][];
    };
  };
  parallelCores?: number;
  nsgResourceConfig?: {
    runtimeHours?: number;
    cores?: number;
    nodes?: number;
  };
  expertMode: boolean;
  modelParameters?: {
    dm: number;
    order: number;
    nr_tau: number;
    encoding?: number[];
  };
}

interface UseDDASubmissionOptions {
  apiService: ApiService;
  selectedFile: EDFFileInfo | null;
  parameters: DDAParameters;
  appExpertMode: boolean;
  analysisName: string;
  isServerConnected: boolean;
  hasNsgCredentials: boolean;
  onAnalysisComplete: (result: DDAResult) => void;
  onError?: (error: Error) => void;
  updateAnalysisParameters: (
    params: Partial<{
      variants: string[];
      windowLength: number;
      windowStep: number;
      delays: number[];
    }>,
  ) => void;
  setDDARunning: (running: boolean) => void;
}

interface SubmissionState {
  isRunning: boolean;
  isCancelling: boolean;
  isSubmittingToNsg: boolean;
  isSubmittingToServer: boolean;
  nsgError: string | null;
  serverError: string | null;
  nsgSubmissionPhase: string;
  serverSubmissionPhase: string;
}

export function useDDASubmission({
  apiService,
  selectedFile,
  parameters,
  appExpertMode,
  analysisName,
  isServerConnected,
  hasNsgCredentials,
  onAnalysisComplete,
  onError,
  updateAnalysisParameters,
  setDDARunning,
}: UseDDASubmissionOptions) {
  const [state, setState] = useState<SubmissionState>({
    isRunning: false,
    isCancelling: false,
    isSubmittingToNsg: false,
    isSubmittingToServer: false,
    nsgError: null,
    serverError: null,
    nsgSubmissionPhase: "",
    serverSubmissionPhase: "",
  });

  const analysisStartTimeRef = useRef<number | null>(null);
  const minProgressDisplayTimeRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Helper to extract all channels from variant configurations
  const extractAllChannels = useCallback((): Set<string> => {
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
    return allChannels;
  }, [parameters.variants, parameters.variantChannelConfigs]);

  // Helper to hide progress with minimum display time
  const hideProgressBar = useCallback(
    (callback: () => void) => {
      const elapsed = Date.now() - (analysisStartTimeRef.current || 0);
      const remainingTime = Math.max(
        0,
        DDA_ANALYSIS.MIN_PROGRESS_DISPLAY_TIME - elapsed,
      );

      if (remainingTime > 0) {
        minProgressDisplayTimeRef.current = setTimeout(() => {
          setState((prev) => ({ ...prev, isRunning: false }));
          setDDARunning(false);
          callback();
        }, remainingTime);
      } else {
        setState((prev) => ({ ...prev, isRunning: false }));
        setDDARunning(false);
        callback();
      }
    },
    [setDDARunning],
  );

  // Run local DDA analysis
  const runAnalysis = useCallback(
    async (submitMutation: {
      mutate: (request: DDAAnalysisRequest, options: any) => void;
    }): Promise<string | null> => {
      if (!selectedFile) {
        loggers.dda.error("Please select a file");
        return "Please select a file";
      }

      const allChannels = extractAllChannels();

      if (allChannels.size === 0) {
        return "Please configure channels for at least one variant before running analysis";
      }

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
                const idx1 = selectedFile.channels.indexOf(ch1);
                const idx2 = selectedFile.channels.indexOf(ch2);
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
                const fromIdx = selectedFile.channels.indexOf(from);
                const toIdx = selectedFile.channels.indexOf(to);
                return [fromIdx, toIdx] as [number, number];
              })
              .filter(([fromIdx, toIdx]) => fromIdx !== -1 && toIdx !== -1)
          : undefined;

      // Convert channel names to indices
      const channelNames = Array.from(allChannels);
      const channelIndices = channelNames
        .map((ch) => selectedFile.channels.indexOf(ch))
        .filter((idx) => idx !== -1);

      // Build variant_configs from variantChannelConfigs
      const variantConfigs: { [variantId: string]: any } = {};

      parameters.variants.forEach((variantId) => {
        const config = parameters.variantChannelConfigs[variantId];
        if (!config) return;

        const variantConfig: any = {};

        if (config.selectedChannels && config.selectedChannels.length > 0) {
          variantConfig.selectedChannels = config.selectedChannels
            .map((ch) => selectedFile.channels.indexOf(ch))
            .filter((idx) => idx !== -1);
        }

        if (config.ctChannelPairs && config.ctChannelPairs.length > 0) {
          variantConfig.ctChannelPairs = config.ctChannelPairs
            .map(([ch1, ch2]) => {
              const idx1 = selectedFile.channels.indexOf(ch1);
              const idx2 = selectedFile.channels.indexOf(ch2);
              return [idx1, idx2] as [number, number];
            })
            .filter(([idx1, idx2]) => idx1 !== -1 && idx2 !== -1);
        }

        if (config.cdChannelPairs && config.cdChannelPairs.length > 0) {
          variantConfig.cdChannelPairs = config.cdChannelPairs
            .map(([from, to]) => {
              const fromIdx = selectedFile.channels.indexOf(from);
              const toIdx = selectedFile.channels.indexOf(to);
              return [fromIdx, toIdx] as [number, number];
            })
            .filter(([fromIdx, toIdx]) => fromIdx !== -1 && toIdx !== -1);
        }

        if (Object.keys(variantConfig).length > 0) {
          variantConfigs[variantId] = variantConfig;
        }
      });

      // Prepare the analysis request
      const request: DDAAnalysisRequest = {
        file_path: selectedFile.file_path,
        channels: channelIndices.map((idx) => idx.toString()),
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
      });

      // Show progress bar immediately
      analysisStartTimeRef.current = Date.now();
      flushSync(() => {
        setState((prev) => ({ ...prev, isRunning: true }));
        setDDARunning(true);
      });

      // Submit analysis using mutation
      submitMutation.mutate(request, {
        onSuccess: (result: DDAResult) => {
          const resultWithChannels = {
            ...result,
            channels: channelNames,
            name: analysisName.trim() || result.name,
          };

          loggers.dda.info("Analysis complete", {
            id: resultWithChannels.id,
            filePath: resultWithChannels.file_path,
          });

          hideProgressBar(() => {
            onAnalysisComplete(resultWithChannels);
          });
        },
        onError: (err: Error) => {
          loggers.dda.error("DDA analysis failed", {
            error: err,
            errorMessage: err.message,
          });
          hideProgressBar(() => {
            onError?.(err);
          });
        },
      });

      return null; // No validation error
    },
    [
      selectedFile,
      parameters,
      analysisName,
      extractAllChannels,
      hideProgressBar,
      updateAnalysisParameters,
      setDDARunning,
      onAnalysisComplete,
      onError,
    ],
  );

  // Submit to NSG
  const submitToNSG = useCallback(async (): Promise<string | null> => {
    if (!TauriService.isTauri()) {
      const error =
        "NSG submission is only available in the Tauri desktop application";
      setState((prev) => ({ ...prev, nsgError: error }));
      return error;
    }

    const allChannels = extractAllChannels();

    if (!selectedFile || allChannels.size === 0) {
      const error =
        "Please select a file and configure channels for at least one variant";
      setState((prev) => ({ ...prev, nsgError: error }));
      return error;
    }

    if (!hasNsgCredentials) {
      const error = "Please configure NSG credentials in Settings first";
      setState((prev) => ({ ...prev, nsgError: error }));
      return error;
    }

    try {
      setState((prev) => ({
        ...prev,
        isSubmittingToNsg: true,
        nsgError: null,
        nsgSubmissionPhase: "Preparing job parameters...",
      }));

      const channelArray = Array.from(allChannels);
      const request = {
        file_path: selectedFile.file_path,
        channels:
          channelArray.length > 0
            ? channelArray.map((ch) => {
                const channelIndex = selectedFile.channels.indexOf(ch);
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
        parallel_cores: parameters.nsgResourceConfig?.cores || 4,
        resource_config: parameters.nsgResourceConfig,
      };

      loggers.nsg.info("NSG DDA Analysis Parameters", {
        file: selectedFile.file_path,
        sampleRate: selectedFile.sample_rate,
        channelIndices: request.channels,
      });

      setState((prev) => ({
        ...prev,
        nsgSubmissionPhase: "Creating job in database...",
      }));

      const jobId = await TauriService.createNSGJob(
        "PY_EXPANSE",
        request,
        selectedFile.file_path,
      );

      loggers.nsg.info("Job created", { jobId });

      setState((prev) => ({
        ...prev,
        nsgSubmissionPhase:
          "Uploading file to NSG (this may take a few minutes for large files)...",
      }));

      await TauriService.submitNSGJob(jobId);

      loggers.nsg.info("Job submitted successfully");

      setState((prev) => ({
        ...prev,
        nsgSubmissionPhase: "",
        isSubmittingToNsg: false,
      }));

      await TauriService.createNotification(
        "NSG Job Submitted",
        `Job successfully submitted to Neuroscience Gateway. Job ID: ${jobId.substring(0, 8)}...`,
        NotificationType.Success,
        "navigate_nsg_manager",
        { jobId },
      );

      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to submit job to NSG";
      loggers.nsg.error("Submission error", { error });
      setState((prev) => ({
        ...prev,
        nsgError: errorMessage,
        nsgSubmissionPhase: "",
        isSubmittingToNsg: false,
      }));
      return errorMessage;
    }
  }, [
    selectedFile,
    parameters,
    appExpertMode,
    hasNsgCredentials,
    extractAllChannels,
  ]);

  // Submit to remote server
  const submitToServer = useCallback(async (): Promise<string | null> => {
    if (!TauriService.isTauri()) {
      const error =
        "Server submission is only available in the Tauri desktop application";
      setState((prev) => ({ ...prev, serverError: error }));
      return error;
    }

    if (!isServerConnected) {
      const error =
        "Not connected to a remote server. Connect in Settings → Sync first.";
      setState((prev) => ({ ...prev, serverError: error }));
      return error;
    }

    const allChannels = extractAllChannels();

    if (!selectedFile || allChannels.size === 0) {
      const error =
        "Please select a file and configure channels for at least one variant";
      setState((prev) => ({ ...prev, serverError: error }));
      return error;
    }

    try {
      setState((prev) => ({
        ...prev,
        isSubmittingToServer: true,
        serverError: null,
        serverSubmissionPhase: "Preparing job parameters...",
      }));

      const { invoke } = await import("@tauri-apps/api/core");

      const ctConfig = parameters.variantChannelConfigs["cross_timeseries"];
      const ctPairs: [string, string][] = ctConfig?.ctChannelPairs || [];

      const cdConfig = parameters.variantChannelConfigs["cross_dynamical"];
      const cdPairs: [string, string][] = cdConfig?.cdChannelPairs || [];

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
      });

      setState((prev) => ({
        ...prev,
        serverSubmissionPhase: "Submitting job to server...",
      }));

      const response = await invoke<{
        job_id: string;
        status: string;
        message: string;
      }>("job_submit_server_file", {
        serverPath: selectedFile.file_path,
        parameters: jobParameters,
      });

      loggers.api.info("Server job submitted successfully", { response });

      setState((prev) => ({
        ...prev,
        serverSubmissionPhase: "",
        isSubmittingToServer: false,
      }));

      await TauriService.createNotification(
        "Server Job Submitted",
        `Job successfully submitted to remote server. Job ID: ${response.job_id.substring(0, 8)}...`,
        NotificationType.Success,
      );

      toast.success(
        "Job Submitted",
        `Analysis submitted to server. Job ID: ${response.job_id.substring(0, 8)}...`,
      );

      return null;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to submit job to server";
      loggers.api.error("Server submission error", { error });
      setState((prev) => ({
        ...prev,
        serverError: errorMessage,
        serverSubmissionPhase: "",
        isSubmittingToServer: false,
      }));
      return errorMessage;
    }
  }, [selectedFile, parameters, isServerConnected, extractAllChannels]);

  // Cancel running analysis
  const cancelAnalysis = useCallback(async (): Promise<boolean> => {
    setState((prev) => ({ ...prev, isCancelling: true }));
    try {
      const result = await apiService.cancelDDAAnalysis();
      if (result.success) {
        loggers.dda.info("Analysis cancelled", {
          analysisId: result.cancelled_analysis_id,
        });
        toast.info("Analysis Cancelled", "DDA analysis was cancelled");
        setState((prev) => ({
          ...prev,
          isRunning: false,
          isCancelling: false,
        }));
        setDDARunning(false);
        return true;
      } else {
        loggers.dda.warn("Failed to cancel", { message: result.message });
        toast.error(
          "Cancel Failed",
          result.message || "Could not cancel analysis",
        );
        setState((prev) => ({ ...prev, isCancelling: false }));
        return false;
      }
    } catch (error) {
      loggers.dda.error("Error cancelling", { error });
      toast.error(
        "Cancel Error",
        error instanceof Error ? error.message : "Failed to cancel analysis",
      );
      setState((prev) => ({ ...prev, isCancelling: false }));
      return false;
    }
  }, [apiService, setDDARunning]);

  // Clear errors
  const clearNsgError = useCallback(() => {
    setState((prev) => ({ ...prev, nsgError: null }));
  }, []);

  const clearServerError = useCallback(() => {
    setState((prev) => ({ ...prev, serverError: null }));
  }, []);

  return {
    // State
    isRunning: state.isRunning,
    isCancelling: state.isCancelling,
    isSubmittingToNsg: state.isSubmittingToNsg,
    isSubmittingToServer: state.isSubmittingToServer,
    nsgError: state.nsgError,
    serverError: state.serverError,
    nsgSubmissionPhase: state.nsgSubmissionPhase,
    serverSubmissionPhase: state.serverSubmissionPhase,

    // Actions
    runAnalysis,
    submitToNSG,
    submitToServer,
    cancelAnalysis,
    clearNsgError,
    clearServerError,

    // Helpers
    extractAllChannels,
  };
}
