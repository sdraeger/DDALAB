"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  // Cursor tracking state
  const [cursorInfo, setCursorInfo] = useState<{
    x: number;
    y: number;
    dataX: number;
    dataY: number;
    value: number | null;
    visible: boolean;
  } | null>(null);

  // Persist/restore across unmounts (minimize/maximize)
  const storageKey = useMemo(
    () => `dda:heatmap-widget:v1:${widgetId}`,
    [widgetId]
  );
  const restoredRef = useRef(false);
  const isFirstRender = useRef(true);
  const renderingRef = useRef(false);
  const lastQHashRef = useRef<string>('');
  const setQInProgressRef = useRef(false);

  // Safe setQ wrapper to prevent infinite loops
  const safeSetQ = useCallback((newQ: number[][]) => {
    if (setQInProgressRef.current) {
      console.warn('[DDAHeatmapWidget] setQ call blocked - already in progress');
      return;
    }

    // Generate a simple hash of the data to detect duplicates
    const hash = `${newQ.length}x${newQ[0]?.length || 0}_${JSON.stringify(newQ.slice(0, 2).map(row => row.slice(0, 3)))}`;
    
    if (hash === lastQHashRef.current) {
      console.warn('[DDAHeatmapWidget] setQ call blocked - identical data');
      return;
    }

    setQInProgressRef.current = true;
    lastQHashRef.current = hash;
    
    try {
      setQ(newQ);
    } catch (error) {
      console.error('[DDAHeatmapWidget] Error in safeSetQ:', error);
    } finally {
      // Clear the flag after a short delay to allow React to process
      setTimeout(() => {
        setQInProgressRef.current = false;
      }, 100);
    }
  }, []);

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
        console.log('[DDAHeatmapWidget] Restore response type:', typeof response);
        console.log('[DDAHeatmapWidget] Restore response keys:', Object.keys(response || {}));
        if (response.data?.data?.data) {
          const snap = response.data.data.data;
          console.log('[DDAHeatmapWidget] Restored data:', snap);
          console.log('[DDAHeatmapWidget] Restored data type:', typeof snap);
          console.log('[DDAHeatmapWidget] Restored data keys:', Object.keys(snap || {}));
          if (snap) {
            // Restore UI state
            if (snap.colorScheme) setColorScheme(snap.colorScheme);
            // Restore Q data if available
            if (snap.Q && Array.isArray(snap.Q)) {
              console.log('[DDAHeatmapWidget] Restoring Q data, length:', snap.Q.length);
              console.log('[DDAHeatmapWidget] Q data sample:', snap.Q.slice(0, 2));
              try {
                // Sanitize the restored data to ensure all values are valid numbers
                const sanitizedQ = snap.Q.map((row: any, rowIndex: number) => {
                  if (!Array.isArray(row)) {
                    console.warn('[DDAHeatmapWidget] Row', rowIndex, 'is not array:', typeof row, row);
                    return [];
                  }
                  return row.map((v: any, colIndex: number) => {
                    if (v === null || v === undefined) return 0;
                    const value = Number(v);
                    if (isNaN(value) || !isFinite(value)) {
                      if (rowIndex === 0 && colIndex < 5) {
                        console.warn('[DDAHeatmapWidget] Invalid value at', rowIndex, colIndex, ':', v, 'converted to 0');
                      }
                      return 0;
                    }
                    return value;
                  });
                }).filter((row: any[]) => Array.isArray(row) && row.length > 0);
                
                console.log('[DDAHeatmapWidget] Sanitized Q data shape:', sanitizedQ.length, 'x', sanitizedQ[0]?.length || 0);
                if (!renderingRef.current) {
                  safeSetQ(sanitizedQ);
                }
              } catch (error) {
                console.error('[DDAHeatmapWidget] Error sanitizing Q data:', error);
                safeSetQ([]); // Fallback to empty array
              }
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
  }, [storageKey, safeSetQ]);

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
      safeSetQ(sanitizedQ);
    }
  }, [widgetData, safeSetQ]);

  // Persist state snapshot to database when key inputs change
  useEffect(() => {
    if (!restoredRef.current || isLoadingState || isFirstRender.current) return; // Don't save during initial load
    
    // Don't save if Q is empty to prevent infinite loops
    if (!Array.isArray(Q) || Q.length === 0) return;
    
    // Don't save during setQ operations to prevent circular dependencies
    if (setQInProgressRef.current) return;

    // Sanitize data before saving to prevent serialization issues
    const sanitizedQ = Q.map((row) => 
      row.map((v) => {
        const value = Number(v);
        return (isNaN(value) || !isFinite(value)) ? 0 : value;
      })
    );
    const snapshot = { colorScheme, Q: sanitizedQ };

    const saveState = async () => {
      setIsSavingState(true);
      try {
        // Save to localStorage as backup
        localStorage.setItem(`${storageKey}_backup`, JSON.stringify(snapshot));
        
        // Save to database
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
  }, [storageKey, colorScheme, Q, widgetId]);

  // Listen to file selection events
  const handleFileSelection = useCallback((event: any) => {
    // Handle file selection - this is where widgets can react to file changes
    console.log("DDA Heatmap Widget: File selected", event.filePath);
    
    // After file selection, try to trigger data restoration if needed
    if (restoredRef.current && Array.isArray(Q) && Q.length === 0) {
      console.log('[DDAHeatmapWidget] File selected but no data - checking for restoration');
      // Small delay to let other systems settle
      setTimeout(() => {
        if (Array.isArray(Q) && Q.length === 0) {
          // Try to restore from localStorage as backup
          const lastSavedData = localStorage.getItem(`${storageKey}_backup`);
          if (lastSavedData) {
            try {
              const parsed = JSON.parse(lastSavedData);
              if (parsed.Q && Array.isArray(parsed.Q)) {
                console.log('[DDAHeatmapWidget] Restoring from localStorage backup');
                safeSetQ(parsed.Q);
                if (parsed.colorScheme) {
                  setColorScheme(parsed.colorScheme);
                }
              }
            } catch (error) {
              console.error('[DDAHeatmapWidget] Error parsing backup data:', error);
            }
          }
        }
      }, 1000);
    }
  }, [Q, storageKey, safeSetQ]);

  useCurrentFileSubscription(handleFileSelection);

  // Listen to DDA results immediately - don't wait for restoration
  useEffect(() => {
    const onResults = (e: Event) => {
      try {
        const customEvent = e as CustomEvent;
        const detail = customEvent.detail;
        console.log('[DDAHeatmapWidget] Received DDA results event, detail:', typeof detail, detail);
        
        if (!detail || typeof detail !== 'object') {
          console.warn('[DDAHeatmapWidget] Invalid detail object:', detail);
          return;
        }
        
        const Q = detail.Q;
        if (!Array.isArray(Q) || Q.length === 0) {
          console.warn('[DDAHeatmapWidget] Invalid Q data:', typeof Q, Q);
          return;
        }
        
        console.log('[DDAHeatmapWidget] Processing Q data, shape:', Q.length, 'x', Q[0]?.length);
        
        // Clean the data without downsampling
        const cleaned = Q.map((row, rowIndex) => {
          if (!Array.isArray(row)) {
            console.warn('[DDAHeatmapWidget] Row', rowIndex, 'is not array:', typeof row);
            return [];
          }
          return row.map((v, colIndex) => {
            if (v == null) return 0;
            const value = Number(v);
            if (!Number.isFinite(value)) {
              if (rowIndex === 0 && colIndex < 5) {
                console.warn('[DDAHeatmapWidget] Invalid value in results at', rowIndex, colIndex, ':', v);
              }
              return 0;
            }
            return value;
          });
        }).filter(row => Array.isArray(row) && row.length > 0);

        console.log('[DDAHeatmapWidget] Cleaned Q data shape:', cleaned.length, 'x', cleaned[0]?.length || 0);
        if (!renderingRef.current) {
          safeSetQ(cleaned);
        }
        
        // Mark that we've received fresh data
        isFirstRender.current = false;
      } catch (error) {
        console.error('[DDAHeatmapWidget] Error processing DDA results:', error);
      }
    };
    window.addEventListener("dda:results", onResults as EventListener);
    return () =>
      window.removeEventListener("dda:results", onResults as EventListener);
  }, [safeSetQ]);

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

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    // Force re-render by temporarily clearing and restoring Q data
    const currentQ = [...Q];
    safeSetQ([]);
    setTimeout(() => {
      safeSetQ(currentQ);
      setIsLoading(false);
    }, 100);
  }, [Q, safeSetQ]);

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
      // Proper inferno colormap with control points
      const infernoPoints = [
        { t: 0.0, rgb: [0, 0, 4] },
        { t: 0.2, rgb: [20, 11, 52] },
        { t: 0.4, rgb: [66, 10, 104] },
        { t: 0.6, rgb: [147, 38, 103] },
        { t: 0.8, rgb: [229, 92, 48] },
        { t: 1.0, rgb: [252, 255, 164] },
      ];

      // Find the appropriate color segment
      for (let i = 0; i < infernoPoints.length - 1; i++) {
        const p1 = infernoPoints[i];
        const p2 = infernoPoints[i + 1];

        if (clampedValue >= p1.t && clampedValue <= p2.t) {
          const segmentT = (clampedValue - p1.t) / (p2.t - p1.t);
          const r = Math.round(p1.rgb[0] + (p2.rgb[0] - p1.rgb[0]) * segmentT);
          const g = Math.round(p1.rgb[1] + (p2.rgb[1] - p1.rgb[1]) * segmentT);
          const b = Math.round(p1.rgb[2] + (p2.rgb[2] - p1.rgb[2]) * segmentT);
          return `rgb(${r}, ${g}, ${b})`;
        }
      }

      return `rgb(${infernoPoints[infernoPoints.length - 1].rgb.join(', ')})`;
    }
  };

  // Build uPlot heatmap renderer using draw hook for performance
  useEffect(() => {
    try {
      console.log('[DDAHeatmapWidget] useEffect triggered - Q updated:', Array.isArray(Q) ? Q.length : 'not array', 'x', Array.isArray(Q) && Q[0] ? Q[0].length : 'no data');
      
      // Prevent infinite loops - don't render during initial state loading
      if (isLoadingState || isFirstRender.current) {
        console.log('[DDAHeatmapWidget] Skipping render during loading or first render');
        return;
      }
      
      // Always destroy existing chart before creating new one
      if (uplotRef.current) {
        console.log('[DDAHeatmapWidget] Destroying existing chart');
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
      
      // Set rendering flag to prevent state updates during render
      renderingRef.current = true;
    
    if (!containerRef.current || !Array.isArray(Q) || Q.length === 0) {
      console.log('[DDAHeatmapWidget] Conditions not met:', {
        container: !!containerRef.current,
        Q: !!Q,
        QIsArray: Array.isArray(Q),
        QLength: Array.isArray(Q) ? Q.length : 'not array'
      });
      renderingRef.current = false; // Clear flag
      return;
    }
    
    // Additional safety check - ensure Q is a proper 2D array
    const isValid2DArray = Q.every(row => Array.isArray(row));
    if (!isValid2DArray) {
      console.error('[DDAHeatmapWidget] Q is not a proper 2D array:', Q);
      // Don't modify state here as it would cause an infinite loop
      renderingRef.current = false; // Clear flag
      return;
    }
    const rows = Q.length;
    const cols = Q[0]?.length || 0;
    console.log('[DDAHeatmapWidget] Building heatmap with dimensions:', rows, 'x', cols);
    
    // Small delay to ensure DOM is ready
    const timeoutId = setTimeout(() => {
      if (!containerRef.current) {
        console.log('[DDAHeatmapWidget] Container still not available after delay');
        renderingRef.current = false; // Clear flag
        return;
      }

    const x = Float64Array.from({ length: cols }, (_, i) => i);
    const y = new Float64Array(cols).fill(0); // single dummy series; we paint in draw hook

    const opts: uPlot.Options = {
      width: Math.max(320, containerRef.current.clientWidth || 400),
      height: Math.min(600, Math.max(240, rows)),
      scales: { x: { time: false }, y: { auto: true } },
      axes: [{ label: "Time (s)" }, { label: "Channel Pairs" }],
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
            // Collect all values for robust statistics
            const allValues = [];
            let zeroCount = 0;
            for (let i = 0; i < rows; i++) {
              for (let j = 0; j < cols; j++) {
                const v = Q[i][j];
                if (typeof v === 'number' && !isNaN(v) && isFinite(v)) {
                  allValues.push(v);
                  if (v === 0) zeroCount++;
                }
              }
            }

            // Sort values for percentile calculation
            allValues.sort((a, b) => a - b);

            // Calculate percentiles to handle outliers
            const getPercentile = (arr, p) => {
              const index = Math.floor(arr.length * p / 100);
              return arr[Math.min(index, arr.length - 1)];
            };

            // Use 2nd and 98th percentiles for robust color scaling
            // This handles outliers that would otherwise compress the color range
            let min = getPercentile(allValues, 2);
            let max = getPercentile(allValues, 98);

            // Fallback to actual min/max if percentiles are the same
            if (min === max && allValues.length > 0) {
              min = allValues[0];
              max = allValues[allValues.length - 1];
            }

            const denom = max - min || 1;

            // Only log if there are outliers
            if (allValues.length > 0 && (allValues[0] < min * 10 || allValues[allValues.length - 1] > max * 10)) {
              console.log('[DDAHeatmapWidget] Outliers detected and handled:', {
                actualMin: allValues[0],
                actualMax: allValues[allValues.length - 1],
                scaledMin: min,
                scaledMax: max
              });
            }
            // Map plot pixels to Q indices
            for (let py = 0; py < plotH; py++) {
              const qi = Math.min(rows - 1, Math.floor((py / plotH) * rows));
              for (let px = 0; px < plotW; px++) {
                const qj = Math.min(cols - 1, Math.floor((px / plotW) * cols));
                const qv = Q[qi][qj];
                // Clamp values to the percentile range for better visualization
                const clampedValue = Math.max(min, Math.min(max, qv));
                const norm = denom === 0 ? 0 : (clampedValue - min) / denom;
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
        setCursor: [
          (u: uPlot) => {
            const canvas = (u as any).root.querySelector('canvas');
            if (!canvas) return;

            const handleMouseMove = (e: MouseEvent) => {
              const rect = canvas.getBoundingClientRect();
              const canvasX = e.clientX - rect.left;
              const canvasY = e.clientY - rect.top;

              // Map canvas coordinates to Q matrix coordinates
              const plotArea = u.bbox;
              if (canvasX >= plotArea.left && canvasX <= plotArea.left + plotArea.width &&
                  canvasY >= plotArea.top && canvasY <= plotArea.top + plotArea.height) {

                const relativeX = (canvasX - plotArea.left) / plotArea.width;
                const relativeY = (canvasY - plotArea.top) / plotArea.height;

                const dataX = Math.floor(relativeX * cols);
                const dataY = Math.floor(relativeY * rows);

                if (dataY >= 0 && dataY < rows && dataX >= 0 && dataX < cols) {
                  const value = Q[dataY][dataX];
                  setCursorInfo({
                    x: canvasX,
                    y: canvasY,
                    dataX,
                    dataY,
                    value,
                    visible: true,
                  });
                } else {
                  setCursorInfo(null);
                }
              } else {
                setCursorInfo(null);
              }
            };

            const handleMouseLeave = () => {
              setCursorInfo(null);
            };

            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('mouseleave', handleMouseLeave);

            // Store cleanup functions on the canvas element
            (canvas as any)._cleanupCursor = () => {
              canvas.removeEventListener('mousemove', handleMouseMove);
              canvas.removeEventListener('mouseleave', handleMouseLeave);
            };
          },
        ],
      },
    } as any;

    const data = [x, y] as unknown as uPlot.AlignedData;
    if (uplotRef.current) {
      // Clean up old cursor listeners before updating
      const canvas = (uplotRef.current as any).root.querySelector('canvas');
      if (canvas && (canvas as any)._cleanupCursor) {
        (canvas as any)._cleanupCursor();
      }

      uplotRef.current.setData(data);
      uplotRef.current.redraw();
    } else {
      try {
        // Get the appropriate uPlot constructor based on context
        let uPlotConstructor = uPlot;

        // Check if we're in a popup window context and use global uPlot if available
        if (typeof window !== 'undefined' && window.opener && (window as any).uPlot) {
          console.log('[DDAHeatmapWidget] Using popup window uPlot');
          uPlotConstructor = (window as any).uPlot;
        }

        uplotRef.current = new uPlotConstructor(opts, data, containerRef.current);
      } catch (error) {
        console.error('[DDAHeatmapWidget] Error creating uPlot instance:', error);
        // Don't throw - just log the error to prevent component crash
      }
      
      // Clear rendering flag after chart creation completes
      renderingRef.current = false;
    }

    }, 50); // 50ms delay
    
    // Cleanup function for cursor listeners and timeout
    return () => {
      clearTimeout(timeoutId);
      renderingRef.current = false; // Clear flag on cleanup
      if (uplotRef.current) {
        const canvas = (uplotRef.current as any).root?.querySelector('canvas');
        if (canvas && (canvas as any)._cleanupCursor) {
          (canvas as any)._cleanupCursor();
        }
      }
    };
    } catch (error) {
      console.error('[DDAHeatmapWidget] Critical error in useEffect:', error);
      // Don't modify state here as it would cause an infinite loop
      renderingRef.current = false; // Clear flag on error
    }
  }, [Q, colorScheme, isLoadingState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (uplotRef.current) {
        const canvas = (uplotRef.current as any).root?.querySelector('canvas');
        if (canvas && (canvas as any)._cleanupCursor) {
          (canvas as any)._cleanupCursor();
        }
        uplotRef.current.destroy();
        uplotRef.current = null;
      }
    };
  }, []);

  const getStats = () => {
    if (!Array.isArray(Q) || Q.length === 0) return { min: 0, max: 0, avg: 0 };
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let count = 0;
    
    try {
      for (let i = 0; i < Q.length; i++) {
        const row = Q[i];
        if (!Array.isArray(row)) continue;
        for (let j = 0; j < row.length; j++) {
          const v = row[j];
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
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
    } catch (error) {
      console.error('[DDAHeatmapWidget] Error calculating stats:', error);
      return { min: 0, max: 0, avg: 0 };
    }
  };

  const stats = getStats();

  return (
    <div className="flex flex-col h-full p-2 space-y-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" />
            DDA Heatmap (a1 Coefficients)
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
            <div
              ref={containerRef}
              className="w-full"
              style={{ minHeight: 320, display: isLoadingState ? 'none' : 'block' }}
            />
            {isLoadingState && (
              <div className="absolute inset-0 w-full h-[320px] flex items-center justify-center bg-muted/20">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading widget state...</span>
                </div>
              </div>
            )}

            {/* Cursor info overlay */}
            {cursorInfo && cursorInfo.visible && (
              <div
                className="absolute pointer-events-none z-20 bg-black/80 text-white px-2 py-1 rounded text-xs whitespace-nowrap"
                style={{
                  left: Math.min(cursorInfo.x + 10, 300),
                  top: Math.max(cursorInfo.y - 30, 10),
                }}
              >
                <div>X: {cursorInfo.dataX}, Y: {cursorInfo.dataY}</div>
                <div>Q: {cursorInfo.value !== null ? cursorInfo.value.toFixed(4) : 'N/A'}</div>
              </div>
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
              {Array.isArray(Q) ? Q.length : 0} × {Array.isArray(Q) && Q.length > 0 && Array.isArray(Q[0]) ? Q[0].length : 0} data points • {colorScheme}
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
