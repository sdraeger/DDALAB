import { useState, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useShallow } from "zustand/react/shallow";
import { TauriService } from "@/services/tauriService";
import {
  getInitializedFileStateManager,
  isFileStateSystemInitialized,
} from "@/services/fileStateInitializer";
import { TOAST_DURATIONS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  Upload,
  FileText,
  Trash2,
  Folder,
  ChevronDown,
  Search,
} from "lucide-react";
import {
  PlotAnnotation,
  ANNOTATION_CATEGORIES,
  type AnnotationCategoryId,
} from "@/types/annotations";
import { ImportPreviewDialog } from "@/components/ImportPreviewDialog";

interface AnnotationWithFile {
  annotation: PlotAnnotation;
  channel?: string;
  isGlobal: boolean;
  filePath: string;
}

export function AnnotationsTab() {
  const selectedFile = useAppStore((state) => state.fileManager.selectedFile);
  const timeSeriesAnnotations = useAppStore(
    useShallow((state) => state.annotations.timeSeries),
  );
  const ddaResultAnnotations = useAppStore(
    useShallow((state) => state.annotations.ddaResults),
  );
  const persistenceStatus = useAppStore(
    (state) => state.annotations.persistenceStatus,
  );
  const setPrimaryNav = useAppStore((state) => state.setPrimaryNav);
  const setSecondaryNav = useAppStore((state) => state.setSecondaryNav);
  const setCurrentAnalysis = useAppStore((state) => state.setCurrentAnalysis);
  const loadFileAnnotations = useAppStore((state) => state.loadFileAnnotations);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingAll, setIsLoadingAll] = useState(true);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const currentFilePath = selectedFile?.file_path;

  // Load annotations per-file on mount
  useEffect(() => {
    const loadAll = async () => {
      setIsLoadingAll(true);
      try {
        if (isFileStateSystemInitialized()) {
          const fileStateManager = getInitializedFileStateManager();
          const trackedFiles = fileStateManager.getTrackedFiles();
          await Promise.allSettled(
            trackedFiles.map((fp) => loadFileAnnotations(fp)),
          );
        }
      } finally {
        setIsLoadingAll(false);
      }
    };
    loadAll();
  }, [loadFileAnnotations]);

  // Derive annotations from store data (memoized)
  const annotationsByFile = useMemo(() => {
    const annotationsMap = new Map<string, AnnotationWithFile[]>();

    Object.entries(timeSeriesAnnotations).forEach(
      ([filePath, fileAnnotations]) => {
        const allAnnotations: AnnotationWithFile[] = [];

        fileAnnotations.globalAnnotations.forEach((ann) => {
          allAnnotations.push({
            annotation: ann,
            isGlobal: true,
            filePath,
          });
        });

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

        allAnnotations.sort(
          (a, b) => a.annotation.position - b.annotation.position,
        );
        annotationsMap.set(filePath, allAnnotations);
      },
    );

    return annotationsMap;
  }, [timeSeriesAnnotations]);

  // Apply search and category filters
  const filteredAnnotationsByFile = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const filtered = new Map<string, AnnotationWithFile[]>();

    for (const [filePath, annotations] of annotationsByFile) {
      const matching = annotations.filter((item) => {
        // Category filter
        if (categoryFilter !== "all") {
          const annCategory = item.annotation.category || "general";
          if (annCategory !== categoryFilter) return false;
        }

        // Text search
        if (query) {
          const label = item.annotation.label?.toLowerCase() || "";
          const desc = item.annotation.description?.toLowerCase() || "";
          const cat = item.annotation.category?.toLowerCase() || "";
          const fileName = filePath.split("/").pop()?.toLowerCase() || "";
          if (
            !label.includes(query) &&
            !desc.includes(query) &&
            !cat.includes(query) &&
            !fileName.includes(query)
          ) {
            return false;
          }
        }

        return true;
      });

      if (matching.length > 0) {
        filtered.set(filePath, matching);
      }
    }

    return filtered;
  }, [annotationsByFile, searchQuery, categoryFilter]);

  const ddaAnnotationCount = useMemo(() => {
    let count = 0;
    Object.values(ddaResultAnnotations).forEach((ddaResult) => {
      count += ddaResult.annotations.length;
    });
    return count;
  }, [ddaResultAnnotations]);

  const handleExport = useCallback(
    async (filePath: string, format: "json" | "csv" = "json") => {
      try {
        const exportedPath = await TauriService.exportAnnotations(
          filePath,
          format,
        );
        if (exportedPath) {
          setSuccessMessage(
            `Annotations exported successfully as ${format.toUpperCase()}`,
          );
          setTimeout(() => setSuccessMessage(null), TOAST_DURATIONS.SHORT);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to export annotations",
        );
      }
    },
    [],
  );

  const handleExportAll = useCallback(
    async (format: "json" | "csv" = "json") => {
      try {
        const exportedPath = await TauriService.exportAllAnnotations(format);
        if (exportedPath) {
          setSuccessMessage(
            `All annotations exported successfully as ${format.toUpperCase()}`,
          );
          setTimeout(() => setSuccessMessage(null), TOAST_DURATIONS.SHORT);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to export all annotations",
        );
      }
    },
    [],
  );

  const handleImport = useCallback(async () => {
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
      setError(
        err instanceof Error
          ? err.message
          : "Failed to preview import annotations",
      );
    }
  }, [currentFilePath]);

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

        setTimeout(() => setSuccessMessage(null), TOAST_DURATIONS.MEDIUM);

        await loadFileAnnotations(targetFilePath);
        setIsPreviewOpen(false);
        setPreviewData(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to import selected annotations",
        );
      }
    },
    [loadFileAnnotations],
  );

  const handleCloseDialog = useCallback(() => {
    setIsPreviewOpen(false);
    setPreviewData(null);
  }, []);

  const handleDelete = useCallback(
    async (id: string, filePath: string, channel?: string) => {
      const deleteAnnotation =
        useAppStore.getState().deleteTimeSeriesAnnotation;
      deleteAnnotation(filePath, id, channel);
    },
    [],
  );

  const handleTimeSeriesAnnotationClick = useCallback(
    (filePath: string, position: number) => {
      try {
        const storeState = useAppStore.getState();
        const file = storeState.fileManager.selectedFile;

        if (!file || file.file_path !== filePath) {
          setError(
            `Please select the file first: ${filePath.split("/").pop()}`,
          );
          return;
        }

        const sampleRate = file.sample_rate || 256;
        const chunkSize = storeState.plot.chunkSize || 5 * sampleRate;
        const timeWindow = chunkSize / sampleRate;

        let centeredStart = position - timeWindow / 2;
        centeredStart = Math.max(0, centeredStart);
        const maxStart = Math.max(0, file.duration - timeWindow);
        centeredStart = Math.min(maxStart, centeredStart);
        const centeredStartSamples = Math.floor(centeredStart * sampleRate);

        storeState.updatePlotState({ chunkStart: centeredStartSamples });
        setPrimaryNav("explore");
        setSecondaryNav("timeseries");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to navigate to annotation",
        );
      }
    },
    [setPrimaryNav, setSecondaryNav],
  );

  const handleDDAAnnotationClick = useCallback(
    (resultId: string, _variantId: string, _plotType: string) => {
      try {
        const result = useAppStore
          .getState()
          .dda.analysisHistory.find((r) => r.id === resultId);

        if (!result) {
          setError(`DDA result not found: ${resultId}`);
          return;
        }

        setCurrentAnalysis(result);
        setPrimaryNav("analyze");
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to navigate to DDA result",
        );
      }
    },
    [setCurrentAnalysis, setPrimaryNav],
  );

  const formatPosition = useCallback((position: number) => {
    const minutes = Math.floor(position / 60);
    const seconds = (position % 60).toFixed(2);
    return `${minutes}:${seconds.padStart(5, "0")}`;
  }, []);

  const totalAnnotations = Array.from(annotationsByFile.values()).reduce(
    (sum, annotations) => sum + annotations.length,
    0,
  );

  const filteredTotal = Array.from(filteredAnnotationsByFile.values()).reduce(
    (sum, annotations) => sum + annotations.length,
    0,
  );

  const getCategoryBadge = (category?: AnnotationCategoryId) => {
    if (!category) return null;
    const cat = ANNOTATION_CATEGORIES[category];
    if (!cat) return null;
    return (
      <Badge
        variant="outline"
        className="text-xs"
        style={{ borderColor: cat.color, color: cat.color }}
      >
        {cat.label}
      </Badge>
    );
  };

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

      {/* Persistence error banner */}
      {persistenceStatus.lastSaveError && (
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
          Save error: {persistenceStatus.lastSaveError}
        </div>
      )}

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

      {/* Search & Filter bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search annotations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(ANNOTATION_CATEGORIES).map(([id, cat]) => (
              <SelectItem key={id} value={id}>
                <div className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  {cat.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Filtered count indicator */}
      {(searchQuery || categoryFilter !== "all") && (
        <p className="text-xs text-muted-foreground">
          Showing {filteredTotal} of {totalAnnotations} annotations
        </p>
      )}

      <div className="flex-1 overflow-auto">
        {isLoadingAll ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <div className="h-12 w-12 mx-auto mb-4 animate-spin">
                &#x23F3;
              </div>
              <p className="text-lg">Loading annotations...</p>
              <p className="text-sm mt-2">Scanning all files for annotations</p>
            </div>
          </div>
        ) : filteredAnnotationsByFile.size === 0 && ddaAnnotationCount === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">
                {searchQuery || categoryFilter !== "all"
                  ? "No matching annotations"
                  : "No annotations found"}
              </p>
              <p className="text-sm mt-2">
                {searchQuery || categoryFilter !== "all"
                  ? "Try adjusting your search or filter"
                  : "Add annotations in the Data Visualization or DDA Results tabs"}
              </p>
            </div>
          </div>
        ) : (
          <Accordion
            type="multiple"
            className="w-full"
            defaultValue={currentFilePath ? [currentFilePath] : []}
          >
            {Array.from(filteredAnnotationsByFile.entries()).map(
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
                          className="p-4 cursor-pointer hover:bg-accent/50 transition-colors duration-200"
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
                                {getCategoryBadge(item.annotation.category)}
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
                                e.stopPropagation();
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
              {Object.entries(ddaResultAnnotations).map(
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
                            className="flex items-center justify-between p-2 bg-muted/50 rounded cursor-pointer hover:bg-muted transition-colors duration-200"
                            onClick={() =>
                              handleDDAAnnotationClick(
                                ddaResult.resultId,
                                ddaResult.variantId,
                                ddaResult.plotType,
                              )
                            }
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-sm">
                                  {ann.label}
                                </span>
                                {getCategoryBadge(ann.category)}
                              </div>
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
                                  className="w-3 h-3 rounded-full border"
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
