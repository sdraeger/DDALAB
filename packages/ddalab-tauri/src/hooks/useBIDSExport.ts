// packages/ddalab-tauri/src/hooks/useBIDSExport.ts

import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  BIDSExportRequest,
  BIDSExportProgress,
  BIDSExportResult,
  BIDSFileAssignment,
  BIDSDatasetMetadata,
  BIDSExportOptions,
  BIDSWizardStep,
} from "@/types/bidsExport";

interface UseBIDSExportState {
  // Wizard state
  currentStep: BIDSWizardStep;
  files: BIDSFileAssignment[];
  metadata: BIDSDatasetMetadata;
  options: BIDSExportOptions;
  outputPath: string;

  // Export state
  isExporting: boolean;
  progress: BIDSExportProgress | null;
  result: BIDSExportResult | null;
  validationErrors: string[];
}

const initialMetadata: BIDSDatasetMetadata = {
  name: "",
  description: "",
  authors: [],
  license: "CC0",
  funding: "",
};

const initialOptions: BIDSExportOptions = {
  outputFormat: "edf",
  powerLineFrequency: 60,
  eegReference: undefined,
};

export function useBIDSExport() {
  const [state, setState] = useState<UseBIDSExportState>({
    currentStep: "files",
    files: [],
    metadata: initialMetadata,
    options: initialOptions,
    outputPath: "",
    isExporting: false,
    progress: null,
    result: null,
    validationErrors: [],
  });

  // Listen for progress events
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<BIDSExportProgress>(
        "bids-export-progress",
        (event) => {
          setState((prev) => ({ ...prev, progress: event.payload }));
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Navigation
  const goToStep = useCallback((step: BIDSWizardStep) => {
    setState((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const nextStep = useCallback(() => {
    const steps: BIDSWizardStep[] = [
      "files",
      "assignment",
      "metadata",
      "options",
      "review",
    ];
    setState((prev) => {
      const currentIndex = steps.indexOf(prev.currentStep);
      if (currentIndex < steps.length - 1) {
        return { ...prev, currentStep: steps[currentIndex + 1] };
      }
      return prev;
    });
  }, []);

  const prevStep = useCallback(() => {
    const steps: BIDSWizardStep[] = [
      "files",
      "assignment",
      "metadata",
      "options",
      "review",
    ];
    setState((prev) => {
      const currentIndex = steps.indexOf(prev.currentStep);
      if (currentIndex > 0) {
        return { ...prev, currentStep: steps[currentIndex - 1] };
      }
      return prev;
    });
  }, []);

  // File management
  const addFiles = useCallback((newFiles: BIDSFileAssignment[]) => {
    setState((prev) => {
      // Filter out files that already exist (by sourcePath)
      const existingPaths = new Set(prev.files.map((f) => f.sourcePath));
      const uniqueNewFiles = newFiles.filter(
        (f) => !existingPaths.has(f.sourcePath),
      );
      return {
        ...prev,
        files: [...prev.files, ...uniqueNewFiles],
      };
    });
  }, []);

  const removeFile = useCallback((sourcePath: string) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.filter((f) => f.sourcePath !== sourcePath),
    }));
  }, []);

  const updateFileAssignment = useCallback(
    (sourcePath: string, updates: Partial<BIDSFileAssignment>) => {
      setState((prev) => ({
        ...prev,
        files: prev.files.map((f) =>
          f.sourcePath === sourcePath ? { ...f, ...updates } : f,
        ),
      }));
    },
    [],
  );

  // Metadata management
  const updateMetadata = useCallback(
    (updates: Partial<BIDSDatasetMetadata>) => {
      setState((prev) => ({
        ...prev,
        metadata: { ...prev.metadata, ...updates },
      }));
    },
    [],
  );

  // Options management
  const updateOptions = useCallback((updates: Partial<BIDSExportOptions>) => {
    setState((prev) => ({
      ...prev,
      options: { ...prev.options, ...updates },
    }));
  }, []);

  // Output path
  const setOutputPath = useCallback((path: string) => {
    setState((prev) => ({ ...prev, outputPath: path }));
  }, []);

  // Validation
  const validate = useCallback(async (): Promise<string[]> => {
    const request: BIDSExportRequest = {
      files: state.files,
      dataset: state.metadata,
      options: state.options,
      outputPath: state.outputPath,
    };

    try {
      const errors = await invoke<string[]>("validate_bids_export", {
        request,
      });
      setState((prev) => ({ ...prev, validationErrors: errors }));
      return errors;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : "Validation failed";
      setState((prev) => ({ ...prev, validationErrors: [errorMsg] }));
      return [errorMsg];
    }
  }, [state.files, state.metadata, state.options, state.outputPath]);

  // Export
  const startExport = useCallback(async (): Promise<BIDSExportResult> => {
    setState((prev) => ({
      ...prev,
      isExporting: true,
      progress: null,
      result: null,
    }));

    const request: BIDSExportRequest = {
      files: state.files,
      dataset: state.metadata,
      options: state.options,
      outputPath: state.outputPath,
    };

    try {
      const result = await invoke<BIDSExportResult>("export_to_bids", {
        request,
      });
      setState((prev) => ({ ...prev, isExporting: false, result }));
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Export failed";
      const result: BIDSExportResult = {
        success: false,
        datasetPath: "",
        filesExported: 0,
        warnings: [],
        error: errorMsg,
      };
      setState((prev) => ({ ...prev, isExporting: false, result }));
      return result;
    }
  }, [state.files, state.metadata, state.options, state.outputPath]);

  // Reset
  const reset = useCallback(() => {
    setState({
      currentStep: "files",
      files: [],
      metadata: initialMetadata,
      options: initialOptions,
      outputPath: "",
      isExporting: false,
      progress: null,
      result: null,
      validationErrors: [],
    });
  }, []);

  return {
    // State
    ...state,

    // Navigation
    goToStep,
    nextStep,
    prevStep,

    // File management
    addFiles,
    removeFile,
    updateFileAssignment,

    // Metadata
    updateMetadata,

    // Options
    updateOptions,

    // Output
    setOutputPath,

    // Actions
    validate,
    startExport,
    reset,
  };
}
