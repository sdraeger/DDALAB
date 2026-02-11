import { useEffect, useMemo, useCallback } from "react";
import { useICAWorkflow } from "@/hooks/useICAAnalysis";
import { ICAAnalysisRequest, ICAParametersRequest } from "@/types/ica";
import type { ReconstructResponse, ICAResult } from "@/types/ica";
import { ICAResults } from "./ICAResults";
import { ICAConfigPanel, ICAConfig } from "./ICAConfigPanel";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { TauriService, NotificationType } from "@/services/tauriService";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";
import { handleError } from "@/utils/errorHandler";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  History,
  FolderOpen,
  Play,
  Square,
  Trash2,
  Wand2,
  ChevronDown,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const KURTOSIS_ARTIFACT_THRESHOLD = 5;

export function ICAAnalysisPanel() {
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const timeWindow = useAppStore(
    useShallow((state) => state.fileManager.timeWindow),
  );

  const {
    selectedChannels: icaSelectedChannels,
    nComponents,
    maxIterations,
    tolerance,
    centering,
    whitening,
    selectedResultId,
    isSubmitting: globalIsSubmitting,
    isConfigCollapsed,
  } = useAppStore(
    useShallow((state) => ({
      selectedChannels: state.ica.selectedChannels,
      nComponents: state.ica.nComponents,
      maxIterations: state.ica.maxIterations,
      tolerance: state.ica.tolerance,
      centering: state.ica.centering,
      whitening: state.ica.whitening,
      selectedResultId: state.ica.selectedResultId,
      isSubmitting: state.ica.isSubmitting,
      isConfigCollapsed: state.ica.isConfigCollapsed,
    })),
  );
  const updateICAState = useAppStore((state) => state.updateICAState);

  const ica = useICAWorkflow();

  const setSelectedResultId = useCallback(
    (id: string | null) => updateICAState({ selectedResultId: id }),
    [updateICAState],
  );

  const selectedResult = ica.results.find((r) => r.id === selectedResultId);

  // Convert indices to channel names for ChannelSelector
  const selectedChannelNames = useMemo(() => {
    if (!selectedFile) return [];
    return icaSelectedChannels
      .filter((idx) => idx < selectedFile.channels.length)
      .map((idx) => selectedFile.channels[idx]);
  }, [icaSelectedChannels, selectedFile]);

  // Available channels from file
  const availableChannels = useMemo(() => {
    return selectedFile?.channels || [];
  }, [selectedFile]);

  // Handle channel selection changes
  const handleChannelSelectionChange = useCallback(
    (channelNames: string[]) => {
      if (!selectedFile) return;
      const indices = channelNames
        .map((name) => selectedFile.channels.indexOf(name))
        .filter((idx) => idx !== -1)
        .sort((a, b) => a - b);
      updateICAState({ selectedChannels: indices });
    },
    [selectedFile, updateICAState],
  );

  // Handle config changes
  const handleConfigChange = useCallback(
    (config: Partial<ICAConfig>) => {
      updateICAState(config);
    },
    [updateICAState],
  );

  // Current config for ICAConfigPanel
  const currentConfig: ICAConfig = useMemo(
    () => ({
      nComponents,
      maxIterations,
      tolerance,
      centering,
      whitening,
    }),
    [nComponents, maxIterations, tolerance, centering, whitening],
  );

  // Auto-select all channels when a file is loaded and no channels are selected
  useEffect(() => {
    if (
      selectedFile &&
      selectedFile.channels.length > 0 &&
      icaSelectedChannels.length === 0
    ) {
      const allIndices = selectedFile.channels.map((_, idx) => idx);
      updateICAState({ selectedChannels: allIndices });
    }
  }, [selectedFile?.file_path]);

  // Auto-select a result when results are loaded
  useEffect(() => {
    if (ica.results.length > 0) {
      const currentSelectionValid =
        selectedResultId && ica.results.some((r) => r.id === selectedResultId);
      if (!currentSelectionValid) {
        setSelectedResultId(ica.results[0].id);
      }
    }
  }, [ica.results, selectedResultId, setSelectedResultId]);

  // Register searchable items
  useSearchableItems(
    [
      createActionItem(
        "ica-run-analysis",
        "Run ICA Analysis",
        () => {
          document.getElementById("ica-run-button")?.focus();
        },
        {
          description: `Run Independent Component Analysis${selectedFile ? ` on ${selectedFile.file_name}` : ""}`,
          keywords: [
            "run",
            "ica",
            "independent",
            "component",
            "artifact",
            "removal",
            "fastica",
          ],
          category: "ICA Analysis",
        },
      ),
      ...(selectedResult
        ? [
            createActionItem(
              `ica-result-${selectedResult.id}`,
              `ICA Result: ${selectedResult.results.components.length} components`,
              () => setSelectedResultId(selectedResult.id),
              {
                description: `View ICA decomposition with ${selectedResult.results.components.length} components`,
                keywords: ["result", "ica", "components", "decomposition"],
                category: "ICA Results",
              },
            ),
          ]
        : []),
    ],
    [selectedFile?.file_path, selectedResult?.id],
  );

  // Sync global isSubmitting state with mutation state
  useEffect(() => {
    if (globalIsSubmitting && !ica.isSubmitting) {
      const recentResult = ica.results.find((r) => {
        const createdAt = new Date(r.created_at).getTime();
        const now = Date.now();
        return now - createdAt < 60000;
      });

      if (recentResult) {
        updateICAState({
          isSubmitting: false,
          selectedResultId: recentResult.id,
        });

        if (TauriService.isTauri()) {
          TauriService.createNotification(
            "ICA Analysis Complete",
            `Extracted ${recentResult.results.components.length} independent components.`,
            NotificationType.Success,
          ).catch((error) =>
            handleError(error, {
              source: "ICA Notification",
              severity: "silent",
            }),
          );
        }
      } else if (ica.submitError) {
        updateICAState({ isSubmitting: false });
      } else if (ica.results.length > 0) {
        updateICAState({ isSubmitting: false });
      }
    }
  }, [
    globalIsSubmitting,
    ica.isSubmitting,
    ica.results,
    ica.submitError,
    updateICAState,
  ]);

  // Run analysis handler
  const handleRunAnalysis = useCallback(() => {
    if (!selectedFile || icaSelectedChannels.length < 2) return;

    const parameters: ICAParametersRequest = {
      n_components: nComponents,
      max_iterations: maxIterations,
      tolerance: tolerance,
      centering: centering,
      whitening: whitening,
    };

    const request: ICAAnalysisRequest = {
      file_path: selectedFile.file_path,
      channels: icaSelectedChannels,
      time_range:
        timeWindow.start !== 0 || timeWindow.end !== selectedFile.duration
          ? { start: timeWindow.start, end: timeWindow.end }
          : undefined,
      parameters,
    };

    updateICAState({ isSubmitting: true, isConfigCollapsed: true });

    if (TauriService.isTauri()) {
      TauriService.createNotification(
        "ICA Analysis Started",
        `Processing ${icaSelectedChannels.length} channels. You can switch tabs while this runs.`,
        NotificationType.Info,
      ).catch((error) =>
        handleError(error, { source: "ICA Notification", severity: "silent" }),
      );
    }

    try {
      ica.submit(request, {
        onSuccess: (result) => {
          updateICAState({ isSubmitting: false, selectedResultId: result.id });

          if (TauriService.isTauri()) {
            TauriService.createNotification(
              "ICA Analysis Complete",
              `Extracted ${result.results.components.length} independent components.`,
              NotificationType.Success,
            ).catch((error) =>
              handleError(error, {
                source: "ICA Notification",
                severity: "silent",
              }),
            );
          }
        },
        onError: (error) => {
          updateICAState({ isSubmitting: false });

          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (TauriService.isTauri()) {
            if (errorMessage.includes("cancelled")) {
              TauriService.createNotification(
                "ICA Analysis Cancelled",
                "Analysis was cancelled by user.",
                NotificationType.Warning,
              ).catch((err) =>
                handleError(err, {
                  source: "ICA Notification",
                  severity: "silent",
                }),
              );
            } else {
              TauriService.createNotification(
                "ICA Analysis Failed",
                errorMessage,
                NotificationType.Error,
              ).catch((err) =>
                handleError(err, {
                  source: "ICA Notification",
                  severity: "silent",
                }),
              );
            }
          }
        },
      });
    } catch (err) {
      updateICAState({ isSubmitting: false });

      if (TauriService.isTauri()) {
        TauriService.createNotification(
          "ICA Error",
          "Failed to start analysis",
          NotificationType.Error,
        ).catch((error) =>
          handleError(error, {
            source: "ICA Notification",
            severity: "silent",
          }),
        );
      }
    }
  }, [
    selectedFile,
    icaSelectedChannels,
    nComponents,
    maxIterations,
    tolerance,
    centering,
    whitening,
    timeWindow,
    updateICAState,
    ica,
  ]);

  // Cancel handler
  const handleCancel = useCallback(() => {
    ica.cancelSubmit();

    if (TauriService.isTauri()) {
      TauriService.createNotification(
        "Cancelling...",
        "Attempting to cancel ICA analysis",
        NotificationType.Warning,
      ).catch((error) =>
        handleError(error, { source: "ICA Notification", severity: "silent" }),
      );
    }
  }, [ica]);

  // Reconstruct handler
  const handleReconstruct = useCallback(() => {
    if (!selectedResultId || ica.markedArray.length === 0) return;

    ica.reconstruct({
      analysis_id: selectedResultId,
      components_to_remove: ica.markedArray,
    });
  }, [selectedResultId, ica]);

  // Auto-mark artifacts handler
  const handleAutoMarkArtifacts = useCallback(() => {
    if (!selectedResult) return;
    const artifactIds = selectedResult.results.components
      .filter((c) => Math.abs(c.kurtosis) > KURTOSIS_ARTIFACT_THRESHOLD)
      .map((c) => c.component_id);
    ica.markMultiple(artifactIds);
  }, [selectedResult, ica]);

  // Delete result handler
  const handleDeleteResult = useCallback(
    (resultId: string) => {
      ica.deleteResult(resultId);
      if (selectedResultId === resultId) {
        const remaining = ica.results.filter((r) => r.id !== resultId);
        setSelectedResultId(remaining.length > 0 ? remaining[0].id : null);
      }
    },
    [ica, selectedResultId, setSelectedResultId],
  );

  const selectedCount = icaSelectedChannels.length;
  const canRun = !!selectedFile && !globalIsSubmitting && selectedCount >= 2;
  const canReconstruct =
    ica.markedArray.length > 0 && !globalIsSubmitting && !ica.isReconstructing;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar — always visible */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30 flex-shrink-0">
        <Button
          id="ica-run-button"
          size="sm"
          onClick={handleRunAnalysis}
          disabled={!canRun}
          isLoading={globalIsSubmitting}
          loadingText="Running..."
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          Run ICA ({selectedCount} ch)
        </Button>

        {globalIsSubmitting && (
          <Button size="sm" variant="destructive" onClick={handleCancel}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Cancel
          </Button>
        )}

        {selectedResult && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleAutoMarkArtifacts}
            disabled={globalIsSubmitting}
          >
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            Auto-mark Artifacts
          </Button>
        )}

        {canReconstruct && (
          <Button
            size="sm"
            onClick={handleReconstruct}
            isLoading={ica.isReconstructing}
            loadingText="Reconstructing..."
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Remove {ica.markedArray.length} Component
            {ica.markedArray.length !== 1 ? "s" : ""}
          </Button>
        )}

        <div className="flex-1" />

        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            updateICAState({ isConfigCollapsed: !isConfigCollapsed })
          }
          aria-expanded={!isConfigCollapsed}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              !isConfigCollapsed && "rotate-180",
            )}
            aria-hidden="true"
          />
          {isConfigCollapsed ? "Show Config" : "Hide Config"}
        </Button>
      </div>

      {/* Collapsible Configuration Panel */}
      <Collapsible open={!isConfigCollapsed}>
        <CollapsibleContent>
          <ICAConfigPanel
            availableChannels={availableChannels}
            selectedChannels={selectedChannelNames}
            onChannelSelectionChange={handleChannelSelectionChange}
            config={currentConfig}
            onConfigChange={handleConfigChange}
            isRunning={globalIsSubmitting}
            onRunAnalysis={handleRunAnalysis}
            onCancel={handleCancel}
            markedCount={ica.markedArray.length}
            onReconstruct={handleReconstruct}
            isReconstructing={ica.isReconstructing}
            disabled={!selectedFile}
            error={ica.submitError?.message}
            fileName={selectedFile?.file_name}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Results Panel */}
      <div className="flex-1 overflow-hidden">
        {ica.results.length > 0 && (
          <div className="flex h-full">
            {/* Results History Sidebar */}
            <div className="w-48 border-r p-2 overflow-y-auto bg-muted/20 flex-shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium mb-2 text-muted-foreground">
                <History className="h-4 w-4" aria-hidden="true" />
                History
              </div>
              {ica.results.map((result) => (
                <div
                  key={result.id}
                  className={cn(
                    "group relative w-full p-2 rounded cursor-pointer text-sm mb-1 transition-colors text-left",
                    selectedResultId === result.id
                      ? "bg-primary/10 border border-primary"
                      : "hover:bg-muted border border-transparent",
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedResultId(result.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedResultId(result.id);
                    }
                  }}
                >
                  <div className="font-medium">
                    {result.results.components.length} ICs
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(result.created_at).toLocaleTimeString()}
                  </div>
                  <button
                    className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteResult(result.id);
                    }}
                    aria-label={`Delete result with ${result.results.components.length} components`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Selected Result Display */}
            <div className="flex-1 overflow-hidden">
              {selectedResult ? (
                <ICAResults
                  result={selectedResult}
                  markedComponents={ica.markedComponents}
                  onToggleMarked={ica.toggleComponent}
                  onAutoMarkArtifacts={handleAutoMarkArtifacts}
                  reconstructedData={ica.reconstructedData ?? null}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  Select an analysis to view results
                </div>
              )}
            </div>
          </div>
        )}

        {ica.results.length === 0 && !globalIsSubmitting && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4">
            <FolderOpen className="h-12 w-12 opacity-50" aria-hidden="true" />
            <div className="text-center">
              <p className="font-medium">No ICA analyses yet</p>
              <p className="text-sm">Run analysis to see results</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ICAAnalysisPanel;
