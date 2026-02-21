"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useBatchAnalysis } from "@/hooks/useBatchAnalysis";
import { useAppStore } from "@/store/appStore";
import type { BatchSharedParameters } from "@/store/slices/batchSlice";
import {
  DEFAULT_CHANNEL_SELECTION,
  type ChannelSelection,
} from "@/store/slices/batchSlice";
import { BatchFileSelector } from "./BatchFileSelector";
import { BatchParameterPanel } from "./BatchParameterPanel";
import { BatchChannelSelector } from "./BatchChannelSelector";
import { BatchJobQueue } from "./BatchJobQueue";
import { BatchResultsSummary } from "./BatchResultsSummary";
import { tauriBackendService } from "@/services/tauriBackendService";
import type { ComparisonEntry } from "@/store/slices/comparisonSlice";
import {
  Layers,
  ArrowLeft,
  ArrowRight,
  Play,
  CheckCircle2,
  FileText as FileIcon,
  Settings,
  Loader2 as ProcessingIcon,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SetupPhase = "select" | "configure";

type BatchPhase = "select" | "configure" | "running" | "results";

const STEPS: Array<{ id: BatchPhase; label: string; icon: React.ElementType }> =
  [
    { id: "select", label: "Select Files", icon: FileIcon },
    { id: "configure", label: "Configure", icon: Settings },
    { id: "running", label: "Processing", icon: ProcessingIcon },
    { id: "results", label: "Results", icon: BarChart3 },
  ];

function getStepState(
  stepId: BatchPhase,
  currentPhase: BatchPhase,
): "completed" | "active" | "pending" {
  const order: BatchPhase[] = ["select", "configure", "running", "results"];
  const stepIndex = order.indexOf(stepId);
  const currentIndex = order.indexOf(currentPhase);
  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function BatchStepIndicator({ currentPhase }: { currentPhase: BatchPhase }) {
  return (
    <div className="flex items-center justify-between px-2">
      {STEPS.map((step, index) => {
        const state = getStepState(step.id, currentPhase);
        const Icon = step.icon;
        return (
          <div
            key={step.id}
            className="flex items-center flex-1 last:flex-none"
          >
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium transition-colors",
                  state === "completed" && "bg-primary text-primary-foreground",
                  state === "active" &&
                    "bg-primary text-primary-foreground ring-4 ring-primary/20",
                  state === "pending" &&
                    "bg-muted text-muted-foreground border-2 border-muted-foreground/30",
                )}
              >
                {state === "completed" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={cn(
                  "text-xs whitespace-nowrap",
                  state === "active" && "font-semibold text-foreground",
                  state === "completed" && "text-primary",
                  state === "pending" && "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-3 mt-[-1.25rem]",
                  getStepState(STEPS[index + 1].id, currentPhase) !== "pending"
                    ? "bg-primary"
                    : "bg-muted",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BatchProcessingDashboard() {
  const {
    currentBatch,
    isRunning,
    submitBatch,
    cancelCurrentBatch,
    clearBatch,
  } = useBatchAnalysis();

  const setPrimaryNav = useAppStore((s) => s.setPrimaryNav);
  const setSecondaryNav = useAppStore((s) => s.setSecondaryNav);
  const setPendingAnalysisId = useAppStore((s) => s.setPendingAnalysisId);
  const setComparisonFromGroup = useAppStore((s) => s.setComparisonFromGroup);

  // Local setup state
  const [setupPhase, setSetupPhase] = useState<SetupPhase>("select");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [channelSelection, setChannelSelection] = useState<ChannelSelection>(
    DEFAULT_CHANNEL_SELECTION,
  );
  const [continueOnError, setContinueOnError] = useState(true);
  const [sharedParams, setSharedParams] = useState<BatchSharedParameters>({
    variants: ["single_timeseries"],
    windowLength: 250,
    windowStep: 50,
    delays: [7, 10],
  });

  // Derive the visible phase from store + local state
  const batchStatus = currentBatch?.status;
  const showRunning = batchStatus === "running";
  const showResults =
    batchStatus === "completed" ||
    batchStatus === "error" ||
    batchStatus === "cancelled";
  const showSetup = !showRunning && !showResults;

  const currentPhase: BatchPhase = showResults
    ? "results"
    : showRunning
      ? "running"
      : setupPhase;

  const handleStartBatch = useCallback(async () => {
    if (selectedFiles.length === 0 || sharedParams.variants.length === 0)
      return;
    await submitBatch(
      selectedFiles,
      channelSelection,
      sharedParams,
      continueOnError,
    );
  }, [
    selectedFiles,
    channelSelection,
    sharedParams,
    continueOnError,
    submitBatch,
  ]);

  const handleClearAndReset = useCallback(() => {
    clearBatch();
    setSetupPhase("select");
  }, [clearBatch]);

  const handleViewResult = useCallback(
    (analysisId: string) => {
      setPendingAnalysisId(analysisId);
      setPrimaryNav("analyze");
      setSecondaryNav("dda");
    },
    [setPendingAnalysisId, setPrimaryNav, setSecondaryNav],
  );

  const handleCompareResults = useCallback(async () => {
    if (!currentBatch) return;
    const completedIds = currentBatch.files
      .filter((f) => f.status === "completed" && f.analysisId)
      .map((f) => f.analysisId!);

    if (completedIds.length < 2) return;

    try {
      const group = await tauriBackendService.createAnalysisGroup(
        `Batch ${currentBatch.id.slice(0, 8)}`,
        "batch",
        completedIds,
      );

      const metadataBatch =
        await tauriBackendService.getAnalysesMetadataBatch(completedIds);

      const entries: ComparisonEntry[] = metadataBatch.map((m) => ({
        analysisId: m.id,
        label: m.name ?? m.filePath.split("/").pop() ?? m.id,
        filePath: m.filePath,
        channels: m.channels ?? [],
        variantIds: [m.variantName],
        createdAt: m.timestamp,
      }));

      setComparisonFromGroup(group.id, entries);
      setPrimaryNav("analyze");
      setSecondaryNav("compare");
    } catch (err) {
      console.error("[Batch] Failed to create comparison group:", err);
    }
  }, [currentBatch, setComparisonFromGroup, setPrimaryNav, setSecondaryNav]);

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 pb-2 space-y-6 max-w-5xl mx-auto w-full flex-shrink-0">
        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Layers className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-semibold">Batch Processing</h2>
          </div>
          <p className="text-sm text-muted-foreground ml-9">
            Run DDA analysis across multiple files or entire BIDS datasets
          </p>
        </div>

        <Separator />
        <BatchStepIndicator currentPhase={currentPhase} />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Setup: File Selection phase */}
          <div
            style={{
              display: showSetup && setupPhase === "select" ? "block" : "none",
              visibility:
                showSetup && setupPhase === "select" ? "visible" : "hidden",
            }}
            aria-hidden={!(showSetup && setupPhase === "select")}
            inert={!(showSetup && setupPhase === "select") || undefined}
          >
            <div className="space-y-6">
              <BatchFileSelector
                files={selectedFiles}
                onFilesChange={setSelectedFiles}
              />
              <div className="flex justify-end">
                <Button
                  size="lg"
                  onClick={() => setSetupPhase("configure")}
                  disabled={selectedFiles.length === 0}
                >
                  Configure Parameters
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>
          </div>

          {/* Setup: Configure phase */}
          <div
            style={{
              display:
                showSetup && setupPhase === "configure" ? "block" : "none",
              visibility:
                showSetup && setupPhase === "configure" ? "visible" : "hidden",
            }}
            aria-hidden={!(showSetup && setupPhase === "configure")}
            inert={!(showSetup && setupPhase === "configure") || undefined}
          >
            <div className="space-y-6">
              <BatchParameterPanel
                params={sharedParams}
                onParamsChange={setSharedParams}
                continueOnError={continueOnError}
                onContinueOnErrorChange={setContinueOnError}
              />
              <BatchChannelSelector
                selection={channelSelection}
                onSelectionChange={setChannelSelection}
                selectedFiles={selectedFiles}
              />
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => setSetupPhase("select")}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Files
                </Button>
                <Button
                  size="lg"
                  onClick={handleStartBatch}
                  disabled={
                    selectedFiles.length === 0 ||
                    sharedParams.variants.length === 0 ||
                    sharedParams.delays.length === 0
                  }
                >
                  <Play className="h-4 w-4 mr-2" />
                  Start Batch ({selectedFiles.length} file
                  {selectedFiles.length === 1 ? "" : "s"})
                </Button>
              </div>
            </div>
          </div>

          {/* Running phase */}
          <div
            style={{
              display: showRunning ? "block" : "none",
              visibility: showRunning ? "visible" : "hidden",
            }}
            aria-hidden={!showRunning}
            inert={!showRunning || undefined}
          >
            {currentBatch && (
              <BatchJobQueue
                batch={currentBatch}
                onCancel={cancelCurrentBatch}
              />
            )}
          </div>

          {/* Results phase */}
          <div
            style={{
              display: showResults ? "block" : "none",
              visibility: showResults ? "visible" : "hidden",
            }}
            aria-hidden={!showResults}
            inert={!showResults || undefined}
          >
            {currentBatch && (
              <BatchResultsSummary
                batch={currentBatch}
                onClear={handleClearAndReset}
                onViewResult={handleViewResult}
                onCompareResults={handleCompareResults}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
