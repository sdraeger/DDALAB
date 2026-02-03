import { useEffect, useMemo, useCallback } from "react";
import { useICAWorkflow } from "@/hooks/useICAAnalysis";
import { ICAAnalysisRequest, ICAParametersRequest } from "@/types/ica";
import { ICAResults } from "./ICAResults";
import { ICAConfigPanel, ICAConfig } from "./ICAConfigPanel";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { TauriService, NotificationType } from "@/services/tauriService";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";
import { handleError } from "@/utils/errorHandler";
import { History, FolderOpen } from "lucide-react";

export function ICAAnalysisPanel() {
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const timeWindow = useAppStore(
    useShallow((state) => state.fileManager.timeWindow),
  );

  // Use global ICA state from store for persistence across tab switches
  const icaState = useAppStore(useShallow((state) => state.ica));
  const updateICAState = useAppStore((state) => state.updateICAState);

  const ica = useICAWorkflow();

  // Destructure ICA state
  const {
    selectedChannels: icaSelectedChannels,
    nComponents,
    maxIterations,
    tolerance,
    centering,
    whitening,
    selectedResultId,
    isSubmitting: globalIsSubmitting,
  } = icaState;

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

  // Note: ICA channel selection is persisted in the store and restored on app load.
  // Users must explicitly select channels - no auto-population.

  // Auto-select a result when results are loaded
  useEffect(() => {
    if (ica.results.length > 0) {
      // If no result is selected, or the selected result no longer exists, select the first/most recent
      const currentSelectionValid =
        selectedResultId && ica.results.some((r) => r.id === selectedResultId);
      if (!currentSelectionValid) {
        // Select the most recent result (results are ordered by created_at DESC)
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

    updateICAState({ isSubmitting: true });

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

  return (
    <div className="flex flex-col h-full">
      {/* Configuration Panel */}
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

      {/* Results Panel */}
      <div className="flex-1 overflow-hidden">
        {ica.results.length > 0 && (
          <div className="flex h-full">
            {/* Results History Sidebar */}
            <div className="w-48 border-r p-2 overflow-y-auto bg-muted/20">
              <div className="flex items-center gap-2 text-sm font-medium mb-2 text-muted-foreground">
                <History className="h-4 w-4" aria-hidden="true" />
                History
              </div>
              {ica.results.map((result) => (
                <button
                  key={result.id}
                  className={`w-full p-2 rounded cursor-pointer text-sm mb-1 transition-colors text-left ${
                    selectedResultId === result.id
                      ? "bg-primary/10 border border-primary"
                      : "hover:bg-muted border border-transparent"
                  }`}
                  onClick={() => setSelectedResultId(result.id)}
                >
                  <div className="font-medium">
                    {result.results.components.length} ICs
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(result.created_at).toLocaleTimeString()}
                  </div>
                </button>
              ))}
            </div>

            {/* Selected Result Display */}
            <div className="flex-1 overflow-hidden">
              {selectedResult ? (
                <ICAResults
                  result={selectedResult}
                  markedComponents={ica.markedComponents}
                  onToggleMarked={ica.toggleComponent}
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
