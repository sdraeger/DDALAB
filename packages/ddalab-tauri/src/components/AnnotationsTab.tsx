import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { TauriService } from "@/services/tauriService";
import { ApiService } from "@/services/apiService";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Download,
  Upload,
  FileText,
  Trash2,
  Folder,
  ChevronDown,
} from "lucide-react";
import { PlotAnnotation } from "@/types/annotations";
import { ImportPreviewDialog } from "@/components/ImportPreviewDialog";

interface AnnotationWithFile {
  annotation: PlotAnnotation;
  channel?: string;
  isGlobal: boolean;
  filePath: string;
}

interface FileAnnotationsResult {
  global_annotations: any[];
  channel_annotations: Record<string, any[]>;
}

export function AnnotationsTab() {
  // OPTIMIZED: Select specific properties instead of entire objects to prevent re-renders
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  // Use useShallow for object selectors to prevent re-renders on deep changes
  const storeAnnotations = useAppStore(
    useShallow((state) => state.annotations),
  );
  const ddaAnalysisHistory = useAppStore(
    useShallow((state) => state.dda.analysisHistory),
  );
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis);
  const loadAllFileAnnotations = useAppStore(
    (state) => state.loadAllFileAnnotations,
  );

  const [annotationsByFile, setAnnotationsByFile] = useState<
    Map<string, AnnotationWithFile[]>
  >(new Map());
  const [ddaAnnotationCount, setDDAAnnotationCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingAll, setIsLoadingAll] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const currentFilePath = selectedFile?.file_path;

  // Load annotations from ALL files on mount
  useEffect(() => {
    const loadAll = async () => {
      setIsLoadingAll(true);
      await loadAllFileAnnotations();
      setIsLoadingAll(false);
    };
    loadAll();
  }, [loadAllFileAnnotations]);

  // Load annotations from store (includes both time series and DDA annotations)
  useEffect(() => {
    loadAllAnnotations();
  }, [storeAnnotations]);

  const loadAllAnnotations = () => {
    const annotationsMap = new Map<string, AnnotationWithFile[]>();
    let ddaCount = 0;

    // Load time series annotations from store
    Object.entries(storeAnnotations.timeSeries).forEach(
      ([filePath, fileAnnotations]) => {
        const allAnnotations: AnnotationWithFile[] = [];

        // Add global annotations
        fileAnnotations.globalAnnotations.forEach((ann) => {
          allAnnotations.push({
            annotation: ann,
            isGlobal: true,
            filePath,
          });
        });

        // Add channel-specific annotations
        if (fileAnnotations.channelAnnotations) {
          Object.entries(fileAnnotations.channelAnnotations).forEach(
            ([channel, anns]) => {
              anns.forEach((ann) => {
                allAnnotations.push({
                  annotation: ann,
                  channel,
                  isGlobal: false,
                  filePath,
                });
              });
            },
          );
        }

        // Sort by position
        allAnnotations.sort(
          (a, b) => a.annotation.position - b.annotation.position,
        );
        annotationsMap.set(filePath, allAnnotations);
      },
    );

    // Count DDA annotations
    Object.values(storeAnnotations.ddaResults).forEach((ddaResult) => {
      ddaCount += ddaResult.annotations.length;
    });

    setAnnotationsByFile(annotationsMap);
    setDDAAnnotationCount(ddaCount);
  };

  const handleExport = async (
    filePath: string,
    format: "json" | "csv" = "json",
  ) => {
    try {
      const exportedPath = await TauriService.exportAnnotations(
        filePath,
        format,
      );
      if (exportedPath) {
        console.log(
          `Annotations exported to ${format.toUpperCase()}:`,
          exportedPath,
        );
        setSuccessMessage(
          `Annotations exported successfully as ${format.toUpperCase()}`,
        );
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      console.error("Failed to export annotations:", err);
      setError(
        err instanceof Error ? err.message : "Failed to export annotations",
      );
    }
  };

  const handleExportAll = async (format: "json" | "csv" = "json") => {
    try {
      const exportedPath = await TauriService.exportAllAnnotations(format);
      if (exportedPath) {
        console.log(
          `All annotations exported to ${format.toUpperCase()}:`,
          exportedPath,
        );
        setSuccessMessage(
          `All annotations exported successfully as ${format.toUpperCase()}`,
        );
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      console.error("Failed to export all annotations:", err);
      setError(
        err instanceof Error ? err.message : "Failed to export all annotations",
      );
    }
  };

  const handleImport = async () => {
    if (!currentFilePath) return;

    try {
      const preview =
        await TauriService.previewImportAnnotations(currentFilePath);

      if (!preview) {
        setError("No annotation file selected");
        return;
      }

      setPreviewData(preview);
      setIsPreviewOpen(true);
      setError(null);
    } catch (err) {
      console.error("Failed to preview import annotations:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to preview import annotations",
      );
    }
  };

  const handleConfirmImport = useCallback(
    async (
      importFilePath: string,
      targetFilePath: string,
      selectedIds: string[],
    ) => {
      try {
        const importedCount = await TauriService.importSelectedAnnotations(
          importFilePath,
          targetFilePath,
          selectedIds,
        );

        setError(null);
        setSuccessMessage(
          `Successfully imported ${importedCount} annotation${importedCount !== 1 ? "s" : ""}`,
        );

        setTimeout(() => setSuccessMessage(null), 5000);

        await loadAllFileAnnotations();
        setIsPreviewOpen(false);
        setPreviewData(null);
      } catch (err) {
        console.error("Failed to import selected annotations:", err);
        setError(
          err instanceof Error
            ? err.message
            : "Failed to import selected annotations",
        );
      }
    },
    [loadAllFileAnnotations],
  );

  const handleCloseDialog = useCallback(() => {
    setIsPreviewOpen(false);
    setPreviewData(null);
  }, []);

  const handleDelete = async (
    id: string,
    filePath: string,
    channel?: string,
  ) => {
    const deleteAnnotation = useAppStore.getState().deleteTimeSeriesAnnotation;
    deleteAnnotation(filePath, id, channel);
  };

  const handleTimeSeriesAnnotationClick = (
    filePath: string,
    position: number,
  ) => {
    try {
      // Get store state
      const storeState = useAppStore.getState();

      // Check if this file is already selected
      const file = storeState.fileManager.selectedFile;

      if (!file || file.file_path !== filePath) {
        console.warn("[ANNOTATION] File not selected:", filePath);
        setError(`Please select the file first: ${filePath.split("/").pop()}`);
        return;
      }

      // Calculate time window from plot state
      const sampleRate = file.sample_rate || 256;
      const chunkSize = storeState.plot.chunkSize || 5 * sampleRate; // Default to 5 seconds if not set
      const timeWindow = chunkSize / sampleRate;

      // Center the view around the annotation
      // Start at annotation position minus half the time window
      let centeredStart = position - timeWindow / 2;

      // Clamp to valid bounds
      // Don't go before start of file
      centeredStart = Math.max(0, centeredStart);
      // Don't go past end of file (ensure full window fits)
      const maxStart = Math.max(0, file.duration - timeWindow);
      centeredStart = Math.min(maxStart, centeredStart);

      // CRITICAL FIX: Convert time (seconds) to samples
      // The plot state expects chunkStart in samples, not seconds
      const centeredStartSamples = Math.floor(centeredStart * sampleRate);

      console.log("[ANNOTATION] Centering on annotation:", {
        filePath,
        annotationPosition: position,
        timeWindow,
        centeredStart,
        centeredStartSamples,
        sampleRate,
      });

      // Update plot position - pass samples, not time
      storeState.updatePlotState({ chunkStart: centeredStartSamples });

      // Navigate to timeseries tab
      setPrimaryNav("explore");
      setSecondaryNav("timeseries");

      console.log(
        "[ANNOTATION] Navigated to time series annotation (centered)",
      );
    } catch (err) {
      console.error("[ANNOTATION] Error navigating to annotation:", err);
      setError(
        err instanceof Error ? err.message : "Failed to navigate to annotation",
      );
    }
  };

  const handleDDAAnnotationClick = (
    resultId: string,
    variantId: string,
    plotType: string,
  ) => {
    try {
      // Find the DDA result
      const result = ddaAnalysisHistory.find((r) => r.id === resultId);

      if (!result) {
        console.warn("[ANNOTATION] DDA result not found:", resultId);
        setError(`DDA result not found: ${resultId}`);
        return;
      }

      // Set as current analysis
      setCurrentAnalysis(result);

      // Navigate to DDA tab
      setPrimaryNav("analyze");

      // Note: The DDA component should handle showing the correct variant/plot type
      // based on what's in the URL or state
    } catch (err) {
      console.error("[ANNOTATION] Error navigating to DDA result:", err);
      setError(
        err instanceof Error ? err.message : "Failed to navigate to DDA result",
      );
    }
  };

  const formatPosition = (position: number) => {
    const minutes = Math.floor(position / 60);
    const seconds = (position % 60).toFixed(2);
    return `${minutes}:${seconds.padStart(5, "0")}`;
  };

  const totalAnnotations = Array.from(annotationsByFile.values()).reduce(
    (sum, annotations) => sum + annotations.length,
    0,
  );

  return (
    <div className="h-full flex flex-col p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">All Annotations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {totalAnnotations} time series annotations across{" "}
            {annotationsByFile.size}{" "}
            {annotationsByFile.size === 1 ? "file" : "files"}
            {ddaAnnotationCount > 0 &&
              ` • ${ddaAnnotationCount} DDA result annotations`}
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="default"
                size="sm"
                disabled={totalAnnotations === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export All
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExportAll("json")}>
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportAll("csv")}>
                Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={handleImport}
            variant="outline"
            size="sm"
            disabled={!currentFilePath}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-md">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 text-green-700 dark:text-green-400 px-4 py-3 rounded-md">
          {successMessage}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoadingAll ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <div className="h-12 w-12 mx-auto mb-4 animate-spin">⏳</div>
              <p className="text-lg">Loading annotations...</p>
              <p className="text-sm mt-2">Scanning all files for annotations</p>
            </div>
          </div>
        ) : annotationsByFile.size === 0 && ddaAnnotationCount === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">No annotations found</p>
              <p className="text-sm mt-2">
                Add annotations in the Data Visualization or DDA Results tabs
              </p>
            </div>
          </div>
        ) : (
          <Accordion
            type="multiple"
            className="w-full"
            defaultValue={currentFilePath ? [currentFilePath] : []}
          >
            {Array.from(annotationsByFile.entries()).map(
              ([filePath, annotations]) => (
                <AccordionItem key={filePath} value={filePath}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2 flex-1">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1 text-left">
                        <div className="font-medium">
                          {filePath.split("/").pop()}
                        </div>
                        <div className="text-xs text-muted-foreground font-normal">
                          {filePath}
                        </div>
                      </div>
                      <Badge variant="secondary" className="mr-4">
                        {annotations.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pt-2">
                      <div className="flex justify-end mb-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Download className="h-4 w-4 mr-2" />
                              Export ({annotations.length})
                              <ChevronDown className="h-4 w-4 ml-2" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => handleExport(filePath, "json")}
                            >
                              Export as JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleExport(filePath, "csv")}
                            >
                              Export as CSV
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {annotations.map((item) => (
                        <Card
                          key={item.annotation.id}
                          className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
                          onClick={() =>
                            handleTimeSeriesAnnotationClick(
                              filePath,
                              item.annotation.position,
                            )
                          }
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-semibold">
                                  {item.annotation.label}
                                </h3>
                                {item.isGlobal ? (
                                  <Badge variant="secondary">Global</Badge>
                                ) : (
                                  <Badge variant="outline">
                                    {item.channel}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="font-mono">
                                  {formatPosition(item.annotation.position)}
                                </Badge>
                              </div>
                              {item.annotation.description && (
                                <p className="text-sm text-muted-foreground">
                                  {item.annotation.description}
                                </p>
                              )}
                              {item.annotation.visible_in_plots &&
                                item.annotation.visible_in_plots.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {item.annotation.visible_in_plots
                                      .slice(0, 3)
                                      .map((plotId) => (
                                        <Badge
                                          key={plotId}
                                          variant="secondary"
                                          className="text-xs"
                                        >
                                          {plotId === "timeseries"
                                            ? "Time Series"
                                            : plotId.split(":")[1]}
                                        </Badge>
                                      ))}
                                    {item.annotation.visible_in_plots.length >
                                      3 && (
                                      <Badge
                                        variant="secondary"
                                        className="text-xs"
                                      >
                                        +
                                        {item.annotation.visible_in_plots
                                          .length - 3}{" "}
                                        more
                                      </Badge>
                                    )}
                                  </div>
                                )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent card click
                                handleDelete(
                                  item.annotation.id,
                                  filePath,
                                  item.channel,
                                );
                              }}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          {item.annotation.color && (
                            <div className="mt-2 flex items-center gap-2">
                              <div
                                className="w-4 h-4 rounded border"
                                style={{
                                  backgroundColor: item.annotation.color,
                                }}
                              />
                              <span className="text-xs text-muted-foreground font-mono">
                                {item.annotation.color}
                              </span>
                            </div>
                          )}
                        </Card>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ),
            )}
          </Accordion>
        )}

        {/* DDA Result Annotations Section */}
        {ddaAnnotationCount > 0 && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-4">
              DDA Result Annotations
            </h3>
            <div className="space-y-4">
              {Object.entries(storeAnnotations.ddaResults).map(
                ([key, ddaResult]) =>
                  ddaResult.annotations.length > 0 && (
                    <Card key={key} className="p-4">
                      <div className="mb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary">
                            {ddaResult.plotType}
                          </Badge>
                          <Badge variant="outline">{ddaResult.variantId}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Analysis ID: {ddaResult.resultId.slice(0, 8)}...
                        </p>
                      </div>
                      <div className="space-y-2">
                        {ddaResult.annotations.map((ann) => (
                          <div
                            key={ann.id}
                            className="flex items-center justify-between p-2 bg-muted/50 rounded cursor-pointer hover:bg-muted transition-colors"
                            onClick={() =>
                              handleDDAAnnotationClick(
                                ddaResult.resultId,
                                ddaResult.variantId,
                                ddaResult.plotType,
                              )
                            }
                          >
                            <div className="flex-1">
                              <span className="font-medium text-sm">
                                {ann.label}
                              </span>
                              {ann.description && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {ann.description}
                                </p>
                              )}
                              {ann.visible_in_plots &&
                                ann.visible_in_plots.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {ann.visible_in_plots
                                      .slice(0, 3)
                                      .map((plotId) => (
                                        <Badge
                                          key={plotId}
                                          variant="outline"
                                          className="text-xs"
                                        >
                                          {plotId === "timeseries"
                                            ? "Time Series"
                                            : plotId
                                                .split(":")
                                                .slice(1)
                                                .join(" ")}
                                        </Badge>
                                      ))}
                                    {ann.visible_in_plots.length > 3 && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        +{ann.visible_in_plots.length - 3} more
                                      </Badge>
                                    )}
                                  </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                              {ann.color && (
                                <div
                                  className="w-3 h-3 rounded border"
                                  style={{ backgroundColor: ann.color }}
                                />
                              )}
                              <span className="text-xs text-muted-foreground font-mono">
                                {ann.position.toFixed(2)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ),
              )}
            </div>
          </div>
        )}
      </div>

      <div className="text-sm text-muted-foreground pt-4 border-t">
        <p>
          Total annotations: <strong>{totalAnnotations}</strong> time series
          annotations across <strong>{annotationsByFile.size}</strong>{" "}
          {annotationsByFile.size === 1 ? "file" : "files"}
          {ddaAnnotationCount > 0 && (
            <>
              {" "}
              • <strong>{ddaAnnotationCount}</strong> DDA result annotations
            </>
          )}
        </p>
      </div>

      <ImportPreviewDialog
        isOpen={isPreviewOpen}
        onClose={handleCloseDialog}
        previewData={previewData}
        onConfirm={handleConfirmImport}
      />
    </div>
  );
}
