import { useState, useCallback, useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import {
  PlotAnnotation,
  ANNOTATION_CATEGORIES,
  type AnnotationCategoryId,
} from "@/types/annotations";
import { DDAResult } from "@/types/api";
import { timeSeriesAnnotationToDDA } from "@/utils/annotationSync";
import { useAvailablePlots } from "./useAvailablePlots";
import { profiler } from "@/utils/performance";

interface UseTimeSeriesAnnotationsOptions {
  filePath: string;
  channel?: string;
}

interface UseDDAAnnotationsOptions {
  resultId: string;
  variantId: string;
  plotType: "heatmap" | "line";
  ddaResult: DDAResult;
  sampleRate: number;
  enabled?: boolean; // Skip heavy computation when false (default: true)
}

export const useTimeSeriesAnnotations = ({
  filePath,
  channel,
}: UseTimeSeriesAnnotationsOptions) => {
  const addTimeSeriesAnnotation = useAppStore(
    (state) => state.addTimeSeriesAnnotation,
  );
  const updateTimeSeriesAnnotation = useAppStore(
    (state) => state.updateTimeSeriesAnnotation,
  );
  const deleteTimeSeriesAnnotation = useAppStore(
    (state) => state.deleteTimeSeriesAnnotation,
  );
  const availablePlots = useAvailablePlots();

  // Get all time series annotations with a stable selector
  // This selector doesn't capture filePath, so it's stable across renders
  const allTimeSeriesAnnotations = useAppStore(
    (state) => state.annotations.timeSeries,
  );

  // Pick out the specific file's annotations based on current filePath
  // This useMemo will re-run when either filePath or allTimeSeriesAnnotations changes
  const fileAnnotations = useMemo(() => {
    if (!filePath) return undefined;
    return allTimeSeriesAnnotations[filePath];
  }, [filePath, allTimeSeriesAnnotations]);

  // Memoize combined and filtered annotations
  const annotations = useMemo(() => {
    // Return empty array if no file path or no annotations loaded yet
    if (!filePath || !fileAnnotations) return [];

    let allAnnotations: PlotAnnotation[] = [];
    if (channel && fileAnnotations.channelAnnotations?.[channel]) {
      allAnnotations = [
        ...fileAnnotations.globalAnnotations,
        ...fileAnnotations.channelAnnotations[channel],
      ];
    } else {
      allAnnotations = fileAnnotations.globalAnnotations || [];
    }

    // Filter annotations based on plot visibility and apply category colors
    const filtered = allAnnotations
      .filter((ann) => {
        if (!ann.visible_in_plots || ann.visible_in_plots.length === 0)
          return true;
        return ann.visible_in_plots.includes("timeseries");
      })
      .map((ann) => {
        if (!ann.color && ann.category) {
          return { ...ann, color: ANNOTATION_CATEGORIES[ann.category].color };
        }
        return ann;
      });

    return filtered;
  }, [filePath, fileAnnotations, channel]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    plotPosition: number;
    annotation?: PlotAnnotation;
  } | null>(null);

  const handleCreateAnnotation = useCallback(
    (
      position: number,
      label: string,
      description?: string,
      visibleInPlots?: string[],
      category?: AnnotationCategoryId,
    ) => {
      const annotation: PlotAnnotation = {
        id: crypto.randomUUID(),
        position,
        label,
        description,
        category,
        visible_in_plots: visibleInPlots || availablePlots.map((p) => p.id),
        createdAt: new Date().toISOString(),
      };
      addTimeSeriesAnnotation(filePath, annotation, channel);
    },
    [filePath, channel, addTimeSeriesAnnotation, availablePlots],
  );

  const handleUpdateAnnotation = useCallback(
    (
      id: string,
      label: string,
      description?: string,
      visibleInPlots?: string[],
      category?: AnnotationCategoryId,
    ) => {
      updateTimeSeriesAnnotation(
        filePath,
        id,
        { label, description, visible_in_plots: visibleInPlots, category },
        channel,
      );
    },
    [filePath, channel, updateTimeSeriesAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      deleteTimeSeriesAnnotation(filePath, id, channel);
    },
    [filePath, channel, deleteTimeSeriesAnnotation],
  );

  const openContextMenu = useCallback(
    (
      x: number,
      y: number,
      plotPosition: number,
      annotation?: PlotAnnotation,
    ) => {
      setContextMenu({ x, y, plotPosition, annotation });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleAnnotationClick = useCallback(
    (annotation: PlotAnnotation, x: number, y: number) => {
      setContextMenu({ x, y, plotPosition: annotation.position, annotation });
    },
    [],
  );

  return {
    annotations,
    contextMenu,
    handleCreateAnnotation,
    handleUpdateAnnotation,
    handleDeleteAnnotation,
    openContextMenu,
    closeContextMenu,
    handleAnnotationClick,
    availablePlots,
    currentPlotId: "timeseries",
  };
};

export const useDDAAnnotations = ({
  resultId,
  variantId,
  plotType,
  ddaResult,
  sampleRate,
  enabled = true,
}: UseDDAAnnotationsOptions) => {
  const addDDAAnnotation = useAppStore((state) => state.addDDAAnnotation);
  const updateDDAAnnotation = useAppStore((state) => state.updateDDAAnnotation);
  const deleteDDAAnnotation = useAppStore((state) => state.deleteDDAAnnotation);
  const addTimeSeriesAnnotation = useAppStore(
    (state) => state.addTimeSeriesAnnotation,
  );
  const availablePlots = useAvailablePlots();

  // Extract primitive values from ddaResult for stable dependencies
  const startTime = ddaResult.parameters.start_time || 0;
  const endTime = ddaResult.parameters.end_time || Infinity;
  const filePath = ddaResult.file_path;

  // Get DDA-specific annotation object from store (stable reference)
  const key = `${resultId}_${variantId}_${plotType}`;
  const ddaAnnotationObj = useAppStore(
    (state) => state.annotations.ddaResults[key],
  );

  // Get file annotations object from store (stable reference)
  const fileAnnotations = useAppStore(
    (state) => state.annotations.timeSeries[filePath],
  );

  // Memoize the raw annotation arrays
  const ddaAnnotations = useMemo(() => {
    return ddaAnnotationObj?.annotations || [];
  }, [ddaAnnotationObj]);

  const timeSeriesAnnotations = useMemo(() => {
    return fileAnnotations?.globalAnnotations || [];
  }, [fileAnnotations]);

  // Merge both annotation sets with coordinate transformation
  // Skip computation when disabled to avoid blocking initial render
  const annotations = useMemo(() => {
    // Early return when disabled - skip all processing
    if (!enabled) {
      return [];
    }

    const profilerKey = `annotation-merge-${plotType}`;
    profiler.start(profilerKey, {
      category: "data_processing",
      plotType,
      variantId,
      timeSeriesCount: timeSeriesAnnotations.length,
      ddaCount: ddaAnnotations.length,
    });

    try {
      const currentPlotId = `dda:${variantId}:${plotType === "heatmap" ? "heatmap" : "lineplot"}`;

      // Filter by time range
      profiler.start(`${profilerKey}-time-filter`);
      const inTimeRange = timeSeriesAnnotations.filter(
        (ann) => ann.position >= startTime && ann.position <= endTime,
      );
      profiler.end(`${profilerKey}-time-filter`);

      // Filter by visibility
      profiler.start(`${profilerKey}-visibility-filter`);
      const visibleAnnotations = inTimeRange.filter((ann) => {
        if (!ann.visible_in_plots || ann.visible_in_plots.length === 0)
          return true;
        return ann.visible_in_plots.includes(currentPlotId);
      });
      profiler.end(`${profilerKey}-visibility-filter`);

      // Transform to DDA coordinates
      profiler.start(`${profilerKey}-transform`);
      const transformed = visibleAnnotations
        .map((ann) => timeSeriesAnnotationToDDA(ann, ddaResult, sampleRate))
        .filter((ann) => ann.position >= 0);
      profiler.end(`${profilerKey}-transform`);

      // Combine DDA-specific and transformed timeseries annotations
      profiler.start(`${profilerKey}-merge`);
      const annotationMap = new Map<string, PlotAnnotation>();

      // Add transformed timeseries first
      transformed.forEach((ann) => annotationMap.set(ann.id, ann));

      // Add DDA-specific (overrides transformed if same ID) and filter by plot visibility
      const filteredDDA = ddaAnnotations.filter((ann) => {
        if (!ann.visible_in_plots || ann.visible_in_plots.length === 0)
          return true;
        return ann.visible_in_plots.includes(currentPlotId);
      });

      filteredDDA.forEach((ann) => annotationMap.set(ann.id, ann));

      const result = Array.from(annotationMap.values())
        .map((ann) => {
          if (!ann.color && ann.category) {
            return { ...ann, color: ANNOTATION_CATEGORIES[ann.category].color };
          }
          return ann;
        })
        .sort((a, b) => a.position - b.position);
      profiler.end(`${profilerKey}-merge`);

      return result;
    } finally {
      profiler.end(profilerKey);
    }
  }, [
    enabled,
    timeSeriesAnnotations,
    ddaAnnotations,
    startTime,
    endTime,
    resultId, // Use resultId as proxy for ddaResult changes
    sampleRate,
    variantId,
    plotType,
    ddaResult,
  ]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    plotPosition: number;
    annotation?: PlotAnnotation;
  } | null>(null);

  const handleCreateAnnotation = useCallback(
    (
      position: number,
      label: string,
      description?: string,
      visibleInPlots?: string[],
      category?: AnnotationCategoryId,
    ) => {
      // Convert DDA position (window index) to timeseries position (seconds)
      const windowIndices =
        ddaResult.results.window_indices || ddaResult.results.scales || [];

      let windowIndex = 0;
      if (windowIndices.length > 0) {
        let minDistance = Math.abs(windowIndices[0] - position);

        for (let i = 1; i < windowIndices.length; i++) {
          const distance = Math.abs(windowIndices[i] - position);
          if (distance < minDistance) {
            minDistance = distance;
            windowIndex = i;
          }
        }
      }

      const windowStep = ddaResult.parameters.window_step || 1;
      const sampleIndex = windowIndex * windowStep;
      const timeSeconds = sampleIndex / sampleRate;

      const annotation: PlotAnnotation = {
        id: crypto.randomUUID(),
        position: timeSeconds,
        label,
        description,
        category,
        visible_in_plots: visibleInPlots || availablePlots.map((p) => p.id),
        createdAt: new Date().toISOString(),
      };

      addTimeSeriesAnnotation(filePath, annotation);
    },
    [
      filePath,
      sampleRate,
      addTimeSeriesAnnotation,
      variantId,
      plotType,
      availablePlots,
      ddaResult,
    ],
  );

  const handleUpdateAnnotation = useCallback(
    (
      id: string,
      label: string,
      description?: string,
      visibleInPlots?: string[],
      category?: AnnotationCategoryId,
    ) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith("_dda")) {
        // Update the original timeseries annotation
        const originalId = id.replace("_dda", "");
        const updateTimeSeriesAnnotation =
          useAppStore.getState().updateTimeSeriesAnnotation;
        updateTimeSeriesAnnotation(filePath, originalId, {
          label,
          description,
          visible_in_plots: visibleInPlots,
          category,
        });
      } else {
        // Update DDA-specific annotation
        updateDDAAnnotation(resultId, variantId, plotType, id, {
          label,
          description,
          visible_in_plots: visibleInPlots,
          category,
        });
      }
    },
    [filePath, resultId, variantId, plotType, updateDDAAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      // Check if this is a transformed timeseries annotation
      if (id.endsWith("_dda")) {
        // Delete the original timeseries annotation
        const originalId = id.replace("_dda", "");
        const deleteTimeSeriesAnnotation =
          useAppStore.getState().deleteTimeSeriesAnnotation;
        deleteTimeSeriesAnnotation(filePath, originalId);
      } else {
        // Delete DDA-specific annotation
        deleteDDAAnnotation(resultId, variantId, plotType, id);
      }
    },
    [filePath, resultId, variantId, plotType, deleteDDAAnnotation],
  );

  const openContextMenu = useCallback(
    (
      x: number,
      y: number,
      plotPosition: number,
      annotation?: PlotAnnotation,
    ) => {
      setContextMenu({ x, y, plotPosition, annotation });
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleAnnotationClick = useCallback(
    (annotation: PlotAnnotation, x: number, y: number) => {
      setContextMenu({ x, y, plotPosition: annotation.position, annotation });
    },
    [],
  );

  const currentPlotId = useMemo(() => {
    return `dda:${variantId}:${plotType === "heatmap" ? "heatmap" : "lineplot"}`;
  }, [variantId, plotType]);

  // Memoize the return object to prevent creating new references on every render
  return useMemo(
    () => ({
      annotations,
      contextMenu,
      handleCreateAnnotation,
      handleUpdateAnnotation,
      handleDeleteAnnotation,
      openContextMenu,
      closeContextMenu,
      handleAnnotationClick,
      availablePlots,
      currentPlotId,
    }),
    [
      annotations,
      contextMenu,
      handleCreateAnnotation,
      handleUpdateAnnotation,
      handleDeleteAnnotation,
      openContextMenu,
      closeContextMenu,
      handleAnnotationClick,
      availablePlots,
      currentPlotId,
    ],
  );
};
