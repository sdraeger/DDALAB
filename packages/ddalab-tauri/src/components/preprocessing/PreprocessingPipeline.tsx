/**
 * PreprocessingPipeline Component
 *
 * Main component for the preprocessing pipeline:
 * Raw Data → Bad Channel Detection → Filtering → Re-reference → ICA → Artifact Removal → DDA-Ready
 */

import React, { useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { PipelineStepCard } from "./PipelineStepCard";
import { PresetSelector } from "./PresetSelector";
import { BadChannelDetectionStep } from "./steps/BadChannelDetectionStep";
import { FilteringStep } from "./steps/FilteringStep";
import { RereferenceStep } from "./steps/RereferenceStep";
import { ICAStep } from "./steps/ICAStep";
import { ArtifactRemovalStep } from "./steps/ArtifactRemovalStep";
import type {
  PipelineStepType,
  PreprocessingPipeline as PipelineType,
} from "@/types/preprocessing";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  Square,
  RotateCcw,
  Save,
  Eye,
  EyeOff,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Zap,
} from "lucide-react";

const STEP_ORDER: PipelineStepType[] = [
  "bad_channel_detection",
  "filtering",
  "rereference",
  "ica",
  "artifact_removal",
];

const STEP_LABELS: Record<PipelineStepType, string> = {
  bad_channel_detection: "Bad Channel Detection",
  filtering: "Filtering",
  rereference: "Re-reference",
  ica: "ICA Decomposition",
  artifact_removal: "Artifact Removal",
};

const STEP_DESCRIPTIONS: Record<PipelineStepType, string> = {
  bad_channel_detection: "Identify and mark channels with poor signal quality",
  filtering: "Apply frequency filters (highpass, lowpass, notch)",
  rereference: "Change reference scheme (average, linked, etc.)",
  ica: "Decompose signals into independent components",
  artifact_removal: "Detect and remove remaining artifacts",
};

