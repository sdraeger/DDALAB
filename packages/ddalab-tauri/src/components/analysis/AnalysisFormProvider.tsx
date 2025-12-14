"use client";

import React, { createContext, useContext, useCallback, useMemo } from "react";
import { EDFFileInfo } from "@/types/api";

export interface DDAParameters {
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

interface AnalysisFormContextValue {
  parameters: DDAParameters;
  updateParameter: <K extends keyof DDAParameters>(
    key: K,
    value: DDAParameters[K],
  ) => void;
  updateParameters: (updater: (prev: DDAParameters) => DDAParameters) => void;
  isRunning: boolean;
  selectedFile: EDFFileInfo | null;
  validationErrors: Record<string, string>;
}

const AnalysisFormContext = createContext<AnalysisFormContextValue | null>(
  null,
);

export interface AnalysisFormProviderProps {
  children: React.ReactNode;
  parameters: DDAParameters;
  onParametersChange: (params: DDAParameters) => void;
  isRunning: boolean;
  selectedFile: EDFFileInfo | null;
  validationErrors?: Record<string, string>;
}

export const AnalysisFormProvider: React.FC<AnalysisFormProviderProps> = ({
  children,
  parameters,
  onParametersChange,
  isRunning,
  selectedFile,
  validationErrors = {},
}) => {
  const updateParameter = useCallback(
    <K extends keyof DDAParameters>(key: K, value: DDAParameters[K]) => {
      onParametersChange({
        ...parameters,
        [key]: value,
      });
    },
    [parameters, onParametersChange],
  );

  const updateParameters = useCallback(
    (updater: (prev: DDAParameters) => DDAParameters) => {
      onParametersChange(updater(parameters));
    },
    [parameters, onParametersChange],
  );

  const contextValue = useMemo<AnalysisFormContextValue>(
    () => ({
      parameters,
      updateParameter,
      updateParameters,
      isRunning,
      selectedFile,
      validationErrors,
    }),
    [
      parameters,
      updateParameter,
      updateParameters,
      isRunning,
      selectedFile,
      validationErrors,
    ],
  );

  return (
    <AnalysisFormContext.Provider value={contextValue}>
      {children}
    </AnalysisFormContext.Provider>
  );
};

export const useAnalysisForm = (): AnalysisFormContextValue => {
  const context = useContext(AnalysisFormContext);
  if (!context) {
    throw new Error(
      "useAnalysisForm must be used within an AnalysisFormProvider",
    );
  }
  return context;
};
