import React, { useEffect, useMemo } from "react";
import { ApiService } from "@/services/apiService";
import { useICAWorkflow } from "@/hooks/useICAAnalysis";
import { ICAAnalysisRequest, ICAParametersRequest } from "@/types/ica";
import { ICAResults } from "./ICAResults";
import { useAppStore } from "@/store/appStore";
import { TauriService, NotificationType } from "@/services/tauriService";
import { ChannelSelector } from "@/components/ChannelSelector";
import { useSearchableItems, createActionItem } from "@/hooks/useSearchable";

interface ICAAnalysisPanelProps {
  apiService: ApiService;
}

export function ICAAnalysisPanel({ apiService }: ICAAnalysisPanelProps) {
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const timeWindow = useAppStore((state) => state.fileManager.timeWindow);

  // Use global ICA state from store for persistence across tab switches
  const icaState = useAppStore((state) => state.ica);
  const updateICAState = useAppStore((state) => state.updateICAState);
  const resetICAChannels = useAppStore((state) => state.resetICAChannels);

  const ica = useICAWorkflow(apiService);

  // Destructure ICA state for convenience
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

  // Helper functions to update state
  const setNComponents = (n: number | undefined) =>
    updateICAState({ nComponents: n });
  const setMaxIterations = (n: number) => updateICAState({ maxIterations: n });
  const setTolerance = (n: number) => updateICAState({ tolerance: n });
  const setCentering = (b: boolean) => updateICAState({ centering: b });
  const setWhitening = (b: boolean) => updateICAState({ whitening: b });
  const setSelectedResultId = (id: string | null) =>
    updateICAState({ selectedResultId: id });

  const selectedResult = ica.results.find((r) => r.id === selectedResultId);

  // Convert indices to channel names for ChannelSelector
  const selectedChannelNames = useMemo(() => {
    if (!selectedFile) return [];
    return icaSelectedChannels
      .filter((idx) => idx < selectedFile.channels.length)
      .map((idx) => selectedFile.channels[idx]);
  }, [icaSelectedChannels, selectedFile]);

  // Handle channel selection changes from ChannelSelector
  const handleChannelSelectionChange = (channelNames: string[]) => {
    if (!selectedFile) return;
    const indices = channelNames
      .map((name) => selectedFile.channels.indexOf(name))
      .filter((idx) => idx !== -1)
      .sort((a, b) => a - b);
    updateICAState({ selectedChannels: indices });
  };

  // Auto-populate channels when file changes (default to first 20 channels)
  // Only reset if channels are empty or if file changed
  useEffect(() => {
    if (selectedFile && selectedFile.channels.length > 0) {
      // Only auto-populate if no channels selected yet (initial load or file change)
      if (icaSelectedChannels.length === 0) {
        const maxDefaultChannels = 20;
        const defaultChannels = selectedFile.channels
          .slice(0, Math.min(maxDefaultChannels, selectedFile.channels.length))
          .map((_, index) => index);
        resetICAChannels(defaultChannels);
        console.log(
          "[ICA] Auto-populated channels:",
          defaultChannels.length,
          "of",
          selectedFile.channels.length,
        );
      }
    }
  }, [selectedFile, icaSelectedChannels.length, resetICAChannels]);

  // Register searchable items for ICA
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

  // Sync global isSubmitting state with actual mutation state
  // This handles the case where mutation completes while component is unmounted
  useEffect(() => {
    // If store says we're submitting but the mutation is not pending,
    // check if we got results and update the store
    if (globalIsSubmitting && !ica.isSubmitting) {
      // Look for a recent result (created in the last minute)
      const recentResult = ica.results.find((r) => {
        const createdAt = new Date(r.created_at).getTime();
        const now = Date.now();
        return now - createdAt < 60000; // Within last minute
      });

      if (recentResult) {
        console.log(
          "[ICA] Found recent result after remount, syncing state:",
          recentResult.id,
        );
        updateICAState({
          isSubmitting: false,
          selectedResultId: recentResult.id,
        });

        // Send notification that was missed
        if (TauriService.isTauri()) {
          TauriService.createNotification(
            "ICA Analysis Complete",
            `Extracted ${recentResult.results.components.length} independent components.`,
            NotificationType.Success,
          ).catch(console.error);
        }
      } else if (ica.submitError) {
        // Mutation failed while unmounted
        console.log("[ICA] Found error after remount, syncing state");
        updateICAState({ isSubmitting: false });
      }
      // If no recent result and no error, the analysis is still running on the server
      // but the mutation was lost - we should reset the state
      else if (ica.results.length > 0) {
        // We have old results but nothing recent - mutation was lost
        console.log(
          "[ICA] Mutation state lost after remount, resetting isSubmitting",
        );
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

  // Channel list for display
  const availableChannels = useMemo(() => {
    return selectedFile?.channels || [];
  }, [selectedFile]);

  // Warning for too many channels
  const channelWarning = useMemo(() => {
    if (icaSelectedChannels.length > 64) {
      return `Warning: ${icaSelectedChannels.length} channels selected. ICA may take a very long time (several minutes).`;
    } else if (icaSelectedChannels.length > 32) {
      return `Note: ${icaSelectedChannels.length} channels selected. ICA may take 1-2 minutes.`;
    }
    return null;
  }, [icaSelectedChannels.length]);

  const handleRunAnalysis = () => {
    console.log("[ICA] handleRunAnalysis called", {
      selectedFile,
      icaSelectedChannels,
      timeWindow,
    });

    if (!selectedFile) {
      console.error("[ICA] No file selected");
      return;
    }

    if (icaSelectedChannels.length === 0) {
      console.error("[ICA] No channels selected");
      return;
    }

    if (icaSelectedChannels.length < 2) {
      console.error("[ICA] At least 2 channels required for ICA");
      return;
    }

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
          ? {
              start: timeWindow.start,
              end: timeWindow.end,
            }
          : undefined,
      parameters,
    };

    console.log("[ICA] Submitting analysis request:", request);
    console.log("[ICA] Selected channels:", icaSelectedChannels.length);

    // Set global submitting state
    updateICAState({ isSubmitting: true });

    // Send native notification
    if (TauriService.isTauri()) {
      TauriService.createNotification(
        "ICA Analysis Started",
        `Processing ${icaSelectedChannels.length} channels. You can switch tabs while this runs.`,
        NotificationType.Info,
      ).catch(console.error);
    }

    try {
      ica.submit(request, {
        onSuccess: (result) => {
          console.log("[ICA] Analysis completed:", result);
          updateICAState({ isSubmitting: false, selectedResultId: result.id });

          if (TauriService.isTauri()) {
            TauriService.createNotification(
              "ICA Analysis Complete",
              `Extracted ${result.results.components.length} independent components.`,
              NotificationType.Success,
            ).catch(console.error);
          }
        },
        onError: (error) => {
          console.error("[ICA] Analysis failed:", error);
          updateICAState({ isSubmitting: false });

          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (TauriService.isTauri()) {
            if (errorMessage.includes("cancelled")) {
              TauriService.createNotification(
                "ICA Analysis Cancelled",
                "Analysis was cancelled by user.",
                NotificationType.Warning,
              ).catch(console.error);
            } else {
              TauriService.createNotification(
                "ICA Analysis Failed",
                errorMessage,
                NotificationType.Error,
              ).catch(console.error);
            }
          }
        },
      });
      console.log("[ICA] submit() called successfully");
    } catch (err) {
      console.error("[ICA] Error calling submit:", err);
      updateICAState({ isSubmitting: false });

      if (TauriService.isTauri()) {
        TauriService.createNotification(
          "ICA Error",
          "Failed to start analysis",
          NotificationType.Error,
        ).catch(console.error);
      }
    }
  };

  const handleCancel = () => {
    console.log("[ICA] Cancel requested");
    ica.cancelSubmit();

    if (TauriService.isTauri()) {
      TauriService.createNotification(
        "Cancelling...",
        "Attempting to cancel ICA analysis",
        NotificationType.Warning,
      ).catch(console.error);
    }
  };

  const handleReconstruct = () => {
    if (!selectedResultId || ica.markedArray.length === 0) return;

    ica.reconstruct({
      analysis_id: selectedResultId,
      components_to_remove: ica.markedArray,
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Configuration Panel */}
      <div className="p-4 border-b space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">ICA Analysis</h2>
          {selectedFile && (
            <span className="text-sm text-muted-foreground">
              {selectedFile.file_name}
            </span>
          )}
        </div>

        {/* Channel Selector */}
        {selectedFile && (
          <div className="space-y-2">
            <ChannelSelector
              channels={availableChannels}
              selectedChannels={selectedChannelNames}
              onSelectionChange={handleChannelSelectionChange}
              disabled={globalIsSubmitting}
              label="Channels for ICA"
              description="Select channels to include in ICA analysis"
              maxHeight="max-h-32"
              variant="compact"
            />

            {/* Channel warning */}
            {channelWarning && (
              <div
                className={`text-xs ${icaSelectedChannels.length > 64 ? "text-orange-500" : "text-yellow-500"}`}
              >
                {channelWarning}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-sm font-medium">Components</label>
            <input
              type="number"
              className="w-full mt-1 px-2 py-1 border rounded text-sm"
              placeholder="Auto"
              value={nComponents || ""}
              onChange={(e) =>
                setNComponents(
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              min={1}
              max={icaSelectedChannels.length || 64}
            />
            <span className="text-xs text-muted-foreground">
              Max: {icaSelectedChannels.length || "N/A"}
            </span>
          </div>

          <div>
            <label className="text-sm font-medium">Max Iterations</label>
            <input
              type="number"
              className="w-full mt-1 px-2 py-1 border rounded text-sm"
              value={maxIterations}
              onChange={(e) => setMaxIterations(parseInt(e.target.value))}
              min={10}
              max={1000}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Tolerance</label>
            <input
              type="number"
              className="w-full mt-1 px-2 py-1 border rounded text-sm"
              value={tolerance}
              onChange={(e) => setTolerance(parseFloat(e.target.value))}
              step={0.0001}
              min={0.00001}
              max={0.1}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={centering}
                onChange={(e) => setCentering(e.target.checked)}
              />
              Centering
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={whitening}
                onChange={(e) => setWhitening(e.target.checked)}
              />
              Whitening
            </label>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            onClick={handleRunAnalysis}
            disabled={
              !selectedFile ||
              globalIsSubmitting ||
              icaSelectedChannels.length < 2
            }
          >
            {globalIsSubmitting
              ? `Running ICA on ${icaSelectedChannels.length} channels...`
              : `Run ICA (${icaSelectedChannels.length} channels)`}
          </button>

          {globalIsSubmitting && (
            <button
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              onClick={handleCancel}
            >
              Cancel
            </button>
          )}

          {selectedResultId &&
            ica.markedArray.length > 0 &&
            !globalIsSubmitting && (
              <button
                className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                onClick={handleReconstruct}
                disabled={ica.isReconstructing}
              >
                {ica.isReconstructing
                  ? "Reconstructing..."
                  : `Remove ${ica.markedArray.length} Component(s)`}
              </button>
            )}
        </div>

        {icaSelectedChannels.length < 2 && selectedFile && (
          <div className="text-sm text-yellow-500">
            Select at least 2 channels to run ICA
          </div>
        )}

        {ica.submitError && (
          <div className="text-sm text-red-500">
            Error: {ica.submitError.message}
          </div>
        )}

        {globalIsSubmitting && (
          <div className="text-sm text-muted-foreground">
            Processing {icaSelectedChannels.length} channels with FastICA
            algorithm...
            {icaSelectedChannels.length > 32 &&
              " This may take a minute or more."}
          </div>
        )}
      </div>

      {/* Results Panel */}
      <div className="flex-1 overflow-hidden">
        {ica.results.length > 0 && (
          <div className="flex h-full">
            {/* Results List */}
            <div className="w-48 border-r p-2 overflow-y-auto">
              <h3 className="text-sm font-medium mb-2">History</h3>
              {ica.results.map((result) => (
                <div
                  key={result.id}
                  className={`p-2 rounded cursor-pointer text-sm mb-1 ${
                    selectedResultId === result.id
                      ? "bg-primary/10 border border-primary"
                      : "hover:bg-muted"
                  }`}
                  onClick={() => setSelectedResultId(result.id)}
                >
                  <div className="font-medium">
                    {result.results.components.length} ICs
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(result.created_at).toLocaleTimeString()}
                  </div>
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
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No ICA analyses yet. Run analysis to see results.
          </div>
        )}
      </div>
    </div>
  );
}

export default ICAAnalysisPanel;
