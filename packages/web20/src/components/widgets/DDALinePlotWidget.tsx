"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { TrendingUp, Download, RefreshCw, ZoomIn, ZoomOut, Loader2 } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { apiService } from "../../lib/api";
import { useCurrentFileSubscription } from "@/hooks/useCurrentFileSubscription";
import { useFileConfig } from "@/contexts/FileConfigContext";

interface DDALinePlotWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
  widgetData?: any;
}

export function DDALinePlotWidget({
  widgetId = "dda-line-plot-widget",
  isPopout = false,
  widgetData,
}: DDALinePlotWidgetProps) {
  const { config: fileConfig } = useFileConfig();
  const [Q, setQ] = useState<number[][]>([]);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [isSavingState, setIsSavingState] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [normalize, setNormalize] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);

  // Persist/restore across unmounts (minimize/maximize)
  const storageKey = useMemo(
    () => `dda:line-plot-widget:v1:${widgetId}`,
    [widgetId]
  );
  const restoredRef = useRef(false);
  const isFirstRender = useRef(true);

  // Restore state from database on mount
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const restoreState = async () => {
      setIsLoadingState(true);
      setStateError(null);
      try {
        const response = await apiService.getWidgetData(storageKey);
        if (response.data?.data?.data) {
          const snap = response.data.data.data;
          if (snap) {
            // Restore UI state
            if (typeof snap.zoomLevel === "number") setZoomLevel(snap.zoomLevel);
            if (typeof snap.normalize === "boolean") setNormalize(snap.normalize);
            // Restore Q data if available
            if (snap.Q && Array.isArray(snap.Q)) {
              // Sanitize the restored data to ensure all values are valid numbers
              const sanitizedQ = snap.Q.map((row: any) => 
                Array.isArray(row) ? row.map((v: any) => {
                  const value = Number(v);
                  return (isNaN(value) || !isFinite(value)) ? 0 : value;
                }) : []
              ).filter((row: any[]) => row.length > 0);
              setQ(sanitizedQ);
            }
          }
        } else if (response.error && !response.error.includes('not found')) {
          // Only show error if it's not a 404 (no saved state)
          setStateError(`Failed to load widget state: ${response.error}`);
        }
      } catch (err) {
        setStateError('Failed to load widget state from database');
      } finally {
        setIsLoadingState(false);
        // Mark first render as complete after loading finishes
        setTimeout(() => { isFirstRender.current = false; }, 100);
      }
    };

    restoreState();
  }, [storageKey]);

  // Handle widget data prop (optional - for external data injection)
  useEffect(() => {
    if (widgetData?.Q && Array.isArray(widgetData.Q)) {
      // Sanitize the external data to ensure all values are valid numbers
      const sanitizedQ = widgetData.Q.map((row: any) => 
        Array.isArray(row) ? row.map((v: any) => {
          const value = Number(v);
          return (isNaN(value) || !isFinite(value)) ? 0 : value;
        }) : []
      ).filter((row: any[]) => row.length > 0);
      setQ(sanitizedQ);
    }
  }, [widgetData]);

  // Persist state snapshot to database when key inputs change
  useEffect(() => {
    if (!restoredRef.current || isLoadingState || isFirstRender.current) return; // Don't save during initial load
    
    // Don't save if Q is empty to prevent infinite loops
    if (!Array.isArray(Q) || Q.length === 0) return;

    // Sanitize data before saving to prevent serialization issues
    const sanitizedQ = Q.map((row) => 
      row.map((v) => {
        const value = Number(v);
        return (isNaN(value) || !isFinite(value)) ? 0 : value;
      })
    );
    const snapshot = {
      zoomLevel,
      normalize,
      Q: sanitizedQ
    };

    const saveState = async () => {
      setIsSavingState(true);
      try {
        const response = await apiService.storeWidgetData({
          key: storageKey,
          data: snapshot,
          widgetId: widgetId,
          metadata: { type: 'dda-lineplot-widget', version: 'v1' }
        });
        if (response.error) {
          setStateError(`Failed to save widget state: ${response.error}`);
        } else {
          setStateError(null); // Clear any previous errors on successful save
        }
      } catch (err) {
        setStateError('Failed to save widget state to database');
      } finally {
        setIsSavingState(false);
      }
    };

    // Debounce saves to avoid excessive API calls
    const timeoutId = setTimeout(saveState, 500);
    return () => clearTimeout(timeoutId);
  }, [storageKey, zoomLevel, normalize, Q, widgetId, isLoadingState]);

  // Listen to file selection events
  useCurrentFileSubscription((event) => {
    // Handle file selection - this is where widgets can react to file changes
    console.log("DDA Line Plot Widget: File selected", event.filePath);
  });

  // Listen to global DDA results - but only after we've been restored
  useEffect(() => {
    // Don't process results until we're properly initialized
    if (!restoredRef.current) return;

    const onResults = (e: Event) => {
      const detail = (e as CustomEvent).detail as { Q?: (number | null)[][] };
      console.log('[DDALinePlot] Received DDA results:', {
        hasQ: Array.isArray(detail?.Q),
        qLength: detail?.Q?.length || 0,
        qColLength: detail?.Q?.[0]?.length || 0,
        detail
      });
      if (Array.isArray(detail?.Q) && detail.Q.length > 0) {
        // sanitize nulls to 0
        const cleaned = detail.Q.map((row) =>
          row.map((v) =>
            v == null || !Number.isFinite(Number(v)) ? 0 : Number(v)
          )
        );
        console.log('[DDALinePlot] Setting Q data:', {
          originalRows: detail.Q.length,
          originalCols: detail.Q[0]?.length || 0,
          cleanedRows: cleaned.length,
          cleanedCols: cleaned[0]?.length || 0
        });
        setQ(cleaned);
      }
    };
    window.addEventListener("dda:results", onResults as EventListener);
    return () =>
      window.removeEventListener("dda:results", onResults as EventListener);
  }, []);

  // Also listen for the old dda:edf-loaded event for backward compatibility
  useEffect(() => {
    const onEdfLoaded = (e: Event) => {
      // Handle file selection - this is where widgets can react to file changes
      const detail = (e as CustomEvent).detail as {
        filePath?: string;
      };
      console.log("DDA Line Plot Widget: File selected (legacy)", detail?.filePath);
    };
    window.addEventListener("dda:edf-loaded", onEdfLoaded as EventListener);
    return () =>
      window.removeEventListener(
        "dda:edf-loaded",
        onEdfLoaded as EventListener
      );
  }, []);

  const handleRefresh = async () => {
    setIsLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    setIsLoading(false);
  };

  const handleZoom = (direction: "in" | "out") => {
    setZoomLevel((prev) => {
      const newZoom = direction === "in" ? prev * 1.2 : prev / 1.2;
      return Math.max(0.5, Math.min(3, newZoom));
    });
  };

  // Build uPlot data: longest dimension is time (x), columns are series
  const { uplotData, series } = useMemo(() => {
    if (!Q || Q.length === 0)
      return { uplotData: null as any, series: [] as any[] };
    const rows = Q.length;
    const cols = Q[0]?.length || 0;
    if (cols === 0) return { uplotData: null as any, series: [] as any[] };
    const timeLen = Math.max(rows, cols);
    const isTimeRows = rows >= cols;

    // x axis in seconds based on chunk size and sampling rate
    const samplingRate = fileConfig.samplingRate;
    const chunkSizeInSamples = fileConfig.chunkSize;
    const chunkSizeInSeconds = chunkSizeInSamples / samplingRate;
    
    console.log('[DDALinePlot] Config update:', {
      chunkSizeInSamples,
      chunkSizeInSeconds,
      samplingRate,
      displayMode: fileConfig.displayMode
    });
    
    console.log('[DDALinePlot] Q data dimensions:', {
      rows: Q.length,
      cols: Q[0]?.length || 0,
      timeLen,
      isTimeRows
    });
    
    // Generate x-axis in seconds
    const x = Array.from({ length: timeLen }, (_, i) => {
      // If display mode is chunked, show time relative to current chunk
      if (fileConfig.displayMode === 'chunked') {
        return (i / timeLen) * chunkSizeInSeconds;
      }
      // Otherwise show continuous time
      return (i / samplingRate);
    });
    
    const seriesData: number[][] = [];
    const numSeries = isTimeRows ? cols : rows;

    for (let s = 0; s < numSeries; s++) {
      const arr = new Array(timeLen).fill(0);
      if (isTimeRows) {
        for (let t = 0; t < timeLen; t++) arr[t] = Number(Q[t][s] ?? 0);
      } else {
        for (let t = 0; t < timeLen; t++) arr[t] = Number(Q[s][t] ?? 0);
      }
      if (normalize) {
        let min = Infinity,
          max = -Infinity;
        for (let t = 0; t < timeLen; t++) {
          const v = arr[t];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const denom = max - min || 1;
        for (let t = 0; t < timeLen; t++) arr[t] = (arr[t] - min) / denom;
      }
      seriesData.push(arr);
    }
    const uData = [x, ...seriesData];
    const COLORS = [
      "#1f77b4",
      "#ff7f0e",
      "#2ca02c",
      "#d62728",
      "#9467bd",
      "#8c564b",
      "#e377c2",
      "#7f7f7f",
      "#bcbd22",
      "#17becf",
    ];
    const dpr =
      (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
    const s = [
      { label: "Time (s)" },
      ...Array.from({ length: numSeries }, (_, i) => ({
        label: `Q${i + 1} (a1)`,
        stroke: COLORS[i % COLORS.length],
        points: { show: false },
        width: Math.max(1, 1 / dpr),
      })),
    ];
    return { uplotData: uData, series: s };
  }, [Q, normalize, fileConfig.samplingRate, fileConfig.chunkSize, fileConfig.displayMode]);

  // Create/destroy uPlot and recreate if series length changes or config changes
  useEffect(() => {
    if (!containerRef.current) return;
    if (!uplotData) {
      uplotRef.current?.destroy();
      uplotRef.current = null;
      return;
    }
    
    // Always recreate the chart when config changes to ensure axis updates
    uplotRef.current?.destroy();
    const opts: uPlot.Options = {
      width: Math.max(320, containerRef.current.clientWidth || 400),
      height: 300,
      scales: { x: { time: false } },
      axes: [{ label: "Time (seconds)" }, { label: "Q" }],
      series,
    } as any;
    uplotRef.current = new uPlot(opts, uplotData, containerRef.current);
  }, [uplotData, series, fileConfig.chunkSize, fileConfig.samplingRate, fileConfig.displayMode]);

  // Clean up chart on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  const getStats = () => {
    if (!Q || Q.length === 0) return { min: 0, max: 0, avg: 0 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < Q.length; i++) {
      const row = Q[i];
      for (let j = 0; j < row.length; j++) {
        const v = row[j];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        count++;
      }
    }
    const avg = count > 0 ? sum / count : 0;
    if (!Number.isFinite(min)) min = 0;
    if (!Number.isFinite(max)) max = 0;
    if (!Number.isFinite(avg)) return { min, max, avg: 0 };
    return { min, max, avg };
  };

  const stats = getStats();

  return (
    <div className="flex flex-col h-full p-2 space-y-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4" />
            DDA Line Plot (a1 Coefficients)
            {(isLoadingState || isSavingState) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </CardTitle>
          {stateError && (
            <p className="text-xs text-red-600 mt-1">{stateError}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center gap-4 justify-end">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleZoom("out")}
                size="sm"
                variant="outline"
                disabled={zoomLevel <= 0.5}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>

              <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
                {Math.round(zoomLevel * 100)}%
              </span>

              <Button
                onClick={() => handleZoom("in")}
                size="sm"
                variant="outline"
                disabled={zoomLevel >= 3}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="normalize"
                type="checkbox"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
              />
              <label
                htmlFor="normalize"
                className="text-xs text-muted-foreground"
              >
                Normalize per series
              </label>
            </div>

            <Button
              onClick={handleRefresh}
              disabled={isLoading}
              size="sm"
              variant="outline"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </>
              )}
            </Button>

            <Button size="sm" variant="outline">
              <Download className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-center p-2 bg-muted/20 rounded-lg overflow-auto relative">
            {isLoadingState ? (
              <div className="w-full h-[320px] flex items-center justify-center">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading widget state...</span>
                </div>
              </div>
            ) : (
              <div
                ref={containerRef}
                className="w-full"
                style={{ minHeight: 320 }}
              />
            )}
          </div>

          <div className="grid grid-cols-3 gap-4 text-xs">
            <div className="text-center">
              <div className="font-medium">Min</div>
              <div className="text-muted-foreground">
                {stats.min.toFixed(3)}
              </div>
            </div>
            <div className="text-center">
              <div className="font-medium">Max</div>
              <div className="text-muted-foreground">
                {stats.max.toFixed(3)}
              </div>
            </div>
            <div className="text-center">
              <div className="font-medium">Avg</div>
              <div className="text-muted-foreground">
                {stats.avg.toFixed(3)}
              </div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground flex items-center justify-between">
            <span>
              {Q?.length || 0}×{Q?.[0]?.length || 0} •{" "}
              {Math.round(zoomLevel * 100)}% zoom •{" "}
              Chunk: {(fileConfig.chunkSize / fileConfig.samplingRate).toFixed(1)}s
            </span>
            {isSavingState && (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Saving...</span>
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
