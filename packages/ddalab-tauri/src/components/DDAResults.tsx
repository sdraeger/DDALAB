"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  useTransition,
} from "react";
import { useAppStore } from "@/store/appStore";
import { profiler } from "@/utils/performance";
import {
  throttle,
  debouncedUpdate,
  cancelDebouncedUpdate,
} from "@/utils/debounce";
import { DDAResult } from "@/types/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChannelSelector } from "@/components/ChannelSelector";
import { Loader2 } from "lucide-react";
import "uplot/dist/uPlot.min.css";
import { loggers } from "@/lib/logger";
import { usePopoutWindows } from "@/hooks/usePopoutWindows";
import { useDDAAnnotations } from "@/hooks/useAnnotations";
import { useDDAExport } from "@/hooks/useDDAExport";
import { AnnotationContextMenu } from "@/components/annotations/AnnotationContextMenu";
import { AnnotationMarker } from "@/components/annotations/AnnotationMarker";
import { PlotInfo } from "@/types/annotations";
import { PlotLoadingSkeleton } from "@/components/dda/PlotLoadingSkeleton";
import { NetworkMotifPlot } from "@/components/dda/NetworkMotifPlot";
import { ResizeHandle } from "@/components/dda/ResizeHandle";
import { getVariantColor, VARIANT_ORDER } from "@/types/variantConfig";
import type { ViewMode } from "@/components/dda/ViewModeSelector";
import type { ColorScheme } from "@/components/dda/ColorSchemePicker";
import { ChartErrorBoundary } from "@/components/ChartErrorBoundary";
import { ShareResultDialog } from "@/components/dda/ShareResultDialog";
import { ExportMenu } from "@/components/dda/ExportMenu";
import { ColorRangeControl } from "@/components/dda/ColorRangeControl";
import { PlotToolbar } from "@/components/dda/PlotToolbar";
import {
  DDAHeatmapPlot,
  type DDAHeatmapPlotHandle,
} from "@/components/dda/DDAHeatmapPlot";
import {
  DDALinePlot,
  type DDALinePlotHandle,
} from "@/components/dda/DDALinePlot";
import { PhaseSpacePlot } from "@/components/dda/PhaseSpacePlot";

interface DDAResultsProps {
  result: DDAResult;
}

