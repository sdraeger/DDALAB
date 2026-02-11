"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  useTransition,
  lazy,
  Suspense,
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
import { useDDAChannelData } from "@/hooks/useDDAAnalysis";
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
import { ColorRangeControl } from "@/components/dda/ColorRangeControl";
import type { DDAExportActions } from "@/components/dda/DDAToolbar";
import { PlotToolbar } from "@/components/dda/PlotToolbar";
// Lazy-load heavy plot components to prevent bundle evaluation blocking UI
// These components import uPlot which has significant module initialization cost
// By lazy-loading, the uPlot bundle only loads when plots are actually rendered
const DDAHeatmapPlot = lazy(() => {
  const t0 = performance.now();
  console.log("[DDA LAZY] Starting DDAHeatmapPlot import...");
  return import("@/components/dda/DDAHeatmapPlot").then((mod) => {
    console.log(
      `[DDA LAZY] DDAHeatmapPlot loaded in ${(performance.now() - t0).toFixed(1)}ms`,
    );
    return { default: mod.DDAHeatmapPlot };
  });
});
const DDALinePlot = lazy(() => {
  const t0 = performance.now();
  console.log("[DDA LAZY] Starting DDALinePlot import...");
  return import("@/components/dda/DDALinePlot").then((mod) => {
    console.log(
      `[DDA LAZY] DDALinePlot loaded in ${(performance.now() - t0).toFixed(1)}ms`,
    );
    return { default: mod.DDALinePlot };
  });
});
const PhaseSpacePlot = lazy(() => {
  const t0 = performance.now();
  console.log("[DDA LAZY] Starting PhaseSpacePlot import...");
  return import("@/components/dda/PhaseSpacePlot").then((mod) => {
    console.log(
      `[DDA LAZY] PhaseSpacePlot loaded in ${(performance.now() - t0).toFixed(1)}ms`,
    );
    return { default: mod.PhaseSpacePlot };
  });
});

// Type-only imports for handles (no runtime cost)
import type { DDAHeatmapPlotHandle } from "@/components/dda/DDAHeatmapPlot";
import type { DDALinePlotHandle } from "@/components/dda/DDALinePlot";

interface DDAResultsProps {
  result: DDAResult;
  onRegisterExportActions?: (actions: DDAExportActions | null) => void;
}

