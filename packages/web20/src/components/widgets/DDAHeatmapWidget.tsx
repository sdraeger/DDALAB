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
import { Activity, Download, RefreshCw, Loader2 } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { apiService } from "../../lib/api";
import { useCurrentFileSubscription } from "@/hooks/useCurrentFileSubscription";

interface DDAHeatmapWidgetProps {
  widgetId?: string;
  isPopout?: boolean;
  widgetData?: any;
}

export function DDAHeatmapWidget({
  widgetId = "dda-heatmap-widget",
  isPopout = false,
  widgetData,
}: DDAHeatmapWidgetProps) {
  const [Q, setQ] = useState<number[][]>([]);
  const [colorScheme, setColorScheme] = useState<
    "viridis" | "plasma" | "inferno" | "jet"
  >("viridis");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingState, setIsLoadingState] = useState(false);
  const [isSavingState, setIsSavingState] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);

  // Persist/restore across unmounts (minimize/maximize)
  const storageKey = useMemo(
    () => `dda:heatmap-widget:v1:${widgetId}`,
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
        console.log('[DDAHeatmapWidget] Restore response:', response);
        if (response.data?.data?.data) {
          const snap = response.data.data.data;
          console.log('[DDAHeatmapWidget] Restored data:', snap);
          if (snap) {
            // Restore UI state
            if (snap.colorScheme) setColorScheme(snap.colorScheme);
            // Restore Q data if available
            if (snap.Q && Array.isArray(snap.Q)) {
              console.log('[DDAHeatmapWidget] Restoring Q data, length:', snap.Q.length);
              setQ(snap.Q);
            }
          }
        } else if (response.error && !response.error.includes('not found')) {
          // Only show error if it's not a 404 (no saved state)
          setStateError(`Failed to load widget state: ${response.error}`);
        }
      } catch (err) {
        console.error('[DDAHeatmapWidget] Restore error:', err);
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
      setQ(widgetData.Q);
    }
  }, [widgetData]);

  // Persist state snapshot to database when key inputs change
  useEffect(() => {
    if (!restoredRef.current || isLoadingState || isFirstRender.current) return; // Don't save during initial load
    
    const snapshot = { colorScheme, Q };
    
    const saveState = async () => {
      setIsSavingState(true);
      try {
        const response = await apiService.storeWidgetData({
          key: storageKey,
          data: snapshot,
          widgetId: widgetId,
          metadata: { type: 'dda-heatmap-widget', version: 'v1' }
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
  }, [storageKey, colorScheme, Q, widgetId, isLoadingState]);

  // Listen to file selection events
  useCurrentFileSubscription((event) => {
    // Handle file selection - this is where widgets can react to file changes
    console.log("DDA Heatmap Widget: File selected", event.filePath);
  });

  // Listen to DDA results - but only after we've been restored
  useEffect(() => {
    // Don't process results until we're properly initialized
    if (!restoredRef.current) return;

    const onResults = (e: Event) => {
      const detail = (e as CustomEvent).detail as { Q?: (number | null)[][] };
      if (Array.isArray(detail?.Q) && detail.Q.length > 0) {
        const cleaned = detail.Q.map((row) =>
          row.map((v) =>
            v == null || !Number.isFinite(Number(v)) ? 0 : Number(v)
          )
        );
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
      console.log("DDA Heatmap Widget: File selected (legacy)", detail?.filePath);
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
    // Force re-render by temporarily clearing and restoring Q data
    const currentQ = [...Q];
    setQ([]);
    setTimeout(() => {
      setQ(currentQ);
      setIsLoading(false);
    }, 100);
  };

  const getColor = (value: number) => {
    const clampedValue = Math.max(0, Math.min(1, value));

    if (colorScheme === "viridis") {
      // Viridis color scheme
      const r = Math.round(68 + 187 * clampedValue);
      const g = Math.round(1 + 119 * clampedValue);
      const b = Math.round(84 + 178 * clampedValue);
      return `rgb(${r}, ${g}, ${b})`;
    } else if (colorScheme === "plasma") {
      // Plasma color scheme
      const r = Math.round(13 + 242 * clampedValue);
      const g = Math.round(8 + 104 * clampedValue);
      const b = Math.round(135 + 120 * clampedValue);
      return `rgb(${r}, ${g}, ${b})`;
    } else if (colorScheme === "jet") {
      // Jet color scheme
      let r, g, b;
      if (clampedValue < 0.33) {
        r = 0;
        g = Math.round(255 * (clampedValue / 0.33));
        b = 255;
      } else if (clampedValue < 0.66) {
        r = 0;
        g = 255;
        b = Math.round(255 * (1 - (clampedValue - 0.33) / 0.33));
      } else {
        r = Math.round(255 * ((clampedValue - 0.66) / 0.34));
        g = Math.round(255 * (1 - (clampedValue - 0.66) / 0.34));
        b = 0;
      }
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Inferno color scheme
      const r = Math.round(0 + 252 * clampedValue);
      const g = Math.round(0 + 108 * clampedValue);
      const b = Math.round(4 + 3 * clampedValue);
      return `rgb(${r}, ${g}, ${b})`;
    }
  };

  // Build uPlot heatmap renderer using draw hook for performance
  useEffect(() => {
    if (!containerRef.current || !Q || Q.length === 0) {
      uplotRef.current?.destroy();
      uplotRef.current = null;
      return;
    }
    const rows = Q.length;
    const cols = Q[0]?.length || 0;
    const x = Float64Array.from({ length: cols }, (_, i) => i);
    const y = new Float64Array(cols).fill(0); // single dummy series; we paint in draw hook

    const opts: uPlot.Options = {
      width: Math.max(320, containerRef.current.clientWidth || 400),
      height: Math.min(600, Math.max(240, rows)),
      scales: { x: { time: false }, y: { auto: true } },
      axes: [{ label: "t" }, { label: "rows" }],
      series: [
        { label: "t" },
        { label: "Q", points: { show: false }, width: 0 },
      ],
      hooks: {
        draw: [
          (u: uPlot) => {
            const ctx2d = (u as any).ctx as CanvasRenderingContext2D | null;
            if (!ctx2d) return;
            const pxRatio = (u as any).pxRatio || window.devicePixelRatio || 1;
            const { left, top, width, height } = u.bbox;
            const plotW = Math.max(1, Math.round(width * pxRatio));
            const plotH = Math.max(1, Math.round(height * pxRatio));
            const image = ctx2d.createImageData(plotW, plotH);
            // Normalize Q to [0,1]
            let min = Infinity,
              max = -Infinity;
            for (let i = 0; i < rows; i++) {
              for (let j = 0; j < cols; j++) {
                const v = Q[i][j];
                if (v < min) min = v;
                if (v > max) max = v;
              }
            }
            const denom = max - min || 1;
            // Map plot pixels to Q indices
            for (let py = 0; py < plotH; py++) {
              const qi = Math.min(rows - 1, Math.floor((py / plotH) * rows));
              for (let px = 0; px < plotW; px++) {
                const qj = Math.min(cols - 1, Math.floor((px / plotW) * cols));
                const qv = Q[qi][qj];
                const norm = denom === 0 ? 0 : (qv - min) / denom;
                const color = getColor(norm);
                const m = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                const r = m ? Number(m[1]) : 0;
                const g = m ? Number(m[2]) : 0;
                const b = m ? Number(m[3]) : 0;
                const idx = (py * plotW + px) * 4;
                image.data[idx] = r;
                image.data[idx + 1] = g;
                image.data[idx + 2] = b;
                image.data[idx + 3] = 255;
              }
            }
            ctx2d.putImageData(
              image,
              Math.round(left * pxRatio),
              Math.round(top * pxRatio)
            );
          },
        ],
      },
    } as any;

    const data = [x, y] as unknown as uPlot.AlignedData;
    if (uplotRef.current) {
      uplotRef.current.setData(data);
      uplotRef.current.redraw();
    } else {
      uplotRef.current = new uPlot(opts, data, containerRef.current);
    }
  }, [Q, colorScheme]);

  const getStats = () => {
    if (Q.length === 0) return { min: 0, max: 0, avg: 0 };
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
            <Activity className="h-4 w-4" />
            DDA Heatmap
            {(isLoadingState || isSavingState) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </CardTitle>
          {stateError && (
            <p className="text-xs text-red-600 mt-1">{stateError}</p>
          )}
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Select
                value={colorScheme}
                onValueChange={(value: any) => setColorScheme(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viridis">Viridis</SelectItem>
                  <SelectItem value="plasma">Plasma</SelectItem>
                  <SelectItem value="inferno">Inferno</SelectItem>
                  <SelectItem value="jet">Jet</SelectItem>
                </SelectContent>
              </Select>
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
              {Q.length} × {Q[0]?.length || 0} data points • {colorScheme}
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