// Internal component (will be wrapped with memo at export)
function DDAResultsComponent({ result }: DDAResultsProps) {
  // Progressive rendering to prevent UI freeze
  // Render controls first, defer heavy plot containers to next frame
  const [showPlots, setShowPlots] = useState(false);

  // useTransition for non-blocking heavy state updates
  // This allows the UI to remain responsive while processing channel/variant changes
  const [isPending, startTransition] = useTransition();

  // Transition-wrapped handlers for heavy state updates
  // These mark updates as non-urgent so React can interrupt them for user interactions
  const handleChannelSelectionChange = useCallback(
    (channels: string[]) => {
      startTransition(() => {
        setSelectedChannels(channels);
      });
    },
    [startTransition],
  );

  const handleVariantChange = useCallback(
    (variantIndex: number) => {
      startTransition(() => {
        setSelectedVariant(variantIndex);
      });
    },
    [startTransition],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      startTransition(() => {
        setViewMode(mode);
      });
    },
    [startTransition],
  );

  const handleColorSchemeChange = useCallback(
    (scheme: ColorScheme) => {
      startTransition(() => {
        setColorScheme(scheme);
      });
    },
    [startTransition],
  );

  // Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Popout windows for broadcasting state changes
  const { broadcastToType } = usePopoutWindows();

  // Only select sample_rate, not the entire fileManager object
  const sampleRate = useAppStore(
    (state) => state.fileManager.selectedFile?.sample_rate || 256,
  );
  const filePath = useAppStore(
    (state) => state.fileManager.selectedFile?.file_path || "",
  );
  const fileChannels = useAppStore(
    (state) => state.fileManager.selectedFile?.channels || [],
  );
  const heatmapRef = useRef<HTMLDivElement | null>(null);
  const linePlotRef = useRef<HTMLDivElement | null>(null);

  const heatmapPlotRef = useRef<DDAHeatmapPlotHandle>(null);
  const linePlotPlotRef = useRef<DDALinePlotHandle>(null);

  // Synchronize internal refs with subcomponent refs for export functionality
  useEffect(() => {
    heatmapRef.current = heatmapPlotRef.current?.getContainerRef() || null;
    linePlotRef.current = linePlotPlotRef.current?.getContainerRef() || null;
  });

  const lastBroadcastTime = useRef<number>(0);
  const broadcastThrottleMs = 500; // Only broadcast every 500ms max
  const lastAnnotationCount = useRef<{ heatmap: number; lineplot: number }>({
    heatmap: 0,
    lineplot: 0,
  });

  // Helper to read persisted height
  const getPersistedHeight = (key: string, defaultValue: number) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? parseInt(saved) : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [colorScheme, setColorScheme] = useState<ColorScheme>("viridis");
  const [heatmapHeight, setHeatmapHeight] = useState(() =>
    getPersistedHeight("dda-heatmap-height", 500),
  );
  const [linePlotHeight, setLinePlotHeight] = useState(() =>
    getPersistedHeight("dda-lineplot-height", 400),
  );

  // CRITICAL FIX: Progressive rendering - defer plot containers to prevent UI freeze
  // Render controls first, then mount heavy plot containers on next frame
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setShowPlots(true);
    });
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Persist plot heights to localStorage with debouncing
  useEffect(() => {
    debouncedUpdate(
      "dda-heatmap-height",
      () => {
        try {
          localStorage.setItem("dda-heatmap-height", heatmapHeight.toString());
        } catch {
          // Ignore localStorage errors (e.g., private browsing)
        }
      },
      300, // Debounce for 300ms to avoid excessive writes during resize
    );
  }, [heatmapHeight]);

  useEffect(() => {
    debouncedUpdate(
      "dda-lineplot-height",
      () => {
        try {
          localStorage.setItem(
            "dda-lineplot-height",
            linePlotHeight.toString(),
          );
        } catch {
          // Ignore localStorage errors
        }
      },
      300, // Debounce for 300ms to avoid excessive writes during resize
    );
  }, [linePlotHeight]);

  // Cleanup debounced localStorage writes on unmount
  useEffect(() => {
    return () => {
      cancelDebouncedUpdate("dda-heatmap-height");
      cancelDebouncedUpdate("dda-lineplot-height");
    };
  }, []);

  // Get available channels from the CURRENT variant's dda_matrix (source of truth)
  // NOTE: This needs to be computed AFTER currentVariantData, so we'll move it later

  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => {
    const firstVariant = result.results.variants[0];
    if (firstVariant && firstVariant.dda_matrix) {
      return Object.keys(firstVariant.dda_matrix);
    }
    return result.channels;
  });

  const [selectedVariant, setSelectedVariant] = useState<number>(0);
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1]);
  const [autoScale, setAutoScale] = useState(true);

  const availableVariants = useMemo(() => {
    if (result.results.variants && result.results.variants.length > 0) {
      return [...result.results.variants].sort((a, b) => {
        const orderA = VARIANT_ORDER[a.variant_id] ?? 99;
        const orderB = VARIANT_ORDER[b.variant_id] ?? 99;
        return orderA - orderB;
      });
    }
    // Fallback to legacy format
    if (result.results.dda_matrix) {
      return [
        {
          variant_id: "legacy",
          variant_name: "Combined Results",
          dda_matrix: result.results.dda_matrix,
          exponents: result.results.exponents || {},
          quality_metrics: result.results.quality_metrics || {},
        },
      ];
    }
    return [];
  }, [result.id]); // Only recalculate when result.id changes, not when object ref changes

  // Safe scales array - derives from dda_matrix if scales is missing from stored results
  const safeScales = useMemo((): number[] => {
    // Use existing scales if available
    const originalScales = result.results?.scales;
    if (
      originalScales &&
      Array.isArray(originalScales) &&
      originalScales.length > 0
    ) {
      return originalScales;
    }

    // Derive scales from dda_matrix data if available
    const firstVariant = availableVariants[0];
    if (firstVariant?.dda_matrix) {
      const firstChannel = Object.values(firstVariant.dda_matrix)[0];
      if (Array.isArray(firstChannel) && firstChannel.length > 0) {
        return Array.from({ length: firstChannel.length }, (_, i) => i);
      }
    }

    return [];
  }, [result.results?.scales, availableVariants]);

  // Generate available plots for annotation visibility
  const availablePlots = useMemo<PlotInfo[]>(() => {
    const plots: PlotInfo[] = [
      { id: "timeseries", label: "Data Visualization" },
    ];

    // Add all DDA variant plots - use for...of for better performance
    for (const variant of availableVariants) {
      plots.push({
        id: `dda:${variant.variant_id}:heatmap`,
        label: `${variant.variant_name} - Heatmap`,
      });
      plots.push({
        id: `dda:${variant.variant_id}:lineplot`,
        label: `${variant.variant_name} - Line Plot`,
      });
    }

    return plots;
  }, [availableVariants]);

  // Memoize current variant data to prevent re-renders when variant hasn't changed
  const currentVariantData = useMemo(
    () => availableVariants[selectedVariant] || availableVariants[0],
    [availableVariants, selectedVariant],
  );

  // Get available channels from the CURRENT variant's dda_matrix
  const availableChannels = useMemo(() => {
    if (currentVariantData?.dda_matrix) {
      return Object.keys(currentVariantData.dda_matrix);
    }
    return result.channels;
  }, [currentVariantData?.dda_matrix, result.channels]);

  // Update selectedChannels when variant changes
  useEffect(() => {
    if (!currentVariantData?.dda_matrix) return;

    setSelectedChannels((prev) => {
      const hasChanged =
        prev.length !== availableChannels.length ||
        prev.some((ch, i) => ch !== availableChannels[i]);
      return hasChanged ? availableChannels : prev;
    });
  }, [currentVariantData?.variant_id, result.id, availableChannels]);

  // Reset view mode to default when switching to a variant that doesn't support the current view

  // Extract current variant ID for annotation hooks
  const currentVariantId = currentVariantData?.variant_id || "legacy";

  // Annotation hooks for heatmap and line plot
  const heatmapAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: currentVariantId,
    plotType: "heatmap",
    ddaResult: result,
    sampleRate: sampleRate,
  });

  const linePlotAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: currentVariantId,
    plotType: "line",
    ddaResult: result,
    sampleRate: sampleRate,
  });

  // Export functionality hook - extracts all export/share/popout logic
  const {
    exportPlot,
    exportData,
    exportAllData,
    handlePopOut,
    handleShare,
    getExistingShareLink,
    isSyncConnected,
  } = useDDAExport({
    result,
    selectedVariant,
    availableVariants,
    selectedChannels,
    viewMode,
    colorScheme,
    colorRange,
    autoScale,
    heatmapRef,
    linePlotRef,
    heatmapAnnotations: heatmapAnnotations.annotations,
    linePlotAnnotations: linePlotAnnotations.annotations,
  });

  const getCurrentVariantData = () => {
    const current = availableVariants[selectedVariant] || availableVariants[0];
    return current;
  };

  // Open share dialog
  const openShareDialog = useCallback(() => {
    setShowShareDialog(true);
  }, []);

  // Broadcast state changes to popout windows
  useEffect(() => {
    const now = Date.now();
    const timeSinceLastBroadcast = now - lastBroadcastTime.current;

    const currentHeatmapCount = heatmapAnnotations.annotations.length;
    const currentLineplotCount = linePlotAnnotations.annotations.length;
    const annotationsChanged =
      currentHeatmapCount !== lastAnnotationCount.current.heatmap ||
      currentLineplotCount !== lastAnnotationCount.current.lineplot;

    // Throttle broadcasts to prevent excessive updates, UNLESS annotations just loaded
    if (timeSinceLastBroadcast < broadcastThrottleMs && !annotationsChanged) {
      return;
    }

    lastBroadcastTime.current = now;
    lastAnnotationCount.current = {
      heatmap: currentHeatmapCount,
      lineplot: currentLineplotCount,
    };

    const ddaResultsData = {
      result,
      uiState: {
        selectedVariant,
        colorScheme,
        viewMode,
        selectedChannels,
        colorRange,
        autoScale,
      },
      annotations: {
        heatmap: heatmapAnnotations.annotations,
        lineplot: linePlotAnnotations.annotations,
      },
    };

    broadcastToType("dda-results", ddaResultsData).catch(() => {});
  }, [
    result.id,
    selectedVariant,
    colorScheme,
    viewMode,
    selectedChannels,
    colorRange,
    autoScale,
    broadcastToType,
    heatmapAnnotations.annotations,
    linePlotAnnotations.annotations,
  ]);

  return (
    <div className="flex flex-col pb-4">
      {/* Controls */}
      <Card className="flex-shrink-0">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                DDA Results Visualization
              </CardTitle>
              <CardDescription>
                Analysis from {new Date(result.created_at).toLocaleDateString()}{" "}
                • {selectedChannels.length} channels
              </CardDescription>
            </div>
            <ExportMenu
              onExportData={exportData}
              onExportPlot={exportPlot}
              onExportAllData={exportAllData}
              onShare={openShareDialog}
              onPopOut={handlePopOut}
              showShare={isSyncConnected}
              showPopOut={true}
              showExportAll={availableVariants.length > 1}
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Primary Toolbar - View Controls */}
          <PlotToolbar
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            colorScheme={colorScheme}
            onColorSchemeChange={handleColorSchemeChange}
            hasNetworkMotifs={!!currentVariantData?.network_motifs}
            onResetZoom={() => {
              heatmapPlotRef.current?.resetZoom();
              linePlotPlotRef.current?.resetZoom();
            }}
            onResetAll={() => {
              startTransition(() => {
                setSelectedChannels(result.channels);
                setColorRange([0, 1]);
                setAutoScale(true);
              });
            }}
          />

          {/* Channel Selection */}
          <ChannelSelector
            channels={availableChannels}
            selectedChannels={selectedChannels}
            onSelectionChange={handleChannelSelectionChange}
            label="Channels"
            description="Select channels to display in results"
            variant="compact"
            maxHeight="max-h-32"
          />

          {/* Heatmap Color Range Control */}
          {(viewMode === "heatmap" || viewMode === "all") && (
            <ColorRangeControl
              colorRange={colorRange}
              onColorRangeChange={setColorRange}
              autoScale={autoScale}
              onAutoScaleChange={setAutoScale}
            />
          )}
        </CardContent>
      </Card>

      {/* Visualization Area - Deferred rendering to prevent UI freeze */}
      {!showPlots && (
        <Card className="mt-4 animate-fade-in">
          <CardContent className="flex items-center justify-center p-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-sm text-muted-foreground">
                Initializing visualization...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transition pending indicator - shows when heavy updates are processing */}
      {isPending && showPlots && (
        <div className="fixed bottom-4 right-4 z-50 bg-primary/90 text-primary-foreground px-3 py-1.5 rounded-full text-sm font-medium shadow-lg flex items-center gap-2 animate-in slide-in-from-bottom-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Updating...
        </div>
      )}

      {showPlots && availableVariants.length > 1 ? (
        <Tabs
          value={selectedVariant.toString()}
          onValueChange={(v) => handleVariantChange(parseInt(v))}
          className="mt-4 flex-1 flex flex-col gap-0 animate-fade-in"
        >
          <TabsList className="mb-0" style={{ marginBottom: 0 }}>
            {availableVariants.map((variant, index) => {
              const color = getVariantColor(variant.variant_id);
              const isActive = selectedVariant === index;
              return (
                <TabsTrigger
                  key={variant.variant_id}
                  value={index.toString()}
                  className="relative"
                  style={{
                    borderLeft: `4px solid ${color}`,
                    backgroundColor: isActive ? `${color}20` : "transparent",
                  }}
                >
                  {variant.variant_name}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Render all TabsContent (required for Tabs), but conditionally render expensive components inside */}
          {availableVariants.map((variant, index) => (
            <TabsContent
              key={variant.variant_id}
              value={index.toString()}
              className="flex flex-col"
              style={{ marginTop: 0, paddingTop: 0 }}
            >
              {/* Only render plots for the active variant to avoid running effects for invisible tabs */}
              {index === selectedVariant ? (
                <div className="space-y-4">
                  {/* Heatmap */}
                  {(viewMode === "heatmap" || viewMode === "all") && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Matrix Heatmap - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          Log-transformed DDA matrix values across time points
                          and channels
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <DDAHeatmapPlot
                          ref={heatmapPlotRef}
                          variantId={variant.variant_id}
                          ddaMatrix={variant.dda_matrix || {}}
                          selectedChannels={selectedChannels}
                          scales={safeScales}
                          colorScheme={colorScheme}
                          colorRange={colorRange}
                          autoScale={autoScale}
                          onColorRangeChange={setColorRange}
                          height={heatmapHeight}
                          onContextMenu={heatmapAnnotations.openContextMenu}
                        >
                          {/* Annotation overlay - Tabs view */}
                          {heatmapPlotRef.current?.getUplotInstance() &&
                            heatmapAnnotations.annotations.length > 0 && (
                              <svg
                                className="absolute top-0 left-0"
                                style={{
                                  width:
                                    heatmapPlotRef.current.getContainerRef()
                                      ?.clientWidth || 0,
                                  height:
                                    heatmapPlotRef.current.getContainerRef()
                                      ?.clientHeight || 0,
                                  pointerEvents: "none",
                                }}
                              >
                                {heatmapAnnotations.annotations.map(
                                  (annotation) => {
                                    if (safeScales.length === 0) return null;
                                    const u =
                                      heatmapPlotRef.current?.getUplotInstance();
                                    if (!u) return null;

                                    const bbox = u.bbox;
                                    if (!bbox) return null;

                                    const canvasX = u.valToPos(
                                      annotation.position,
                                      "x",
                                    );
                                    if (
                                      canvasX === null ||
                                      canvasX === undefined ||
                                      !isFinite(canvasX)
                                    )
                                      return null;

                                    const xPosition = canvasX + bbox.left;
                                    const yOffset = bbox.top;
                                    const plotHeight = bbox.height;

                                    return (
                                      <AnnotationMarker
                                        key={annotation.id}
                                        annotation={annotation}
                                        plotHeight={plotHeight}
                                        xPosition={xPosition}
                                        yOffset={yOffset}
                                        onRightClick={(e, ann) => {
                                          e.preventDefault();
                                          heatmapAnnotations.openContextMenu(
                                            e.clientX,
                                            e.clientY,
                                            ann.position,
                                            ann,
                                          );
                                        }}
                                        onClick={(ann) => {
                                          const rect = heatmapPlotRef.current
                                            ?.getContainerRef()
                                            ?.getBoundingClientRect();
                                          if (rect) {
                                            heatmapAnnotations.handleAnnotationClick(
                                              ann,
                                              rect.left + xPosition,
                                              rect.top + 50,
                                            );
                                          }
                                        }}
                                      />
                                    );
                                  },
                                )}
                              </svg>
                            )}
                        </DDAHeatmapPlot>

                        <ResizeHandle
                          plotType="heatmap"
                          currentHeight={heatmapHeight}
                          onHeightChange={(newHeight) => {
                            setHeatmapHeight(newHeight);
                            const u =
                              heatmapPlotRef.current?.getUplotInstance();
                            if (u) {
                              u.setSize({
                                width: u.width,
                                height: newHeight,
                              });
                            }
                          }}
                        />

                        {/* Annotation context menu */}
                        {heatmapAnnotations.contextMenu && (
                          <AnnotationContextMenu
                            x={heatmapAnnotations.contextMenu.x}
                            y={heatmapAnnotations.contextMenu.y}
                            plotPosition={
                              heatmapAnnotations.contextMenu.plotPosition
                            }
                            existingAnnotation={
                              heatmapAnnotations.contextMenu.annotation
                            }
                            onCreateAnnotation={
                              heatmapAnnotations.handleCreateAnnotation
                            }
                            onEditAnnotation={
                              heatmapAnnotations.handleUpdateAnnotation
                            }
                            onDeleteAnnotation={
                              heatmapAnnotations.handleDeleteAnnotation
                            }
                            onClose={heatmapAnnotations.closeContextMenu}
                            availablePlots={heatmapAnnotations.availablePlots}
                            currentPlotId={heatmapAnnotations.currentPlotId}
                          />
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Line Plot */}
                  {(viewMode === "lineplot" || viewMode === "all") && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          DDA Time Series - {variant.variant_name}
                        </CardTitle>
                        <CardDescription>
                          DDA output time series - one line per channel (each
                          row of the DDA matrix)
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <DDALinePlot
                          ref={linePlotPlotRef}
                          variantId={variant.variant_id}
                          ddaMatrix={variant.dda_matrix || {}}
                          selectedChannels={selectedChannels}
                          scales={safeScales}
                          height={linePlotHeight}
                          onContextMenu={linePlotAnnotations.openContextMenu}
                        >
                          {/* Annotation overlay - Tabs view */}
                          {linePlotPlotRef.current?.getUplotInstance() &&
                            linePlotAnnotations.annotations.length > 0 && (
                              <svg
                                className="absolute top-0 left-0"
                                style={{
                                  width:
                                    linePlotPlotRef.current.getContainerRef()
                                      ?.clientWidth || 0,
                                  height:
                                    linePlotPlotRef.current.getContainerRef()
                                      ?.clientHeight || 0,
                                  pointerEvents: "none",
                                }}
                              >
                                {linePlotAnnotations.annotations.map(
                                  (annotation) => {
                                    if (safeScales.length === 0) return null;
                                    const u =
                                      linePlotPlotRef.current?.getUplotInstance();
                                    if (!u) return null;

                                    const bbox = u.bbox;
                                    if (!bbox) return null;

                                    const canvasX = u.valToPos(
                                      annotation.position,
                                      "x",
                                    );
                                    if (
                                      canvasX === null ||
                                      canvasX === undefined ||
                                      !isFinite(canvasX)
                                    )
                                      return null;

                                    const xPosition = canvasX + bbox.left;
                                    const yOffset = bbox.top;
                                    const plotHeight = bbox.height;

                                    return (
                                      <AnnotationMarker
                                        key={annotation.id}
                                        annotation={annotation}
                                        plotHeight={plotHeight}
                                        xPosition={xPosition}
                                        yOffset={yOffset}
                                        onRightClick={(e, ann) => {
                                          e.preventDefault();
                                          linePlotAnnotations.openContextMenu(
                                            e.clientX,
                                            e.clientY,
                                            ann.position,
                                            ann,
                                          );
                                        }}
                                        onClick={(ann) => {
                                          const rect = linePlotPlotRef.current
                                            ?.getContainerRef()
                                            ?.getBoundingClientRect();
                                          if (rect) {
                                            linePlotAnnotations.handleAnnotationClick(
                                              ann,
                                              rect.left + xPosition,
                                              rect.top + 50,
                                            );
                                          }
                                        }}
                                      />
                                    );
                                  },
                                )}
                              </svg>
                            )}
                        </DDALinePlot>

                        <ResizeHandle
                          plotType="lineplot"
                          currentHeight={linePlotHeight}
                          onHeightChange={(newHeight) => {
                            setLinePlotHeight(newHeight);
                            const u =
                              linePlotPlotRef.current?.getUplotInstance();
                            if (u) {
                              u.setSize({
                                width: u.width,
                                height: newHeight,
                              });
                            }
                          }}
                        />

                        {/* Annotation context menu */}
                        {linePlotAnnotations.contextMenu && (
                          <AnnotationContextMenu
                            x={linePlotAnnotations.contextMenu.x}
                            y={linePlotAnnotations.contextMenu.y}
                            plotPosition={
                              linePlotAnnotations.contextMenu.plotPosition
                            }
                            existingAnnotation={
                              linePlotAnnotations.contextMenu.annotation
                            }
                            onCreateAnnotation={
                              linePlotAnnotations.handleCreateAnnotation
                            }
                            onEditAnnotation={
                              linePlotAnnotations.handleUpdateAnnotation
                            }
                            onDeleteAnnotation={
                              linePlotAnnotations.handleDeleteAnnotation
                            }
                            onClose={linePlotAnnotations.closeContextMenu}
                            availablePlots={availablePlots}
                            currentPlotId={`dda:${
                              getCurrentVariantData()?.variant_id
                            }:lineplot`}
                          />
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Network Motifs (CD-DDA only) */}
                  {(viewMode === "network" || viewMode === "all") &&
                    variant.network_motifs && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            Network Motifs - {variant.variant_name}
                          </CardTitle>
                          <CardDescription>
                            Directed network graphs showing cross-dynamical
                            relationships between channels at different delays
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <NetworkMotifPlot data={variant.network_motifs} />
                        </CardContent>
                      </Card>
                    )}

                  {/* Phase Space Plot */}
                  {viewMode === "phasespace" && filePath && (
                    <PhaseSpacePlot
                      filePath={filePath}
                      channels={fileChannels}
                      sampleRate={sampleRate}
                      className="min-h-[600px]"
                    />
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-muted-foreground">
                  Switch to this tab to view results
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      ) : showPlots ? (
        <div className="flex flex-col space-y-4 animate-fade-in">
          {/* Single variant view */}
          {/* Heatmap */}
          {(viewMode === "heatmap" || viewMode === "all") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Matrix Heatmap -{" "}
                  {getCurrentVariantData()?.variant_name || "Unknown"}
                </CardTitle>
                <CardDescription>
                  Log-transformed DDA matrix values across time points and
                  channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DDAHeatmapPlot
                  ref={heatmapPlotRef}
                  variantId={getCurrentVariantData()?.variant_id || "unknown"}
                  ddaMatrix={getCurrentVariantData()?.dda_matrix || {}}
                  selectedChannels={selectedChannels}
                  scales={safeScales}
                  colorScheme={colorScheme}
                  colorRange={colorRange}
                  autoScale={autoScale}
                  onColorRangeChange={setColorRange}
                  height={heatmapHeight}
                  onContextMenu={heatmapAnnotations.openContextMenu}
                >
                  {/* Annotation overlay */}
                  {heatmapPlotRef.current?.getUplotInstance() &&
                    heatmapAnnotations.annotations.length > 0 && (
                      <svg
                        className="absolute top-0 left-0"
                        style={{
                          width:
                            heatmapPlotRef.current.getContainerRef()
                              ?.clientWidth || 0,
                          height:
                            heatmapPlotRef.current.getContainerRef()
                              ?.clientHeight || 0,
                          pointerEvents: "none",
                        }}
                      >
                        {heatmapAnnotations.annotations.map((annotation) => {
                          if (safeScales.length === 0) return null;
                          const u = heatmapPlotRef.current?.getUplotInstance();
                          if (!u) return null;

                          const bbox = u.bbox;
                          if (!bbox) return null;

                          const canvasX = u.valToPos(annotation.position, "x");
                          if (canvasX === null || canvasX === undefined)
                            return null;

                          const xPosition = canvasX + bbox.left;
                          const yOffset = bbox.top;
                          const plotHeight = bbox.height;

                          return (
                            <AnnotationMarker
                              key={annotation.id}
                              annotation={annotation}
                              plotHeight={plotHeight}
                              xPosition={xPosition}
                              yOffset={yOffset}
                              onRightClick={(e, ann) => {
                                e.preventDefault();
                                heatmapAnnotations.openContextMenu(
                                  e.clientX,
                                  e.clientY,
                                  ann.position,
                                  ann,
                                );
                              }}
                              onClick={(ann) => {
                                const rect = heatmapPlotRef.current
                                  ?.getContainerRef()
                                  ?.getBoundingClientRect();
                                if (rect) {
                                  heatmapAnnotations.handleAnnotationClick(
                                    ann,
                                    rect.left + xPosition,
                                    rect.top + 50,
                                  );
                                }
                              }}
                            />
                          );
                        })}
                      </svg>
                    )}
                </DDAHeatmapPlot>

                <ResizeHandle
                  plotType="heatmap"
                  currentHeight={heatmapHeight}
                  onHeightChange={(newHeight) => {
                    setHeatmapHeight(newHeight);
                    const u = heatmapPlotRef.current?.getUplotInstance();
                    if (u) {
                      u.setSize({
                        width: u.width,
                        height: newHeight,
                      });
                    }
                  }}
                />

                {/* Annotation context menu */}
                {heatmapAnnotations.contextMenu && (
                  <AnnotationContextMenu
                    x={heatmapAnnotations.contextMenu.x}
                    y={heatmapAnnotations.contextMenu.y}
                    plotPosition={heatmapAnnotations.contextMenu.plotPosition}
                    existingAnnotation={
                      heatmapAnnotations.contextMenu.annotation
                    }
                    onCreateAnnotation={
                      heatmapAnnotations.handleCreateAnnotation
                    }
                    onEditAnnotation={heatmapAnnotations.handleUpdateAnnotation}
                    onDeleteAnnotation={
                      heatmapAnnotations.handleDeleteAnnotation
                    }
                    onClose={heatmapAnnotations.closeContextMenu}
                    availablePlots={heatmapAnnotations.availablePlots}
                    currentPlotId={heatmapAnnotations.currentPlotId}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Line Plot */}
          {(viewMode === "lineplot" || viewMode === "all") && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  DDA Time Series -{" "}
                  {getCurrentVariantData()?.variant_name || "Unknown"}
                </CardTitle>
                <CardDescription>
                  DDA output time series - one line per channel (each row of the
                  DDA matrix)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DDALinePlot
                  ref={linePlotPlotRef}
                  variantId={getCurrentVariantData()?.variant_id || "unknown"}
                  ddaMatrix={getCurrentVariantData()?.dda_matrix || {}}
                  selectedChannels={selectedChannels}
                  scales={safeScales}
                  height={linePlotHeight}
                  onContextMenu={linePlotAnnotations.openContextMenu}
                >
                  {/* Annotation overlay */}
                  {linePlotPlotRef.current?.getUplotInstance() &&
                    linePlotAnnotations.annotations.length > 0 && (
                      <svg
                        className="absolute top-0 left-0"
                        style={{
                          width:
                            linePlotPlotRef.current.getContainerRef()
                              ?.clientWidth || 0,
                          height:
                            linePlotPlotRef.current.getContainerRef()
                              ?.clientHeight || 0,
                          pointerEvents: "none",
                        }}
                      >
                        {linePlotAnnotations.annotations.map((annotation) => {
                          if (safeScales.length === 0) return null;
                          const u = linePlotPlotRef.current?.getUplotInstance();
                          if (!u) return null;

                          // Get uPlot bbox for accurate dimensions and offsets
                          const bbox = u.bbox;
                          if (!bbox) return null;

                          // Use uPlot's valToPos to convert scale value to pixel position (relative to canvas)
                          const canvasX = u.valToPos(annotation.position, "x");
                          if (canvasX === null || canvasX === undefined)
                            return null;

                          // Add bbox offsets since SVG is positioned at (0,0) but canvas starts at (bbox.left, bbox.top)
                          const xPosition = canvasX + bbox.left;
                          const yOffset = bbox.top;
                          const plotHeight = bbox.height;

                          return (
                            <AnnotationMarker
                              key={annotation.id}
                              annotation={annotation}
                              plotHeight={plotHeight}
                              xPosition={xPosition}
                              yOffset={yOffset}
                              onRightClick={(e, ann) => {
                                e.preventDefault();
                                linePlotAnnotations.openContextMenu(
                                  e.clientX,
                                  e.clientY,
                                  ann.position,
                                  ann,
                                );
                              }}
                              onClick={(ann) => {
                                const rect = linePlotPlotRef.current
                                  ?.getContainerRef()
                                  ?.getBoundingClientRect();
                                if (rect) {
                                  linePlotAnnotations.handleAnnotationClick(
                                    ann,
                                    rect.left + xPosition,
                                    rect.top + 50,
                                  );
                                }
                              }}
                            />
                          );
                        })}
                      </svg>
                    )}
                </DDALinePlot>

                <ResizeHandle
                  plotType="lineplot"
                  currentHeight={linePlotHeight}
                  onHeightChange={(newHeight) => {
                    setLinePlotHeight(newHeight);
                    const u = linePlotPlotRef.current?.getUplotInstance();
                    if (u) {
                      u.setSize({
                        width: u.width,
                        height: newHeight,
                      });
                    }
                  }}
                />

                {/* Annotation context menu */}
                {linePlotAnnotations.contextMenu && (
                  <AnnotationContextMenu
                    x={linePlotAnnotations.contextMenu.x}
                    y={linePlotAnnotations.contextMenu.y}
                    plotPosition={linePlotAnnotations.contextMenu.plotPosition}
                    existingAnnotation={
                      linePlotAnnotations.contextMenu.annotation
                    }
                    onCreateAnnotation={
                      linePlotAnnotations.handleCreateAnnotation
                    }
                    onEditAnnotation={
                      linePlotAnnotations.handleUpdateAnnotation
                    }
                    onDeleteAnnotation={
                      linePlotAnnotations.handleDeleteAnnotation
                    }
                    onClose={linePlotAnnotations.closeContextMenu}
                    availablePlots={availablePlots}
                    currentPlotId={`dda:${
                      getCurrentVariantData()?.variant_id
                    }:lineplot`}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Network Motifs (CD-DDA only) - Single variant view */}
          {(viewMode === "network" || viewMode === "all") &&
            getCurrentVariantData()?.network_motifs && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Network Motifs -{" "}
                    {getCurrentVariantData()?.variant_name || "Unknown"}
                  </CardTitle>
                  <CardDescription>
                    Directed network graphs showing cross-dynamical
                    relationships between channels at different delays
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <NetworkMotifPlot
                    data={getCurrentVariantData()!.network_motifs!}
                  />
                </CardContent>
              </Card>
            )}

          {/* Phase Space Plot - Single variant view */}
          {viewMode === "phasespace" && filePath && (
            <PhaseSpacePlot
              filePath={filePath}
              channels={fileChannels}
              sampleRate={sampleRate}
              className="min-h-[600px]"
            />
          )}
        </div>
      ) : null}

      {/* Share Dialog */}
      <ShareResultDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        result={result}
        onShare={handleShare}
        existingShareLink={getExistingShareLink()}
      />
    </div>
  );
}

// Memoized version to prevent unnecessary re-renders
// Only re-render if result.id changes (new analysis loaded)
const DDAResultsMemo = memo(DDAResultsComponent, (prevProps, nextProps) => {
  return prevProps.result.id === nextProps.result.id;
});

// Export wrapped with error boundary for graceful error handling
export function DDAResults(props: DDAResultsProps) {
  return (
    <ChartErrorBoundary chartName="DDA Results" minHeight={400}>
      <DDAResultsMemo {...props} />
    </ChartErrorBoundary>
  );
}