// Internal component (will be wrapped with memo at export)
function DDAResultsComponent({
  result,
  onRegisterExportActions,
}: DDAResultsProps) {
  // Progressive rendering to prevent UI freeze
  // Render controls first, defer heavy plot containers to next frame
  const [showPlots, setShowPlots] = useState(false);

  // Staggered plot loading to prevent simultaneous WASM computations
  // Heatmap loads first, then lineplot after a delay
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showLinePlot, setShowLinePlot] = useState(false);

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
  // Use longer delays to ensure browser can process input events between chunks
  // Each setTimeout creates a new task, allowing event loop to handle input
  // Note: Data loading state is handled in render logic, not here
  useEffect(() => {
    let timeoutIds: ReturnType<typeof setTimeout>[] = [];

    // First delay: Let the component fully mount and browser process initial render
    const t1 = setTimeout(() => {
      setShowPlots(true);
    }, 16); // One frame delay
    timeoutIds.push(t1);

    // Second delay: Mount heatmap after plots container is ready
    // 100ms gives browser time to process showPlots render + handle input
    const t2 = setTimeout(() => {
      setShowHeatmap(true);
    }, 150);
    timeoutIds.push(t2);

    // Third delay: Mount line plot after heatmap has started its async work
    // 300ms total ensures heatmap worker is running before lineplot starts
    const t3 = setTimeout(() => {
      setShowLinePlot(true);
    }, 350);
    timeoutIds.push(t3);

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
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
  // IMPORTANT: Initialize empty to avoid blocking - will be populated via useEffect
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [channelsInitialized, setChannelsInitialized] = useState(false);

  const [selectedVariant, setSelectedVariant] = useState<number>(0);
  const [colorRange, setColorRange] = useState<[number, number]>([0, 1]);
  const [autoScale, setAutoScale] = useState(true);

  // PERFORMANCE: Use state + deferred effect instead of useMemo for heavy computations
  // This allows the skeleton to render immediately, then compute variants in next frame
  const [availableVariants, setAvailableVariants] = useState<
    typeof result.results.variants
  >([]);

  // Defer variant computation to avoid blocking initial render
  // Use setTimeout (not RAF) to create a new task that doesn't block current frame
  useEffect(() => {
    console.log("[DDAResults] Variant effect triggered", {
      resultId: result.id,
      variantsLength: result.results.variants?.length,
      variants: result.results.variants?.map((v) => v.variant_id),
    });

    const timeoutId = setTimeout(() => {
      let variants: typeof result.results.variants = [];

      if (result.results.variants && result.results.variants.length > 0) {
        variants = [...result.results.variants].sort((a, b) => {
          const orderA = VARIANT_ORDER[a.variant_id] ?? 99;
          const orderB = VARIANT_ORDER[b.variant_id] ?? 99;
          return orderA - orderB;
        });
      } else if (result.results.dda_matrix) {
        // Fallback to legacy format
        variants = [
          {
            variant_id: "legacy",
            variant_name: "Combined Results",
            dda_matrix: result.results.dda_matrix,
            exponents: result.results.exponents || {},
            quality_metrics: result.results.quality_metrics || {},
          },
        ];
      }

      console.log("[DDAResults] Setting availableVariants", {
        count: variants.length,
        ids: variants.map((v) => v.variant_id),
      });
      setAvailableVariants(variants);
    }, 0); // setTimeout(0) creates a new macrotask, allowing input events to process

    return () => clearTimeout(timeoutId);
  }, [result.id, result.results.variants?.length]); // Recalculate when variants are populated

  // Safe scales array - derives from dda_matrix if scales is missing from stored results
  // Use state + effect to avoid blocking with Object.values()
  const [safeScales, setSafeScales] = useState<number[]>(() => {
    // Only use pre-existing scales synchronously (they're already an array)
    const originalScales = result.results?.scales;
    if (
      originalScales &&
      Array.isArray(originalScales) &&
      originalScales.length > 0
    ) {
      return originalScales;
    }
    return [];
  });

  // Generate available plots for annotation visibility
  // PERFORMANCE: Defer until variants are loaded to avoid blocking initial render
  const [availablePlots, setAvailablePlots] = useState<PlotInfo[]>([
    { id: "timeseries", label: "Data Visualization" },
  ]);

  useEffect(() => {
    if (availableVariants.length === 0) return;

    const plots: PlotInfo[] = [
      { id: "timeseries", label: "Data Visualization" },
    ];

    // Add all DDA variant plots
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

    setAvailablePlots(plots);
  }, [availableVariants]);

  // Memoize current variant data to prevent re-renders when variant hasn't changed
  const currentVariantData = useMemo(
    () => availableVariants[selectedVariant] || availableVariants[0],
    [availableVariants, selectedVariant],
  );

  // Get available channels from result metadata (always available)
  // This is the list of channels the analysis was run on
  const [availableChannels, setAvailableChannels] = useState<string[]>(
    () => result.channels || [],
  );

  // PROGRESSIVE LOADING: Fetch channel data on-demand from worker cache
  // The metadata (result) is loaded instantly, but the large dda_matrix data
  // is fetched separately to avoid blocking the UI with structured clone
  const currentVariantId = currentVariantData?.variant_id;
  const {
    data: channelData,
    isLoading: isLoadingChannelData,
    isFetching: isFetchingChannelData,
  } = useDDAChannelData(
    result.id,
    currentVariantId,
    selectedChannels,
    // Only fetch when we have selected channels and the variant is ready
    selectedChannels.length > 0 && !!currentVariantId,
  );

  // Merge fetched channel data with variant metadata for rendering
  // This creates a complete dda_matrix from progressively loaded data
  // TanStack Query keys by variantId, so channelData is always for the current variant
  const effectiveDDAMatrix = useMemo((): Record<string, number[]> => {
    // If we have fetched channel data, use it (TanStack Query guarantees it's for current variant)
    if (channelData?.ddaMatrix) {
      return channelData.ddaMatrix;
    }

    // Fallback to variant's dda_matrix (may be populated for new/live results)
    return currentVariantData?.dda_matrix || {};
  }, [channelData?.ddaMatrix, currentVariantData?.dda_matrix]);

  // EFFECTIVE CHANNELS: The actual channels to render in plots
  // Different variants have different channel naming schemes:
  // - ST: single channels like "EEG1", "EEG2"
  // - CT, CD, DE, SY: channel pairs like "EEG1-EEG2"
  // We need to use the actual keys from effectiveDDAMatrix, not selectedChannels
  const effectiveChannels = useMemo((): string[] => {
    const matrixKeys = Object.keys(effectiveDDAMatrix);
    if (matrixKeys.length === 0) {
      return selectedChannels; // Fallback while loading
    }

    // Check if selectedChannels match the matrix keys
    const hasMatch = selectedChannels.some((ch) => matrixKeys.includes(ch));
    if (hasMatch) {
      // Filter to only channels that exist in the matrix
      return selectedChannels.filter((ch) => matrixKeys.includes(ch));
    }

    // No match - use the matrix keys directly (variant has different channel naming)
    return matrixKeys;
  }, [effectiveDDAMatrix, selectedChannels]);

  // VARIANT CHANNEL SYNC: When channelData returns different channels than selectedChannels
  // (e.g., ST uses "Ch1" but CT uses "Ch1-Ch2"), update selections to match variant
  useEffect(() => {
    if (!channelData?.ddaMatrix) return;

    const variantChannels = Object.keys(channelData.ddaMatrix);
    if (variantChannels.length === 0) return;

    // Use functional update to avoid selectedChannels in deps (prevents infinite loop)
    setSelectedChannels((prevSelected) => {
      // Check if current selection matches variant channels
      const hasMatch = variantChannels.some((ch) => prevSelected.includes(ch));

      // If no overlap (different channel naming scheme), use variant channels
      if (!hasMatch && prevSelected.length > 0) {
        setAvailableChannels(variantChannels);
        return variantChannels;
      }
      return prevSelected;
    });
  }, [channelData?.ddaMatrix, currentVariantId]);

  // Initialize scales from result metadata (window_indices)
  // PROGRESSIVE LOADING: scales come from metadata, not from dda_matrix
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      // Use window_indices from metadata (primary)
      const windowIndices = result.results?.window_indices;
      if (
        windowIndices &&
        Array.isArray(windowIndices) &&
        windowIndices.length > 0
      ) {
        setSafeScales(windowIndices);
        return;
      }

      // Fallback to scales (legacy)
      const originalScales = result.results?.scales;
      if (
        originalScales &&
        Array.isArray(originalScales) &&
        originalScales.length > 0
      ) {
        setSafeScales(originalScales);
        return;
      }

      // Last resort: derive from fetched channel data
      if (channelData?.windowIndices && channelData.windowIndices.length > 0) {
        setSafeScales(channelData.windowIndices);
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    result.results?.window_indices,
    result.results?.scales,
    channelData?.windowIndices,
  ]);

  // Initialize available channels from result metadata
  // PROGRESSIVE LOADING: channel list comes from metadata, not from dda_matrix
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      // Use channels from result metadata (always available)
      const channels = result.channels || [];
      if (channels.length > 0) {
        setAvailableChannels(channels);

        // Initialize selected channels on first load
        if (!channelsInitialized) {
          setSelectedChannels(channels);
          setChannelsInitialized(true);
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [result.channels, channelsInitialized]);

  // Update selectedChannels when variant changes (after initial load)
  // PROGRESSIVE LOADING: Use result.channels as the source of truth
  useEffect(() => {
    if (!channelsInitialized) return;

    // Defer channel update to avoid blocking
    const rafId = requestAnimationFrame(() => {
      const channels = result.channels || [];
      if (channels.length === 0) return;

      setSelectedChannels((prev) => {
        const hasChanged =
          prev.length !== channels.length ||
          prev.some((ch, i) => ch !== channels[i]);
        return hasChanged ? channels : prev;
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    currentVariantData?.variant_id,
    result.id,
    result.channels,
    channelsInitialized,
  ]);

  // Reset view mode to default when switching to a variant that doesn't support the current view

  // Annotation hooks for heatmap and line plot
  // Only enable when respective plots are shown to avoid blocking initial render
  const annotationVariantId = currentVariantId || "legacy";
  const heatmapAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: annotationVariantId,
    plotType: "heatmap",
    ddaResult: result,
    sampleRate: sampleRate,
    enabled: showHeatmap, // Skip computation until heatmap is mounted
  });

  const linePlotAnnotations = useDDAAnnotations({
    resultId: result.id,
    variantId: annotationVariantId,
    plotType: "line",
    ddaResult: result,
    sampleRate: sampleRate,
    enabled: showLinePlot, // Skip computation until line plot is mounted
  });

  // Export functionality hook - extracts all export/share/popout logic
  const {
    exportPlot,
    exportData,
    exportAllData,
    exportScript,
    handlePopOut,
    handleShare,
    getExistingShareLink,
    isSyncConnected,
    handleExportSnapshot,
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

  // Register export actions for the top-level DDAToolbar
  useEffect(() => {
    onRegisterExportActions?.({
      exportData,
      exportPlot,
      exportAllData,
      exportScript,
      exportSnapshot: handleExportSnapshot,
      popOut: handlePopOut,
      share: isSyncConnected ? openShareDialog : undefined,
      showExportAll: availableVariants.length > 1,
    });
    return () => onRegisterExportActions?.(null);
  }, [
    onRegisterExportActions,
    exportData,
    exportPlot,
    exportAllData,
    exportScript,
    handleExportSnapshot,
    handlePopOut,
    openShareDialog,
    isSyncConnected,
    availableVariants.length,
  ]);

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
          <div>
            <CardTitle className="text-lg">DDA Results Visualization</CardTitle>
            <CardDescription>
              Analysis from {new Date(result.created_at).toLocaleDateString()} •{" "}
              {selectedChannels.length} channels
            </CardDescription>
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
      {/* Show loading state when data is being fetched OR when progressive rendering hasn't started */}
      {(!showPlots || isLoadingChannelData || isFetchingChannelData) && (
        <Card className="mt-4 animate-fade-in">
          <CardContent className="flex items-center justify-center p-12">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
              <p className="text-sm text-muted-foreground">
                {isLoadingChannelData || isFetchingChannelData
                  ? "Loading analysis data..."
                  : "Initializing visualization..."}
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
                  {/* Heatmap loading placeholder - shown during progressive rendering OR data fetch */}
                  {(viewMode === "heatmap" || viewMode === "all") &&
                    (!showHeatmap ||
                      isLoadingChannelData ||
                      isFetchingChannelData) && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            DDA Matrix Heatmap - {variant.variant_name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <PlotLoadingSkeleton
                            height={heatmapHeight}
                            title={
                              isLoadingChannelData || isFetchingChannelData
                                ? "Loading analysis data..."
                                : "Preparing heatmap..."
                            }
                          />
                        </CardContent>
                      </Card>
                    )}
                  {/* Heatmap - uses staggered loading to prevent simultaneous WASM calls */}
                  {(viewMode === "heatmap" || viewMode === "all") &&
                    showHeatmap &&
                    !isLoadingChannelData &&
                    !isFetchingChannelData && (
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
                          <Suspense
                            fallback={
                              <PlotLoadingSkeleton
                                height={heatmapHeight}
                                title="Loading heatmap component..."
                              />
                            }
                          >
                            <DDAHeatmapPlot
                              ref={heatmapPlotRef}
                              variantId={variant.variant_id}
                              ddaMatrix={effectiveDDAMatrix}
                              selectedChannels={effectiveChannels}
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
                                        if (safeScales.length === 0)
                                          return null;
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
                                              const rect =
                                                heatmapPlotRef.current
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
                          </Suspense>

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

                  {/* Line Plot loading placeholder - shown during progressive rendering OR data fetch */}
                  {(viewMode === "lineplot" || viewMode === "all") &&
                    (!showLinePlot ||
                      isLoadingChannelData ||
                      isFetchingChannelData) && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">
                            DDA Time Series - {variant.variant_name}
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <PlotLoadingSkeleton
                            height={linePlotHeight}
                            title={
                              isLoadingChannelData || isFetchingChannelData
                                ? "Loading analysis data..."
                                : "Preparing line plot..."
                            }
                          />
                        </CardContent>
                      </Card>
                    )}
                  {/* Line Plot - uses staggered loading to prevent simultaneous WASM calls */}
                  {(viewMode === "lineplot" || viewMode === "all") &&
                    showLinePlot &&
                    !isLoadingChannelData &&
                    !isFetchingChannelData && (
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
                          <Suspense
                            fallback={
                              <PlotLoadingSkeleton
                                height={linePlotHeight}
                                title="Loading line plot component..."
                              />
                            }
                          >
                            <DDALinePlot
                              ref={linePlotPlotRef}
                              variantId={variant.variant_id}
                              ddaMatrix={effectiveDDAMatrix}
                              selectedChannels={effectiveChannels}
                              scales={safeScales}
                              height={linePlotHeight}
                              onContextMenu={
                                linePlotAnnotations.openContextMenu
                              }
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
                                        if (safeScales.length === 0)
                                          return null;
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
                                              const rect =
                                                linePlotPlotRef.current
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
                          </Suspense>

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
                    <Suspense
                      fallback={
                        <PlotLoadingSkeleton
                          height={600}
                          title="Loading phase space component..."
                        />
                      }
                    >
                      <PhaseSpacePlot
                        filePath={filePath}
                        channels={fileChannels}
                        sampleRate={sampleRate}
                        className="min-h-[600px]"
                      />
                    </Suspense>
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
          {/* Heatmap loading placeholder - shown during progressive rendering OR data fetch */}
          {(viewMode === "heatmap" || viewMode === "all") &&
            (!showHeatmap || isLoadingChannelData || isFetchingChannelData) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    DDA Matrix Heatmap -{" "}
                    {getCurrentVariantData()?.variant_name || "Unknown"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PlotLoadingSkeleton
                    height={heatmapHeight}
                    title={
                      isLoadingChannelData || isFetchingChannelData
                        ? "Loading analysis data..."
                        : "Preparing heatmap..."
                    }
                  />
                </CardContent>
              </Card>
            )}
          {/* Heatmap - uses staggered loading */}
          {(viewMode === "heatmap" || viewMode === "all") &&
            showHeatmap &&
            !isLoadingChannelData &&
            !isFetchingChannelData && (
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
                  <Suspense
                    fallback={
                      <PlotLoadingSkeleton
                        height={heatmapHeight}
                        title="Loading heatmap component..."
                      />
                    }
                  >
                    <DDAHeatmapPlot
                      ref={heatmapPlotRef}
                      variantId={
                        getCurrentVariantData()?.variant_id || "unknown"
                      }
                      ddaMatrix={effectiveDDAMatrix}
                      selectedChannels={effectiveChannels}
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
                  </Suspense>

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

          {/* Line Plot loading placeholder - shown during progressive rendering OR data fetch */}
          {(viewMode === "lineplot" || viewMode === "all") &&
            (!showLinePlot ||
              isLoadingChannelData ||
              isFetchingChannelData) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    DDA Time Series -{" "}
                    {getCurrentVariantData()?.variant_name || "Unknown"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PlotLoadingSkeleton
                    height={linePlotHeight}
                    title={
                      isLoadingChannelData || isFetchingChannelData
                        ? "Loading analysis data..."
                        : "Preparing line plot..."
                    }
                  />
                </CardContent>
              </Card>
            )}
          {/* Line Plot - uses staggered loading */}
          {(viewMode === "lineplot" || viewMode === "all") &&
            showLinePlot &&
            !isLoadingChannelData &&
            !isFetchingChannelData && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    DDA Time Series -{" "}
                    {getCurrentVariantData()?.variant_name || "Unknown"}
                  </CardTitle>
                  <CardDescription>
                    DDA output time series - one line per channel (each row of
                    the DDA matrix)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Suspense
                    fallback={
                      <PlotLoadingSkeleton
                        height={linePlotHeight}
                        title="Loading line plot component..."
                      />
                    }
                  >
                    <DDALinePlot
                      ref={linePlotPlotRef}
                      variantId={
                        getCurrentVariantData()?.variant_id || "unknown"
                      }
                      ddaMatrix={effectiveDDAMatrix}
                      selectedChannels={effectiveChannels}
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
                            {linePlotAnnotations.annotations.map(
                              (annotation) => {
                                if (safeScales.length === 0) return null;
                                const u =
                                  linePlotPlotRef.current?.getUplotInstance();
                                if (!u) return null;

                                // Get uPlot bbox for accurate dimensions and offsets
                                const bbox = u.bbox;
                                if (!bbox) return null;

                                // Use uPlot's valToPos to convert scale value to pixel position (relative to canvas)
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
                              },
                            )}
                          </svg>
                        )}
                    </DDALinePlot>
                  </Suspense>

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
            <Suspense
              fallback={
                <PlotLoadingSkeleton
                  height={600}
                  title="Loading phase space component..."
                />
              }
            >
              <PhaseSpacePlot
                filePath={filePath}
                channels={fileChannels}
                sampleRate={sampleRate}
                className="min-h-[600px]"
              />
            </Suspense>
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