export function PreprocessingPipeline() {
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);

  const preprocessingState = useAppStore(
    useShallow((state) => state.preprocessing),
  );
  const {
    createPipeline,
    setActivePipeline,
    setStepEnabled,
    setPipelineRunning,
    resetPipelineResults,
    setPreviewMode,
    applyPreset,
    saveAsPreset,
    getPipelineForFile,
    getAllPresets,
  } = useAppStore();

  // Get or create pipeline for current file
  const activePipeline = useMemo(() => {
    if (!selectedFile) return null;

    // Check if active pipeline exists
    if (preprocessingState.activePipelineId) {
      const pipeline =
        preprocessingState.pipelines[preprocessingState.activePipelineId];
      if (pipeline && pipeline.fileId === selectedFile.file_path) {
        return pipeline;
      }
    }

    // Look for existing pipeline for this file
    return getPipelineForFile(selectedFile.file_path) ?? null;
  }, [
    selectedFile,
    preprocessingState.activePipelineId,
    preprocessingState.pipelines,
    getPipelineForFile,
  ]);

  // Auto-create pipeline when file is selected
  React.useEffect(() => {
    if (selectedFile && !activePipeline) {
      const pipelineId = createPipeline(selectedFile.file_path);
      setActivePipeline(pipelineId);
    } else if (
      activePipeline &&
      preprocessingState.activePipelineId !== activePipeline.id
    ) {
      setActivePipeline(activePipeline.id);
    }
  }, [
    selectedFile,
    activePipeline,
    createPipeline,
    setActivePipeline,
    preprocessingState.activePipelineId,
  ]);

  const presets = useMemo(() => getAllPresets(), [getAllPresets]);

  const handleStepToggle = useCallback(
    (stepType: PipelineStepType, enabled: boolean) => {
      if (activePipeline) {
        setStepEnabled(activePipeline.id, stepType, enabled);
      }
    },
    [activePipeline, setStepEnabled],
  );

  const handleRunPipeline = useCallback(() => {
    if (!activePipeline) return;

    // TODO: Implement actual pipeline execution via backend
    setPipelineRunning(activePipeline.id, true);
    console.log(
      "[Preprocessing] Starting pipeline execution:",
      activePipeline.id,
    );

    // Simulated pipeline execution - replace with actual backend calls
    // This would involve calling Tauri commands for each enabled step
  }, [activePipeline, setPipelineRunning]);

  const handleStopPipeline = useCallback(() => {
    if (!activePipeline) return;
    setPipelineRunning(activePipeline.id, false);
    console.log("[Preprocessing] Stopping pipeline execution");
  }, [activePipeline, setPipelineRunning]);

  const handleResetResults = useCallback(() => {
    if (activePipeline) {
      resetPipelineResults(activePipeline.id);
    }
  }, [activePipeline, resetPipelineResults]);

  const handlePresetSelect = useCallback(
    (presetId: string) => {
      if (activePipeline) {
        applyPreset(activePipeline.id, presetId);
      }
    },
    [activePipeline, applyPreset],
  );

  const handleSaveAsPreset = useCallback(
    (name: string, description?: string) => {
      if (activePipeline) {
        return saveAsPreset(activePipeline.id, name, description);
      }
      return "";
    },
    [activePipeline, saveAsPreset],
  );

  const enabledStepCount = useMemo(() => {
    if (!activePipeline) return 0;
    return Object.values(activePipeline.steps).filter((s) => s.enabled).length;
  }, [activePipeline]);

  const completedStepCount = useMemo(() => {
    if (!activePipeline) return 0;
    return Object.values(activePipeline.steps).filter(
      (s) => s.status === "completed",
    ).length;
  }, [activePipeline]);

  const getStepComponent = (stepType: PipelineStepType) => {
    if (!activePipeline) return null;

    const props = { pipelineId: activePipeline.id };

    switch (stepType) {
      case "bad_channel_detection":
        return <BadChannelDetectionStep {...props} />;
      case "filtering":
        return <FilteringStep {...props} />;
      case "rereference":
        return <RereferenceStep {...props} />;
      case "ica":
        return <ICAStep {...props} />;
      case "artifact_removal":
        return <ArtifactRemovalStep {...props} />;
      default:
        return null;
    }
  };

  const getStepFromPipeline = (
    pipeline: PipelineType,
    stepType: PipelineStepType,
  ) => {
    const mapping: Record<PipelineStepType, keyof PipelineType["steps"]> = {
      bad_channel_detection: "badChannelDetection",
      filtering: "filtering",
      rereference: "rereference",
      ica: "ica",
      artifact_removal: "artifactRemoval",
    };
    return pipeline.steps[mapping[stepType]];
  };

  if (!selectedFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <Zap className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No File Selected</p>
        <p className="text-sm mt-2">Select a file to configure preprocessing</p>
      </div>
    );
  }

  if (!activePipeline) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Preprocessing Pipeline</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {selectedFile.file_name}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 mr-4">
              <Switch
                id="preview-mode"
                checked={preprocessingState.previewMode}
                onCheckedChange={setPreviewMode}
              />
              <Label
                htmlFor="preview-mode"
                className="text-sm flex items-center gap-1.5"
              >
                {preprocessingState.previewMode ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
                Preview
              </Label>
            </div>

            <PresetSelector
              presets={presets}
              onSelect={handlePresetSelect}
              onSave={handleSaveAsPreset}
            />
          </div>
        </div>

        {/* Progress and Controls */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-muted-foreground">
                {completedStepCount} of {enabledStepCount} steps completed
              </span>
              <span className="font-medium">
                {Math.round(activePipeline.totalProgress)}%
              </span>
            </div>
            <Progress value={activePipeline.totalProgress} className="h-2" />
          </div>

          <div className="flex items-center gap-2">
            {!activePipeline.isRunning ? (
              <Button
                onClick={handleRunPipeline}
                disabled={enabledStepCount === 0}
                size="sm"
              >
                <Play className="h-4 w-4 mr-1.5" />
                Run Pipeline
              </Button>
            ) : (
              <Button
                onClick={handleStopPipeline}
                variant="destructive"
                size="sm"
              >
                <Square className="h-4 w-4 mr-1.5" />
                Stop
              </Button>
            )}

            <Button
              onClick={handleResetResults}
              variant="outline"
              size="sm"
              disabled={activePipeline.isRunning}
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Pipeline Steps */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {/* Pipeline Flow Visualization */}
          <div className="flex items-center justify-center gap-1 py-2 mb-4 text-xs text-muted-foreground">
            <span className="px-2 py-1 bg-muted rounded">Raw Data</span>
            <ChevronRight className="h-4 w-4" />
            {STEP_ORDER.map((stepType, index) => {
              const step = getStepFromPipeline(activePipeline, stepType);
              const isEnabled = step.enabled;
              const status = step.status;

              return (
                <React.Fragment key={stepType}>
                  <span
                    className={`px-2 py-1 rounded flex items-center gap-1 ${
                      !isEnabled
                        ? "bg-muted/50 text-muted-foreground/50 line-through"
                        : status === "completed"
                          ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                          : status === "running"
                            ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400"
                            : status === "error"
                              ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                              : "bg-muted"
                    }`}
                  >
                    {status === "completed" && (
                      <CheckCircle2 className="h-3 w-3" />
                    )}
                    {status === "running" && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {status === "error" && <AlertCircle className="h-3 w-3" />}
                    {STEP_LABELS[stepType].split(" ")[0]}
                  </span>
                  {index < STEP_ORDER.length - 1 && (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </React.Fragment>
              );
            })}
            <ChevronRight className="h-4 w-4" />
            <span className="px-2 py-1 bg-primary/10 text-primary rounded font-medium">
              DDA-Ready
            </span>
          </div>

          {/* Step Cards */}
          {STEP_ORDER.map((stepType, index) => {
            const step = getStepFromPipeline(activePipeline, stepType);

            return (
              <PipelineStepCard
                key={stepType}
                stepNumber={index + 1}
                title={STEP_LABELS[stepType]}
                description={STEP_DESCRIPTIONS[stepType]}
                enabled={step.enabled}
                status={step.status}
                error={step.error}
                lastRun={step.lastRun}
                duration={step.duration}
                onToggle={(enabled) => handleStepToggle(stepType, enabled)}
                isRunning={activePipeline.isRunning}
                isCurrent={activePipeline.currentStepIndex === index}
              >
                {getStepComponent(stepType)}
              </PipelineStepCard>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

export default PreprocessingPipeline;
